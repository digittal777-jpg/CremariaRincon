const ExcelJS = require("exceljs");
const {
  EXPORT_LOOKBACK_DAYS,
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
  STORE_NAME,
  STORE_TIME_ZONE,
} = require("../config");
const {
  ALL_BRANCHES,
  createHttpError,
  STORE_BRANCHES,
  getBranchLabel,
  getStoreDateKey,
  getStoreHourLabel,
  isSameStoreDay,
  normalizeBranch,
  nowIso,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { listAllProductsForExport } = require("./products");
const { listInventoryMovementsForExport } = require("./inventory");
const { listRegisterEventsForExport } = require("./register");
const { listSalesForExport } = require("./sales");

function styleSheetHeader(sheet, title, subtitle, mergeTo = 8) {
  const endCol = String.fromCharCode(64 + mergeTo);
  sheet.mergeCells(`A1:${endCol}1`);
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "B44C59" } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  sheet.mergeCells(`A2:${endCol}2`);
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF6B5C50" } };
  sheet.getCell("A2").alignment = { vertical: "middle", horizontal: "center" };
}

function styleTableHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "68836D" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function autoFitColumns(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function filterByScope(rows, scope, baseDate, dateField = "created_at") {
  if (scope === "all-time") {
    return rows;
  }
  return rows.filter((row) => isSameStoreDay(row[dateField], baseDate));
}

function createStoreDateFromKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
  if (!match) {
    throw createHttpError("La fecha para exportar no tiene un formato valido.", 400);
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
}

function getPreviousStoreDateKey(baseDate = new Date(), daysBack = 0) {
  const anchor = new Date(baseDate);
  anchor.setUTCDate(anchor.getUTCDate() - daysBack);
  return getStoreDateKey(anchor);
}

function resolveExportBaseDate(rawBaseDate, scope) {
  const today = new Date();
  if (scope === "all-time") {
    return {
      baseDate: rawBaseDate ? createStoreDateFromKey(rawBaseDate) : today,
      exportDateKey: null,
      scopeLabel: "Historico completo",
    };
  }

  const todayKey = getStoreDateKey(today);
  const oldestAllowedKey = getPreviousStoreDateKey(today, EXPORT_LOOKBACK_DAYS);
  const selectedKey = rawBaseDate ? String(rawBaseDate).trim() : todayKey;

  if (selectedKey > todayKey) {
    throw createHttpError("Solo puedes exportar la fecha de hoy o dias anteriores.", 400);
  }

  if (selectedKey < oldestAllowedKey) {
    throw createHttpError(
      `Solo puedes exportar dentro de los ultimos ${EXPORT_LOOKBACK_DAYS} dias.`,
      400,
    );
  }

  return {
    baseDate: createStoreDateFromKey(selectedKey),
    exportDateKey: selectedKey,
    scopeLabel: `Dia ${selectedKey}`,
  };
}

function getBar(total, maxTotal) {
  if (maxTotal <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((total / maxTotal) * 20)));
}

const reportDateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatReportDateTime(value) {
  return reportDateTimeFormatter.format(new Date(value));
}

function addSummarySheet(workbook, ctx, branchCode, suffix = "") {
  const branchLabel = getBranchLabel(branchCode);
  const sheet = workbook.addWorksheet(`Resumen${suffix}`);
  styleSheetHeader(
    sheet,
    `${STORE_NAME} - Resumen ${branchLabel}`,
    `Generado: ${ctx.generatedAt} · Alcance: ${ctx.scopeLabel}`,
    6,
  );
  sheet.addRow([]);
  const header = sheet.addRow(["Indicador", "Valor"]);
  styleTableHeader(header);

  const sales = ctx.salesHeaders;
  const salesItems = ctx.salesItems;
  const registerEvents = ctx.registerEvents;
  const products = ctx.products.filter((p) => p.active);
  const totalSales = roundMoney(sales.reduce((sum, row) => sum + roundMoney(row.total), 0));
  const cashSales = roundMoney(
    sales
      .filter((row) => row.payment_method === "Efectivo")
      .reduce((sum, row) => sum + roundMoney(row.total), 0),
  );
  const nonCashSales = roundMoney(totalSales - cashSales);
  const totalWithdrawals = roundMoney(
    registerEvents.reduce((sum, row) => sum + roundMoney(row.withdrawals_amount || 0), 0),
  );
  const inventoryValue = roundMoney(
    products.reduce((sum, row) => sum + roundMoney(roundStock(row.stock) * roundMoney(row.price)), 0),
  );
  const byProduct = new Map();
  salesItems.forEach((row) => {
    const current = byProduct.get(row.product_name) || 0;
    byProduct.set(row.product_name, roundMoney(current + roundMoney(row.line_total)));
  });
  const topProduct = [...byProduct.entries()].sort((a, b) => b[1] - a[1])[0];
  const expectedCut = roundMoney(cashSales - totalWithdrawals);

  [
    ["Tickets", sales.length],
    ["Ventas totales", totalSales],
    ["Ventas efectivo", cashSales],
    ["Ventas no efectivo", nonCashSales],
    ["Unidades vendidas", roundStock(salesItems.reduce((sum, row) => sum + roundStock(row.quantity), 0))],
    ["Retiros acumulados", totalWithdrawals],
    ["Efectivo esperado (sin apertura)", expectedCut],
    ["Cortes rapidos", registerEvents.filter((row) => row.event_type === "quick_cut").length],
    ["Cortes finales", registerEvents.filter((row) => row.event_type === "final_cut").length],
    ["Movimientos inventario", ctx.movements.length],
    ["Productos activos", products.length],
    ["Inventario valorizado", inventoryValue],
    ["Producto top", topProduct ? `${topProduct[0]} (${roundMoney(topProduct[1])})` : "Sin ventas"],
  ].forEach((entry) => sheet.addRow(entry));

  sheet.addRow([]);
  const shiftHeader = sheet.addRow(["Turno", "Tickets", "Total"]);
  styleTableHeader(shiftHeader);
  const shiftMap = new Map();
  sales.forEach((sale) => {
    const current = shiftMap.get(sale.shift) || { tickets: 0, total: 0 };
    current.tickets += 1;
    current.total = roundMoney(current.total + roundMoney(sale.total));
    shiftMap.set(sale.shift, current);
  });
  [...shiftMap.entries()].forEach(([shift, values]) => {
    sheet.addRow([shift, values.tickets, values.total]);
  });

  autoFitColumns(sheet, [34, 20, 14, 14, 14, 14]);
}

function addSalesDetailSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Ventas Detalle${suffix}`);
  styleSheetHeader(sheet, `${STORE_NAME} - Ventas detalle${suffix}`, `Generado: ${ctx.generatedAt}`, 15);
  sheet.addRow([]);
  const header = sheet.addRow([
    "Ticket",
    "Fecha",
    "Sucursal",
    "Turno",
    "Cajero",
    "Metodo",
    "Producto",
    "Cantidad",
    "Precio Unit",
    "Total Linea",
    "Stock Antes",
    "Delta",
    "Stock Despues",
    "Delta real",
    "Cuadra",
  ]);
  styleTableHeader(header);

  ctx.salesItems.forEach((row) => {
    const realDelta = roundStock(roundStock(row.stock_after) - roundStock(row.stock_before));
    const declaredDelta = roundStock(-roundStock(row.quantity));
    const match = Math.abs(realDelta - declaredDelta) <= 0.001 ? "OK" : "REVISAR";
    sheet.addRow([
      row.ticket_number,
      formatReportDateTime(row.created_at),
      getBranchLabel(saleBranchForExport(row)),
      row.shift,
      row.cashier,
      row.payment_method,
      row.product_name,
      roundStock(row.quantity),
      roundMoney(row.unit_price),
      roundMoney(row.line_total),
      roundStock(row.stock_before),
      declaredDelta,
      roundStock(row.stock_after),
      realDelta,
      match,
    ]);
  });

  autoFitColumns(sheet, [18, 22, 14, 12, 16, 14, 24, 11, 12, 12, 12, 10, 12, 11, 10]);
}

function addSalesProductsSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Ventas Productos${suffix}`);
  styleSheetHeader(sheet, `${STORE_NAME} - Ventas por producto${suffix}`, `Generado: ${ctx.generatedAt}`, 8);
  sheet.addRow([]);
  const header = sheet.addRow([
    "Producto",
    "Ventas",
    "Cantidad",
    "Ingreso",
    "Precio promedio",
    "% del total",
    "Grafica",
  ]);
  styleTableHeader(header);

  const grouped = new Map();
  ctx.salesItems.forEach((row) => {
    const current = grouped.get(row.product_name) || {
      tickets: new Set(),
      qty: 0,
      total: 0,
    };
    current.tickets.add(row.ticket_number);
    current.qty = roundStock(current.qty + roundStock(row.quantity));
    current.total = roundMoney(current.total + roundMoney(row.line_total));
    grouped.set(row.product_name, current);
  });

  const lines = [...grouped.entries()]
    .map(([product, row]) => ({
      product,
      tickets: row.tickets.size,
      qty: row.qty,
      total: row.total,
      avg: row.qty > 0 ? roundMoney(row.total / row.qty) : 0,
    }))
    .sort((a, b) => b.total - a.total);
  const totalAll = roundMoney(lines.reduce((sum, row) => sum + row.total, 0));
  const maxTotal = Math.max(...lines.map((row) => row.total), 0);

  lines.forEach((row) => {
    sheet.addRow([
      row.product,
      row.tickets,
      row.qty,
      row.total,
      row.avg,
      totalAll > 0 ? roundMoney((row.total / totalAll) * 100) : 0,
      getBar(row.total, maxTotal),
    ]);
  });

  autoFitColumns(sheet, [30, 10, 12, 14, 14, 12, 26, 10]);
}

function addRegisterSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Caja y Cortes${suffix}`);
  styleSheetHeader(sheet, `${STORE_NAME} - Caja y cortes${suffix}`, `Generado: ${ctx.generatedAt}`, 12);
  sheet.addRow([]);
  const summaryHeader = sheet.addRow(["Indicador", "Valor"]);
  styleTableHeader(summaryHeader);

  const quickCuts = ctx.registerEvents.filter((row) => row.event_type === "quick_cut");
  const finalCuts = ctx.registerEvents.filter((row) => row.event_type === "final_cut");
  const starts = ctx.registerEvents.filter((row) => row.event_type === "start");
  sheet.addRow(["Inicios de caja", starts.length]);
  sheet.addRow(["Cortes rapidos", quickCuts.length]);
  sheet.addRow(["Cortes finales", finalCuts.length]);
  sheet.addRow([
    "Total retiros",
    roundMoney(ctx.registerEvents.reduce((sum, row) => sum + roundMoney(row.withdrawals_amount || 0), 0)),
  ]);
  sheet.addRow([]);

  const eventsHeader = sheet.addRow([
    "ID",
    "Tipo",
    "Turno",
    "Cajero",
    "Apertura",
    "Contado",
    "Retiro",
    "Esperado",
    "Diferencia",
    "Ventas efectivo",
    "Ventas no efectivo",
    "Fecha",
  ]);
  styleTableHeader(eventsHeader);

  ctx.registerEvents.forEach((row) => {
    sheet.addRow([
      row.id,
      row.event_type,
      row.shift,
      row.cashier,
      roundMoney(row.opening_amount),
      roundMoney(row.counted_amount),
      roundMoney(row.withdrawals_amount || 0),
      roundMoney(row.expected_cash),
      roundMoney(row.difference_amount),
      roundMoney(row.cash_sales),
      roundMoney(row.non_cash_sales),
      formatReportDateTime(row.created_at),
    ]);
  });

  autoFitColumns(sheet, [8, 12, 10, 16, 12, 12, 12, 12, 12, 14, 14, 22]);
}

function addInventorySheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Inventario${suffix}`);
  styleSheetHeader(sheet, `${STORE_NAME} - Inventario${suffix}`, `Generado: ${ctx.generatedAt}`, 10);
  sheet.addRow([]);
  const header = sheet.addRow([
    "ID",
    "Producto",
    "Categoria",
    "Unidad",
    "Precio",
    "Existencia",
    "Minimo",
    "Importe",
    "Activo",
    "Stock bajo",
  ]);
  styleTableHeader(header);

  ctx.products.forEach((row) => {
    const stock = roundStock(row.stock);
    const min = roundStock(row.min_stock);
    sheet.addRow([
      row.id,
      row.name,
      row.category,
      row.unit,
      roundMoney(row.price),
      stock,
      min,
      roundMoney(stock * roundMoney(row.price)),
      row.active ? "Si" : "No",
      row.active && row.stock_initialized && stock <= min ? "SI" : "",
    ]);
  });
  autoFitColumns(sheet, [8, 30, 14, 10, 12, 12, 12, 14, 10, 10]);
}

function addMovementsSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Movimientos${suffix}`);
  styleSheetHeader(sheet, `${STORE_NAME} - Movimientos${suffix}`, `Generado: ${ctx.generatedAt}`, 12);
  sheet.addRow([]);
  const header = sheet.addRow([
    "ID",
    "Producto",
    "Tipo",
    "Cantidad",
    "Stock Antes",
    "Stock Despues",
    "Delta real",
    "Cuadra",
    "Referencia",
    "Nota",
    "Fecha",
  ]);
  styleTableHeader(header);

  ctx.movements.forEach((row) => {
    const expectedAfter = roundStock(roundStock(row.stock_before) + roundStock(row.quantity_delta));
    const actualAfter = roundStock(row.stock_after);
    const match = Math.abs(expectedAfter - actualAfter) <= 0.001 ? "OK" : "REVISAR";
    sheet.addRow([
      row.id,
      row.product_name,
      row.movement_type,
      roundStock(row.quantity_delta),
      roundStock(row.stock_before),
      actualAfter,
      roundStock(actualAfter - roundStock(row.stock_before)),
      match,
      `${row.reference_type || ""} ${row.reference_id || ""}`.trim(),
      row.note || "",
      formatReportDateTime(row.created_at),
    ]);
  });

  autoFitColumns(sheet, [8, 26, 14, 12, 12, 12, 12, 10, 16, 32, 22, 10]);
}

function addSalesPulseSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Pulso Ventas${suffix}`);
  styleSheetHeader(
    sheet,
    `${STORE_NAME} - Pulso por hora${suffix}`,
    `Ventana ${String(SALES_PULSE_START_HOUR).padStart(2, "0")}:00 - ${String(SALES_PULSE_END_HOUR).padStart(2, "0")}:00`,
    6,
  );
  sheet.addRow([]);
  const header = sheet.addRow(["Hora", "Tickets", "Total", "Grafica"]);
  styleTableHeader(header);

  const hourMap = new Map();
  for (let hour = SALES_PULSE_START_HOUR; hour <= SALES_PULSE_END_HOUR; hour += 1) {
    const label = `${String(hour).padStart(2, "0")}:00`;
    hourMap.set(label, { tickets: 0, total: 0 });
  }
  ctx.salesHeaders.forEach((row) => {
    const hour = getStoreHourLabel(row.created_at);
    if (!hourMap.has(hour)) return;
    const current = hourMap.get(hour);
    current.tickets += 1;
    current.total = roundMoney(current.total + roundMoney(row.total));
    hourMap.set(hour, current);
  });

  const rows = [...hourMap.entries()].map(([hour, metrics]) => ({ hour, ...metrics }));
  const maxTotal = Math.max(...rows.map((row) => row.total), 0);
  rows.forEach((row) => {
    sheet.addRow([row.hour, row.tickets, row.total, getBar(row.total, maxTotal)]);
  });
  autoFitColumns(sheet, [10, 10, 14, 26, 10, 10]);
}

function saleBranchForExport(row) {
  const b = row.branch;
  if (b && STORE_BRANCHES.includes(String(b).toLowerCase())) {
    return String(b).toLowerCase();
  }
  return STORE_BRANCHES[0];
}

function toBranchContext(baseRows, branchCode, scope, baseDate, generatedAt, scopeLabel) {
  const products = baseRows.products.filter((row) => row.branch === branchCode);
  const salesRows = filterByScope(
    baseRows.salesRows.filter((row) => saleBranchForExport(row) === branchCode),
    scope,
    baseDate,
    "created_at",
  );
  const movements = filterByScope(
    baseRows.movements.filter((row) => row.branch === branchCode),
    scope,
    baseDate,
    "created_at",
  );
  const registerEvents = filterByScope(
    baseRows.registerEvents.filter((row) => row.branch === branchCode),
    scope,
    baseDate,
    "created_at",
  );

  const salesHeadersMap = new Map();
  salesRows.forEach((row) => {
    if (!salesHeadersMap.has(row.id)) {
      salesHeadersMap.set(row.id, row);
    }
  });
  const salesHeaders = [...salesHeadersMap.values()];
  const salesItems = salesRows.filter((row) => row.product_id != null);

  return {
    generatedAt,
    scopeLabel,
    products,
    salesRows,
    salesHeaders,
    salesItems,
    movements,
    registerEvents,
  };
}

async function exportWorkbookReport(options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = STORE_NAME;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Exportacion operacional del POS";
  workbook.title = `${STORE_NAME} - Exportacion`;

  const generatedAt = nowIso();
  const scope = options.scope === "all-time" ? "all-time" : "store-day";
  const { baseDate, exportDateKey, scopeLabel } = resolveExportBaseDate(options.baseDate, scope);
  const selectedBranch = normalizeBranch(options.branch || ALL_BRANCHES, {
    allowAll: true,
    fallback: ALL_BRANCHES,
  });

  const baseRows = {
    products: listAllProductsForExport(),
    salesRows: listSalesForExport(),
    movements: listInventoryMovementsForExport(),
    registerEvents: listRegisterEventsForExport(),
  };

  if (selectedBranch === ALL_BRANCHES) {
    STORE_BRANCHES.forEach((branchCode) => {
      const branchLabel = getBranchLabel(branchCode);
      const suffix = ` - ${branchLabel}`;
      const ctx = toBranchContext(baseRows, branchCode, scope, baseDate, generatedAt, scopeLabel);
      addSummarySheet(workbook, ctx, branchCode, suffix);
      addSalesDetailSheet(workbook, ctx, suffix);
      addSalesProductsSheet(workbook, ctx, suffix);
      addRegisterSheet(workbook, ctx, suffix);
      addInventorySheet(workbook, ctx, suffix);
      addMovementsSheet(workbook, ctx, suffix);
      addSalesPulseSheet(workbook, ctx, suffix);
    });
  } else {
    const ctx = toBranchContext(baseRows, selectedBranch, scope, baseDate, generatedAt, scopeLabel);
    addSummarySheet(workbook, ctx, selectedBranch);
    addSalesDetailSheet(workbook, ctx);
    addSalesProductsSheet(workbook, ctx);
    addRegisterSheet(workbook, ctx);
    addInventorySheet(workbook, ctx);
    addMovementsSheet(workbook, ctx);
    addSalesPulseSheet(workbook, ctx);
  }

  return {
    workbook,
    exportDateKey,
    scope,
  };
}

module.exports = { exportWorkbookReport };
