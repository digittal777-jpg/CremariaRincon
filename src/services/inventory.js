const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  assertBranchIsActive,
  createHttpError,
  getBranchLabel,
  getInventoryMovementTypeLabel,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

function getQuickImportRows(branch = STORE_BRANCHES[0]) {
  const { listStoreDaySaleItems } = require("./sales");
  const soldTodayByProductId = new Map();
  listStoreDaySaleItems(new Date(), branch).forEach((item) => {
    const currentValue = soldTodayByProductId.get(item.product_id) || 0;
    soldTodayByProductId.set(
      item.product_id,
      roundStock(currentValue + roundStock(item.quantity)),
    );
  });

  const normalizedBranch = normalizeBranch(branch);
  const rows = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.price,
      p.category,
      p.unit,
      p.type_code,
      p.stock,
      p.min_stock,
      p.stock_initialized,
      p.active,
      p.display_order
    FROM products p
    WHERE p.active = 1 AND p.branch = ?
    ORDER BY
      CASE p.category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      p.stock_initialized ASC,
      p.display_order,
      p.name COLLATE NOCASE
  `).all(normalizedBranch);

  return rows.map((row) => {
    const { mapProduct } = require("../utils/helpers");
    return {
      ...mapProduct(row),
      soldToday: roundStock(soldTodayByProductId.get(row.id) || 0),
      recordedStock: roundStock(row.stock),
    };
  });
}

function getQuickImportProductId(payload) {
  const candidateIds = [payload.productId, payload.id, payload.product_id];

  for (const candidateId of candidateIds) {
    const productId = Number(candidateId);
    if (Number.isInteger(productId) && productId > 0) {
      return productId;
    }
  }

  return null;
}

function findQuickImportProduct(payload, branch = "carrizal") {
  const normalizedBranch = normalizeBranch(branch);

  const productId = getQuickImportProductId(payload);
  if (productId) {
    const byId = db.prepare(`
      SELECT id, name, stock, active, branch FROM products WHERE id = ? AND branch = ?
    `).get(productId, normalizedBranch);
    if (byId) {
      return byId;
    }
  }

  const rawName = String(
    payload.productName || payload.name || payload.product_name || ""
  ).trim();

  if (!rawName) {
    return null;
  }

  const product = db.prepare(`
    SELECT id, name, stock, active, branch
    FROM products
    WHERE active = 1 AND branch = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))
    LIMIT 1
  `).get(normalizedBranch, rawName);

  if (product) {
    return product;
  }

  return null;
}

function applyQuickInventoryEntry(payload) {
  const mode = normalizeText(payload.mode || "receive", 24).toLowerCase();
  const branch = normalizeBranch(payload.branch);
  const productId = getQuickImportProductId(payload);
  const current = productId ? findQuickImportProduct({ productId }, branch) : null;

  assertBranchIsActive(branch, "Selecciona una sucursal activa para mover inventario.");

  if (!current) {
    throw createHttpError("Selecciona un producto valido para la captura rapida.");
  }

  if (!["receive", "return"].includes(mode)) {
    throw createHttpError("El tipo de movimiento de inventario no es valido.");
  }

  if (!current || !current.active) {
    throw createHttpError("El producto ya no esta disponible para inventario.", 404);
  }

  const resolvedProductId = current.id;
  const stockBefore = roundStock(current.stock);
  const supplierName = normalizeText(payload.supplierName || "", 60);
  const customNote = normalizeText(payload.note || "", 120);
  const now = nowIso();

  // La cantidad siempre viene en payload.quantity
  const rawQuantity = roundStock(payload.quantity);
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
    throw createHttpError("La cantidad debe ser mayor a cero.");
  }

  let quantityDelta = 0;
  let stockAfter = stockBefore;
  let movementType = "supplier";
  let referenceType = "inventory-control";
  let note = customNote;

  if (mode === "receive") {
    // Entrada de inventario: suma la cantidad
    quantityDelta = rawQuantity;
    stockAfter = roundStock(stockBefore + quantityDelta);
    movementType = "supplier";
    note = note || (supplierName ? `Entrada de inventario: ${supplierName}` : "Entrada de inventario");
  }

  if (mode === "return") {
    // Retorno de proveedor: resta la cantidad
    quantityDelta = roundStock(-rawQuantity);
    stockAfter = roundStock(stockBefore + quantityDelta);
    
    if (stockAfter < 0) {
      throw createHttpError("No puedes retirar mas producto del que existe en inventario.");
    }

    movementType = "supplier_out";
    note = note || (supplierName ? `Retorno de proveedor: ${supplierName}` : "Retorno de inventario");
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE products
      SET stock = ?, stock_initialized = 1, updated_at = ?
      WHERE id = ? AND branch = ?
    `).run(stockAfter, now, resolvedProductId, branch);

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
      resolvedProductId,
      movementType,
      branch,
      quantityDelta,
      stockBefore,
      stockAfter,
      note,
      referenceType,
      null,
      now,
    );
  })();

  const { getProductById } = require("./products");
  return getProductById(resolvedProductId, branch);
}

function getInventoryMovementById(movementId) {
  const row = db.prepare(`
    SELECT
      im.id,
      im.product_id,
      im.branch,
      p.name AS product_name,
      im.movement_type,
      im.quantity_delta,
      im.stock_before,
      im.stock_after,
      im.note,
      im.reference_type,
      im.reference_id,
      im.created_at
    FROM inventory_movements im
    JOIN products p ON p.id = im.product_id
    WHERE im.id = ?
  `).get(movementId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    branch: row.branch,
    movementType: row.movement_type,
    quantityDelta: roundStock(row.quantity_delta),
    stockBefore: roundStock(row.stock_before),
    stockAfter: roundStock(row.stock_after),
    note: row.note || "",
    referenceType: row.reference_type || "",
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
}

function getRecentInventoryMovements(limit = 16, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        im.id,
        im.product_id,
        im.branch,
        p.name AS product_name,
        im.movement_type,
        im.quantity_delta,
        im.created_at
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        im.id,
        im.product_id,
        im.branch,
        p.name AS product_name,
        im.movement_type,
        im.quantity_delta,
        im.created_at
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      WHERE im.branch = ?
      ORDER BY im.created_at DESC, im.id DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    branch: row.branch,
    movementType: row.movement_type,
    quantityDelta: roundStock(row.quantity_delta),
    createdAt: row.created_at,
  }));
}

function updateInventoryMovementAdmin(movementId, payload) {
  const current = getInventoryMovementById(movementId);
  if (!current) {
    throw createHttpError("No encontre el movimiento de inventario.", 404);
  }

  const nextNote = normalizeText(payload.note ?? current.note ?? "", 120) || null;

  if (current.movementType === "sale") {
    db.prepare(`
      UPDATE inventory_movements
      SET note = ?
      WHERE id = ?
    `).run(nextNote, movementId);

    return getInventoryMovementById(movementId);
  }

  const nextQuantityDelta = roundStock(
    payload.quantityDelta === undefined ? current.quantityDelta : payload.quantityDelta,
  );
  const quantityDiff = roundStock(nextQuantityDelta - current.quantityDelta);
  const currentProduct = db.prepare(`
    SELECT stock, branch
    FROM products
    WHERE id = ?
  `).get(current.productId);

  if (roundStock((currentProduct?.stock || 0) + quantityDiff) < 0) {
    throw createHttpError("Ese cambio dejaria el inventario del producto en negativo.");
  }

  db.transaction(() => {
    if (quantityDiff !== 0) {
      db.prepare(`
        UPDATE inventory_movements
        SET quantity_delta = ?, note = ?
        WHERE id = ?
      `).run(nextQuantityDelta, nextNote, movementId);

      let runningBefore = current.stockBefore;
      const fullRows = db.prepare(`
        SELECT id, quantity_delta
        FROM inventory_movements
        WHERE product_id = ? AND (created_at > ? OR (created_at = ? AND id >= ?))
        ORDER BY created_at ASC, id ASC
      `).all(current.productId, current.createdAt, current.createdAt, current.id);

      fullRows.forEach((row, index) => {
        const delta = row.id === movementId ? nextQuantityDelta : roundStock(row.quantity_delta);
        const before = index === 0 ? current.stockBefore : runningBefore;
        const after = roundStock(before + delta);
        db.prepare(`
          UPDATE inventory_movements
          SET stock_before = ?, stock_after = ?
          WHERE id = ?
        `).run(before, after, row.id);
        runningBefore = after;
      });

      db.prepare(`
        UPDATE products
        SET stock = stock + ?, updated_at = ?
        WHERE id = ? AND branch = ?
      `).run(quantityDiff, nowIso(), current.productId, current.branch || currentProduct?.branch || null);
    } else {
      db.prepare(`
        UPDATE inventory_movements
        SET note = ?
        WHERE id = ?
      `).run(nextNote, movementId);
    }
  })();

  return getInventoryMovementById(movementId);
}

function listInventoryMovementsForExport(options = {}) {
  const normalizedBranch = normalizeBranch(options.branch || ALL_BRANCHES, {
    allowAll: true,
    fallback: ALL_BRANCHES,
  });
  const clauses = [];
  const params = [];
  if (normalizedBranch !== ALL_BRANCHES) {
    clauses.push("im.branch = ?");
    params.push(normalizedBranch);
  }
  if (options.startAt) {
    clauses.push("im.created_at >= ?");
    params.push(String(options.startAt));
  }
  if (options.endAt) {
    clauses.push("im.created_at < ?");
    params.push(String(options.endAt));
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return db.prepare(`
    SELECT
      im.id,
      im.product_id,
      p.name AS product_name,
      im.movement_type,
      im.branch,
      im.quantity_delta,
      im.stock_before,
      im.stock_after,
      im.note,
      im.reference_type,
      im.reference_id,
      im.created_at
    FROM inventory_movements im
    JOIN products p ON p.id = im.product_id
    ${whereSql}
    ORDER BY im.created_at DESC, im.id DESC
  `).all(...params);
}

module.exports = {
  applyQuickInventoryEntry,
  findQuickImportProduct,
  getInventoryMovementById,
  getQuickImportRows,
  getQuickImportProductId,
  getRecentInventoryMovements,
  listInventoryMovementsForExport,
  updateInventoryMovementAdmin,
};
