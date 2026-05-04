const {
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
  STORE_BRANCHES,
  STORE_BRANCH_LABELS,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
} = require("../config");
const { getDb, nowIso } = require("../db");

const db = getDb();

const CATEGORY_ORDER = ["quesos", "carnes", "piezas", "general"];
const CATEGORY_LABELS = {
  quesos: "Quesos",
  carnes: "Carnes",
  piezas: "Piezas",
  general: "General",
};
const storeDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const storeHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: STORE_TIME_ZONE,
  hour: "2-digit",
  hour12: false,
});
const ALL_BRANCHES = "all";

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function normalizeBranch(branch, options = {}) {
  const normalizedBranch = normalizeText(branch || "", 24).toLowerCase();
  if (options.allowAll && normalizedBranch === ALL_BRANCHES) {
    return ALL_BRANCHES;
  }

  if (STORE_BRANCHES.includes(normalizedBranch)) {
    return normalizedBranch;
  }

  return options.fallback || STORE_BRANCHES[0];
}

function getBranchLabel(branch) {
  if (branch === ALL_BRANCHES) {
    return "Todas las sucursales";
  }

  return STORE_BRANCH_LABELS[branch] || branch;
}

function isAllBranches(branch) {
  return normalizeBranch(branch, { allowAll: true }) === ALL_BRANCHES;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundStock(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

function getStoreDateParts(value = new Date()) {
  return Object.fromEntries(
    storeDatePartsFormatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function getStoreDateKey(value = new Date()) {
  const parts = getStoreDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isSameStoreDay(value, baseDate = new Date()) {
  return getStoreDateKey(value) === getStoreDateKey(baseDate);
}

function getStoreHourLabel(value) {
  return `${storeHourFormatter.format(new Date(value))}:00`;
}

function normalizeText(value, maxLength = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function getStockStatus(stock, minStock, stockInitialized) {
  if (!stockInitialized) {
    return "capture";
  }

  if (stock <= 0) {
    return "empty";
  }

  if (stock <= minStock) {
    return "low";
  }

  return "ok";
}

function mapProduct(row) {
  const stock = roundStock(row.stock);
  const minStock = roundStock(row.min_stock);

  return {
    id: row.id,
    name: row.name,
    price: roundMoney(row.price),
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || "General",
    unit: row.unit,
    typeCode: row.type_code || null,
    stock,
    minStock,
    stockInitialized: Boolean(row.stock_initialized),
    active: Boolean(row.active),
    displayOrder: row.display_order,
    branch: row.branch || "carrizal",
    status: getStockStatus(stock, minStock, row.stock_initialized),
  };
}

function buildTicketPrefix(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `RIN-${year}${month}${day}`;
}

function getRegisterEventTypeLabel(eventType) {
  if (eventType === "start") {
    return "Inicio de caja";
  }

  if (eventType === "quick_cut") {
    return "Corte rapido";
  }

  if (eventType === "final_cut") {
    return "Corte final";
  }

  return "Movimiento de caja";
}

function getInventoryMovementTypeLabel(movementType) {
  if (movementType === "sale") {
    return "Venta";
  }

  if (movementType === "initial") {
    return "Inventario inicial";
  }

  if (movementType === "supplier") {
    return "Entrada proveedor";
  }

  if (movementType === "supplier_out") {
    return "Salida proveedor";
  }

  if (movementType === "adjustment") {
    return "Ajuste manual";
  }

  return "Movimiento";
}

module.exports = {
  ALL_BRANCHES,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  STORE_BRANCHES,
  STORE_BRANCH_LABELS,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
  SALES_PULSE_END_HOUR,
  SALES_PULSE_START_HOUR,
  buildTicketPrefix,
  createHttpError,
  getBranchLabel,
  getInventoryMovementTypeLabel,
  getRegisterEventTypeLabel,
  getSetting,
  getStockStatus,
  getStoreDateKey,
  getStoreDateParts,
  getStoreHourLabel,
  isAllBranches,
  isSameStoreDay,
  mapProduct,
  normalizeBranch,
  normalizeText,
  nowIso,
  roundMoney,
  roundStock,
  toNumber,
};
