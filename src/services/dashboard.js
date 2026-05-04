const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
  SALES_PULSE_END_HOUR,
  SALES_PULSE_START_HOUR,
  getBranchLabel,
  normalizeBranch,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

const { listProducts, getProductById } = require("./products");
const { listStoreDaySales, listStoreDaySaleItems, getRecentSales } = require("./sales");
const { getRecentInventoryMovements } = require("./inventory");
const { getRecentRegisterEvents, getRegisterSummary } = require("./register");

function getSummary(branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const todaySales = listStoreDaySales(new Date(), branch);
  const todaySaleItems = listStoreDaySaleItems(new Date(), branch);

  const inventoryTotals = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        COUNT(*) AS catalogSize,
        COALESCE(SUM(stock * price), 0) AS inventoryValue
      FROM products
      WHERE active = 1
    `).get()
    : db.prepare(`
      SELECT
        COUNT(*) AS catalogSize,
        COALESCE(SUM(stock * price), 0) AS inventoryValue
      FROM products
      WHERE active = 1 AND branch = ?
    `).get(normalizedBranch);

  const lowStockCount = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE active = 1 AND stock_initialized = 1 AND stock <= min_stock
    `).get().count
    : db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE active = 1 AND branch = ? AND stock_initialized = 1 AND stock <= min_stock
    `).get(normalizedBranch).count;
  const productTotals = new Map();

  todaySaleItems.forEach((item) => {
    const currentValue = productTotals.get(item.product_name) || 0;
    productTotals.set(
      item.product_name,
      roundMoney(currentValue + roundMoney(item.line_total)),
    );
  });

  const topProductEntry = [...productTotals.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];
  const ticketsToday = todaySales.length;
  const revenueToday = roundMoney(
    todaySales.reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const unitsSoldToday = roundStock(
    todaySales.reduce((sum, sale) => sum + roundStock(sale.item_count), 0),
  );

  return {
    ticketsToday,
    revenueToday,
    averageTicket: roundMoney(revenueToday / Math.max(ticketsToday, 1)),
    unitsSoldToday,
    catalogSize: Number(inventoryTotals.catalogSize || 0),
    inventoryValue: roundMoney(inventoryTotals.inventoryValue),
    lowStockCount: Number(lowStockCount || 0),
    topProduct: topProductEntry
      ? {
          name: topProductEntry[0],
          total: roundMoney(topProductEntry[1]),
        }
      : null,
  };
}

function getLowStockProducts(branch = "carrizal", limit = 8) {
  const normalizedBranch = normalizeBranch(branch);
  const rows = db.prepare(`
    SELECT
      id,
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      stock_initialized,
      active,
      display_order,
      branch
    FROM products
    WHERE active = 1 AND branch = ? AND stock_initialized = 1 AND stock <= min_stock
    ORDER BY stock ASC, min_stock DESC, name COLLATE NOCASE
    LIMIT ?
  `).all(normalizedBranch, limit);

  const { mapProduct } = require("../utils/helpers");
  return rows.map(mapProduct);
}

function getSalesByHour(branch = STORE_BRANCHES[0]) {
  const salesByHourMap = new Map();

  listStoreDaySales(new Date(), branch).forEach((sale) => {
    const storeHourFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: STORE_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    });
    const hourSlot = `${storeHourFormatter.format(new Date(sale.created_at))}:00`;
    const currentValue = salesByHourMap.get(hourSlot) || 0;
    salesByHourMap.set(hourSlot, roundMoney(currentValue + roundMoney(sale.total)));
  });

  const slots = [];
  for (let hour = SALES_PULSE_START_HOUR; hour <= SALES_PULSE_END_HOUR; hour += 1) {
    const label = `${String(hour).padStart(2, "0")}:00`;
    slots.push({
      label,
      total: salesByHourMap.get(label) || 0,
    });
  }

  return slots;
}

function getShiftSummary(branch = STORE_BRANCHES[0]) {
  const rowMap = new Map();

  listStoreDaySales(new Date(), branch).forEach((sale) => {
    const currentValue = rowMap.get(sale.shift) || {
      shift: sale.shift,
      tickets: 0,
      total: 0,
    };
    currentValue.tickets += 1;
    currentValue.total = roundMoney(currentValue.total + roundMoney(sale.total));
    rowMap.set(sale.shift, currentValue);
  });

  return STORE_SHIFTS.map((shift) =>
    rowMap.get(shift) || {
      shift,
      tickets: 0,
      total: 0,
    },
  );
}

function getRecentActivity(limit = 18, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const sales = getRecentSales(limit, normalizedBranch).map((sale) => ({
    kind: "sale",
    id: sale.id,
    createdAt: sale.createdAt,
    title: sale.ticketNumber,
    subtitle: `${getBranchLabel(sale.branch)} - ${sale.cashier} - ${sale.shift}`,
    amount: sale.total,
    amountPrefix: "",
    tag: "Venta",
  }));

  const registerEvents = (normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        counted_amount,
        difference_amount,
        created_at
      FROM register_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        counted_amount,
        difference_amount,
        created_at
      FROM register_events
      WHERE branch = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizedBranch, limit)).map((event) => {
    const { getRegisterEventTypeLabel } = require("../utils/helpers");
    return {
      kind: "register",
      id: event.id,
      createdAt: event.created_at,
      title: getRegisterEventTypeLabel(event.event_type),
      subtitle: `${getBranchLabel(event.branch)} - ${event.shift} - ${event.cashier}`,
      amount: event.counted_amount,
      amountPrefix: "",
      tag: "Caja",
      differenceAmount: roundMoney(event.difference_amount),
    };
  });

  const inventoryMovements = getRecentInventoryMovements(limit, normalizedBranch).map((movement) => {
    const { getInventoryMovementTypeLabel } = require("../utils/helpers");
    return {
      kind: "inventory",
      id: movement.id,
      createdAt: movement.createdAt,
      title: movement.productName,
      subtitle: `${getBranchLabel(movement.branch)} - ${getInventoryMovementTypeLabel(movement.movementType)}`,
      amount: Math.abs(roundStock(movement.quantityDelta)),
      amountPrefix: roundStock(movement.quantityDelta) >= 0 ? "+" : "-",
      tag: "Inventario",
    };
  });

  return [...sales, ...registerEvents, ...inventoryMovements]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);
}

function getDashboardSnapshot(branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const snapshot = {
    store: {
      name: STORE_NAME,
      timezone: STORE_TIME_ZONE,
      shifts: STORE_SHIFTS,
      branches: [
        { value: ALL_BRANCHES, label: getBranchLabel(ALL_BRANCHES) },
        ...STORE_BRANCHES.map((branchCode) => ({
          value: branchCode,
          label: getBranchLabel(branchCode),
        })),
      ],
      currentBranch: normalizedBranch,
      currentBranchLabel: getBranchLabel(normalizedBranch),
      salesPulse: {
        startHour: SALES_PULSE_START_HOUR,
        endHour: SALES_PULSE_END_HOUR,
      },
    },
    summary: getSummary(normalizedBranch),
    products: listProducts(normalizedBranch),
    lowStock: getLowStockProducts(normalizedBranch),
    recentSales: getRecentSales(8, normalizedBranch),
    recentActivity: getRecentActivity(18, normalizedBranch),
    salesByHour: getSalesByHour(normalizedBranch),
    shiftSummary: getShiftSummary(normalizedBranch),
    generatedAt: nowIso(),
  };

  // Si se solicita "all" (todas las sucursales), incluir inventarios comparativos
  if (normalizedBranch === ALL_BRANCHES) {
    snapshot.inventoryComparison = {
      branches: STORE_BRANCHES.map((branchCode) => ({
        value: branchCode,
        label: getBranchLabel(branchCode),
        products: listProducts(branchCode),
      })),
    };
  }

  return snapshot;
}

module.exports = {
  getDashboardSnapshot,
  getLowStockProducts,
  getRecentActivity,
  getSalesByHour,
  getShiftSummary,
  getSummary,
};