// Utilidades y funciones helper

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
  };
}