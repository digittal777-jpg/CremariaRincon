function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundStock(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

function roundMetric(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 10) / 10;
}

function estimateSerializedBytes(value) {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size;
  } catch (_error) {
    return 0;
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, toNumber(value, 0));
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${roundMetric(kb)} KB`;
  }

  return `${roundMetric(kb / 1024)} MB`;
}

function formatCurrency(value) {
  return currencyFormatter.format(toNumber(value));
}

function formatQuantity(value) {
  return `${quantityFormatter.format(toNumber(value))}`;
}

function formatProductStock(product) {
  return `${formatQuantity(product.stock)} ${product.unit}`;
}

const productSearchBlobCache = new WeakMap();
const elementMotionTimers = new WeakMap();

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildProductSearchBlob(product) {
  if (!product || typeof product !== "object") {
    return "";
  }

  const source = [
    product.name,
    product.categoryLabel,
    product.category,
    product.unit,
    product.brand,
    product.sku,
    product.barcode,
  ]
    .filter(Boolean)
    .join(" ");
  const cached = productSearchBlobCache.get(product);
  if (cached?.source === source) {
    return cached.blob;
  }

  const blob = normalizeSearchText(source);
  productSearchBlobCache.set(product, { source, blob });
  return blob;
}

function shouldAutoFocusRouteSearch() {
  return isRouteModeEnabled() && !shouldUseRouteMobileUi();
}

function focusRouteSearchInput(options = {}) {
  if (
    typeof window === "undefined"
    || !refs.searchInput
    || !shouldAutoFocusRouteSearch()
  ) {
    return;
  }

  const select = options.select !== false;
  window.requestAnimationFrame(() => {
    if (!refs.searchInput || !shouldAutoFocusRouteSearch()) {
      return;
    }

    refs.searchInput.focus({ preventScroll: true });
    if (select) {
      refs.searchInput.select?.();
    }
  });
}

function focusAndSelectInput(input, options = {}) {
  if (!input) {
    return;
  }

  const runSelection = () => {
    if (!input) {
      return;
    }

    try {
      input.focus({ preventScroll: options.preventScroll !== false });
    } catch (_error) {
      input.focus();
    }

    if (options.select === false) {
      return;
    }

    try {
      input.select?.();
    } catch (_error) {
      // Some mobile numeric-like inputs ignore select().
    }

    if (typeof input.setSelectionRange === "function") {
      try {
        const end = String(input.value ?? "").length;
        input.setSelectionRange(0, end);
      } catch (_error) {
        // Inputs without text selection support can ignore this safely.
      }
    }
  };

  if (typeof window === "undefined" || options.defer === false) {
    runSelection();
    return;
  }

  if (options.preserveGesture === true) {
    // Keep the original tap/click call stack alive so mobile browsers can open the soft keyboard.
    runSelection();
  }

  window.requestAnimationFrame(runSelection);
}

function prefersReducedMotion() {
  return Boolean(
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

function pulseElement(element, className = "is-bumping", options = {}) {
  if (
    !element
    || !element.classList
    || typeof window === "undefined"
    || prefersReducedMotion()
  ) {
    return;
  }

  const activeClass = String(className || "").trim() || "is-bumping";
  const durationMs = Math.max(0, toNumber(options.durationMs, 320));
  const timers = elementMotionTimers.get(element) || {};
  if (timers[activeClass]) {
    window.clearTimeout(timers[activeClass]);
  }

  element.classList.remove(activeClass);
  window.requestAnimationFrame(() => {
    element.classList.add(activeClass);
    timers[activeClass] = window.setTimeout(() => {
      element.classList.remove(activeClass);
      delete timers[activeClass];
    }, durationMs);
    elementMotionTimers.set(element, timers);
  });
}

function getPaymentMethodConfig(value) {
  const safeValue = String(value || "").trim();
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === safeValue)
    || PAYMENT_METHOD_OPTIONS[0];
}

function getReceivedPaymentMethodConfig(value, fallback = "Efectivo") {
  const safeValue = String(value || "").trim();
  const directMatch = RECEIVED_PAYMENT_METHOD_OPTIONS.find((option) => option.value === safeValue);
  if (directMatch) {
    return directMatch;
  }

  const safeFallback = String(fallback || "").trim();
  if (!safeFallback) {
    return null;
  }

  return RECEIVED_PAYMENT_METHOD_OPTIONS.find((option) => option.value === safeFallback)
    || RECEIVED_PAYMENT_METHOD_OPTIONS[0];
}

function normalizeReceivedPaymentMethod(value, fallback = "Efectivo") {
  return getReceivedPaymentMethodConfig(value, fallback)?.value || "";
}

function isCashPaymentMethod(value) {
  return getPaymentMethodConfig(value).kind === "cash";
}

function isCreditPaymentMethod(value) {
  return getPaymentMethodConfig(value).kind === "credit";
}

function getSalePendingAmount(total, receivedAmount, paymentMethod) {
  if (!isCreditPaymentMethod(paymentMethod)) {
    return 0;
  }

  return roundMoney(Math.max(roundMoney(total) - Math.max(roundMoney(receivedAmount), 0), 0));
}

function getSaleReceivedPaymentMethod(paymentMethod, receivedPaymentMethod, receivedAmount = 0) {
  if (isCreditPaymentMethod(paymentMethod)) {
    return roundMoney(receivedAmount) > 0
      ? normalizeReceivedPaymentMethod(receivedPaymentMethod, "Efectivo")
      : "";
  }

  return isCashPaymentMethod(paymentMethod) ? "Efectivo" : getPaymentMethodConfig(paymentMethod).value;
}

function getSalePaymentSummary(sale = {}) {
  const paymentMethod = sale.paymentMethod || "Efectivo";
  const customerName = String(sale.customerName || "").trim();
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
      ? getSalePendingAmount(total, paidAmount, paymentMethod)
      : sale.pendingAmount,
  );
  const receivedMethod = getSaleReceivedPaymentMethod(
    paymentMethod,
    sale.receivedPaymentMethod || "",
    receivedAmount,
  );
  const parts = [paymentMethod];

  if (customerName) {
    parts.push(customerName);
  }

  if (isCreditPaymentMethod(paymentMethod)) {
    if (receivedAmount > 0) {
      parts.push(`Abono inicial ${formatCurrency(receivedAmount)}${receivedMethod ? ` ${receivedMethod}` : ""}`);
    }
    if (laterPaymentsTotal > 0) {
      parts.push(`Posteriores ${formatCurrency(laterPaymentsTotal)}`);
    }
    if (paidAmount > 0 && laterPaymentsTotal > 0) {
      parts.push(`Pagado ${formatCurrency(paidAmount)}`);
    }
    parts.push(`Pendiente ${formatCurrency(pendingAmount)}`);
  }

  return parts.join(" · ");
}

function requiresPaymentCustomer(value) {
  return Boolean(getPaymentMethodConfig(value).requiresCustomer);
}

function getPaymentCustomerFieldLabel(value) {
  return isCreditPaymentMethod(value) ? "Cliente fiado" : "Cliente o referencia";
}

function getPaymentCustomerPlaceholder(value) {
  if (isCreditPaymentMethod(value)) {
    return "Nombre del cliente o familia";
  }

  return "Nombre, banco o referencia";
}

function getPaymentNotePlaceholder(value) {
  if (value === "Transferencia") {
    return "Folio, banco o detalle opcional";
  }
  if (isCreditPaymentMethod(value)) {
    return "Fecha de pago, colonia, abono o nota del fiado";
  }

  return "Nota opcional";
}

function getPaymentContextCopy(value) {
  if (value === "Transferencia") {
    return "La venta suma al total vendido, pero no al efectivo esperado de caja.";
  }
  if (value === "Tarjeta") {
    return "La venta queda registrada como no efectivo y no aumenta el efectivo esperado.";
  }
  if (isCreditPaymentMethod(value)) {
    return "El fiado suma a ventas. Si hoy te pagan una parte, captura el abono y el medio para que caja y pendiente cuadren.";
  }

  return "Captura lo recibido para calcular el cambio del ticket.";
}

function buildPublicSnapshotCacheView(snapshot) {
  const sourceSnapshot =
    snapshot && typeof snapshot === "object" ? snapshot : {};
  const sanitizePublicProduct = (product = {}) => ({
    ...product,
    cost: 0,
    supplierName: "",
    packSize: null,
    stock: 0,
    minStock: 0,
    stockInitialized: false,
    attributes: {},
    status: "capture",
  });
  const sanitizePublicProductList = (products = []) =>
    Array.isArray(products) ? products.map((product) => sanitizePublicProduct(product)) : [];
  const products = sanitizePublicProductList(sourceSnapshot.products);
  const inventoryProducts = sanitizePublicProductList(sourceSnapshot.inventoryProducts);
  const inventoryComparison = Array.isArray(sourceSnapshot.inventoryComparison?.branches)
    ? {
        branches: sourceSnapshot.inventoryComparison.branches.map((branchEntry) => ({
          ...branchEntry,
          products: sanitizePublicProductList(branchEntry?.products),
        })),
      }
    : null;
  const catalogSize = Math.max(
    0,
    Number(sourceSnapshot.summary?.catalogSize || products.length || 0),
  );

  return {
    ...sourceSnapshot,
    auth: {
      role: "guest",
      adminAuthenticated: false,
      cashierAuthenticated: false,
      ownerAuthenticated: false,
      cashier: null,
    },
    products,
    inventoryProducts,
    inventoryComparison,
    lowStock: [],
    recentSales: [],
    recentActivity: [],
    salesByHour: [],
    shiftSummary: [],
    summary: {
      revenueToday: 0,
      ticketsToday: 0,
      averageTicket: 0,
      unitsSoldToday: 0,
      catalogSize,
      inventoryValue: 0,
      lowStockCount: 0,
      topProduct: null,
    },
    adminCapabilities: [],
  };
}

function getOfflineSaleStatusLabel(status) {
  if (status === "synced") {
    return "Sincronizada";
  }

  if (status === "rejected") {
    return "Rechazada";
  }

  if (status === "requires_review") {
    return "Requiere revision";
  }

  return "Pendiente";
}

function getOfflineSaleRecordByClientSaleId(clientSaleId) {
  const safeClientSaleId = String(clientSaleId || "").trim();
  if (!safeClientSaleId) {
    return null;
  }

  return (Array.isArray(state.offlineSales) ? state.offlineSales : []).find(
    (record) => String(record?.clientSaleId || "") === safeClientSaleId,
  ) || null;
}

function isOfflineSaleOutstandingStatus(status) {
  return status !== "synced" && status !== "rejected";
}

function getOutstandingOfflineSales() {
  return (Array.isArray(state.offlineSales) ? state.offlineSales : []).filter((record) =>
    isOfflineSaleOutstandingStatus(String(record?.status || "pending")),
  );
}

function getPendingOfflineSalesCount() {
  return getOfflineSalesStatusSummary().outstanding;
}

function getOfflineSalePayload(record) {
  if (record?.requestPayload && typeof record.requestPayload === "object") {
    return record.requestPayload;
  }

  if (typeof record?.request?.body === "string" && record.request.body.trim()) {
    try {
      return JSON.parse(record.request.body);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function buildClientReceivableCustomerLookupKey(branch, customerName) {
  const normalizedBranch = normalizeSearchText(branch || "branch") || "branch";
  const normalizedCustomer = normalizeSearchText(customerName || "cliente") || "cliente";
  return `local:${normalizedBranch}:${normalizedCustomer}`;
}

function getOfflineSaleDisplayState(record) {
  const safeRecord = record && typeof record === "object" ? record : {};
  const baseStatus = String(safeRecord.status || "pending");
  const payload = getOfflineSalePayload(safeRecord) || {};
  const recordBranch = String(
    safeRecord.branch
      || payload.branch
      || "",
  ).trim();
  const recordCashier = String(
    safeRecord.cashier
      || payload.cashier
      || "",
  ).trim();
  const items = Array.isArray(safeRecord.items)
    ? safeRecord.items
    : Array.isArray(payload.items)
      ? payload.items
      : [];
  const conflicts = [];
  let note = "";
  let displayStatus = baseStatus;

  if (baseStatus === "synced") {
    note = safeRecord.syncedTicketNumber
      ? `Sincronizada como ${safeRecord.syncedTicketNumber}.`
      : safeRecord.syncedAt
        ? "Venta sincronizada correctamente."
        : "Sincronizada.";
    return {
      status: "synced",
      label: getOfflineSaleStatusLabel("synced"),
      note,
      conflicts,
      canRetry: false,
      canReject: false,
      canReactivate: false,
    };
  }

  if (baseStatus === "rejected") {
    note = String(safeRecord.rejectedReason || safeRecord.lastError || "Venta archivada para revision manual.");
    return {
      status: "rejected",
      label: getOfflineSaleStatusLabel("rejected"),
      note,
      conflicts,
      canRetry: false,
      canReject: false,
      canReactivate: true,
    };
  }

  const branchMismatch = Boolean(recordBranch && recordBranch !== getActiveCashierBranch());
  const canValidateStock = Boolean(
    recordBranch
    && !branchMismatch
    && (state.cashier.authenticated || state.admin.authenticated || state.owner.authenticated)
    && Array.isArray(state.products)
    && state.products.length > 0,
  );
  if (canValidateStock) {
    items.forEach((item) => {
      const productId = Number(item?.productId || 0);
      const quantity = roundStock(item?.quantity || 0);
      const product = state.products.find((candidate) => candidate.id === productId) || null;
      if (!product) {
        conflicts.push(`Producto ${item?.productName || productId} ya no esta disponible.`);
        return;
      }
      if (roundStock(product.stock) < quantity) {
        conflicts.push(
          `${product.name}: faltan ${formatQuantity(Math.max(0, quantity - roundStock(product.stock)))} ${product.unit}.`,
        );
      }
    });
  }

  if (conflicts.length > 0) {
    displayStatus = "requires_review";
    note = `Conflicto de stock en ${conflicts.length} producto(s). ${conflicts[0]}`;
  } else if (!state.online) {
    note = "Sin internet. La venta seguira guardada hasta reconectar.";
  } else if (!state.cashier.authenticated || !state.cashier.token) {
    note = `Tienes que iniciar sesion de ${recordCashier || "ese cajero"} para sincronizarla.`;
  } else if (branchMismatch) {
    displayStatus = "requires_review";
    note = `Pendiente de ${getBranchLabel(recordBranch)}. Abre esa caja o usa el mismo cajero para resincronizar.`;
  } else if (safeRecord.lastError) {
    note = String(safeRecord.lastError);
    if (baseStatus === "pending" && Number.isFinite(Number(safeRecord.lastErrorCode))) {
      const statusCode = Number(safeRecord.lastErrorCode);
      if (statusCode >= 400 && statusCode < 500) {
        displayStatus = "requires_review";
      }
    }
  } else {
    note = "Lista para sincronizar en cuanto haya sesion e internet.";
  }

  return {
    status: displayStatus,
    label: getOfflineSaleStatusLabel(displayStatus),
    note,
    conflicts,
    canRetry: true,
    canReject: true,
    canReactivate: false,
  };
}

function getOfflineSalesStatusSummary(records = state.offlineSales) {
  return (Array.isArray(records) ? records : []).reduce((summary, record) => {
    const displayStatus = getOfflineSaleDisplayState(record).status;

    if (displayStatus === "synced") {
      summary.synced += 1;
      return summary;
    }

    if (displayStatus === "rejected") {
      summary.rejected += 1;
      return summary;
    }

    summary.outstanding += 1;
    if (displayStatus === "requires_review") {
      summary.requiresReview += 1;
    } else {
      summary.pending += 1;
    }

    return summary;
  }, {
    pending: 0,
    requiresReview: 0,
    synced: 0,
    rejected: 0,
    outstanding: 0,
  });
}

function getOfflineReceivablePaymentPayload(record) {
  if (record?.requestPayload && typeof record.requestPayload === "object") {
    return record.requestPayload;
  }

  if (typeof record?.request?.body === "string" && record.request.body.trim()) {
    try {
      return JSON.parse(record.request.body);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function getOfflineReceivablePaymentStatusLabel(status) {
  if (status === "synced") {
    return "Sincronizado";
  }

  if (status === "rejected") {
    return "Rechazado";
  }

  if (status === "requires_review") {
    return "Requiere revision";
  }

  return "Pendiente";
}

function getOfflineReceivablePaymentRecordByClientPaymentId(clientPaymentId) {
  const safeClientPaymentId = String(clientPaymentId || "").trim();
  if (!safeClientPaymentId) {
    return null;
  }

  return (Array.isArray(state.offlineReceivablePayments) ? state.offlineReceivablePayments : []).find(
    (record) => String(record?.clientPaymentId || "") === safeClientPaymentId,
  ) || null;
}

function isOfflineReceivablePaymentOutstandingStatus(status) {
  return status !== "synced" && status !== "rejected";
}

function getOutstandingOfflineReceivablePayments() {
  return (Array.isArray(state.offlineReceivablePayments) ? state.offlineReceivablePayments : []).filter(
    (record) => isOfflineReceivablePaymentOutstandingStatus(String(record?.status || "pending")),
  );
}

function getOfflineReceivablePaymentDisplayState(record) {
  const safeRecord = record && typeof record === "object" ? record : {};
  const baseStatus = String(safeRecord.status || "pending");
  const payload = getOfflineReceivablePaymentPayload(safeRecord) || {};
  const recordBranch = String(
    safeRecord.branch
      || payload.branch
      || "",
  ).trim();
  const recordCashier = String(
    safeRecord.cashier
      || payload.cashier
      || "",
  ).trim();
  const linkedClientSaleId = String(
    safeRecord.linkedClientSaleId
      || payload.linkedClientSaleId
      || "",
  ).trim();
  const linkedSale = linkedClientSaleId
    ? getOfflineSaleRecordByClientSaleId(linkedClientSaleId)
    : null;
  const linkedSaleDisplayState = linkedSale ? getOfflineSaleDisplayState(linkedSale) : null;
  let displayStatus = baseStatus;
  let note = "";

  if (baseStatus === "synced") {
    note = safeRecord.syncedAt
      ? "Abono sincronizado correctamente."
      : "Sincronizado.";
    return {
      status: "synced",
      label: getOfflineReceivablePaymentStatusLabel("synced"),
      note,
      canRetry: false,
      canReject: false,
      canReactivate: false,
    };
  }

  if (baseStatus === "rejected") {
    note = String(
      safeRecord.rejectedReason
      || safeRecord.lastError
      || "Abono archivado para revision manual.",
    );
    return {
      status: "rejected",
      label: getOfflineReceivablePaymentStatusLabel("rejected"),
      note,
      canRetry: false,
      canReject: false,
      canReactivate: true,
    };
  }

  if (linkedClientSaleId) {
    if (!linkedSale) {
      return {
        status: "requires_review",
        label: getOfflineReceivablePaymentStatusLabel("requires_review"),
        note: "El ticket offline ligado a este abono ya no esta disponible en el dispositivo.",
        canRetry: true,
        canReject: false,
        canReactivate: false,
      };
    }

    if (!linkedSale.syncedSaleId) {
      displayStatus = linkedSaleDisplayState?.status === "requires_review"
        ? "requires_review"
        : displayStatus;
      note = linkedSaleDisplayState?.status === "requires_review"
        ? `El ticket ${linkedSale.localTicketNumber || "offline"} necesita revision antes de sincronizar este abono.`
        : `Esperando que primero se sincronice ${linkedSale.localTicketNumber || linkedSale.syncedTicketNumber || "el ticket offline"}.`;
      return {
        status: displayStatus,
        label: getOfflineReceivablePaymentStatusLabel(displayStatus),
        note,
        canRetry: true,
        canReject: false,
        canReactivate: false,
      };
    }
  }

  const branchMismatch = Boolean(recordBranch && recordBranch !== getActiveCashierBranch());
  if (!state.online) {
    note = "Sin internet. El abono seguira guardado hasta reconectar.";
  } else if (!state.cashier.authenticated || !state.cashier.token) {
    note = `Tienes que iniciar sesion de ${recordCashier || "ese cajero"} para sincronizarlo.`;
  } else if (branchMismatch) {
    displayStatus = "requires_review";
    note = `Pendiente de ${getBranchLabel(recordBranch)}. Abre esa caja o usa el mismo cajero para resincronizar.`;
  } else if (safeRecord.lastError) {
    note = String(safeRecord.lastError);
    if (baseStatus === "pending" && Number.isFinite(Number(safeRecord.lastErrorCode))) {
      const statusCode = Number(safeRecord.lastErrorCode);
      if (statusCode >= 400 && statusCode < 500) {
        displayStatus = "requires_review";
      }
    }
  } else {
    note = "Listo para sincronizar en cuanto haya sesion e internet.";
  }

  return {
    status: displayStatus,
    label: getOfflineReceivablePaymentStatusLabel(displayStatus),
    note,
    canRetry: true,
    canReject: false,
    canReactivate: false,
  };
}

function getOfflineReceivablePaymentsStatusSummary(records = state.offlineReceivablePayments) {
  return (Array.isArray(records) ? records : []).reduce((summary, record) => {
    const displayStatus = getOfflineReceivablePaymentDisplayState(record).status;

    if (displayStatus === "synced") {
      summary.synced += 1;
      return summary;
    }

    if (displayStatus === "rejected") {
      summary.rejected += 1;
      return summary;
    }

    summary.outstanding += 1;
    if (displayStatus === "requires_review") {
      summary.requiresReview += 1;
    } else {
      summary.pending += 1;
    }

    return summary;
  }, {
    pending: 0,
    requiresReview: 0,
    synced: 0,
    rejected: 0,
    outstanding: 0,
  });
}

function getOfflineOperationStatusSummary() {
  const sales = getOfflineSalesStatusSummary();
  const receivablePayments = getOfflineReceivablePaymentsStatusSummary();
  return {
    pending: sales.pending + receivablePayments.pending,
    requiresReview: sales.requiresReview + receivablePayments.requiresReview,
    synced: sales.synced + receivablePayments.synced,
    rejected: sales.rejected + receivablePayments.rejected,
    outstanding: sales.outstanding + receivablePayments.outstanding,
    sales,
    receivablePayments,
  };
}

function getStatusLabel(status) {
  if (status === "capture") {
    return "Pendiente";
  }

  if (status === "low") {
    return "Bajo";
  }

  if (status === "empty") {
    return "Agotado";
  }

  return "Disponible";
}

function getBranchOptions() {
  return Array.isArray(state.store?.branches) && state.store.branches.length > 0
    ? state.store.branches
    : [
        { value: "all", label: "Todas las sucursales" },
        { value: "carrizal", label: "Carrizal" },
        { value: "miradores", label: "Miradores" },
      ];
}

function getBranchLabel(branch) {
  const option = getBranchOptions().find((item) => item.value === branch);
  return option?.label || branch || "Sin sucursal";
}

function getActiveCashierBranch() {
  return state.cashier.branch || state.store.currentBranch || "carrizal";
}

function getAdminBranch() {
  return state.admin.branch || "all";
}

function getAdminActionBranch() {
  return getAdminBranch() === "all" ? getActiveCashierBranch() : getAdminBranch();
}

const storeDateInputFormatters = new Map();
const storeHourFormatters = new Map();

function getStoreTimeZone() {
  return state.profile?.timezone || state.store?.timezone || "America/Mexico_City";
}

function getStoreProfile() {
  return state.profile || {};
}

function getStoreName() {
  return getStoreProfile().businessName || state.store?.name || "Retail POS";
}

function getEnabledModules() {
  return Array.isArray(state.enabledModules) ? state.enabledModules : [];
}

function hasEnabledModule(moduleCode) {
  return getEnabledModules().includes(String(moduleCode || "").trim().toLowerCase());
}

function getAdminCapabilities() {
  return Array.isArray(state.adminCapabilities) ? state.adminCapabilities : [];
}

function hasAdminCapability(capabilityCode) {
  return getAdminCapabilities().includes(String(capabilityCode || "").trim().toLowerCase());
}

function getOwnerAvailableModules() {
  return Array.isArray(state.owner.availableModules) ? state.owner.availableModules : [];
}

function getOwnerAdminSections() {
  return Array.isArray(state.owner.adminSections) ? state.owner.adminSections : [];
}

function getVisibleText(key, fallback = "") {
  return state.profile?.visibleTexts?.[key] || fallback;
}

function isRouteModeEnabled() {
  return Boolean(state.ui?.routeMode);
}

function isCoarseTouchViewport() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return Boolean(
    window.matchMedia?.("(pointer: coarse)")?.matches
      || navigator.maxTouchPoints > 0,
  );
}

function isNarrowMobileViewport() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.matchMedia?.("(max-width: 520px)")?.matches);
}

function shouldPreferRouteModeByDefault() {
  return isCoarseTouchViewport() && isNarrowMobileViewport();
}

function shouldUseRouteMobileUi() {
  return isRouteModeEnabled() && shouldPreferRouteModeByDefault();
}

function getCategoryCatalog(includeAll = false) {
  const categories = Array.isArray(state.categories) ? state.categories.slice() : [];
  if (!includeAll) {
    return categories;
  }

  return [{ code: "all", label: "Todo" }, ...categories];
}

function getUnitCatalog() {
  return Array.isArray(state.units) ? state.units : [];
}

function getCategoryLabel(categoryCode) {
  return getCategoryCatalog(false).find((category) => category.code === categoryCode)?.label
    || categoryCode
    || "General";
}

function getUnitRecord(unitCodeOrId) {
  return getUnitCatalog().find((unit) =>
    unit.id === Number(unitCodeOrId) || unit.code === unitCodeOrId
  ) || null;
}

function getProductAttributeDefinitions() {
  return Array.isArray(state.productAttributeDefinitions) ? state.productAttributeDefinitions : [];
}

function getStoreDateInputFormatter(timeZone = getStoreTimeZone()) {
  if (!storeDateInputFormatters.has(timeZone)) {
    storeDateInputFormatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
  }

  return storeDateInputFormatters.get(timeZone);
}

function getStoreHourFormatter(timeZone = getStoreTimeZone()) {
  if (!storeHourFormatters.has(timeZone)) {
    storeHourFormatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        hour12: false,
      }),
    );
  }

  return storeHourFormatters.get(timeZone);
}

function toDateInputValue(value = new Date(), timeZone = getStoreTimeZone()) {
  return getStoreDateInputFormatter(timeZone).format(new Date(value));
}

function createDateFromDateInputValue(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || "").trim());
  if (!match) {
    return new Date();
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
}

function shiftDateInputValue(dateValue, daysDelta) {
  const anchor = dateValue ? createDateFromDateInputValue(dateValue) : new Date();
  anchor.setUTCDate(anchor.getUTCDate() + daysDelta);
  return toDateInputValue(anchor);
}

function getStoreHourLabel(value, timeZone = getStoreTimeZone()) {
  return `${getStoreHourFormatter(timeZone).format(new Date(value))}:00`;
}

function getStockStatus(stock, minStock, stockInitialized) {
  if (!stockInitialized) {
    return "capture";
  }

  if (stock <= 0) {
    return "empty";
  }

  if (stock <= minStock) {
    return "low";
  }

  return "ok";
}

function getProductStep(product) {
  const unitRecord = getUnitRecord(product?.unitId ?? product?.unit);
  return Number(product?.unitStep || unitRecord?.step || (product?.allowDecimals === false ? 1 : 0.25));
}

function getProductMin(product) {
  const unitRecord = getUnitRecord(product?.unitId ?? product?.unit);
  if (product?.allowDecimals === false || unitRecord?.allowDecimals === false) {
    return 1;
  }
  return Math.min(getProductStep(product), 0.25);
}

function normalizeQuantityToStep(value, product) {
  const step = getProductStep(product);
  const minimum = getProductMin(product);
  const roundedValue = Math.round(toNumber(value, minimum) / step) * step;
  return roundStock(Math.max(minimum, roundedValue));
}

function normalizeQuantityFromLineTotal(value, product) {
  const minimum = getProductMin(product);
  const numericValue = Math.max(0, roundMoney(value));

  if (product?.allowDecimals === false || getUnitRecord(product?.unitId ?? product?.unit)?.allowDecimals === false) {
    return normalizeQuantityToStep(
      product.price > 0 ? numericValue / product.price : minimum,
      product,
    );
  }

  return roundStock(
    Math.max(product.price > 0 ? numericValue / product.price : minimum, 0.001),
  );
}

function setSelectOptions(select, options, selectedValue) {
  if (!select) {
    return;
  }

  const nextOptions = Array.isArray(options) ? options : [];
  const currentMarkup = nextOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`,
    )
    .join("");

  if (select.innerHTML !== currentMarkup) {
    select.innerHTML = currentMarkup;
  }

  if (nextOptions.some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function updateModuleVisibility() {
  document.querySelectorAll("[data-module], [data-admin-capability]").forEach((element) => {
    const moduleCode = element.getAttribute("data-module");
    const capabilityCode = element.getAttribute("data-admin-capability");
    const moduleVisible = moduleCode ? hasEnabledModule(moduleCode) : true;
    const capabilityVisible = capabilityCode ? hasAdminCapability(capabilityCode) : true;
    element.hidden = !(moduleVisible && capabilityVisible);
  });
}

function setModalOpen(modal, isOpen) {
  if (!modal) {
    return;
  }

  modal.classList.toggle("open", isOpen);
  modal.setAttribute?.("aria-hidden", isOpen ? "false" : "true");
}

function getShiftOptionsMarkup(selectedShift) {
  const shiftOptions = refs.shiftSelect
    ? [...refs.shiftSelect.options].map((option) => option.value)
    : ["Manana", "Tarde"];

  return shiftOptions
    .map(
      (shift) => `<option value="${shift}" ${selectedShift === shift ? "selected" : ""}>${shift}</option>`,
    )
    .join("");
}

function getRegisterEventLabel(eventType) {
  if (eventType === "start") {
    return "Inicio de caja";
  }

  if (eventType === "quick_cut") {
    return "Corte rapido";
  }

  if (eventType === "final_cut") {
    return "Corte final";
  }

  return "Movimiento de caja";
}

function getInventoryMovementLabel(movementType) {
  if (movementType === "sale") {
    return "Venta";
  }

  if (movementType === "initial") {
    return "Inventario inicial";
  }

  if (movementType === "supplier" || movementType === "inventory_in") {
    return "Entrada de proveedor";
  }

  if (movementType === "supplier_out" || movementType === "inventory_out") {
    return "Salida de proveedor";
  }

  if (movementType === "adjustment") {
    return "Ajuste manual";
  }

  return "Movimiento";
}

function formatActivityAmount(activity) {
  if (activity.kind === "inventory") {
    return `${activity.amountPrefix}${formatQuantity(activity.amount)}`;
  }

  return `${activity.amountPrefix || ""}${formatCurrency(activity.amount)}`;
}

function getClientMetrics() {
  const memory = typeof performance !== "undefined" ? performance.memory : null;
  const connection =
    typeof navigator !== "undefined"
      ? navigator.connection || navigator.mozConnection || navigator.webkitConnection
      : null;
  return {
    domNodes: typeof document !== "undefined" ? document.getElementsByTagName("*").length : 0,
    hardwareConcurrency:
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 0,
    deviceMemory:
      typeof navigator !== "undefined" && navigator.deviceMemory ? navigator.deviceMemory : 0,
    usedHeapMb: memory?.usedJSHeapSize
      ? roundMetric(memory.usedJSHeapSize / 1024 / 1024)
      : null,
    network: connection
      ? {
          effectiveType: connection.effectiveType || "desconocida",
          downlink: connection.downlink || 0,
          rtt: connection.rtt || 0,
          saveData: Boolean(connection.saveData),
        }
      : null,
  };
}

function getEmptyRegisterSummary() {
  return {
    shift: refs.shiftSelect?.value || "Tarde",
    openingAmount: 0,
    cashSales: 0,
    withdrawalsAmount: 0,
    cardSales: 0,
    transferSales: 0,
    creditSales: 0,
    nonCashSales: 0,
    totalSales: 0,
    expectedCash: 0,
    tickets: 0,
    lastStartAt: null,
    lastStartCashier: null,
    quickCuts: 0,
    finalCuts: 0,
    cashierLocked: false,
    cashierFinalCutAt: null,
  };
}
