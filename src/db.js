const fs = require("node:fs");

const Database = require("better-sqlite3");

const { DATA_DIR, DB_PATH } = require("./config");

let databaseInstance;

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pza',
      type_code TEXT,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      stock_initialized INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);
    CREATE INDEX IF NOT EXISTS idx_register_events_shift_created_at ON register_events(shift, created_at);
  `);

  const productColumns = db.prepare("PRAGMA table_info(products)").all();
  if (!productColumns.some((column) => column.name === "stock_initialized")) {
    db.exec("ALTER TABLE products ADD COLUMN stock_initialized INTEGER NOT NULL DEFAULT 0");
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at ON sales(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created_at ON inventory_movements(branch, created_at);
    CREATE INDEX IF NOT EXISTS idx_register_events_branch_shift_created_at ON register_events(branch, shift, created_at);
  `);
}

function getDb() {
  if (!databaseInstance) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    databaseInstance = new Database(DB_PATH);
    databaseInstance.pragma("journal_mode = WAL");
    databaseInstance.pragma("foreign_keys = ON");
    databaseInstance.pragma("synchronous = NORMAL");
    initializeSchema(databaseInstance);
  }

  return databaseInstance;
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
  getDb,
  nowIso,
  getTodayBounds,
};
