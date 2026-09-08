const fs = require("node:fs");
const path = require("node:path");

const ExcelJS = require("exceljs");

const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getMeasurementUnitRecord,
  getProductCategoryRecord,
  listMeasurementUnits,
  listProductCategories,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

const FIELD_ALIASES = {
  name: ["producto", "nombre", "articulo", "articulo/servicio", "descripcion", "description"],
  price: ["precio", "precio venta", "precio_venta", "venta", "price"],
  category: ["categoria", "departamento", "linea", "familia", "category"],
  unit: ["unidad", "medida", "u_medida", "unit"],
  stock: ["stock", "existencia", "inventario", "cantidad"],
  minStock: ["minimo", "stock minimo", "min_stock", "minimo inventario"],
  cost: ["costo", "precio costo", "costo unitario", "cost"],
  sku: ["sku", "codigo", "codigo interno", "clave"],
  barcode: ["barcode", "codigo barras", "codigo de barras", "ean", "upc"],
  brand: ["marca", "brand"],
  supplierName: ["proveedor", "supplier"],
  packSize: ["contenido", "tamano paquete", "tamano de empaque", "pack size"],
  active: ["activo", "active", "estatus"],
};

function normalizeLookup(value) {
  return normalizeText(value || "", 120)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value || "", 120);
}

function parseNumberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === "object" && typeof value.result === "number") {
    return value.result;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return Number.NaN;
  }
  const normalized = raw.replace(/[^0-9,.-]/g, "");
  if (!normalized) {
    return Number.NaN;
  }
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseBooleanValue(value, fallback = true) {
  const normalized = normalizeLookup(value);
  if (!normalized) {
    return fallback;
  }
  if (["no", "false", "0", "inactivo", "baja", "desactivado"].includes(normalized)) {
    return false;
  }
  if (["si", "true", "1", "activo", "alta", "yes"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function cellToText(value) {
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
    if (typeof value.result === "string" || typeof value.result === "number") {
      return String(value.result).trim();
    }
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(current.trim());
      current = "";
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    current += char;
  }

  row.push(current.trim());
  if (row.some((value) => value !== "")) {
    rows.push(row);
  }
  return rows;
}

async function readTabularRows(filePath, originalName = "") {
  const extension = path.extname(originalName || filePath).toLowerCase();
  if (extension === ".csv") {
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return parseCsvRows(content);
  }

  if (extension !== ".xlsx" && extension !== ".xlsm") {
    throw createHttpError("Sube un archivo CSV o Excel .xlsx valido para el onboarding.");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (_error) {
    throw createHttpError("No pude leer el Excel. Guarda el archivo como .xlsx y vuelve a intentarlo.");
  }
  const worksheet = workbook.worksheets.find((sheet) => sheet.rowCount > 0);
  if (!worksheet) {
    throw createHttpError("El Excel no trae hojas con datos.");
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let col = 1; col <= row.cellCount; col += 1) {
      values.push(cellToText(row.getCell(col).value));
    }
    if (values.some((value) => value !== "")) {
      rows.push(values);
    }
  });
  return rows;
}

function findHeaderRow(rows) {
  const maxRows = Math.min(rows.length, 20);
  let best = null;
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const normalizedCells = row.map(normalizeLookup);
    const score = Object.values(FIELD_ALIASES).reduce((sum, aliases) => (
      sum + (normalizedCells.some((cell) => aliases.includes(cell)) ? 1 : 0)
    ), 0);
    if (!best || score > best.score) {
      best = { rowIndex, score };
    }
  }
  if (!best || best.score < 2) {
    throw createHttpError("No pude detectar encabezados. Necesito al menos columnas de producto y precio.");
  }
  return best.rowIndex;
}

function getColumnsFromHeader(row = []) {
  return row.map((label, index) => ({
    index,
    label: normalizeHeader(label) || `Columna ${index + 1}`,
  }));
}

function suggestMapping(columns = []) {
  const result = {};
  columns.forEach((column) => {
    const normalized = normalizeLookup(column.label);
    Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
      if (result[field] !== undefined) {
        return;
      }
      if (aliases.includes(normalized)) {
        result[field] = column.index;
      }
    });
  });
  return result;
}

function normalizeMapping(rawMapping = {}, columns = []) {
  const suggested = suggestMapping(columns);
  const mapping = { ...suggested };
  Object.entries(rawMapping || {}).forEach(([field, value]) => {
    if (!Object.prototype.hasOwnProperty.call(FIELD_ALIASES, field)) {
      return;
    }
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < columns.length) {
      mapping[field] = index;
    }
  });
  return mapping;
}

function getMappedValue(row, mapping, field) {
  const index = mapping[field];
  if (!Number.isInteger(index)) {
    return "";
  }
  return cellToText(row[index]);
}

function resolveCategoryForImport(value) {
  const category = getProductCategoryRecord(value, { includeInactive: true });
  if (category) {
    return { record: category, warning: "" };
  }
  const fallback = getProductCategoryRecord("general", { includeInactive: true })
    || listProductCategories({ includeInactive: false })[0]
    || null;
  return {
    record: fallback,
    warning: value ? `Categoria "${value}" no existe; se usara "${fallback?.label || "general"}".` : "",
  };
}

function resolveUnitForImport(value) {
  const unit = getMeasurementUnitRecord(value, { includeInactive: true });
  if (unit) {
    return { record: unit, warning: "" };
  }
  const fallback = getMeasurementUnitRecord("pza", { includeInactive: true })
    || listMeasurementUnits({ includeInactive: false })[0]
    || null;
  return {
    record: fallback,
    warning: value ? `Unidad "${value}" no existe; se usara "${fallback?.label || "pza"}".` : "",
  };
}

function getExistingProductsByBranch(branch) {
  const rows = db.prepare(`
    SELECT id, name, sku, barcode, active
    FROM products
    WHERE branch = ?
  `).all(branch);
  const byName = new Map();
  const bySku = new Map();
  const byBarcode = new Map();
  rows.forEach((row) => {
    byName.set(normalizeLookup(row.name), row);
    if (row.sku) bySku.set(normalizeLookup(row.sku), row);
    if (row.barcode) byBarcode.set(normalizeLookup(row.barcode), row);
  });
  return { rows, byName, bySku, byBarcode };
}

function buildPreviewRows(rows, headerRowIndex, mapping, branch) {
  const existing = getExistingProductsByBranch(branch);
  const seenNames = new Map();
  const seenSkus = new Map();
  const seenBarcodes = new Map();
  const previewRows = [];

  rows.slice(headerRowIndex + 1).forEach((row, relativeIndex) => {
    const rowNumber = headerRowIndex + relativeIndex + 2;
    const name = normalizeText(getMappedValue(row, mapping, "name"), 80);
    if (!name && row.every((value) => !String(value || "").trim())) {
      return;
    }
    const priceRaw = getMappedValue(row, mapping, "price");
    const price = roundMoney(parseNumberValue(priceRaw));
    const stockRaw = getMappedValue(row, mapping, "stock");
    const minStockRaw = getMappedValue(row, mapping, "minStock");
    const costRaw = getMappedValue(row, mapping, "cost");
    const packSizeRaw = getMappedValue(row, mapping, "packSize");
    const categoryRaw = normalizeText(getMappedValue(row, mapping, "category"), 40).toLowerCase();
    const unitRaw = normalizeText(getMappedValue(row, mapping, "unit"), 24).toLowerCase();
    const sku = normalizeText(getMappedValue(row, mapping, "sku"), 48) || "";
    const barcode = normalizeText(getMappedValue(row, mapping, "barcode"), 64) || "";
    const category = resolveCategoryForImport(categoryRaw || "general");
    const unit = resolveUnitForImport(unitRaw || "pza");
    const errors = [];
    const warnings = [];

    if (!name) errors.push("Falta producto.");
    if (!Number.isFinite(price) || price <= 0) errors.push("Precio invalido o faltante.");
    if (!category.record) errors.push("No hay categorias configuradas para importar.");
    if (!unit.record) errors.push("No hay unidades configuradas para importar.");
    if (category.warning) warnings.push(category.warning);
    if (unit.warning) warnings.push(unit.warning);

    const normalizedName = normalizeLookup(name);
    const normalizedSku = normalizeLookup(sku);
    const normalizedBarcode = normalizeLookup(barcode);
    if (normalizedName) {
      const previousRow = seenNames.get(normalizedName);
      if (previousRow) {
        errors.push(`Duplicado en archivo: mismo producto en fila ${previousRow}.`);
      }
      seenNames.set(normalizedName, rowNumber);
    }
    if (normalizedSku) {
      const previousRow = seenSkus.get(normalizedSku);
      if (previousRow) {
        errors.push(`Duplicado en archivo: mismo SKU en fila ${previousRow}.`);
      }
      seenSkus.set(normalizedSku, rowNumber);
    }
    if (normalizedBarcode) {
      const previousRow = seenBarcodes.get(normalizedBarcode);
      if (previousRow) {
        errors.push(`Duplicado en archivo: mismo codigo de barras en fila ${previousRow}.`);
      }
      seenBarcodes.set(normalizedBarcode, rowNumber);
    }

    const existingByName = normalizedName ? existing.byName.get(normalizedName) : null;
    const existingBySku = normalizedSku ? existing.bySku.get(normalizedSku) : null;
    const existingByBarcode = normalizedBarcode ? existing.byBarcode.get(normalizedBarcode) : null;
    const existingMatch = existingByName || existingBySku || existingByBarcode || null;
    if (existingMatch && existingMatch !== existingByName) {
      warnings.push(`Coincide con producto existente "${existingMatch.name}" por SKU/codigo.`);
    }

    const stock = Number.isFinite(parseNumberValue(stockRaw)) ? roundStock(parseNumberValue(stockRaw)) : 0;
    const minStock = Number.isFinite(parseNumberValue(minStockRaw)) ? Math.max(0, roundStock(parseNumberValue(minStockRaw))) : 0;
    const cost = Number.isFinite(parseNumberValue(costRaw)) ? roundMoney(parseNumberValue(costRaw)) : 0;
    const packSize = Number.isFinite(parseNumberValue(packSizeRaw)) ? roundStock(parseNumberValue(packSizeRaw)) : null;
    const active = parseBooleanValue(getMappedValue(row, mapping, "active"), true);
    if (stock < 0) errors.push("La existencia no puede ser negativa en onboarding.");
    if (cost < 0) errors.push("El costo no puede ser negativo.");
    if (packSize != null && packSize <= 0) errors.push("El contenido debe ser mayor a cero.");

    previewRows.push({
      rowNumber,
      status: errors.length ? "error" : existingMatch ? "update" : "create",
      action: existingMatch ? "update" : "create",
      existingProductId: existingMatch?.id || null,
      errors,
      warnings,
      product: {
        branch,
        name,
        price,
        category: category.record?.code || "general",
        categoryLabel: category.record?.label || "",
        unit: unit.record?.code || "pza",
        unitLabel: unit.record?.label || "",
        stock,
        stockInitialized: Number.isFinite(parseNumberValue(stockRaw)) && stock > 0,
        minStock,
        cost,
        sku,
        barcode,
        brand: normalizeText(getMappedValue(row, mapping, "brand"), 60) || "",
        supplierName: normalizeText(getMappedValue(row, mapping, "supplierName"), 80) || "",
        packSize,
        active,
      },
    });
  });

  return previewRows;
}

async function buildProductOnboardingPreview(options = {}) {
  const filePath = options.filePath;
  if (!filePath || !fs.existsSync(filePath)) {
    throw createHttpError("Sube un archivo CSV o Excel para previsualizar.");
  }
  const branch = normalizeBranch(options.branch || "carrizal");
  const rawRows = await readTabularRows(filePath, options.originalName || filePath);
  if (rawRows.length < 2) {
    throw createHttpError("El archivo necesita encabezados y al menos un producto.");
  }
  const headerRowIndex = findHeaderRow(rawRows);
  const columns = getColumnsFromHeader(rawRows[headerRowIndex]);
  const mapping = normalizeMapping(options.mapping || {}, columns);
  if (!Number.isInteger(mapping.name) || !Number.isInteger(mapping.price)) {
    throw createHttpError("Mapea al menos las columnas Producto y Precio.");
  }
  const rows = buildPreviewRows(rawRows, headerRowIndex, mapping, branch);
  const summary = rows.reduce((current, row) => {
    current.total += 1;
    current.errors += row.errors.length ? 1 : 0;
    current.warnings += row.warnings.length ? 1 : 0;
    current.create += row.status === "create" ? 1 : 0;
    current.update += row.status === "update" ? 1 : 0;
    return current;
  }, { total: 0, create: 0, update: 0, errors: 0, warnings: 0 });

  return {
    branch,
    columns,
    suggestedMapping: suggestMapping(columns),
    mapping,
    summary,
    rows,
  };
}

function upsertProductFromPreviewRow(row, displayOrder) {
  const product = row.product;
  const category = getProductCategoryRecord(product.category, { includeInactive: true });
  const unit = getMeasurementUnitRecord(product.unit, { includeInactive: true });
  if (!category || !unit) {
    throw createHttpError(`No pude resolver categoria o unidad para "${product.name}".`);
  }
  const now = nowIso();
  const existing = row.existingProductId
    ? db.prepare("SELECT id FROM products WHERE id = ? AND branch = ?").get(row.existingProductId, product.branch)
    : db.prepare("SELECT id FROM products WHERE branch = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))").get(product.branch, product.name);

  if (existing) {
    db.prepare(`
      UPDATE products
      SET name = ?, price = ?, cost = ?, category = ?, unit = ?, category_id = ?, unit_id = ?,
          sku = ?, barcode = ?, brand = ?, supplier_name = ?, pack_size = ?, stock = ?,
          min_stock = ?, stock_initialized = ?, active = ?, updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(
      product.name,
      product.price,
      product.cost,
      category.code,
      unit.code,
      category.id,
      unit.id,
      product.sku || null,
      product.barcode || null,
      product.brand || null,
      product.supplierName || null,
      product.packSize,
      product.stock,
      product.minStock,
      product.stockInitialized ? 1 : 0,
      product.active ? 1 : 0,
      now,
      existing.id,
      product.branch,
    );
    return { id: existing.id, action: "update" };
  }

  const result = db.prepare(`
    INSERT INTO products (
      name, price, cost, category, unit, category_id, unit_id, sku, barcode, brand,
      supplier_name, pack_size, stock, min_stock, stock_initialized, active,
      display_order, branch, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.name,
    product.price,
    product.cost,
    category.code,
    unit.code,
    category.id,
    unit.id,
    product.sku || null,
    product.barcode || null,
    product.brand || null,
    product.supplierName || null,
    product.packSize,
    product.stock,
    product.minStock,
    product.stockInitialized ? 1 : 0,
    product.active ? 1 : 0,
    displayOrder,
    product.branch,
    now,
    now,
  );
  return { id: Number(result.lastInsertRowid), action: "create" };
}

async function applyProductOnboardingImport(options = {}) {
  const preview = await buildProductOnboardingPreview(options);
  if (preview.summary.errors > 0) {
    throw createHttpError("Corrige los errores del preview antes de importar.");
  }

  const maxOrderRow = db.prepare(`
    SELECT COALESCE(MAX(display_order), 0) AS max_order
    FROM products
    WHERE branch = ?
  `).get(preview.branch);
  let nextDisplayOrder = Number(maxOrderRow?.max_order || 0) + 1;
  const imported = [];

  db.transaction(() => {
    preview.rows.forEach((row) => {
      const result = upsertProductFromPreviewRow(row, nextDisplayOrder);
      if (result.action === "create") {
        nextDisplayOrder += 1;
      }
      imported.push({
        rowNumber: row.rowNumber,
        productId: result.id,
        action: result.action,
        name: row.product.name,
      });
    });
  })();

  return {
    branch: preview.branch,
    imported,
    summary: {
      ...preview.summary,
      imported: imported.length,
      created: imported.filter((item) => item.action === "create").length,
      updated: imported.filter((item) => item.action === "update").length,
    },
  };
}

module.exports = {
  applyProductOnboardingImport,
  buildProductOnboardingPreview,
  parseCsvRows,
};
