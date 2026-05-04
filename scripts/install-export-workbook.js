const { installOperationalDataFromWorkbookFile } = require("../src/services");

async function main() {
  const workbookPath = process.argv[2];

  if (!workbookPath) {
    console.error("Uso: npm.cmd run install:excel-export -- <ruta-del-archivo.xlsx>");
    process.exitCode = 1;
    return;
  }

  const result = await installOperationalDataFromWorkbookFile(workbookPath);

  console.log(`Excel instalado desde: ${result.workbookPath}`);
  console.log(`Sucursales: ${result.branches.join(", ")}`);
  console.log(`Productos: ${result.counts.products}`);
  console.log(`Ventas: ${result.counts.sales}`);
  console.log(`Lineas de venta: ${result.counts.saleItems}`);
  console.log(`Eventos de caja: ${result.counts.registerEvents}`);
  console.log(`Movimientos: ${result.counts.inventoryMovements}`);
  if (result.backupPath) {
    console.log(`Respaldo: ${result.backupPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
