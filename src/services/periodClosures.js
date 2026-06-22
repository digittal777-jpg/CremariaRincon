const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_SHIFTS,
  createHttpError,
  getBranchLabel,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
  getStoreDateKey,
  getStorePeriodRange,
  isCreditPaymentMethod,
  isStoreDateKeyInRange,
  listConfiguredBranches,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { getClientSyncHealthSummary } = require("./backups");

const db = getDb();
const SUPPORTED_PERIOD_TYPES = new Set(["week", "month"]);

function normalizePeriodType(value, allowedTypes = SUPPORTED_PERIOD_TYPES) {
  const normalized = normalizeText(value || "week", 24).toLowerCase() || "week";
  if (!allowedTypes.has(normalized)) {
    throw createHttpError("El periodo solicitado no es valido.", 400);
  }
  return normalized;
}

function normalizeClosureBranch(value) {
  const normalized = normalizeBranch(value || ALL_BRANCHES, {
    allowAll: true,
    fallback: null,
  });
  if (!normalized) {
    throw createHttpError("Selecciona una sucursal valida.", 400);
  }
  return normalized;
}

function normalizeClosureNotes(value) {
  return normalizeText(value || "", 1000) || "";
}

function getCollectedByMethod(sale, method) {
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

function createMetricBucket(seed = {}) {
  return {
    tickets: 0,
    totalSales: 0,
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    creditSales: 0,
    creditCollections: 0,
    openingAmount: 0,
    withdrawalsAmount: 0,
    expectedCash: 0,
    quickCuts: 0,
    finalCuts: 0,
    finalCutDifferenceTotal: 0,
    weightedAuditPendingSessions: 0,
    weightedAuditCompletedSessions: 0,
    weightedAuditIncidentItems: 0,
    weightedAuditShortageKg: 0,
    weightedAuditSurplusKg: 0,
    weightedAuditVarianceValue: 0,
    averageTicket: 0,
    nonCashSales: 0,
    ...seed,
  };
}

function finalizeMetricBucket(bucket = {}) {
  const next = {
    ...bucket,
    tickets: Number(bucket.tickets || 0),
    totalSales: roundMoney(bucket.totalSales || 0),
    cashSales: roundMoney(bucket.cashSales || 0),
    cardSales: roundMoney(bucket.cardSales || 0),
    transferSales: roundMoney(bucket.transferSales || 0),
    creditSales: roundMoney(bucket.creditSales || 0),
    creditCollections: roundMoney(bucket.creditCollections || 0),
    openingAmount: roundMoney(bucket.openingAmount || 0),
    withdrawalsAmount: roundMoney(bucket.withdrawalsAmount || 0),
    quickCuts: Number(bucket.quickCuts || 0),
    finalCuts: Number(bucket.finalCuts || 0),
    finalCutDifferenceTotal: roundMoney(bucket.finalCutDifferenceTotal || 0),
    weightedAuditPendingSessions: Number(bucket.weightedAuditPendingSessions || 0),
    weightedAuditCompletedSessions: Number(bucket.weightedAuditCompletedSessions || 0),
    weightedAuditIncidentItems: Number(bucket.weightedAuditIncidentItems || 0),
    weightedAuditShortageKg: roundStock(bucket.weightedAuditShortageKg || 0),
    weightedAuditSurplusKg: roundStock(bucket.weightedAuditSurplusKg || 0),
    weightedAuditVarianceValue: roundMoney(bucket.weightedAuditVarianceValue || 0),
  };

  next.expectedCash = roundMoney(next.openingAmount + next.cashSales - next.withdrawalsAmount);
  next.nonCashSales = roundMoney(next.cardSales + next.transferSales + next.creditSales);
  next.averageTicket = roundMoney(next.totalSales / Math.max(next.tickets, 1));
  return next;
}

function getOrCreateBucket(map, key, seed = {}) {
  if (!map.has(key)) {
    map.set(key, createMetricBucket(seed));
  }
  return map.get(key);
}

function buildCreditPaymentTotalsBySaleId(rows = []) {
  const totals = new Map();
  rows.forEach((row) => {
    const saleId = Number(row.sale_id);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return;
    }
    const currentValue = totals.get(saleId) || 0;
    totals.set(saleId, roundMoney(currentValue + roundMoney(row.amount || 0)));
  });
  return totals;
}

function decorateSaleRows(rows = [], laterPaymentsBySaleId = new Map()) {
  return rows.map((row) => {
    const laterPaymentsTotal = roundMoney(laterPaymentsBySaleId.get(Number(row.id)) || 0);
    const paidAmount = isCreditPaymentMethod(row.payment_method)
      ? roundMoney(roundMoney(row.received_amount || 0) + laterPaymentsTotal)
      : roundMoney(row.total || 0);
    return {
      ...row,
      later_payments_total: laterPaymentsTotal,
      paid_amount: paidAmount,
      pending_amount: getSalePendingAmount(row.total, paidAmount, row.payment_method),
      dateKey: getStoreDateKey(row.created_at),
    };
  });
}

function buildBranchSql(columnName, branch) {
  return branch === ALL_BRANCHES ? "" : `WHERE ${columnName} = ?`;
}

function loadSalesRows(branch) {
  const whereSql = buildBranchSql("branch", branch);
  const query = `
    SELECT
      id,
      ticket_number,
      shift,
      cashier,
      branch,
      payment_method,
      received_payment_method,
      total,
      received_amount,
      created_at
    FROM sales
    ${whereSql}
    ORDER BY created_at DESC, id DESC
  `;

  return branch === ALL_BRANCHES
    ? db.prepare(query).all()
    : db.prepare(query).all(branch);
}

function loadCreditPaymentRows(branch) {
  const whereSql = buildBranchSql("branch", branch);
  const query = `
    SELECT
      id,
      sale_id,
      shift,
      cashier,
      branch,
      payment_method,
      amount,
      created_at
    FROM credit_payments
    ${whereSql}
    ORDER BY created_at DESC, id DESC
  `;

  return branch === ALL_BRANCHES
    ? db.prepare(query).all()
    : db.prepare(query).all(branch);
}

function loadRegisterEventRows(branch) {
  const whereSql = buildBranchSql("branch", branch);
  const query = `
    SELECT
      id,
      event_type,
      shift,
      cashier,
      branch,
      opening_amount,
      withdrawals_amount,
      difference_amount,
      created_at
    FROM register_events
    ${whereSql}
    ORDER BY created_at DESC, id DESC
  `;

  return branch === ALL_BRANCHES
    ? db.prepare(query).all()
    : db.prepare(query).all(branch);
}

function loadWeightedAuditSessionRows(branch) {
  const whereSql = buildBranchSql("branch", branch);
  const query = `
    SELECT
      id,
      branch,
      shift,
      audited_date_key,
      status,
      source_cashier,
      created_at,
      completed_at
    FROM weighted_audit_sessions
    ${whereSql}
    ORDER BY audited_date_key DESC, id DESC
  `;

  return branch === ALL_BRANCHES
    ? db.prepare(query).all()
    : db.prepare(query).all(branch);
}

function loadWeightedAuditItemRows(branch) {
  const whereSql = branch === ALL_BRANCHES ? "" : "WHERE s.branch = ?";
  const query = `
    SELECT
      s.id AS session_id,
      s.branch,
      s.shift,
      s.audited_date_key,
      s.status,
      s.source_cashier,
      i.id AS item_id,
      i.difference,
      i.unit_price
    FROM weighted_audit_sessions s
    JOIN weighted_audit_items i ON i.session_id = s.id
    ${whereSql}
    ORDER BY s.audited_date_key DESC, s.id DESC, i.id DESC
  `;

  return branch === ALL_BRANCHES
    ? db.prepare(query).all()
    : db.prepare(query).all(branch);
}

function filterRowsByCreatedAtRange(rows = [], range = {}) {
  return rows.filter((row) =>
    isStoreDateKeyInRange(
      getStoreDateKey(row.created_at),
      range.startDateKey,
      range.endDateKey,
    ));
}

function filterRowsByDateKeyRange(rows = [], range = {}, fieldName = "audited_date_key") {
  return rows.filter((row) =>
    isStoreDateKeyInRange(
      String(row[fieldName] || ""),
      range.startDateKey,
      range.endDateKey,
    ));
}

function accumulateSaleMetrics(bucket, sale) {
  bucket.tickets += 1;
  bucket.totalSales = roundMoney(bucket.totalSales + roundMoney(sale.total || 0));
  bucket.cashSales = roundMoney(bucket.cashSales + getCollectedByMethod(sale, "Efectivo"));
  bucket.cardSales = roundMoney(bucket.cardSales + getCollectedByMethod(sale, "Tarjeta"));
  bucket.transferSales = roundMoney(bucket.transferSales + getCollectedByMethod(sale, "Transferencia"));
  bucket.creditSales = roundMoney(bucket.creditSales + roundMoney(sale.pending_amount || 0));
  if (isCreditPaymentMethod(sale.payment_method)) {
    bucket.creditCollections = roundMoney(
      bucket.creditCollections + roundMoney(sale.received_amount || 0),
    );
  }
}

function accumulateCreditPaymentMetrics(bucket, payment) {
  bucket.creditCollections = roundMoney(bucket.creditCollections + roundMoney(payment.amount || 0));
  if (payment.payment_method === "Efectivo") {
    bucket.cashSales = roundMoney(bucket.cashSales + roundMoney(payment.amount || 0));
  } else if (payment.payment_method === "Tarjeta") {
    bucket.cardSales = roundMoney(bucket.cardSales + roundMoney(payment.amount || 0));
  } else if (payment.payment_method === "Transferencia") {
    bucket.transferSales = roundMoney(bucket.transferSales + roundMoney(payment.amount || 0));
  }
}

function accumulateRegisterEventMetrics(bucket, event) {
  if (event.event_type === "start") {
    bucket.openingAmount = roundMoney(bucket.openingAmount + roundMoney(event.opening_amount || 0));
  }

  bucket.withdrawalsAmount = roundMoney(
    bucket.withdrawalsAmount + roundMoney(event.withdrawals_amount || 0),
  );

  if (event.event_type === "quick_cut") {
    bucket.quickCuts += 1;
  }

  if (event.event_type === "final_cut") {
    bucket.finalCuts += 1;
    bucket.finalCutDifferenceTotal = roundMoney(
      bucket.finalCutDifferenceTotal + roundMoney(event.difference_amount || 0),
    );
  }
}

function accumulateWeightedAuditSessionMetrics(bucket, session) {
  if (session.status === "completed") {
    bucket.weightedAuditCompletedSessions += 1;
  } else {
    bucket.weightedAuditPendingSessions += 1;
  }
}

function accumulateWeightedAuditItemMetrics(bucket, row) {
  const difference = row.difference == null ? null : roundStock(row.difference);
  if (difference == null || difference === 0) {
    return;
  }

  bucket.weightedAuditIncidentItems += 1;
  if (difference < 0) {
    bucket.weightedAuditShortageKg = roundStock(
      bucket.weightedAuditShortageKg + Math.abs(difference),
    );
  } else {
    bucket.weightedAuditSurplusKg = roundStock(
      bucket.weightedAuditSurplusKg + difference,
    );
  }

  bucket.weightedAuditVarianceValue = roundMoney(
    bucket.weightedAuditVarianceValue + roundMoney(difference * roundMoney(row.unit_price || 0)),
  );
}

function buildOperatingGroupKey(branch, dateKey, shift, cashier) {
  return [
    String(branch || ""),
    String(dateKey || ""),
    String(shift || ""),
    String(cashier || ""),
  ].join("::");
}

function buildMissingFinalCutGroups(sales = [], creditPayments = [], registerEvents = []) {
  const finalCutKeys = new Set();
  const activityByKey = new Map();

  registerEvents.forEach((event) => {
    const key = buildOperatingGroupKey(
      event.branch,
      getStoreDateKey(event.created_at),
      event.shift,
      event.cashier,
    );
    if (event.event_type === "final_cut") {
      finalCutKeys.add(key);
      return;
    }
    if (!["start", "quick_cut"].includes(event.event_type)) {
      return;
    }

    const current = activityByKey.get(key) || {
      branch: event.branch,
      dateKey: getStoreDateKey(event.created_at),
      shift: event.shift,
      cashier: event.cashier,
      activityTypes: new Set(),
      salesCount: 0,
      creditPaymentsCount: 0,
      registerEventsCount: 0,
    };
    current.activityTypes.add(event.event_type);
    current.registerEventsCount += 1;
    activityByKey.set(key, current);
  });

  sales.forEach((sale) => {
    const key = buildOperatingGroupKey(sale.branch, sale.dateKey, sale.shift, sale.cashier);
    const current = activityByKey.get(key) || {
      branch: sale.branch,
      dateKey: sale.dateKey,
      shift: sale.shift,
      cashier: sale.cashier,
      activityTypes: new Set(),
      salesCount: 0,
      creditPaymentsCount: 0,
      registerEventsCount: 0,
    };
    current.activityTypes.add("sale");
    current.salesCount += 1;
    activityByKey.set(key, current);
  });

  creditPayments.forEach((payment) => {
    const key = buildOperatingGroupKey(
      payment.branch,
      getStoreDateKey(payment.created_at),
      payment.shift,
      payment.cashier,
    );
    const current = activityByKey.get(key) || {
      branch: payment.branch,
      dateKey: getStoreDateKey(payment.created_at),
      shift: payment.shift,
      cashier: payment.cashier,
      activityTypes: new Set(),
      salesCount: 0,
      creditPaymentsCount: 0,
      registerEventsCount: 0,
    };
    current.activityTypes.add("credit_payment");
    current.creditPaymentsCount += 1;
    activityByKey.set(key, current);
  });

  return [...activityByKey.entries()]
    .filter(([key]) => !finalCutKeys.has(key))
    .map(([, value]) => ({
      branch: value.branch,
      branchLabel: getBranchLabel(value.branch),
      dateKey: value.dateKey,
      shift: value.shift,
      cashier: value.cashier,
      activityTypes: [...value.activityTypes].sort(),
      salesCount: value.salesCount,
      creditPaymentsCount: value.creditPaymentsCount,
      registerEventsCount: value.registerEventsCount,
    }))
    .sort((left, right) =>
      [
        String(left.dateKey || "").localeCompare(String(right.dateKey || "")),
        String(left.branch || "").localeCompare(String(right.branch || "")),
        String(left.shift || "").localeCompare(String(right.shift || "")),
        String(left.cashier || "").localeCompare(String(right.cashier || "")),
      ].find((result) => result !== 0) || 0);
}

function buildPeriodWarnings(summary, context = {}) {
  const warnings = [];
  const syncHealth = context.syncHealth || getClientSyncHealthSummary();
  if (syncHealth?.hasPending) {
    warnings.push({
      code: "sync_pending",
      severity: "error",
      message: `Hay ${syncHealth.pendingReportCount || 0} reporte(s) con cola pendiente, ${syncHealth.blockedReportCount || 0} bloqueado(s) y ${syncHealth.registerEventReportCount || 0} evento(s) de caja offline sin sincronizar.`,
    });
  }

  if (summary.weightedAuditPendingSessions > 0) {
    warnings.push({
      code: "weighted_audit_pending",
      severity: "error",
      message: `Quedan ${summary.weightedAuditPendingSessions} sesion(es) de auditoria kg pendientes en el periodo.`,
    });
  }

  if (Array.isArray(context.missingFinalCutGroups) && context.missingFinalCutGroups.length > 0) {
    const sample = context.missingFinalCutGroups
      .slice(0, 3)
      .map((entry) => `${entry.branchLabel} ${entry.dateKey} ${entry.shift} ${entry.cashier}`)
      .join(", ");
    warnings.push({
      code: "missing_final_cut",
      severity: "error",
      message: `Hay ${context.missingFinalCutGroups.length} caja(s) con actividad sin corte final.${sample ? ` Ejemplos: ${sample}.` : ""}`,
    });
  }

  return warnings;
}

function createPeriodClosureBlockingError(preview) {
  const firstBlockingWarning = Array.isArray(preview?.warnings)
    ? preview.warnings.find((warning) => warning.severity === "error")
    : null;
  const error = createHttpError(
    firstBlockingWarning?.message || "No pude guardar el cierre semanal con advertencias bloqueantes.",
    409,
  );
  error.clientPayload = {
    code: firstBlockingWarning?.code || "period_closure_blocked",
    warnings: Array.isArray(preview?.warnings) ? preview.warnings : [],
  };
  return error;
}

function buildComparableSnapshotPayload(snapshot = {}) {
  return {
    summary: snapshot.summary || {},
    breakdowns: snapshot.breakdowns || {},
    warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
  };
}

function isSnapshotStale(storedSnapshot = {}, livePreview = {}) {
  return JSON.stringify(buildComparableSnapshotPayload(storedSnapshot))
    !== JSON.stringify(buildComparableSnapshotPayload(livePreview));
}

function parseSnapshotJson(snapshotJson) {
  if (typeof snapshotJson !== "string" || !snapshotJson.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(snapshotJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function buildPeriodClosureRowResponse(row, livePreview = null) {
  if (!row) {
    return null;
  }

  const snapshot = parseSnapshotJson(row.snapshot_json);
  const storedWarnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const liveWarnings = Array.isArray(livePreview?.warnings) ? livePreview.warnings : storedWarnings;
  const liveCanSave = livePreview
    ? Boolean(livePreview.canSave)
    : !storedWarnings.some((warning) => warning?.severity === "error");
  return {
    id: Number(row.id),
    branch: row.branch,
    periodType: row.period_type,
    periodStartDateKey: row.period_start_date_key,
    periodEndDateKey: row.period_end_date_key,
    notes: row.notes || "",
    summary: snapshot.summary || createMetricBucket(),
    breakdowns: snapshot.breakdowns || {},
    warnings: storedWarnings,
    storedWarnings,
    liveWarnings,
    liveCanSave,
    isStale: livePreview ? isSnapshotStale(snapshot, livePreview) : false,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getStoredClosureRowByScope(branch, periodType, periodStartDateKey, periodEndDateKey) {
  return db.prepare(`
    SELECT
      id,
      branch,
      period_type,
      period_start_date_key,
      period_end_date_key,
      notes,
      snapshot_json,
      created_by,
      created_at,
      updated_at
    FROM period_closures
    WHERE branch = ? AND period_type = ? AND period_start_date_key = ? AND period_end_date_key = ?
    LIMIT 1
  `).get(branch, periodType, periodStartDateKey, periodEndDateKey);
}

function getStoredClosureRowById(closureId) {
  return db.prepare(`
    SELECT
      id,
      branch,
      period_type,
      period_start_date_key,
      period_end_date_key,
      notes,
      snapshot_json,
      created_by,
      created_at,
      updated_at
    FROM period_closures
    WHERE id = ?
    LIMIT 1
  `).get(closureId);
}

function sortShiftBreakdown(items = []) {
  const shiftOrder = new Map(STORE_SHIFTS.map((shift, index) => [shift, index]));
  return items.sort((left, right) => {
    const leftOrder = shiftOrder.has(left.shift) ? shiftOrder.get(left.shift) : 999;
    const rightOrder = shiftOrder.has(right.shift) ? shiftOrder.get(right.shift) : 999;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return String(left.shift || "").localeCompare(String(right.shift || ""));
  });
}

function sortBranchBreakdown(items = []) {
  const configuredOrder = new Map(
    listConfiguredBranches({ includeInactive: true }).map((branch, index) => [branch.code, index]),
  );
  return items.sort((left, right) => {
    const leftOrder = configuredOrder.has(left.branch) ? configuredOrder.get(left.branch) : 999;
    const rightOrder = configuredOrder.has(right.branch) ? configuredOrder.get(right.branch) : 999;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return String(left.branch || "").localeCompare(String(right.branch || ""));
  });
}

function buildLivePeriodClosurePreview(options = {}) {
  const periodType = normalizePeriodType(options.periodType);
  const branch = normalizeClosureBranch(options.branch);
  const range = getStorePeriodRange(periodType, options.anchorDateKey || new Date());
  const syncHealth = getClientSyncHealthSummary({
    branch,
  });

  const creditPayments = filterRowsByCreatedAtRange(loadCreditPaymentRows(branch), range);
  const sales = decorateSaleRows(
    filterRowsByCreatedAtRange(loadSalesRows(branch), range),
    buildCreditPaymentTotalsBySaleId(creditPayments),
  );
  const registerEvents = filterRowsByCreatedAtRange(loadRegisterEventRows(branch), range);
  const weightedAuditSessions = filterRowsByDateKeyRange(loadWeightedAuditSessionRows(branch), range);
  const weightedAuditRows = filterRowsByDateKeyRange(loadWeightedAuditItemRows(branch), range);

  const summary = createMetricBucket();
  const byDate = new Map();
  const byShift = new Map();
  const byCashier = new Map();
  const byBranch = new Map();

  sales.forEach((sale) => {
    const saleDateBucket = getOrCreateBucket(byDate, sale.dateKey, { dateKey: sale.dateKey });
    const saleShiftBucket = getOrCreateBucket(byShift, sale.shift, { shift: sale.shift });
    const saleCashierBucket = getOrCreateBucket(
      byCashier,
      buildOperatingGroupKey(sale.branch, "", "", sale.cashier),
      {
        branch: sale.branch,
        branchLabel: getBranchLabel(sale.branch),
        cashier: sale.cashier,
      },
    );
    const saleBranchBucket = getOrCreateBucket(byBranch, sale.branch, {
      branch: sale.branch,
      branchLabel: getBranchLabel(sale.branch),
    });

    [summary, saleDateBucket, saleShiftBucket, saleCashierBucket, saleBranchBucket].forEach((bucket) => {
      accumulateSaleMetrics(bucket, sale);
    });
  });

  creditPayments.forEach((payment) => {
    const paymentDateKey = getStoreDateKey(payment.created_at);
    const paymentDateBucket = getOrCreateBucket(byDate, paymentDateKey, { dateKey: paymentDateKey });
    const paymentShiftBucket = getOrCreateBucket(byShift, payment.shift, { shift: payment.shift });
    const paymentCashierBucket = getOrCreateBucket(
      byCashier,
      buildOperatingGroupKey(payment.branch, "", "", payment.cashier),
      {
        branch: payment.branch,
        branchLabel: getBranchLabel(payment.branch),
        cashier: payment.cashier,
      },
    );
    const paymentBranchBucket = getOrCreateBucket(byBranch, payment.branch, {
      branch: payment.branch,
      branchLabel: getBranchLabel(payment.branch),
    });

    [summary, paymentDateBucket, paymentShiftBucket, paymentCashierBucket, paymentBranchBucket].forEach((bucket) => {
      accumulateCreditPaymentMetrics(bucket, payment);
    });
  });

  registerEvents.forEach((event) => {
    const eventDateKey = getStoreDateKey(event.created_at);
    const eventDateBucket = getOrCreateBucket(byDate, eventDateKey, { dateKey: eventDateKey });
    const eventShiftBucket = getOrCreateBucket(byShift, event.shift, { shift: event.shift });
    const eventCashierBucket = getOrCreateBucket(
      byCashier,
      buildOperatingGroupKey(event.branch, "", "", event.cashier),
      {
        branch: event.branch,
        branchLabel: getBranchLabel(event.branch),
        cashier: event.cashier,
      },
    );
    const eventBranchBucket = getOrCreateBucket(byBranch, event.branch, {
      branch: event.branch,
      branchLabel: getBranchLabel(event.branch),
    });

    [summary, eventDateBucket, eventShiftBucket, eventCashierBucket, eventBranchBucket].forEach((bucket) => {
      accumulateRegisterEventMetrics(bucket, event);
    });
  });

  weightedAuditSessions.forEach((session) => {
    const sessionDateBucket = getOrCreateBucket(byDate, session.audited_date_key, {
      dateKey: session.audited_date_key,
    });
    const sessionShiftBucket = getOrCreateBucket(byShift, session.shift, { shift: session.shift });
    const sessionBranchBucket = getOrCreateBucket(byBranch, session.branch, {
      branch: session.branch,
      branchLabel: getBranchLabel(session.branch),
    });

    [summary, sessionDateBucket, sessionShiftBucket, sessionBranchBucket].forEach((bucket) => {
      accumulateWeightedAuditSessionMetrics(bucket, session);
    });

    if (session.source_cashier) {
      const sessionCashierBucket = getOrCreateBucket(
        byCashier,
        buildOperatingGroupKey(session.branch, "", "", session.source_cashier),
        {
          branch: session.branch,
          branchLabel: getBranchLabel(session.branch),
          cashier: session.source_cashier,
        },
      );
      accumulateWeightedAuditSessionMetrics(sessionCashierBucket, session);
    }
  });

  weightedAuditRows.forEach((row) => {
    const rowDateBucket = getOrCreateBucket(byDate, row.audited_date_key, {
      dateKey: row.audited_date_key,
    });
    const rowShiftBucket = getOrCreateBucket(byShift, row.shift, { shift: row.shift });
    const rowBranchBucket = getOrCreateBucket(byBranch, row.branch, {
      branch: row.branch,
      branchLabel: getBranchLabel(row.branch),
    });

    [summary, rowDateBucket, rowShiftBucket, rowBranchBucket].forEach((bucket) => {
      accumulateWeightedAuditItemMetrics(bucket, row);
    });

    if (row.source_cashier) {
      const rowCashierBucket = getOrCreateBucket(
        byCashier,
        buildOperatingGroupKey(row.branch, "", "", row.source_cashier),
        {
          branch: row.branch,
          branchLabel: getBranchLabel(row.branch),
          cashier: row.source_cashier,
        },
      );
      accumulateWeightedAuditItemMetrics(rowCashierBucket, row);
    }
  });

  const finalizedSummary = finalizeMetricBucket(summary);
  const missingFinalCutGroups = buildMissingFinalCutGroups(sales, creditPayments, registerEvents);
  const warnings = buildPeriodWarnings(finalizedSummary, {
    syncHealth,
    missingFinalCutGroups,
  });
  const canSave = !warnings.some((warning) => warning.severity === "error");

  return {
    branch,
    periodType,
    anchorDateKey: range.anchorDateKey,
    periodStartDateKey: range.startDateKey,
    periodEndDateKey: range.endDateKey,
    summary: finalizedSummary,
    breakdowns: {
      byDate: [...byDate.values()]
        .map(finalizeMetricBucket)
        .sort((left, right) => String(left.dateKey || "").localeCompare(String(right.dateKey || ""))),
      byShift: sortShiftBreakdown([...byShift.values()].map(finalizeMetricBucket)),
      byCashier: [...byCashier.values()]
        .map(finalizeMetricBucket)
        .sort((left, right) =>
          [
            String(left.branch || "").localeCompare(String(right.branch || "")),
            String(left.cashier || "").localeCompare(String(right.cashier || "")),
          ].find((result) => result !== 0) || 0),
      ...(branch === ALL_BRANCHES
        ? {
            byBranch: sortBranchBreakdown([...byBranch.values()].map(finalizeMetricBucket)),
          }
        : {}),
    },
    warnings,
    canSave,
    missingFinalCutGroups,
  };
}

function listPeriodClosures(options = {}) {
  const branch = normalizeClosureBranch(options.branch);
  const periodType = normalizePeriodType(options.periodType || "week");
  const limit = Math.max(1, Math.min(Number(options.limit || 12), 60));
  const rows = db.prepare(`
    SELECT
      id,
      branch,
      period_type,
      period_start_date_key,
      period_end_date_key,
      notes,
      snapshot_json,
      created_by,
      created_at,
      updated_at
    FROM period_closures
    WHERE branch = ? AND period_type = ?
    ORDER BY period_start_date_key DESC, updated_at DESC, id DESC
    LIMIT ?
  `).all(branch, periodType, limit);

  return rows.map((row) => {
    const livePreview = buildLivePeriodClosurePreview({
      branch: row.branch,
      periodType: row.period_type,
      anchorDateKey: row.period_start_date_key,
    });
    return buildPeriodClosureRowResponse(row, livePreview);
  });
}

function getPeriodClosureById(closureId) {
  const safeClosureId = Number(closureId);
  if (!Number.isInteger(safeClosureId) || safeClosureId <= 0) {
    throw createHttpError("No pude identificar ese cierre semanal.", 404);
  }

  const row = getStoredClosureRowById(safeClosureId);
  if (!row) {
    throw createHttpError("No encontre ese cierre semanal.", 404);
  }

  const livePreview = buildLivePeriodClosurePreview({
    branch: row.branch,
    periodType: row.period_type,
    anchorDateKey: row.period_start_date_key,
  });
  return buildPeriodClosureRowResponse(row, livePreview);
}

function getPeriodClosurePreview(options = {}) {
  const preview = buildLivePeriodClosurePreview(options);
  const matchingRow = getStoredClosureRowByScope(
    preview.branch,
    preview.periodType,
    preview.periodStartDateKey,
    preview.periodEndDateKey,
  );

  const matchingClosure = matchingRow
    ? buildPeriodClosureRowResponse(matchingRow, preview)
    : null;

  return {
    ...preview,
    notes: matchingClosure?.notes || "",
    matchingClosure,
  };
}

function savePeriodClosure(payload = {}) {
  const preview = getPeriodClosurePreview(payload);
  if (!preview.canSave) {
    throw createPeriodClosureBlockingError(preview);
  }

  const now = nowIso();
  const notes = normalizeClosureNotes(payload.notes);
  const createdBy = normalizeText(payload.createdBy || "admin", 60) || "admin";
  const snapshotPayload = {
    branch: preview.branch,
    periodType: preview.periodType,
    periodStartDateKey: preview.periodStartDateKey,
    periodEndDateKey: preview.periodEndDateKey,
    summary: preview.summary,
    breakdowns: preview.breakdowns,
    warnings: preview.warnings,
  };

  db.prepare(`
    INSERT INTO period_closures (
      branch,
      period_type,
      period_start_date_key,
      period_end_date_key,
      notes,
      snapshot_json,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(branch, period_type, period_start_date_key, period_end_date_key)
    DO UPDATE SET
      notes = excluded.notes,
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at
  `).run(
    preview.branch,
    preview.periodType,
    preview.periodStartDateKey,
    preview.periodEndDateKey,
    notes,
    JSON.stringify(snapshotPayload),
    createdBy,
    now,
    now,
  );

  const storedRow = getStoredClosureRowByScope(
    preview.branch,
    preview.periodType,
    preview.periodStartDateKey,
    preview.periodEndDateKey,
  );
  return buildPeriodClosureRowResponse(storedRow, preview);
}

module.exports = {
  getPeriodClosureById,
  getPeriodClosurePreview,
  listPeriodClosures,
  normalizePeriodType,
  savePeriodClosure,
};
