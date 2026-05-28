const fs = require("node:fs");
const path = require("node:path");

const ExcelJS = require("exceljs");

const { ROOT_DIR } = require("../src/config");
const { STARTER_WORKBOOK_HEADERS } = require("../src/starterCatalogs/helpers");
const {
  getStarterCatalogDefinition,
  listStarterCatalogDefinitions,
} = require("../src/starterCatalogs");

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function getOutputPath(fileName) {
  return path.join(ROOT_DIR, "catalogos", fileName);
}

async function writeCatalogWorkbook(definition) {
  const outputPath = getOutputPath(definition.fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Codex";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(definition.sheetName || "Catalogo");
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.addRow(STARTER_WORKBOOK_HEADERS);

  definition.starterCatalog.forEach((product) => {
    sheet.addRow([
      product.name,
      product.price,
      product.category,
      product.unit,
      product.stock,
      product.minStock,
      product.cost,
      product.sku,
      product.barcode,
      product.brand,
      product.supplierName,
      product.packSize,
    ]);
  });

  sheet.columns = [
    { width: 38 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 18 },
    { width: 20 },
    { width: 24 },
    { width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF2E3C6" },
    };
  });

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

async function main() {
  const requestedTemplate = getFlagValue("template");
  const definitions = requestedTemplate
    ? [getStarterCatalogDefinition(requestedTemplate)].filter(Boolean)
    : listStarterCatalogDefinitions();

  if (definitions.length === 0) {
    throw new Error(`No existe un catalogo starter registrado para "${requestedTemplate}".`);
  }

  for (const definition of definitions) {
    const outputPath = await writeCatalogWorkbook(definition);
    console.log(`Catalogo ${definition.templateKey} generado en: ${path.relative(ROOT_DIR, outputPath)}`);
    console.log(`Productos: ${definition.starterCatalog.length}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
