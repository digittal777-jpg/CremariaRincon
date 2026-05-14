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
  return state.store?.timezone || "America/Mexico_City";
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
  return product?.unit === "pza" ? 1 : 0.25;
}

function getProductMin(product) {
  return product?.unit === "pza" ? 1 : 0.25;
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

  if (product?.unit === "pza") {
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

  if (movementType === "supplier") {
    return "Entrada de proveedor";
  }

  if (movementType === "supplier_out") {
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
