const fs = require("node:fs");

const { parseWorkbookCatalog } = require("../catalogParser");
const { DEFAULT_WORKBOOK_PATHS } = require("../config");
const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
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

function listProducts(branch = "carrizal", options = {}) {
  const normalizedBranch = normalizeBranch(branch);
  const whereClause = options.includeInactive === true
    ? "WHERE p.branch = ?"
    : "WHERE p.active = 1 AND p.branch = ?";
  const rows = db.prepare(`
    ${getProductSelectSql()}
    ${whereClause}
    ORDER BY
      COALESCE(pc.sort_order, 9999),
      p.display_order,
      p.name COLLATE NOCASE
  `).all(normalizedBranch);

  return mapProductRows(rows);
}

function normalizeProductPageLimit(value, fallback = 120) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(Math.max(limit, 1), 250);
}

function listProductsPage(branch = "carrizal", options = {}) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const includeInactive = options.includeInactive === true;
  const limit = normalizeProductPageLimit(options.limit);
  const offset = Math.max(0, Number.parseInt(String(options.offset || 0), 10) || 0);
  const search = normalizeText(options.search || "", 120).toLowerCase();
  const filter = normalizeText(options.filter || "all", 24).toLowerCase();
  const clauses = [];
  const params = [];

  if (normalizedBranch !== ALL_BRANCHES) {
    clauses.push("p.branch = ?");
    params.push(normalizedBranch);
  }
  if (!includeInactive && filter !== "inactive") {
    clauses.push("p.active = 1");
  }
  if (search) {
    clauses.push(`(
      LOWER(p.name) LIKE ?
      OR LOWER(COALESCE(p.sku, '')) LIKE ?
      OR LOWER(COALESCE(p.barcode, '')) LIKE ?
      OR LOWER(COALESCE(p.brand, '')) LIKE ?
      OR LOWER(COALESCE(p.supplier_name, '')) LIKE ?
      OR LOWER(COALESCE(pc.label, p.category, '')) LIKE ?
    )`);
    const searchLike = `%${search}%`;
    params.push(searchLike, searchLike, searchLike, searchLike, searchLike, searchLike);
  }
  if (filter === "low") {
    clauses.push("p.active = 1 AND p.stock_initialized = 1 AND p.stock <= p.min_stock AND p.stock >= 0");
  } else if (filter === "negative") {
    clauses.push("p.stock < 0");
  } else if (filter === "uncounted") {
    clauses.push("(p.stock_initialized = 0 OR p.stock_initialized IS NULL)");
  } else if (filter === "inactive") {
    clauses.push("p.active = 0");
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    ${whereSql}
  `).get(...params)?.count || 0);
  const rows = db.prepare(`
    ${getProductSelectSql()}
    ${whereSql}
    ORDER BY
      p.branch COLLATE NOCASE,
      COALESCE(pc.sort_order, 9999),
      p.display_order,
      p.name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    products: mapProductRows(rows),
    page: {
      branch: normalizedBranch,
      limit,
      offset,
      total,
      returned: rows.length,
      hasMore: offset + rows.length < total,
      search,
      filter,
      includeInactive,
    },
  };
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

function listAllProductsForExport(options = {}) {
  const normalizedBranch = normalizeBranch(options.branch || ALL_BRANCHES, {
    allowAll: true,
    fallback: ALL_BRANCHES,
  });
  const whereSql = normalizedBranch === ALL_BRANCHES ? "" : "WHERE p.branch = ?";
  const params = normalizedBranch === ALL_BRANCHES ? [] : [normalizedBranch];
  return db.prepare(`
    ${getProductSelectSql()}
    ${whereSql}
    ORDER BY
      COALESCE(pc.sort_order, 9999),
      p.active DESC,
      p.display_order,
      p.name COLLATE NOCASE
  `).all(...params);
}

function normalizeDuplicateMatchValue(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildDuplicateProductSummary(row) {
  return {
    id: Number(row.id),
    name: row.name,
    sku: row.sku || "",
    barcode: row.barcode || "",
    brand: row.brand || "",
    supplierName: row.supplier_name || "",
    price: roundMoney(row.price || 0),
    cost: roundMoney(row.cost || 0),
    stock: roundStock(row.stock || 0),
    active: Boolean(row.active),
    branch: row.branch,
  };
}

function listProductDuplicateCandidates(branch = "carrizal", options = {}) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const search = normalizeDuplicateMatchValue(options.search || "");
  const branchSql = normalizedBranch === ALL_BRANCHES ? "" : "WHERE branch = ?";
  const rows = db.prepare(`
    SELECT id, name, sku, barcode, brand, supplier_name, price, cost, stock, active, branch
    FROM products
    ${branchSql}
    ORDER BY branch COLLATE NOCASE, active DESC, name COLLATE NOCASE, id ASC
  `).all(...(normalizedBranch === ALL_BRANCHES ? [] : [normalizedBranch]));
  const groups = new Map();

  rows.forEach((row) => {
    const candidates = [
      row.barcode ? { type: "barcode", label: "Codigo de barras", value: normalizeDuplicateMatchValue(row.barcode) } : null,
      row.sku ? { type: "sku", label: "SKU", value: normalizeDuplicateMatchValue(row.sku) } : null,
      row.name ? { type: "name", label: "Nombre parecido", value: normalizeDuplicateMatchValue(row.name) } : null,
    ].filter((item) => item?.value);

    candidates.forEach((candidate) => {
      const key = `${row.branch}:${candidate.type}:${candidate.value}`;
      if (!groups.has(key)) {
        groups.set(key, {
          branch: row.branch,
          matchType: candidate.type,
          matchLabel: candidate.label,
          matchValue: candidate.value,
          products: [],
        });
      }
      groups.get(key).products.push(buildDuplicateProductSummary(row));
    });
  });

  return [...groups.values()]
    .filter((group) => group.products.length > 1)
    .filter((group) => {
      if (!search) {
        return true;
      }
      return group.products.some((product) =>
        normalizeDuplicateMatchValue([
          product.name,
          product.sku,
          product.barcode,
          product.brand,
          product.supplierName,
        ].join(" ")).includes(search),
      );
    })
    .map((group) => {
      const products = group.products
        .sort((left, right) => Number(right.active) - Number(left.active) || right.stock - left.stock || left.id - right.id);
      return {
        ...group,
        products,
        stockTotal: roundStock(products.reduce((sum, product) => sum + roundStock(product.stock || 0), 0)),
        activeCount: products.filter((product) => product.active).length,
      };
    })
    .sort((left, right) =>
      left.branch.localeCompare(right.branch, "es")
      || right.stockTotal - left.stockTotal
      || left.matchValue.localeCompare(right.matchValue, "es"),
    );
}

function copyMissingProductAttributes(sourceProductId, targetProductId, timestamp) {
  db.prepare(`
    INSERT OR IGNORE INTO product_attribute_values (
      product_id,
      definition_id,
      value_text,
      updated_at
    )
    SELECT
      ?,
      source.definition_id,
      source.value_text,
      ?
    FROM product_attribute_values source
    WHERE source.product_id = ?
      AND COALESCE(source.value_text, '') <> ''
  `).run(targetProductId, timestamp, sourceProductId);
}

function mergeProductDuplicates(payload = {}) {
  const branch = normalizeBranch(payload.branch);
  const sourceProductId = Number(payload.sourceProductId);
  const targetProductId = Number(payload.targetProductId);

  if (!Number.isInteger(sourceProductId) || sourceProductId <= 0) {
    throw createHttpError("Selecciona el producto duplicado que vas a fusionar.", 400);
  }
  if (!Number.isInteger(targetProductId) || targetProductId <= 0) {
    throw createHttpError("Selecciona el producto principal que va a quedar.", 400);
  }
  if (sourceProductId === targetProductId) {
    throw createHttpError("El producto duplicado y el principal no pueden ser el mismo.", 400);
  }

  const source = db.prepare(`
    SELECT *
    FROM products
    WHERE id = ? AND branch = ?
  `).get(sourceProductId, branch);
  const target = db.prepare(`
    SELECT *
    FROM products
    WHERE id = ? AND branch = ?
  `).get(targetProductId, branch);

  if (!source || !target) {
    throw createHttpError("Los productos deben existir en la misma sucursal.", 404);
  }

  const mergedAt = nowIso();
  const sourceStock = roundStock(source.stock || 0);
  const targetStockBefore = roundStock(target.stock || 0);
  const targetStockAfter = roundStock(targetStockBefore + sourceStock);

  const result = db.transaction(() => {
    const salesUpdated = db.prepare("UPDATE sale_items SET product_id = ? WHERE product_id = ?")
      .run(targetProductId, sourceProductId).changes;
    const movementsUpdated = db.prepare("UPDATE inventory_movements SET product_id = ? WHERE product_id = ?")
      .run(targetProductId, sourceProductId).changes;
    const requestsUpdated = db.prepare("UPDATE merchandise_request_items SET product_id = ? WHERE product_id = ?")
      .run(targetProductId, sourceProductId).changes;

    copyMissingProductAttributes(sourceProductId, targetProductId, mergedAt);
    const sourceAttributesRemoved = db.prepare("DELETE FROM product_attribute_values WHERE product_id = ?")
      .run(sourceProductId).changes;

    const weightedRows = db.prepare(`
      SELECT id, session_id, product_id
      FROM weighted_audit_items
      WHERE product_id = ?
    `).all(sourceProductId);
    let weightedAuditUpdated = 0;
    weightedRows.forEach((row) => {
      const targetExists = db.prepare(`
        SELECT id
        FROM weighted_audit_items
        WHERE session_id = ? AND product_id = ?
      `).get(row.session_id, targetProductId);
      if (targetExists) {
        db.prepare("DELETE FROM weighted_audit_items WHERE id = ?").run(row.id);
      } else {
        weightedAuditUpdated += db.prepare(`
          UPDATE weighted_audit_items
          SET product_id = ?, updated_at = ?
          WHERE id = ?
        `).run(targetProductId, mergedAt, row.id).changes;
      }
    });

    db.prepare(`
      UPDATE products
      SET
        stock = ?,
        stock_initialized = CASE WHEN stock_initialized = 1 OR ? = 1 THEN 1 ELSE stock_initialized END,
        cost = CASE WHEN COALESCE(cost, 0) > 0 THEN cost ELSE ? END,
        sku = CASE WHEN COALESCE(sku, '') <> '' THEN sku ELSE ? END,
        barcode = CASE WHEN COALESCE(barcode, '') <> '' THEN barcode ELSE ? END,
        brand = CASE WHEN COALESCE(brand, '') <> '' THEN brand ELSE ? END,
        supplier_name = CASE WHEN COALESCE(supplier_name, '') <> '' THEN supplier_name ELSE ? END,
        pack_size = CASE WHEN pack_size IS NOT NULL THEN pack_size ELSE ? END,
        min_stock = MAX(COALESCE(min_stock, 0), ?),
        active = CASE WHEN active = 1 OR ? = 1 THEN 1 ELSE active END,
        updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(
      targetStockAfter,
      Number(source.stock_initialized || 0),
      roundMoney(source.cost || 0),
      source.sku || null,
      source.barcode || null,
      source.brand || null,
      source.supplier_name || null,
      source.pack_size ?? null,
      roundStock(source.min_stock || 0),
      Number(source.active || 0),
      mergedAt,
      targetProductId,
      branch,
    );

    db.prepare(`
      UPDATE products
      SET stock = 0, active = 0, updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(mergedAt, sourceProductId, branch);

    if (sourceStock !== 0) {
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
        targetProductId,
        "merge",
        branch,
        sourceStock,
        targetStockBefore,
        targetStockAfter,
        `Fusion de producto duplicado #${sourceProductId}: ${source.name}`,
        "product_merge",
        sourceProductId,
        mergedAt,
      );
    }

    return {
      salesUpdated,
      movementsUpdated,
      requestsUpdated,
      weightedAuditUpdated,
      sourceAttributesRemoved,
      sourceProductId,
      targetProductId,
      branch,
      stockMerged: sourceStock,
    };
  })();

  return {
    ...result,
    product: getProductById(targetProductId, branch),
  };
}

module.exports = {
  createProduct,
  ensureCatalogSeeded,
  getProductById,
  importCatalogFromWorkbook,
  listAllProductsForExport,
  listProductDuplicateCandidates,
  listProducts,
  listProductsPage,
  mergeProductDuplicates,
  removeProduct,
  resolveWorkbookPath,
  updateProduct,
};
