const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getStoreDateKey,
  normalizeText,
  roundMoney,
  shiftStoreDateKey,
  validateStoreDateKey,
} = require("../utils/helpers");

const db = getDb();

const SERVICE_SUBSCRIPTION_ID = 1;
const SERVICE_STATUS_VALUES = new Set(["trial", "active", "overdue", "suspended", "cancelled"]);

function normalizeOptionalDateKey(value, message) {
  const raw = String(value || "").trim();
  return raw ? validateStoreDateKey(raw, message) : null;
}

function getDateDiffDays(leftDateKey, rightDateKey) {
  if (!leftDateKey || !rightDateKey) {
    return null;
  }

  const left = Date.parse(`${leftDateKey}T12:00:00.000Z`);
  const right = Date.parse(`${rightDateKey}T12:00:00.000Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return Math.round((left - right) / 86_400_000);
}

function mapSubscription(row) {
  const todayDateKey = getStoreDateKey(new Date());
  const currentPeriodEnd = row.current_period_end || null;
  const gracePeriodUntil = row.grace_period_until || null;
  const daysUntilDue = currentPeriodEnd
    ? getDateDiffDays(currentPeriodEnd, todayDateKey)
    : null;
  const daysUntilGraceEnds = gracePeriodUntil
    ? getDateDiffDays(gracePeriodUntil, todayDateKey)
    : null;
  const overdue = Boolean(currentPeriodEnd && todayDateKey > currentPeriodEnd);
  const inGrace = Boolean(overdue && gracePeriodUntil && todayDateKey <= gracePeriodUntil);
  const storedStatus = row.status || "trial";
  const effectiveStatus = ["suspended", "cancelled"].includes(storedStatus)
    ? storedStatus
    : inGrace
      ? "overdue_grace"
      : overdue
        ? "overdue"
        : storedStatus;

  return {
    id: row.id,
    planCode: row.plan_code,
    status: storedStatus,
    effectiveStatus,
    monthlyAmount: roundMoney(row.monthly_amount || 0),
    currencyCode: row.currency_code || "MXN",
    currentPeriodStart: row.current_period_start || null,
    currentPeriodEnd,
    gracePeriodUntil,
    lastPaymentAt: row.last_payment_at || null,
    notes: row.notes || "",
    todayDateKey,
    daysUntilDue,
    daysUntilGraceEnds,
    overdue,
    inGrace,
    blocksOperation: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureServiceSubscription() {
  const now = nowIso();
  const existing = db.prepare(`
    SELECT *
    FROM service_subscription
    WHERE id = ?
  `).get(SERVICE_SUBSCRIPTION_ID);

  if (existing) {
    return existing;
  }

  const startDateKey = getStoreDateKey(new Date());
  const endDateKey = shiftStoreDateKey(startDateKey, 30);
  const graceDateKey = shiftStoreDateKey(endDateKey, 5);
  db.prepare(`
    INSERT INTO service_subscription (
      id,
      plan_code,
      status,
      monthly_amount,
      currency_code,
      current_period_start,
      current_period_end,
      grace_period_until,
      created_at,
      updated_at
    ) VALUES (?, 'fundadores_beta', 'trial', 200, 'MXN', ?, ?, ?, ?, ?)
  `).run(SERVICE_SUBSCRIPTION_ID, startDateKey, endDateKey, graceDateKey, now, now);

  return db.prepare(`
    SELECT *
    FROM service_subscription
    WHERE id = ?
  `).get(SERVICE_SUBSCRIPTION_ID);
}

function getServiceSubscription() {
  return mapSubscription(ensureServiceSubscription());
}

function updateServiceSubscription(payload = {}) {
  ensureServiceSubscription();
  const status = normalizeText(payload.status || "", 24).toLowerCase();
  if (status && !SERVICE_STATUS_VALUES.has(status)) {
    throw createHttpError("El estado de suscripcion no es valido.", 400);
  }

  const planCode = normalizeText(payload.planCode ?? payload.plan_code ?? "", 48) || null;
  const monthlyAmount = payload.monthlyAmount ?? payload.monthly_amount;
  const currencyCode = normalizeText(payload.currencyCode ?? payload.currency_code ?? "", 8).toUpperCase() || null;
  const currentPeriodStart = normalizeOptionalDateKey(
    payload.currentPeriodStart ?? payload.current_period_start,
    "La fecha inicial del periodo debe tener formato YYYY-MM-DD.",
  );
  const currentPeriodEnd = normalizeOptionalDateKey(
    payload.currentPeriodEnd ?? payload.current_period_end,
    "La fecha final del periodo debe tener formato YYYY-MM-DD.",
  );
  const gracePeriodUntil = normalizeOptionalDateKey(
    payload.gracePeriodUntil ?? payload.grace_period_until,
    "La fecha de gracia debe tener formato YYYY-MM-DD.",
  );
  const notes = normalizeText(payload.notes ?? "", 1000);
  const nextAmount = monthlyAmount === undefined || monthlyAmount === null || monthlyAmount === ""
    ? null
    : roundMoney(monthlyAmount);

  if (nextAmount != null && (!Number.isFinite(nextAmount) || nextAmount < 0)) {
    throw createHttpError("El monto de suscripcion no es valido.", 400);
  }
  if (currentPeriodStart && currentPeriodEnd && currentPeriodStart > currentPeriodEnd) {
    throw createHttpError("La fecha inicial del periodo no puede ser mayor a la final.", 400);
  }

  db.prepare(`
    UPDATE service_subscription
    SET
      plan_code = COALESCE(?, plan_code),
      status = COALESCE(?, status),
      monthly_amount = COALESCE(?, monthly_amount),
      currency_code = COALESCE(?, currency_code),
      current_period_start = COALESCE(?, current_period_start),
      current_period_end = COALESCE(?, current_period_end),
      grace_period_until = COALESCE(?, grace_period_until),
      notes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    planCode,
    status || null,
    nextAmount,
    currencyCode,
    currentPeriodStart,
    currentPeriodEnd,
    gracePeriodUntil,
    notes,
    nowIso(),
    SERVICE_SUBSCRIPTION_ID,
  );

  return getServiceSubscription();
}

function normalizeOptionalIso(value, message) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw createHttpError(message, 400);
  }
  return date.toISOString();
}

function syncServiceSubscriptionSnapshot(payload = {}) {
  ensureServiceSubscription();
  const status = normalizeText(payload.status || "trial", 24).toLowerCase();
  if (!SERVICE_STATUS_VALUES.has(status)) {
    throw createHttpError("El estado de suscripcion central no es valido.", 400);
  }

  const planCode = normalizeText(payload.planCode ?? payload.plan_code ?? "central", 48) || "central";
  const currencyCode = normalizeText(payload.currencyCode ?? payload.currency_code ?? "MXN", 8).toUpperCase() || "MXN";
  const monthlyAmount = roundMoney(payload.monthlyAmount ?? payload.monthly_amount ?? 0);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) {
    throw createHttpError("El monto de suscripcion central no es valido.", 400);
  }

  const currentPeriodStart = normalizeOptionalDateKey(
    payload.currentPeriodStart ?? payload.current_period_start,
    "La fecha inicial central debe tener formato YYYY-MM-DD.",
  );
  const currentPeriodEnd = normalizeOptionalDateKey(
    payload.currentPeriodEnd ?? payload.current_period_end,
    "La fecha final central debe tener formato YYYY-MM-DD.",
  );
  const gracePeriodUntil = normalizeOptionalDateKey(
    payload.gracePeriodUntil ?? payload.grace_period_until,
    "La fecha de gracia central debe tener formato YYYY-MM-DD.",
  );
  if (currentPeriodStart && currentPeriodEnd && currentPeriodStart > currentPeriodEnd) {
    throw createHttpError("El periodo central no es valido.", 400);
  }

  const lastPaymentAt = normalizeOptionalIso(
    payload.lastPaymentAt ?? payload.last_payment_at,
    "La fecha de ultimo pago central no es valida.",
  );
  const notes = normalizeText(payload.notes ?? "", 1000);

  db.prepare(`
    UPDATE service_subscription
    SET
      plan_code = ?,
      status = ?,
      monthly_amount = ?,
      currency_code = ?,
      current_period_start = ?,
      current_period_end = ?,
      grace_period_until = ?,
      last_payment_at = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    planCode,
    status,
    monthlyAmount,
    currencyCode,
    currentPeriodStart,
    currentPeriodEnd,
    gracePeriodUntil,
    lastPaymentAt,
    notes,
    nowIso(),
    SERVICE_SUBSCRIPTION_ID,
  );

  return getServiceSubscription();
}

function mapPayment(row) {
  return {
    id: row.id,
    amount: roundMoney(row.amount || 0),
    paymentMethod: row.payment_method || "",
    paidAt: row.paid_at,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

function listServiceSubscriptionPayments(limit = 12) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 12)));
  return db.prepare(`
    SELECT *
    FROM service_subscription_payments
    ORDER BY paid_at DESC, id DESC
    LIMIT ?
  `).all(safeLimit).map(mapPayment);
}

function normalizePaymentSnapshot(payment = {}) {
  const amount = roundMoney(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const paidAt = normalizeOptionalIso(
    payment.paidAt ?? payment.paid_at,
    "La fecha del pago central no es valida.",
  );
  if (!paidAt) {
    return null;
  }
  const periodStart = normalizeOptionalDateKey(
    payment.periodStart ?? payment.period_start,
    "La fecha inicial del pago central debe tener formato YYYY-MM-DD.",
  );
  const periodEnd = normalizeOptionalDateKey(
    payment.periodEnd ?? payment.period_end,
    "La fecha final del pago central debe tener formato YYYY-MM-DD.",
  );
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw createHttpError("El periodo del pago central no es valido.", 400);
  }

  return {
    amount,
    paymentMethod: normalizeText(payment.paymentMethod ?? payment.payment_method ?? "", 60),
    paidAt,
    periodStart,
    periodEnd,
    notes: normalizeText(payment.notes ?? "", 1000),
  };
}

function syncServiceSubscriptionPayments(payments = []) {
  const source = Array.isArray(payments) ? payments : [];
  let inserted = 0;
  let skipped = 0;
  const now = nowIso();

  const exists = db.prepare(`
    SELECT id
    FROM service_subscription_payments
    WHERE
      amount = ?
      AND paid_at = ?
      AND COALESCE(period_start, '') = COALESCE(?, '')
      AND COALESCE(period_end, '') = COALESCE(?, '')
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO service_subscription_payments (
      amount,
      payment_method,
      paid_at,
      period_start,
      period_end,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    source.forEach((payment) => {
      const normalized = normalizePaymentSnapshot(payment);
      if (!normalized) {
        skipped += 1;
        return;
      }
      const duplicate = exists.get(
        normalized.amount,
        normalized.paidAt,
        normalized.periodStart,
        normalized.periodEnd,
      );
      if (duplicate) {
        skipped += 1;
        return;
      }

      insert.run(
        normalized.amount,
        normalized.paymentMethod,
        normalized.paidAt,
        normalized.periodStart,
        normalized.periodEnd,
        normalized.notes,
        now,
      );
      inserted += 1;
    });
  })();

  return {
    inserted,
    skipped,
    total: source.length,
  };
}

function recordServiceSubscriptionPayment(payload = {}) {
  const subscription = getServiceSubscription();
  const amount = roundMoney(payload.amount ?? subscription.monthlyAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError("El pago debe ser mayor a cero.", 400);
  }

  const todayDateKey = getStoreDateKey(new Date());
  const periodStart = normalizeOptionalDateKey(
    payload.periodStart ?? payload.period_start,
    "La fecha inicial del pago debe tener formato YYYY-MM-DD.",
  ) || todayDateKey;
  const periodEnd = normalizeOptionalDateKey(
    payload.periodEnd ?? payload.period_end,
    "La fecha final del pago debe tener formato YYYY-MM-DD.",
  ) || shiftStoreDateKey(periodStart, 30);
  if (periodStart > periodEnd) {
    throw createHttpError("La fecha inicial del pago no puede ser mayor a la final.", 400);
  }

  const paidAt = payload.paidAt
    ? new Date(payload.paidAt).toISOString()
    : nowIso();
  const paymentMethod = normalizeText(payload.paymentMethod ?? payload.payment_method ?? "", 60);
  const notes = normalizeText(payload.notes ?? "", 1000);
  const now = nowIso();

  const result = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO service_subscription_payments (
        amount,
        payment_method,
        paid_at,
        period_start,
        period_end,
        notes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(amount, paymentMethod, paidAt, periodStart, periodEnd, notes, now);

    db.prepare(`
      UPDATE service_subscription
      SET
        status = 'active',
        monthly_amount = ?,
        current_period_start = ?,
        current_period_end = ?,
        grace_period_until = ?,
        last_payment_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      amount,
      periodStart,
      periodEnd,
      shiftStoreDateKey(periodEnd, 5),
      paidAt,
      now,
      SERVICE_SUBSCRIPTION_ID,
    );

    return Number(insert.lastInsertRowid);
  })();

  return {
    payment: mapPayment(db.prepare("SELECT * FROM service_subscription_payments WHERE id = ?").get(result)),
    subscription: getServiceSubscription(),
  };
}

module.exports = {
  getServiceSubscription,
  listServiceSubscriptionPayments,
  recordServiceSubscriptionPayment,
  syncServiceSubscriptionPayments,
  syncServiceSubscriptionSnapshot,
  updateServiceSubscription,
};
