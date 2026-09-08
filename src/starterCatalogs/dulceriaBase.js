const { buildStarterItem } = require("./helpers");

const DEFAULT_SUPPLIERS = {
  chocolates: "Mayorista de confiteria",
  gomitas: "Dulces a granel",
  paletas: "Distribuidora de caramelos",
  botanas: "Proveedor de botanas",
  fiesta: "Proveedor de fiesta",
  bebidas: "Bebidas de mostrador",
  general: "Proveedor general",
};

function buildItem(name, category, price, cost, options = {}) {
  return buildStarterItem(name, category, price, cost, {
    supplierName: options.supplierName || DEFAULT_SUPPLIERS[category] || "Proveedor general",
    ...options,
  });
}

const starterCatalog = [
  buildItem("Chocolate Carlos V 18 g", "chocolates", 11.0, 7.2, { sku: "DUL-CHO-001", brand: "Nestle", minStock: 24 }),
  buildItem("Chocolate Turin conejo 30 g", "chocolates", 24.0, 17.0, { sku: "DUL-CHO-002", brand: "Turin", minStock: 12 }),
  buildItem("Kinder Delice 39 g", "chocolates", 22.0, 16.0, { sku: "DUL-CHO-003", brand: "Kinder", minStock: 12 }),
  buildItem("Bocadin 18 g", "chocolates", 9.0, 5.5, { sku: "DUL-CHO-004", brand: "Ricolino", minStock: 24 }),
  buildItem("Kranky 40 g", "chocolates", 19.0, 13.5, { sku: "DUL-CHO-005", brand: "Ricolino", minStock: 12 }),
  buildItem("Chispas chocolate bolsa 1 kg", "chocolates", 128.0, 98.0, { sku: "DUL-CHO-006", unit: "kg", brand: "Granel", minStock: 3 }),

  buildItem("Gomita enchilada granel 1 kg", "gomitas", 96.0, 72.0, { sku: "DUL-GOM-001", unit: "kg", brand: "Granel", minStock: 4 }),
  buildItem("Pandita gomita granel 1 kg", "gomitas", 88.0, 66.0, { sku: "DUL-GOM-002", unit: "kg", brand: "Granel", minStock: 4 }),
  buildItem("Lombriz acida granel 1 kg", "gomitas", 94.0, 70.0, { sku: "DUL-GOM-003", unit: "kg", brand: "Granel", minStock: 4 }),
  buildItem("Mango enchilado tira 1 kg", "gomitas", 118.0, 89.0, { sku: "DUL-GOM-004", unit: "kg", brand: "Granel", minStock: 3 }),
  buildItem("Pulparindo chico caja 20 pzas", "gomitas", 92.0, 70.0, { sku: "DUL-GOM-005", unit: "caja", brand: "De la Rosa", minStock: 3 }),
  buildItem("Lucas Muecas display 10 pzas", "gomitas", 116.0, 88.0, { sku: "DUL-GOM-006", unit: "caja", brand: "Lucas", minStock: 3 }),

  buildItem("Paleta payaso", "paletas", 18.0, 12.5, { sku: "DUL-PAL-001", brand: "Ricolino", minStock: 18 }),
  buildItem("Paleta tutsi pop", "paletas", 7.0, 4.2, { sku: "DUL-PAL-002", brand: "Tutsi", minStock: 30 }),
  buildItem("Paleta vero mango", "paletas", 6.0, 3.5, { sku: "DUL-PAL-003", brand: "Vero", minStock: 30 }),
  buildItem("Caramelo macizo surtido 1 kg", "paletas", 72.0, 52.0, { sku: "DUL-PAL-004", unit: "kg", brand: "Granel", minStock: 5 }),
  buildItem("Chicle bola surtido 1 kg", "paletas", 78.0, 57.0, { sku: "DUL-PAL-005", unit: "kg", brand: "Granel", minStock: 4 }),
  buildItem("Mazapan De la Rosa caja 30 pzas", "paletas", 138.0, 105.0, { sku: "DUL-PAL-006", unit: "caja", brand: "De la Rosa", minStock: 3 }),

  buildItem("Papas Sabritas original 45 g", "botanas", 18.0, 13.0, { sku: "DUL-BOT-001", brand: "Sabritas", minStock: 20 }),
  buildItem("Doritos nacho 58 g", "botanas", 18.0, 13.0, { sku: "DUL-BOT-002", brand: "Doritos", minStock: 20 }),
  buildItem("Cheetos torciditos 52 g", "botanas", 17.0, 12.0, { sku: "DUL-BOT-003", brand: "Cheetos", minStock: 18 }),
  buildItem("Chicharron de harina rueda 1 kg", "botanas", 82.0, 60.0, { sku: "DUL-BOT-004", unit: "kg", brand: "Granel", minStock: 3 }),
  buildItem("Cacahuate japones 1 kg", "botanas", 104.0, 78.0, { sku: "DUL-BOT-005", unit: "kg", brand: "Granel", minStock: 3 }),
  buildItem("Chamoy Mega 1 lt", "botanas", 36.0, 24.0, { sku: "DUL-BOT-006", unit: "lt", brand: "Mega", minStock: 4 }),

  buildItem("Bolsa celofan chica 100 pzas", "fiesta", 38.0, 25.0, { sku: "DUL-FIE-001", unit: "paq", brand: "Fiesta", minStock: 4 }),
  buildItem("Bolsa celofan mediana 100 pzas", "fiesta", 48.0, 34.0, { sku: "DUL-FIE-002", unit: "paq", brand: "Fiesta", minStock: 4 }),
  buildItem("Globo latex surtido 50 pzas", "fiesta", 58.0, 41.0, { sku: "DUL-FIE-003", unit: "paq", brand: "Payaso", minStock: 5 }),
  buildItem("Vela cumpleaños numero surtido", "fiesta", 18.0, 11.0, { sku: "DUL-FIE-004", brand: "Fiesta", minStock: 12 }),
  buildItem("Confeti bolsa 100 g", "fiesta", 16.0, 9.0, { sku: "DUL-FIE-005", brand: "Fiesta", minStock: 10 }),
  buildItem("Piñata mediana surtida", "fiesta", 185.0, 135.0, { sku: "DUL-FIE-006", brand: "Artesanal", minStock: 2 }),

  buildItem("Agua natural 600 ml", "bebidas", 12.0, 7.5, { sku: "DUL-BEB-001", brand: "Bonafont", minStock: 24 }),
  buildItem("Refresco lata 355 ml", "bebidas", 18.0, 12.5, { sku: "DUL-BEB-002", brand: "Coca-Cola", minStock: 24 }),
  buildItem("Jugo Jumex 450 ml", "bebidas", 18.0, 12.0, { sku: "DUL-BEB-003", brand: "Jumex", minStock: 12 }),
  buildItem("Bebida energetica 473 ml", "bebidas", 42.0, 31.0, { sku: "DUL-BEB-004", brand: "Monster", minStock: 6 }),
];

module.exports = {
  starterCatalog,
};
