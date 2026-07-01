const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

function runIsolatedProjectScript(source) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: ROOT_DIR,
    env: process.env,
    encoding: "utf8",
    timeout: 120000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(String(result.stdout || "{}").trim() || "{}");
}

test("sales capture line cost snapshots and profitability reports reliable gross profit", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-profit-sale-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb, nowIso } = require("./src/db");
    const services = require("./src/services");

    const db = getDb();
    const now = nowIso();
    const productInsert = db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES ('Queso rentable', 20, 12, 'general', 'pza', 4, 2, 10, 0, 1, 1, 0, 'carrizal', ?, ?)
    \`).run(now, now);
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES ('Producto sin costo', 8, 0, 'general', 'pza', 4, 2, -1, 0, 1, 1, 1, 'carrizal', ?, ?)
    \`).run(now, now);

    const productId = Number(productInsert.lastInsertRowid);
    const sale = services.createSale({
      shift: "Tarde",
      cashier: "Ana",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 40,
      items: [{
        productId,
        productName: "Queso rentable",
        quantity: 2,
        unitPrice: 20,
        lineTotal: 40,
      }],
    });
    const line = db.prepare("SELECT unit_cost, line_cost, gross_profit, cost_status FROM sale_items WHERE sale_id = ?").get(sale.id);
    const report = services.getProfitabilityReport({ period: "today", branch: "carrizal" });
    const summary = services.getDashboardSnapshot("carrizal").summary;

    console.log(JSON.stringify({ line, report, summary }));
  `);

  assert.equal(payload.line.unit_cost, 12);
  assert.equal(payload.line.line_cost, 24);
  assert.equal(payload.line.gross_profit, 16);
  assert.equal(payload.line.cost_status, "captured");
  assert.equal(payload.report.totals.salesTotal, 40);
  assert.equal(payload.report.totals.knownCostTotal, 24);
  assert.equal(payload.report.totals.grossProfit, 16);
  assert.equal(payload.report.totals.marginPercent, 40);
  assert.equal(payload.summary.inventorySaleValue, 152);
  assert.equal(payload.summary.inventoryCostValue, 96);
  assert.equal(payload.summary.missingCostProductsCount, 1);
  assert.equal(payload.summary.negativeStockProductsCount, 1);
});

test("legacy sale_items migrate with estimated current cost and missing cost status", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const Database = require("better-sqlite3");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-profit-migration-"));
    const dbPath = path.join(tempDir, "legacy.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(\`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        category TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'pza',
        category_id INTEGER,
        unit_id INTEGER,
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
      CREATE TABLE sales (
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
        item_count REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sale_items (
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
    \`);
    legacy.prepare("INSERT INTO products (id, name, price, cost, category, unit, stock, min_stock, stock_initialized, active, branch, created_at, updated_at) VALUES (1, 'Con costo', 10, 6, 'general', 'pza', 5, 0, 1, 1, 'carrizal', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z')").run();
    legacy.prepare("INSERT INTO products (id, name, price, cost, category, unit, stock, min_stock, stock_initialized, active, branch, created_at, updated_at) VALUES (2, 'Sin costo', 10, 0, 'general', 'pza', 5, 0, 1, 1, 'carrizal', '2026-06-01T12:00:00.000Z', '2026-06-01T12:00:00.000Z')").run();
    legacy.prepare("INSERT INTO sales (id, ticket_number, shift, cashier, branch, payment_method, subtotal, total, received_amount, change_amount, item_count, created_at) VALUES (1, 'LEG-1', 'Tarde', 'Ana', 'carrizal', 'Efectivo', 30, 30, 30, 0, 3, '2026-06-01T12:00:00.000Z')").run();
    legacy.prepare("INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total, stock_before, stock_after) VALUES (1, 1, 'Con costo', 2, 10, 20, 5, 3)").run();
    legacy.prepare("INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total, stock_before, stock_after) VALUES (1, 2, 'Sin costo', 1, 10, 10, 5, 4)").run();
    legacy.close();

    process.env.POS_DB_PATH = dbPath;
    const { getDb } = require("./src/db");
    const db = getDb();
    const rows = db.prepare("SELECT product_id, unit_cost, line_cost, gross_profit, cost_status FROM sale_items ORDER BY product_id").all();
    console.log(JSON.stringify({ rows }));
  `);

  assert.deepEqual(payload.rows, [
    {
      product_id: 1,
      unit_cost: 6,
      line_cost: 12,
      gross_profit: 8,
      cost_status: "estimated_current_cost",
    },
    {
      product_id: 2,
      unit_cost: 0,
      line_cost: null,
      gross_profit: null,
      cost_status: "missing_cost",
    },
  ]);
});

test("subscription, error reports and support health stay advisory", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-support-health-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb, nowIso } = require("./src/db");
    const services = require("./src/services");

    const db = getDb();
    const now = nowIso();
    const productInsert = db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES ('Producto salud', 15, 9, 'general', 'pza', 4, 2, 5, 0, 1, 1, 0, 'carrizal', ?, ?)
    \`).run(now, now);
    services.createSale({
      shift: "Tarde",
      cashier: "Soporte",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 15,
      items: [{
        productId: Number(productInsert.lastInsertRowid),
        productName: "Producto salud",
        quantity: 1,
        unitPrice: 15,
        lineTotal: 15,
      }],
    });
    const paymentBundle = services.recordServiceSubscriptionPayment({
      amount: 250,
      paymentMethod: "Transferencia",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    const error = services.recordAppErrorReport({
      source: "frontend",
      message: "Error de prueba soporte",
      url: "/admin",
      role: "admin",
    });
    const health = services.getSupportHealthReport({ branch: "carrizal" });

    console.log(JSON.stringify({
      paymentBundle,
      error,
      health,
    }));
  `);

  assert.equal(payload.paymentBundle.subscription.status, "active");
  assert.equal(payload.paymentBundle.subscription.blocksOperation, false);
  assert.equal(payload.paymentBundle.payment.amount, 250);
  assert.equal(payload.error.message, "Error de prueba soporte");
  assert.equal(payload.health.latestSale.ticketNumber.startsWith("RIN-") || payload.health.latestSale.ticketNumber.startsWith("POS-"), true);
  assert.equal(payload.health.counts.tickets, 1);
  assert.equal(payload.health.recentErrors[0].message, "Error de prueba soporte");
  assert.equal(payload.health.database.bytes > 0, true);
});
