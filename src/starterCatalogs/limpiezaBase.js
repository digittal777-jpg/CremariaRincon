const { buildStarterItem } = require("./helpers");

const DEFAULT_SUPPLIERS = {
  quimicos: "Quimicos y granel",
  jarceria: "Jarcieria nacional",
  papel: "Papel e higiene",
  desechables: "Desechables mayoreo",
  hogar: "Proveedor hogar",
  general: "Proveedor general",
};

function buildItem(name, category, price, cost, options = {}) {
  return buildStarterItem(name, category, price, cost, {
    supplierName: options.supplierName || DEFAULT_SUPPLIERS[category] || "Proveedor general",
    ...options,
  });
}

const starterCatalog = [
  buildItem("Cloro regular 1 lt", "quimicos", 18.0, 10.5, { sku: "LIM-QUI-001", unit: "lt", brand: "Cloralex", minStock: 12 }),
  buildItem("Pinol original 1 lt", "quimicos", 34.0, 24.0, { sku: "LIM-QUI-002", unit: "lt", brand: "Pinol", minStock: 8 }),
  buildItem("Fabuloso lavanda 1 lt", "quimicos", 32.0, 23.0, { sku: "LIM-QUI-003", unit: "lt", brand: "Fabuloso", minStock: 8 }),
  buildItem("Detergente liquido ropa 1 lt", "quimicos", 46.0, 34.0, { sku: "LIM-QUI-004", unit: "lt", brand: "Mas Color", minStock: 6 }),
  buildItem("Suavizante de telas 1 lt", "quimicos", 38.0, 27.0, { sku: "LIM-QUI-005", unit: "lt", brand: "Suavitel", minStock: 6 }),
  buildItem("Sarricida 1 lt", "quimicos", 42.0, 29.0, { sku: "LIM-QUI-006", unit: "lt", brand: "Genol", minStock: 5 }),
  buildItem("Desengrasante multiusos 1 lt", "quimicos", 44.0, 31.0, { sku: "LIM-QUI-007", unit: "lt", brand: "Axion", minStock: 5 }),
  buildItem("Jabon en polvo 1 kg", "quimicos", 48.0, 36.0, { sku: "LIM-QUI-008", unit: "kg", brand: "Roma", minStock: 6 }),

  buildItem("Escoba abanico economica", "jarceria", 58.0, 39.0, { sku: "LIM-JAR-001", brand: "La Reynera", minStock: 5 }),
  buildItem("Trapeador pabilo 400 g", "jarceria", 42.0, 29.0, { sku: "LIM-JAR-002", brand: "La Reynera", minStock: 6 }),
  buildItem("Fibra verde grande", "jarceria", 9.0, 5.0, { sku: "LIM-JAR-003", brand: "Scotch-Brite", minStock: 20 }),
  buildItem("Esponja multiusos 2 pzas", "jarceria", 18.0, 11.5, { sku: "LIM-JAR-004", unit: "paq", brand: "Scotch-Brite", minStock: 10 }),
  buildItem("Cepillo plancha plastico", "jarceria", 24.0, 15.0, { sku: "LIM-JAR-005", brand: "Perico", minStock: 6 }),
  buildItem("Jalador piso 40 cm", "jarceria", 54.0, 37.0, { sku: "LIM-JAR-006", brand: "Perico", minStock: 4 }),
  buildItem("Guante latex mediano par", "jarceria", 34.0, 23.0, { sku: "LIM-JAR-007", brand: "Vileda", minStock: 6 }),
  buildItem("Jerga gris 1 m", "jarceria", 28.0, 18.0, { sku: "LIM-JAR-008", unit: "metro", brand: "Nacional", minStock: 8 }),

  buildItem("Papel higienico 4 rollos", "papel", 39.0, 29.0, { sku: "LIM-PAP-001", unit: "paq", brand: "Petalo", minStock: 8 }),
  buildItem("Papel higienico institucional 12 rollos", "papel", 146.0, 112.0, { sku: "LIM-PAP-002", unit: "paq", brand: "Elite", minStock: 3 }),
  buildItem("Servilleta 250 pzas", "papel", 32.0, 22.0, { sku: "LIM-PAP-003", unit: "paq", brand: "Regio", minStock: 8 }),
  buildItem("Toalla cocina 2 rollos", "papel", 48.0, 35.0, { sku: "LIM-PAP-004", unit: "paq", brand: "Vogue", minStock: 6 }),
  buildItem("Kleenex caja 90 hojas", "papel", 28.0, 20.0, { sku: "LIM-PAP-005", brand: "Kleenex", minStock: 6 }),
  buildItem("Toalla interdoblada 100 pzas", "papel", 42.0, 30.0, { sku: "LIM-PAP-006", unit: "paq", brand: "Elite", minStock: 6 }),

  buildItem("Vaso plastico 10 oz 50 pzas", "desechables", 36.0, 25.0, { sku: "LIM-DES-001", unit: "paq", brand: "Reyma", minStock: 8 }),
  buildItem("Plato pastelero 50 pzas", "desechables", 42.0, 30.0, { sku: "LIM-DES-002", unit: "paq", brand: "Reyma", minStock: 6 }),
  buildItem("Cuchara plastica 50 pzas", "desechables", 24.0, 16.0, { sku: "LIM-DES-003", unit: "paq", brand: "Reyma", minStock: 8 }),
  buildItem("Bolsa basura jumbo 10 pzas", "desechables", 42.0, 30.0, { sku: "LIM-DES-004", unit: "paq", brand: "Costalito", minStock: 6 }),
  buildItem("Bolsa camiseta mediana 1 kg", "desechables", 72.0, 54.0, { sku: "LIM-DES-005", unit: "kg", brand: "Nacional", minStock: 3 }),
  buildItem("Contenedor foam 8x8 50 pzas", "desechables", 118.0, 88.0, { sku: "LIM-DES-006", unit: "paq", brand: "Dart", minStock: 3 }),

  buildItem("Cubeta 12 lt", "hogar", 68.0, 48.0, { sku: "LIM-HOG-001", brand: "Cubasa", minStock: 4 }),
  buildItem("Bote basura 20 lt", "hogar", 138.0, 98.0, { sku: "LIM-HOG-002", brand: "Plasticos MX", minStock: 2 }),
  buildItem("Atomizador 1 lt", "hogar", 28.0, 18.0, { sku: "LIM-HOG-003", brand: "Plasticos MX", minStock: 6 }),
  buildItem("Recogedor plastico", "hogar", 34.0, 22.0, { sku: "LIM-HOG-004", brand: "Perico", minStock: 5 }),
];

module.exports = {
  starterCatalog,
};
