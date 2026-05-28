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

function buildPublicSnapshotCacheView(snapshot) {
  const sourceSnapshot =
    snapshot && typeof snapshot === "object" ? snapshot : {};
  const products = Array.isArray(sourceSnapshot.products)
    ? sourceSnapshot.products.map((product) => ({
        ...product,
        cost: 0,
        supplierName: "",
        packSize: null,
        stock: 0,
        minStock: 0,
        stockInitialized: false,
        attributes: {},
        status: "capture",
      }))
    : [];
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
  modal.classList.toggle("open", isOpen);
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
