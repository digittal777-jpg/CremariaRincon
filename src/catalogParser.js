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
  const upperName = name.toUpperCase();
  const match = SECTION_MATCHERS.find((section) => upperName.includes(section.pattern));
  return match ? match.key : null;
}

function inferCategory(currentSection, typeCode) {
  const normalizedType = (typeCode || "").toUpperCase();

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
  const upperName = name.toUpperCase();
  return BLOCKLIST_TOKENS.some((token) => upperName.includes(token));
}

async function parseWorkbookCatalog(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("El archivo de Excel no contiene hojas.");
  }

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

module.exports = {
  parseWorkbookCatalog,
};
