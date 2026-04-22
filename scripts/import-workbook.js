const {
  getDashboardSnapshot,
  importCatalogFromWorkbook,
  resolveWorkbookPath,
} = require("../src/services");

async function main() {
  const workbookPath = process.argv[2];
  const resolvedPath = resolveWorkbookPath(workbookPath);

  if (!resolvedPath) {
    console.error("No encontre el archivo de Excel para importar.");
    process.exitCode = 1;
    return;
  }

  const result = await importCatalogFromWorkbook(resolvedPath);
  const snapshot = getDashboardSnapshot();

  console.log(`Catalogo importado: ${result.importedCount} productos`);
  console.log(`Archivo: ${result.workbookPath}`);
  console.log(`Productos activos en catalogo: ${snapshot.summary.catalogSize}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
