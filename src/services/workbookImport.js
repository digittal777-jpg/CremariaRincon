const fs = require("node:fs");
const path = require("node:path");

const ExcelJS = require("exceljs");

const { DATA_DIR, DB_PATH, ENABLE_DB_INSTALL_BACKUP } = require("../config");
const { createDatabaseBackup, getDb, nowIso } = require("../db");
const {
  STORE_BRANCHES,
  STORE_BRANCH_LABELS,
  createHttpError,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

const BRANCH_LABEL_TO_CODE = new Map(
  Object.entries(STORE_BRANCH_LABELS).flatMap(([branchCode, label]) => ([
    [normalizeLookupKey(branchCode), branchCode],
    [normalizeLookupKey(label), branchCode],
  ])),
);

function normalizeLookupKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeWorkbookText(value) {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("").trim();
    }

    if (typeof value.text === "string") {
      return value.text.trim();
    }

    if (typeof value.result === "string") {
      return value.result.trim();
    }
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function cellToNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return Number.NaN;
  }

  if (value && typeof value === "object" && typeof value.result === "number") {
    return value.result;
  }

  const normalized = normalizeWorkbookText(value).replace(/[^0-9,.-]/g, "");
  if (!normalized) {
    return Number.NaN;
  }

  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function cellToBoolean(value) {
  const normalized = normalizeLookupKey(normalizeWorkbookText(value));
  if (!normalized) {
    return false;
  }

  return ["si", "sí", "true", "1", "activo", "yes"].includes(normalized);
}

function cellToIsoDate(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object" && value.result instanceof Date) {
    return value.result.toISOString();
  }

  const raw = normalizeWorkbookText(value);
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    const [, year, month, day, hour, minute, second = "00"] = isoMatch;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const mxMatch = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:,\s*|\s+)(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (mxMatch) {
    const [, day, month, year, hour, minute, second = "00"] = mxMatch;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  throw createHttpError(`No pude leer una fecha valida desde "${raw}".`);
}

function getBranchCodeFromText(value) {
  const normalized = normalizeLookupKey(value);
  if (!normalized) {
    return null;
  }

  for (const [lookupValue, branchCode] of BRANCH_LABEL_TO_CODE.entries()) {
    if (normalized === lookupValue || normalized.includes(lookupValue)) {
      return branchCode;
    }
  }

  return null;
}

function findHeaderMap(worksheet, requiredHeaders) {
  const required = requiredHeaders.map((header) => normalizeLookupKey(header));
  const maxRows = Math.min(worksheet.rowCount || 0, 25);

  for (let rowIndex = 1; rowIndex <= maxRows; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const headerMap = new Map();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = normalizeLookupKey(cell.value);
      if (header) {
        headerMap.set(header, colNumber);
      }
    });

    if (required.every((header) => headerMap.has(header))) {
      return {
        rowIndex,
        headerMap,
      };
    }
  }

  return null;
}

function getCellFromHeader(row, headerMap, headerLabel) {
  const columnIndex = headerMap.get(normalizeLookupKey(headerLabel));
  if (!columnIndex) {
    return null;
  }

  return row.getCell(columnIndex).value;
}

function sortByCreatedAt(left, right) {
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
    || String(left.ticketNumber || left.productName || "").localeCompare(
      String(right.ticketNumber || right.productName || ""),
    );
}

function extractReference(referenceRaw) {
  const referenceText = normalizeWorkbookText(referenceRaw);
  if (!referenceText) {
    return {
      referenceType: null,
      referenceId: null,
    };
  }

  const match = referenceText.match(/^(.*?)(?:\s+(\d+))?$/);
  const referenceType = normalizeText(match?.[1] || "", 40).toLowerCase() || null;
  const referenceId = match?.[2] ? Number(match[2]) : null;
  return {
    referenceType,
    referenceId: Number.isInteger(referenceId) ? referenceId : null,
  };
}

function resolveSheetBranch(sheetName, baseName, defaultBranch) {
  if (sheetName === baseName) {
    return defaultBranch;
  }

  const prefix = `${baseName} - `;
  if (!sheetName.startsWith(prefix)) {
    return null;
  }

  return getBranchCodeFromText(sheetName.slice(prefix.length));
}

function getMatchingWorksheets(workbook, baseName) {
  return workbook.worksheets.filter((worksheet) =>
    worksheet.name === baseName || worksheet.name.startsWith(`${baseName} - `),
  );
}

function detectDefaultBranch(workbook) {
  const summarySheet = workbook.getWorksheet("Resumen");
  if (summarySheet) {
    const fromTitle = getBranchCodeFromText(summarySheet.getCell("A1").value);
    if (fromTitle) {
      return fromTitle;
    }
  }

  const salesSheet = workbook.getWorksheet("Ventas Detalle");
  if (!salesSheet) {
    return null;
  }

  const headerInfo = findHeaderMap(salesSheet, ["Sucursal"]);
  if (!headerInfo) {
    return null;
  }

  for (let rowIndex = headerInfo.rowIndex + 1; rowIndex <= salesSheet.rowCount; rowIndex += 1) {
    const row = salesSheet.getRow(rowIndex);
    const branchCode = getBranchCodeFromText(getCellFromHeader(row, headerInfo.headerMap, "Sucursal"));
    if (branchCode) {
      return branchCode;
    }
  }

  return null;
}

function parseInventorySheets(workbook, defaultBranch) {
  const sheets = getMatchingWorksheets(workbook, "Inventario");
  if (sheets.length === 0) {
    throw createHttpError("El Excel exportado no contiene la hoja de inventario.");
  }

  const productsByBranch = new Map();

  sheets.forEach((worksheet) => {
    const branch = resolveSheetBranch(worksheet.name, "Inventario", defaultBranch);
    if (!branch) {
      throw createHttpError(
        `No pude identificar la sucursal de la hoja "${worksheet.name}".`,
      );
    }

    const headerInfo = findHeaderMap(worksheet, [
      "Producto",
      "Categoria",
      "Unidad",
      "Precio",
      "Existencia",
      "Minimo",
      "Activo",
    ]);
    if (!headerInfo) {
      throw createHttpError(`La hoja "${worksheet.name}" no tiene el formato esperado.`);
    }

    const seenNames = new Set();
    const branchProducts = [];

    for (let rowIndex = headerInfo.rowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const name = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Producto"), 80);
      if (!name) {
        continue;
      }

      const dedupeKey = normalizeLookupKey(name);
      if (seenNames.has(dedupeKey)) {
        throw createHttpError(
          `El producto "${name}" aparece duplicado en la hoja "${worksheet.name}".`,
        );
      }

      seenNames.add(dedupeKey);
      branchProducts.push({
        name,
        category: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Categoria"), 24)
          .toLowerCase() || "general",
        unit: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Unidad"), 12)
          .toLowerCase() || "kg",
        price: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Precio"))),
        stock: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Existencia"))),
        minStock: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Minimo"))),
        active: cellToBoolean(getCellFromHeader(row, headerInfo.headerMap, "Activo")),
        displayOrder: branchProducts.length + 1,
        branch,
      });
    }

    productsByBranch.set(branch, branchProducts);
  });

  return productsByBranch;
}

function parseSalesSheets(workbook, defaultBranch) {
  const sheets = getMatchingWorksheets(workbook, "Ventas Detalle");
  const groupedSales = new Map();

  sheets.forEach((worksheet) => {
    const sheetBranch = resolveSheetBranch(worksheet.name, "Ventas Detalle", defaultBranch);
    const headerInfo = findHeaderMap(worksheet, [
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
      "Stock Despues",
    ]);
    if (!headerInfo) {
      return;
    }

    for (let rowIndex = headerInfo.rowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const ticketNumber = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Ticket"), 40);
      const productName = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Producto"), 80);
      if (!ticketNumber || !productName) {
        continue;
      }

      const branch = getBranchCodeFromText(getCellFromHeader(row, headerInfo.headerMap, "Sucursal"))
        || sheetBranch;
      if (!branch) {
        throw createHttpError(
          `No pude identificar la sucursal de la venta "${ticketNumber}".`,
        );
      }

      const groupKey = `${branch}::${ticketNumber}`;
      const currentGroup = groupedSales.get(groupKey) || {
        ticketNumber,
        branch,
        shift: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Turno"), 24) || "Tarde",
        cashier: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Cajero"), 60) || "Mostrador",
        paymentMethod: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Metodo"), 24) || "Efectivo",
        createdAt: cellToIsoDate(getCellFromHeader(row, headerInfo.headerMap, "Fecha")),
        items: [],
      };

      currentGroup.items.push({
        productName,
        quantity: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Cantidad"))),
        unitPrice: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Precio Unit"))),
        lineTotal: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Total Linea"))),
        stockBefore: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Stock Antes"))),
        stockAfter: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Stock Despues"))),
      });

      groupedSales.set(groupKey, currentGroup);
    }
  });

  return [...groupedSales.values()]
    .map((sale) => ({
      ...sale,
      items: sale.items.filter((item) =>
        item.productName
        && Number.isFinite(item.quantity)
        && Number.isFinite(item.unitPrice)
        && Number.isFinite(item.lineTotal),
      ),
    }))
    .filter((sale) => sale.items.length > 0)
    .sort(sortByCreatedAt);
}

function parseRegisterSheets(workbook, defaultBranch) {
  const sheets = getMatchingWorksheets(workbook, "Caja y Cortes");
  const events = [];

  sheets.forEach((worksheet) => {
    const branch = resolveSheetBranch(worksheet.name, "Caja y Cortes", defaultBranch);
    if (!branch) {
      throw createHttpError(
        `No pude identificar la sucursal de la hoja "${worksheet.name}".`,
      );
    }

    const headerInfo = findHeaderMap(worksheet, [
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
    if (!headerInfo) {
      return;
    }

    for (let rowIndex = headerInfo.rowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const eventType = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Tipo"), 24)
        .toLowerCase();
      if (!eventType) {
        continue;
      }

      const cashSales = roundMoney(
        cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Ventas efectivo")),
      );
      const nonCashSales = roundMoney(
        cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Ventas no efectivo")),
      );

      events.push({
        eventType,
        shift: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Turno"), 24) || "Tarde",
        cashier: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Cajero"), 60) || "Mostrador",
        branch,
        openingAmount: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Apertura"))),
        countedAmount: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Contado"))),
        withdrawalsAmount: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Retiro"))),
        expectedCash: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Esperado"))),
        differenceAmount: roundMoney(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Diferencia"))),
        cashSales,
        nonCashSales,
        totalSales: roundMoney(cashSales + nonCashSales),
        createdAt: cellToIsoDate(getCellFromHeader(row, headerInfo.headerMap, "Fecha")),
      });
    }
  });

  return events.sort(sortByCreatedAt);
}

function parseMovementSheets(workbook, defaultBranch) {
  const sheets = getMatchingWorksheets(workbook, "Movimientos");
  const movements = [];

  sheets.forEach((worksheet) => {
    const branch = resolveSheetBranch(worksheet.name, "Movimientos", defaultBranch);
    if (!branch) {
      throw createHttpError(
        `No pude identificar la sucursal de la hoja "${worksheet.name}".`,
      );
    }

    const headerInfo = findHeaderMap(worksheet, [
      "Producto",
      "Tipo",
      "Cantidad",
      "Stock Antes",
      "Stock Despues",
      "Referencia",
      "Nota",
      "Fecha",
    ]);
    if (!headerInfo) {
      return;
    }

    for (let rowIndex = headerInfo.rowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const productName = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Producto"), 80);
      const movementType = normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Tipo"), 24)
        .toLowerCase();
      if (!productName || !movementType) {
        continue;
      }

      const { referenceType, referenceId } = extractReference(
        getCellFromHeader(row, headerInfo.headerMap, "Referencia"),
      );

      movements.push({
        productName,
        movementType,
        branch,
        quantityDelta: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Cantidad"))),
        stockBefore: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Stock Antes"))),
        stockAfter: roundStock(cellToNumber(getCellFromHeader(row, headerInfo.headerMap, "Stock Despues"))),
        note: normalizeText(getCellFromHeader(row, headerInfo.headerMap, "Nota"), 120) || null,
        referenceType,
        referenceId,
        createdAt: cellToIsoDate(getCellFromHeader(row, headerInfo.headerMap, "Fecha")),
      });
    }
  });

  return movements
    .filter((movement) => movement.movementType !== "sale")
    .sort(sortByCreatedAt);
}

async function parseExportWorkbookBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createHttpError("El archivo de Excel esta vacio o incompleto.");
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch (_error) {
    throw createHttpError("No pude leer el archivo de Excel exportado.");
  }

  const defaultBranch = detectDefaultBranch(workbook);
  const productsByBranch = parseInventorySheets(workbook, defaultBranch);
  const branches = [...productsByBranch.keys()];

  if (branches.length === 0) {
    throw createHttpError("El Excel exportado no contiene productos para restaurar.");
  }

  return {
    defaultBranch,
    branches,
    productsByBranch,
    sales: parseSalesSheets(workbook, defaultBranch),
    registerEvents: parseRegisterSheets(workbook, defaultBranch),
    inventoryMovements: parseMovementSheets(workbook, defaultBranch),
  };
}

function buildProductLookupKey(branch, productName) {
  return `${normalizeBranch(branch)}::${normalizeLookupKey(productName)}`;
}

function buildUniqueImportedTicketNumber(ticketNumber, existingTickets) {
  const baseTicket = normalizeText(ticketNumber, 40) || `IMP-${Date.now()}`;
  if (!existingTickets.has(baseTicket)) {
    existingTickets.add(baseTicket);
    return baseTicket;
  }

  let attempt = 2;
  while (attempt < 10000) {
    const candidate = normalizeText(`${baseTicket}-IMP${attempt}`, 40);
    if (!existingTickets.has(candidate)) {
      existingTickets.add(candidate);
      return candidate;
    }
    attempt += 1;
  }

  throw createHttpError(
    `No pude generar un ticket unico para "${ticketNumber}" durante la importacion.`,
  );
}

function validateParsedWorkbook(parsedWorkbook) {
  parsedWorkbook.branches.forEach((branch) => {
    if (!STORE_BRANCHES.includes(branch)) {
      throw createHttpError(`La sucursal "${branch}" no es valida para esta instalacion.`);
    }
  });

  parsedWorkbook.sales.forEach((sale) => {
    if (!parsedWorkbook.productsByBranch.has(sale.branch)) {
      throw createHttpError(
        `La venta "${sale.ticketNumber}" pertenece a una sucursal sin inventario en el Excel.`,
      );
    }
  });

  parsedWorkbook.registerEvents.forEach((event) => {
    if (!parsedWorkbook.productsByBranch.has(event.branch)) {
      throw createHttpError(
        `El evento de caja "${event.eventType}" no coincide con ninguna sucursal importable.`,
      );
    }
  });

  parsedWorkbook.inventoryMovements.forEach((movement) => {
    if (!parsedWorkbook.productsByBranch.has(movement.branch)) {
      throw createHttpError(
        `El movimiento de inventario de "${movement.productName}" no coincide con ninguna sucursal importable.`,
      );
    }
  });
}

function installParsedWorkbookData(parsedWorkbook) {
  validateParsedWorkbook(parsedWorkbook);

  const deleteInventoryMovementsByBranch = db.prepare(
    "DELETE FROM inventory_movements WHERE branch = ?",
  );
  const deleteSalesByBranch = db.prepare("DELETE FROM sales WHERE branch = ?");
  const deleteRegisterEventsByBranch = db.prepare("DELETE FROM register_events WHERE branch = ?");
  const deleteProductsByBranch = db.prepare("DELETE FROM products WHERE branch = ?");

  const insertProduct = db.prepare(`
    INSERT INTO products (
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
      branch,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSale = db.prepare(`
    INSERT INTO sales (
      ticket_number,
      shift,
      cashier,
      branch,
      payment_method,
      subtotal,
      total,
      received_amount,
      change_amount,
      notes,
      item_count,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSaleItem = db.prepare(`
    INSERT INTO sale_items (
      sale_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      stock_before,
      stock_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertInventoryMovement = db.prepare(`
    INSERT INTO inventory_movements (
      product_id,
      movement_type,
      branch,
      quantity_delta,
      stock_before,
      stock_after,
      note,
      reference_type,
      reference_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRegisterEvent = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
      opening_amount,
      counted_amount,
      withdrawals_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const counters = {
    products: 0,
    sales: 0,
    saleItems: 0,
    registerEvents: 0,
    inventoryMovements: 0,
  };

  db.transaction(() => {
    parsedWorkbook.branches.forEach((branch) => {
      deleteInventoryMovementsByBranch.run(branch);
      deleteSalesByBranch.run(branch);
      deleteRegisterEventsByBranch.run(branch);
      deleteProductsByBranch.run(branch);
    });

    const existingTickets = new Set(
      db.prepare("SELECT ticket_number FROM sales").all().map((row) => row.ticket_number),
    );
    const productIdByKey = new Map();
    const productCreatedAt = nowIso();

    parsedWorkbook.branches.forEach((branch) => {
      const products = parsedWorkbook.productsByBranch.get(branch) || [];
      products.forEach((product) => {
        const insert = insertProduct.run(
          product.name,
          roundMoney(product.price),
          ["quesos", "carnes", "piezas", "general"].includes(product.category)
            ? product.category
            : "general",
          ["kg", "pza"].includes(product.unit) ? product.unit : "kg",
          null,
          roundStock(product.stock),
          Math.max(0, roundStock(product.minStock)),
          1,
          product.active ? 1 : 0,
          product.displayOrder,
          branch,
          productCreatedAt,
          productCreatedAt,
        );

        const productId = Number(insert.lastInsertRowid);
        productIdByKey.set(buildProductLookupKey(branch, product.name), productId);
        counters.products += 1;
      });
    });

    parsedWorkbook.sales.forEach((sale) => {
      const ticketNumber = buildUniqueImportedTicketNumber(sale.ticketNumber, existingTickets);
      const subtotal = roundMoney(
        sale.items.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0),
      );
      const itemCount = roundStock(
        sale.items.reduce((sum, item) => sum + roundStock(item.quantity), 0),
      );
      const receivedAmount = roundMoney(subtotal);
      const saleInsert = insertSale.run(
        ticketNumber,
        sale.shift,
        sale.cashier,
        sale.branch,
        sale.paymentMethod,
        subtotal,
        subtotal,
        receivedAmount,
        0,
        null,
        itemCount,
        sale.createdAt,
      );
      const saleId = Number(saleInsert.lastInsertRowid);
      counters.sales += 1;

      sale.items.forEach((item) => {
        const productId = productIdByKey.get(buildProductLookupKey(sale.branch, item.productName));
        if (!productId) {
          throw createHttpError(
            `No encontre el producto "${item.productName}" de la venta "${sale.ticketNumber}" dentro del inventario exportado.`,
          );
        }

        insertSaleItem.run(
          saleId,
          productId,
          item.productName,
          roundStock(item.quantity),
          roundMoney(item.unitPrice),
          roundMoney(item.lineTotal),
          roundStock(item.stockBefore),
          roundStock(item.stockAfter),
        );
        counters.saleItems += 1;

        insertInventoryMovement.run(
          productId,
          "sale",
          sale.branch,
          roundStock(-Math.abs(item.quantity)),
          roundStock(item.stockBefore),
          roundStock(item.stockAfter),
          `Venta ${ticketNumber}`,
          "sale",
          saleId,
          sale.createdAt,
        );
        counters.inventoryMovements += 1;
      });
    });

    parsedWorkbook.registerEvents.forEach((event) => {
      insertRegisterEvent.run(
        event.eventType,
        event.shift,
        event.cashier,
        event.branch,
        roundMoney(event.openingAmount),
        roundMoney(event.countedAmount),
        roundMoney(event.withdrawalsAmount),
        roundMoney(event.expectedCash),
        roundMoney(event.differenceAmount),
        roundMoney(event.cashSales),
        roundMoney(event.nonCashSales),
        roundMoney(event.totalSales),
        null,
        event.createdAt,
      );
      counters.registerEvents += 1;
    });

    parsedWorkbook.inventoryMovements.forEach((movement) => {
      const productId = productIdByKey.get(buildProductLookupKey(movement.branch, movement.productName));
      if (!productId) {
        throw createHttpError(
          `No encontre el producto "${movement.productName}" de un movimiento exportado.`,
        );
      }

      insertInventoryMovement.run(
        productId,
        movement.movementType,
        movement.branch,
        roundStock(movement.quantityDelta),
        roundStock(movement.stockBefore),
        roundStock(movement.stockAfter),
        movement.note,
        movement.referenceType,
        movement.referenceType === "sale" ? null : movement.referenceId,
        movement.createdAt,
      );
      counters.inventoryMovements += 1;
    });
  })();

  return counters;
}

async function installOperationalDataFromWorkbookBuffer(buffer) {
  const parsedWorkbook = await parseExportWorkbookBuffer(buffer);
  const stamp = `${Date.now()}-${process.pid}`;
  let backupPath = null;

  if (ENABLE_DB_INSTALL_BACKUP && fs.existsSync(DB_PATH)) {
    backupPath = path.join(DATA_DIR, `cremaria-rincon.workbook-backup-${stamp}.sqlite`);
    await createDatabaseBackup(backupPath);
  }

  const counts = installParsedWorkbookData(parsedWorkbook);

  return {
    branches: parsedWorkbook.branches,
    counts,
    backupPath,
    installedAt: nowIso(),
  };
}

async function installOperationalDataFromWorkbookFile(workbookPath) {
  const resolvedPath = path.resolve(workbookPath);
  if (!fs.existsSync(resolvedPath)) {
    throw createHttpError("No encontre el archivo de Excel exportado que quieres instalar.");
  }

  const buffer = fs.readFileSync(resolvedPath);
  const result = await installOperationalDataFromWorkbookBuffer(buffer);
  return {
    ...result,
    workbookPath: resolvedPath,
  };
}

module.exports = {
  installOperationalDataFromWorkbookBuffer,
  installOperationalDataFromWorkbookFile,
  parseExportWorkbookBuffer,
};
