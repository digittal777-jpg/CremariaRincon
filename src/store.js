const crypto = require("node:crypto");
const fs = require("node:fs");

const ExcelJS = require("exceljs");

const { parseWorkbookCatalog } = require("./catalogParser");
const {
  DEFAULT_WORKBOOK_PATHS,
  SALES_PULSE_END_HOUR,
  SALES_PULSE_START_HOUR,
  STORE_BRANCHES,
  STORE_BRANCH_LABELS,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
} = require("./config");
const { getDb, nowIso } = require("./db");

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

function listStoreDaySales(baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        shift,
        cashier,
        branch,
        payment_method,
        total,
        subtotal,
        item_count,
        created_at
      FROM sales
      ORDER BY created_at DESC
    `).all()
    : db.prepare(`
      SELECT
        id,
        shift,
        cashier,
        branch,
        payment_method,
        total,
        subtotal,
        item_count,
        created_at
      FROM sales
      WHERE branch = ?
      ORDER BY created_at DESC
    `).all(normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}

function listStoreDaySaleItems(baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        s.created_at,
        s.branch,
        si.product_id,
        si.product_name,
        si.quantity,
        si.line_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ORDER BY s.created_at DESC, si.id DESC
    `).all()
    : db.prepare(`
      SELECT
        s.created_at,
        s.branch,
        si.product_id,
        si.product_name,
        si.quantity,
        si.line_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.branch = ?
      ORDER BY s.created_at DESC, si.id DESC
    `).all(normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}

function getQuickImportRows(branch = STORE_BRANCHES[0]) {
  const soldTodayByProductId = new Map();
  listStoreDaySaleItems(new Date(), branch).forEach((item) => {
    const currentValue = soldTodayByProductId.get(item.product_id) || 0;
    soldTodayByProductId.set(
      item.product_id,
      roundStock(currentValue + roundStock(item.quantity)),
    );
  });

  const rows = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.price,
      p.category,
      p.unit,
      p.type_code,
      p.stock,
      p.min_stock,
      p.stock_initialized,
      p.active,
      p.display_order
    FROM products p
    WHERE p.active = 1
    ORDER BY
      CASE p.category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      p.stock_initialized ASC,
      p.display_order,
      p.name COLLATE NOCASE
  `).all();

  return rows.map((row) => ({
    ...mapProduct(row),
    soldToday: roundStock(soldTodayByProductId.get(row.id) || 0),
    recordedStock: roundStock(row.stock),
  }));
}

function getQuickImportProductId(payload) {
  const candidateIds = [payload.productId, payload.id, payload.product_id];

  for (const candidateId of candidateIds) {
    const productId = Number(candidateId);
    if (Number.isInteger(productId) && productId > 0) {
      return productId;
    }
  }

  return null;
}

function findQuickImportProduct(payload) {
  // 1. Intentar por ID (varios nombres posibles)
  let productId = getQuickImportProductId(payload);
  if (productId) {
    const byId = db.prepare(`
      SELECT id, name, stock, active FROM products WHERE id = ?
    `).get(productId);
    if (byId) {
      return byId;
    }
  }

  // 2. Intentar por nombre (ultra tolerante)
  const rawName = String(
    payload.productName || payload.name || payload.product_name || ""
  ).trim();

  if (!rawName) {
    return null;
  }

  // Búsqueda exacta
  let product = db.prepare(`
    SELECT id, name, stock, active
    FROM products
    WHERE active = 1 AND UPPER(TRIM(name)) = UPPER(TRIM(?))
    LIMIT 1
  `).get(rawName);

  if (product) {
    return product;
  }

  // Búsqueda parcial (último recurso)
  product = db.prepare(`
    SELECT id, name, stock, active
    FROM products
    WHERE active = 1 AND UPPER(TRIM(name)) LIKE '%' || UPPER(TRIM(?)) || '%'
    ORDER BY LENGTH(name) ASC, id ASC
    LIMIT 1
  `).get(rawName);

  if (product) {
    return product;
  }

  return null;
}

function buildTicketPrefix(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `RIN-${year}${month}${day}`;
}

function getSummary(branch = STORE_BRANCHES[0]) {
  const todaySales = listStoreDaySales(new Date(), branch);
  const todaySaleItems = listStoreDaySaleItems(new Date(), branch);

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

function getRecentSales(limit = 8, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        s.id,
        s.ticket_number,
        s.shift,
        s.cashier,
        s.branch,
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
    `).all(limit)
    : db.prepare(`
      SELECT
        s.id,
        s.ticket_number,
        s.shift,
        s.cashier,
        s.branch,
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
      WHERE s.branch = ?
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    ticketNumber: row.ticket_number,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
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

function getSalesByHour(branch = STORE_BRANCHES[0]) {
  const salesByHourMap = new Map();

  listStoreDaySales(new Date(), branch).forEach((sale) => {
    const hourSlot = getStoreHourLabel(sale.created_at);
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

function getRegisterEventsForStoreDay(shift, baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        opening_amount,
        counted_amount,
        expected_cash,
        difference_amount,
        cash_sales,
        non_cash_sales,
        total_sales,
        notes,
        created_at
      FROM register_events
      WHERE shift = ?
      ORDER BY created_at DESC, id DESC
    `).all(shift)
    : db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        opening_amount,
        counted_amount,
        expected_cash,
        difference_amount,
        cash_sales,
        non_cash_sales,
        total_sales,
        notes,
        created_at
      FROM register_events
      WHERE shift = ? AND branch = ?
      ORDER BY created_at DESC, id DESC
    `).all(shift, normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}

function getRegisterSummary(shift, branch = STORE_BRANCHES[0]) {
  const normalizedShift = normalizeText(shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  if (!STORE_SHIFTS.includes(normalizedShift)) {
    throw createHttpError("Selecciona un turno valido para la caja.");
  }

  const sales = listStoreDaySales(new Date(), normalizedBranch).filter((sale) => sale.shift === normalizedShift);
  const events = getRegisterEventsForStoreDay(normalizedShift, new Date(), normalizedBranch);
  const startEvent = events.find((event) => event.event_type === "start") || null;
  const openingAmount = roundMoney(startEvent?.opening_amount || 0);
  const totalSales = roundMoney(
    sales.reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const cashSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Efectivo")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const cardSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Tarjeta")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const transferSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Transferencia")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const nonCashSales = roundMoney(totalSales - cashSales);

  return {
    shift: normalizedShift,
    openingAmount,
    cashSales,
    cardSales,
    transferSales,
    nonCashSales,
    totalSales,
    expectedCash: roundMoney(openingAmount + cashSales),
    tickets: sales.length,
    lastStartAt: startEvent?.created_at || null,
    lastStartCashier: startEvent?.cashier || null,
    quickCuts: events.filter((event) => event.event_type === "quick_cut").length,
    finalCuts: events.filter((event) => event.event_type === "final_cut").length,
  };
}

function getRegisterEventById(eventId) {
  const row = db.prepare(`
    SELECT
      id,
      event_type,
      shift,
      cashier,
      branch,
      opening_amount,
      counted_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    FROM register_events
    WHERE id = ?
  `).get(eventId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    eventType: row.event_type,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    openingAmount: roundMoney(row.opening_amount),
    countedAmount: roundMoney(row.counted_amount),
    expectedCash: roundMoney(row.expected_cash),
    differenceAmount: roundMoney(row.difference_amount),
    cashSales: roundMoney(row.cash_sales),
    nonCashSales: roundMoney(row.non_cash_sales),
    totalSales: roundMoney(row.total_sales),
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

function getInventoryMovementById(movementId) {
  const row = db.prepare(`
    SELECT
      im.id,
      im.product_id,
      im.branch,
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
    WHERE im.id = ?
  `).get(movementId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    branch: row.branch,
    movementType: row.movement_type,
    quantityDelta: roundStock(row.quantity_delta),
    stockBefore: roundStock(row.stock_before),
    stockAfter: roundStock(row.stock_after),
    note: row.note || "",
    referenceType: row.reference_type || "",
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
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
    `).all(normalizedBranch, limit)).map((event) => ({
    kind: "register",
    id: event.id,
    createdAt: event.created_at,
    title: getRegisterEventTypeLabel(event.event_type),
    subtitle: `${getBranchLabel(event.branch)} - ${event.shift} - ${event.cashier}`,
    amount: event.counted_amount,
    amountPrefix: "",
    tag: "Caja",
    differenceAmount: roundMoney(event.difference_amount),
  }));

  const inventoryMovements = getRecentInventoryMovements(limit, normalizedBranch).map((movement) => ({
    kind: "inventory",
    id: movement.id,
    createdAt: movement.createdAt,
    title: movement.productName,
    subtitle: `${getBranchLabel(movement.branch)} - ${getInventoryMovementTypeLabel(movement.movementType)}`,
    amount: Math.abs(roundStock(movement.quantityDelta)),
    amountPrefix: roundStock(movement.quantityDelta) >= 0 ? "+" : "-",
    tag: "Inventario",
  }));

  return [...sales, ...registerEvents, ...inventoryMovements]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);
}

function getRecentRegisterEvents(limit = 16, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
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
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    countedAmount: roundMoney(row.counted_amount),
    differenceAmount: roundMoney(row.difference_amount),
    createdAt: row.created_at,
  }));
}

function getRecentInventoryMovements(limit = 16, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        im.id,
        im.product_id,
        im.branch,
        p.name AS product_name,
        im.movement_type,
        im.quantity_delta,
        im.created_at
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        im.id,
        im.product_id,
        im.branch,
        p.name AS product_name,
        im.movement_type,
        im.quantity_delta,
        im.created_at
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      WHERE im.branch = ?
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    branch: row.branch,
    movementType: row.movement_type,
    quantityDelta: roundStock(row.quantity_delta),
    createdAt: row.created_at,
  }));
}

function initializeTestCashiers() {
  const existingCount = db.prepare("SELECT COUNT(*) AS count FROM cashiers").get().count;
  if (existingCount > 0) {
    return;
  }

  const testCashiers = [
    { name: "Juan", branch: "carrizal", password: "1234" },
    { name: "Maria", branch: "miradores", password: "1234" },
    { name: "Pedro", branch: "carrizal", password: "1234" },
  ];

  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO cashiers (name, branch, password_hash, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `);

  testCashiers.forEach((cashier) => {
    const passwordHash = JSON.stringify(hashCashierPassword(cashier.password));
    insert.run(cashier.name, cashier.branch, passwordHash, now, now);
  });
}

function startRegister(payload) {
  const summary = getRegisterSummary(payload.shift, payload.branch);
  const shift = summary.shift;
  const branch = normalizeBranch(payload.branch);
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const openingAmount = roundMoney(payload.openingAmount);
  const notes = normalizeText(payload.notes || "", 180) || null;

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    throw createHttpError("El monto inicial de caja debe ser cero o mayor.");
  }

  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
      opening_amount,
      counted_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "start",
    shift,
    cashier,
    branch,
    openingAmount,
    openingAmount,
    openingAmount,
    0,
    0,
    0,
    0,
    notes,
    now,
  );

  return {
    eventId: Number(insert.lastInsertRowid),
    summary: getRegisterSummary(shift, branch),
  };
}

function createRegisterCut(payload) {
  const eventType = normalizeText(payload.eventType || "quick_cut", 24).toLowerCase();
  if (!["quick_cut", "final_cut"].includes(eventType)) {
    throw createHttpError("El tipo de corte no es valido.");
  }

  const summary = getRegisterSummary(payload.shift, payload.branch);
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const countedAmount = roundMoney(
    payload.countedAmount === undefined ? summary.expectedCash : payload.countedAmount,
  );
  const notes = normalizeText(payload.notes || "", 180) || null;

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw createHttpError("El efectivo contado debe ser cero o mayor.");
  }

  const now = nowIso();
  const differenceAmount = roundMoney(countedAmount - summary.expectedCash);
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
      opening_amount,
      counted_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    summary.shift,
    cashier,
    branch,
    summary.openingAmount,
    countedAmount,
    summary.expectedCash,
    differenceAmount,
    summary.cashSales,
    summary.nonCashSales,
    summary.totalSales,
    notes,
    now,
  );

  return {
    eventId: Number(insert.lastInsertRowid),
    differenceAmount,
    summary: getRegisterSummary(summary.shift, branch),
  };
}

function getDashboardSnapshot(branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  return {
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
    products: listProducts(),
    lowStock: getLowStockProducts(),
    recentSales: getRecentSales(8, normalizedBranch),
    recentActivity: getRecentActivity(18, normalizedBranch),
    salesByHour: getSalesByHour(normalizedBranch),
    shiftSummary: getShiftSummary(normalizedBranch),
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
      branch,
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
    branch: sale.branch,
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
  const branch = normalizeBranch(payload.branch);
  const paymentMethod = normalizeText(payload.paymentMethod || "Efectivo", 24) || "Efectivo";
  const notes = normalizeText(payload.notes || "", 240) || null;
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];

  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para registrar la venta.");
  }

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

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
    `).run(
      ticketNumber,
      shift,
      cashier,
      branch,
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
        branch,
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
  const branch = normalizeBranch(payload.branch);

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
          branch,
          quantity_delta,
          stock_before,
          stock_after,
          note,
          reference_type,
          reference_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        "adjustment",
        branch,
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

function applyQuickInventoryEntry(payload) {
  const mode = normalizeText(payload.mode || "initial", 24).toLowerCase();
  const branch = normalizeBranch(payload.branch);
  const current = findQuickImportProduct(payload);

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (!current) {
    throw createHttpError("Selecciona un producto valido para la captura rapida.");
  }

  if (!["initial", "supplier"].includes(mode)) {
    throw createHttpError("El tipo de captura rapida no es valido.");
  }

  if (!current || !current.active) {
    throw createHttpError("El producto ya no esta disponible para inventario.", 404);
  }

  const productId = current.id;
  const stockBefore = roundStock(current.stock);
  const supplierName = normalizeText(payload.supplierName || "", 60);
  const direction = normalizeText(payload.direction || "in", 12).toLowerCase();
  const customNote = normalizeText(payload.note || "", 120);
  const now = nowIso();

  let quantityDelta = 0;
  let stockAfter = stockBefore;
  let movementType = "initial";
  let referenceType = "quick-import";
  let note = customNote;

  if (mode === "initial") {
    quantityDelta = roundStock(payload.stock);
    if (!Number.isFinite(quantityDelta) || quantityDelta < 0) {
      throw createHttpError("El inventario inicial a sumar debe ser un numero igual o mayor a cero.");
    }

    stockAfter = roundStock(stockBefore + quantityDelta);
    movementType = "initial";
    note = note || "Inventario inicial sumado";
  }

  if (mode === "supplier") {
    const rawQuantity = roundStock(payload.quantity);
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
      throw createHttpError("La cantidad del proveedor debe ser mayor a cero.");
    }

    if (!["in", "out"].includes(direction)) {
      throw createHttpError("La direccion del movimiento con proveedor no es valida.");
    }

    quantityDelta = direction === "out" ? roundStock(-rawQuantity) : rawQuantity;
    stockAfter = roundStock(stockBefore + quantityDelta);
    if (stockAfter < 0) {
      throw createHttpError("No puedes retirar mas producto del que existe en inventario.");
    }

    movementType = direction === "out" ? "supplier_out" : "supplier";
    referenceType = "supplier";
    note =
      note ||
      (supplierName
        ? direction === "out"
          ? `Proveedor retiro producto: ${supplierName}`
          : `Entrada de proveedor: ${supplierName}`
        : direction === "out"
          ? "Salida con proveedor"
          : "Entrada de proveedor");
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE products
      SET stock = ?, stock_initialized = 1, updated_at = ?
      WHERE id = ?
    `).run(stockAfter, now, productId);

    db.prepare(`
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
    `).run(
      productId,
      movementType,
      branch,
      quantityDelta,
      stockBefore,
      stockAfter,
      note,
      referenceType,
      null,
      now,
    );
  })();

  return getProductById(productId);
}

function updateSaleAdmin(saleId, payload) {
  const current = db.prepare(`
    SELECT id, shift, cashier, payment_method, total, received_amount, notes
    FROM sales
    WHERE id = ?
  `).get(saleId);

  if (!current) {
    throw createHttpError("No encontre la venta que quieres editar.", 404);
  }

  const nextShift = normalizeText(payload.shift || current.shift, 24) || current.shift;
  const nextCashier = normalizeText(payload.cashier || current.cashier, 60) || current.cashier;
  const nextPaymentMethod =
    normalizeText(payload.paymentMethod || current.payment_method, 24) || current.payment_method;
  const nextNotes = normalizeText(payload.notes ?? current.notes ?? "", 240) || null;
  const receivedAmount =
    nextPaymentMethod === "Efectivo"
      ? roundMoney(
          payload.receivedAmount === undefined ? current.received_amount : payload.receivedAmount,
        )
      : roundMoney(current.total);
  const changeAmount =
    nextPaymentMethod === "Efectivo" ? roundMoney(receivedAmount - roundMoney(current.total)) : 0;

  if (!STORE_SHIFTS.includes(nextShift)) {
    throw createHttpError("Selecciona un turno valido para la venta.");
  }

  if (nextPaymentMethod === "Efectivo" && receivedAmount < roundMoney(current.total)) {
    throw createHttpError("El efectivo recibido no alcanza para la venta.");
  }

  db.prepare(`
    UPDATE sales
    SET shift = ?, cashier = ?, payment_method = ?, received_amount = ?, change_amount = ?, notes = ?
    WHERE id = ?
  `).run(
    nextShift,
    nextCashier,
    nextPaymentMethod,
    receivedAmount,
    changeAmount,
    nextNotes,
    saleId,
  );

  return getSaleById(saleId);
}

function updateRegisterEventAdmin(eventId, payload) {
  const current = getRegisterEventById(eventId);
  if (!current) {
    throw createHttpError("No encontre el corte o inicio de caja.", 404);
  }

  const nextShift = normalizeText(payload.shift || current.shift, 24) || current.shift;
  const nextCashier = normalizeText(payload.cashier || current.cashier, 60) || current.cashier;
  const nextOpeningAmount = roundMoney(
    payload.openingAmount === undefined ? current.openingAmount : payload.openingAmount,
  );
  const nextCountedAmount = roundMoney(
    payload.countedAmount === undefined ? current.countedAmount : payload.countedAmount,
  );
  const nextNotes = normalizeText(payload.notes ?? current.notes ?? "", 180) || null;
  const nextExpectedCash = roundMoney(
    payload.expectedCash === undefined ? current.expectedCash : payload.expectedCash,
  );
  const nextCashSales = roundMoney(
    payload.cashSales === undefined ? current.cashSales : payload.cashSales,
  );
  const nextNonCashSales = roundMoney(
    payload.nonCashSales === undefined ? current.nonCashSales : payload.nonCashSales,
  );
  const nextTotalSales = roundMoney(
    payload.totalSales === undefined ? current.totalSales : payload.totalSales,
  );

  if (!STORE_SHIFTS.includes(nextShift)) {
    throw createHttpError("Selecciona un turno valido para caja.");
  }

  db.prepare(`
    UPDATE register_events
    SET shift = ?, cashier = ?, opening_amount = ?, counted_amount = ?, expected_cash = ?, difference_amount = ?, cash_sales = ?, non_cash_sales = ?, total_sales = ?, notes = ?
    WHERE id = ?
  `).run(
    nextShift,
    nextCashier,
    nextOpeningAmount,
    nextCountedAmount,
    nextExpectedCash,
    roundMoney(nextCountedAmount - nextExpectedCash),
    nextCashSales,
    nextNonCashSales,
    nextTotalSales,
    nextNotes,
    eventId,
  );

  return getRegisterEventById(eventId);
}

function updateInventoryMovementAdmin(movementId, payload) {
  const current = getInventoryMovementById(movementId);
  if (!current) {
    throw createHttpError("No encontre el movimiento de inventario.", 404);
  }

  const nextNote = normalizeText(payload.note ?? current.note ?? "", 120) || null;

  if (current.movementType === "sale") {
    db.prepare(`
      UPDATE inventory_movements
      SET note = ?
      WHERE id = ?
    `).run(nextNote, movementId);

    return getInventoryMovementById(movementId);
  }

  const nextQuantityDelta = roundStock(
    payload.quantityDelta === undefined ? current.quantityDelta : payload.quantityDelta,
  );
  const quantityDiff = roundStock(nextQuantityDelta - current.quantityDelta);
  const currentProduct = db.prepare(`
    SELECT stock
    FROM products
    WHERE id = ?
  `).get(current.productId);

  if (roundStock((currentProduct?.stock || 0) + quantityDiff) < 0) {
    throw createHttpError("Ese cambio dejaria el inventario del producto en negativo.");
  }

  db.transaction(() => {
    if (quantityDiff !== 0) {
      db.prepare(`
        UPDATE inventory_movements
        SET quantity_delta = ?, note = ?
        WHERE id = ?
      `).run(nextQuantityDelta, nextNote, movementId);

      let runningBefore = current.stockBefore;
      const fullRows = db.prepare(`
        SELECT id, quantity_delta
        FROM inventory_movements
        WHERE product_id = ? AND (created_at > ? OR (created_at = ? AND id >= ?))
        ORDER BY created_at ASC, id ASC
      `).all(current.productId, current.createdAt, current.createdAt, current.id);

      fullRows.forEach((row, index) => {
        const delta = row.id === movementId ? nextQuantityDelta : roundStock(row.quantity_delta);
        const before = index === 0 ? current.stockBefore : runningBefore;
        const after = roundStock(before + delta);
        db.prepare(`
          UPDATE inventory_movements
          SET stock_before = ?, stock_after = ?
          WHERE id = ?
        `).run(before, after, row.id);
        runningBefore = after;
      });

      db.prepare(`
        UPDATE products
        SET stock = stock + ?, updated_at = ?
        WHERE id = ?
      `).run(quantityDiff, nowIso(), current.productId);
    } else {
      db.prepare(`
        UPDATE inventory_movements
        SET note = ?
        WHERE id = ?
      `).run(nextNote, movementId);
    }
  })();

  return getInventoryMovementById(movementId);
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

function hashCashierPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyCashierPassword(password, stored) {
  if (!stored) {
    return false;
  }

  try {
    const { salt, hash } = JSON.parse(stored);
    const candidate = hashCashierPassword(password, salt);
    return crypto.timingSafeEqual(
      Buffer.from(candidate.hash, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch (_error) {
    return false;
  }
}

function authenticateCashier(name, branch, password) {
  const normalizedName = normalizeText(name, 60);
  const normalizedBranch = normalizeBranch(branch);
  const row = db.prepare(`
    SELECT password_hash
    FROM cashiers
    WHERE name = ? AND branch = ? AND active = 1
  `).get(normalizedName, normalizedBranch);

  if (!row) {
    return false;
  }

  return verifyCashierPassword(password, row.password_hash);
}

function createCashier(name, branch, password) {
  const normalizedName = normalizeText(name, 60);
  const normalizedBranch = normalizeBranch(branch);
  const normalizedPassword = String(password || "").trim();

  if (!normalizedName) {
    throw createHttpError("Escribe el nombre del cajero.");
  }

  if (!STORE_BRANCHES.includes(normalizedBranch)) {
    throw createHttpError("Sucursal no valida.");
  }

  if (normalizedPassword.length < 4) {
    throw createHttpError("La contrasena del cajero debe tener al menos 4 caracteres.");
  }

  const existingCashier = db.prepare(`
    SELECT id
    FROM cashiers
    WHERE name = ? AND branch = ?
  `).get(normalizedName, normalizedBranch);
  if (existingCashier) {
    throw createHttpError("Ya existe un cajero con ese nombre en esa sucursal.");
  }

  const now = nowIso();
  const { salt, hash } = hashCashierPassword(normalizedPassword);
  const insert = db.prepare(`
    INSERT INTO cashiers (name, branch, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(normalizedName, normalizedBranch, JSON.stringify({ salt, hash }), now, now);

  return {
    id: Number(insert.lastInsertRowid),
    name: normalizedName,
    branch: normalizedBranch,
    branchLabel: getBranchLabel(normalizedBranch),
    active: true,
  };
}

function listCashiers(branch = null) {
  const normalizedBranch =
    branch == null || branch === ""
      ? null
      : normalizeBranch(branch, { allowAll: true });
  const query = normalizedBranch && normalizedBranch !== ALL_BRANCHES
    ? "SELECT id, name, branch, active, created_at FROM cashiers WHERE branch = ? ORDER BY name"
    : "SELECT id, name, branch, active, created_at FROM cashiers ORDER BY branch, name";
  const statement = db.prepare(query);
  const rows = normalizedBranch && normalizedBranch !== ALL_BRANCHES
    ? statement.all(normalizedBranch)
    : statement.all();
  return rows.map((cashier) => ({
    ...cashier,
    branchLabel: getBranchLabel(cashier.branch),
    active: Boolean(cashier.active),
  }));
}

function updateCashier(cashierId, updates) {
  const current = db.prepare("SELECT * FROM cashiers WHERE id = ?").get(cashierId);
  if (!current) {
    throw createHttpError("Cajero no encontrado.", 404);
  }

  const nextName =
    updates.name !== undefined ? normalizeText(updates.name, 60) : current.name;
  const nextBranch =
    updates.branch !== undefined ? normalizeBranch(updates.branch) : current.branch;
  const nextActive = updates.active !== undefined ? Boolean(updates.active) : Boolean(current.active);

  if (!nextName) {
    throw createHttpError("Escribe el nombre del cajero.");
  }

  if (updates.password !== undefined && String(updates.password).trim() !== "" && String(updates.password).trim().length < 4) {
    throw createHttpError("La nueva contrasena debe tener al menos 4 caracteres.");
  }

  if (!STORE_BRANCHES.includes(nextBranch)) {
    throw createHttpError("Sucursal no valida.");
  }

  const conflictingCashier = db.prepare(`
    SELECT id
    FROM cashiers
    WHERE name = ? AND branch = ? AND id != ?
  `).get(nextName, nextBranch, cashierId);
  if (conflictingCashier) {
    throw createHttpError("Ya existe otro cajero con ese nombre en esa sucursal.");
  }

  const safePasswordHash =
    updates.password !== undefined && String(updates.password).trim() !== ""
      ? JSON.stringify(hashCashierPassword(String(updates.password).trim()))
      : current.password_hash;

  db.prepare(`
    UPDATE cashiers
    SET name = ?, branch = ?, password_hash = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextBranch, safePasswordHash, nextActive ? 1 : 0, nowIso(), cashierId);

  return {
    id: cashierId,
    name: nextName,
    branch: nextBranch,
    branchLabel: getBranchLabel(nextBranch),
    active: nextActive,
  };
}

function deleteCashier(cashierId) {
  const result = db.prepare("DELETE FROM cashiers WHERE id = ?").run(cashierId);
  if (result.changes === 0) {
    throw createHttpError("Cajero no encontrado.", 404);
  }
}

module.exports = {
  applyQuickInventoryEntry,
  authenticateCashier,
  CATEGORY_LABELS,
  createCashier,
  createRegisterCut,
  createSale,
  deleteCashier,
  ensureCatalogSeeded,
  exportWorkbookReport,
  getDashboardSnapshot,
  getInventoryMovementById,
  getProductById,
  getQuickImportRows,
  getRecentActivity,
  getRecentSales,
  getRecentInventoryMovements,
  getRecentRegisterEvents,
  getRegisterEventById,
  getRegisterSummary,
  getSaleById,
  importCatalogFromWorkbook,
  initializeTestCashiers,
  listCashiers,
  listProducts,
  resolveWorkbookPath,
  startRegister,
  updateCashier,
  updateInventoryMovementAdmin,
  updateProduct,
  updateRegisterEventAdmin,
  updateSaleAdmin,
};
