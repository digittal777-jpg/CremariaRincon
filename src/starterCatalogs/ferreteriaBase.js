const { buildStarterItem } = require("./helpers");

const DEFAULT_SUPPLIERS = {
  herramienta: "Herramienta mayoreo",
  fijacion: "Tornilleria y fijacion",
  electricidad: "Material electrico",
  plomeria: "Plomeria nacional",
  pintura: "Pinturas y acabados",
  seguridad: "Equipo de seguridad",
  general: "Proveedor general",
};

function buildItem(name, category, price, cost, options = {}) {
  return buildStarterItem(name, category, price, cost, {
    supplierName: options.supplierName || DEFAULT_SUPPLIERS[category] || "Proveedor general",
    ...options,
  });
}

const starterCatalog = [
  buildItem("Martillo uña 16 oz", "herramienta", 148.0, 106.0, { sku: "FER-HER-001", brand: "Truper", minStock: 3 }),
  buildItem("Desarmador plano 1/4 x 6", "herramienta", 52.0, 36.0, { sku: "FER-HER-002", brand: "Truper", minStock: 5 }),
  buildItem("Desarmador cruz 1/4 x 6", "herramienta", 52.0, 36.0, { sku: "FER-HER-003", brand: "Truper", minStock: 5 }),
  buildItem("Pinza mecanica 8 pulg", "herramienta", 118.0, 84.0, { sku: "FER-HER-004", brand: "Pretul", minStock: 3 }),
  buildItem("Llave ajustable 8 pulg", "herramienta", 132.0, 96.0, { sku: "FER-HER-005", brand: "Pretul", minStock: 3 }),
  buildItem("Flexometro 5 m", "herramienta", 69.0, 48.0, { sku: "FER-HER-006", brand: "Truper", minStock: 5 }),
  buildItem("Cutter metalico 18 mm", "herramienta", 36.0, 22.0, { sku: "FER-HER-007", brand: "Pretul", minStock: 6 }),
  buildItem("Segueta bimetal 12 pulg", "herramienta", 24.0, 14.0, { sku: "FER-HER-008", brand: "Nicholson", minStock: 10 }),

  buildItem("Tornillo pija 8 x 1 pulg 100 pzas", "fijacion", 48.0, 31.0, { sku: "FER-FIJ-001", unit: "paq", brand: "Fiero", minStock: 5 }),
  buildItem("Taquete plastico 1/4 100 pzas", "fijacion", 42.0, 27.0, { sku: "FER-FIJ-002", unit: "paq", brand: "Fiero", minStock: 5 }),
  buildItem("Clavo con cabeza 2 pulg 1 kg", "fijacion", 58.0, 42.0, { sku: "FER-FIJ-003", unit: "kg", brand: "Deacero", minStock: 4 }),
  buildItem("Alambre recocido 1 kg", "fijacion", 44.0, 31.0, { sku: "FER-FIJ-004", unit: "kg", brand: "Deacero", minStock: 4 }),
  buildItem("Cincho plastico 20 cm 100 pzas", "fijacion", 38.0, 24.0, { sku: "FER-FIJ-005", unit: "paq", brand: "Volteck", minStock: 6 }),
  buildItem("Cinta teflon 1/2 pulg", "fijacion", 9.0, 4.5, { sku: "FER-FIJ-006", brand: "Foset", minStock: 20 }),

  buildItem("Cable THW calibre 12 por metro", "electricidad", 18.0, 11.0, { sku: "FER-ELE-001", unit: "metro", brand: "IUSA", minStock: 30 }),
  buildItem("Cable THW calibre 14 por metro", "electricidad", 14.0, 8.5, { sku: "FER-ELE-002", unit: "metro", brand: "IUSA", minStock: 30 }),
  buildItem("Contacto duplex blanco", "electricidad", 28.0, 18.0, { sku: "FER-ELE-003", brand: "Volteck", minStock: 8 }),
  buildItem("Apagador sencillo blanco", "electricidad", 24.0, 15.0, { sku: "FER-ELE-004", brand: "Volteck", minStock: 8 }),
  buildItem("Foco LED 9 W luz blanca", "electricidad", 38.0, 26.0, { sku: "FER-ELE-005", brand: "Tecnolite", minStock: 8 }),
  buildItem("Cinta aislante negra", "electricidad", 18.0, 10.0, { sku: "FER-ELE-006", brand: "3M", minStock: 10 }),
  buildItem("Centro de carga 2 pastillas", "electricidad", 168.0, 124.0, { sku: "FER-ELE-007", brand: "Square D", minStock: 2 }),

  buildItem("Tubo PVC sanitario 2 pulg por metro", "plomeria", 42.0, 29.0, { sku: "FER-PLO-001", unit: "metro", brand: "Duralon", minStock: 8 }),
  buildItem("Codo PVC 2 pulg 90 grados", "plomeria", 18.0, 10.5, { sku: "FER-PLO-002", brand: "Duralon", minStock: 10 }),
  buildItem("Llave nariz jardin", "plomeria", 68.0, 47.0, { sku: "FER-PLO-003", brand: "Foset", minStock: 4 }),
  buildItem("Manguera reforzada por metro", "plomeria", 24.0, 15.0, { sku: "FER-PLO-004", unit: "metro", brand: "Foset", minStock: 20 }),
  buildItem("Pegamento PVC 125 ml", "plomeria", 46.0, 31.0, { sku: "FER-PLO-005", brand: "Tangit", minStock: 5 }),
  buildItem("Mezcladora lavabo sencilla", "plomeria", 298.0, 218.0, { sku: "FER-PLO-006", brand: "Foset", minStock: 2 }),

  buildItem("Pintura vinilica blanca 1 lt", "pintura", 89.0, 64.0, { sku: "FER-PIN-001", unit: "lt", brand: "Comex", minStock: 4 }),
  buildItem("Sellador vinilico 1 lt", "pintura", 72.0, 51.0, { sku: "FER-PIN-002", unit: "lt", brand: "Comex", minStock: 4 }),
  buildItem("Brocha 2 pulg", "pintura", 32.0, 20.0, { sku: "FER-PIN-003", brand: "Perfect", minStock: 8 }),
  buildItem("Rodillo felpa 9 pulg", "pintura", 58.0, 39.0, { sku: "FER-PIN-004", brand: "Perfect", minStock: 5 }),
  buildItem("Lija agua grano 120", "pintura", 12.0, 6.0, { sku: "FER-PIN-005", brand: "Fandeli", minStock: 20 }),

  buildItem("Guante carnaza par", "seguridad", 48.0, 32.0, { sku: "FER-SEG-001", brand: "Truper", minStock: 6 }),
  buildItem("Lente seguridad claro", "seguridad", 38.0, 24.0, { sku: "FER-SEG-002", brand: "Truper", minStock: 6 }),
  buildItem("Candado laton 40 mm", "seguridad", 78.0, 54.0, { sku: "FER-SEG-003", brand: "Hermex", minStock: 4 }),
  buildItem("Cinta precaucion 100 m", "seguridad", 92.0, 66.0, { sku: "FER-SEG-004", unit: "rollo", brand: "Truper", minStock: 3 }),
];

module.exports = {
  starterCatalog,
};
