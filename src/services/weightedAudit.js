const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  assertBranchIsActive,
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

function buildAutoWeightedAuditNote({ shift, cashier, eventId } = {}) {
  const safeShift = normalizeText(shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const safeCashier = normalizeText(cashier || "", 60);
  const safeEventId = Number(eventId);
  const fragments = [`Generada automaticamente desde corte final ${safeShift}`];

  if (safeCashier) {
    fragments.push(`por ${safeCashier}`);
  }
  if (Number.isInteger(safeEventId) && safeEventId > 0) {
    fragments.push(`evento ${safeEventId}`);
  }

  return normalizeText(fragments.join(" · "), 240) || null;
}

function insertWeightedAuditItems(sessionId, items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

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

  items.forEach((item) => {
    const productId = Number(item.productId ?? item.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return;
    }

    insertItem.run(
      sessionId,
      productId,
      item.productName || item.name || `Producto ${productId}`,
      item.unit || "kg",
      roundStock(item.posStock ?? item.stock ?? 0),
      roundMoney(item.unitPrice ?? item.price ?? 0),
      now,
      now,
    );
  });
}

function listWeightedProductsSoldForCashier(options = {}) {
  const branch = normalizeBranch(options.branch);
  const shift = normalizeText(options.shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const cashier = normalizeText(options.cashier || "", 60);
  const dateKey = normalizeAuditDateKey(options.dateKey);
  const cutoffCreatedAt = normalizeText(options.cutoffCreatedAt || "", 40) || null;

  if (!cashier) {
    return [];
  }

  const rows = db.prepare(`
    SELECT
      s.created_at,
      si.product_id,
      si.product_name,
      si.quantity,
      p.unit,
      p.stock,
      p.price
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN products p ON p.id = si.product_id
    WHERE s.branch = ? AND s.shift = ? AND s.cashier = ? AND p.unit = 'kg'
    ORDER BY s.created_at DESC, si.id DESC
  `).all(branch, shift, cashier);

  const productsById = new Map();
  rows.forEach((row) => {
    if (getStoreDateKey(row.created_at) !== dateKey) {
      return;
    }
    if (cutoffCreatedAt && String(row.created_at) > cutoffCreatedAt) {
      return;
    }

    const productId = Number(row.product_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return;
    }

    if (!productsById.has(productId)) {
      productsById.set(productId, {
        productId,
        productName: row.product_name || `Producto ${productId}`,
        unit: row.unit || "kg",
        posStock: roundStock(row.stock || 0),
        unitPrice: roundMoney(row.price || 0),
        soldQuantity: 0,
      });
    }

    const entry = productsById.get(productId);
    entry.soldQuantity = roundStock(entry.soldQuantity + roundStock(row.quantity || 0));
  });

  return [...productsById.values()].sort(
    (left, right) => String(left.productName || "").localeCompare(String(right.productName || ""), "es", {
      sensitivity: "base",
    }),
  );
}

function getWeightedAuditSessionBySourceRegisterEventId(eventId) {
  const safeEventId = Number(eventId);
  if (!Number.isInteger(safeEventId) || safeEventId <= 0) {
    return null;
  }

  const row = db.prepare(`
    SELECT id
    FROM weighted_audit_sessions
    WHERE source_register_event_id = ?
    LIMIT 1
  `).get(safeEventId);

  return row ? getWeightedAuditSessionById(Number(row.id)) : null;
}

function ensureWeightedAuditSessionInternal(payload = {}) {
  const branch = normalizeBranch(payload.branch);
  const shift = normalizeText(payload.shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const auditedDateKey = normalizeAuditDateKey(payload.dateKey);
  const createdBy = normalizeText(payload.createdBy || "admin", 60) || "admin";
  const notes = normalizeText(payload.notes || "", 240) || null;
  const sourceRegisterEventId = Number(payload.sourceRegisterEventId);
  const sourceCashier = normalizeText(payload.sourceCashier || payload.cashier || "", 60) || null;
  const seedItems = Array.isArray(payload.seedItems) ? payload.seedItems : null;

  assertBranchIsActive(branch, "Selecciona una sucursal activa para la auditoria.");
  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para la auditoria.");
  }

  let created = false;
  const sessionId = db.transaction(() => {
    const existing = Number.isInteger(sourceRegisterEventId) && sourceRegisterEventId > 0
      ? db.prepare(`
        SELECT id
        FROM weighted_audit_sessions
        WHERE source_register_event_id = ?
      `).get(sourceRegisterEventId)
      : db.prepare(`
        SELECT id
        FROM weighted_audit_sessions
        WHERE source_register_event_id IS NULL AND branch = ? AND shift = ? AND audited_date_key = ?
      `).get(branch, shift, auditedDateKey);

    if (existing) {
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
        source_register_event_id,
        source_cashier,
        template_locked,
        created_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 1, ?)
    `).run(
      branch,
      shift,
      auditedDateKey,
      createdBy,
      notes,
      Number.isInteger(sourceRegisterEventId) && sourceRegisterEventId > 0 ? sourceRegisterEventId : null,
      sourceCashier,
      now,
    );

    created = true;
    const nextId = Number(insert.lastInsertRowid);
    if (seedItems) {
      insertWeightedAuditItems(nextId, seedItems);
    } else {
      ensureWeightedAuditTemplate(nextId, branch);
    }
    return nextId;
  })();

  return {
    created,
    session: getWeightedAuditSessionById(sessionId),
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
      source_register_event_id,
      source_cashier,
      template_locked,
      created_at,
      completed_at,
      (
        SELECT created_at
        FROM register_events re
        WHERE re.id = weighted_audit_sessions.source_register_event_id
        LIMIT 1
      ) AS source_register_event_created_at
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
    ORDER BY
      CASE
        WHEN counted_stock IS NULL THEN 0
        WHEN ABS(COALESCE(difference, 0)) > 0 THEN 1
        ELSE 2
      END,
      ABS(COALESCE(difference, 0)) DESC,
      product_name COLLATE NOCASE
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
    sourceRegisterEventId: sessionRow.source_register_event_id || null,
    sourceCashier: sessionRow.source_cashier || "",
    sourceRegisterEventCreatedAt: sessionRow.source_register_event_created_at || null,
    templateLocked: Boolean(sessionRow.template_locked),
    createdAt: sessionRow.created_at,
    completedAt: sessionRow.completed_at || null,
    summary: buildSessionSummary(items),
    items,
  };
}

function ensureWeightedAuditTemplate(sessionId, branch) {
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

  insertWeightedAuditItems(sessionId, products.map((product) => ({
    productId: product.id,
    productName: product.name,
    unit: product.unit || "kg",
    posStock: roundStock(product.stock),
    unitPrice: roundMoney(product.price),
  })));
}

function createWeightedAuditSession(payload = {}) {
  return ensureWeightedAuditSessionInternal(payload).session;
}

function ensureWeightedAuditSessionForFinalCutLegacy(payload = {}) {
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";

  return ensureWeightedAuditSessionInternal({
    branch: payload.branch,
    shift: payload.shift,
    dateKey: payload.dateKey,
    createdBy: payload.createdBy || `corte final · ${cashier}`,
    notes: payload.notes || buildAutoWeightedAuditNote({
      shift: payload.shift,
      cashier,
      eventId: payload.eventId,
    }),
  });
}

function ensureWeightedAuditSessionForFinalCut(payload = {}) {
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const eventId = Number(payload.eventId);
  const existingSession = Number.isInteger(eventId) && eventId > 0
    ? getWeightedAuditSessionBySourceRegisterEventId(eventId)
    : null;
  if (existingSession) {
    return {
      created: false,
      session: existingSession,
    };
  }

  const sourceEventCreatedAt = Number.isInteger(eventId) && eventId > 0
    ? db.prepare(`
      SELECT created_at
      FROM register_events
      WHERE id = ? AND event_type = 'final_cut'
      LIMIT 1
    `).get(eventId)?.created_at || null
    : null;
  const seedItems = listWeightedProductsSoldForCashier({
    branch: payload.branch,
    shift: payload.shift,
    cashier,
    dateKey: payload.dateKey,
    cutoffCreatedAt: sourceEventCreatedAt,
  });

  if (seedItems.length === 0) {
    return {
      created: false,
      session: null,
    };
  }

  return ensureWeightedAuditSessionInternal({
    branch: payload.branch,
    shift: payload.shift,
    dateKey: payload.dateKey,
    sourceRegisterEventId: Number.isInteger(eventId) && eventId > 0 ? eventId : null,
    sourceCashier: cashier,
    seedItems,
    createdBy: payload.createdBy || `corte final - ${cashier}`,
    notes: payload.notes || buildAutoWeightedAuditNote({
      shift: payload.shift,
      cashier,
      eventId,
    }),
  });
}

function syncWeightedAuditSessionFromRegisterEvent(eventId) {
  const safeEventId = Number(eventId);
  if (!Number.isInteger(safeEventId) || safeEventId <= 0) {
    return null;
  }

  const session = getWeightedAuditSessionBySourceRegisterEventId(safeEventId);
  if (!session) {
    return null;
  }

  const event = db.prepare(`
    SELECT id, branch, shift, cashier, created_at
    FROM register_events
    WHERE id = ? AND event_type = 'final_cut'
    LIMIT 1
  `).get(safeEventId);
  if (!event) {
    return session;
  }

  db.prepare(`
    UPDATE weighted_audit_sessions
    SET branch = ?, shift = ?, audited_date_key = ?, source_cashier = ?
    WHERE id = ?
  `).run(
    normalizeBranch(event.branch),
    normalizeText(event.shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0],
    getStoreDateKey(new Date(event.created_at)),
    normalizeText(event.cashier || "", 60) || null,
    session.id,
  );

  return getWeightedAuditSessionById(session.id);
}

function buildCashierBlindAuditPrompt(sessionId, options = {}) {
  const session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    return null;
  }

  const cashier = normalizeText(options.cashier || "", 60);
  if (!cashier) {
    throw createHttpError("No se pudo identificar al cajero para el pesado ciego.");
  }
  if (session.sourceCashier && session.sourceCashier !== cashier) {
    return null;
  }

  const soldRows = session.sourceRegisterEventId
    ? db.prepare(`
      SELECT
        s.created_at,
        si.product_id,
        si.quantity,
        i.id AS item_id,
        i.product_name,
        i.unit,
        i.counted_stock,
        i.difference
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      JOIN weighted_audit_items i
        ON i.session_id = ? AND i.product_id = si.product_id
      WHERE s.branch = ? AND s.cashier = ?
      ORDER BY s.created_at DESC, si.id DESC
    `).all(session.id, session.branch, cashier)
    : db.prepare(`
      SELECT
        s.created_at,
        si.product_id,
        si.quantity,
        i.id AS item_id,
        i.product_name,
        i.unit,
        i.counted_stock,
        i.difference
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      JOIN weighted_audit_items i
        ON i.session_id = ? AND i.product_id = si.product_id
      WHERE s.branch = ? AND s.shift = ? AND s.cashier = ?
      ORDER BY s.created_at DESC, si.id DESC
    `).all(session.id, session.branch, session.shift, cashier);

  const itemsById = new Map(
    (session.sourceRegisterEventId ? session.items : []).map((item) => [
      item.id,
      {
        itemId: item.id,
        productId: Number(item.productId),
        productName: item.productName,
        unit: item.unit || "kg",
        soldQuantity: 0,
        countedStock: item.countedStock == null ? null : roundStock(item.countedStock),
        ...(item.difference == null ? {} : { difference: roundStock(item.difference) }),
      },
    ]),
  );
  soldRows.forEach((row) => {
    if (getStoreDateKey(row.created_at) !== session.auditedDateKey) {
      return;
    }
    if (
      session.sourceRegisterEventCreatedAt
      && String(row.created_at) > String(session.sourceRegisterEventCreatedAt)
    ) {
      return;
    }

    const itemId = Number(row.item_id);
    if (!itemsById.has(itemId)) {
      itemsById.set(itemId, {
        itemId,
        productId: Number(row.product_id),
        productName: row.product_name,
        unit: row.unit || "kg",
        soldQuantity: 0,
        countedStock: row.counted_stock == null ? null : roundStock(row.counted_stock),
        ...(row.difference == null ? {} : { difference: roundStock(row.difference) }),
      });
    }

    const entry = itemsById.get(itemId);
    entry.soldQuantity = roundStock(entry.soldQuantity + roundStock(row.quantity || 0));
  });

  const items = [...itemsById.values()]
    .sort((left, right) => left.productName.localeCompare(right.productName, "es", { sensitivity: "base" }));

  return {
    sessionId: session.id,
    branch: session.branch,
    shift: session.shift,
    auditedDateKey: session.auditedDateKey,
    cashier,
    requiredCount: items.length,
    capturedCount: items.filter((item) => item.countedStock != null).length,
    completed: items.length > 0 && items.every((item) => item.countedStock != null),
    items,
  };
}

function previewCashierBlindWeightedAuditItems(sessionId, payload = {}, options = {}) {
  const prompt = buildCashierBlindAuditPrompt(sessionId, {
    cashier: options.cashier || payload.cashier || "",
  });
  if (!prompt) {
    throw createHttpError("No encontre la captura ciega para este corte.", 404);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const submittedItems = new Map();
  items.forEach((entry) => {
    const itemId = Number(entry.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return;
    }
    submittedItems.set(itemId, entry.countedStock);
  });

  const rows = db.prepare(`
    SELECT id, pos_stock, counted_stock, difference
    FROM weighted_audit_items
    WHERE session_id = ?
  `).all(sessionId);
  const rowsById = new Map(rows.map((row) => [Number(row.id), row]));

  const previews = prompt.items.map((item) => {
    const row = rowsById.get(Number(item.itemId));
    if (!row) {
      return {
        itemId: item.itemId,
        difference: null,
        status: "missing",
      };
    }

    const rawValue = submittedItems.has(item.itemId)
      ? submittedItems.get(item.itemId)
      : row.counted_stock;
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
      return {
        itemId: item.itemId,
        difference: null,
        status: "pending",
      };
    }

    const countedStock = roundStock(rawValue);
    if (!Number.isFinite(countedStock) || countedStock < 0) {
      return {
        itemId: item.itemId,
        difference: null,
        status: "invalid",
      };
    }

    const difference = roundStock(countedStock - roundStock(row.pos_stock));
    return {
      itemId: item.itemId,
      difference,
      status: difference === 0 ? "match" : difference < 0 ? "shortage" : "surplus",
    };
  });

  return {
    sessionId: prompt.sessionId,
    previews,
  };
}

function findCashierBlindAuditPrompt(options = {}) {
  const branch = normalizeBranch(options.branch);
  const shift = normalizeText(options.shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const cashier = normalizeText(options.cashier || "", 60);
  const dateKey = normalizeAuditDateKey(options.dateKey || getStoreDateKey(new Date()));

  if (!cashier) {
    return null;
  }

  const finalCutRows = db.prepare(`
    SELECT id, created_at
    FROM register_events
    WHERE shift = ? AND branch = ? AND cashier = ? AND event_type = 'final_cut'
    ORDER BY created_at DESC, id DESC
  `).all(shift, branch, cashier);
  const cashierFinalCut = finalCutRows.find((row) => getStoreDateKey(row.created_at) === dateKey) || null;

  if (cashierFinalCut) {
    const sourceSession = getWeightedAuditSessionBySourceRegisterEventId(Number(cashierFinalCut.id));
    if (sourceSession?.status === "pending") {
      const prompt = buildCashierBlindAuditPrompt(sourceSession.id, { cashier });
      if (prompt && prompt.items.length > 0 && !prompt.completed) {
        return prompt;
      }
    }
  }

  const sessionRow = db.prepare(`
    SELECT id
    FROM weighted_audit_sessions
    WHERE
      branch = ?
      AND shift = ?
      AND audited_date_key = ?
      AND status = 'pending'
      AND source_register_event_id IS NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(branch, shift, dateKey);
  if (!sessionRow) {
    return null;
  }

  const prompt = buildCashierBlindAuditPrompt(Number(sessionRow.id), { cashier });
  if (!prompt || prompt.items.length === 0 || prompt.completed) {
    return null;
  }

  return prompt;
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
      s.source_register_event_id,
      s.source_cashier,
      s.template_locked,
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
    sourceRegisterEventId: row.source_register_event_id || null,
    sourceCashier: row.source_cashier || "",
    templateLocked: Boolean(row.template_locked),
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

function persistWeightedAuditSessionChanges(sessionId, session, payload = {}, options = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const nextNotes = payload.notes === undefined
    ? session.notes || null
    : normalizeText(payload.notes || "", 240) || null;
  if (options.requireChanges !== false && items.length === 0 && payload.notes === undefined) {
    throw createHttpError("No enviaste renglones de auditoria para guardar.");
  }

  db.transaction(() => {
    if (payload.notes !== undefined) {
      db.prepare(`
        UPDATE weighted_audit_sessions
        SET notes = ?
        WHERE id = ?
      `).run(nextNotes, sessionId);
    }

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

function updateWeightedAuditItems(sessionId, payload = {}) {
  const session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    throw createHttpError("No encontre la sesion de auditoria.", 404);
  }
  if (session.status === "completed") {
    throw createHttpError("La auditoria ya esta cerrada y no acepta cambios.");
  }

  return persistWeightedAuditSessionChanges(sessionId, session, payload);
}

function updateCashierBlindWeightedAuditItems(sessionId, payload = {}, options = {}) {
  const prompt = buildCashierBlindAuditPrompt(sessionId, {
    cashier: options.cashier || payload.cashier || "",
  });
  if (!prompt) {
    throw createHttpError("No encontre la captura ciega para este corte.", 404);
  }

  const session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    throw createHttpError("No encontre la sesion de auditoria.", 404);
  }
  if (session.status === "completed") {
    throw createHttpError("La auditoria ya esta cerrada y no acepta mas capturas.");
  }
  if (prompt.items.length === 0) {
    return {
      prompt,
      session,
    };
  }

  const entries = Array.isArray(payload.items) ? payload.items : [];
  if (entries.length === 0) {
    throw createHttpError("Captura los kilos de bascula antes de cerrar el corte.");
  }

  const allowedItems = new Map(prompt.items.map((item) => [item.itemId, item]));
  const submittedItems = new Map();

  entries.forEach((entry) => {
    const itemId = Number(entry.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0 || !allowedItems.has(itemId)) {
      throw createHttpError("Uno de los productos enviados no pertenece al pesado ciego.");
    }

    const countedStock = roundStock(entry.countedStock);
    if (!Number.isFinite(countedStock) || countedStock < 0) {
      throw createHttpError(`El pesado capturado para ${allowedItems.get(itemId).productName} no es valido.`);
    }

    submittedItems.set(itemId, countedStock);
  });

  const missingItems = prompt.items.filter(
    (item) => item.countedStock == null && !submittedItems.has(item.itemId),
  );
  if (missingItems.length > 0) {
    throw createHttpError(`Completa el pesado de ${missingItems[0].productName} antes de continuar.`);
  }

  db.transaction(() => {
    submittedItems.forEach((countedStock, itemId) => {
      const existing = db.prepare(`
        SELECT id, product_name, pos_stock
        FROM weighted_audit_items
        WHERE id = ? AND session_id = ?
      `).get(itemId, sessionId);

      if (!existing) {
        throw createHttpError("Uno de los renglones de pesado ya no existe.");
      }

      const difference = roundStock(countedStock - roundStock(existing.pos_stock));
      const direction = difference < 0 ? "shortage" : difference > 0 ? "surplus" : "match";

      db.prepare(`
        UPDATE weighted_audit_items
        SET counted_stock = ?, difference = ?, direction = ?, updated_at = ?
        WHERE id = ? AND session_id = ?
      `).run(
        countedStock,
        difference,
        direction,
        nowIso(),
        itemId,
        sessionId,
      );
    });
  })();

  return {
    prompt: buildCashierBlindAuditPrompt(sessionId, { cashier: prompt.cashier }),
    session: getWeightedAuditSessionById(sessionId),
  };
}

function completeWeightedAuditSession(sessionId, payload = {}) {
  let session = getWeightedAuditSessionById(sessionId);
  if (!session) {
    throw createHttpError("No encontre la sesion de auditoria.", 404);
  }
  if (session.status === "completed") {
    return session;
  }

  if (Array.isArray(payload.items) || payload.notes !== undefined) {
    session = persistWeightedAuditSessionChanges(sessionId, session, payload, {
      requireChanges: false,
    });
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
  const notes = payload.notes === undefined
    ? normalizeText(session.notes || "", 240) || null
    : normalizeText(payload.notes || "", 240) || null;
  const completedAt = nowIso();

  db.prepare(`
    UPDATE weighted_audit_sessions
    SET status = 'completed', completed_by = ?, completed_at = ?, notes = ?
    WHERE id = ?
  `).run(completedBy, completedAt, notes, sessionId);

  return getWeightedAuditSessionById(sessionId);
}

function listWeightedAuditRowsForExport(options = {}) {
  const branch = normalizeBranch(options.branch || ALL_BRANCHES, {
    allowAll: true,
    fallback: ALL_BRANCHES,
  });
  const clauses = [];
  const params = [];
  if (branch !== ALL_BRANCHES) {
    clauses.push("s.branch = ?");
    params.push(branch);
  }
  if (options.startDateKey) {
    clauses.push("s.audited_date_key >= ?");
    params.push(String(options.startDateKey));
  }
  if (options.endDateKey) {
    clauses.push("s.audited_date_key <= ?");
    params.push(String(options.endDateKey));
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

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
      s.source_register_event_id,
      s.source_cashier,
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
    ${whereSql}
    ORDER BY s.audited_date_key DESC, s.id DESC, ABS(COALESCE(i.difference, 0)) DESC, i.product_name COLLATE NOCASE
  `).all(...params);
}

module.exports = {
  buildCashierBlindAuditPrompt,
  completeWeightedAuditSession,
  createWeightedAuditSession,
  ensureWeightedAuditSessionForFinalCut,
  findCashierBlindAuditPrompt,
  getWeightedAuditSessionById,
  getWeightedAuditSessionBySourceRegisterEventId,
  listWeightedAuditRowsForExport,
  listWeightedAuditSessions,
  previewCashierBlindWeightedAuditItems,
  syncWeightedAuditSessionFromRegisterEvent,
  updateCashierBlindWeightedAuditItems,
  updateWeightedAuditItems,
};
