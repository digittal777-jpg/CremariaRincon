const { buildStarterItem } = require("./helpers");

const DEFAULT_SUPPLIERS = {
  cuadernos: "Distribuidora escolar",
  escritura: "Mayoreo de escritura",
  oficina: "Proveedor de oficina",
  arte: "Material artistico",
  impresion: "Insumos de impresion",
  general: "Proveedor general",
};

function buildItem(name, category, price, cost, options = {}) {
  return buildStarterItem(name, category, price, cost, {
    supplierName: options.supplierName || DEFAULT_SUPPLIERS[category] || "Proveedor general",
    ...options,
  });
}

const starterCatalog = [
  buildItem("Cuaderno Scribe profesional cuadro 100 hojas", "cuadernos", 42.0, 31.0, { sku: "PAP-C-001", brand: "Scribe", minStock: 8 }),
  buildItem("Cuaderno Scribe profesional raya 100 hojas", "cuadernos", 42.0, 31.0, { sku: "PAP-C-002", brand: "Scribe", minStock: 8 }),
  buildItem("Cuaderno Norma cosido cuadro chico 100 hojas", "cuadernos", 39.0, 29.0, { sku: "PAP-C-003", brand: "Norma", minStock: 6 }),
  buildItem("Cuaderno forma francesa 50 hojas", "cuadernos", 18.0, 12.5, { sku: "PAP-C-004", brand: "Estrella", minStock: 10 }),
  buildItem("Libreta taquigrafia 80 hojas", "cuadernos", 26.0, 19.0, { sku: "PAP-C-005", brand: "Scribe", minStock: 6 }),
  buildItem("Block profesional cuadro 80 hojas", "cuadernos", 36.0, 26.0, { sku: "PAP-C-006", brand: "Norma", minStock: 5 }),
  buildItem("Block profesional raya 80 hojas", "cuadernos", 36.0, 26.0, { sku: "PAP-C-007", brand: "Norma", minStock: 5 }),
  buildItem("Carpeta plastica oficio con broche", "cuadernos", 18.0, 12.5, { sku: "PAP-C-008", brand: "Baco", minStock: 8 }),
  buildItem("Carpeta carton carta", "cuadernos", 12.0, 8.0, { sku: "PAP-C-009", brand: "Pendaflex", minStock: 10 }),
  buildItem("Folder manila carta 10 pzas", "cuadernos", 24.0, 17.0, { sku: "PAP-C-010", brand: "Scribe", unit: "paq", minStock: 5 }),
  buildItem("Separadores plastificados 8 divisiones", "cuadernos", 34.0, 25.0, { sku: "PAP-C-011", brand: "Avery", minStock: 4 }),
  buildItem("Mica protectora carta 25 pzas", "cuadernos", 42.0, 31.0, { sku: "PAP-C-012", brand: "Avery", unit: "paq", minStock: 4 }),

  buildItem("Boligrafo BIC cristal azul", "escritura", 8.0, 4.5, { sku: "PAP-E-001", brand: "BIC", minStock: 20 }),
  buildItem("Boligrafo BIC cristal negro", "escritura", 8.0, 4.5, { sku: "PAP-E-002", brand: "BIC", minStock: 20 }),
  buildItem("Boligrafo BIC cristal rojo", "escritura", 8.0, 4.5, { sku: "PAP-E-003", brand: "BIC", minStock: 12 }),
  buildItem("Lapiz Mirado HB no. 2", "escritura", 9.0, 5.0, { sku: "PAP-E-004", brand: "Mirado", minStock: 20 }),
  buildItem("Lapiz adhesivo Pritt mediano", "escritura", 28.0, 20.0, { sku: "PAP-E-005", brand: "Pritt", minStock: 6 }),
  buildItem("Corrector liquido Paper Mate", "escritura", 24.0, 17.0, { sku: "PAP-E-006", brand: "Paper Mate", minStock: 6 }),
  buildItem("Borrador Pelikan migajon", "escritura", 10.0, 6.0, { sku: "PAP-E-007", brand: "Pelikan", minStock: 12 }),
  buildItem("Sacapuntas Maped metalico", "escritura", 12.0, 7.0, { sku: "PAP-E-008", brand: "Maped", minStock: 10 }),
  buildItem("Marcatextos Sharpie amarillo", "escritura", 26.0, 18.5, { sku: "PAP-E-009", brand: "Sharpie", minStock: 6 }),
  buildItem("Marcador permanente Sharpie negro", "escritura", 29.0, 21.0, { sku: "PAP-E-010", brand: "Sharpie", minStock: 6 }),
  buildItem("Plumon para pizarron negro", "escritura", 22.0, 15.5, { sku: "PAP-E-011", brand: "Expo", minStock: 8 }),
  buildItem("Lapices de color Maped 12 pzas", "escritura", 44.0, 32.0, { sku: "PAP-E-012", brand: "Maped", unit: "caja", minStock: 4 }),
  buildItem("Pluma gel Paper Mate azul", "escritura", 18.0, 12.5, { sku: "PAP-E-013", brand: "Paper Mate", minStock: 8 }),
  buildItem("Juego de geometria escolar 4 pzas", "escritura", 29.0, 21.0, { sku: "PAP-E-014", brand: "Maped", minStock: 5 }),
  buildItem("Compas escolar metalico", "escritura", 35.0, 25.0, { sku: "PAP-E-015", brand: "Maped", minStock: 4 }),

  buildItem("Engrapadora metalica mediana", "oficina", 79.0, 61.0, { sku: "PAP-O-001", brand: "Barrilito", minStock: 3 }),
  buildItem("Grapas estandar 5000 pzas", "oficina", 22.0, 15.5, { sku: "PAP-O-002", brand: "Barrilito", unit: "caja", minStock: 5 }),
  buildItem("Perforadora de 2 orificios", "oficina", 84.0, 65.0, { sku: "PAP-O-003", brand: "Maped", minStock: 3 }),
  buildItem("Cinta adhesiva transparente 18 mm", "oficina", 16.0, 10.5, { sku: "PAP-O-004", brand: "Scotch", unit: "rollo", minStock: 8 }),
  buildItem("Diurex grande transparente", "oficina", 24.0, 17.0, { sku: "PAP-O-005", brand: "Scotch", unit: "rollo", minStock: 6 }),
  buildItem("Notas adhesivas Post-it 100 hojas", "oficina", 28.0, 20.0, { sku: "PAP-O-006", brand: "Post-it", minStock: 6 }),
  buildItem("Clips metalicos no. 2 100 pzas", "oficina", 18.0, 12.5, { sku: "PAP-O-007", brand: "Acco", unit: "caja", minStock: 5 }),
  buildItem("Liga hule escolar 100 g", "oficina", 19.0, 13.0, { sku: "PAP-O-008", brand: "Barrilito", minStock: 5 }),
  buildItem("Sobre manila oficio 10 pzas", "oficina", 28.0, 19.5, { sku: "PAP-O-009", brand: "Scribe", unit: "paq", minStock: 4 }),
  buildItem("Calculadora basica de bolsillo", "oficina", 68.0, 52.0, { sku: "PAP-O-010", brand: "Casio", minStock: 3 }),
  buildItem("Tabla con clip oficio", "oficina", 34.0, 24.0, { sku: "PAP-O-011", brand: "Baco", minStock: 4 }),
  buildItem("Archivador carta 1 pulgada", "oficina", 54.0, 41.0, { sku: "PAP-O-012", brand: "Avery", minStock: 4 }),
  buildItem("Cutter grande retracil", "oficina", 22.0, 15.5, { sku: "PAP-O-013", brand: "Barrilito", minStock: 6 }),
  buildItem("Papel contact transparente por metro", "oficina", 28.0, 18.0, { sku: "PAP-O-014", brand: "Paperland", unit: "metro", minStock: 8 }),

  buildItem("Crayones Crayola 12 pzas", "arte", 34.0, 25.0, { sku: "PAP-A-001", brand: "Crayola", unit: "caja", minStock: 5 }),
  buildItem("Acuarelas escolares 12 colores", "arte", 32.0, 23.0, { sku: "PAP-A-002", brand: "Pelikan", minStock: 5 }),
  buildItem("Pintura vinilica blanca 250 ml", "arte", 36.0, 26.0, { sku: "PAP-A-003", brand: "Acrilex", minStock: 4 }),
  buildItem("Pincel redondo no. 6", "arte", 14.0, 9.0, { sku: "PAP-A-004", brand: "Rodin", minStock: 8 }),
  buildItem("Cartulina blanca 1 pza", "arte", 8.0, 4.5, { sku: "PAP-A-005", brand: "Lumen", minStock: 20 }),
  buildItem("Cartulina de color surtida 1 pza", "arte", 9.0, 5.0, { sku: "PAP-A-006", brand: "Lumen", minStock: 20 }),
  buildItem("Foamy diamantado carta 1 pza", "arte", 13.0, 8.5, { sku: "PAP-A-007", brand: "Foamy", minStock: 12 }),
  buildItem("Papel crepe 1 rollo", "arte", 12.0, 7.0, { sku: "PAP-A-008", brand: "Ideal", unit: "rollo", minStock: 8 }),
  buildItem("Plastilina escolar 12 barras", "arte", 24.0, 17.0, { sku: "PAP-A-009", brand: "Play-Doh", unit: "caja", minStock: 4 }),
  buildItem("Resistol blanco 250 g", "arte", 34.0, 25.0, { sku: "PAP-A-010", brand: "Resistol", minStock: 5 }),

  buildItem("Papel bond carta 500 hojas", "impresion", 138.0, 113.0, { sku: "PAP-I-001", brand: "Xerox", unit: "paq", minStock: 4 }),
  buildItem("Papel bond oficio 500 hojas", "impresion", 154.0, 126.0, { sku: "PAP-I-002", brand: "Xerox", unit: "paq", minStock: 3 }),
  buildItem("Papel fotografico brillante 20 hojas", "impresion", 94.0, 73.0, { sku: "PAP-I-003", brand: "Epson", unit: "paq", minStock: 3 }),
  buildItem("Etiqueta autoadherible carta 25 hojas", "impresion", 88.0, 67.0, { sku: "PAP-I-004", brand: "Avery", unit: "paq", minStock: 3 }),
  buildItem("Cartucho HP 664 negro", "impresion", 338.0, 281.0, { sku: "PAP-I-005", brand: "HP", minStock: 2 }),
  buildItem("Cartucho HP 664 color", "impresion", 354.0, 294.0, { sku: "PAP-I-006", brand: "HP", minStock: 2 }),
  buildItem("Toner Brother TN-660", "impresion", 1180.0, 980.0, { sku: "PAP-I-007", brand: "Brother", minStock: 1 }),
  buildItem("Rollo termico 57 x 40", "impresion", 18.0, 11.0, { sku: "PAP-I-008", brand: "Generic", unit: "rollo", minStock: 12 }),

  buildItem("Mochila escolar basica", "general", 289.0, 225.0, { sku: "PAP-G-001", brand: "Chenson", minStock: 2 }),
  buildItem("Lonchera infantil", "general", 168.0, 129.0, { sku: "PAP-G-002", brand: "Chenson", minStock: 2 }),
  buildItem("USB 32 GB", "general", 138.0, 108.0, { sku: "PAP-G-003", brand: "Kingston", minStock: 3 }),
  buildItem("Pilas AA 4 pzas", "general", 49.0, 38.0, { sku: "PAP-G-004", brand: "Duracell", unit: "paq", minStock: 4 }),
  buildItem("Forro para libro adhesivo por metro", "general", 24.0, 15.0, { sku: "PAP-G-005", brand: "Paperland", unit: "metro", minStock: 10 }),
  buildItem("Regla escolar 30 cm", "general", 12.0, 7.0, { sku: "PAP-G-006", brand: "Maped", minStock: 10 }),
];

module.exports = {
  starterCatalog,
};
