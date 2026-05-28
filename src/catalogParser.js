const ExcelJS = require("exceljs");

const SECTION_MATCHERS = [
  { pattern: "QUESOS", key: "quesos" },
  { pattern: "CARNES", key: "carnes" },
  { pattern: "PIEZAS", key: "piezas" },
];

const BLOCKLIST_TOKENS = [
  "CAPTURA",
  "PRODUCTO",
  "TOTAL INVENTARIO",
  "EFECTIVO EN CAJA",
  "DINERO CONTADO",
  "CORTE",
];

const HEADER_ALIASES = {
  name: ["producto", "nombre", "articulo", "descripcion"],
  price: ["precio", "precio venta", "precio_venta"],
  category: ["categoria", "departamento", "linea"],
  unit: ["unidad", "u_medida", "medida"],
  typeCode: ["tipo", "type", "clave tipo"],
  stock: ["stock", "existencia", "inventario"],
  minStock: ["minimo", "stock minimo", "min_stock"],
  cost: ["costo", "precio costo"],
  sku: ["sku", "codigo", "codigo interno"],
  barcode: ["barcode", "codigo barras", "codigo de barras"],
  brand: ["marca"],
  supplierName: ["proveedor", "supplier"],
  packSize: ["pack size", "tamano paquete", "tamano de empaque", "contenido"],
};

function normalizeText(value) {
  if (value == null) {
    return "";
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

function normalizeLookup(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === "object" && typeof value.result === "number") {
    return value.result;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  return NaN;
}

function getSectionFromRowName(name) {
  const upperName = normalizeText(name).toUpperCase();
  const match = SECTION_MATCHERS.find((section) => upperName.includes(section.pattern));
  return match ? match.key : null;
}

function inferCategory(currentSection, typeCode) {
  const normalizedType = normalizeText(typeCode).toUpperCase();

  if (currentSection === "quesos" && normalizedType === "M") {
    return "carnes";
  }
  if (currentSection) {
    return currentSection;
  }
  if (normalizedType === "Q") {
    return "quesos";
  }
  if (normalizedType === "M") {
    return "carnes";
  }
  if (normalizedType === "P") {
    return "piezas";
  }

  return "general";
}

function getUnitForCategory(category) {
  return category === "piezas" ? "pza" : "kg";
}

function getMinStockForCategory(category) {
  return category === "piezas" ? 12 : 4;
}

function shouldSkipRow(name) {
  const upperName = normalizeText(name).toUpperCase();
  return BLOCKLIST_TOKENS.some((token) => upperName.includes(token));
}

function buildHeaderMap(row) {
  const headerMap = {};
  row.eachCell((cell, columnNumber) => {
    const normalizedHeader = normalizeLookup(cell.value);
    if (!normalizedHeader) {
      return;
    }

    Object.entries(HEADER_ALIASES).forEach(([key, aliases]) => {
      if (aliases.includes(normalizedHeader) && !headerMap[key]) {
        headerMap[key] = columnNumber;
      }
    });
  });
  return headerMap;
}

function hasStructuredHeaders(headerMap) {
  return Boolean(headerMap.name && headerMap.price);
}

function getCellValue(row, columnNumber) {
  if (!columnNumber) {
    return null;
  }
  return row.getCell(columnNumber).value;
}

function parseStructuredCatalog(worksheet, headerRowNumber, headerMap) {
  const products = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const name = normalizeText(getCellValue(row, headerMap.name));
    const price = toNumber(getCellValue(row, headerMap.price));

    if (!name || shouldSkipRow(name) || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const category = normalizeText(getCellValue(row, headerMap.category), 40).toLowerCase() || "general";
    const unit = normalizeText(getCellValue(row, headerMap.unit), 24).toLowerCase() || "pza";
    const stock = toNumber(getCellValue(row, headerMap.stock));
    const minStock = toNumber(getCellValue(row, headerMap.minStock));
    const cost = toNumber(getCellValue(row, headerMap.cost));
    const packSize = toNumber(getCellValue(row, headerMap.packSize));

    products.push({
      name,
      price: Number(price.toFixed(2)),
      category,
      unit,
      typeCode: normalizeText(getCellValue(row, headerMap.typeCode), 8).toUpperCase() || null,
      stock: Number.isFinite(stock) ? Number(stock.toFixed(3)) : 0,
      minStock: Number.isFinite(minStock) ? Number(minStock.toFixed(3)) : 0,
      cost: Number.isFinite(cost) ? Number(cost.toFixed(2)) : 0,
      sku: normalizeText(getCellValue(row, headerMap.sku), 48) || null,
      barcode: normalizeText(getCellValue(row, headerMap.barcode), 64) || null,
      brand: normalizeText(getCellValue(row, headerMap.brand), 60) || null,
      supplierName: normalizeText(getCellValue(row, headerMap.supplierName), 80) || null,
      packSize: Number.isFinite(packSize) ? Number(packSize.toFixed(3)) : null,
      displayOrder: products.length + 1,
    });
  }

  return products;
}

function parseLegacyCatalog(worksheet) {
  const products = [];
  let currentSection = null;

  worksheet.eachRow((row) => {
    const name = normalizeText(row.getCell(1).value);
    const price = toNumber(row.getCell(2).value);
    const explicitTypeCode = normalizeText(row.getCell(6).value).toUpperCase();

    const sectionFromRow = getSectionFromRowName(name);
    if (sectionFromRow) {
      currentSection = sectionFromRow;
      return;
    }

    if (!name || !Number.isFinite(price) || price <= 0 || shouldSkipRow(name)) {
      return;
    }

    const category = inferCategory(currentSection, explicitTypeCode);
    products.push({
      name,
      price: Number(price.toFixed(2)),
      category,
      unit: getUnitForCategory(category),
      typeCode: explicitTypeCode || null,
      stock: 0,
      minStock: getMinStockForCategory(category),
      displayOrder: products.length + 1,
    });
  });

  return products;
}

async function parseWorkbookCatalog(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo de Excel no contiene hojas.");
  }

  for (let rowNumber = 1; rowNumber <= Math.min(12, worksheet.rowCount); rowNumber += 1) {
    const headerRow = worksheet.getRow(rowNumber);
    const headerMap = buildHeaderMap(headerRow);
    if (hasStructuredHeaders(headerMap)) {
      return parseStructuredCatalog(worksheet, rowNumber, headerMap);
    }
  }

  return parseLegacyCatalog(worksheet);
}

module.exports = {
  parseWorkbookCatalog,
};
