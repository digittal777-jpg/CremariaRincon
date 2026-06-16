const ExcelJS = require("exceljs");
const {
  EXPORT_LOOKBACK_DAYS,
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
} = require("../config");
const {
  ALL_BRANCHES,
  createHttpError,
  STORE_BRANCHES,
  getBranchLabel,
  getStoreDateKey,
  getStoreHourLabel,
  getStoreName,
  getStoreTimeZone,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
  isCreditPaymentMethod,
  isSameStoreDay,
  normalizeBranch,
  nowIso,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { listAllProductsForExport } = require("./products");
const { listInventoryMovementsForExport } = require("./inventory");
const { listRegisterEventsForExport } = require("./register");
const { listCreditPaymentsForExport } = require("./receivables");
const { listSalesForExport } = require("./sales");
const { listWeightedAuditRowsForExport } = require("./weightedAudit");

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
  return "#".repeat(Math.max(1, Math.round((total / maxTotal) * 20)));
}

const reportDateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: getStoreTimeZone(),
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

function getCollectedTodayByMethod(row, method) {
  const total = roundMoney(row.total || 0);
  const receivedAmount = roundMoney(row.received_amount || 0);

  if (!isCreditPaymentMethod(row.payment_method)) {
    return row.payment_method === method ? total : 0;
  }

  return getSaleReceivedPaymentMethod(
    row.payment_method,
    row.received_payment_method || "",
    receivedAmount,
  ) === method
    ? receivedAmount
    : 0;
}

function buildCreditPaymentTotalsBySaleId(rows = []) {
  const totals = new Map();
  rows.forEach((row) => {
    const saleId = Number(row.sale_id);
    if (!saleId) {
      return;
    }
    const currentValue = totals.get(saleId) || 0;
    totals.set(saleId, roundMoney(currentValue + roundMoney(row.amount || 0)));
  });
  return totals;
}

function decorateSalesRowsWithCreditPayments(rows = [], creditPaymentTotalsBySaleId = new Map()) {
  return rows.map((row) => {
    if (!isCreditPaymentMethod(row.payment_method)) {
      return {
        ...row,
        paid_amount: roundMoney(row.received_amount || row.total || 0),
        pending_amount: 0,
        later_payments_total: 0,
      };
    }

    const laterPaymentsTotal = roundMoney(
      creditPaymentTotalsBySaleId.get(Number(row.id)) || 0,
    );
    const paidAmount = roundMoney(roundMoney(row.received_amount || 0) + laterPaymentsTotal);
    return {
      ...row,
      paid_amount: paidAmount,
      pending_amount: getSalePendingAmount(row.total, paidAmount, row.payment_method),
      later_payments_total: laterPaymentsTotal,
    };
  });
}

function addSummarySheet(workbook, ctx, branchCode, suffix = "") {
  const branchLabel = getBranchLabel(branchCode);
  const sheet = workbook.addWorksheet(`Resumen${suffix}`);
  styleSheetHeader(
    sheet,
    `${getStoreName()} - Resumen ${branchLabel}`,
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
    sales.reduce((sum, row) => sum + getCollectedTodayByMethod(row, "Efectivo"), 0),
  );
  const nonCashSales = roundMoney(totalSales - cashSales);
  const creditSales = roundMoney(
    sales.reduce(
      (sum, row) => sum + roundMoney(row.pending_amount || 0),
      0,
    ),
  );
  const initialCreditCollections = roundMoney(
    sales.reduce((sum, row) => {
      if (!isCreditPaymentMethod(row.payment_method)) {
        return sum;
      }
      return roundMoney(sum + roundMoney(row.received_amount || 0));
    }, 0),
  );
  const laterCreditCollections = roundMoney(
    ctx.creditPayments.reduce((sum, row) => sum + roundMoney(row.amount || 0), 0),
  );
  const creditCollections = roundMoney(initialCreditCollections + laterCreditCollections);
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
    ["Abonos fiado cobrados hoy", creditCollections],
    ["Fiado pendiente", creditSales],
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
  styleSheetHeader(sheet, `${getStoreName()} - Ventas detalle${suffix}`, `Generado: ${ctx.generatedAt}`, 19);
  sheet.addRow([]);
  const header = sheet.addRow([
    "Ticket",
    "Fecha",
    "Sucursal",
    "Turno",
    "Cajero",
    "Metodo",
    "Cliente",
    "Cliente Key",
    "Cobrado hoy",
    "Pendiente",
    "Cobrado por",
    "Pagado acumulado",
    "Abonos posteriores",
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
      row.customer_name || "",
      row.customer_key || "",
      roundMoney(row.received_amount || 0),
      roundMoney(row.pending_amount || 0),
      getSaleReceivedPaymentMethod(
        row.payment_method,
        row.received_payment_method || "",
        row.received_amount || 0,
      ),
      roundMoney(row.paid_amount || row.received_amount || 0),
      roundMoney(row.later_payments_total || 0),
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

  autoFitColumns(sheet, [18, 22, 14, 12, 16, 14, 20, 12, 12, 14, 12, 12, 24, 11, 12, 12, 12, 10, 12, 11, 10]);
}

function addReceivablesPaymentsSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Abonos Cartera${suffix}`);
  styleSheetHeader(sheet, `${getStoreName()} - Abonos de cartera${suffix}`, `Generado: ${ctx.generatedAt}`, 11);
  sheet.addRow([]);
  const header = sheet.addRow([
    "ID",
    "Ticket",
    "Fecha",
    "Sucursal",
    "Turno",
    "Cajero",
    "Cliente",
    "Cliente Key",
    "Metodo",
    "Abono",
    "Nota",
    "Fecha venta",
    "Total venta",
  ]);
  styleTableHeader(header);

  ctx.creditPayments.forEach((row) => {
    sheet.addRow([
      row.id,
      row.ticket_number,
      formatReportDateTime(row.created_at),
      getBranchLabel(row.branch),
      row.shift,
      row.cashier,
      row.customer_name || "",
      row.customer_key || "",
      row.payment_method,
      roundMoney(row.amount || 0),
      row.notes || "",
      row.sale_created_at ? formatReportDateTime(row.sale_created_at) : "",
      roundMoney(row.sale_total || 0),
    ]);
  });

  autoFitColumns(sheet, [8, 18, 22, 14, 12, 16, 20, 14, 12, 28, 22, 12]);
}

function addSalesProductsSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Ventas Productos${suffix}`);
  styleSheetHeader(sheet, `${getStoreName()} - Ventas por producto${suffix}`, `Generado: ${ctx.generatedAt}`, 8);
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
  styleSheetHeader(sheet, `${getStoreName()} - Caja y cortes${suffix}`, `Generado: ${ctx.generatedAt}`, 12);
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
  sheet.addRow([
    "Retiros excedidos",
    ctx.registerEvents.filter((row) => roundMoney(row.over_withdrawal_amount || 0) > 0).length,
  ]);
  sheet.addRow([
    "Monto retiro excedido",
    roundMoney(
      ctx.registerEvents.reduce(
        (sum, row) => sum + roundMoney(row.over_withdrawal_amount || 0),
        0,
      ),
    ),
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
    "Retiro excedido",
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
      roundMoney(row.over_withdrawal_amount || 0),
      roundMoney(row.expected_cash),
      roundMoney(row.difference_amount),
      roundMoney(row.cash_sales),
      roundMoney(row.non_cash_sales),
      formatReportDateTime(row.created_at),
    ]);
  });

  autoFitColumns(sheet, [8, 12, 10, 16, 12, 12, 12, 12, 12, 12, 14, 14, 22]);
}

function addInventorySheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Inventario${suffix}`);
  styleSheetHeader(sheet, `${getStoreName()} - Inventario${suffix}`, `Generado: ${ctx.generatedAt}`, 10);
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
  styleSheetHeader(sheet, `${getStoreName()} - Movimientos${suffix}`, `Generado: ${ctx.generatedAt}`, 12);
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
    `${getStoreName()} - Pulso por hora${suffix}`,
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

function addWeightedAuditSheet(workbook, ctx, suffix = "") {
  const sheet = workbook.addWorksheet(`Auditoria Pesado${suffix}`);
  styleSheetHeader(
    sheet,
    `${getStoreName()} - Auditoria de pesado${suffix}`,
    `Generado: ${ctx.generatedAt}`,
    14,
  );
  sheet.addRow([]);
  const summaryHeader = sheet.addRow(["Indicador", "Valor"]);
  styleTableHeader(summaryHeader);

  const rows = ctx.weightedAuditRows || [];
  const sessionIds = new Set(rows.map((row) => row.session_id));
  const shortageKg = roundStock(
    rows
      .filter((row) => Number(row.difference) < 0)
      .reduce((sum, row) => sum + Math.abs(roundStock(row.difference)), 0),
  );
  const surplusKg = roundStock(
    rows
      .filter((row) => Number(row.difference) > 0)
      .reduce((sum, row) => sum + roundStock(row.difference), 0),
  );
  const incidentItems = rows.filter((row) => Number(row.difference) !== 0).length;
  const estimatedValue = roundMoney(
    rows.reduce(
      (sum, row) => sum + roundMoney((row.difference || 0) * roundMoney(row.unit_price || 0)),
      0,
    ),
  );

  [
    ["Sesiones de auditoria", sessionIds.size],
    ["Renglones auditados", rows.length],
    ["Productos con diferencia", incidentItems],
    ["Kg faltante", shortageKg],
    ["Kg sobrante", surplusKg],
    ["Valor estimado variacion", estimatedValue],
  ].forEach((entry) => sheet.addRow(entry));

  sheet.addRow([]);
  const detailHeader = sheet.addRow([
    "Sesion",
    "Fecha auditada",
    "Estado",
    "Turno",
    "Producto",
    "Stock POS",
    "Conteo fisico",
    "Diferencia",
    "Direccion",
    "Motivo",
    "Precio kg",
    "Valor diferencia",
    "Creada por",
    "Completada por",
  ]);
  styleTableHeader(detailHeader);

  rows.forEach((row) => {
    const diff = row.difference == null ? null : roundStock(row.difference);
    sheet.addRow([
      row.session_id,
      row.audited_date_key,
      row.status,
      row.shift,
      row.product_name,
      roundStock(row.pos_stock),
      row.counted_stock == null ? "" : roundStock(row.counted_stock),
      diff == null ? "" : diff,
      row.direction || "",
      row.reason || "",
      roundMoney(row.unit_price || 0),
      diff == null ? "" : roundMoney(diff * roundMoney(row.unit_price || 0)),
      row.created_by || "",
      row.completed_by || "",
    ]);
  });

  autoFitColumns(sheet, [10, 14, 12, 10, 26, 12, 12, 12, 12, 32, 12, 14, 16, 16]);
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
  const salesRows = decorateSalesRowsWithCreditPayments(
    filterByScope(
      baseRows.salesRows.filter((row) => saleBranchForExport(row) === branchCode),
      scope,
      baseDate,
      "created_at",
    ),
    baseRows.creditPaymentTotalsBySaleId,
  );
  const creditPayments = filterByScope(
    baseRows.creditPayments.filter((row) => row.branch === branchCode),
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
  const weightedAuditRows = baseRows.weightedAuditRows.filter((row) => {
    if (row.branch !== branchCode) {
      return false;
    }

    if (scope === "all-time") {
      return true;
    }

    return String(row.audited_date_key || "") === getStoreDateKey(baseDate);
  });

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
    creditPayments,
    movements,
    registerEvents,
    weightedAuditRows,
  };
}

async function exportWorkbookReport(options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = getStoreName();
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Exportacion operacional del POS";
  workbook.title = `${getStoreName()} - Exportacion`;

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
    creditPayments: listCreditPaymentsForExport(),
    movements: listInventoryMovementsForExport(),
    registerEvents: listRegisterEventsForExport(),
    weightedAuditRows: listWeightedAuditRowsForExport(),
  };
  baseRows.creditPaymentTotalsBySaleId = buildCreditPaymentTotalsBySaleId(baseRows.creditPayments);

  if (selectedBranch === ALL_BRANCHES) {
    STORE_BRANCHES.forEach((branchCode) => {
      const branchLabel = getBranchLabel(branchCode);
      const suffix = ` - ${branchLabel}`;
      const ctx = toBranchContext(baseRows, branchCode, scope, baseDate, generatedAt, scopeLabel);
      addSummarySheet(workbook, ctx, branchCode, suffix);
      addSalesDetailSheet(workbook, ctx, suffix);
      addReceivablesPaymentsSheet(workbook, ctx, suffix);
      addSalesProductsSheet(workbook, ctx, suffix);
      addRegisterSheet(workbook, ctx, suffix);
      addInventorySheet(workbook, ctx, suffix);
      addMovementsSheet(workbook, ctx, suffix);
      addSalesPulseSheet(workbook, ctx, suffix);
      addWeightedAuditSheet(workbook, ctx, suffix);
    });
  } else {
    const ctx = toBranchContext(baseRows, selectedBranch, scope, baseDate, generatedAt, scopeLabel);
    addSummarySheet(workbook, ctx, selectedBranch);
    addSalesDetailSheet(workbook, ctx);
    addReceivablesPaymentsSheet(workbook, ctx);
    addSalesProductsSheet(workbook, ctx);
    addRegisterSheet(workbook, ctx);
    addInventorySheet(workbook, ctx);
    addMovementsSheet(workbook, ctx);
    addSalesPulseSheet(workbook, ctx);
    addWeightedAuditSheet(workbook, ctx);
  }

  return {
    workbook,
    exportDateKey,
    scope,
  };
}

module.exports = { exportWorkbookReport };
