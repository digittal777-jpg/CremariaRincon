const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Buscar el archivo del Excel subido
const downloadsPath = path.join(process.env.USERPROFILE, 'Downloads');
const files = fs.readdirSync(downloadsPath).filter(f => 
  f.includes('cremeria-rincon-export-miradores-store-day') && f.endsWith('.xlsx')
);

if (files.length === 0) {
  console.log('No se encontró el archivo. Archivos en descargas:');
  fs.readdirSync(downloadsPath)
    .filter(f => f.includes('cremeria') || f.includes('miradores'))
    .slice(0, 10)
    .forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}

const filePath = path.join(downloadsPath, files[0]);
console.log(`Analizando: ${filePath}\n`);

async function analyzeExcel() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  console.log('=== HOJAS DISPONIBLES ===');
  workbook.worksheets.forEach((ws, idx) => {
    console.log(`${idx}: ${ws.name} (${ws.rowCount} filas)`);
  });
  console.log();
  
  // Buscar la hoja con datos
  let worksheet = workbook.worksheets.find(ws => 
    ws.name.toLowerCase() === 'movimientos'
  ) || workbook.worksheets.find(ws => 
    ws.name.toLowerCase().includes('detalle') || 
    ws.name.toLowerCase().includes('movimiento') ||
    ws.name.toLowerCase().includes('inventario')
  ) || workbook.worksheets[1];
  
  if (!worksheet) {
    console.log('No se encontró hoja con datos. Usando primera hoja no-resumen...');
    worksheet = workbook.worksheets.find((ws, idx) => idx > 0) || workbook.worksheets[0];
  }
  
  console.log(`\nUsando sheet: ${worksheet.name}`);
  console.log(`Total rows: ${worksheet.rowCount}\n`);
  
  // Obtener encabezados
  const headers = [];
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = cell.value;
  });
  
  console.log('Encabezados:', headers.slice(1, 10).join(' | '));
  console.log('\n=== FRESCO - TODOS LOS MOVIMIENTOS ===\n');
  
  const frescoRows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    
    const producto = row.getCell(2).value;
    if (producto && String(producto).toUpperCase().includes('FRESCO')) {
      frescoRows.push({
        rowNumber,
        id: row.getCell(1).value,
        producto: row.getCell(2).value,
        tipo: row.getCell(3).value,
        cantidad: row.getCell(4).value,
        stockAntes: row.getCell(5).value,
        stockDespues: row.getCell(6).value,
        deltaReal: row.getCell(7).value,
        cuadra: row.getCell(8).value,
        referencia: row.getCell(9).value,
        nota: row.getCell(10).value,
        fecha: row.getCell(11).value,
      });
    }
  });
  
  console.log(`Encontrados ${frescoRows.length} movimientos de FRESCO:\n`);
  
  frescoRows.forEach((row, idx) => {
    console.log(`${idx + 1}. Tipo: ${row.tipo}`);
    console.log(`   Cantidad: ${row.cantidad}`);
    console.log(`   Stock: ${row.stockAntes} → ${row.stockDespues}`);
    console.log(`   Delta Real: ${row.deltaReal}`);
    console.log(`   Referencia: ${row.referencia}`);
    console.log(`   Nota: ${row.nota}`);
    console.log(`   Fecha: ${row.fecha}\n`);
  });
  
  // Análisis
  console.log('=== ANÁLISIS ===\n');
  
  // Encontrar captura inicial
  const inicial = frescoRows.find(r => r.tipo === 'initial' || r.tipo === 'Inventario inicial');
  if (inicial) {
    console.log(`📌 Captura Inicial: ${inicial.cantidad} kg`);
    console.log(`   Stock después: ${inicial.stockDespues} kg\n`);
  }
  
  // Sumar ventas
  const ventas = frescoRows.filter(r => r.tipo === 'sale');
  const totalVentas = ventas.reduce((sum, v) => sum + (v.deltaReal || 0), 0);
  console.log(`📊 Ventas totales: ${ventas.length} movimientos`);
  console.log(`   Total vendido: ${totalVentas.toFixed(3)} kg\n`);
  
  // Verificación
  if (inicial) {
    const esperado = inicial.cantidad + totalVentas;
    const actual = frescoRows[frescoRows.length - 1].stockDespues;
    console.log(`✓ Verificación final:`);
    console.log(`  Inicial: ${inicial.cantidad} kg`);
    console.log(`  - Ventas: ${totalVentas.toFixed(3)} kg`);
    console.log(`  = Esperado: ${esperado.toFixed(3)} kg`);
    console.log(`  Actual en BD: ${actual} kg`);
    console.log(`  Diferencia: ${(esperado - actual).toFixed(3)} kg`);
  }
}

analyzeExcel().catch(console.error);
