let receivablesSearchTimerId = null;

function getReceivablesBranch() {
  return getActiveCashierBranch();
}

function getReceivableSaleRef(sale = {}) {
  if (sale?.saleRef) {
    return String(sale.saleRef);
  }

  const clientSaleId = String(sale?.clientSaleId || "").trim();
  if (clientSaleId) {
    return `local:${clientSaleId}`;
  }

  const saleId = Number(sale?.saleId || sale?.id || 0) || null;
  if (saleId) {
    return `sale:${saleId}`;
  }

  const ticketNumber = String(sale?.ticketNumber || "").trim();
  if (ticketNumber) {
    return `ticket:${ticketNumber}`;
  }

  return `sale:${Date.now()}`;
}

function normalizeReceivablePaymentLine(payment = {}, options = {}) {
  return {
    id: Number(payment.id || 0) || null,
    saleId: Number(payment.saleId || payment.sale_id || 0) || null,
    clientPaymentId: String(payment.clientPaymentId || payment.client_payment_id || ""),
    ticketNumber: String(payment.ticketNumber || ""),
    shift: String(payment.shift || ""),
    cashier: String(payment.cashier || ""),
    branch: String(payment.branch || ""),
    customerName: String(payment.customerName || ""),
    customerKey: String(payment.customerKey || ""),
    paymentMethod: String(payment.paymentMethod || "Efectivo"),
    amount: roundMoney(payment.amount || 0),
    notes: String(payment.notes || ""),
    createdAt: payment.createdAt || payment.created_at || new Date().toISOString(),
    localOnly: Boolean(options.localOnly || payment.localOnly),
    pendingSync: Boolean(options.pendingSync || payment.pendingSync),
  };
}

function normalizeReceivableSaleView(sale = {}, options = {}) {
  const total = roundMoney(sale.total || 0);
  const receivedAmount = roundMoney(sale.receivedAmount || 0);
  const laterPaymentsTotal = roundMoney(sale.laterPaymentsTotal || 0);
  const paidAmount = roundMoney(
    sale.paidAmount === undefined
      ? receivedAmount + laterPaymentsTotal
      : sale.paidAmount,
  );
  const pendingAmount = roundMoney(
    sale.pendingAmount === undefined
      ? Math.max(0, total - paidAmount)
      : sale.pendingAmount,
  );
  const payments = Array.isArray(sale.payments)
    ? sale.payments.map((payment) => normalizeReceivablePaymentLine(payment))
    : [];

  return {
    saleId: Number(sale.saleId || sale.id || 0) || null,
    id: Number(sale.id || sale.saleId || 0) || null,
    saleRef: String(options.saleRef || getReceivableSaleRef(sale)),
    clientSaleId: String(sale.clientSaleId || ""),
    ticketNumber: String(sale.ticketNumber || "Ticket"),
    shift: String(sale.shift || ""),
    cashier: String(sale.cashier || ""),
    branch: String(sale.branch || getReceivablesBranch()),
    paymentMethod: String(sale.paymentMethod || "Fiado"),
    customerName: String(sale.customerName || ""),
    customerKey: String(sale.customerKey || ""),
    receivedPaymentMethod: String(sale.receivedPaymentMethod || ""),
    total,
    receivedAmount,
    laterPaymentsTotal,
    paidAmount,
    pendingAmount,
    notes: String(sale.notes || ""),
    createdAt: sale.createdAt || new Date().toISOString(),
    lastPaymentAt: sale.lastPaymentAt || null,
    isLocalOnly: Boolean(options.isLocalOnly || sale.isLocalOnly),
    syncStatus: String(options.syncStatus || sale.syncStatus || ""),
    syncNote: String(options.syncNote || sale.syncNote || ""),
    pendingSyncPaymentsCount: Math.max(
      0,
      Number(options.pendingSyncPaymentsCount ?? sale.pendingSyncPaymentsCount ?? 0),
    ),
    payments,
  };
}

function normalizeReceivableCustomerView(customer = {}) {
  return {
    customerKey: String(customer.customerKey || ""),
    customerName: String(customer.customerName || ""),
    branch: String(customer.branch || getReceivablesBranch()),
    pendingAmount: roundMoney(customer.pendingAmount || 0),
    paidAmount: roundMoney(customer.paidAmount || 0),
    openSalesCount: Math.max(0, Number(customer.openSalesCount || 0)),
    oldestSaleAt: customer.oldestSaleAt || null,
    latestActivityAt: customer.latestActivityAt || null,
    sales: Array.isArray(customer.sales)
      ? customer.sales.map((sale) => normalizeReceivableSaleView(sale))
      : [],
    ticketNumbers: Array.isArray(customer.ticketNumbers)
      ? [...new Set(customer.ticketNumbers.map((ticket) => String(ticket || "").trim()).filter(Boolean))]
      : [],
    localSaleCount: Math.max(0, Number(customer.localSaleCount || 0)),
    localPaymentCount: Math.max(0, Number(customer.localPaymentCount || 0)),
  };
}

function getReceivableCustomerSearchBlob(customer = {}) {
  return normalizeSearchText([
    customer.customerName,
    ...(Array.isArray(customer.ticketNumbers) ? customer.ticketNumbers : []),
  ].filter(Boolean).join(" "));
}

function getExactReceivableCustomerCandidates(customerName, branch = getReceivablesBranch()) {
  const normalizedName = normalizeSearchText(customerName);
  if (!normalizedName) {
    return [];
  }

  const normalizedBranch = String(branch || "").trim();
  const candidates = [
    ...(Array.isArray(state.receivables?.customers) ? state.receivables.customers : []),
    ...getCachedReceivableCustomers(normalizedBranch),
  ]
    .map((customer) => normalizeReceivableCustomerView(customer))
    .filter((customer) =>
      !normalizedBranch || !customer.branch || customer.branch === normalizedBranch,
    );

  const seenKeys = new Set();
  return candidates.filter((customer) => {
    if (normalizeSearchText(customer.customerName) !== normalizedName) {
      return false;
    }

    const dedupeKey = customer.customerKey || `${customer.branch}:${normalizeSearchText(customer.customerName)}`;
    if (seenKeys.has(dedupeKey)) {
      return false;
    }
    seenKeys.add(dedupeKey);
    return true;
  });
}

function findCachedReceivableCustomerByName(customerName, branch = getReceivablesBranch()) {
  const matches = getExactReceivableCustomerCandidates(customerName, branch);
  return matches.length === 1 ? matches[0] : null;
}

function resolveReceivableCustomerViewKey(options = {}) {
  const branch = String(options.branch || getReceivablesBranch()).trim();
  const customerKey = String(options.customerKey || "").trim();
  if (customerKey) {
    return customerKey;
  }

  const customerName = String(options.customerName || "").trim();
  if (!customerName) {
    return buildClientReceivableCustomerLookupKey(branch, "cliente");
  }

  const preferredCustomer =
    options.preferredCustomer && typeof options.preferredCustomer === "object"
      ? options.preferredCustomer
      : null;
  if (
    preferredCustomer?.customerKey
    && normalizeSearchText(preferredCustomer.customerName) === normalizeSearchText(customerName)
  ) {
    return String(preferredCustomer.customerKey);
  }

  const customerMap = options.customerMap instanceof Map ? options.customerMap : null;
  if (customerMap) {
    let matchedKey = "";
    for (const [entryKey, customer] of customerMap.entries()) {
      if (normalizeSearchText(customer.customerName) !== normalizeSearchText(customerName)) {
        continue;
      }
      if (matchedKey && matchedKey !== entryKey) {
        matchedKey = "";
        break;
      }
      matchedKey = entryKey;
    }
    if (matchedKey) {
      return matchedKey;
    }
  }

  const cachedMatch = findCachedReceivableCustomerByName(customerName, branch);
  if (cachedMatch?.customerKey) {
    return String(cachedMatch.customerKey);
  }

  return buildClientReceivableCustomerLookupKey(branch, customerName);
}

function createReceivableCustomerAccumulator(identity = {}) {
  return normalizeReceivableCustomerView({
    customerKey: identity.customerKey || "",
    customerName: identity.customerName || "",
    branch: identity.branch || getReceivablesBranch(),
    pendingAmount: 0,
    paidAmount: 0,
    openSalesCount: 0,
    oldestSaleAt: identity.oldestSaleAt || null,
    latestActivityAt: identity.latestActivityAt || null,
    ticketNumbers: [],
    localSaleCount: 0,
    localPaymentCount: 0,
  });
}

function updateReceivableCustomerAccumulatorFromSale(accumulator, sale, options = {}) {
  accumulator.customerName = accumulator.customerName || sale.customerName || "Cliente";
  accumulator.branch = accumulator.branch || sale.branch || getReceivablesBranch();
  accumulator.pendingAmount = roundMoney(accumulator.pendingAmount + roundMoney(sale.pendingAmount || 0));
  accumulator.paidAmount = roundMoney(accumulator.paidAmount + roundMoney(sale.paidAmount || 0));
  accumulator.openSalesCount += 1;
  if (sale.ticketNumber) {
    accumulator.ticketNumbers = [...new Set([...(accumulator.ticketNumbers || []), sale.ticketNumber])];
  }
  if (!accumulator.oldestSaleAt || String(sale.createdAt).localeCompare(String(accumulator.oldestSaleAt)) < 0) {
    accumulator.oldestSaleAt = sale.createdAt;
  }
  const activityAt = sale.lastPaymentAt || sale.createdAt;
  if (!accumulator.latestActivityAt || String(activityAt).localeCompare(String(accumulator.latestActivityAt)) > 0) {
    accumulator.latestActivityAt = activityAt;
  }
  if (options.localSale === true) {
    accumulator.localSaleCount += 1;
  }
}

function applyReceivablePaymentDeltaToAccumulator(accumulator, paymentRecord) {
  accumulator.paidAmount = roundMoney(accumulator.paidAmount + roundMoney(paymentRecord.amount || 0));
  accumulator.pendingAmount = roundMoney(Math.max(0, accumulator.pendingAmount - roundMoney(paymentRecord.amount || 0)));
  if (!accumulator.latestActivityAt || String(paymentRecord.createdAt || "").localeCompare(String(accumulator.latestActivityAt)) > 0) {
    accumulator.latestActivityAt = paymentRecord.createdAt || accumulator.latestActivityAt;
  }
  accumulator.localPaymentCount += 1;
}

function buildOfflineReceivableSaleView(record, options = {}) {
  const payload = getOfflineSalePayload(record) || {};
  if (!isCreditPaymentMethod(record?.paymentMethod || payload.paymentMethod || "")) {
    return null;
  }

  const customerName = String(record?.customerName || payload.customerName || "").trim();
  if (!customerName) {
    return null;
  }

  const total = roundMoney(record?.total ?? payload.total ?? 0);
  const receivedAmount = roundMoney(record?.receivedAmount ?? payload.receivedAmount ?? 0);
  const paidAmount = roundMoney(receivedAmount);
  const pendingAmount = roundMoney(Math.max(0, total - paidAmount));
  if (pendingAmount <= 0) {
    return null;
  }

  const branch = String(record?.branch || payload.branch || getReceivablesBranch()).trim();
  const customerKey = resolveReceivableCustomerViewKey({
    branch,
    customerName,
    customerKey: record?.customerKey || payload.customerKey || "",
    customerMap: options.customerMap,
    preferredCustomer: options.preferredCustomer,
  });
  const displayState = getOfflineSaleDisplayState(record);

  return normalizeReceivableSaleView({
    saleId: null,
    id: null,
    clientSaleId: String(record?.clientSaleId || payload.clientSaleId || ""),
    ticketNumber: String(record?.localTicketNumber || payload.ticketNumber || "OFF"),
    shift: record?.shift || payload.shift || "",
    cashier: record?.cashier || payload.cashier || "",
    branch,
    paymentMethod: record?.paymentMethod || payload.paymentMethod || "Fiado",
    customerName,
    customerKey,
    receivedPaymentMethod: record?.receivedPaymentMethod || payload.receivedPaymentMethod || "",
    total,
    receivedAmount,
    laterPaymentsTotal: 0,
    paidAmount,
    pendingAmount,
    notes: record?.notes || payload.notes || "",
    createdAt: record?.createdAt || new Date().toISOString(),
    lastPaymentAt: null,
    payments: [],
  }, {
    saleRef: `local:${String(record?.clientSaleId || payload.clientSaleId || "")}`,
    isLocalOnly: true,
    syncStatus: record?.status || "pending",
    syncNote: displayState.note,
  });
}

function saleMatchesReceivableCustomer(sale, customer) {
  if (!sale || !customer) {
    return false;
  }

  const normalizedCustomerKey = String(customer.customerKey || "").trim();
  if (normalizedCustomerKey) {
    const saleCustomerKey = resolveReceivableCustomerViewKey({
      branch: sale.branch,
      customerName: sale.customerName,
      customerKey: sale.customerKey,
      preferredCustomer: customer,
    });
    if (saleCustomerKey === normalizedCustomerKey) {
      return true;
    }
  }

  return normalizeSearchText(sale.customerName) === normalizeSearchText(customer.customerName);
}

function getRelevantOfflineReceivableSales(branch = getReceivablesBranch(), options = {}) {
  const normalizedBranch = String(branch || getReceivablesBranch()).trim();
  return getOutstandingOfflineSales()
    .filter((record) =>
      isCreditPaymentMethod(record?.paymentMethod)
      && (!normalizedBranch || String(record?.branch || "").trim() === normalizedBranch),
    )
    .map((record) => buildOfflineReceivableSaleView(record, options))
    .filter(Boolean);
}

function getRelevantOfflineReceivablePayments(branch = getReceivablesBranch()) {
  const normalizedBranch = String(branch || getReceivablesBranch()).trim();
  return getOutstandingOfflineReceivablePayments()
    .filter((record) => !normalizedBranch || String(record?.branch || "").trim() === normalizedBranch)
    .map((record) => normalizeOfflineReceivablePaymentRecord(record))
    .filter((record) => record.clientPaymentId && roundMoney(record.amount || 0) > 0);
}

function buildReceivableCustomerMap(baseCustomers = [], branch = getReceivablesBranch()) {
  const customerMap = new Map();
  (Array.isArray(baseCustomers) ? baseCustomers : []).forEach((customer) => {
    const normalizedCustomer = normalizeReceivableCustomerView({
      ...customer,
      branch: customer?.branch || branch,
    });
    if (!normalizedCustomer.customerName) {
      return;
    }

    const entryKey = resolveReceivableCustomerViewKey({
      branch: normalizedCustomer.branch,
      customerName: normalizedCustomer.customerName,
      customerKey: normalizedCustomer.customerKey,
    });
    customerMap.set(entryKey, {
      ...normalizedCustomer,
      customerKey: entryKey,
      ticketNumbers: Array.isArray(normalizedCustomer.ticketNumbers)
        ? normalizedCustomer.ticketNumbers
        : [],
      localSaleCount: 0,
      localPaymentCount: 0,
    });
  });

  return customerMap;
}

function buildMergedReceivableCustomers(baseCustomers = [], options = {}) {
  const branch = String(options.branch || getReceivablesBranch()).trim();
  const normalizedSearch = normalizeSearchText(options.search || "");
  const customerMap = buildReceivableCustomerMap(baseCustomers, branch);
  const offlineSales = getRelevantOfflineReceivableSales(branch, { customerMap });
  const offlinePayments = getRelevantOfflineReceivablePayments(branch);

  offlineSales.forEach((sale) => {
    const entryKey = resolveReceivableCustomerViewKey({
      branch: sale.branch,
      customerName: sale.customerName,
      customerKey: sale.customerKey,
      customerMap,
    });
    const current = customerMap.get(entryKey) || createReceivableCustomerAccumulator({
      customerKey: entryKey,
      customerName: sale.customerName,
      branch: sale.branch,
      oldestSaleAt: sale.createdAt,
      latestActivityAt: sale.createdAt,
    });
    current.customerKey = entryKey;
    updateReceivableCustomerAccumulatorFromSale(current, sale, { localSale: true });
    customerMap.set(entryKey, current);
  });

  offlinePayments.forEach((paymentRecord) => {
    const entryKey = resolveReceivableCustomerViewKey({
      branch: paymentRecord.branch,
      customerName: paymentRecord.customerName,
      customerKey: paymentRecord.customerKey,
      customerMap,
    });
    if (!customerMap.has(entryKey)) {
      return;
    }

    const current = customerMap.get(entryKey);
    applyReceivablePaymentDeltaToAccumulator(current, paymentRecord);
    customerMap.set(entryKey, current);
  });

  return [...customerMap.values()]
    .filter((customer) => roundMoney(customer.pendingAmount || 0) > 0)
    .filter((customer) => !normalizedSearch || getReceivableCustomerSearchBlob(customer).includes(normalizedSearch))
    .sort((left, right) => {
      if (right.pendingAmount !== left.pendingAmount) {
        return right.pendingAmount - left.pendingAmount;
      }
      return String(right.latestActivityAt || "").localeCompare(String(left.latestActivityAt || ""));
    });
}

function resolveOfflinePaymentTargetSaleRef(paymentRecord, salesMap = new Map()) {
  const directSaleId = Number(paymentRecord.saleId || paymentRecord.syncedSaleId || 0) || null;
  if (directSaleId && salesMap.has(`sale:${directSaleId}`)) {
    return `sale:${directSaleId}`;
  }

  const linkedClientSaleId = String(paymentRecord.linkedClientSaleId || "").trim();
  if (!linkedClientSaleId) {
    return null;
  }

  if (salesMap.has(`local:${linkedClientSaleId}`)) {
    return `local:${linkedClientSaleId}`;
  }

  const linkedSaleRecord = getOfflineSaleRecordByClientSaleId(linkedClientSaleId);
  const syncedSaleId = Number(linkedSaleRecord?.syncedSaleId || 0) || null;
  if (syncedSaleId && salesMap.has(`sale:${syncedSaleId}`)) {
    return `sale:${syncedSaleId}`;
  }

  return null;
}

function buildMergedReceivableCustomerDetail(baseCustomer = null, options = {}) {
  const branch = String(options.branch || getReceivablesBranch()).trim();
  const selectedListCustomer = (Array.isArray(state.receivables?.customers) ? state.receivables.customers : [])
    .find((customer) => String(customer.customerKey || "") === String(options.customerKey || ""))
    || null;
  const preferredCustomer = normalizeReceivableCustomerView(baseCustomer || selectedListCustomer || {});
  const salesMap = new Map();

  (Array.isArray(baseCustomer?.sales) ? baseCustomer.sales : []).forEach((sale) => {
    const normalizedSale = normalizeReceivableSaleView({
      ...sale,
      customerName: sale?.customerName || preferredCustomer.customerName,
      customerKey: sale?.customerKey || preferredCustomer.customerKey,
      branch: sale?.branch || preferredCustomer.branch || branch,
    });
    salesMap.set(normalizedSale.saleRef, normalizedSale);
  });

  const offlineSales = getRelevantOfflineReceivableSales(branch, {
    preferredCustomer,
  }).filter((sale) => saleMatchesReceivableCustomer(sale, preferredCustomer));

  offlineSales.forEach((sale) => {
    salesMap.set(sale.saleRef, sale);
  });

  const offlinePayments = getRelevantOfflineReceivablePayments(branch).filter((paymentRecord) => {
    if (preferredCustomer.customerKey) {
      const resolvedKey = resolveReceivableCustomerViewKey({
        branch: paymentRecord.branch,
        customerName: paymentRecord.customerName,
        customerKey: paymentRecord.customerKey,
        preferredCustomer,
      });
      return resolvedKey === preferredCustomer.customerKey;
    }

    return normalizeSearchText(paymentRecord.customerName) === normalizeSearchText(preferredCustomer.customerName);
  });

  offlinePayments.forEach((paymentRecord) => {
    const targetSaleRef = resolveOfflinePaymentTargetSaleRef(paymentRecord, salesMap);
    if (!targetSaleRef || !salesMap.has(targetSaleRef)) {
      return;
    }

    const currentSale = salesMap.get(targetSaleRef);
    const paymentLine = normalizeReceivablePaymentLine(paymentRecord, {
      localOnly: true,
      pendingSync: true,
    });
    const nextSale = normalizeReceivableSaleView({
      ...currentSale,
      laterPaymentsTotal: roundMoney(currentSale.laterPaymentsTotal + paymentLine.amount),
      paidAmount: roundMoney(currentSale.paidAmount + paymentLine.amount),
      pendingAmount: roundMoney(Math.max(0, currentSale.pendingAmount - paymentLine.amount)),
      lastPaymentAt:
        !currentSale.lastPaymentAt || String(paymentLine.createdAt).localeCompare(String(currentSale.lastPaymentAt)) > 0
          ? paymentLine.createdAt
          : currentSale.lastPaymentAt,
      pendingSyncPaymentsCount: Number(currentSale.pendingSyncPaymentsCount || 0) + 1,
      payments: [...(Array.isArray(currentSale.payments) ? currentSale.payments : []), paymentLine]
        .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))),
    }, {
      saleRef: currentSale.saleRef,
      isLocalOnly: currentSale.isLocalOnly,
      syncStatus: currentSale.syncStatus,
      syncNote: currentSale.syncNote,
      pendingSyncPaymentsCount: Number(currentSale.pendingSyncPaymentsCount || 0) + 1,
    });
    salesMap.set(targetSaleRef, nextSale);
  });

  const sales = [...salesMap.values()]
    .filter((sale) => roundMoney(sale.pendingAmount || 0) > 0)
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));

  if (sales.length === 0) {
    return null;
  }

  const customerName = preferredCustomer.customerName || sales[0].customerName;
  const customerKey = preferredCustomer.customerKey
    || resolveReceivableCustomerViewKey({
      branch,
      customerName,
      customerKey: sales[0].customerKey,
      preferredCustomer,
    });
  const latestActivityAt = sales.reduce((latest, sale) => {
    const current = sale.lastPaymentAt || sale.createdAt;
    return !latest || String(current).localeCompare(String(latest)) > 0 ? current : latest;
  }, "");

  return normalizeReceivableCustomerView({
    customerKey,
    customerName,
    branch: preferredCustomer.branch || sales[0].branch || branch,
    pendingAmount: roundMoney(sales.reduce((sum, sale) => sum + roundMoney(sale.pendingAmount || 0), 0)),
    paidAmount: roundMoney(sales.reduce((sum, sale) => sum + roundMoney(sale.paidAmount || 0), 0)),
    openSalesCount: sales.length,
    oldestSaleAt: sales[0].createdAt,
    latestActivityAt,
    sales,
    ticketNumbers: sales.map((sale) => sale.ticketNumber).filter(Boolean),
    localSaleCount: sales.filter((sale) => sale.isLocalOnly).length,
    localPaymentCount: sales.reduce(
      (sum, sale) => sum + Math.max(0, Number(sale.pendingSyncPaymentsCount || 0)),
      0,
    ),
  });
}

function getReceivablesStatusMessage() {
  const branch = getReceivablesBranch();
  const cacheBranch = getReceivablesCacheBranch(branch);
  const operationSummary = getOfflineOperationStatusSummary();
  const pendingReceivableOps = Math.max(
    0,
    Number(operationSummary.receivablePayments?.outstanding || 0),
  );
  const pendingLocalCreditSales = getRelevantOfflineReceivableSales(branch).length;

  if (!state.online) {
    if (cacheBranch.updatedAt) {
      return `Modo offline: viendo cartera guardada en este dispositivo desde ${dateTimeFormatter.format(new Date(cacheBranch.updatedAt))}.`;
    }

    if (pendingLocalCreditSales > 0 || pendingReceivableOps > 0) {
      return "Modo offline: esta cartera se sostiene con tickets y abonos guardados localmente.";
    }

    return "Modo offline: esta sucursal aun no tiene cartera guardada en el dispositivo.";
  }

  if (pendingLocalCreditSales > 0 || pendingReceivableOps > 0) {
    const parts = [];
    if (pendingLocalCreditSales > 0) {
      parts.push(`${pendingLocalCreditSales} ticket(s) fiado(s) locales`);
    }
    if (pendingReceivableOps > 0) {
      parts.push(`${pendingReceivableOps} abono(s) pendiente(s)`);
    }
    return `Hay movimientos locales en espera de sincronizar: ${parts.join(" y ")}.`;
  }

  return "";
}

function buildReceivablesStatusMarkup() {
  const message = getReceivablesStatusMessage();
  if (!message) {
    return "";
  }

  return `
    <div class="receivables-status-banner">
      <strong>${state.online ? "Pendiente de sync" : "Modo offline"}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function formatReceivableStatementDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date);
}

function buildReceivableStatementText(customer = state.receivables.detailCustomer) {
  if (!customer) {
    return "";
  }

  const sales = Array.isArray(customer.sales) ? customer.sales : [];
  const lines = [
    `Estado de cuenta - ${getStoreName()}`,
    `Cliente: ${customer.customerName || "Cliente"}`,
    `Sucursal: ${customer.branch || getReceivablesBranch()}`,
    `Emitido: ${formatReceivableStatementDate(new Date())}`,
    "",
    `Pendiente: ${formatCurrency(customer.pendingAmount || 0)}`,
    `Pagado acumulado: ${formatCurrency(customer.paidAmount || 0)}`,
    `Tickets abiertos: ${customer.openSalesCount || sales.length || 0}`,
  ];

  if (customer.localSaleCount > 0 || customer.localPaymentCount > 0 || !state.online) {
    const localNotes = [];
    if (!state.online) {
      localNotes.push("generado con datos guardados en este dispositivo");
    }
    if (customer.localSaleCount > 0) {
      localNotes.push(`${customer.localSaleCount} ticket(s) offline`);
    }
    if (customer.localPaymentCount > 0) {
      localNotes.push(`${customer.localPaymentCount} abono(s) pendiente(s) de sincronizar`);
    }
    lines.push(`Nota: ${localNotes.join("; ")}.`);
  }

  if (sales.length > 0) {
    lines.push("", "Detalle:");
  }

  sales.forEach((sale) => {
    const saleDate = formatReceivableStatementDate(sale.createdAt);
    const saleTags = [];
    if (sale.isLocalOnly) {
      saleTags.push("offline");
    }
    if (sale.pendingSyncPaymentsCount > 0) {
      saleTags.push(`${sale.pendingSyncPaymentsCount} abono(s) pendiente(s)`);
    }

    lines.push(
      `- ${sale.ticketNumber || "Ticket"}${saleDate ? ` | ${saleDate}` : ""}`,
      `  Total ${formatCurrency(sale.total || 0)} | Pagado ${formatCurrency(sale.paidAmount || 0)} | Pendiente ${formatCurrency(sale.pendingAmount || 0)}`,
    );

    if (saleTags.length > 0) {
      lines.push(`  Estado: ${saleTags.join(", ")}`);
    }
    if (sale.notes) {
      lines.push(`  Nota: ${sale.notes}`);
    }
    if (Array.isArray(sale.payments) && sale.payments.length > 0) {
      sale.payments.forEach((payment) => {
        const paymentDate = payment.pendingSync ? "abono offline" : formatReceivableStatementDate(payment.createdAt);
        lines.push(
          `  Abono: ${paymentDate || "sin fecha"} | ${formatCurrency(payment.amount || 0)} | ${payment.paymentMethod || "Efectivo"}${payment.pendingSync ? " | pendiente" : ""}`,
        );
      });
    }
  });

  lines.push("", `Total pendiente: ${formatCurrency(customer.pendingAmount || 0)}`);
  return lines.join("\n");
}

function buildReceivableStatementPrintHtml(customer = state.receivables.detailCustomer) {
  const statementText = buildReceivableStatementText(customer);
  const customerName = customer?.customerName || "Cliente";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Estado de cuenta - ${escapeHtml(customerName)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body {
      width: 72mm;
      margin: 0;
      color: #111;
      font-family: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      line-height: 1.35;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @media print {
      button { display: none; }
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(statementText)}</pre>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`;
}

function printReceivableStatement(customer = state.receivables.detailCustomer) {
  if (!customer) {
    showToast("Selecciona un cliente para imprimir su estado de cuenta.", "error");
    return false;
  }

  if (typeof window === "undefined" || typeof window.open !== "function") {
    showToast("Este navegador no permite abrir la impresion.", "error");
    return false;
  }

  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow || !printWindow.document) {
    showToast("Permite ventanas emergentes para imprimir el estado de cuenta.", "error");
    return false;
  }

  printWindow.document.open();
  printWindow.document.write(buildReceivableStatementPrintHtml(customer));
  printWindow.document.close();
  showToast("Estado de cuenta listo para imprimir.", "success");
  return true;
}

function shareReceivableStatementViaWhatsApp(customer = state.receivables.detailCustomer) {
  if (!customer) {
    showToast("Selecciona un cliente para compartir su estado de cuenta.", "error");
    return false;
  }

  const statementText = buildReceivableStatementText(customer);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(statementText)}`;
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    showToast("Estado de cuenta abierto para enviar por WhatsApp.", "success");
    return true;
  }

  if (typeof window !== "undefined" && window.location) {
    window.location.href = whatsappUrl;
    return true;
  }

  showToast("No pude abrir WhatsApp en este navegador.", "error");
  return false;
}

function resetReceivablePaymentDraft() {
  state.receivables.paymentLoading = false;
  state.receivables.paymentSaleId = null;
  state.receivables.paymentAmount = "";
  state.receivables.paymentMethod = "Efectivo";
  state.receivables.paymentNote = "";
}

function clearReceivablesSessionChange() {
  state.receivables.loading = false;
  state.receivables.search = "";
  state.receivables.customers = [];
  state.receivables.source = "idle";
  state.receivables.selectedCustomerKey = "";
  state.receivables.detailLoading = false;
  state.receivables.detailCustomer = null;
  state.receivables.detailSource = "idle";
  resetReceivablePaymentDraft();
  closeReceivablesModal();
  closeReceivablePaymentModal();
}

function getCurrentReceivableSale() {
  const detailCustomer = state.receivables.detailCustomer;
  if (!detailCustomer || !Array.isArray(detailCustomer.sales)) {
    return null;
  }

  return detailCustomer.sales.find(
    (sale) => getReceivableSaleRef(sale) === String(state.receivables.paymentSaleId || ""),
  ) || null;
}

function renderReceivablesModal() {
  if (!refs.receivablesModal || !refs.receivablesCustomerList || !refs.receivablesCustomerDetail) {
    return;
  }

  const routeCompact = isRouteModeEnabled();
  const statusMarkup = buildReceivablesStatusMarkup();

  if (refs.receivablesSearch && refs.receivablesSearch.value !== state.receivables.search) {
    refs.receivablesSearch.value = state.receivables.search;
  }

  if (!state.cashier.authenticated) {
    refs.receivablesCustomerList.innerHTML = `
      <div class="empty-state">
        Inicia sesion de cajero para consultar la cartera.
      </div>
    `;
    refs.receivablesCustomerDetail.innerHTML = `
      <div class="empty-state">
        La cartera y los abonos se registran por sucursal y cajero activo.
      </div>
    `;
    return;
  }

  if (state.receivables.loading) {
    refs.receivablesCustomerList.innerHTML = `
      ${statusMarkup}
      <div class="empty-state">
        Cargando cartera pendiente...
      </div>
    `;
  } else if (state.receivables.customers.length === 0) {
    refs.receivablesCustomerList.innerHTML = `
      ${statusMarkup}
      <div class="empty-state">
        ${state.receivables.search
          ? "No encontre clientes o tickets con ese texto."
          : state.online
            ? "No hay clientes con saldo pendiente en esta sucursal."
            : "No hay cartera guardada localmente para esta sucursal."}
      </div>
    `;
  } else {
    refs.receivablesCustomerList.innerHTML = `
      ${statusMarkup}
      ${state.receivables.customers
        .map((customer) => {
          const localSummary = [];
          if (customer.localSaleCount > 0) {
            localSummary.push(`${customer.localSaleCount} ticket(s) offline`);
          }
          if (customer.localPaymentCount > 0) {
            localSummary.push(`${customer.localPaymentCount} abono(s) locales`);
          }
          return `
            <button
              class="admin-record-item ${customer.customerKey === state.receivables.selectedCustomerKey ? "active" : ""}"
              data-action="select-receivable-customer"
              data-customer-key="${escapeHtml(customer.customerKey)}"
              type="button"
            >
              <div class="admin-record-item-head">
                <strong>${escapeHtml(customer.customerName)}</strong>
                <span class="small-pill">${formatCurrency(customer.pendingAmount)}</span>
              </div>
              <p>${customer.openSalesCount} ticket(s) abierto(s) - Pagado ${formatCurrency(customer.paidAmount || 0)}</p>
              ${localSummary.length > 0 ? `<p>${escapeHtml(localSummary.join(" - "))}</p>` : ""}
              ${routeCompact ? "" : `<p>Ultima actividad ${escapeHtml(dateTimeFormatter.format(new Date(customer.latestActivityAt || customer.oldestSaleAt || Date.now())))}</p>`}
            </button>
          `;
        })
        .join("")}
    `;
  }

  if (state.receivables.detailLoading) {
    refs.receivablesCustomerDetail.innerHTML = `
      ${statusMarkup}
      <div class="empty-state">
        Cargando detalle del cliente...
      </div>
    `;
    return;
  }

  const customer = state.receivables.detailCustomer;
  if (!customer) {
    refs.receivablesCustomerDetail.innerHTML = `
      ${statusMarkup}
      <div class="empty-state">
        ${state.online
          ? "Selecciona un cliente para ver sus tickets fiados y registrar abonos."
          : "Selecciona un cliente con detalle guardado o un ticket offline para registrar abonos."}
      </div>
    `;
    return;
  }

  const summaryMarkup = routeCompact
    ? `
      <div class="receivables-compact-summary">
        <span class="small-pill">Pendiente ${formatCurrency(customer.pendingAmount || 0)}</span>
        <span class="small-pill">Pagado ${formatCurrency(customer.paidAmount || 0)}</span>
        <span class="small-pill">${customer.openSalesCount || 0} ticket(s)</span>
      </div>
    `
    : `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Pendiente</span>
          <strong>${formatCurrency(customer.pendingAmount || 0)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Pagado acumulado</span>
          <strong>${formatCurrency(customer.paidAmount || 0)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Tickets abiertos</span>
          <strong>${customer.openSalesCount || 0}</strong>
        </article>
      </div>
    `;

  refs.receivablesCustomerDetail.innerHTML = `
    <article class="receivables-summary-card">
      <h4>${escapeHtml(customer.customerName)}</h4>
      ${summaryMarkup}
      <div class="receivables-statement-actions">
        <button class="secondary-button compact-button" data-action="print-receivable-statement" type="button">
          Imprimir estado
        </button>
        <button class="ghost-button compact-button" data-action="share-receivable-statement" type="button">
          WhatsApp
        </button>
      </div>
      <div class="admin-record-list">
        ${(customer.sales || [])
          .map((sale) => `
            <article class="admin-record-item">
              <div class="admin-record-item-head">
                <div>
                  <strong>${escapeHtml(sale.ticketNumber)}</strong>
                  <p>${escapeHtml(sale.cashier)} - ${escapeHtml(sale.shift)}${routeCompact ? "" : ` - ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}`}</p>
                </div>
                <div class="receivable-sale-head-tags">
                  ${sale.isLocalOnly ? `<span class="small-pill">Offline</span>` : ""}
                  ${sale.pendingSyncPaymentsCount > 0 ? `<span class="small-pill">${sale.pendingSyncPaymentsCount} abono(s) pendientes</span>` : ""}
                  <span class="small-pill">${formatCurrency(sale.pendingAmount || 0)}</span>
                </div>
              </div>
              <p>Total ${formatCurrency(sale.total || 0)} - Abono inicial ${formatCurrency(sale.receivedAmount || 0)} - Posteriores ${formatCurrency(sale.laterPaymentsTotal || 0)}</p>
              ${sale.notes ? `<p>${escapeHtml(sale.notes)}</p>` : ""}
              ${sale.syncNote ? `<p>${escapeHtml(sale.syncNote)}</p>` : ""}
              ${(sale.payments || []).length ? `
                <div class="receivable-sale-payments">
                  ${(sale.payments || [])
                    .map((payment) => `
                      <div class="receivable-sale-payment-line ${payment.pendingSync ? "is-pending" : ""}">
                        <span>${payment.pendingSync ? "Abono offline" : escapeHtml(dateTimeFormatter.format(new Date(payment.createdAt)))}</span>
                        <strong>${formatCurrency(payment.amount || 0)} - ${escapeHtml(payment.paymentMethod || "Efectivo")}${payment.pendingSync ? " - pendiente" : ""}</strong>
                      </div>
                    `)
                    .join("")}
                </div>
              ` : ""}
              <div class="admin-record-actions">
                <button
                  class="primary-button compact-button"
                  data-action="open-receivable-payment"
                  data-sale-ref="${escapeHtml(sale.saleRef)}"
                  type="button"
                >
                  Registrar abono
                </button>
              </div>
            </article>
          `)
          .join("")}
      </div>
    </article>
  `;
}

function renderReceivablePaymentModal() {
  if (
    !refs.receivablePaymentModal
    || !refs.receivablePaymentTitle
    || !refs.receivablePaymentMeta
    || !refs.receivablePaymentSummary
    || !refs.receivablePaymentAmount
    || !refs.receivablePaymentMethod
    || !refs.receivablePaymentNote
    || !refs.saveReceivablePaymentButton
  ) {
    return;
  }

  const sale = getCurrentReceivableSale();
  if (!sale) {
    refs.receivablePaymentTitle.textContent = "Abono";
    refs.receivablePaymentMeta.textContent = "";
    refs.receivablePaymentSummary.innerHTML = `
      <div class="empty-state">
        Selecciona un ticket fiado para registrar el abono.
      </div>
    `;
    refs.saveReceivablePaymentButton.disabled = true;
    return;
  }

  refs.receivablePaymentTitle.textContent = sale.ticketNumber;
  refs.receivablePaymentMeta.textContent =
    `${sale.customerName} - Pendiente ${formatCurrency(sale.pendingAmount || 0)}`;
  refs.receivablePaymentSummary.innerHTML = `
    <div class="detail-stat-grid">
      <article class="detail-stat-card">
        <span>Total venta</span>
        <strong>${formatCurrency(sale.total || 0)}</strong>
      </article>
      <article class="detail-stat-card">
        <span>Pagado acumulado</span>
        <strong>${formatCurrency(sale.paidAmount || 0)}</strong>
      </article>
      <article class="detail-stat-card">
        <span>Pendiente</span>
        <strong>${formatCurrency(sale.pendingAmount || 0)}</strong>
      </article>
    </div>
    ${sale.isLocalOnly ? `
      <div class="receivables-status-banner">
        <strong>Ticket offline</strong>
        <p>Este abono quedara ligado primero al ticket local y se sincronizara cuando ese ticket llegue al servidor.</p>
      </div>
    ` : ""}
  `;
  refs.receivablePaymentAmount.value = state.receivables.paymentAmount;
  refs.receivablePaymentMethod.value = state.receivables.paymentMethod;
  refs.receivablePaymentNote.value = state.receivables.paymentNote;
  refs.saveReceivablePaymentButton.textContent = state.receivables.paymentLoading
    ? "Guardando..."
    : state.online
      ? "Guardar abono"
      : "Guardar offline";
  refs.saveReceivablePaymentButton.disabled = state.receivables.paymentLoading || roundMoney(sale.pendingAmount || 0) <= 0;
  refs.receivablePaymentAmount.disabled = state.receivables.paymentLoading;
  refs.receivablePaymentMethod.disabled = state.receivables.paymentLoading;
  refs.receivablePaymentNote.disabled = state.receivables.paymentLoading;
}

async function loadReceivableCustomerDetail(customerKey, options = {}) {
  const safeCustomerKey = String(customerKey || "").trim();
  if (!safeCustomerKey || !state.cashier.authenticated) {
    state.receivables.detailCustomer = null;
    state.receivables.detailLoading = false;
    state.receivables.detailSource = "idle";
    renderReceivablesModal();
    return null;
  }

  if (!options.silent) {
    state.receivables.detailLoading = true;
    renderReceivablesModal();
  }

  const branch = getReceivablesBranch();
  let baseCustomer = getCachedReceivableCustomerDetail(branch, safeCustomerKey);
  let detailSource = baseCustomer ? "cache" : "local";
  let requestError = null;

  if (state.online) {
    try {
      const response = await requestCashierJson(
        `/api/receivables/customer/${encodeURIComponent(safeCustomerKey)}`,
        { timeoutMs: 6000 },
      );
      baseCustomer = response.customer || null;
      if (baseCustomer) {
        upsertReceivablesCacheCustomerDetail(branch, baseCustomer);
        detailSource = "live";
      }
    } catch (error) {
      requestError = error;
    }
  }

  const mergedDetail = buildMergedReceivableCustomerDetail(baseCustomer, {
    branch,
    customerKey: safeCustomerKey,
  });
  state.receivables.detailCustomer = mergedDetail;
  state.receivables.detailSource = mergedDetail ? detailSource : "idle";

  if (!mergedDetail && requestError && !options.silent && requestError.statusCode !== 404) {
    showToast(requestError.message, "error");
  }

  if (!mergedDetail && requestError?.statusCode === 404 && !options.silent && !baseCustomer && state.online) {
    showToast("No encontre saldo pendiente para ese cliente.", "error");
  }

  state.receivables.detailLoading = false;
  renderReceivablesModal();
  renderReceivablePaymentModal();
  return mergedDetail;
}

async function loadReceivables(options = {}) {
  if (!state.cashier.authenticated) {
    state.receivables.customers = [];
    state.receivables.detailCustomer = null;
    state.receivables.loading = false;
    state.receivables.detailLoading = false;
    state.receivables.source = "idle";
    state.receivables.detailSource = "idle";
    renderReceivablesModal();
    return [];
  }

  if (!options.silent) {
    state.receivables.loading = true;
    renderReceivablesModal();
  }

  const branch = getReceivablesBranch();
  let baseCustomers = getCachedReceivableCustomers(branch);
  let source = baseCustomers.length > 0 ? "cache" : "local";
  let requestError = null;

  if (state.online) {
    try {
      const response = await requestCashierJson(
        `/api/receivables?search=${encodeURIComponent(state.receivables.search || "")}`,
        { timeoutMs: 6000 },
      );
      baseCustomers = Array.isArray(response.customers) ? response.customers : [];
      if (!state.receivables.search) {
        upsertReceivablesCacheCustomers(branch, baseCustomers);
      }
      source = "live";
    } catch (error) {
      requestError = error;
    }
  }

  state.receivables.customers = buildMergedReceivableCustomers(baseCustomers, {
    branch,
    search: state.receivables.search,
  });
  state.receivables.source = state.receivables.customers.length > 0 ? source : source === "live" ? "live" : "local";

  const selectedStillExists = state.receivables.customers.some(
    (customer) => customer.customerKey === state.receivables.selectedCustomerKey,
  );
  if (!selectedStillExists) {
    state.receivables.selectedCustomerKey = state.receivables.customers[0]?.customerKey || "";
  }

  if (options.skipDetail === true) {
    if (
      state.receivables.detailCustomer
      && state.receivables.detailCustomer.customerKey !== state.receivables.selectedCustomerKey
    ) {
      state.receivables.detailCustomer = null;
      state.receivables.detailSource = "idle";
    }
  } else if (state.receivables.selectedCustomerKey) {
    await loadReceivableCustomerDetail(state.receivables.selectedCustomerKey, {
      silent: true,
    });
  } else {
    state.receivables.detailCustomer = null;
    state.receivables.detailSource = "idle";
  }

  if (requestError && !options.silent && state.online && state.receivables.customers.length === 0) {
    showToast(requestError.message, "error");
  }

  state.receivables.loading = false;
  renderReceivablesModal();
  renderReceivablePaymentModal();
  return state.receivables.customers;
}

function openReceivablesModal() {
  if (!requireCashierSession("Inicia sesion de cajero para consultar la cartera.")) {
    return;
  }

  setModalOpen(refs.receivablesModal, true);
  renderReceivablesModal();
  window.requestAnimationFrame(() => {
    refs.receivablesSearch?.focus();
    refs.receivablesSearch?.select();
  });
  void loadReceivables();
}

function closeReceivablesModal() {
  if (!refs.receivablesModal) {
    return;
  }
  setModalOpen(refs.receivablesModal, false);
}

function openReceivablePaymentModal(saleRef) {
  if (!requireCashierSession("Inicia sesion de cajero para registrar abonos.")) {
    return;
  }

  if (state.register.summary?.cashierLocked) {
    showToast("Este cajero ya hizo corte final hoy y no puede registrar nuevos abonos.", "error");
    return;
  }

  const sale = (state.receivables.detailCustomer?.sales || []).find(
    (entry) => getReceivableSaleRef(entry) === String(saleRef || ""),
  );
  if (!sale) {
    showToast("No pude encontrar ese ticket fiado.", "error");
    return;
  }

  state.receivables.paymentSaleId = getReceivableSaleRef(sale);
  state.receivables.paymentAmount = String(roundMoney(sale.pendingAmount || 0).toFixed(2));
  state.receivables.paymentMethod = "Efectivo";
  state.receivables.paymentNote = "";
  renderReceivablePaymentModal();
  setModalOpen(refs.receivablePaymentModal, true);
  window.requestAnimationFrame(() => {
    refs.receivablePaymentAmount?.focus();
    refs.receivablePaymentAmount?.select();
  });
}

function closeReceivablePaymentModal() {
  resetReceivablePaymentDraft();
  if (refs.receivablePaymentModal) {
    setModalOpen(refs.receivablePaymentModal, false);
  }
  renderReceivablePaymentModal();
}

async function submitReceivablePayment() {
  if (!requireCashierSession("Inicia sesion de cajero para registrar abonos.")) {
    return;
  }

  const sale = getCurrentReceivableSale();
  if (!sale) {
    showToast("Selecciona un ticket fiado antes de guardar el abono.", "error");
    return;
  }

  const amount = roundMoney(state.receivables.paymentAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Captura un abono valido.", "error");
    return;
  }
  if (amount > roundMoney(sale.pendingAmount || 0)) {
    showToast("El abono no puede exceder el saldo pendiente del ticket.", "error");
    return;
  }

  const saleId = Number(sale.saleId || sale.id || 0) || null;
  const linkedClientSaleId = sale.isLocalOnly ? String(sale.clientSaleId || "").trim() : "";
  if (!saleId && !linkedClientSaleId) {
    showToast("No pude identificar el ticket que quieres abonar.", "error");
    return;
  }

  const payload = {
    clientPaymentId: createClientEventId("receivable-payment"),
    saleId,
    linkedClientSaleId,
    ticketNumber: sale.ticketNumber || "",
    shift: refs.shiftSelect?.value || state.register.summary?.shift || sale.shift || "Tarde",
    cashier: state.cashier.name || sale.cashier || "Mostrador",
    branch: getReceivablesBranch(),
    customerName: sale.customerName || state.receivables.detailCustomer?.customerName || "",
    customerKey: state.receivables.detailCustomer?.customerKey || sale.customerKey || "",
    amount,
    paymentMethod: state.receivables.paymentMethod || "Efectivo",
    notes: state.receivables.paymentNote || "",
    createdAt: new Date().toISOString(),
  };

  state.receivables.paymentLoading = true;
  renderReceivablePaymentModal();

  try {
    const response = await requestCashierJson("/api/receivables/payments", {
      method: "POST",
      timeoutMs: 7000,
      queueable: true,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.snapshot) {
      applySnapshot(response.snapshot);
    }
    if (response.customer) {
      upsertReceivablesCacheCustomerDetail(getReceivablesBranch(), response.customer);
    }

    await loadRegisterSummary({ silent: true });
    await loadReceivables({ silent: true });
    closeReceivablePaymentModal();
    showToast(`Abono registrado en ${sale.ticketNumber}.`, "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      registerPendingOfflineReceivablePayment(payload, {
        queueOperationId: error.queuedOperationId || "",
      });
      if (typeof refreshOfflineSalesUi === "function") {
        refreshOfflineSalesUi();
      }
      await loadReceivables({ silent: true });
      closeReceivablePaymentModal();
      showToast(error.message, "info");
    } else {
      showToast(error.message, "error");
    }
  } finally {
    state.receivables.paymentLoading = false;
    renderReceivablePaymentModal();
  }
}

async function refreshReceivablesUi(options = {}) {
  if (!state.cashier.authenticated) {
    renderReceivablesModal();
    renderReceivablePaymentModal();
    return;
  }

  const shouldReload =
    refs.receivablesModal?.classList.contains("open")
    || refs.receivablePaymentModal?.classList.contains("open")
    || state.receivables.selectedCustomerKey;
  if (!shouldReload) {
    return;
  }

  await loadReceivables({ silent: options.silent !== false });
}

function queueReceivablesSearch() {
  if (receivablesSearchTimerId) {
    window.clearTimeout(receivablesSearchTimerId);
  }

  receivablesSearchTimerId = window.setTimeout(() => {
    receivablesSearchTimerId = null;
    void loadReceivables({ silent: true });
  }, 180);
}
