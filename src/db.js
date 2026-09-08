const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const {
  DATA_DIR,
  DB_PATH,
  ENABLE_DB_INSTALL_BACKUP,
  STORE_BRANCHES,
  STORE_BRANCH_LABELS,
  STORE_TIME_ZONE,
} = require("./config");

let databaseInstance;
const SQLITE_MAGIC_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");
const COMPATIBLE_DB_REQUIRED_TABLES = [
  "business_profile",
  "branches",
  "products",
  "sales",
  "sale_items",
];
const COMPATIBLE_DB_REQUIRED_COLUMNS = {
  business_profile: ["id", "business_name", "slug"],
  branches: ["code", "name"],
  products: ["id", "name", "price", "category", "unit"],
  sales: ["id", "ticket_number", "shift", "cashier", "subtotal", "total", "received_amount", "created_at"],
  sale_items: ["id", "sale_id", "product_id", "product_name", "quantity", "unit_price", "line_total"],
};
const SQLITE_COMPATIBILITY_ERROR_MESSAGE = "El archivo SQLite no es compatible con este POS.";

function openDatabaseConnection() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  initializeSchema(db);
  return db;
}

function ensureDatabaseConnection() {
  if (!databaseInstance) {
    databaseInstance = openDatabaseConnection();
  }

  return databaseInstance;
}

const databaseFacade = new Proxy(
  {},
  {
    get(_target, property) {
      const currentDb = ensureDatabaseConnection();
      const value = currentDb[property];
      return typeof value === "function" ? value.bind(currentDb) : value;
    },
    set(_target, property, value) {
      ensureDatabaseConnection()[property] = value;
      return true;
    },
    has(_target, property) {
      return property in ensureDatabaseConnection();
    },
    ownKeys() {
      return Reflect.ownKeys(ensureDatabaseConnection());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(ensureDatabaseConnection(), property);
      return descriptor
        ? { ...descriptor, configurable: true }
        : undefined;
    },
  },
);

function listTableColumns(db, tableName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all();
  } catch (_error) {
    return [];
  }
}

function hasColumn(columns, columnName) {
  return columns.some((column) => column.name === columnName);
}

function migrateSaleItemProfitabilityColumns(db) {
  const saleItemColumns = listTableColumns(db, "sale_items");
  if (saleItemColumns.length === 0) {
    return;
  }

  if (!hasColumn(saleItemColumns, "unit_cost")) {
    db.exec("ALTER TABLE sale_items ADD COLUMN unit_cost REAL");
  }
  if (!hasColumn(saleItemColumns, "line_cost")) {
    db.exec("ALTER TABLE sale_items ADD COLUMN line_cost REAL");
  }
  if (!hasColumn(saleItemColumns, "gross_profit")) {
    db.exec("ALTER TABLE sale_items ADD COLUMN gross_profit REAL");
  }
  if (!hasColumn(saleItemColumns, "cost_status")) {
    db.exec("ALTER TABLE sale_items ADD COLUMN cost_status TEXT NOT NULL DEFAULT 'unknown'");
  }

  db.exec(`
    UPDATE sale_items
    SET
      unit_cost = COALESCE(
        unit_cost,
        (
          SELECT ROUND(COALESCE(products.cost, 0), 2)
          FROM products
          WHERE products.id = sale_items.product_id
        ),
        0
      ),
      line_cost = CASE
        WHEN COALESCE((
          SELECT products.cost
          FROM products
          WHERE products.id = sale_items.product_id
        ), 0) > 0
          THEN ROUND(quantity * (
            SELECT products.cost
            FROM products
            WHERE products.id = sale_items.product_id
          ), 2)
        ELSE NULL
      END,
      gross_profit = CASE
        WHEN COALESCE((
          SELECT products.cost
          FROM products
          WHERE products.id = sale_items.product_id
        ), 0) > 0
          THEN ROUND(line_total - (quantity * (
            SELECT products.cost
            FROM products
            WHERE products.id = sale_items.product_id
          )), 2)
        ELSE NULL
      END,
      cost_status = CASE
        WHEN COALESCE((
          SELECT products.cost
          FROM products
          WHERE products.id = sale_items.product_id
        ), 0) > 0
          THEN 'estimated_current_cost'
        ELSE 'missing_cost'
      END
    WHERE cost_status IS NULL OR cost_status = '' OR cost_status = 'unknown'
  `);
}

function createMerchandiseRequestTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchandise_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      supplier_name TEXT,
      total_value REAL NOT NULL DEFAULT 0,
      notes TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      applied_at TEXT
    );

    CREATE TABLE IF NOT EXISTS merchandise_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES merchandise_requests(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_value REAL NOT NULL,
      mode TEXT NOT NULL
    );
  `);
}

function createWeightedAuditTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weighted_audit_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      shift TEXT NOT NULL DEFAULT 'Tarde',
      audited_date_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      completed_by TEXT,
      notes TEXT,
      source_register_event_id INTEGER REFERENCES register_events(id) ON DELETE SET NULL,
      source_cashier TEXT,
      template_locked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS weighted_audit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES weighted_audit_sessions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      pos_stock REAL NOT NULL DEFAULT 0,
      counted_stock REAL,
      difference REAL,
      direction TEXT,
      reason TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, product_id)
    );
  `);
}

function extractWeightedAuditSourceEventId(value) {
  const match = String(value || "").match(/\bevento\s+(\d+)\b/i);
  if (!match) {
    return null;
  }

  const eventId = Number(match[1]);
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null;
}

function backfillWeightedAuditSessionSources(db) {
  const sessions = db.prepare(`
    SELECT id, notes, source_register_event_id, source_cashier
    FROM weighted_audit_sessions
    WHERE source_register_event_id IS NULL OR TRIM(COALESCE(source_cashier, '')) = ''
  `).all();

  if (sessions.length === 0) {
    return;
  }

  const getEvent = db.prepare(`
    SELECT id, cashier
    FROM register_events
    WHERE id = ? AND event_type = 'final_cut'
  `);
  const updateSource = db.prepare(`
    UPDATE weighted_audit_sessions
    SET
      source_register_event_id = COALESCE(source_register_event_id, ?),
      source_cashier = CASE
        WHEN TRIM(COALESCE(source_cashier, '')) = '' THEN ?
        ELSE source_cashier
      END
    WHERE id = ?
  `);

  sessions.forEach((session) => {
    const inferredEventId = session.source_register_event_id || extractWeightedAuditSourceEventId(session.notes);
    if (!inferredEventId) {
      return;
    }

    const event = getEvent.get(inferredEventId);
    if (!event) {
      return;
    }

    updateSource.run(event.id, event.cashier || null, session.id);
  });
}

function migrateWeightedAuditTables(db) {
  const sessionColumns = listTableColumns(db, "weighted_audit_sessions");
  const itemColumns = listTableColumns(db, "weighted_audit_items");
  if (sessionColumns.length === 0 || itemColumns.length === 0) {
    return;
  }

  const needsRebuild = !hasColumn(sessionColumns, "source_register_event_id")
    || !hasColumn(sessionColumns, "source_cashier")
    || !hasColumn(sessionColumns, "template_locked");

  if (!needsRebuild) {
    backfillWeightedAuditSessionSources(db);
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");

  try {
    const migrate = db.transaction(() => {
      db.exec("ALTER TABLE weighted_audit_items RENAME TO weighted_audit_items_legacy");
      db.exec("ALTER TABLE weighted_audit_sessions RENAME TO weighted_audit_sessions_legacy");

      createWeightedAuditTables(db);

      db.exec(`
        INSERT INTO weighted_audit_sessions (
          id,
          branch,
          shift,
          audited_date_key,
          status,
          created_by,
          completed_by,
          notes,
          source_register_event_id,
          source_cashier,
          template_locked,
          created_at,
          completed_at
        )
        SELECT
          id,
          COALESCE(branch, 'carrizal'),
          COALESCE(shift, 'Tarde'),
          audited_date_key,
          COALESCE(status, 'pending'),
          created_by,
          completed_by,
          notes,
          NULL,
          NULL,
          1,
          created_at,
          completed_at
        FROM weighted_audit_sessions_legacy
      `);

      db.exec(`
        INSERT INTO weighted_audit_items (
          id,
          session_id,
          product_id,
          product_name,
          unit,
          pos_stock,
          counted_stock,
          difference,
          direction,
          reason,
          unit_price,
          created_at,
          updated_at
        )
        SELECT
          id,
          session_id,
          product_id,
          product_name,
          unit,
          pos_stock,
          counted_stock,
          difference,
          direction,
          reason,
          unit_price,
          created_at,
          updated_at
        FROM weighted_audit_items_legacy
      `);

      db.exec("DROP TABLE weighted_audit_items_legacy");
      db.exec("DROP TABLE weighted_audit_sessions_legacy");
    });

    migrate();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  backfillWeightedAuditSessionSources(db);
}

function resolveLegacyColumn(columns, snakeCaseName, camelCaseName = snakeCaseName, fallback = "NULL") {
  if (hasColumn(columns, snakeCaseName)) {
    return snakeCaseName;
  }

  if (camelCaseName && hasColumn(columns, camelCaseName)) {
    return camelCaseName;
  }

  return fallback;
}

function normalizeLegacyReceivableCustomerFragment(value, fallback = "cliente") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return normalized || fallback;
}

function buildLegacyReceivableCustomerKey(branch, customerName) {
  const branchFragment = normalizeLegacyReceivableCustomerFragment(branch, "branch");
  const customerFragment = normalizeLegacyReceivableCustomerFragment(customerName, "cliente");
  return `legacy:${branchFragment}:${customerFragment}`.slice(0, 120);
}

function backfillReceivableCustomerKeys(db) {
  const salesColumns = listTableColumns(db, "sales");
  const paymentColumns = listTableColumns(db, "credit_payments");
  const salesHasCustomerKey = hasColumn(salesColumns, "customer_key");
  const paymentsHasCustomerKey = hasColumn(paymentColumns, "customer_key");

  if (!salesHasCustomerKey && !paymentsHasCustomerKey) {
    return;
  }

  if (salesHasCustomerKey) {
    const rows = db.prepare(`
      SELECT id, branch, customer_name
      FROM sales
      WHERE payment_method = 'Fiado'
        AND customer_name IS NOT NULL
        AND TRIM(customer_name) != ''
        AND (customer_key IS NULL OR TRIM(customer_key) = '')
      ORDER BY branch ASC, customer_name COLLATE NOCASE ASC, id ASC
    `).all();
    const updateSaleCustomerKey = db.prepare(`
      UPDATE sales
      SET customer_key = ?
      WHERE id = ?
    `);

    rows.forEach((row) => {
      updateSaleCustomerKey.run(
        buildLegacyReceivableCustomerKey(row.branch, row.customer_name),
        row.id,
      );
    });
  }

  if (paymentsHasCustomerKey) {
    db.exec(`
      UPDATE credit_payments
      SET customer_key = COALESCE(
        customer_key,
        (
          SELECT s.customer_key
          FROM sales s
          WHERE s.id = credit_payments.sale_id
          LIMIT 1
        )
      )
      WHERE customer_key IS NULL OR TRIM(customer_key) = ''
    `);
  }
}

function migrateLegacyMerchandiseTables(db) {
  const requestColumns = listTableColumns(db, "merchandise_requests");
  const itemColumns = listTableColumns(db, "merchandise_request_items");
  const requestHasLegacyColumns = [
    "requestedBy",
    "supplierName",
    "totalValue",
    "rejectionReason",
    "createdAt",
    "approvedAt",
    "appliedAt",
  ].some((columnName) => hasColumn(requestColumns, columnName));
  const itemHasLegacyColumns = [
    "requestId",
    "productId",
    "productName",
    "unitPrice",
    "totalValue",
  ].some((columnName) => hasColumn(itemColumns, columnName));

  if (!requestHasLegacyColumns && !itemHasLegacyColumns) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");

  try {
    const migrate = db.transaction(() => {
      if (itemColumns.length > 0) {
        db.exec("ALTER TABLE merchandise_request_items RENAME TO merchandise_request_items_legacy");
      }
      if (requestColumns.length > 0) {
        db.exec("ALTER TABLE merchandise_requests RENAME TO merchandise_requests_legacy");
      }

      createMerchandiseRequestTables(db);

      if (requestColumns.length > 0) {
        db.exec(`
          INSERT INTO merchandise_requests (
            id,
            status,
            requested_by,
            branch,
            supplier_name,
            total_value,
            notes,
            rejection_reason,
            created_at,
            approved_at,
            applied_at
          )
          SELECT
            ${resolveLegacyColumn(requestColumns, "id")},
            COALESCE(${resolveLegacyColumn(requestColumns, "status")}, 'pending'),
            ${resolveLegacyColumn(requestColumns, "requested_by", "requestedBy", "''")},
            COALESCE(${resolveLegacyColumn(requestColumns, "branch")}, 'carrizal'),
            ${resolveLegacyColumn(requestColumns, "supplier_name", "supplierName")},
            COALESCE(${resolveLegacyColumn(requestColumns, "total_value", "totalValue", "0")}, 0),
            ${resolveLegacyColumn(requestColumns, "notes")},
            ${resolveLegacyColumn(requestColumns, "rejection_reason", "rejectionReason")},
            ${resolveLegacyColumn(requestColumns, "created_at", "createdAt", "CURRENT_TIMESTAMP")},
            ${resolveLegacyColumn(requestColumns, "approved_at", "approvedAt")},
            ${resolveLegacyColumn(requestColumns, "applied_at", "appliedAt")}
          FROM merchandise_requests_legacy
        `);
      }

      if (itemColumns.length > 0) {
        db.exec(`
          INSERT INTO merchandise_request_items (
            id,
            request_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            total_value,
            mode
          )
          SELECT
            ${resolveLegacyColumn(itemColumns, "id")},
            ${resolveLegacyColumn(itemColumns, "request_id", "requestId", "0")},
            ${resolveLegacyColumn(itemColumns, "product_id", "productId", "0")},
            ${resolveLegacyColumn(itemColumns, "product_name", "productName", "''")},
            COALESCE(${resolveLegacyColumn(itemColumns, "quantity", "quantity", "0")}, 0),
            COALESCE(${resolveLegacyColumn(itemColumns, "unit_price", "unitPrice", "0")}, 0),
            COALESCE(${resolveLegacyColumn(itemColumns, "total_value", "totalValue", "0")}, 0),
            ${resolveLegacyColumn(itemColumns, "mode", "mode", "'receive'")}
          FROM merchandise_request_items_legacy
        `);
      }

      if (itemColumns.length > 0) {
        db.exec("DROP TABLE merchandise_request_items_legacy");
      }
      if (requestColumns.length > 0) {
        db.exec("DROP TABLE merchandise_requests_legacy");
      }
    });

    migrate();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT '${STORE_TIME_ZONE}',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      business_name TEXT NOT NULL,
      slug TEXT NOT NULL,
      short_name TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'MXN',
      locale TEXT NOT NULL DEFAULT 'es-MX',
      timezone TEXT NOT NULL DEFAULT '${STORE_TIME_ZONE}',
      ticket_prefix TEXT NOT NULL DEFAULT 'POS',
      template_key TEXT NOT NULL DEFAULT 'base',
      branding_json TEXT NOT NULL DEFAULT '{}',
      visible_texts_json TEXT NOT NULL DEFAULT '{}',
      modules_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_branding_logo (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content BLOB NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS measurement_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      allow_decimals INTEGER NOT NULL DEFAULT 1,
      step REAL NOT NULL DEFAULT 0.25,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_attribute_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'text',
      options_json TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_attribute_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      definition_id INTEGER NOT NULL REFERENCES product_attribute_definitions(id) ON DELETE CASCADE,
      value_text TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, definition_id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pza',
      category_id INTEGER REFERENCES product_categories(id),
      unit_id INTEGER REFERENCES measurement_units(id),
      type_code TEXT,
      sku TEXT,
      barcode TEXT,
      brand TEXT,
      supplier_name TEXT,
      cost REAL NOT NULL DEFAULT 0,
      pack_size REAL,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      stock_initialized INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, branch)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT NOT NULL UNIQUE,
      client_sale_id TEXT,
      shift TEXT NOT NULL,
      cashier TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      payment_method TEXT NOT NULL DEFAULT 'Efectivo',
      customer_name TEXT,
      customer_key TEXT,
      received_payment_method TEXT,
      subtotal REAL NOT NULL,
      total REAL NOT NULL,
      received_amount REAL NOT NULL,
      change_amount REAL NOT NULL,
      notes TEXT,
      item_count REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      unit_cost REAL,
      line_cost REAL,
      gross_profit REAL,
      cost_status TEXT NOT NULL DEFAULT 'unknown',
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      movement_type TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      quantity_delta REAL NOT NULL,
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL,
      note TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS register_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      shift TEXT NOT NULL,
      cashier TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      client_event_id TEXT,
      over_withdrawal_amount REAL NOT NULL DEFAULT 0,
      opening_amount REAL NOT NULL DEFAULT 0,
      counted_amount REAL NOT NULL DEFAULT 0,
      withdrawals_amount REAL NOT NULL DEFAULT 0,
      expected_cash REAL NOT NULL DEFAULT 0,
      difference_amount REAL NOT NULL DEFAULT 0,
      cash_sales REAL NOT NULL DEFAULT 0,
      non_cash_sales REAL NOT NULL DEFAULT 0,
      total_sales REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      client_payment_id TEXT,
      shift TEXT NOT NULL,
      cashier TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      customer_name TEXT NOT NULL,
      customer_key TEXT,
      payment_method TEXT NOT NULL DEFAULT 'Efectivo',
      amount REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weighted_audit_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      shift TEXT NOT NULL DEFAULT 'Tarde',
      audited_date_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      completed_by TEXT,
      notes TEXT,
      source_register_event_id INTEGER REFERENCES register_events(id) ON DELETE SET NULL,
      source_cashier TEXT,
      template_locked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS weighted_audit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES weighted_audit_sessions(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      pos_stock REAL NOT NULL DEFAULT 0,
      counted_stock REAL,
      difference REAL,
      direction TEXT,
      reason TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, branch)
    );

    CREATE TABLE IF NOT EXISTS cashier_sessions (
      token TEXT PRIMARY KEY,
      cashier_id INTEGER NOT NULL REFERENCES cashiers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS owner_sessions (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL DEFAULT 'admin',
      actor_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      branch TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'unknown',
      backup_date_key TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      sqlite_local_path TEXT,
      workbook_local_path TEXT,
      sqlite_bytes INTEGER NOT NULL DEFAULT 0,
      workbook_bytes INTEGER NOT NULL DEFAULT 0,
      sqlite_remote_key TEXT,
      workbook_remote_key TEXT,
      storage_mode TEXT NOT NULL DEFAULT 'unconfigured',
      storage_bucket TEXT,
      error_message TEXT,
      summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_sync_reports (
      device_id TEXT PRIMARY KEY,
      branch TEXT,
      actor_type TEXT NOT NULL DEFAULT 'device',
      actor_name TEXT,
      pending_queue_count INTEGER NOT NULL DEFAULT 0,
      blocked_queue_count INTEGER NOT NULL DEFAULT 0,
      register_events_count INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 1,
      reported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_subscription (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      plan_code TEXT NOT NULL DEFAULT 'fundadores_beta',
      status TEXT NOT NULL DEFAULT 'trial',
      monthly_amount REAL NOT NULL DEFAULT 200,
      currency_code TEXT NOT NULL DEFAULT 'MXN',
      current_period_start TEXT,
      current_period_end TEXT,
      grace_period_until TEXT,
      last_payment_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_subscription_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      payment_method TEXT,
      paid_at TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_error_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'frontend',
      level TEXT NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      stack TEXT,
      url TEXT,
      method TEXT,
      status_code INTEGER,
      role TEXT,
      branch TEXT,
      user_agent TEXT,
      context_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS period_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch TEXT NOT NULL,
      period_type TEXT NOT NULL,
      period_start_date_key TEXT NOT NULL,
      period_end_date_key TEXT NOT NULL,
      notes TEXT,
      snapshot_json TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_register_events_shift_created_at ON register_events(shift, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_backup_runs_finished_at ON backup_runs(finished_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_client_sync_reports_reported_at ON client_sync_reports(reported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_service_subscription_payments_paid_at
      ON service_subscription_payments(paid_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_app_error_reports_created_at ON app_error_reports(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_app_error_reports_source_created_at
      ON app_error_reports(source, created_at DESC);
  `);

  const branchColumns = db.prepare("PRAGMA table_info(branches)").all();
  if (branchColumns.length > 0) {
    if (!branchColumns.some((column) => column.name === "timezone")) {
      db.exec(`ALTER TABLE branches ADD COLUMN timezone TEXT NOT NULL DEFAULT '${STORE_TIME_ZONE}'`);
    }
    if (!branchColumns.some((column) => column.name === "active")) {
      db.exec("ALTER TABLE branches ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    }
    if (!branchColumns.some((column) => column.name === "sort_order")) {
      db.exec("ALTER TABLE branches ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    }
    if (!branchColumns.some((column) => column.name === "created_at")) {
      db.exec("ALTER TABLE branches ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    }
    if (!branchColumns.some((column) => column.name === "updated_at")) {
      db.exec("ALTER TABLE branches ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    }
  }

  const upsertBranch = db.prepare(`
    INSERT INTO branches (code, name, timezone, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = COALESCE(branches.name, excluded.name),
      timezone = COALESCE(branches.timezone, excluded.timezone),
      updated_at = excluded.updated_at
  `);
  const existingBranchCount = Number(db.prepare("SELECT COUNT(*) AS count FROM branches").get().count || 0);
  const seededAt = nowIso();
  STORE_BRANCHES.forEach((branchCode, index) => {
    const branchName = STORE_BRANCH_LABELS[branchCode] || branchCode;
    if (existingBranchCount === 0) {
      upsertBranch.run(branchCode, branchName, STORE_TIME_ZONE, index, seededAt, seededAt);
      return;
    }

    db.prepare(`
      INSERT INTO branches (code, name, timezone, active, sort_order, created_at, updated_at)
      SELECT ?, ?, ?, 1, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM branches WHERE code = ?)
    `).run(branchCode, branchName, STORE_TIME_ZONE, index, seededAt, seededAt, branchCode);
  });

  db.prepare(`
    INSERT INTO business_profile (
      id,
      business_name,
      slug,
      short_name,
      currency_code,
      locale,
      timezone,
      ticket_prefix,
      template_key,
      branding_json,
      visible_texts_json,
      modules_json,
      created_at,
      updated_at
    )
    SELECT 1, ?, ?, ?, 'MXN', 'es-MX', ?, 'POS', 'base', ?, '{}', ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM business_profile WHERE id = 1)
  `).run(
    "Merxalia POS",
    "merxalia-pos",
    "Merxalia",
    STORE_TIME_ZONE,
    JSON.stringify({
      logo192: "/assets/branding/merxalia-badge.svg",
      logo512: "/assets/branding/merxalia-badge.svg",
      logo: "/assets/branding/merxalia-badge.svg",
    }),
    JSON.stringify([]),
    seededAt,
    seededAt,
  );

  const insertCategory = db.prepare(`
    INSERT INTO product_categories (code, label, sort_order, active, created_at, updated_at)
    SELECT ?, ?, ?, 1, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE code = ?)
  `);
  [
    ["quesos", "Quesos"],
    ["carnes", "Carnes"],
    ["piezas", "Piezas"],
    ["general", "General"],
  ].forEach(([code, label], index) => {
    insertCategory.run(code, label, index, seededAt, seededAt, code);
  });

  const insertUnit = db.prepare(`
    INSERT INTO measurement_units (code, label, allow_decimals, step, sort_order, active, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 1, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM measurement_units WHERE code = ?)
  `);
  [
    ["kg", "kg", 1, 0.25],
    ["pza", "pza", 0, 1],
  ].forEach(([code, label, allowDecimals, step], index) => {
    insertUnit.run(code, label, allowDecimals, step, index, seededAt, seededAt, code);
  });

  const productColumns = db.prepare("PRAGMA table_info(products)").all();
  if (!productColumns.some((column) => column.name === "stock_initialized")) {
    db.exec("ALTER TABLE products ADD COLUMN stock_initialized INTEGER NOT NULL DEFAULT 0");
  }

  const productBranchColumn = productColumns.find((c) => c.name === "branch");
  if (!productBranchColumn) {
    db.exec("ALTER TABLE products ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
    db.exec("UPDATE products SET branch = 'carrizal' WHERE branch IS NULL OR branch = ''");
  }
  if (!productColumns.some((column) => column.name === "category_id")) {
    db.exec("ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES product_categories(id)");
  }
  if (!productColumns.some((column) => column.name === "unit_id")) {
    db.exec("ALTER TABLE products ADD COLUMN unit_id INTEGER REFERENCES measurement_units(id)");
  }
  if (!productColumns.some((column) => column.name === "sku")) {
    db.exec("ALTER TABLE products ADD COLUMN sku TEXT");
  }
  if (!productColumns.some((column) => column.name === "barcode")) {
    db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
  }
  if (!productColumns.some((column) => column.name === "brand")) {
    db.exec("ALTER TABLE products ADD COLUMN brand TEXT");
  }
  if (!productColumns.some((column) => column.name === "supplier_name")) {
    db.exec("ALTER TABLE products ADD COLUMN supplier_name TEXT");
  }
  if (!productColumns.some((column) => column.name === "cost")) {
    db.exec("ALTER TABLE products ADD COLUMN cost REAL NOT NULL DEFAULT 0");
  }
  if (!productColumns.some((column) => column.name === "pack_size")) {
    db.exec("ALTER TABLE products ADD COLUMN pack_size REAL");
  }

  db.exec(`
    UPDATE products
    SET category_id = COALESCE(
      category_id,
      (
        SELECT id
        FROM product_categories
        WHERE code = LOWER(TRIM(products.category))
        LIMIT 1
      ),
      (
        SELECT id
        FROM product_categories
        WHERE code = 'general'
        LIMIT 1
      )
    )
    WHERE category_id IS NULL
  `);
  db.exec(`
    UPDATE products
    SET unit_id = COALESCE(
      unit_id,
      (
        SELECT id
        FROM measurement_units
        WHERE code = LOWER(TRIM(products.unit))
        LIMIT 1
      ),
      (
        SELECT id
        FROM measurement_units
        WHERE code = 'pza'
        LIMIT 1
      )
    )
    WHERE unit_id IS NULL
  `);

  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_branch ON products(name, branch)");
  } catch (e) {
  }

  const cashiersColumns = db.prepare("PRAGMA table_info(cashiers)").all();
  const cashiersBranchColumn = cashiersColumns.find((c) => c.name === "branch");
  if (!cashiersBranchColumn) {
    db.exec("ALTER TABLE cashiers ADD COLUMN branch TEXT DEFAULT 'carrizal'");
    db.exec("UPDATE cashiers SET branch = 'carrizal' WHERE branch IS NULL OR branch = ''");
  }

  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cashiers_name_branch ON cashiers(name, branch)");
  } catch (e) {
  }

  const salesColumns = db.prepare("PRAGMA table_info(sales)").all();
  if (!salesColumns.some((column) => column.name === "client_sale_id")) {
    db.exec("ALTER TABLE sales ADD COLUMN client_sale_id TEXT");
  }
  if (!salesColumns.some((column) => column.name === "branch")) {
    db.exec("ALTER TABLE sales ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
  }
  if (!salesColumns.some((column) => column.name === "customer_name")) {
    db.exec("ALTER TABLE sales ADD COLUMN customer_name TEXT");
  }
  if (!salesColumns.some((column) => column.name === "customer_key")) {
    db.exec("ALTER TABLE sales ADD COLUMN customer_key TEXT");
  }
  if (!salesColumns.some((column) => column.name === "received_payment_method")) {
    db.exec("ALTER TABLE sales ADD COLUMN received_payment_method TEXT");
  }

  migrateSaleItemProfitabilityColumns(db);

  const creditPaymentsColumns = db.prepare("PRAGMA table_info(credit_payments)").all();
  if (creditPaymentsColumns.length > 0 && !creditPaymentsColumns.some((column) => column.name === "customer_key")) {
    db.exec("ALTER TABLE credit_payments ADD COLUMN customer_key TEXT");
  }

  backfillReceivableCustomerKeys(db);

  const inventoryMovementsColumns = db.prepare("PRAGMA table_info(inventory_movements)").all();
  if (!inventoryMovementsColumns.some((column) => column.name === "branch")) {
    db.exec("ALTER TABLE inventory_movements ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
  }

  const registerEventsColumns = db.prepare("PRAGMA table_info(register_events)").all();
  if (!registerEventsColumns.some((column) => column.name === "branch")) {
    db.exec("ALTER TABLE register_events ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
  }
  if (!registerEventsColumns.some((column) => column.name === "withdrawals_amount")) {
    db.exec("ALTER TABLE register_events ADD COLUMN withdrawals_amount REAL NOT NULL DEFAULT 0");
  }
  if (!registerEventsColumns.some((column) => column.name === "client_event_id")) {
    db.exec("ALTER TABLE register_events ADD COLUMN client_event_id TEXT");
  }
  if (!registerEventsColumns.some((column) => column.name === "over_withdrawal_amount")) {
    db.exec("ALTER TABLE register_events ADD COLUMN over_withdrawal_amount REAL NOT NULL DEFAULT 0");
  }

  migrateWeightedAuditTables(db);
  migrateLegacyMerchandiseTables(db);
  createMerchandiseRequestTables(db);

  const merchandiseRequestColumns = listTableColumns(db, "merchandise_requests");
  if (merchandiseRequestColumns.length > 0) {
    if (!hasColumn(merchandiseRequestColumns, "branch")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
    }
    if (!hasColumn(merchandiseRequestColumns, "supplier_name")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN supplier_name TEXT");
    }
    if (!hasColumn(merchandiseRequestColumns, "total_value")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN total_value REAL NOT NULL DEFAULT 0");
    }
    if (!hasColumn(merchandiseRequestColumns, "notes")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN notes TEXT");
    }
    if (!hasColumn(merchandiseRequestColumns, "rejection_reason")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN rejection_reason TEXT");
    }
    if (!hasColumn(merchandiseRequestColumns, "approved_at")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN approved_at TEXT");
    }
    if (!hasColumn(merchandiseRequestColumns, "applied_at")) {
      db.exec("ALTER TABLE merchandise_requests ADD COLUMN applied_at TEXT");
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at ON sales(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_branch_customer_key ON sales(branch, customer_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id_unique ON sales(client_sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_cost_status ON sale_items(cost_status);
    CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id_created_at ON credit_payments(sale_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_credit_payments_branch_created_at ON credit_payments(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_credit_payments_branch_customer_key ON credit_payments(branch, customer_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_payments_client_payment_id_unique ON credit_payments(client_payment_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created_at ON inventory_movements(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_register_events_branch_shift_created_at ON register_events(branch, shift, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_register_events_client_event_id_unique ON register_events(client_event_id);
    CREATE INDEX IF NOT EXISTS idx_products_branch ON products(branch);
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_unit_id ON products(unit_id);
    CREATE INDEX IF NOT EXISTS idx_branches_active_sort ON branches(active, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_product_categories_active_sort ON product_categories(active, sort_order, label);
    CREATE INDEX IF NOT EXISTS idx_measurement_units_active_sort ON measurement_units(active, sort_order, label);
    CREATE INDEX IF NOT EXISTS idx_product_attribute_definitions_active_sort ON product_attribute_definitions(active, sort_order, label);
    CREATE INDEX IF NOT EXISTS idx_product_attribute_values_product_id ON product_attribute_values(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_attribute_values_definition_id ON product_attribute_values(definition_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_sessions_cashier_id ON cashier_sessions(cashier_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_sessions_expires_at ON cashier_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_owner_sessions_expires_at ON owner_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_weighted_audit_sessions_branch_shift_date
      ON weighted_audit_sessions(branch, shift, audited_date_key);
    CREATE INDEX IF NOT EXISTS idx_weighted_audit_sessions_created_at
      ON weighted_audit_sessions(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weighted_audit_sessions_source_event
      ON weighted_audit_sessions(source_register_event_id)
      WHERE source_register_event_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weighted_audit_sessions_manual_scope
      ON weighted_audit_sessions(branch, shift, audited_date_key)
      WHERE source_register_event_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_weighted_audit_items_session_id
      ON weighted_audit_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_weighted_audit_items_product_id
      ON weighted_audit_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_merchandise_requests_status_created_at
      ON merchandise_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_merchandise_requests_branch_created_at
      ON merchandise_requests(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_merchandise_request_items_request_id
      ON merchandise_request_items(request_id);
    CREATE INDEX IF NOT EXISTS idx_merchandise_requests_requested_by_branch_created_at
      ON merchandise_requests(requested_by, branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_period_closures_branch_period_updated
      ON period_closures(branch, period_type, updated_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_period_closures_unique_scope
      ON period_closures(branch, period_type, period_start_date_key, period_end_date_key);
  `);
}

function getDb() {
  return databaseFacade;
}

function closeDatabaseConnection() {
  if (!databaseInstance) {
    return;
  }

  try {
    databaseInstance.pragma("wal_checkpoint(TRUNCATE)");
  } catch (_error) {
    // Si el checkpoint falla, igual intentamos cerrar para no bloquear el reemplazo del archivo.
  }

  databaseInstance.close();
  databaseInstance = undefined;
}

function reloadDatabaseConnection() {
  closeDatabaseConnection();
  return ensureDatabaseConnection();
}

function cleanupSqliteSidecars(basePath = DB_PATH) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${basePath}${suffix}`;
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
    }
  }
}

function validateSqliteBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < SQLITE_MAGIC_HEADER.length) {
    throw new Error("El archivo esta vacio o incompleto.");
  }

  if (!buffer.subarray(0, SQLITE_MAGIC_HEADER.length).equals(SQLITE_MAGIC_HEADER)) {
    throw new Error("El archivo no es una base de datos SQLite valida.");
  }
}

function verifyReadableDatabase(databasePath) {
  const tempDb = new Database(databasePath, { fileMustExist: true });
  try {
    tempDb.pragma("quick_check");
    tempDb.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
  } finally {
    tempDb.close();
  }
}

function verifyCompatiblePosDatabase(databasePath) {
  const tempDb = new Database(databasePath, { fileMustExist: true });
  try {
    const tableNames = new Set(
      tempDb.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `).all().map((row) => String(row.name || "")),
    );
    const missingTables = COMPATIBLE_DB_REQUIRED_TABLES.filter((tableName) => !tableNames.has(tableName));
    if (missingTables.length > 0) {
      throw new Error(SQLITE_COMPATIBILITY_ERROR_MESSAGE);
    }

    Object.entries(COMPATIBLE_DB_REQUIRED_COLUMNS).forEach(([tableName, requiredColumns]) => {
      const tableColumns = listTableColumns(tempDb, tableName);
      const missingColumns = requiredColumns.filter((columnName) => !hasColumn(tableColumns, columnName));
      if (missingColumns.length > 0) {
        throw new Error(SQLITE_COMPATIBILITY_ERROR_MESSAGE);
      }
    });

    const profileRow = tempDb.prepare(`
      SELECT business_name, slug
      FROM business_profile
      WHERE id = 1
      LIMIT 1
    `).get();
    if (
      !profileRow
      || !String(profileRow.business_name || "").trim()
      || !String(profileRow.slug || "").trim()
    ) {
      throw new Error(SQLITE_COMPATIBILITY_ERROR_MESSAGE);
    }
  } finally {
    tempDb.close();
  }
}

function purgeImportedSessionTables(database = ensureDatabaseConnection()) {
  database.transaction(() => {
    database.prepare("DELETE FROM admin_sessions").run();
    database.prepare("DELETE FROM owner_sessions").run();
    database.prepare("DELETE FROM cashier_sessions").run();
  })();
}

async function installDatabaseFromBuffer(buffer) {
  validateSqliteBuffer(buffer);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const stamp = `${Date.now()}-${process.pid}`;
  const tempPath = path.join(DATA_DIR, `incoming-db-${stamp}.sqlite`);
  let backupPath = null;
  let connectionClosed = false;

  try {
    fs.writeFileSync(tempPath, buffer);
    verifyReadableDatabase(tempPath);
    verifyCompatiblePosDatabase(tempPath);

    if (ENABLE_DB_INSTALL_BACKUP && fs.existsSync(DB_PATH)) {
      backupPath = path.join(DATA_DIR, `cremaria-rincon.backup-${stamp}.sqlite`);
      await createDatabaseBackup(backupPath);
    }

    closeDatabaseConnection();
    connectionClosed = true;
    cleanupSqliteSidecars();
    fs.writeFileSync(DB_PATH, buffer);
    reloadDatabaseConnection();
    purgeImportedSessionTables();

    return {
      backupPath,
      installedAt: nowIso(),
      sessionsPurged: true,
    };
  } catch (error) {
    if (backupPath && fs.existsSync(backupPath)) {
      try {
        cleanupSqliteSidecars();
        fs.copyFileSync(backupPath, DB_PATH);
      } catch (_restoreError) {
        // Conservamos el error original; si la restauración falla, la siguiente recarga lo expondrá.
      }
    }

    if (connectionClosed) {
      try {
        reloadDatabaseConnection();
      } catch (_reloadError) {
        // Si también falla la recarga, dejamos el error original para que el caller lo reporte.
      }
    }

    throw error;
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

async function createDatabaseBackup(targetPath) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  await ensureDatabaseConnection().backup(targetPath);
  return targetPath;
}

function nowIso() {
  return new Date().toISOString();
}

function getTodayBounds(baseDate = new Date()) {
  const start = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + 1,
    0,
    0,
    0,
    0,
  );

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

module.exports = {
  closeDatabaseConnection,
  createDatabaseBackup,
  getDb,
  installDatabaseFromBuffer,
  nowIso,
  reloadDatabaseConnection,
  SQLITE_COMPATIBILITY_ERROR_MESSAGE,
  getTodayBounds,
};
