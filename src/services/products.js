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

function createProduct(payload) {
  const branch = normalizeBranch(payload.branch);
  const name = normalizeText(payload.name || "", 80);
  const category = normalizeText(payload.category || "general", 24).toLowerCase();
  const unit = normalizeText(payload.unit || "kg", 12).toLowerCase();
  const typeCode = normalizeText(payload.typeCode || "", 8).toUpperCase() || null;
  const price = roundMoney(payload.price);
  const stock = roundStock(payload.stock || 0);
  const minStock = Math.max(0, roundStock(payload.minStock || 0));
  const now = nowIso();

  if (!name) {
    throw createHttpError("Captura un nombre de producto valido.");
  }
  if (!["quesos", "carnes", "piezas", "general"].includes(category)) {
    throw createHttpError("Selecciona una categoria valida.");
  }
  if (!["kg", "pza"].includes(unit)) {
    throw createHttpError("Selecciona una unidad valida.");
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw createHttpError("El precio debe ser mayor a cero.");
  }
  if (!Number.isFinite(stock) || stock < 0) {
    throw createHttpError("La existencia inicial no es valida.");
  }

  const existing = db.prepare(`
    SELECT id, active
    FROM products
    WHERE branch = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))
  `).get(branch, name);

  if (existing?.active) {
    throw createHttpError("Ya existe un producto activo con ese nombre en esta sucursal.");
  }

  const maxOrderRow = db.prepare(`
    SELECT COALESCE(MAX(display_order), 0) AS max_order
    FROM products
    WHERE branch = ?
  `).get(branch);
  const nextDisplayOrder = Number(maxOrderRow?.max_order || 0) + 1;

  const result = db.transaction(() => {
    let productId = null;
    if (existing) {
      db.prepare(`
        UPDATE products
        SET
          price = ?,
          category = ?,
          unit = ?,
          type_code = ?,
          stock = ?,
          min_stock = ?,
          stock_initialized = ?,
          active = 1,
          updated_at = ?
        WHERE id = ? AND branch = ?
      `).run(
        price,
        category,
        unit,
        typeCode,
        stock,
        minStock,
        stock > 0 ? 1 : 0,
        now,
        existing.id,
        branch,
      );
      productId = existing.id;
    } else {
      const insert = db.prepare(`
        INSERT INTO products (
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
          branch,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        name,
        price,
        category,
        unit,
        typeCode,
        stock,
        minStock,
        stock > 0 ? 1 : 0,
        nextDisplayOrder,
        branch,
        now,
        now,
      );
      productId = Number(insert.lastInsertRowid);
    }

    if (stock > 0) {
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
        "initial",
        branch,
        stock,
        0,
        stock,
        "Alta de producto con inventario inicial",
        "manual",
        null,
        now,
      );
    }

    return productId;
  })();

  return getProductById(result, branch);
}

function removeProduct(productId, branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);
  const current = db.prepare(`
    SELECT id, active
    FROM products
    WHERE id = ? AND branch = ?
  `).get(productId, normalizedBranch);

  if (!current) {
    throw createHttpError("No encontre el producto para quitar.", 404);
  }

  if (!current.active) {
    return { id: current.id, removed: true, alreadyInactive: true };
  }

  db.prepare(`
    UPDATE products
    SET active = 0, updated_at = ?
    WHERE id = ? AND branch = ?
  `).run(nowIso(), productId, normalizedBranch);

  return { id: productId, removed: true, alreadyInactive: false };
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
      branch,
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
  createProduct,
  ensureCatalogSeeded,
  getProductById,
  importCatalogFromWorkbook,
  listAllProductsForExport,
  listProducts,
  removeProduct,
  updateProduct,
};