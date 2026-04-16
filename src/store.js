const fs = require("node:fs");

const ExcelJS = require("exceljs");

const { parseWorkbookCatalog } = require("./catalogParser");
const {
  DEFAULT_WORKBOOK_PATHS,
  SALES_PULSE_END_HOUR,
  SALES_PULSE_START_HOUR,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
} = require("./config");
const { getDb, getTodayBounds, nowIso } = require("./db");

const db = getDb();

const CATEGORY_ORDER = ["quesos", "carnes", "piezas", "general"];
const CATEGORY_LABELS = {
  quesos: "Quesos",
  carnes: "Carnes",
  piezas: "Piezas",
  general: "General",
};

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
    status: getStockStatus(stock, minStock, row.stock_initialized),
  };
}

function resolveWorkbookPath(candidatePath) {
  const possiblePaths = [candidatePath, ...DEFAULT_WORKBOOK_PATHS].filter(Boolean);
  return possiblePaths.find((workbookPath) => fs.existsSync(workbookPath)) || null;
}

async function ensureCatalogSeeded(candidatePath) {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
  if (existingCount > 0) {
    return {
      seeded: false,
      reason: "catalog-exists",
    };
  }

  const workbookPath = resolveWorkbookPath(candidatePath);
  if (!workbookPath) {
    return {
      seeded: false,
      reason: "workbook-not-found",
    };
  }

  const result = await importCatalogFromWorkbook(workbookPath);
  return {
    seeded: true,
    ...result,
  };
}

async function importCatalogFromWorkbook(workbookPath) {
  const resolvedPath = resolveWorkbookPath(workbookPath);
  if (!resolvedPath) {
    throw createHttpError("No encontre el archivo de Excel para importar el catalogo.");
  }

  const catalog = await parseWorkbookCatalog(resolvedPath);
  if (catalog.length === 0) {
    throw createHttpError("El Excel no trae productos validos para importar.");
  }

  const upsertProduct = db.prepare(`
    INSERT INTO products (
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      display_order,
      created_at,
      updated_at
    ) VALUES (
      @name,
      @price,
      @category,
      @unit,
      @typeCode,
      @stock,
      @minStock,
      @displayOrder,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(name) DO UPDATE SET
      price = excluded.price,
      category = excluded.category,
      unit = excluded.unit,
      type_code = excluded.type_code,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `);

  const now = nowIso();

  const transaction = db.transaction((products) => {
    products.forEach((product) => {
      upsertProduct.run({
        ...product,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  transaction(catalog);

  return {
    importedCount: catalog.length,
    workbookPath: resolvedPath,
  };
}

function listProducts() {
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
      display_order
    FROM products
    WHERE active = 1
    ORDER BY
      CASE category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      display_order,
      name COLLATE NOCASE
  `).all();

  return rows.map(mapProduct);
}

function getProductById(productId) {
  const row = db.prepare(`
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
      display_order
    FROM products
    WHERE id = ?
  `).get(productId);

  return row ? mapProduct(row) : null;
}

function buildTicketPrefix(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `RIN-${year}${month}${day}`;
}

function getSummary() {
  const { start, end } = getTodayBounds();
  const todayTotals = db.prepare(`
    SELECT
      COUNT(*) AS ticketsToday,
      COALESCE(SUM(total), 0) AS revenueToday,
      COALESCE(AVG(total), 0) AS averageTicket,
      COALESCE(SUM(item_count), 0) AS unitsSoldToday
    FROM sales
    WHERE created_at >= ? AND created_at < ?
  `).get(start, end);

  const inventoryTotals = db.prepare(`
    SELECT
      COUNT(*) AS catalogSize,
      COALESCE(SUM(stock * price), 0) AS inventoryValue
    FROM products
    WHERE active = 1
  `).get();

  const lowStockCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products
    WHERE active = 1 AND stock_initialized = 1 AND stock <= min_stock
  `).get().count;

  const topProduct = db.prepare(`
    SELECT
      si.product_name AS name,
      COALESCE(SUM(si.line_total), 0) AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.created_at >= ? AND s.created_at < ?
    GROUP BY si.product_name
    ORDER BY total DESC
    LIMIT 1
  `).get(start, end);

  return {
    ticketsToday: Number(todayTotals.ticketsToday || 0),
    revenueToday: roundMoney(todayTotals.revenueToday),
    averageTicket: roundMoney(todayTotals.averageTicket),
    unitsSoldToday: roundStock(todayTotals.unitsSoldToday),
    catalogSize: Number(inventoryTotals.catalogSize || 0),
    inventoryValue: roundMoney(inventoryTotals.inventoryValue),
    lowStockCount: Number(lowStockCount || 0),
    topProduct: topProduct
      ? {
          name: topProduct.name,
          total: roundMoney(topProduct.total),
        }
      : null,
  };
}

function getRecentSales(limit = 8) {
  const rows = db.prepare(`
    SELECT
      s.id,
      s.ticket_number,
      s.shift,
      s.cashier,
      s.payment_method,
      s.total,
      s.subtotal,
      s.notes,
      s.item_count,
      s.received_amount,
      s.change_amount,
      s.created_at,
      GROUP_CONCAT(
        si.product_name || ' x' || printf('%g', si.quantity) || ' @ ' || printf('%.2f', si.unit_price) || ' = ' || printf('%.2f', si.line_total),
        ' || '
      ) AS items_breakdown
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(limit);

  return rows.map((row) => ({
    id: row.id,
    ticketNumber: row.ticket_number,
    shift: row.shift,
    cashier: row.cashier,
    paymentMethod: row.payment_method,
    subtotal: roundMoney(row.subtotal),
    total: roundMoney(row.total),
    itemCount: roundStock(row.item_count),
    notes: row.notes || "",
    receivedAmount: roundMoney(row.received_amount),
    changeAmount: roundMoney(row.change_amount),
    createdAt: row.created_at,
    items: row.items_breakdown
      ? row.items_breakdown.split(" || ").map((item) => {
          const [leftPart = "", totalPart = "0"] = item.split(" = ");
          const quantityMatch = leftPart.match(/^(.*) x([0-9.]+) @ ([0-9.]+)$/);

          if (!quantityMatch) {
            return {
              productName: leftPart,
              quantity: 0,
              unitPrice: 0,
              lineTotal: roundMoney(totalPart),
            };
          }

          return {
            productName: quantityMatch[1],
            quantity: roundStock(quantityMatch[2]),
            unitPrice: roundMoney(quantityMatch[3]),
            lineTotal: roundMoney(totalPart),
          };
        })
      : [],
  }));
}

function getLowStockProducts(limit = 8) {
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
      display_order
    FROM products
    WHERE active = 1 AND stock_initialized = 1 AND stock <= min_stock
    ORDER BY stock ASC, min_stock DESC, name COLLATE NOCASE
    LIMIT ?
  `).all(limit);

  return rows.map(mapProduct);
}

function getSalesByHour() {
  const { start, end } = getTodayBounds();
  const rows = db.prepare(`
    SELECT
      strftime('%H:00', datetime(created_at, 'localtime')) AS hour_slot,
      COALESCE(SUM(total), 0) AS total
    FROM sales
    WHERE created_at >= ? AND created_at < ?
    GROUP BY hour_slot
    ORDER BY hour_slot
  `).all(start, end);

  const salesByHourMap = new Map(
    rows.map((row) => [row.hour_slot, roundMoney(row.total)]),
  );

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

function getShiftSummary() {
  const { start, end } = getTodayBounds();
  const rows = db.prepare(`
    SELECT
      shift,
      COUNT(*) AS tickets,
      COALESCE(SUM(total), 0) AS total
    FROM sales
    WHERE created_at >= ? AND created_at < ?
    GROUP BY shift
    ORDER BY total DESC
  `).all(start, end);

  const rowMap = new Map(
    rows.map((row) => [
      row.shift,
      {
        shift: row.shift,
        tickets: Number(row.tickets || 0),
        total: roundMoney(row.total),
      },
    ]),
  );

  return STORE_SHIFTS.map((shift) =>
    rowMap.get(shift) || {
      shift,
      tickets: 0,
      total: 0,
    },
  );
}

function getDashboardSnapshot() {
  return {
    store: {
      name: STORE_NAME,
      timezone: STORE_TIME_ZONE,
      shifts: STORE_SHIFTS,
      salesPulse: {
        startHour: SALES_PULSE_START_HOUR,
        endHour: SALES_PULSE_END_HOUR,
      },
    },
    summary: getSummary(),
    products: listProducts(),
    lowStock: getLowStockProducts(),
    recentSales: getRecentSales(),
    salesByHour: getSalesByHour(),
    shiftSummary: getShiftSummary(),
    generatedAt: nowIso(),
  };
}

function getSaleById(saleId) {
  const sale = db.prepare(`
    SELECT
      id,
      ticket_number,
      shift,
      cashier,
      payment_method,
      subtotal,
      total,
      received_amount,
      change_amount,
      notes,
      item_count,
      created_at
    FROM sales
    WHERE id = ?
  `).get(saleId);

  if (!sale) {
    return null;
  }

  const items = db.prepare(`
    SELECT
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      stock_after
    FROM sale_items
    WHERE sale_id = ?
    ORDER BY id
  `).all(saleId);

  return {
    id: sale.id,
    ticketNumber: sale.ticket_number,
    shift: sale.shift,
    cashier: sale.cashier,
    paymentMethod: sale.payment_method,
    subtotal: roundMoney(sale.subtotal),
    total: roundMoney(sale.total),
    receivedAmount: roundMoney(sale.received_amount),
    changeAmount: roundMoney(sale.change_amount),
    notes: sale.notes,
    itemCount: roundStock(sale.item_count),
    createdAt: sale.created_at,
    items: items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: roundStock(item.quantity),
      unitPrice: roundMoney(item.unit_price),
      lineTotal: roundMoney(item.line_total),
      stockAfter: roundStock(item.stock_after),
    })),
  };
}

function createSale(payload) {
  const shift = normalizeText(payload.shift || "Tarde", 24) || "Tarde";
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const paymentMethod = normalizeText(payload.paymentMethod || "Efectivo", 24) || "Efectivo";
  const notes = normalizeText(payload.notes || "", 240) || null;
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];

  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para registrar la venta.");
  }

  if (incomingItems.length === 0) {
    throw createHttpError("Agrega al menos un producto al carrito.");
  }

  const saleResult = db.transaction(() => {
    const preparedItems = incomingItems.map((item) => {
      const productId = Number(item.productId);
      const quantity = roundStock(item.quantity);
      const lineTotal = roundMoney(item.lineTotal);

      if (!productId) {
        throw createHttpError("Uno de los productos no es valido.");
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw createHttpError("La cantidad de un producto no es valida.");
      }

      if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
        throw createHttpError("El monto de un producto debe ser mayor a cero.");
      }

      const product = db.prepare(`
        SELECT id, name, price, stock, stock_initialized
        FROM products
        WHERE id = ? AND active = 1
      `).get(productId);

      if (!product) {
        throw createHttpError("Uno de los productos ya no esta disponible.");
      }

      const stockBefore = roundStock(product.stock);
      const stockAfter = roundStock(stockBefore - quantity);

      if (product.stock_initialized && stockAfter < 0) {
        throw createHttpError(`No hay inventario suficiente para ${product.name}.`);
      }

      return {
        productId,
        productName: product.name,
        quantity,
        unitPrice: roundMoney(item.unitPrice || product.price),
        lineTotal,
        stockBefore,
        stockAfter,
      };
    });

    const subtotal = roundMoney(
      preparedItems.reduce((sum, item) => sum + item.lineTotal, 0),
    );
    const total = subtotal;
    const itemCount = roundStock(
      preparedItems.reduce((sum, item) => sum + item.quantity, 0),
    );

    const receivedAmount =
      paymentMethod === "Efectivo"
        ? roundMoney(payload.receivedAmount)
        : total;
    const changeAmount =
      paymentMethod === "Efectivo"
        ? roundMoney(receivedAmount - total)
        : 0;

    if (paymentMethod === "Efectivo" && receivedAmount < total) {
      throw createHttpError("El pago recibido no alcanza para completar la venta.");
    }

    const now = nowIso();
    const ticketPrefix = buildTicketPrefix(new Date());
    const ticketsToday = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sales
      WHERE ticket_number LIKE ?
    `).get(`${ticketPrefix}%`).count;
    const ticketNumber = `${ticketPrefix}-${String(Number(ticketsToday) + 1).padStart(4, "0")}`;

    const saleInsert = db.prepare(`
      INSERT INTO sales (
        ticket_number,
        shift,
        cashier,
        payment_method,
        subtotal,
        total,
        received_amount,
        change_amount,
        notes,
        item_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketNumber,
      shift,
      cashier,
      paymentMethod,
      subtotal,
      total,
      receivedAmount,
      changeAmount,
      notes,
      itemCount,
      now,
    );

    const saleId = Number(saleInsert.lastInsertRowid);
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
    const updateProductStock = db.prepare(`
      UPDATE products
      SET stock = ?, stock_initialized = 1, updated_at = ?
      WHERE id = ?
    `);
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (
        product_id,
        movement_type,
        quantity_delta,
        stock_before,
        stock_after,
        note,
        reference_type,
        reference_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    preparedItems.forEach((item) => {
      insertSaleItem.run(
        saleId,
        item.productId,
        item.productName,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.stockBefore,
        item.stockAfter,
      );

      updateProductStock.run(item.stockAfter, now, item.productId);

      insertMovement.run(
        item.productId,
        "sale",
        -item.quantity,
        item.stockBefore,
        item.stockAfter,
        `Venta ${ticketNumber}`,
        "sale",
        saleId,
        now,
      );
    });

    return saleId;
  })();

  return getSaleById(saleResult);
}

function updateProduct(productId, payload) {
  const current = db.prepare(`
    SELECT id, price, stock, min_stock, stock_initialized, active
    FROM products
    WHERE id = ?
  `).get(productId);

  if (!current) {
    throw createHttpError("No encontre el producto que quieres actualizar.", 404);
  }

  const nextPrice =
    payload.price === undefined
      ? roundMoney(current.price)
      : roundMoney(payload.price);
  const nextStock =
    payload.stock === undefined
      ? roundStock(current.stock)
      : roundStock(payload.stock);
  const nextMinStock =
    payload.minStock === undefined
      ? roundStock(current.min_stock)
      : Math.max(0, roundStock(payload.minStock));
  const nextActive =
    payload.active === undefined ? current.active : payload.active ? 1 : 0;

  if (nextPrice <= 0) {
    throw createHttpError("El precio debe ser mayor a cero.");
  }

  if (!Number.isFinite(nextStock)) {
    throw createHttpError("La existencia capturada no es valida.");
  }

  const now = nowIso();
  const note = normalizeText(payload.note || "Ajuste manual de inventario", 120);

  db.transaction(() => {
    db.prepare(`
      UPDATE products
      SET price = ?, stock = ?, min_stock = ?, stock_initialized = 1, active = ?, updated_at = ?
      WHERE id = ?
    `).run(nextPrice, nextStock, nextMinStock, nextActive, now, productId);

    if (roundStock(current.stock) !== nextStock) {
      db.prepare(`
        INSERT INTO inventory_movements (
          product_id,
          movement_type,
          quantity_delta,
          stock_before,
          stock_after,
          note,
          reference_type,
          reference_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        "adjustment",
        roundStock(nextStock - roundStock(current.stock)),
        roundStock(current.stock),
        nextStock,
        note,
        "manual",
        null,
        now,
      );
    }
  })();

  return getProductById(productId);
}

function listAllProductsForExport() {
  return db.prepare(`
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
      created_at,
      updated_at
    FROM products
    ORDER BY
      CASE category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      active DESC,
      display_order,
      name COLLATE NOCASE
  `).all();
}

function listSalesForExport() {
  return db.prepare(`
    SELECT
      s.id,
      s.ticket_number,
      s.shift,
      s.cashier,
      s.payment_method,
      s.subtotal,
      s.total,
      s.received_amount,
      s.change_amount,
      s.notes,
      s.item_count,
      s.created_at,
      si.product_id,
      si.product_name,
      si.quantity,
      si.unit_price,
      si.line_total,
      si.stock_before,
      si.stock_after
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    ORDER BY s.created_at DESC, si.id ASC
  `).all();
}

function listInventoryMovementsForExport() {
  return db.prepare(`
    SELECT
      im.id,
      im.product_id,
      p.name AS product_name,
      im.movement_type,
      im.quantity_delta,
      im.stock_before,
      im.stock_after,
      im.note,
      im.reference_type,
      im.reference_id,
      im.created_at
    FROM inventory_movements im
    JOIN products p ON p.id = im.product_id
    ORDER BY im.created_at DESC, im.id DESC
  `).all();
}

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
    "Estado",
    "Activo",
    "Actualizado",
  ]);
  styleTableHeader(inventorySheet.getRow(4));
  products.forEach((row) => {
    inventorySheet.addRow([
      row.id,
      row.name,
      CATEGORY_LABELS[row.category] || "General",
      row.unit,
      roundMoney(row.price),
      roundStock(row.stock),
      roundStock(row.min_stock),
      getStockStatus(roundStock(row.stock), roundStock(row.min_stock), row.stock_initialized),
      row.active ? "Si" : "No",
      row.updated_at,
    ]);
  });
  autoFitColumns(inventorySheet, [8, 32, 16, 10, 12, 12, 12, 14, 10, 24]);

  const salesSheet = workbook.addWorksheet("Ventas");
  styleSheetHeader(salesSheet, `${STORE_NAME} - Ventas`, `Todas las ventas registradas`);
  salesSheet.addRow([]);
  salesSheet.addRow([
    "Ticket",
    "Fecha",
    "Turno",
    "Cajero",
    "Metodo",
    "Producto",
    "Cantidad",
    "Precio unitario",
    "Total linea",
    "Total ticket",
    "Recibido",
    "Cambio",
    "Notas",
  ]);
  styleTableHeader(salesSheet.getRow(4));
  sales.forEach((row) => {
    salesSheet.addRow([
      row.ticket_number,
      row.created_at,
      row.shift,
      row.cashier,
      row.payment_method,
      row.product_name || "",
      row.quantity == null ? "" : roundStock(row.quantity),
      row.unit_price == null ? "" : roundMoney(row.unit_price),
      row.line_total == null ? "" : roundMoney(row.line_total),
      roundMoney(row.total),
      roundMoney(row.received_amount),
      roundMoney(row.change_amount),
      row.notes || "",
    ]);
  });
  autoFitColumns(salesSheet, [18, 24, 12, 20, 16, 28, 12, 14, 14, 14, 14, 14, 30]);

  const movementSheet = workbook.addWorksheet("Movimientos");
  styleSheetHeader(movementSheet, `${STORE_NAME} - Movimientos`, `Historial de inventario`);
  movementSheet.addRow([]);
  movementSheet.addRow([
    "Fecha",
    "Producto",
    "Tipo",
    "Delta",
    "Antes",
    "Despues",
    "Referencia",
    "Nota",
  ]);
  styleTableHeader(movementSheet.getRow(4));
  movements.forEach((row) => {
    movementSheet.addRow([
      row.created_at,
      row.product_name,
      row.movement_type,
      roundStock(row.quantity_delta),
      roundStock(row.stock_before),
      roundStock(row.stock_after),
      row.reference_type ? `${row.reference_type}:${row.reference_id || ""}` : "",
      row.note || "",
    ]);
  });
  autoFitColumns(movementSheet, [24, 30, 16, 12, 12, 12, 18, 36]);

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  CATEGORY_LABELS,
  createSale,
  ensureCatalogSeeded,
  exportWorkbookReport,
  getDashboardSnapshot,
  getProductById,
  importCatalogFromWorkbook,
  listProducts,
  resolveWorkbookPath,
  updateProduct,
};
