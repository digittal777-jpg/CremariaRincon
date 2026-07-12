const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  assertBranchIsActive,
  createHttpError,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
  getStoreDateKey,
  getStoreDateRangeForValue,
  isCreditPaymentMethod,
  normalizeBranch,
  normalizeText,
  roundMoney,
} = require("../utils/helpers");

const db = getDb();

function normalizeClientEventId(value) {
  return normalizeText(value || "", 120) || null;
}

function getCollectedTodayByMethod(sale, method) {
  const total = roundMoney(sale.total || 0);
  const receivedAmount = roundMoney(sale.received_amount || 0);

  if (!isCreditPaymentMethod(sale.payment_method)) {
    return sale.payment_method === method ? total : 0;
  }

  return getSaleReceivedPaymentMethod(
    sale.payment_method,
    sale.received_payment_method || "",
    receivedAmount,
  ) === method
    ? receivedAmount
    : 0;
}

function getRegisterEventsForStoreDay(shift, baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const range = getStoreDateRangeForValue(baseDate);
  return normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        client_event_id,
        over_withdrawal_amount,
        opening_amount,
        counted_amount,
        withdrawals_amount,
        expected_cash,
        difference_amount,
        cash_sales,
        non_cash_sales,
        total_sales,
        notes,
        created_at
      FROM register_events
      WHERE shift = ? AND created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
    `).all(shift, range.startAt, range.endAt)
    : db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        client_event_id,
        over_withdrawal_amount,
        opening_amount,
        counted_amount,
        withdrawals_amount,
        expected_cash,
        difference_amount,
        cash_sales,
        non_cash_sales,
        total_sales,
        notes,
        created_at
      FROM register_events
      WHERE shift = ? AND branch = ? AND created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
    `).all(shift, normalizedBranch, range.startAt, range.endAt);
}

function getCashierFinalCutForStoreDay(shift, branch, cashier, baseDate = new Date()) {
  const safeShift = normalizeText(shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const safeBranch = normalizeBranch(branch, { allowAll: true });
  const safeCashier = normalizeText(cashier || "", 60);
  if (!safeCashier) {
    return null;
  }

  const range = getStoreDateRangeForValue(baseDate);
  return safeBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        created_at
      FROM register_events
      WHERE shift = ? AND cashier = ? AND event_type = 'final_cut' AND created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
    `).all(safeShift, safeCashier, range.startAt, range.endAt)[0] || null
    : db.prepare(`
      SELECT
        id,
        created_at
      FROM register_events
      WHERE shift = ? AND branch = ? AND cashier = ? AND event_type = 'final_cut' AND created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
    `).all(safeShift, safeBranch, safeCashier, range.startAt, range.endAt)[0] || null;
}

function assertCashierCanOperate({ shift, branch, cashier, errorMessage }) {
  const safeCashier = normalizeText(cashier || "", 60);
  if (!safeCashier) {
    return null;
  }

  const finalCut = getCashierFinalCutForStoreDay(shift, branch, safeCashier, new Date());
  if (finalCut) {
    throw createHttpError(
      errorMessage || "Este cajero ya hizo corte final hoy y no puede operar hasta el siguiente dia.",
    );
  }

  return null;
}

function getRegisterSummary(shift, branch = STORE_BRANCHES[0], options = {}) {
  const normalizedShift = normalizeText(shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const cashier = normalizeText(options.cashier || "", 60) || null;
  if (!STORE_SHIFTS.includes(normalizedShift)) {
    throw createHttpError("Selecciona un turno valido para la caja.");
  }

  const { listStoreDaySales } = require("./sales");
  const { decorateSalesWithCreditPayments, listCreditPaymentsForStoreDay } = require("./receivables");
  const sales = decorateSalesWithCreditPayments(
    listStoreDaySales(new Date(), normalizedBranch, { shift: normalizedShift }),
    { includePayments: false },
  );
  const creditPayments = listCreditPaymentsForStoreDay(new Date(), normalizedBranch, {
    shift: normalizedShift,
  });
  const events = getRegisterEventsForStoreDay(normalizedShift, new Date(), normalizedBranch);
  const startEvent = events.find((event) => event.event_type === "start") || null;
  const openingAmount = roundMoney(startEvent?.opening_amount || 0);
  const totalSales = roundMoney(
    sales.reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const laterCreditCashSales = roundMoney(
    creditPayments.reduce(
      (sum, payment) => sum + (payment.paymentMethod === "Efectivo" ? roundMoney(payment.amount) : 0),
      0,
    ),
  );
  const cashSales = roundMoney(
    sales.reduce((sum, sale) => sum + getCollectedTodayByMethod(sale, "Efectivo"), 0)
      + laterCreditCashSales,
  );
  const withdrawalsAmount = roundMoney(
    events.reduce((sum, event) => sum + roundMoney(event.withdrawals_amount || 0), 0),
  );
  const laterCreditCardSales = roundMoney(
    creditPayments.reduce(
      (sum, payment) => sum + (payment.paymentMethod === "Tarjeta" ? roundMoney(payment.amount) : 0),
      0,
    ),
  );
  const cardSales = roundMoney(
    sales.reduce((sum, sale) => sum + getCollectedTodayByMethod(sale, "Tarjeta"), 0)
      + laterCreditCardSales,
  );
  const laterCreditTransferSales = roundMoney(
    creditPayments.reduce(
      (sum, payment) => sum + (payment.paymentMethod === "Transferencia" ? roundMoney(payment.amount) : 0),
      0,
    ),
  );
  const transferSales = roundMoney(
    sales.reduce((sum, sale) => sum + getCollectedTodayByMethod(sale, "Transferencia"), 0)
      + laterCreditTransferSales,
  );
  const creditSales = roundMoney(
    sales.reduce(
      (sum, sale) => sum + roundMoney(sale.pending_amount || 0),
      0,
    ),
  );
  const initialCreditCollections = roundMoney(
    sales.reduce((sum, sale) => {
      if (!isCreditPaymentMethod(sale.payment_method)) {
        return sum;
      }
      return roundMoney(sum + roundMoney(sale.received_amount || 0));
    }, 0),
  );
  const laterCreditCollections = roundMoney(
    creditPayments.reduce((sum, payment) => sum + roundMoney(payment.amount || 0), 0),
  );
  const nonCashSales = roundMoney(cardSales + transferSales + creditSales);
  const cashierFinalCut = cashier
    ? getCashierFinalCutForStoreDay(normalizedShift, normalizedBranch, cashier, new Date())
    : null;

  return {
    shift: normalizedShift,
    openingAmount,
    cashSales,
    withdrawalsAmount,
    cardSales,
    transferSales,
    creditSales,
    creditCollections: roundMoney(initialCreditCollections + laterCreditCollections),
    nonCashSales,
    totalSales,
    expectedCash: roundMoney(openingAmount + cashSales - withdrawalsAmount),
    tickets: sales.length,
    lastStartAt: startEvent?.created_at || null,
    lastStartCashier: startEvent?.cashier || null,
    quickCuts: events.filter((event) => event.event_type === "quick_cut").length,
    finalCuts: events.filter((event) => event.event_type === "final_cut").length,
    cashierLocked: Boolean(cashierFinalCut),
    cashierFinalCutAt: cashierFinalCut?.created_at || null,
  };
}

function getRegisterEventById(eventId) {
  const row = db.prepare(`
    SELECT
      id,
      event_type,
      shift,
      cashier,
      branch,
      client_event_id,
      over_withdrawal_amount,
      opening_amount,
      counted_amount,
      withdrawals_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    FROM register_events
    WHERE id = ?
  `).get(eventId);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    eventType: row.event_type,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    clientEventId: row.client_event_id || "",
    overWithdrawalAmount: roundMoney(row.over_withdrawal_amount || 0),
    openingAmount: roundMoney(row.opening_amount),
    countedAmount: roundMoney(row.counted_amount),
    withdrawalsAmount: roundMoney(row.withdrawals_amount || 0),
    expectedCash: roundMoney(row.expected_cash),
    differenceAmount: roundMoney(row.difference_amount),
    cashSales: roundMoney(row.cash_sales),
    nonCashSales: roundMoney(row.non_cash_sales),
    totalSales: roundMoney(row.total_sales),
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

function getRegisterEventByClientEventId(clientEventId) {
  const safeClientEventId = normalizeClientEventId(clientEventId);
  if (!safeClientEventId) {
    return null;
  }

  const row = db.prepare(`
    SELECT id
    FROM register_events
    WHERE client_event_id = ?
  `).get(safeClientEventId);

  if (!row) {
    return null;
  }

  return getRegisterEventById(row.id);
}

function startRegister(payload) {
  const summary = getRegisterSummary(payload.shift, payload.branch, { cashier: payload.cashier });
  const shift = summary.shift;
  const branch = normalizeBranch(payload.branch);
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const openingAmount = roundMoney(payload.openingAmount);
  const notes = normalizeText(payload.notes || "", 180) || null;
  const clientEventId = normalizeClientEventId(payload.clientEventId);

  assertBranchIsActive(branch, "Selecciona una sucursal activa para iniciar la caja.");

  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    throw createHttpError("El monto inicial de caja debe ser cero o mayor.");
  }

  if (clientEventId) {
    const existing = getRegisterEventByClientEventId(clientEventId);
    if (existing) {
      if (existing.eventType !== "start") {
        throw createHttpError("El clientEventId ya fue usado en otro tipo de evento de caja.");
      }
      return {
        eventId: existing.id,
        summary: getRegisterSummary(existing.shift, existing.branch, { cashier: existing.cashier }),
      };
    }
  }

  assertCashierCanOperate({
    shift,
    branch,
    cashier,
    errorMessage: "Este cajero ya hizo corte final hoy y no puede iniciar caja hasta el siguiente dia.",
  });

  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
      client_event_id,
      over_withdrawal_amount,
      opening_amount,
      counted_amount,
      withdrawals_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "start",
    shift,
    cashier,
    branch,
    clientEventId,
    0,
    openingAmount,
    openingAmount,
    0,
    openingAmount,
    0,
    0,
    0,
    0,
    notes,
    now,
  );

  return {
    eventId: Number(insert.lastInsertRowid),
    summary: getRegisterSummary(shift, branch, { cashier }),
  };
}

function createRegisterCut(payload) {
  const eventType = normalizeText(payload.eventType || "quick_cut", 24).toLowerCase();
  if (!["quick_cut", "final_cut"].includes(eventType)) {
    throw createHttpError("El tipo de corte no es valido.");
  }

  const summary = getRegisterSummary(payload.shift, payload.branch, { cashier: payload.cashier });
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const countedAmount = roundMoney(
    payload.countedAmount === undefined ? summary.expectedCash : payload.countedAmount,
  );
  const withdrawalsAmount = roundMoney(payload.withdrawalsAmount || 0);
  const notes = normalizeText(payload.notes || "", 180) || null;
  const clientEventId = normalizeClientEventId(payload.clientEventId);

  assertBranchIsActive(branch, "Selecciona una sucursal activa para registrar el corte.");

  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw createHttpError("El efectivo contado debe ser cero o mayor.");
  }
  if (!Number.isFinite(withdrawalsAmount) || withdrawalsAmount < 0) {
    throw createHttpError("El monto retirado debe ser cero o mayor.");
  }
  if (withdrawalsAmount > 0 && !notes) {
    throw createHttpError("Captura un motivo en la nota cuando registres un retiro.");
  }

  if (clientEventId) {
    const existing = getRegisterEventByClientEventId(clientEventId);
    if (existing) {
      let auditResolution = null;
      if (existing.eventType === "final_cut") {
        const { ensureWeightedAuditSessionForFinalCut } = require("./weightedAudit");
        auditResolution = ensureWeightedAuditSessionForFinalCut({
          branch: existing.branch,
          shift: existing.shift,
          cashier: existing.cashier,
          eventId: existing.id,
          dateKey: getStoreDateKey(new Date(existing.createdAt)),
        });
      }

      if (existing.eventType !== eventType) {
        throw createHttpError("El clientEventId ya fue usado en otro tipo de evento de caja.");
      }
      return {
        eventId: existing.id,
        differenceAmount: existing.differenceAmount,
        overWithdrawalAmount: existing.overWithdrawalAmount || 0,
        auditSession: auditResolution?.session || null,
        auditSessionCreated: Boolean(auditResolution?.created),
        summary: getRegisterSummary(existing.shift, existing.branch, { cashier: existing.cashier }),
      };
    }
  }

  assertCashierCanOperate({
    shift: summary.shift,
    branch,
    cashier,
    errorMessage: "Este cajero ya hizo corte final hoy y no puede registrar mas cortes.",
  });

  const now = nowIso();
  const overWithdrawalAmount = roundMoney(Math.max(0, withdrawalsAmount - summary.expectedCash));
  const expectedCashAfterWithdraw = roundMoney(summary.expectedCash - withdrawalsAmount);
  const differenceAmount = roundMoney(countedAmount - expectedCashAfterWithdraw);
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
      client_event_id,
      over_withdrawal_amount,
      opening_amount,
      counted_amount,
      withdrawals_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    summary.shift,
    cashier,
    branch,
    clientEventId,
    overWithdrawalAmount,
    summary.openingAmount,
    countedAmount,
    withdrawalsAmount,
    expectedCashAfterWithdraw,
    differenceAmount,
    summary.cashSales,
    summary.nonCashSales,
    summary.totalSales,
    notes,
    now,
  );

  let auditResolution = null;
  if (eventType === "final_cut") {
    const { ensureWeightedAuditSessionForFinalCut } = require("./weightedAudit");
    auditResolution = ensureWeightedAuditSessionForFinalCut({
      branch,
      shift: summary.shift,
      cashier,
      eventId: Number(insert.lastInsertRowid),
      dateKey: getStoreDateKey(new Date(now)),
    });
  }

  return {
    eventId: Number(insert.lastInsertRowid),
    differenceAmount,
    overWithdrawalAmount,
    auditSession: auditResolution?.session || null,
    auditSessionCreated: Boolean(auditResolution?.created),
    summary: getRegisterSummary(summary.shift, branch, { cashier }),
  };
}

function getRecentRegisterEvents(limit = 16, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        counted_amount,
        withdrawals_amount,
        difference_amount,
        created_at
      FROM register_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
        counted_amount,
        withdrawals_amount,
        difference_amount,
        created_at
      FROM register_events
      WHERE branch = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    countedAmount: roundMoney(row.counted_amount),
    withdrawalsAmount: roundMoney(row.withdrawals_amount || 0),
    differenceAmount: roundMoney(row.difference_amount),
    createdAt: row.created_at,
  }));
}

function listRegisterEventsForExport(options = {}) {
  const normalizedBranch = normalizeBranch(options.branch || ALL_BRANCHES, {
    allowAll: true,
    fallback: ALL_BRANCHES,
  });
  const clauses = [];
  const params = [];
  if (normalizedBranch !== ALL_BRANCHES) {
    clauses.push("branch = ?");
    params.push(normalizedBranch);
  }
  if (options.startAt) {
    clauses.push("created_at >= ?");
    params.push(String(options.startAt));
  }
  if (options.endAt) {
    clauses.push("created_at < ?");
    params.push(String(options.endAt));
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return db.prepare(`
    SELECT
      id,
      event_type,
      shift,
      cashier,
      branch,
      client_event_id,
      over_withdrawal_amount,
      opening_amount,
      counted_amount,
      withdrawals_amount,
      expected_cash,
      difference_amount,
      cash_sales,
      non_cash_sales,
      total_sales,
      notes,
      created_at
    FROM register_events
    ${whereSql}
    ORDER BY created_at DESC, id DESC
  `).all(...params);
}

function updateRegisterEventAdmin(eventId, payload) {
  const current = getRegisterEventById(eventId);
  if (!current) {
    throw createHttpError("No encontre el corte o inicio de caja.", 404);
  }

  const nextShift = normalizeText(payload.shift || current.shift, 24) || current.shift;
  const nextCashier = normalizeText(payload.cashier || current.cashier, 60) || current.cashier;
  const nextOpeningAmount = roundMoney(
    payload.openingAmount === undefined ? current.openingAmount : payload.openingAmount,
  );
  const nextCountedAmount = roundMoney(
    payload.countedAmount === undefined ? current.countedAmount : payload.countedAmount,
  );
  const nextNotes = normalizeText(payload.notes ?? current.notes ?? "", 180) || null;
  const nextExpectedCash = roundMoney(
    payload.expectedCash === undefined ? current.expectedCash : payload.expectedCash,
  );
  const nextWithdrawalsAmount = roundMoney(
    payload.withdrawalsAmount === undefined ? current.withdrawalsAmount : payload.withdrawalsAmount,
  );
  const nextCashSales = roundMoney(
    payload.cashSales === undefined ? current.cashSales : payload.cashSales,
  );
  const nextNonCashSales = roundMoney(
    payload.nonCashSales === undefined ? current.nonCashSales : payload.nonCashSales,
  );
  const nextTotalSales = roundMoney(
    payload.totalSales === undefined ? current.totalSales : payload.totalSales,
  );

  if (!STORE_SHIFTS.includes(nextShift)) {
    throw createHttpError("Selecciona un turno valido para caja.");
  }

  db.prepare(`
    UPDATE register_events
    SET shift = ?, cashier = ?, opening_amount = ?, counted_amount = ?, withdrawals_amount = ?, expected_cash = ?, difference_amount = ?, cash_sales = ?, non_cash_sales = ?, total_sales = ?, notes = ?
    WHERE id = ?
  `).run(
    nextShift,
    nextCashier,
    nextOpeningAmount,
    nextCountedAmount,
    nextWithdrawalsAmount,
    nextExpectedCash,
    roundMoney(nextCountedAmount - nextExpectedCash),
    nextCashSales,
    nextNonCashSales,
    nextTotalSales,
    nextNotes,
    eventId,
  );

  if (current.eventType === "final_cut") {
    const { syncWeightedAuditSessionFromRegisterEvent } = require("./weightedAudit");
    syncWeightedAuditSessionFromRegisterEvent(eventId);
  }

  return getRegisterEventById(eventId);
}

module.exports = {
  assertCashierCanOperate,
  createRegisterCut,
  getCashierFinalCutForStoreDay,
  getRegisterEventById,
  getRegisterEventByClientEventId,
  getRegisterEventsForStoreDay,
  getRegisterSummary,
  getRecentRegisterEvents,
  listRegisterEventsForExport,
  startRegister,
  updateRegisterEventAdmin,
};
