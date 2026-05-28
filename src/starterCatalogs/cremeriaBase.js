const { buildStarterItem } = require("./helpers");

const DEFAULT_SUPPLIERS = {
  quesos: "Distribuidora lactea regional",
  carnes: "Frigorifico y embutidos",
  piezas: "Proveedor refrigerado",
  general: "Proveedor general",
};

function buildItem(name, category, price, cost, options = {}) {
  return buildStarterItem(name, category, price, cost, {
    supplierName: options.supplierName || DEFAULT_SUPPLIERS[category] || "Proveedor general",
    ...options,
  });
}

const starterCatalog = [
  buildItem("Queso Oaxaca hebra a granel", "quesos", 189.0, 152.0, { unit: "kg", sku: "CRE-Q-001", brand: "Esmeralda", minStock: 8 }),
  buildItem("Queso Panela fresco a granel", "quesos", 176.0, 141.0, { unit: "kg", sku: "CRE-Q-002", brand: "Nochebuena", minStock: 8 }),
  buildItem("Queso Manchego rebanable", "quesos", 198.0, 161.0, { unit: "kg", sku: "CRE-Q-003", brand: "Fud", minStock: 6 }),
  buildItem("Queso Chihuahua a granel", "quesos", 214.0, 174.0, { unit: "kg", sku: "CRE-Q-004", brand: "Lala", minStock: 6 }),
  buildItem("Queso Fresco ranchero", "quesos", 168.0, 134.0, { unit: "kg", sku: "CRE-Q-005", brand: "Los Volcanes", minStock: 7 }),
  buildItem("Queso Cotija seco", "quesos", 226.0, 188.0, { unit: "kg", sku: "CRE-Q-006", brand: "Cotija Real", minStock: 4 }),
  buildItem("Queso Asadero a granel", "quesos", 202.0, 164.0, { unit: "kg", sku: "CRE-Q-007", brand: "La Villita", minStock: 6 }),
  buildItem("Queso Botanero enchilado", "quesos", 184.0, 148.0, { unit: "kg", sku: "CRE-Q-008", brand: "Ranchito", minStock: 5 }),
  buildItem("Queso Adobera", "quesos", 192.0, 154.0, { unit: "kg", sku: "CRE-Q-009", brand: "La Sierra", minStock: 5 }),
  buildItem("Queso Mozzarella rallable", "quesos", 208.0, 170.0, { unit: "kg", sku: "CRE-Q-010", brand: "Lyncott", minStock: 5 }),
  buildItem("Queso Crema Philadelphia 190 g", "quesos", 38.0, 29.0, { sku: "CRE-Q-011", brand: "Philadelphia", minStock: 6 }),
  buildItem("Queso Amarillo tipo americano 144 g", "quesos", 34.0, 25.0, { sku: "CRE-Q-012", brand: "Kraft Singles", minStock: 6 }),
  buildItem("Queso Oaxaca bolsa 400 g", "quesos", 79.0, 63.0, { sku: "CRE-Q-013", brand: "Esmeralda", minStock: 5 }),
  buildItem("Queso Panela pieza 400 g", "quesos", 72.0, 57.0, { sku: "CRE-Q-014", brand: "Nochebuena", minStock: 5 }),

  buildItem("Jamon de pierna rebanado", "carnes", 164.0, 129.0, { unit: "kg", sku: "CRE-C-001", brand: "Fud", minStock: 7 }),
  buildItem("Jamon de pavo rebanado", "carnes", 172.0, 138.0, { unit: "kg", sku: "CRE-C-002", brand: "Zwan", minStock: 6 }),
  buildItem("Salchicha viena a granel", "carnes", 96.0, 73.0, { unit: "kg", sku: "CRE-C-003", brand: "Kir", minStock: 6 }),
  buildItem("Chorizo ranchero", "carnes", 136.0, 104.0, { unit: "kg", sku: "CRE-C-004", brand: "San Rafael", minStock: 5 }),
  buildItem("Longaniza fresca", "carnes", 142.0, 111.0, { unit: "kg", sku: "CRE-C-005", brand: "Del Corral", minStock: 5 }),
  buildItem("Tocino ahumado rebanado", "carnes", 198.0, 160.0, { unit: "kg", sku: "CRE-C-006", brand: "Fud", minStock: 4 }),
  buildItem("Pepperoni rebanado", "carnes", 224.0, 182.0, { unit: "kg", sku: "CRE-C-007", brand: "San Rafael", minStock: 4 }),
  buildItem("Salami italiano", "carnes", 236.0, 191.0, { unit: "kg", sku: "CRE-C-008", brand: "Capistrano", minStock: 4 }),
  buildItem("Mortadela especial", "carnes", 118.0, 91.0, { unit: "kg", sku: "CRE-C-009", brand: "Zwan", minStock: 4 }),
  buildItem("Pierna espanola cocida", "carnes", 248.0, 203.0, { unit: "kg", sku: "CRE-C-010", brand: "Fud Cuida-t+", minStock: 3 }),
  buildItem("Pechuga de pavo ahumada", "carnes", 214.0, 175.0, { unit: "kg", sku: "CRE-C-011", brand: "Zwan Premium", minStock: 3 }),
  buildItem("Jamon Virginia premium", "carnes", 186.0, 149.0, { unit: "kg", sku: "CRE-C-012", brand: "San Rafael", minStock: 4 }),

  buildItem("Leche Lala entera 1 L", "piezas", 31.0, 24.5, { sku: "CRE-P-001", brand: "Lala", minStock: 8 }),
  buildItem("Leche Alpura deslactosada 1 L", "piezas", 34.0, 27.0, { sku: "CRE-P-002", brand: "Alpura", minStock: 6 }),
  buildItem("Yogur bebible Yoplait fresa 220 ml", "piezas", 18.0, 13.0, { sku: "CRE-P-003", brand: "Yoplait", minStock: 8 }),
  buildItem("Crema Lala acida 425 g", "piezas", 29.0, 22.0, { sku: "CRE-P-004", brand: "Lala", minStock: 6 }),
  buildItem("Mantequilla Gloria 90 g", "piezas", 22.0, 16.5, { sku: "CRE-P-005", brand: "Gloria", minStock: 6 }),
  buildItem("Huevo San Juan 18 pzas", "piezas", 52.0, 43.0, { sku: "CRE-P-006", brand: "San Juan", minStock: 4 }),
  buildItem("Media crema Nestle 225 g", "piezas", 22.0, 16.5, { sku: "CRE-P-007", brand: "Nestle", minStock: 6 }),
  buildItem("Yogur griego Oikos 150 g", "piezas", 24.0, 18.5, { sku: "CRE-P-008", brand: "Oikos", minStock: 5 }),
  buildItem("Crema para batir Lyncott 250 ml", "piezas", 34.0, 26.5, { sku: "CRE-P-009", brand: "Lyncott", minStock: 4 }),
  buildItem("Jocoque natural 500 g", "piezas", 38.0, 29.0, { sku: "CRE-P-010", brand: "Santa Clara", minStock: 4 }),

  buildItem("Pan Bimbo blanco grande", "general", 49.0, 39.0, { sku: "CRE-G-001", brand: "Bimbo", minStock: 4 }),
  buildItem("Tostadas Charras 300 g", "general", 32.0, 24.0, { sku: "CRE-G-002", brand: "Charras", minStock: 5 }),
  buildItem("Tortillinas Tia Rosa 22 pzas", "general", 34.0, 26.0, { sku: "CRE-G-003", brand: "Tia Rosa", minStock: 4 }),
  buildItem("Mermelada McCormick fresa 270 g", "general", 32.0, 24.0, { sku: "CRE-G-004", brand: "McCormick", minStock: 5 }),
  buildItem("Mayonesa McCormick 390 g", "general", 36.0, 28.0, { sku: "CRE-G-005", brand: "McCormick", minStock: 5 }),
  buildItem("Salsa Valentina 370 ml", "general", 24.0, 17.5, { sku: "CRE-G-006", brand: "Valentina", minStock: 6 }),
  buildItem("Cafe soluble Nescafe 100 g", "general", 69.0, 55.0, { sku: "CRE-G-007", brand: "Nescafe", minStock: 3 }),
  buildItem("Galleta Gamesa Maria 170 g", "general", 19.5, 14.0, { sku: "CRE-G-008", brand: "Gamesa", minStock: 6 }),
  buildItem("Crema de cacahuate Skippy 340 g", "general", 58.0, 45.0, { sku: "CRE-G-009", brand: "Skippy", minStock: 4 }),
  buildItem("Leche condensada La Lechera 387 g", "general", 34.0, 26.0, { sku: "CRE-G-010", brand: "La Lechera", minStock: 4 }),
];

module.exports = {
  starterCatalog,
};
