const crypto = require("node:crypto");

const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  assertBranchIsActive,
  createHttpError,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
  isCreditPaymentMethod,
  isSameStoreDay,
  normalizeBranch,
  normalizeReceivedPaymentMethod,
  normalizeText,
  roundMoney,
} = require("../utils/helpers");

const db = getDb();

function normalizeReceivableCustomerKey(value) {
  return normalizeText(value || "", 80).toLowerCase();
}

function normalizeStoredReceivableCustomerKey(value) {
  return normalizeText(value || "", 120) || "";
}

function slugifyReceivableCustomerFragment(value, fallback = "cliente") {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

  return normalized || fallback;
}

function buildLegacyReceivableCustomerKey(branch, customerName) {
  return normalizeStoredReceivableCustomerKey(
    `legacy:${slugifyReceivableCustomerFragment(branch, "branch")}:${slugifyReceivableCustomerFragment(customerName, "cliente")}`,
  );
}

function createReceivableCustomerKey(branch, customerName) {
  const branchFragment = slugifyReceivableCustomerFragment(branch, "branch");
  const customerFragment = slugifyReceivableCustomerFragment(customerName, "cliente");
  return normalizeStoredReceivableCustomerKey(
    `cust:${branchFragment}:${customerFragment}:${crypto.randomBytes(6).toString("hex")}`,
  );
}

function resolveReceivableCustomerKeyValue(row = {}) {
  const storedKey = normalizeStoredReceivableCustomerKey(row.customer_key || row.customerKey || "");
  if (storedKey) {
    return storedKey;
  }

  return buildLegacyReceivableCustomerKey(
    row.branch || STORE_BRANCHES[0],
    row.customer_name || row.customerName || "",
  );
}

function resolveReceivableCustomerKeyForSale(options = {}) {
  const branch = normalizeBranch(options.branch);
  const customerName = normalizeText(options.customerName || "", 80);
  if (!customerName) {
    return "";
  }

  const requestedCustomerKey = normalizeStoredReceivableCustomerKey(options.requestedCustomerKey || "");
  if (requestedCustomerKey) {
    return requestedCustomerKey;
  }

  const currentCustomerKey = normalizeStoredReceivableCustomerKey(options.currentCustomerKey || "");
  if (currentCustomerKey) {
    return currentCustomerKey;
  }

  return createReceivableCustomerKey(branch, customerName);
}

function normalizeClientPaymentId(value) {
  return normalizeText(value || "", 120) || null;
}

function mapCreditPaymentRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    saleId: Number(row.sale_id),
    clientPaymentId: row.client_payment_id || "",
    ticketNumber: row.ticket_number || "",
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    customerName: row.customer_name || "",
    customerKey: resolveReceivableCustomerKeyValue(row),
    paymentMethod: row.payment_method,
    amount: roundMoney(row.amount),
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

function getCreditPaymentById(paymentId) {
  const row = db.prepare(`
    SELECT
      cp.id,
      cp.sale_id,
      cp.client_payment_id,
      cp.shift,
      cp.cashier,
      cp.branch,
      cp.customer_name,
      cp.customer_key,
      cp.payment_method,
      cp.amount,
      cp.notes,
      cp.created_at,
      s.ticket_number
    FROM credit_payments cp
    JOIN sales s ON s.id = cp.sale_id
    WHERE cp.id = ?
  `).get(paymentId);

  return mapCreditPaymentRow(row);
}

function getCreditPaymentByClientPaymentId(clientPaymentId) {
  const safeClientPaymentId = normalizeClientPaymentId(clientPaymentId);
  if (!safeClientPaymentId) {
    return null;
  }

  const row = db.prepare(`
    SELECT
      cp.id,
      cp.sale_id,
      cp.client_payment_id,
      cp.shift,
      cp.cashier,
      cp.branch,
      cp.customer_name,
      cp.customer_key,
      cp.payment_method,
      cp.amount,
      cp.notes,
      cp.created_at,
      s.ticket_number
    FROM credit_payments cp
    JOIN sales s ON s.id = cp.sale_id
    WHERE cp.client_payment_id = ?
  `).get(safeClientPaymentId);

  return mapCreditPaymentRow(row);
}

function getCreditPaymentRowsBySaleIds(saleIds = []) {
  const normalizedSaleIds = [...new Set(
    (Array.isArray(saleIds) ? saleIds : [])
      .map((saleId) => Number(saleId))
      .filter((saleId) => Number.isInteger(saleId) && saleId > 0),
  )];

  const paymentMap = new Map();
  normalizedSaleIds.forEach((saleId) => paymentMap.set(saleId, []));
  if (normalizedSaleIds.length === 0) {
    return paymentMap;
  }

  const placeholders = normalizedSaleIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT
      cp.id,
      cp.sale_id,
      cp.client_payment_id,
      cp.shift,
      cp.cashier,
      cp.branch,
      cp.customer_name,
      cp.customer_key,
      cp.payment_method,
      cp.amount,
      cp.notes,
      cp.created_at,
      s.ticket_number
    FROM credit_payments cp
    JOIN sales s ON s.id = cp.sale_id
    WHERE cp.sale_id IN (${placeholders})
    ORDER BY cp.created_at ASC, cp.id ASC
  `).all(...normalizedSaleIds);

  rows.forEach((row) => {
    const saleId = Number(row.sale_id);
    if (!paymentMap.has(saleId)) {
      paymentMap.set(saleId, []);
    }
    paymentMap.get(saleId).push(mapCreditPaymentRow(row));
  });

  return paymentMap;
}

function decorateCreditSaleRow(row, payments = []) {
  const total = roundMoney(row.total || 0);
  const initialReceivedAmount = roundMoney(row.received_amount || 0);
  const normalizedPayments = Array.isArray(payments) ? payments : [];
  const laterPaymentsTotal = roundMoney(
    normalizedPayments.reduce((sum, payment) => sum + roundMoney(payment.amount || 0), 0),
  );
  const paidAmount = roundMoney(initialReceivedAmount + laterPaymentsTotal);
  const pendingAmount = getSalePendingAmount(total, paidAmount, row.payment_method);

  return {
    ...row,
    credit_payments: normalizedPayments,
    credit_payments_total: laterPaymentsTotal,
    paid_amount: paidAmount,
    pending_amount: pendingAmount,
  };
}

function decorateSalesWithCreditPayments(rows = [], options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const includePayments = options.includePayments !== false;
  const paymentMap = getCreditPaymentRowsBySaleIds(sourceRows.map((row) => row.id));

  return sourceRows.map((row) => {
    if (!isCreditPaymentMethod(row.payment_method)) {
      return {
        ...row,
        credit_payments: includePayments ? [] : undefined,
        credit_payments_total: 0,
        paid_amount: roundMoney(row.received_amount || row.total || 0),
        pending_amount: 0,
      };
    }

    const payments = paymentMap.get(Number(row.id)) || [];
    const decorated = decorateCreditSaleRow(row, payments);
    if (!includePayments) {
      decorated.credit_payments = undefined;
    }
    return decorated;
  });
}

function listFiadoSales(branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        ticket_number,
        shift,
        cashier,
        branch,
        payment_method,
        customer_name,
        customer_key,
        received_payment_method,
        total,
        received_amount,
        notes,
        created_at
      FROM sales
      WHERE payment_method = 'Fiado' AND customer_name IS NOT NULL AND customer_name != ''
      ORDER BY created_at ASC, id ASC
    `).all()
    : db.prepare(`
      SELECT
        id,
        ticket_number,
        shift,
        cashier,
        branch,
        payment_method,
        customer_name,
        customer_key,
        received_payment_method,
        total,
        received_amount,
        notes,
        created_at
      FROM sales
      WHERE branch = ? AND payment_method = 'Fiado' AND customer_name IS NOT NULL AND customer_name != ''
      ORDER BY created_at ASC, id ASC
    `).all(normalizedBranch);

  return decorateSalesWithCreditPayments(rows).map((row) => ({
    saleId: Number(row.id),
    id: Number(row.id),
    ticketNumber: row.ticket_number,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    paymentMethod: row.payment_method,
    customerName: row.customer_name || "",
    customerKey: resolveReceivableCustomerKeyValue(row),
    receivedPaymentMethod: getSaleReceivedPaymentMethod(
      row.payment_method,
      row.received_payment_method || "",
      row.received_amount,
    ),
    total: roundMoney(row.total),
    receivedAmount: roundMoney(row.received_amount),
    laterPaymentsTotal: roundMoney(row.credit_payments_total || 0),
    paidAmount: roundMoney(row.paid_amount || 0),
    pendingAmount: roundMoney(row.pending_amount || 0),
    notes: row.notes || "",
    createdAt: row.created_at,
    lastPaymentAt: row.credit_payments?.length
      ? row.credit_payments[row.credit_payments.length - 1].createdAt
      : null,
    payments: Array.isArray(row.credit_payments) ? row.credit_payments : [],
  }));
}

function listReceivableCustomers(branch = STORE_BRANCHES[0], options = {}) {
  const normalizedSearch = normalizeText(options.search || "", 120).toLowerCase();
  const sales = listFiadoSales(branch).filter((sale) => sale.pendingAmount > 0);
  const grouped = new Map();

  sales.forEach((sale) => {
    if (
      normalizedSearch
      && !sale.customerName.toLowerCase().includes(normalizedSearch)
      && !sale.ticketNumber.toLowerCase().includes(normalizedSearch)
    ) {
      return;
    }

    const customerKey = sale.customerKey;
    const current = grouped.get(customerKey) || {
      customerKey,
      customerName: sale.customerName,
      branch: sale.branch,
      pendingAmount: 0,
      paidAmount: 0,
      openSalesCount: 0,
      oldestSaleAt: sale.createdAt,
      latestActivityAt: sale.lastPaymentAt || sale.createdAt,
    };

    current.pendingAmount = roundMoney(current.pendingAmount + sale.pendingAmount);
    current.paidAmount = roundMoney(current.paidAmount + sale.paidAmount);
    current.openSalesCount += 1;
    if (String(sale.createdAt).localeCompare(String(current.oldestSaleAt)) < 0) {
      current.oldestSaleAt = sale.createdAt;
    }
    const currentActivityAt = sale.lastPaymentAt || sale.createdAt;
    if (String(currentActivityAt).localeCompare(String(current.latestActivityAt)) > 0) {
      current.latestActivityAt = currentActivityAt;
    }

    grouped.set(customerKey, current);
  });

  return [...grouped.values()]
    .sort((left, right) => {
      if (right.pendingAmount !== left.pendingAmount) {
        return right.pendingAmount - left.pendingAmount;
      }
      return String(right.latestActivityAt).localeCompare(String(left.latestActivityAt));
    });
}

function getReceivableCustomerDetail(customerKey, branch = STORE_BRANCHES[0]) {
  const safeCustomerKey = normalizeStoredReceivableCustomerKey(customerKey);
  if (!safeCustomerKey) {
    return null;
  }

  const sales = listFiadoSales(branch)
    .filter((sale) => sale.customerKey === safeCustomerKey && sale.pendingAmount > 0)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));

  if (sales.length === 0) {
    return null;
  }

  return {
    customerKey: safeCustomerKey,
    customerName: sales[0].customerName,
    branch: sales[0].branch,
    pendingAmount: roundMoney(sales.reduce((sum, sale) => sum + sale.pendingAmount, 0)),
    paidAmount: roundMoney(sales.reduce((sum, sale) => sum + sale.paidAmount, 0)),
    openSalesCount: sales.length,
    oldestSaleAt: sales[0].createdAt,
    latestActivityAt: sales.reduce((latest, sale) => {
      const current = sale.lastPaymentAt || sale.createdAt;
      return String(current).localeCompare(String(latest)) > 0 ? current : latest;
    }, sales[0].lastPaymentAt || sales[0].createdAt),
    sales,
  };
}

function listCreditPaymentsForStoreDay(baseDate = new Date(), branch = STORE_BRANCHES[0], options = {}) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        cp.id,
        cp.sale_id,
        cp.client_payment_id,
        cp.shift,
        cp.cashier,
        cp.branch,
        cp.customer_name,
        cp.customer_key,
        cp.payment_method,
        cp.amount,
        cp.notes,
        cp.created_at,
        s.ticket_number
      FROM credit_payments cp
      JOIN sales s ON s.id = cp.sale_id
      ORDER BY cp.created_at DESC, cp.id DESC
    `).all()
    : db.prepare(`
      SELECT
        cp.id,
        cp.sale_id,
        cp.client_payment_id,
        cp.shift,
        cp.cashier,
        cp.branch,
        cp.customer_name,
        cp.customer_key,
        cp.payment_method,
        cp.amount,
        cp.notes,
        cp.created_at,
        s.ticket_number
      FROM credit_payments cp
      JOIN sales s ON s.id = cp.sale_id
      WHERE cp.branch = ?
      ORDER BY cp.created_at DESC, cp.id DESC
    `).all(normalizedBranch);

  const shift = normalizeText(options.shift || "", 24) || null;
  return rows
    .filter((row) => isSameStoreDay(row.created_at, baseDate))
    .filter((row) => !shift || row.shift === shift)
    .map(mapCreditPaymentRow);
}

function listRecentCreditPayments(limit = 8, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        cp.id,
        cp.sale_id,
        cp.client_payment_id,
        cp.shift,
        cp.cashier,
        cp.branch,
        cp.customer_name,
        cp.customer_key,
        cp.payment_method,
        cp.amount,
        cp.notes,
        cp.created_at,
        s.ticket_number
      FROM credit_payments cp
      JOIN sales s ON s.id = cp.sale_id
      ORDER BY cp.created_at DESC, cp.id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        cp.id,
        cp.sale_id,
        cp.client_payment_id,
        cp.shift,
        cp.cashier,
        cp.branch,
        cp.customer_name,
        cp.customer_key,
        cp.payment_method,
        cp.amount,
        cp.notes,
        cp.created_at,
        s.ticket_number
      FROM credit_payments cp
      JOIN sales s ON s.id = cp.sale_id
      WHERE cp.branch = ?
      ORDER BY cp.created_at DESC, cp.id DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map(mapCreditPaymentRow);
}

function listCreditPaymentsForExport() {
  return db.prepare(`
    SELECT
      cp.id,
      cp.sale_id,
      cp.client_payment_id,
      cp.shift,
      cp.cashier,
      cp.branch,
      cp.customer_name,
      cp.customer_key,
      cp.payment_method,
      cp.amount,
      cp.notes,
      cp.created_at,
      s.ticket_number,
      s.total AS sale_total,
      s.created_at AS sale_created_at
    FROM credit_payments cp
    JOIN sales s ON s.id = cp.sale_id
    ORDER BY cp.created_at DESC, cp.id DESC
  `).all();
}

function createReceivablePayment(payload = {}) {
  const clientPaymentId = normalizeClientPaymentId(payload.clientPaymentId);
  if (clientPaymentId) {
    const existingPayment = getCreditPaymentByClientPaymentId(clientPaymentId);
    if (existingPayment) {
      return existingPayment;
    }
  }

  const saleId = Number(payload.saleId);
  const shift = normalizeText(payload.shift || "Tarde", 24) || "Tarde";
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const paymentMethod = normalizeReceivedPaymentMethod(
    payload.paymentMethod || payload.receivedPaymentMethod || "Efectivo",
    "Efectivo",
  );
  const amount = roundMoney(payload.amount);
  const notes = normalizeText(payload.notes || "", 240) || null;

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw createHttpError("Selecciona una venta fiada valida para registrar el abono.");
  }
  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para registrar el abono.");
  }
  assertBranchIsActive(branch, "Selecciona una sucursal activa para registrar el abono.");
  if (!paymentMethod) {
    throw createHttpError("Selecciona un medio valido para registrar el abono.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError("El abono debe ser mayor a cero.");
  }

  const { assertCashierCanOperate } = require("./register");
  assertCashierCanOperate({
    shift,
    branch,
    cashier,
    errorMessage: "Este cajero ya hizo corte final hoy y no puede registrar abonos hasta el siguiente dia.",
  });

  const sale = db.prepare(`
    SELECT
      id,
      ticket_number,
      shift,
      cashier,
      branch,
      payment_method,
      customer_name,
      customer_key,
      received_payment_method,
      total,
      received_amount,
      notes,
      created_at
    FROM sales
    WHERE id = ? AND branch = ?
  `).get(saleId, branch);

  if (!sale) {
    throw createHttpError("No encontre la venta fiada que quieres abonar.", 404);
  }
  if (!isCreditPaymentMethod(sale.payment_method) || !sale.customer_name) {
    throw createHttpError("Solo puedes registrar abonos sobre ventas marcadas como fiado.");
  }

  const [decoratedSale] = decorateSalesWithCreditPayments([sale]);
  const pendingAmount = roundMoney(decoratedSale?.pending_amount || 0);
  if (pendingAmount <= 0) {
    throw createHttpError("Esta venta ya no tiene saldo pendiente.");
  }
  if (amount > pendingAmount) {
    throw createHttpError(`El abono no puede exceder el saldo pendiente de ${roundMoney(pendingAmount)}.`);
  }

  let paymentId;
  try {
    const now = nowIso();
    const result = db.prepare(`
      INSERT INTO credit_payments (
        sale_id,
        client_payment_id,
        shift,
        cashier,
        branch,
        customer_name,
        customer_key,
        payment_method,
        amount,
        notes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      saleId,
      clientPaymentId,
      shift,
      cashier,
      branch,
      sale.customer_name,
      resolveReceivableCustomerKeyValue(sale),
      paymentMethod,
      amount,
      notes,
      now,
    );
    paymentId = Number(result.lastInsertRowid);
  } catch (error) {
    if (clientPaymentId && String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
      const existingPayment = getCreditPaymentByClientPaymentId(clientPaymentId);
      if (existingPayment) {
        return existingPayment;
      }
    }
    throw error;
  }

  return getCreditPaymentById(paymentId);
}

module.exports = {
  createReceivablePayment,
  decorateSalesWithCreditPayments,
  getCreditPaymentById,
  getCreditPaymentRowsBySaleIds,
  getReceivableCustomerDetail,
  listCreditPaymentsForExport,
  listCreditPaymentsForStoreDay,
  listRecentCreditPayments,
  listReceivableCustomers,
  resolveReceivableCustomerKeyForSale,
  normalizeReceivableCustomerKey,
};
