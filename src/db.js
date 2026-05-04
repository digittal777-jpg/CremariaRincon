const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const { DATA_DIR, DB_PATH, ENABLE_DB_INSTALL_BACKUP } = require("./config");

let databaseInstance;
const SQLITE_MAGIC_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");

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

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pza',
      type_code TEXT,
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
      shift TEXT NOT NULL,
      cashier TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'carrizal',
      payment_method TEXT NOT NULL DEFAULT 'Efectivo',
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

    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_register_events_shift_created_at ON register_events(shift, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
  `);

  const productColumns = db.prepare("PRAGMA table_info(products)").all();
  if (!productColumns.some((column) => column.name === "stock_initialized")) {
    db.exec("ALTER TABLE products ADD COLUMN stock_initialized INTEGER NOT NULL DEFAULT 0");
  }

  const productBranchColumn = productColumns.find((c) => c.name === "branch");
  if (!productBranchColumn) {
    db.exec("ALTER TABLE products ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
    db.exec("UPDATE products SET branch = 'carrizal' WHERE branch IS NULL OR branch = ''");
  }

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
  if (!salesColumns.some((column) => column.name === "branch")) {
    db.exec("ALTER TABLE sales ADD COLUMN branch TEXT NOT NULL DEFAULT 'carrizal'");
  }

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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at ON sales(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created_at ON inventory_movements(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_register_events_branch_shift_created_at ON register_events(branch, shift, created_at);
    CREATE INDEX IF NOT EXISTS idx_products_branch ON products(branch);
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

    if (ENABLE_DB_INSTALL_BACKUP && fs.existsSync(DB_PATH)) {
      backupPath = path.join(DATA_DIR, `cremaria-rincon.backup-${stamp}.sqlite`);
      await createDatabaseBackup(backupPath);
    }

    closeDatabaseConnection();
    connectionClosed = true;
    cleanupSqliteSidecars();
    fs.writeFileSync(DB_PATH, buffer);
    reloadDatabaseConnection();

    return {
      backupPath,
      installedAt: nowIso(),
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
  getTodayBounds,
};
