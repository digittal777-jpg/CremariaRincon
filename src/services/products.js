const fs = require("node:fs");
const ExcelJS = require("exceljs");

const { parseWorkbookCatalog } = require("../catalogParser");
const { DEFAULT_WORKBOOK_PATHS } = require("../config");
const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getSetting,
  mapProduct,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

function resolveWorkbookPath(candidatePath) {
  const possiblePaths = [candidatePath, ...DEFAULT_WORKBOOK_PATHS].filter(Boolean);
  return possiblePaths.find((workbookPath) => fs.existsSync(workbookPath)) || null;
}

async function ensureCatalogSeeded(candidatePath) {
  if (!candidatePath) {
    // Startup: skip if products exist
    const existingCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
    if (existingCount > 0) {
      return {
        seeded: false,
        reason: "catalog-exists",
      };
    }
  }

  const workbookPath = resolveWorkbookPath(candidatePath);
  if (!workbookPath) {
    return {
      seeded: false,
      reason: "workbook-not-found",
    };
  }

  const result = await importCatalogFromWorkbook(workbookPath);
  return {
    reimported: true,
    ...result,
  };
}

async function importCatalogFromWorkbook(workbookPath) {
  const resolvedPath = resolveWorkbookPath(workbookPath);
  if (!resolvedPath) {
    throw createHttpError("No encontre el archivo de Excel para importar el catalogo.");
  }

  const catalog = await parseWorkbookCatalog(resolvedPath);
  if (catalog.length === 0) {
    throw createHttpError("El Excel no trae productos validos para importar.");
  }

  const { STORE_BRANCHES } = require("../utils/helpers");
  const now = nowIso();

  // Crear productos para todas las sucursales
  const upsertProductByBranch = db.prepare(`
    INSERT INTO products (
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      display_order,
      branch,
      created_at,
      updated_at
    ) VALUES (
      @name,
      @price,
      @category,
      @unit,
      @typeCode,
      @stock,
      @minStock,
      @displayOrder,
      @branch,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(name, branch) DO UPDATE SET
      price = excluded.price,
      category = excluded.category,
      unit = excluded.unit,
      type_code = excluded.type_code,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((products) => {
    // Por cada producto del Excel, crear entrada para cada sucursal
    STORE_BRANCHES.forEach((branch) => {
      products.forEach((product) => {
        upsertProductByBranch.run({
          ...product,
          branch,
          createdAt: now,
          updatedAt: now,
        });
      });
    });
  });

  transaction(catalog);

  return {
    importedCount: catalog.length * STORE_BRANCHES.length,
    branches: STORE_BRANCHES,
    workbookPath: resolvedPath,
  };
}

function listProducts(branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);
  const rows = db.prepare(`
    SELECT
      id,
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      stock_initialized,
      active,
      display_order,
      branch
    FROM products
    WHERE active = 1 AND branch = ?
    ORDER BY
      CASE category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      display_order,
      name COLLATE NOCASE
  `).all(normalizedBranch);

  return rows.map(mapProduct);
}

function getProductById(productId, branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);
  const row = db.prepare(`
    SELECT
      id,
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      stock_initialized,
      active,
      display_order,
      branch
    FROM products
    WHERE id = ? AND branch = ?
  `).get(productId, normalizedBranch);

  return row ? mapProduct(row) : null;
}

function updateProduct(productId, payload) {
  const branch = normalizeBranch(payload.branch);
  const current = db.prepare(`
    SELECT id, price, stock, min_stock, stock_initialized, active
    FROM products
    WHERE id = ? AND branch = ?
  `).get(productId, branch);

  if (!current) {
    throw createHttpError("No encontre el producto que quieres actualizar.", 404);
  }

  const nextPrice =
    payload.price === undefined
      ? roundMoney(current.price)
      : roundMoney(payload.price);
  const nextStock =
    payload.stock === undefined
      ? roundStock(current.stock)
      : roundStock(payload.stock);
  const nextMinStock =
    payload.minStock === undefined
      ? roundStock(current.min_stock)
      : Math.max(0, roundStock(payload.minStock));
  const nextActive =
    payload.active === undefined ? current.active : payload.active ? 1 : 0;

  if (nextPrice <= 0) {
    throw createHttpError("El precio debe ser mayor a cero.");
  }

  if (!Number.isFinite(nextStock)) {
    throw createHttpError("La existencia capturada no es valida.");
  }

  const now = nowIso();
  const note = normalizeText(payload.note || "Ajuste manual de inventario", 120);

  db.transaction(() => {
    db.prepare(`
      UPDATE products
      SET price = ?, stock = ?, min_stock = ?, stock_initialized = 1, active = ?, updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(nextPrice, nextStock, nextMinStock, nextActive, now, productId, branch);

    if (roundStock(current.stock) !== nextStock) {
      db.prepare(`
        INSERT INTO inventory_movements (
          product_id,
          movement_type,
          branch,
          quantity_delta,
          stock_before,
          stock_after,
          note,
          reference_type,
          reference_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        productId,
        "adjustment",
        branch,
        roundStock(nextStock - roundStock(current.stock)),
        roundStock(current.stock),
        nextStock,
        note,
        "manual",
        null,
        now,
      );
    }
  })();

  return getProductById(productId, branch);
}

function listAllProductsForExport() {
  return db.prepare(`
    SELECT
      id,
      name,
      price,
      category,
      unit,
      type_code,
      stock,
      min_stock,
      stock_initialized,
      active,
      display_order,
      created_at,
      updated_at
    FROM products
    ORDER BY
      CASE category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      active DESC,
      display_order,
      name COLLATE NOCASE
  `).all();
}

module.exports = {
  ensureCatalogSeeded,
  getProductById,
  importCatalogFromWorkbook,
  listAllProductsForExport,
  listProducts,
  updateProduct,
};