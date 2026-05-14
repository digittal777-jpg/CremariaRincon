const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  createHttpError,
  getStoreDateKey,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

function normalizeAuditDateKey(dateKey) {
  if (!dateKey) {
    return getStoreDateKey(new Date());
  }

  const parsed = String(dateKey).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw createHttpError("La fecha de auditoria debe tener formato YYYY-MM-DD.");
  }

  return parsed;
}

function mapWeightedAuditItem(row) {
  const countedStock = row.counted_stock == null ? null : roundStock(row.counted_stock);
  const difference = row.difference == null ? null : roundStock(row.difference);
  return {
    id: row.id,
    sessionId: row.session_id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit || "kg",
    posStock: roundStock(row.pos_stock),
    countedStock,
    difference,
    direction: row.direction || "pending",
    reason: row.reason || "",
    unitPrice: roundMoney(row.unit_price || 0),
    incident: difference != null && difference !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSessionSummary(items) {
  const totalItems = items.length;
  const countedItems = items.filter((item) => item.countedStock != null).length;
  const incidentItems = items.filter((item) => item.incident).length;
  const shortageKg = roundStock(
    items
      .filter((item) => Number(item.difference) < 0)
      .reduce((sum, item) => sum + Math.abs(roundStock(item.difference)), 0),
  );
  const surplusKg = roundStock(
    items
      .filter((item) => Number(item.difference) > 0)
      .reduce((sum, item) => sum + roundStock(item.difference), 0),
  );
  const varianceValue = roundMoney(
    items.reduce(
      (sum, item) => sum + roundMoney((item.difference || 0) * roundMoney(item.unitPrice || 0)),
      0,
    ),
  );

  return {
    totalItems,
    countedItems,
    pendingItems: Math.max(0, totalItems - countedItems),
    incidentItems,
    shortageKg,
    surplusKg,
    varianceValue,
  };
}

function getWeightedAuditSessionById(sessionId) {
  const sessionRow = db.prepare(`
    SELECT
      id,
      branch,
      shift,
      audited_date_key,
      status,
      created_by,
      completed_by,
      notes,
      created_at,
      completed_at
    FROM weighted_audit_sessions
    WHERE id = ?
  `).get(sessionId);

  if (!sessionRow) {
    return null;
  }

  const items = db.prepare(`
    SELECT
      id,
      session_id,
      product_id,
      product_name,
      unit,
      pos_stock,
      counted_stock,
      difference,
      direction,
      reason,
      unit_price,
      created_at,
      updated_at
    FROM weighted_audit_items
    WHERE session_id = ?
    ORDER BY ABS(COALESCE(difference, 0)) DESC, product_name COLLATE NOCASE
  `).all(sessionId).map(mapWeightedAuditItem);

  return {
    id: sessionRow.id,
    branch: sessionRow.branch,
    shift: sessionRow.shift,
    auditedDateKey: sessionRow.audited_date_key,
    status: sessionRow.status,
    createdBy: sessionRow.created_by || "",
    completedBy: sessionRow.completed_by || "",
    notes: sessionRow.notes || "",
    createdAt: sessionRow.created_at,
    completedAt: sessionRow.completed_at || null,
    summary: buildSessionSummary(items),
    items,
  };
}

function ensureWeightedAuditTemplate(sessionId, branch) {
  const now = nowIso();
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO weighted_audit_items (
      session_id,
      product_id,
      product_name,
      unit,
      pos_stock,
      counted_stock,
      difference,
      direction,
      reason,
      unit_price,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending', NULL, ?, ?, ?)
  `);

  const products = db.prepare(`
    SELECT
      id,
      name,
      unit,
      stock,
      price
    FROM products
    WHERE branch = ? AND active = 1 AND unit = 'kg'
    ORDER BY
      CASE category
        WHEN 'quesos' THEN 0
        WHEN 'carnes' THEN 1
        WHEN 'piezas' THEN 2
        ELSE 3
      END,
      display_order,
      name COLLATE NOCASE
  `).all(branch);

  products.forEach((product) => {
    insertItem.run(
      sessionId,
      product.id,
      product.name,
      product.unit || "kg",
      roundStock(product.stock),
      roundMoney(product.price),
      now,
      now,
    );
  });
}

function createWeightedAuditSession(payload = {}) {
  const branch = normalizeBranch(payload.branch);
  const shift = normalizeText(payload.shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const auditedDateKey = normalizeAuditDateKey(payload.dateKey);
  const createdBy = normalizeText(payload.createdBy || "admin", 60) || "admin";
  const notes = normalizeText(payload.notes || "", 240) || null;

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida para la auditoria.");
  }
  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para la auditoria.");
  }

  const sessionId = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id
      FROM weighted_audit_sessions
      WHERE branch = ? AND shift = ? AND audited_date_key = ?
    `).get(branch, shift, auditedDateKey);

    if (existing) {
      ensureWeightedAuditTemplate(existing.id, branch);
      return existing.id;
    }

    const now = nowIso();
    const insert = db.prepare(`
      INSERT INTO weighted_audit_sessions (
        branch,
        shift,
        audited_date_key,
        status,
        created_by,
        notes,
        created_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(branch, shift, auditedDateKey, createdBy, notes, now);

    const nextId = Number(insert.lastInsertRowid);
    ensureWeightedAuditTemplate(nextId, branch);
    return nextId;
  })();

  return getWeightedAuditSessionById(sessionId);
}

function listWeightedAuditSessions(options = {}) {
  const branch = normalizeBranch(options.branch, { allowAll: true });
  const shift = normalizeText(options.shift || "", 24);
  const auditedDateKey = options.dateKey ? normalizeAuditDateKey(options.dateKey) : null;
  const limit = Math.max(1, Math.min(Number(options.limit || 30), 200));

  const clauses = [];
  const params = [];

  if (branch !== ALL_BRANCHES) {
    clauses.push("s.branch = ?");
    params.push(branch);
  }
  if (shift) {
    clauses.push("s.shift = ?");
    params.push(shift);
  }
  if (auditedDateKey) {
    clauses.push("s.audited_date_key = ?");
    params.push(auditedDateKey);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      s.id,
      s.branch,
      s.shift,
      s.audited_date_key,
      s.status,
      s.created_by,
      s.completed_by,
      s.notes,
      s.created_at,
      s.completed_at,
      COUNT(i.id) AS total_items,
      SUM(CASE WHEN i.counted_stock IS NOT NULL THEN 1 ELSE 0 END) AS counted_items,
      SUM(CASE WHEN ABS(COALESCE(i.difference, 0)) > 0 THEN 1 ELSE 0 END) AS incident_items,
      SUM(CASE WHEN i.difference < 0 THEN ABS(i.difference) ELSE 0 END) AS shortage_kg,
      SUM(CASE WHEN i.difference > 0 THEN i.difference ELSE 0 END) AS surplus_kg,
      SUM(COALESCE(i.difference, 0) * COALESCE(i.unit_price, 0)) AS variance_value
    FROM weighted_audit_sessions s
    LEFT JOIN weighted_audit_items i ON i.session_id = s.id
    ${whereSql}
    GROUP BY s.id
    ORDER BY s.audited_date_key DESC, s.created_at DESC, s.id DESC
    LIMIT ?
  `).all(...params, limit);

  return rows.map((row) => ({
    id: row.id,
    branch: row.branch,
    shift: row.shift,
    auditedDateKey: row.audited_date_key,
    status: row.status,
    createdBy: row.created_by || "",
    completedBy: row.completed_by || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    completedAt: row.completed_at || null,
    summary: {
      totalItems: Number(row.total_items || 0),
      countedItems: Number(row.counted_items || 0),
      pendingItems: Math.max(0, Number(row.total_items || 0) - Number(row.counted_items || 0)),
      incidentItems: Number(row.incident_items || 0),
      shortageKg: roundStock(row.shortage_kg || 0),
      surplusKg: roundStock(row.surplus_kg || 0),
      varianceValue: roundMoney(row.variance_value || 0),
    },
  }));
}

function updateWeightedAuditItems(sessionId, payload = {}) {
  const session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    throw createHttpError("No encontre la sesion de auditoria.", 404);
  }
  if (session.status === "completed") {
    throw createHttpError("La auditoria ya esta cerrada y no acepta cambios.");
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw createHttpError("No enviaste renglones de auditoria para guardar.");
  }

  db.transaction(() => {
    items.forEach((entry) => {
      const itemId = Number(entry.itemId);
      const productId = Number(entry.productId);
      const existing = Number.isInteger(itemId) && itemId > 0
        ? db.prepare(`
          SELECT id, product_name, pos_stock
          FROM weighted_audit_items
          WHERE id = ? AND session_id = ?
        `).get(itemId, sessionId)
        : db.prepare(`
          SELECT id, product_name, pos_stock
          FROM weighted_audit_items
          WHERE product_id = ? AND session_id = ?
        `).get(productId, sessionId);

      if (!existing) {
        throw createHttpError("Uno de los renglones de auditoria no existe.");
      }

      const countedStock = roundStock(entry.countedStock);
      if (!Number.isFinite(countedStock) || countedStock < 0) {
        throw createHttpError(`El conteo fisico de ${existing.product_name} no es valido.`);
      }

      const difference = roundStock(countedStock - roundStock(existing.pos_stock));
      const reason = normalizeText(entry.reason || "", 240) || null;
      if (difference !== 0 && !reason) {
        throw createHttpError(`Captura motivo para la diferencia en ${existing.product_name}.`);
      }

      const direction = difference < 0 ? "shortage" : difference > 0 ? "surplus" : "match";
      db.prepare(`
        UPDATE weighted_audit_items
        SET counted_stock = ?, difference = ?, direction = ?, reason = ?, updated_at = ?
        WHERE id = ? AND session_id = ?
      `).run(
        countedStock,
        difference,
        direction,
        reason,
        nowIso(),
        existing.id,
        sessionId,
      );
    });
  })();

  return getWeightedAuditSessionById(sessionId);
}

function completeWeightedAuditSession(sessionId, payload = {}) {
  const session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    throw createHttpError("No encontre la sesion de auditoria.", 404);
  }
  if (session.status === "completed") {
    return session;
  }

  const pendingItems = session.items.filter((item) => item.countedStock == null);
  if (pendingItems.length > 0) {
    throw createHttpError("Completa el conteo de todos los productos kg antes de cerrar la auditoria.");
  }

  const missingReasons = session.items.filter((item) => item.incident && !item.reason);
  if (missingReasons.length > 0) {
    throw createHttpError("Hay diferencias sin motivo en la auditoria.");
  }

  const completedBy = normalizeText(payload.completedBy || "admin", 60) || "admin";
  const notes = normalizeText(payload.notes || session.notes || "", 240) || null;
  const completedAt = nowIso();

  db.prepare(`
    UPDATE weighted_audit_sessions
    SET status = 'completed', completed_by = ?, completed_at = ?, notes = ?
    WHERE id = ?
  `).run(completedBy, completedAt, notes, sessionId);

  return getWeightedAuditSessionById(sessionId);
}

function listWeightedAuditRowsForExport() {
  return db.prepare(`
    SELECT
      s.id AS session_id,
      s.branch,
      s.shift,
      s.audited_date_key,
      s.status,
      s.created_by,
      s.completed_by,
      s.notes AS session_notes,
      s.created_at AS session_created_at,
      s.completed_at,
      i.id AS item_id,
      i.product_id,
      i.product_name,
      i.unit,
      i.pos_stock,
      i.counted_stock,
      i.difference,
      i.direction,
      i.reason,
      i.unit_price,
      i.created_at AS item_created_at,
      i.updated_at AS item_updated_at
    FROM weighted_audit_sessions s
    JOIN weighted_audit_items i ON i.session_id = s.id
    ORDER BY s.audited_date_key DESC, s.id DESC, ABS(COALESCE(i.difference, 0)) DESC, i.product_name COLLATE NOCASE
  `).all();
}

module.exports = {
  completeWeightedAuditSession,
  createWeightedAuditSession,
  getWeightedAuditSessionById,
  listWeightedAuditRowsForExport,
  listWeightedAuditSessions,
  updateWeightedAuditItems,
};

