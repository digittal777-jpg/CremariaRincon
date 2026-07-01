const { getDb } = require("../db");
const {
  ALL_BRANCHES,
  createHttpError,
  getStoreDateKey,
  getStoreMonthRange,
  getStorePeriodRange,
  getStoreWeekRange,
  isStoreDateKeyInRange,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
  validateStoreDateKey,
} = require("../utils/helpers");

const db = getDb();

function safePercent(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
    return 0;
  }

  return roundMoney((top / bottom) * 100);
}

function resolveProfitabilityRange(options = {}) {
  const requestedPeriod = normalizeText(options.period || "today", 24).toLowerCase();
  const anchorDateKey = validateStoreDateKey(
    options.anchorDateKey || options.dateKey || getStoreDateKey(new Date()),
    "La fecha del reporte debe tener formato YYYY-MM-DD.",
  );

  if (requestedPeriod === "today" || requestedPeriod === "day" || requestedPeriod === "dia") {
    return {
      period: "today",
      anchorDateKey,
      startDateKey: anchorDateKey,
      endDateKey: anchorDateKey,
    };
  }

  if (requestedPeriod === "week" || requestedPeriod === "semana") {
    return {
      period: "week",
      ...getStoreWeekRange(anchorDateKey),
    };
  }

  if (requestedPeriod === "month" || requestedPeriod === "mes") {
    return {
      period: "month",
      ...getStoreMonthRange(anchorDateKey),
    };
  }

  if (requestedPeriod === "custom" || requestedPeriod === "rango") {
    const startDateKey = validateStoreDateKey(
      options.from || options.startDateKey || anchorDateKey,
      "La fecha inicial debe tener formato YYYY-MM-DD.",
    );
    const endDateKey = validateStoreDateKey(
      options.to || options.endDateKey || startDateKey,
      "La fecha final debe tener formato YYYY-MM-DD.",
    );
    if (startDateKey > endDateKey) {
      throw createHttpError("La fecha inicial no puede ser mayor a la fecha final.", 400);
    }

    return {
      period: "custom",
      anchorDateKey,
      startDateKey,
      endDateKey,
    };
  }

  const fallbackRange = getStorePeriodRange(requestedPeriod, anchorDateKey);
  return {
    period: fallbackRange.periodType || requestedPeriod,
    ...fallbackRange,
  };
}

function listProfitabilitySaleRows(branch, range) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        s.id AS sale_id,
        s.ticket_number,
        s.branch,
        s.total AS sale_total,
        s.created_at,
        si.product_id,
        si.product_name,
        si.quantity,
        si.unit_price,
        si.line_total,
        si.unit_cost,
        si.line_cost,
        si.gross_profit,
        si.cost_status
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ORDER BY s.created_at DESC, si.id DESC
    `).all()
    : db.prepare(`
      SELECT
        s.id AS sale_id,
        s.ticket_number,
        s.branch,
        s.total AS sale_total,
        s.created_at,
        si.product_id,
        si.product_name,
        si.quantity,
        si.unit_price,
        si.line_total,
        si.unit_cost,
        si.line_cost,
        si.gross_profit,
        si.cost_status
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.branch = ?
      ORDER BY s.created_at DESC, si.id DESC
    `).all(normalizedBranch);

  return rows.filter((row) => {
    const rowDateKey = getStoreDateKey(row.created_at);
    return isStoreDateKeyInRange(rowDateKey, range.startDateKey, range.endDateKey);
  });
}

function getInventoryValuation(branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const row = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        COALESCE(SUM(stock * price), 0) AS sale_value,
        COALESCE(SUM(stock * COALESCE(cost, 0)), 0) AS cost_value,
        COALESCE(SUM(CASE WHEN COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products_count,
        COALESCE(SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products_count,
        COALESCE(AVG(CASE WHEN price > 0 AND COALESCE(cost, 0) > 0 THEN ((price - cost) / price) * 100 ELSE NULL END), 0) AS average_margin_percent
      FROM products
      WHERE active = 1
    `).get()
    : db.prepare(`
      SELECT
        COALESCE(SUM(stock * price), 0) AS sale_value,
        COALESCE(SUM(stock * COALESCE(cost, 0)), 0) AS cost_value,
        COALESCE(SUM(CASE WHEN COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products_count,
        COALESCE(SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products_count,
        COALESCE(AVG(CASE WHEN price > 0 AND COALESCE(cost, 0) > 0 THEN ((price - cost) / price) * 100 ELSE NULL END), 0) AS average_margin_percent
      FROM products
      WHERE active = 1 AND branch = ?
    `).get(normalizedBranch);

  return {
    saleValue: roundMoney(row.sale_value),
    costValue: roundMoney(row.cost_value),
    missingCostProductsCount: Number(row.missing_cost_products_count || 0),
    negativeStockProductsCount: Number(row.negative_stock_products_count || 0),
    averageMarginPercent: roundMoney(row.average_margin_percent),
  };
}

function listMissingCostProducts(branch = ALL_BRANCHES, limit = 25) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 25)));
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT id, name, branch, price, cost, stock
      FROM products
      WHERE active = 1 AND COALESCE(cost, 0) <= 0
      ORDER BY branch, name COLLATE NOCASE
      LIMIT ?
    `).all(safeLimit)
    : db.prepare(`
      SELECT id, name, branch, price, cost, stock
      FROM products
      WHERE active = 1 AND branch = ? AND COALESCE(cost, 0) <= 0
      ORDER BY name COLLATE NOCASE
      LIMIT ?
    `).all(normalizedBranch, safeLimit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    branch: row.branch,
    price: roundMoney(row.price),
    cost: roundMoney(row.cost || 0),
    stock: roundStock(row.stock || 0),
  }));
}

function getProfitabilityReport(options = {}) {
  const normalizedBranch = normalizeBranch(options.branch || ALL_BRANCHES, { allowAll: true });
  const range = resolveProfitabilityRange(options);
  const rows = listProfitabilitySaleRows(normalizedBranch, range);
  const tickets = new Set();
  const products = new Map();
  let salesTotal = 0;
  let knownSalesTotal = 0;
  let knownCostTotal = 0;
  let grossProfit = 0;
  let itemCount = 0;
  let knownLineCount = 0;
  let missingCostLineCount = 0;
  let estimatedCostLineCount = 0;
  let unknownCostSalesTotal = 0;

  rows.forEach((row) => {
    tickets.add(row.sale_id);
    const lineTotal = roundMoney(row.line_total);
    const quantity = roundStock(row.quantity);
    const lineCost = row.line_cost == null ? null : roundMoney(row.line_cost);
    const lineProfit = row.gross_profit == null ? null : roundMoney(row.gross_profit);
    const costStatus = row.cost_status || "unknown";
    const hasReliableCost = lineCost != null && lineProfit != null && costStatus !== "missing_cost";
    salesTotal = roundMoney(salesTotal + lineTotal);
    itemCount = roundStock(itemCount + quantity);

    if (hasReliableCost) {
      knownSalesTotal = roundMoney(knownSalesTotal + lineTotal);
      knownCostTotal = roundMoney(knownCostTotal + lineCost);
      grossProfit = roundMoney(grossProfit + lineProfit);
      knownLineCount += 1;
      if (costStatus === "estimated_current_cost") {
        estimatedCostLineCount += 1;
      }
    } else {
      missingCostLineCount += 1;
      unknownCostSalesTotal = roundMoney(unknownCostSalesTotal + lineTotal);
    }

    const productKey = `${row.product_id || "unknown"}:${row.product_name}`;
    const product = products.get(productKey) || {
      productId: row.product_id,
      productName: row.product_name,
      branch: row.branch,
      quantity: 0,
      salesTotal: 0,
      lineCost: 0,
      grossProfit: 0,
      knownLineCount: 0,
      missingCostLineCount: 0,
    };
    product.quantity = roundStock(product.quantity + quantity);
    product.salesTotal = roundMoney(product.salesTotal + lineTotal);
    if (hasReliableCost) {
      product.lineCost = roundMoney(product.lineCost + lineCost);
      product.grossProfit = roundMoney(product.grossProfit + lineProfit);
      product.knownLineCount += 1;
    } else {
      product.missingCostLineCount += 1;
    }
    products.set(productKey, product);
  });

  const productSummaries = [...products.values()].map((product) => ({
    ...product,
    marginPercent: safePercent(product.grossProfit, product.salesTotal),
    costStatus: product.missingCostLineCount > 0
      ? "incomplete"
      : "known",
  }));

  const topProfitProducts = productSummaries
    .filter((product) => product.knownLineCount > 0)
    .sort((left, right) => right.grossProfit - left.grossProfit)
    .slice(0, 10);

  const lowMarginProducts = productSummaries
    .filter((product) => product.knownLineCount > 0 && product.marginPercent < 20)
    .sort((left, right) => left.marginPercent - right.marginPercent)
    .slice(0, 10);

  return {
    branch: normalizedBranch,
    period: range.period,
    anchorDateKey: range.anchorDateKey,
    startDateKey: range.startDateKey,
    endDateKey: range.endDateKey,
    totals: {
      tickets: tickets.size,
      lineCount: rows.length,
      knownLineCount,
      missingCostLineCount,
      estimatedCostLineCount,
      itemCount: roundStock(itemCount),
      salesTotal: roundMoney(salesTotal),
      knownSalesTotal: roundMoney(knownSalesTotal),
      knownCostTotal: roundMoney(knownCostTotal),
      grossProfit: roundMoney(grossProfit),
      marginPercent: safePercent(grossProfit, knownSalesTotal),
      unknownCostSalesTotal: roundMoney(unknownCostSalesTotal),
      isIncomplete: missingCostLineCount > 0 || unknownCostSalesTotal > 0,
      hasEstimatedCosts: estimatedCostLineCount > 0,
    },
    inventory: getInventoryValuation(normalizedBranch),
    topProfitProducts,
    lowMarginProducts,
    missingCostProducts: listMissingCostProducts(normalizedBranch, options.missingCostLimit || 25),
  };
}

module.exports = {
  getInventoryValuation,
  getProfitabilityReport,
  listMissingCostProducts,
  resolveProfitabilityRange,
};
