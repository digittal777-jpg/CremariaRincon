const fs = require("node:fs");

const { parseWorkbookCatalog } = require("../catalogParser");
const { DEFAULT_WORKBOOK_PATHS } = require("../config");
const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getMeasurementUnitRecord,
  getProductCategoryRecord,
  getSetting,
  mapProduct,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { setProductAttributes } = require("./businessProfile");

const db = getDb();

function resolveWorkbookPath(candidatePath) {
  const possiblePaths = [candidatePath, ...DEFAULT_WORKBOOK_PATHS].filter(Boolean);
  return possiblePaths.find((workbookPath) => fs.existsSync(workbookPath)) || null;
}

function getProductSelectSql() {
  return `
    SELECT
      p.id,
      p.name,
      p.price,
      p.cost,
      p.category,
      p.unit,
      p.category_id,
      p.unit_id,
      p.type_code,
      p.sku,
      p.barcode,
      p.brand,
      p.supplier_name,
      p.pack_size,
      p.stock,
      p.min_stock,
      p.stock_initialized,
      p.active,
      p.display_order,
      p.branch,
      pc.code AS category_code,
      pc.label AS category_label,
      pc.sort_order AS category_sort_order,
      mu.code AS unit_code,
      mu.label AS unit_label,
      mu.allow_decimals AS unit_allow_decimals,
      mu.step AS unit_step
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN measurement_units mu ON mu.id = p.unit_id
  `;
}

function mapProductRows(rows) {
  return rows.map((row) => mapProduct(row));
}

function resolveCategoryRecord(payload = {}, fallbackValue = "general") {
  return (
    getProductCategoryRecord(payload.categoryId ?? payload.category ?? payload.categoryCode, {
      includeInactive: true,
    })
    || getProductCategoryRecord(fallbackValue, { includeInactive: true })
  );
}

function resolveUnitRecord(payload = {}, fallbackValue = "pza") {
  return (
    getMeasurementUnitRecord(payload.unitId ?? payload.unit ?? payload.unitCode, {
      includeInactive: true,
    })
    || getMeasurementUnitRecord(fallbackValue, { includeInactive: true })
  );
}

function normalizeProductPayload(payload = {}, options = {}) {
  const categoryRecord = resolveCategoryRecord(payload, options.fallbackCategory || "general");
  const unitRecord = resolveUnitRecord(payload, options.fallbackUnit || "pza");
  if (!categoryRecord) {
    throw createHttpError("Selecciona una categoria valida.");
  }
  if (!unitRecord) {
    throw createHttpError("Selecciona una unidad valida.");
  }

  const packSize = payload.packSize === undefined || payload.packSize === null || payload.packSize === ""
    ? null
    : roundStock(payload.packSize);
  if (packSize != null && (!Number.isFinite(packSize) || packSize <= 0)) {
    throw createHttpError("El tamano de empaque no es valido.");
  }

  return {
    categoryRecord,
    unitRecord,
    typeCode: normalizeText(payload.typeCode || "", 8).toUpperCase() || null,
    sku: normalizeText(payload.sku || "", 48) || null,
    barcode: normalizeText(payload.barcode || "", 64) || null,
    brand: normalizeText(payload.brand || "", 60) || null,
    supplierName: normalizeText(payload.supplierName || payload.supplier_name || "", 80) || null,
    cost: payload.cost === undefined || payload.cost === null || payload.cost === ""
      ? 0
      : roundMoney(payload.cost),
    packSize,
    attributes: payload.attributes && typeof payload.attributes === "object" ? payload.attributes : {},
  };
}

async function ensureCatalogSeeded(candidatePath) {
  if (!candidatePath) {
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
  const upsertProductByBranch = db.prepare(`
    INSERT INTO products (
      name,
      price,
      cost,
      category,
      unit,
      category_id,
      unit_id,
      type_code,
      sku,
      barcode,
      brand,
      supplier_name,
      pack_size,
      stock,
      min_stock,
      display_order,
      branch,
      created_at,
      updated_at
    ) VALUES (
      @name,
      @price,
      @cost,
      @category,
      @unit,
      @categoryId,
      @unitId,
      @typeCode,
      @sku,
      @barcode,
      @brand,
      @supplierName,
      @packSize,
      @stock,
      @minStock,
      @displayOrder,
      @branch,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(name, branch) DO UPDATE SET
      price = excluded.price,
      cost = excluded.cost,
      category = excluded.category,
      unit = excluded.unit,
      category_id = excluded.category_id,
      unit_id = excluded.unit_id,
      type_code = excluded.type_code,
      sku = excluded.sku,
      barcode = excluded.barcode,
      brand = excluded.brand,
      supplier_name = excluded.supplier_name,
      pack_size = excluded.pack_size,
      min_stock = excluded.min_stock,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((products) => {
    STORE_BRANCHES.forEach((branch) => {
      products.forEach((product) => {
        const normalized = normalizeProductPayload(product, {
          fallbackCategory: product.category || "general",
          fallbackUnit: product.unit || "pza",
        });
        upsertProductByBranch.run({
          name: product.name,
          price: roundMoney(product.price),
          cost: roundMoney(product.cost || 0),
          category: normalized.categoryRecord.code,
          unit: normalized.unitRecord.code,
          categoryId: normalized.categoryRecord.id,
          unitId: normalized.unitRecord.id,
          typeCode: normalized.typeCode,
          sku: normalized.sku,
          barcode: normalized.barcode,
          brand: normalized.brand,
          supplierName: normalized.supplierName,
          packSize: normalized.packSize,
          stock: roundStock(product.stock || 0),
          minStock: Math.max(0, roundStock(product.minStock || 0)),
          displayOrder: Number(product.displayOrder || 0),
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
    branches: [...STORE_BRANCHES],
    workbookPath: resolvedPath,
  };
}

function listProducts(branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);
  const rows = db.prepare(`
    ${getProductSelectSql()}
    WHERE p.active = 1 AND p.branch = ?
    ORDER BY
      COALESCE(pc.sort_order, 9999),
      p.display_order,
      p.name COLLATE NOCASE
  `).all(normalizedBranch);

  return mapProductRows(rows);
}

function getProductById(productId, branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);
  const row = db.prepare(`
    ${getProductSelectSql()}
    WHERE p.id = ? AND p.branch = ?
  `).get(productId, normalizedBranch);

  return row ? mapProduct(row) : null;
}

function updateProduct(productId, payload) {
  const branch = normalizeBranch(payload.branch);
  const current = db.prepare(`
    SELECT
      id,
      name,
      price,
      cost,
      stock,
      min_stock,
      stock_initialized,
      active,
      category,
      category_id,
      unit,
      unit_id,
      type_code,
      sku,
      barcode,
      brand,
      supplier_name,
      pack_size
    FROM products
    WHERE id = ? AND branch = ?
  `).get(productId, branch);

  if (!current) {
    throw createHttpError("No encontre el producto que quieres actualizar.", 404);
  }

  const normalizedMeta = normalizeProductPayload(payload, {
    fallbackCategory: current.category,
    fallbackUnit: current.unit,
  });
  const nextName = payload.name === undefined
    ? current.name
    : normalizeText(payload.name, 80);
  const nextPrice = payload.price === undefined
    ? roundMoney(current.price)
    : roundMoney(payload.price);
  const nextCost = payload.cost === undefined
    ? roundMoney(current.cost || 0)
    : roundMoney(payload.cost);
  const nextStock = payload.stock === undefined
    ? roundStock(current.stock)
    : roundStock(payload.stock);
  const nextMinStock = payload.minStock === undefined
    ? roundStock(current.min_stock)
    : Math.max(0, roundStock(payload.minStock));
  const nextActive = payload.active === undefined ? current.active : payload.active ? 1 : 0;

  if (!nextName) {
    throw createHttpError("Captura un nombre de producto valido.");
  }
  if (nextPrice <= 0) {
    throw createHttpError("El precio debe ser mayor a cero.");
  }
  if (nextCost < 0) {
    throw createHttpError("El costo no puede ser negativo.");
  }
  if (!Number.isFinite(nextStock)) {
    throw createHttpError("La existencia capturada no es valida.");
  }

  const duplicate = db.prepare(`
    SELECT id
    FROM products
    WHERE branch = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)) AND id <> ?
  `).get(branch, nextName, productId);
  if (duplicate) {
    throw createHttpError("Ya existe otro producto con ese nombre en esta sucursal.", 409);
  }

  const now = nowIso();
  const note = normalizeText(payload.note || "Ajuste manual de inventario", 120);

  db.transaction(() => {
    db.prepare(`
      UPDATE products
      SET
        name = ?,
        price = ?,
        cost = ?,
        category = ?,
        unit = ?,
        category_id = ?,
        unit_id = ?,
        type_code = ?,
        sku = ?,
        barcode = ?,
        brand = ?,
        supplier_name = ?,
        pack_size = ?,
        stock = ?,
        min_stock = ?,
        stock_initialized = 1,
        active = ?,
        updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(
      nextName,
      nextPrice,
      nextCost,
      normalizedMeta.categoryRecord.code,
      normalizedMeta.unitRecord.code,
      normalizedMeta.categoryRecord.id,
      normalizedMeta.unitRecord.id,
      normalizedMeta.typeCode,
      normalizedMeta.sku,
      normalizedMeta.barcode,
      normalizedMeta.brand,
      normalizedMeta.supplierName,
      normalizedMeta.packSize,
      nextStock,
      nextMinStock,
      nextActive,
      now,
      productId,
      branch,
    );

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

    if (payload.attributes && typeof payload.attributes === "object") {
      setProductAttributes(productId, payload.attributes);
    }
  })();

  return getProductById(productId, branch);
}

function createProduct(payload) {
  const branch = normalizeBranch(payload.branch);
  const name = normalizeText(payload.name || "", 80);
  const price = roundMoney(payload.price);
  const stock = roundStock(payload.stock || 0);
  const minStock = Math.max(0, roundStock(payload.minStock || 0));
  const normalizedMeta = normalizeProductPayload(payload, {
    fallbackCategory: payload.category || "general",
    fallbackUnit: payload.unit || "pza",
  });
  const now = nowIso();

  if (!name) {
    throw createHttpError("Captura un nombre de producto valido.");
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw createHttpError("El precio debe ser mayor a cero.");
  }
  if (normalizedMeta.cost < 0) {
    throw createHttpError("El costo no puede ser negativo.");
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
          name = ?,
          price = ?,
          cost = ?,
          category = ?,
          unit = ?,
          category_id = ?,
          unit_id = ?,
          type_code = ?,
          sku = ?,
          barcode = ?,
          brand = ?,
          supplier_name = ?,
          pack_size = ?,
          stock = ?,
          min_stock = ?,
          stock_initialized = ?,
          active = 1,
          updated_at = ?
        WHERE id = ? AND branch = ?
      `).run(
        name,
        price,
        normalizedMeta.cost,
        normalizedMeta.categoryRecord.code,
        normalizedMeta.unitRecord.code,
        normalizedMeta.categoryRecord.id,
        normalizedMeta.unitRecord.id,
        normalizedMeta.typeCode,
        normalizedMeta.sku,
        normalizedMeta.barcode,
        normalizedMeta.brand,
        normalizedMeta.supplierName,
        normalizedMeta.packSize,
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
          cost,
          category,
          unit,
          category_id,
          unit_id,
          type_code,
          sku,
          barcode,
          brand,
          supplier_name,
          pack_size,
          stock,
          min_stock,
          stock_initialized,
          active,
          display_order,
          branch,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        name,
        price,
        normalizedMeta.cost,
        normalizedMeta.categoryRecord.code,
        normalizedMeta.unitRecord.code,
        normalizedMeta.categoryRecord.id,
        normalizedMeta.unitRecord.id,
        normalizedMeta.typeCode,
        normalizedMeta.sku,
        normalizedMeta.barcode,
        normalizedMeta.brand,
        normalizedMeta.supplierName,
        normalizedMeta.packSize,
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

    if (payload.attributes && typeof payload.attributes === "object") {
      setProductAttributes(productId, payload.attributes);
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
    ${getProductSelectSql()}
    ORDER BY
      COALESCE(pc.sort_order, 9999),
      p.active DESC,
      p.display_order,
      p.name COLLATE NOCASE
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
  resolveWorkbookPath,
  updateProduct,
};
