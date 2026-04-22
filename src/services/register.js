const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  createHttpError,
  getBranchLabel,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { STORE_TIME_ZONE } = require("../config.js");

const db = getDb();

function getRegisterEventsForStoreDay(shift, baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
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
      WHERE shift = ?
      ORDER BY created_at DESC, id DESC
    `).all(shift)
    : db.prepare(`
      SELECT
        id,
        event_type,
        shift,
        cashier,
        branch,
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
      WHERE shift = ? AND branch = ?
      ORDER BY created_at DESC, id DESC
    `).all(shift, normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}


function isSameStoreDay(value, baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const partsValue = Object.fromEntries(
    formatter.formatToParts(new Date(value))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const partsBase = Object.fromEntries(
    formatter.formatToParts(new Date(baseDate))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );

  return `${partsValue.year}-${partsValue.month}-${partsValue.day}` ===
         `${partsBase.year}-${partsBase.month}-${partsBase.day}`;
}

function getRegisterSummary(shift, branch = STORE_BRANCHES[0]) {
  const normalizedShift = normalizeText(shift || STORE_SHIFTS[0], 24) || STORE_SHIFTS[0];
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  if (!STORE_SHIFTS.includes(normalizedShift)) {
    throw createHttpError("Selecciona un turno valido para la caja.");
  }

  const { listStoreDaySales } = require("./sales");
  const sales = listStoreDaySales(new Date(), normalizedBranch).filter((sale) => sale.shift === normalizedShift);
  const events = getRegisterEventsForStoreDay(normalizedShift, new Date(), normalizedBranch);
  const startEvent = events.find((event) => event.event_type === "start") || null;
  const openingAmount = roundMoney(startEvent?.opening_amount || 0);
  const totalSales = roundMoney(
    sales.reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const cashSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Efectivo")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const withdrawalsAmount = roundMoney(
    events.reduce((sum, event) => sum + roundMoney(event.withdrawals_amount || 0), 0),
  );
  const cardSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Tarjeta")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const transferSales = roundMoney(
    sales
      .filter((sale) => sale.payment_method === "Transferencia")
      .reduce((sum, sale) => sum + roundMoney(sale.total), 0),
  );
  const nonCashSales = roundMoney(totalSales - cashSales);

  return {
    shift: normalizedShift,
    openingAmount,
    cashSales,
    withdrawalsAmount,
    cardSales,
    transferSales,
    nonCashSales,
    totalSales,
    expectedCash: roundMoney(openingAmount + cashSales - withdrawalsAmount),
    tickets: sales.length,
    lastStartAt: startEvent?.created_at || null,
    lastStartCashier: startEvent?.cashier || null,
    quickCuts: events.filter((event) => event.event_type === "quick_cut").length,
    finalCuts: events.filter((event) => event.event_type === "final_cut").length,
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

function startRegister(payload) {
  const summary = getRegisterSummary(payload.shift, payload.branch);
  const shift = summary.shift;
  const branch = normalizeBranch(payload.branch);
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const openingAmount = roundMoney(payload.openingAmount);
  const notes = normalizeText(payload.notes || "", 180) || null;

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    throw createHttpError("El monto inicial de caja debe ser cero o mayor.");
  }

  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "start",
    shift,
    cashier,
    branch,
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
    summary: getRegisterSummary(shift, branch),
  };
}

function createRegisterCut(payload) {
  const eventType = normalizeText(payload.eventType || "quick_cut", 24).toLowerCase();
  if (!["quick_cut", "final_cut"].includes(eventType)) {
    throw createHttpError("El tipo de corte no es valido.");
  }

  const summary = getRegisterSummary(payload.shift, payload.branch);
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const countedAmount = roundMoney(
    payload.countedAmount === undefined ? summary.expectedCash : payload.countedAmount,
  );
  const withdrawalsAmount = roundMoney(payload.withdrawalsAmount || 0);
  const notes = normalizeText(payload.notes || "", 180) || null;

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw createHttpError("El efectivo contado debe ser cero o mayor.");
  }
  if (!Number.isFinite(withdrawalsAmount) || withdrawalsAmount < 0) {
    throw createHttpError("El monto retirado debe ser cero o mayor.");
  }

  const now = nowIso();
  const expectedCashAfterWithdraw = roundMoney(summary.expectedCash - withdrawalsAmount);
  const differenceAmount = roundMoney(countedAmount - expectedCashAfterWithdraw);
  const insert = db.prepare(`
    INSERT INTO register_events (
      event_type,
      shift,
      cashier,
      branch,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    summary.shift,
    cashier,
    branch,
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

  return {
    eventId: Number(insert.lastInsertRowid),
    differenceAmount,
    summary: getRegisterSummary(summary.shift, branch),
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

  return getRegisterEventById(eventId);
}

module.exports = {
  createRegisterCut,
  getRegisterEventById,
  getRegisterEventsForStoreDay,
  getRegisterSummary,
  getRecentRegisterEvents,
  startRegister,
  updateRegisterEventAdmin,
};