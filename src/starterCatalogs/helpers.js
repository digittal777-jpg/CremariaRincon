const STARTER_WORKBOOK_HEADERS = [
  "producto",
  "precio",
  "categoria",
  "unidad",
  "stock",
  "minimo",
  "costo",
  "sku",
  "codigo barras",
  "marca",
  "proveedor",
  "contenido",
];

function getDefaultMinStock(unitCode) {
  switch (String(unitCode || "pza")) {
    case "kg":
    case "lt":
    case "metro":
      return 3;
    case "paq":
    case "caja":
    case "rollo":
      return 4;
    default:
      return 6;
  }
}

function buildStarterItem(name, category, price, cost, options = {}) {
  return {
    name,
    category,
    unit: options.unit || "pza",
    price,
    cost,
    stock: 0,
    minStock: options.minStock ?? getDefaultMinStock(options.unit || "pza"),
    sku: options.sku || null,
    barcode: options.barcode || null,
    brand: options.brand || null,
    supplierName: options.supplierName || null,
    packSize: options.packSize ?? null,
    typeCode: options.typeCode || null,
  };
}

module.exports = {
  STARTER_WORKBOOK_HEADERS,
  buildStarterItem,
};
