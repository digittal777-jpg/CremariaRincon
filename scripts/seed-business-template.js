const path = require("node:path");

const services = require("../src/services");

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const templateKey = getFlagValue("template");
  const businessName = getFlagValue("name");
  const slug = normalizeSlug(getFlagValue("slug"));
  const catalogPath = getFlagValue("catalog");

  if (!templateKey || !catalogPath) {
    throw new Error("Uso: node scripts/seed-business-template.js --template abarrotes --name \"Mi negocio\" --slug mi-negocio --catalog .\\catalogo.xlsx");
  }

  const template = services.loadBusinessTemplate(templateKey);
  const result = await services.applyBusinessTemplateWithCatalog(template, {
    businessName: businessName || template.businessName || "Nuevo negocio",
    slug: slug || normalizeSlug(businessName || template.slug || template.businessName || "nuevo-negocio"),
    workbookPath: catalogPath,
    confirmReset: true,
    skipConfirmGuard: true,
    actorType: "script",
    actorName: "seed-business-template",
  });

  console.log(`Plantilla aplicada: ${templateKey}`);
  console.log(`Negocio: ${result.businessProfile.businessName}`);
  console.log(`Slug: ${result.businessProfile.slug}`);
  console.log(`Base de datos: ${path.relative(process.cwd(), require("../src/config").DB_PATH)}`);
  console.log(`Modulos: ${result.enabledModules.join(", ") || "(ninguno)"}`);
  console.log(`Categorias: ${result.categories.length}`);
  console.log(`Unidades: ${result.units.length}`);
  console.log(`Atributos: ${result.productAttributeDefinitions.length}`);
  console.log(`Productos importados: ${result.importedCount}`);
  console.log(`Workbook: ${result.workbookPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
