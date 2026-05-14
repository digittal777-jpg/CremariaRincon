const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  createHttpError,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

function normalizeRequestMode(mode) {
  const normalizedMode = normalizeText(mode || "receive", 24).toLowerCase();
  if (!["receive", "return"].includes(normalizedMode)) {
    throw createHttpError("El modo de la solicitud debe ser entrada o salida.");
  }
  return normalizedMode;
}

function normalizeRequestStatus(status, allowAll = false) {
  const normalizedStatus = normalizeText(status || "", 24).toLowerCase();
  if (allowAll && (!normalizedStatus || normalizedStatus === ALL_BRANCHES)) {
    return ALL_BRANCHES;
  }
  if (["pending", "approved", "rejected"].includes(normalizedStatus)) {
    return normalizedStatus;
  }
  return "pending";
}

function mapMerchandiseRequestItem(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: roundStock(row.quantity),
    unitPrice: roundMoney(row.unit_price),
    totalValue: roundMoney(row.total_value),
    mode: row.mode,
  };
}

function buildMerchandiseItemsSummary(items) {
  return items
    .map((item) => `${item.mode === "receive" ? "+" : "-"} ${item.productName} x${roundStock(item.quantity)}`)
    .join(" · ");
}

function hydrateMerchandiseRequest(row, items = null) {
  const resolvedItems = Array.isArray(items) ? items : listMerchandiseRequestItems(row.id);
  return {
    id: row.id,
    status: row.status,
    requestedBy: row.requested_by,
    branch: row.branch,
    supplierName: row.supplier_name || "",
    totalValue: roundMoney(row.total_value),
    notes: row.notes || "",
    rejectionReason: row.rejection_reason || "",
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    appliedAt: row.applied_at || null,
    itemCount: resolvedItems.length,
    itemsSummary: buildMerchandiseItemsSummary(resolvedItems),
    items: resolvedItems,
  };
}

function listMerchandiseRequestItems(requestId) {
  return db.prepare(`
    SELECT
      id,
      request_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      total_value,
      mode
    FROM merchandise_request_items
    WHERE request_id = ?
    ORDER BY id ASC
  `).all(requestId).map(mapMerchandiseRequestItem);
}

function getMerchandiseRequestById(requestId) {
  const row = db.prepare(`
    SELECT
      id,
      status,
      requested_by,
      branch,
      supplier_name,
      total_value,
      notes,
      rejection_reason,
      created_at,
      approved_at,
      applied_at
    FROM merchandise_requests
    WHERE id = ?
  `).get(requestId);

  return row ? hydrateMerchandiseRequest(row) : null;
}

function prepareMerchandiseRequestItems(incomingItems, branch) {
  if (!Array.isArray(incomingItems) || incomingItems.length === 0) {
    throw createHttpError("Agrega al menos un producto a la solicitud.");
  }

  const runningStockByProductId = new Map();

  return incomingItems.map((item) => {
    const productId = Number(item.productId);
    const mode = normalizeRequestMode(item.mode);
    const quantity = roundStock(item.quantity);

    if (!Number.isInteger(productId) || productId <= 0) {
      throw createHttpError("Uno de los productos de la solicitud no es valido.");
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw createHttpError("Cada producto debe tener una cantidad mayor a cero.");
    }

    const product = db.prepare(`
      SELECT id, name, price, stock, active, branch
      FROM products
      WHERE id = ? AND branch = ?
    `).get(productId, branch);

    if (!product || !product.active) {
      throw createHttpError("Uno de los productos de la solicitud ya no esta disponible.");
    }

    const unitPrice = roundMoney(product.price);
    const stockBefore = runningStockByProductId.has(productId)
      ? roundStock(runningStockByProductId.get(productId))
      : roundStock(product.stock);
    const quantityDelta = mode === "receive" ? quantity : roundStock(-quantity);
    const stockAfter = roundStock(stockBefore + quantityDelta);

    if (mode === "return" && stockAfter < 0) {
      throw createHttpError(`No hay stock suficiente para retirar ${product.name}.`);
    }

    runningStockByProductId.set(productId, stockAfter);

    return {
      productId,
      productName: product.name,
      quantity,
      unitPrice,
      totalValue: roundMoney(unitPrice * quantity * (mode === "receive" ? 1 : -1)),
      mode,
    };
  });
}

function createMerchandiseRequest(payload) {
  const requestedBy = normalizeText(payload.requestedBy || payload.cashier || "", 60);
  const branch = normalizeBranch(payload.branch);
  const supplierName = normalizeText(payload.supplierName || "", 80) || null;
  const notes = normalizeText(payload.notes || "", 240) || null;

  if (!requestedBy) {
    throw createHttpError("Necesito el nombre del cajero que solicita la mercaderia.");
  }

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida para la solicitud.");
  }

  const preparedItems = prepareMerchandiseRequestItems(payload.items, branch);
  const totalValue = roundMoney(
    preparedItems.reduce((sum, item) => sum + roundMoney(item.totalValue), 0),
  );
  const createdAt = nowIso();

  const requestId = db.transaction(() => {
    const insertRequest = db.prepare(`
      INSERT INTO merchandise_requests (
        status,
        requested_by,
        branch,
        supplier_name,
        total_value,
        notes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "pending",
      requestedBy,
      branch,
      supplierName,
      totalValue,
      notes,
      createdAt,
    );

    const nextRequestId = Number(insertRequest.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO merchandise_request_items (
        request_id,
        product_id,
        product_name,
        quantity,
        unit_price,
        total_value,
        mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    preparedItems.forEach((item) => {
      insertItem.run(
        nextRequestId,
        item.productId,
        item.productName,
        item.quantity,
        item.unitPrice,
        item.totalValue,
        item.mode,
      );
    });

    return nextRequestId;
  })();

  return getMerchandiseRequestById(requestId);
}

function listMyMerchandiseRequests(options = {}) {
  const requestedBy = normalizeText(options.requestedBy || options.cashier || "", 60);
  const branch = normalizeBranch(options.branch);
  const status = normalizeRequestStatus(options.status, true);
  const limit = Math.max(1, Math.min(Number(options.limit || 12), 40));

  if (!requestedBy) {
    throw createHttpError("Necesito el nombre del cajero para consultar sus solicitudes.");
  }

  const query = status === ALL_BRANCHES
    ? `
      SELECT
        id,
        status,
        requested_by,
        branch,
        supplier_name,
        total_value,
        notes,
        rejection_reason,
        created_at,
        approved_at,
        applied_at
      FROM merchandise_requests
      WHERE requested_by = ? AND branch = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `
    : `
      SELECT
        id,
        status,
        requested_by,
        branch,
        supplier_name,
        total_value,
        notes,
        rejection_reason,
        created_at,
        approved_at,
        applied_at
      FROM merchandise_requests
      WHERE requested_by = ? AND branch = ? AND status = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;

  const rows = status === ALL_BRANCHES
    ? db.prepare(query).all(requestedBy, branch, limit)
    : db.prepare(query).all(requestedBy, branch, status, limit);

  return rows.map((row) => hydrateMerchandiseRequest(row));
}

function listPendingMerchandiseRequests(branch = ALL_BRANCHES, limit = 60) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const normalizedLimit = Math.max(1, Math.min(Number(limit || 60), 200));
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        status,
        requested_by,
        branch,
        supplier_name,
        total_value,
        notes,
        rejection_reason,
        created_at,
        approved_at,
        applied_at
      FROM merchandise_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(normalizedLimit)
    : db.prepare(`
      SELECT
        id,
        status,
        requested_by,
        branch,
        supplier_name,
        total_value,
        notes,
        rejection_reason,
        created_at,
        approved_at,
        applied_at
      FROM merchandise_requests
      WHERE status = 'pending' AND branch = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(normalizedBranch, normalizedLimit);

  return rows.map((row) => hydrateMerchandiseRequest(row));
}

function approveMerchandiseRequest(requestId) {
  const currentRequest = getMerchandiseRequestById(requestId);
  if (!currentRequest) {
    throw createHttpError("No encontre la solicitud de mercaderia.", 404);
  }

  if (currentRequest.status !== "pending") {
    throw createHttpError("Solo se pueden aprobar solicitudes pendientes.", 409);
  }

  const approvedAt = nowIso();

  db.transaction(() => {
    const updateProduct = db.prepare(`
      UPDATE products
      SET stock = ?, stock_initialized = 1, updated_at = ?
      WHERE id = ? AND branch = ?
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
    const runningStockByProductId = new Map();

    currentRequest.items.forEach((item) => {
      const product = db.prepare(`
        SELECT id, name, stock, active
        FROM products
        WHERE id = ? AND branch = ?
      `).get(item.productId, currentRequest.branch);

      if (!product || !product.active) {
        throw createHttpError(`El producto ${item.productName} ya no esta disponible para aplicar la solicitud.`);
      }

      const stockBefore = runningStockByProductId.has(item.productId)
        ? roundStock(runningStockByProductId.get(item.productId))
        : roundStock(product.stock);
      const quantityDelta = item.mode === "receive" ? item.quantity : roundStock(-item.quantity);
      const stockAfter = roundStock(stockBefore + quantityDelta);

      if (stockAfter < 0) {
        throw createHttpError(`No hay stock suficiente para aprobar la salida de ${item.productName}.`);
      }

      runningStockByProductId.set(item.productId, stockAfter);
      updateProduct.run(stockAfter, approvedAt, item.productId, currentRequest.branch);

      const supplierLabel = currentRequest.supplierName
        ? ` con ${currentRequest.supplierName}`
        : "";
      insertMovement.run(
        item.productId,
        item.mode === "receive" ? "supplier" : "supplier_out",
        currentRequest.branch,
        quantityDelta,
        stockBefore,
        stockAfter,
        `Solicitud de mercaderia #${currentRequest.id}${supplierLabel}`,
        "merchandise_request",
        currentRequest.id,
        approvedAt,
      );
    });

    db.prepare(`
      UPDATE merchandise_requests
      SET status = 'approved', rejection_reason = NULL, approved_at = ?, applied_at = ?
      WHERE id = ?
    `).run(approvedAt, approvedAt, requestId);
  })();

  return getMerchandiseRequestById(requestId);
}

function rejectMerchandiseRequest(requestId, rejectionReason) {
  const currentRequest = getMerchandiseRequestById(requestId);
  if (!currentRequest) {
    throw createHttpError("No encontre la solicitud de mercaderia.", 404);
  }

  if (currentRequest.status !== "pending") {
    throw createHttpError("Solo se pueden rechazar solicitudes pendientes.", 409);
  }

  const normalizedReason = normalizeText(rejectionReason || "", 180);
  if (!normalizedReason) {
    throw createHttpError("Escribe una razon para rechazar la solicitud.");
  }

  db.prepare(`
    UPDATE merchandise_requests
    SET status = 'rejected', rejection_reason = ?, approved_at = NULL, applied_at = NULL
    WHERE id = ?
  `).run(normalizedReason, requestId);

  return getMerchandiseRequestById(requestId);
}

module.exports = {
  approveMerchandiseRequest,
  createMerchandiseRequest,
  getMerchandiseRequestById,
  listMyMerchandiseRequests,
  listPendingMerchandiseRequests,
  rejectMerchandiseRequest,
};
