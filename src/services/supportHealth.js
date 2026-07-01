const fs = require("node:fs");

const { DB_PATH } = require("../config");
const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  getStoreDateKey,
  isSameStoreDay,
  normalizeBranch,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { getBackupStatusBundle, getClientSyncHealthSummary } = require("./backups");
const { listAppErrorReports } = require("./errorReports");

const db = getDb();

function getDatabaseSize() {
  try {
    const stats = fs.statSync(DB_PATH);
    return {
      path: DB_PATH,
      bytes: stats.size,
      mb: roundMoney(stats.size / 1024 / 1024),
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch (_error) {
    return {
      path: DB_PATH,
      bytes: 0,
      mb: 0,
      modifiedAt: null,
    };
  }
}

function getLatestSale(branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const row = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT id, ticket_number, branch, cashier, total, item_count, created_at
      FROM sales
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get()
    : db.prepare(`
      SELECT id, ticket_number, branch, cashier, total, item_count, created_at
      FROM sales
      WHERE branch = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(normalizedBranch);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    branch: row.branch,
    cashier: row.cashier,
    total: roundMoney(row.total),
    itemCount: roundStock(row.item_count || 0),
    createdAt: row.created_at,
  };
}

function getOperationalCounts(branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const productRow = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        COUNT(*) AS products,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_products,
        COALESCE(SUM(CASE WHEN active = 1 AND COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products,
        COALESCE(SUM(CASE WHEN active = 1 AND stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products
      FROM products
    `).get()
    : db.prepare(`
      SELECT
        COUNT(*) AS products,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_products,
        COALESCE(SUM(CASE WHEN active = 1 AND COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products,
        COALESCE(SUM(CASE WHEN active = 1 AND stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products
      FROM products
      WHERE branch = ?
    `).get(normalizedBranch);

  const salesRows = normalizedBranch === ALL_BRANCHES
    ? db.prepare("SELECT id, created_at FROM sales").all()
    : db.prepare("SELECT id, created_at FROM sales WHERE branch = ?").all(normalizedBranch);
  const today = new Date();

  return {
    products: Number(productRow.products || 0),
    activeProducts: Number(productRow.active_products || 0),
    missingCostProducts: Number(productRow.missing_cost_products || 0),
    negativeStockProducts: Number(productRow.negative_stock_products || 0),
    tickets: salesRows.length,
    ticketsToday: salesRows.filter((row) => isSameStoreDay(row.created_at, today)).length,
    todayDateKey: getStoreDateKey(today),
  };
}

function getSupportHealthReport(options = {}) {
  const branch = normalizeBranch(options.branch || ALL_BRANCHES, { allowAll: true });
  const backupStatus = getBackupStatusBundle();
  const packageInfo = require("../../package.json");

  return {
    branch,
    generatedAt: nowIso(),
    app: {
      name: packageInfo.name || "cremeria-rincon",
      version: packageInfo.version || "0.0.0",
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
    },
    database: getDatabaseSize(),
    latestSale: getLatestSale(branch),
    counts: getOperationalCounts(branch),
    backups: {
      enabled: backupStatus.enabled,
      storage: backupStatus.storage,
      lastRun: backupStatus.lastRun,
      recentRuns: backupStatus.recentRuns,
    },
    syncHealth: getClientSyncHealthSummary({ branch }),
    recentErrors: listAppErrorReports({ limit: Number(options.errorLimit || 10) }),
  };
}

module.exports = {
  getSupportHealthReport,
};
