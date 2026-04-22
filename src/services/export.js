const ExcelJS = require("exceljs");

const { STORE_NAME, SALES_PULSE_START_HOUR, SALES_PULSE_END_HOUR } = require("../config");
const { nowIso, roundMoney, roundStock } = require("../utils/helpers");

const { listAllProductsForExport } = require("./products");
const { listSalesForExport } = require("./sales");
const { listInventoryMovementsForExport } = require("./inventory");
const { getDashboardSnapshot } = require("./dashboard");

function styleSheetHeader(sheet, title, subtitle) {
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "B44C59" },
  };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };

  sheet.mergeCells("A2:F2");
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF6B5C50" } };
  sheet.getCell("A2").alignment = { vertical: "middle", horizontal: "center" };
}

function styleTableHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "68836D" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function autoFitColumns(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function addCategorySection(sheet, title, products) {
  if (products.length === 0) {
    return;
  }

  sheet.addRow([]);
  const titleRow = sheet.addRow([title]);
  titleRow.getCell(1).font = { bold: true, size: 12 };
  titleRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "F0E4D7" },
  };
  sheet.mergeCells(`A${titleRow.number}:F${titleRow.number}`);

  const headerRow = sheet.addRow([
    "Producto",
    "Precio",
    "Existencia",
    "Importe",
    "Minimo",
    "Activo",
  ]);
  styleTableHeader(headerRow);

  products.forEach((row) => {
    sheet.addRow([
      row.name,
      roundMoney(row.price),
      roundStock(row.stock),
      roundMoney(row.stock * row.price),
      roundStock(row.min_stock),
      row.active ? "Si" : "No",
    ]);
  });
}

async function exportWorkbookReport() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = STORE_NAME;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Exportacion total del POS";
  workbook.title = `${STORE_NAME} - Exportacion`;

  const generatedAt = nowIso();
  const products = listAllProductsForExport();
  const sales = listSalesForExport();
  const movements = listInventoryMovementsForExport();
  const snapshot = getDashboardSnapshot();

  // Resumen sheet
  const summarySheet = workbook.addWorksheet("Resumen");
  styleSheetHeader(summarySheet, `${STORE_NAME} - Resumen`, `Generado: ${generatedAt}`);
  summarySheet.addRow([]);
  summarySheet.addRow(["Indicador", "Valor"]);
  styleTableHeader(summarySheet.getRow(4));
  summarySheet.addRows([
    ["Ventas del dia", snapshot.summary.revenueToday],
    ["Tickets del dia", snapshot.summary.ticketsToday],
    ["Ticket promedio", snapshot.summary.averageTicket],
    ["Unidades vendidas", snapshot.summary.unitsSoldToday],
    ["Productos activos", snapshot.summary.catalogSize],
    ["Inventario valorizado", snapshot.summary.inventoryValue],
    ["Alertas de stock", snapshot.summary.lowStockCount],
    ["Producto top", snapshot.summary.topProduct?.name || "Sin ventas"],
  ]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Turno", "Tickets", "Total"]);
  styleTableHeader(summarySheet.getRow(summarySheet.lastRow.number));
  snapshot.shiftSummary.forEach((row) => {
    summarySheet.addRow([row.shift, row.tickets, row.total]);
  });
  autoFitColumns(summarySheet, [28, 20, 18, 18, 18, 18]);

  // Turno sheets
  const { STORE_SHIFTS } = require("../config");
  STORE_SHIFTS.forEach((shift) => {
    const shiftSheet = workbook.addWorksheet(`Turno ${shift}`);
    styleSheetHeader(
      shiftSheet,
      `${STORE_NAME} - ${shift}`,
      `Pulso de venta ${String(SALES_PULSE_START_HOUR).padStart(2, "0")}:00 a ${String(SALES_PULSE_END_HOUR).padStart(2, "0")}:00`,
    );

    shiftSheet.addRow([]);
    shiftSheet.addRow(["Tickets del dia", snapshot.shiftSummary.find((item) => item.shift === shift)?.tickets || 0]);
    shiftSheet.addRow(["Total del dia", snapshot.shiftSummary.find((item) => item.shift === shift)?.total || 0]);

    const groupedProducts = {
      quesos: [],
      carnes: [],
      piezas: [],
      general: [],
    };

    products.forEach((product) => {
      const key = groupedProducts[product.category] ? product.category : "general";
      groupedProducts[key].push(product);
    });

    addCategorySection(shiftSheet, "Quesos", groupedProducts.quesos);
    addCategorySection(shiftSheet, "Carnes", groupedProducts.carnes);
    addCategorySection(shiftSheet, "Piezas", groupedProducts.piezas);
    addCategorySection(shiftSheet, "General", groupedProducts.general);
    autoFitColumns(shiftSheet, [34, 14, 14, 16, 14, 12]);
  });

  // Inventario sheet
  const inventorySheet = workbook.addWorksheet("Inventario");
  styleSheetHeader(inventorySheet, `${STORE_NAME} - Inventario`, `Generado: ${generatedAt}`);
  inventorySheet.addRow([]);
  inventorySheet.addRow([
    "ID",
    "Producto",
    "Categoria",
    "Unidad",
    "Precio",
    "Existencia",
    "Minimo",
    "Importe",
    "Activo",
  ]);
  styleTableHeader(inventorySheet.getRow(4));

  products.forEach((row) => {
    inventorySheet.addRow([
      row.id,
      row.name,
      row.category,
      row.unit,
      roundMoney(row.price),
      roundStock(row.stock),
      roundStock(row.min_stock),
      roundMoney(row.stock * row.price),
      row.active ? "Si" : "No",
    ]);
  });

  autoFitColumns(inventorySheet, [8, 30, 14, 10, 12, 12, 10, 14, 10]);

  // Ventas sheet
  const salesSheet = workbook.addWorksheet("Ventas");
  styleSheetHeader(salesSheet, `${STORE_NAME} - Ventas`, `Generado: ${generatedAt}`);
  salesSheet.addRow([]);
  salesSheet.addRow([
    "Ticket",
    "Turno",
    "Cajero",
    "Sucursal",
    "Metodo",
    "Subtotal",
    "Total",
    "Items",
    "Fecha",
  ]);
  styleTableHeader(salesSheet.getRow(4));

  const salesMap = new Map();
  sales.forEach((row) => {
    if (!salesMap.has(row.id)) {
      salesMap.set(row.id, {
        ticket_number: row.ticket_number,
        shift: row.shift,
        cashier: row.cashier,
        branch: row.branch,
        payment_method: row.payment_method,
        subtotal: row.subtotal,
        total: row.total,
        item_count: row.item_count,
        created_at: row.created_at,
      });
    }
  });

  salesMap.forEach((sale) => {
    salesSheet.addRow([
      sale.ticket_number,
      sale.shift,
      sale.cashier,
      sale.branch,
      sale.payment_method,
      roundMoney(sale.subtotal),
      roundMoney(sale.total),
      roundStock(sale.item_count),
      sale.created_at,
    ]);
  });

  autoFitColumns(salesSheet, [16, 10, 16, 14, 14, 12, 12, 10, 20]);

  // Movimientos sheet
  const movementsSheet = workbook.addWorksheet("Movimientos");
  styleSheetHeader(movementsSheet, `${STORE_NAME} - Movimientos`, `Generado: ${generatedAt}`);
  movementsSheet.addRow([]);
  movementsSheet.addRow([
    "ID",
    "Producto",
    "Tipo",
    "Cantidad",
    "Stock Antes",
    "Stock Despues",
    "Nota",
    "Fecha",
  ]);
  styleTableHeader(movementsSheet.getRow(4));

  movements.forEach((row) => {
    movementsSheet.addRow([
      row.id,
      row.product_name,
      row.movement_type,
      roundStock(row.quantity_delta),
      roundStock(row.stock_before),
      roundStock(row.stock_after),
      row.note || "",
      row.created_at,
    ]);
  });

  autoFitColumns(movementsSheet, [8, 24, 14, 12, 14, 14, 30, 20]);

  return workbook;
}

module.exports = {
  exportWorkbookReport,
};