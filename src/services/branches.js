const { getDb, nowIso } = require("../db");
const {
  STORE_TIME_ZONE,
  createHttpError,
  getBranchRecord,
  listConfiguredBranches,
  normalizeText,
} = require("../utils/helpers");

const db = getDb();

function normalizeBranchCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function buildBranchNameFromCode(code) {
  return String(code || "")
    .split("-")
    .filter(Boolean)
    .map((fragment) => fragment.charAt(0).toUpperCase() + fragment.slice(1))
    .join(" ");
}

function mapBranch(row) {
  return {
    code: row.code,
    name: row.name,
    timezone: row.timezone || STORE_TIME_ZONE,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function listBranches(options = {}) {
  return listConfiguredBranches({ includeInactive: options.includeInactive === true }).map((branch) => ({
    code: branch.code,
    name: branch.name,
    timezone: branch.timezone,
    active: Boolean(branch.active),
    sortOrder: Number(branch.sortOrder || 0),
  }));
}

function getBranchByCode(code, options = {}) {
  const normalizedCode = normalizeBranchCode(code);
  if (!normalizedCode) {
    return null;
  }

  const row = db.prepare(`
    SELECT code, name, timezone, active, sort_order, created_at, updated_at
    FROM branches
    WHERE code = ?
  `).get(normalizedCode);

  if (!row) {
    return null;
  }

  if (!options.includeInactive && !row.active) {
    return null;
  }

  return mapBranch(row);
}

function ensureAtLeastOneActiveBranch(nextActiveCode = null) {
  const activeBranches = db.prepare("SELECT code FROM branches WHERE active = 1 ORDER BY sort_order ASC, name COLLATE NOCASE").all();
  if (activeBranches.length > 1) {
    return;
  }

  if (activeBranches.length === 1 && activeBranches[0].code === nextActiveCode) {
    throw createHttpError("Debe quedar al menos una sucursal activa.", 409);
  }
}

function renameBranchReferences(currentCode, nextCode) {
  if (currentCode === nextCode) {
    return;
  }

  const statements = [
    "UPDATE products SET branch = ? WHERE branch = ?",
    "UPDATE sales SET branch = ? WHERE branch = ?",
    "UPDATE credit_payments SET branch = ? WHERE branch = ?",
    "UPDATE inventory_movements SET branch = ? WHERE branch = ?",
    "UPDATE register_events SET branch = ? WHERE branch = ?",
    "UPDATE cashiers SET branch = ? WHERE branch = ?",
    "UPDATE weighted_audit_sessions SET branch = ? WHERE branch = ?",
    "UPDATE merchandise_requests SET branch = ? WHERE branch = ?",
    "UPDATE admin_audit_logs SET branch = ? WHERE branch = ?",
    "UPDATE client_sync_reports SET branch = ? WHERE branch = ?",
    "UPDATE period_closures SET branch = ? WHERE branch = ?",
  ];

  statements.forEach((statement) => {
    db.prepare(statement).run(nextCode, currentCode);
  });
}

function getProductCountForBranch(branchCode) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE branch = ?").get(branchCode)?.count || 0);
}

function resolveProductCopySourceBranch(targetCode, requestedSource = "") {
  const requestedCode = normalizeBranchCode(requestedSource);
  if (
    requestedCode
    && requestedCode !== targetCode
    && getBranchByCode(requestedCode, { includeInactive: true })
    && getProductCountForBranch(requestedCode) > 0
  ) {
    return requestedCode;
  }

  const sourceRow = db.prepare(`
    SELECT b.code, COUNT(p.id) AS product_count
    FROM branches b
    LEFT JOIN products p ON p.branch = b.code
    WHERE b.code <> ? AND b.active = 1
    GROUP BY b.code
    HAVING product_count > 0
    ORDER BY product_count DESC, b.sort_order ASC, b.name COLLATE NOCASE
    LIMIT 1
  `).get(targetCode);

  return sourceRow?.code || null;
}

function copyProductsToBranch(sourceCode, targetCode, now) {
  if (!sourceCode || sourceCode === targetCode || getProductCountForBranch(targetCode) > 0) {
    return {
      sourceBranch: sourceCode || null,
      productsCopied: 0,
      attributeValuesCopied: 0,
    };
  }

  const sourceProducts = db.prepare(`
    SELECT
      id,
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
      display_order
    FROM products
    WHERE branch = ?
    ORDER BY display_order ASC, name COLLATE NOCASE
  `).all(sourceCode);

  const insertProduct = db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAttributeValue = db.prepare(`
    INSERT INTO product_attribute_values (product_id, definition_id, value_text, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, definition_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_at = excluded.updated_at
  `);
  const getAttributeValues = db.prepare(`
    SELECT definition_id, value_text
    FROM product_attribute_values
    WHERE product_id = ?
  `);
  const insertMovement = db.prepare(`
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
  `);

  let attributeValuesCopied = 0;

  sourceProducts.forEach((product) => {
    const inserted = insertProduct.run(
      product.name,
      Number(product.price || 0),
      Number(product.cost || 0),
      product.category,
      product.unit,
      product.category_id,
      product.unit_id,
      product.type_code,
      product.sku,
      product.barcode,
      product.brand,
      product.supplier_name,
      product.pack_size,
      Number(product.stock || 0),
      Number(product.min_stock || 0),
      Number(product.stock_initialized || 0),
      Number(product.active || 0),
      Number(product.display_order || 0),
      targetCode,
      now,
      now,
    );
    const newProductId = Number(inserted.lastInsertRowid);

    getAttributeValues.all(product.id).forEach((attributeValue) => {
      insertAttributeValue.run(
        newProductId,
        attributeValue.definition_id,
        attributeValue.value_text,
        now,
      );
      attributeValuesCopied += 1;
    });

    if (Number(product.stock_initialized || 0) && Number(product.stock || 0) !== 0) {
      insertMovement.run(
        newProductId,
        "initial",
        targetCode,
        Number(product.stock || 0),
        0,
        Number(product.stock || 0),
        `Copia inicial desde ${sourceCode}`,
        "branch_create",
        null,
        now,
      );
    }
  });

  return {
    sourceBranch: sourceCode,
    productsCopied: sourceProducts.length,
    attributeValuesCopied,
  };
}

function createBranch(payload = {}) {
  const code = normalizeBranchCode(payload.code || "");
  const name = normalizeText(payload.name || "", 80);
  const timezone = normalizeText(payload.timezone || STORE_TIME_ZONE, 64) || STORE_TIME_ZONE;
  const active = payload.active === undefined ? true : Boolean(payload.active);
  const sortOrder = Number.isFinite(Number(payload.sortOrder))
    ? Number(payload.sortOrder)
    : listConfiguredBranches({ includeInactive: true }).length;

  if (!code) {
    throw createHttpError("El codigo de sucursal es requerido.");
  }
  if (code === "all") {
    throw createHttpError("El codigo \"all\" esta reservado.");
  }
  if (!name) {
    throw createHttpError("El nombre de la sucursal es requerido.");
  }
  if (getBranchByCode(code, { includeInactive: true })) {
    throw createHttpError("Ya existe una sucursal con ese codigo.", 409);
  }

  const now = nowIso();
  const shouldCopyProducts = payload.copyProducts !== false;
  const copySourceBranch = shouldCopyProducts
    ? resolveProductCopySourceBranch(code, payload.copyProductsFromBranch || payload.sourceBranch)
    : null;
  const productCopy = db.transaction(() => {
    db.prepare(`
      INSERT INTO branches (code, name, timezone, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, name, timezone, active ? 1 : 0, sortOrder, now, now);
    return copyProductsToBranch(copySourceBranch, code, now);
  })();

  return {
    ...getBranchByCode(code, { includeInactive: true }),
    productCopy,
  };
}

function updateBranch(currentCode, payload = {}) {
  const current = getBranchByCode(currentCode, { includeInactive: true });
  if (!current) {
    throw createHttpError("La sucursal no existe.", 404);
  }

  const nextCode = payload.code === undefined
    ? current.code
    : normalizeBranchCode(payload.code);
  const nextName = payload.name === undefined
    ? current.name
    : normalizeText(payload.name || "", 80);
  const nextTimezone = payload.timezone === undefined
    ? current.timezone
    : normalizeText(payload.timezone || "", 64) || STORE_TIME_ZONE;
  const nextActive = payload.active === undefined
    ? current.active
    : Boolean(payload.active);
  const nextSortOrder = payload.sortOrder === undefined
    ? current.sortOrder
    : Number.isFinite(Number(payload.sortOrder))
      ? Number(payload.sortOrder)
      : current.sortOrder;

  if (!nextCode) {
    throw createHttpError("El codigo de sucursal no es valido.");
  }
  if (nextCode === "all") {
    throw createHttpError("El codigo \"all\" esta reservado.");
  }
  if (!nextName) {
    throw createHttpError("El nombre de la sucursal es requerido.");
  }
  if (nextCode !== current.code && getBranchByCode(nextCode, { includeInactive: true })) {
    throw createHttpError("Ya existe otra sucursal con ese codigo.", 409);
  }
  if (!nextActive && current.active) {
    ensureAtLeastOneActiveBranch(current.code);
  }

  const now = nowIso();
  db.transaction(() => {
    if (nextCode !== current.code) {
      renameBranchReferences(current.code, nextCode);
      db.prepare("UPDATE branches SET code = ? WHERE code = ?").run(nextCode, current.code);
    }

    db.prepare(`
      UPDATE branches
      SET name = ?, timezone = ?, active = ?, sort_order = ?, updated_at = ?
      WHERE code = ?
    `).run(nextName, nextTimezone, nextActive ? 1 : 0, nextSortOrder, now, nextCode);
  })();

  return getBranchByCode(nextCode, { includeInactive: true });
}

function ensureBranchesExist(branchCodes = []) {
  const created = [];

  branchCodes.forEach((branchCode, index) => {
    const normalizedCode = normalizeBranchCode(branchCode);
    if (!normalizedCode || getBranchByCode(normalizedCode, { includeInactive: true })) {
      return;
    }

    created.push(
      createBranch({
        code: normalizedCode,
        name: buildBranchNameFromCode(normalizedCode),
        timezone: STORE_TIME_ZONE,
        active: true,
        sortOrder: listConfiguredBranches({ includeInactive: true }).length + index,
        copyProducts: false,
      }),
    );
  });

  return created;
}

module.exports = {
  buildBranchNameFromCode,
  copyProductsToBranch,
  createBranch,
  ensureBranchesExist,
  getBranchByCode,
  listBranches,
  normalizeBranchCode,
  updateBranch,
};
