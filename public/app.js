const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const quantityFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
});

const timeFormatter = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
});

const CATEGORY_ORDER = ["all", "quesos", "carnes", "piezas", "general"];
const CATEGORY_LABELS = {
  all: "Todo",
  quesos: "Quesos",
  carnes: "Carnes",
  piezas: "Piezas",
  general: "General",
};

const STORAGE_KEYS = {
  cart: "cremeria.cart",
  shift: "cremeria.shift",
  cashierSession: "cremeria.cashier.session",
  snapshot: "cremeria.snapshot",
  queue: "cremeria.queue",
  adminToken: "cremeria.adminToken",
};
const OFFLINE_DB_NAME = "cremeria-rincon-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_DB_STORE = "app_state";
const PRODUCT_RENDER_BATCH = 24;

const state = {
  store: {
    branches: [],
    currentBranch: "carrizal",
    currentBranchLabel: "Carrizal",
    shifts: ["Manana", "Tarde"],
  },
  products: [],
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
    catalogSize: 0,
    inventoryValue: 0,
    lowStockCount: 0,
    topProduct: null,
  },
  selectedCategory: "all",
  visibleProductLimit: PRODUCT_RENDER_BATCH,
  currentProduct: null,
  cart: [],
  paymentMethod: "Efectivo",
  moneyInput: "0",
  socket: null,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  pendingQueue: [],
  syncingQueue: false,
  quickImport: {
    mode: "initial",
    direction: "in",
    items: [],
    index: 0,
    loading: false,
    saving: false,
    currentValue: "",
    supplierName: "",
    note: "",
  },
  register: {
    mode: "start",
    summary: null,
    loading: false,
    saving: false,
    amountInput: "",
    note: "",
  },
  detailViewer: {
    loading: false,
    kind: "",
    detail: null,
  },
  admin: {
    branch: "all",
    loading: false,
    metrics: null,
    pollTimerId: null,
    token: "",
    configured: false,
    authenticated: false,
    snapshot: null,
    cashiers: [],
    editorData: {
      sales: [],
      registerEvents: [],
      inventoryMovements: [],
    },
  },
  adminAuth: {
    mode: "login",
    loading: false,
  },
  adminEditor: {
    kind: "",
    id: null,
    loading: false,
    saving: false,
    detail: null,
  },
  cashier: {
    name: "",
    branch: "",
    authenticated: false,
  },
  cashierAuth: {
    loading: false,
  },
  performance: {
    productsRenderMs: 0,
    snapshotRenderMs: 0,
    renderedProductCount: 0,
  },
};

const refs = {};
let offlineDbPromise = null;

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

function requireCashierSession(message = "Inicia sesion de cajero para continuar.") {
  if (state.cashier.authenticated) {
    return true;
  }

  showToast(message, "info");
  openCashierAuthModal();
  return false;
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

function showToast(message, type = "info") {
  if (!refs.toastRegion) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  refs.toastRegion.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

async function performJsonRequest(url, options = {}) {
  // Headers siempre al FINAL para que no se sobrescriban
  const response = await fetch(url, {
    ...options,                                 // method, body, etc.
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),               // Authorization del admin (se agrega encima)
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "No fue posible completar la acción.");
  }

  return data;
}

function isNetworkError(error) {
  return error instanceof TypeError;
}

function readStorageJson(key, fallbackValue = null) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (_error) {
    return fallbackValue;
  }
}

function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignora errores de almacenamiento local para no bloquear la caja.
  }
}

function readStorageText(key, fallbackValue = "") {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ?? fallbackValue;
  } catch (_error) {
    return fallbackValue;
  }
}

function writeStorageText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_error) {
    // Ignora errores de almacenamiento local para no bloquear la caja.
  }
}

function openOfflineDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  if (!offlineDbPromise) {
    offlineDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) {
          db.createObjectStore(OFFLINE_DB_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  return offlineDbPromise;
}

async function readOfflineRecord(key) {
  const db = await openOfflineDb();
  if (!db) {
    return undefined;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(OFFLINE_DB_STORE, "readonly");
    const request = transaction.objectStore(OFFLINE_DB_STORE).get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    transaction.onabort = () => resolve(undefined);
  });
}

async function writeOfflineRecord(key, value) {
  const db = await openOfflineDb();
  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(OFFLINE_DB_STORE, "readwrite");
    transaction.objectStore(OFFLINE_DB_STORE).put(value, key);

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

async function readPersistedJson(key, fallbackValue = null) {
  const offlineValue = await readOfflineRecord(key);
  if (typeof offlineValue !== "undefined") {
    return offlineValue ?? fallbackValue;
  }

  return readStorageJson(key, fallbackValue);
}

async function readPersistedText(key, fallbackValue = "") {
  const offlineValue = await readOfflineRecord(key);
  if (typeof offlineValue !== "undefined") {
    return offlineValue ?? fallbackValue;
  }

  return readStorageText(key, fallbackValue);
}

function persistJson(key, value) {
  writeStorageJson(key, value);
  void writeOfflineRecord(key, value);
}

function persistText(key, value) {
  writeStorageText(key, value);
  void writeOfflineRecord(key, value);
}

function buildPersistedSnapshot() {
  return {
    store: state.store,
    products: state.products,
    lowStock: state.lowStock,
    recentSales: state.recentSales,
    recentActivity: state.recentActivity,
    salesByHour: state.salesByHour,
    shiftSummary: state.shiftSummary,
    summary: state.summary,
  };
}

function saveSnapshot(snapshot) {
  persistJson(STORAGE_KEYS.snapshot, snapshot);
}

async function restoreSnapshot() {
  return readPersistedJson(STORAGE_KEYS.snapshot, null);
}

function saveQueue() {
  persistJson(STORAGE_KEYS.queue, state.pendingQueue);
}

async function restoreQueue() {
  state.pendingQueue = await readPersistedJson(STORAGE_KEYS.queue, []);
}

function renderSyncStatus() {
  if (refs.networkStatus) {
    refs.networkStatus.textContent = state.online ? "En linea" : "Offline";
  }

  if (!refs.syncStatus) {
    return;
  }

  if (state.syncingQueue) {
    refs.syncStatus.textContent = `Sincronizando ${state.pendingQueue.length}`;
    return;
  }

  refs.syncStatus.textContent =
    state.pendingQueue.length > 0
      ? `${state.pendingQueue.length} pendientes`
      : "Sin pendientes";
}

function enqueueOperation(operation) {
  state.pendingQueue.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    ...operation,
  });
  saveQueue();
  renderSyncStatus();
}

async function requestJson(url, options = {}) {
  try {
    return await performJsonRequest(url, options);
  } catch (error) {
    if (options.queueable && isNetworkError(error)) {
      enqueueOperation({
        url,
        method: options.method || "GET",
        body: options.body || null,
      });
      throw new Error("Operacion guardada en modo offline. Se sincronizara al reconectar.");
    }

    throw error;
  }
}

function saveCart() {
  persistJson(STORAGE_KEYS.cart, state.cart);
}

async function restoreCart() {
  state.cart = await readPersistedJson(STORAGE_KEYS.cart, []);
}

function persistPreferences() {
  persistText(STORAGE_KEYS.shift, refs.shiftSelect.value);
}

async function restorePreferences() {
  const savedShift = await readPersistedText(STORAGE_KEYS.shift, "");

  if (savedShift) {
    refs.shiftSelect.value = savedShift;
  }
}

function persistCashierSession() {
  persistText(
    STORAGE_KEYS.cashierSession,
    JSON.stringify({
      name: state.cashier.name,
      branch: state.cashier.branch,
      authenticated: state.cashier.authenticated,
    }),
  );
}

async function restoreCashierSession() {
  const rawValue = await readPersistedText(STORAGE_KEYS.cashierSession, "");
  if (!rawValue) {
    return;
  }

  try {
    const parsed = JSON.parse(rawValue);
    state.cashier.name = parsed.name || "";
    state.cashier.branch = parsed.branch || "";
    state.cashier.authenticated = Boolean(parsed.authenticated && parsed.name && parsed.branch);
  } catch (_error) {
    state.cashier.name = "";
    state.cashier.branch = "";
    state.cashier.authenticated = false;
  }
}

function getCartTotal() {
  return roundMoney(
    state.cart.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0),
  );
}

function getCartCount() {
  return state.cart.length;
}

function applySnapshot(snapshot, options = {}) {
  const renderStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.store = snapshot.store || state.store;
  state.products = Array.isArray(snapshot.products) ? snapshot.products : [];
  state.lowStock = Array.isArray(snapshot.lowStock) ? snapshot.lowStock : [];
  state.recentSales = Array.isArray(snapshot.recentSales) ? snapshot.recentSales : [];
  state.recentActivity = Array.isArray(snapshot.recentActivity) ? snapshot.recentActivity : [];
  state.salesByHour = Array.isArray(snapshot.salesByHour) ? snapshot.salesByHour : [];
  state.shiftSummary = Array.isArray(snapshot.shiftSummary) ? snapshot.shiftSummary : [];
  state.summary = snapshot.summary || state.summary;
  state.admin.editorData.sales = state.recentSales.slice(0, 16);
  syncQuickImportItemsFromProducts();
  if (!options.skipPersist) {
    saveSnapshot(buildPersistedSnapshot());
  }

  renderSummary();
  renderCashierSession();
  renderCategoryFilters();
  requestProductsRender();
  renderLowStock();
  renderRecentSales();
  renderRecentActivity();
  renderTrendChart();
  renderShiftSummary();
  if (refs.adminModal?.classList.contains("open")) {
    renderInventory();
  }
  renderQuickImportModal();
  renderSyncStatus();
  state.performance.snapshotRenderMs = roundMetric(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
  );
  renderAdminModal();
  renderAdminRecordLists();
}

function rebuildInventoryDerivedState() {
  state.products = state.products.map((product) => ({
    ...product,
    status: getStockStatus(product.stock, product.minStock, product.stockInitialized),
  }));
  state.lowStock = state.products
    .filter((product) => product.active && product.stockInitialized && product.stock <= product.minStock)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 8);
  state.summary.catalogSize = state.products.filter((product) => product.active).length;
  state.summary.inventoryValue = roundMoney(
    state.products
      .filter((product) => product.active)
      .reduce((sum, product) => sum + roundMoney(product.stock * product.price), 0),
  );
  state.summary.lowStockCount = state.products.filter(
    (product) => product.active && product.stockInitialized && product.stock <= product.minStock,
  ).length;
}

function applyOptimisticProductUpdate(productId, payload) {
  state.products = state.products.map((product) => {
    if (product.id !== productId) {
      return product;
    }

    const nextProduct = {
      ...product,
      price: payload.price ?? product.price,
      stock: payload.stock ?? product.stock,
      minStock: payload.minStock ?? product.minStock,
      active: payload.active ?? product.active,
      stockInitialized: true,
    };

    nextProduct.status = getStockStatus(
      nextProduct.stock,
      nextProduct.minStock,
      nextProduct.stockInitialized,
    );
    return nextProduct;
  });

  rebuildInventoryDerivedState();
  saveSnapshot(buildPersistedSnapshot());
  renderSummary();
  requestProductsRender();
  renderLowStock();
  if (refs.adminModal?.classList.contains("open")) {
    renderInventory();
  }
}

function getAdminAuthHeaders() {
  return state.admin.token
    ? {
        Authorization: `Bearer ${state.admin.token}`,
      }
    : {};
}

async function requestAdminJson(url, options = {}) {
  return performJsonRequest(url, {
    ...options,
    headers: {
      ...getAdminAuthHeaders(),
      ...(options.headers || {}),
    },
  });
}

async function loadAdminAuthStatus() {
  const response = await performJsonRequest("/api/admin/auth/status", {
    headers: getAdminAuthHeaders(),
  });
  state.admin.configured = Boolean(response.configured);
  state.admin.authenticated = Boolean(response.authenticated) && Boolean(state.admin.token);
  return response;
}

function applyOptimisticSale(payload) {
  const total = roundMoney(
    payload.items.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0),
  );
  const itemCount = roundStock(
    payload.items.reduce((sum, item) => sum + roundStock(item.quantity), 0),
  );

  payload.items.forEach((item) => {
    state.products = state.products.map((product) => {
      if (product.id !== item.productId) {
        return product;
      }

      const nextStock = roundStock(product.stock - roundStock(item.quantity));
      return {
        ...product,
        stock: nextStock,
        stockInitialized: true,
        status: getStockStatus(nextStock, product.minStock, true),
      };
    });
  });

  const tempSale = {
    id: `offline-${Date.now()}`,
    ticketNumber: `OFF-${Date.now().toString().slice(-6)}`,
    shift: payload.shift,
    cashier: payload.cashier,
    paymentMethod: payload.paymentMethod,
    subtotal: total,
    total,
    itemCount,
    notes: payload.notes || "",
    receivedAmount: payload.receivedAmount,
    changeAmount:
      payload.paymentMethod === "Efectivo"
        ? roundMoney(payload.receivedAmount - total)
        : 0,
    createdAt: new Date().toISOString(),
    items: payload.items.map((item) => ({
      productName: item.productName || "Producto",
      quantity: roundStock(item.quantity),
      unitPrice: roundMoney(item.unitPrice),
      lineTotal: roundMoney(item.lineTotal),
    })),
  };

  state.recentSales = [tempSale, ...state.recentSales].slice(0, 8);
  state.recentActivity = [
    {
      kind: "sale",
      id: tempSale.id,
      createdAt: tempSale.createdAt,
      title: tempSale.ticketNumber,
      subtitle: `${tempSale.cashier} · ${tempSale.shift}`,
      amount: tempSale.total,
      amountPrefix: "",
      tag: "Venta",
    },
    ...state.recentActivity,
  ].slice(0, 18);
  state.summary.revenueToday = roundMoney(state.summary.revenueToday + total);
  state.summary.ticketsToday += 1;
  state.summary.unitsSoldToday = roundStock(state.summary.unitsSoldToday + itemCount);
  state.summary.averageTicket = roundMoney(
    state.summary.revenueToday / Math.max(state.summary.ticketsToday, 1),
  );

  const currentHourLabel = `${String(new Date().getHours()).padStart(2, "0")}:00`;
  state.salesByHour = state.salesByHour.map((slot) =>
    slot.label === currentHourLabel
      ? { ...slot, total: roundMoney(slot.total + total) }
      : slot,
  );
  state.shiftSummary = state.shiftSummary.map((item) =>
    item.shift === payload.shift
      ? {
          ...item,
          tickets: item.tickets + 1,
          total: roundMoney(item.total + total),
        }
      : item,
  );

  rebuildInventoryDerivedState();
  saveSnapshot(buildPersistedSnapshot());
  renderSummary();
  requestProductsRender();
  renderLowStock();
  renderRecentSales();
  renderRecentActivity();
  renderTrendChart();
  renderShiftSummary();
  if (refs.adminModal?.classList.contains("open")) {
    renderInventory();
  }
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

function renderCashierSession() {
  const branchLabel = getBranchLabel(getActiveCashierBranch());
  const cashierLabel = state.cashier.name || "Sin sesion";
  const sessionText = state.cashier.authenticated
    ? `${cashierLabel} en ${branchLabel}`
    : "Sin iniciar sesion";

  if (refs.branchDisplay) {
    refs.branchDisplay.value = branchLabel;
  }

  if (refs.cashierInput) {
    refs.cashierInput.value = cashierLabel;
  }

  if (refs.cashierSessionLabel) {
    refs.cashierSessionLabel.textContent = sessionText;
  }

  if (refs.cashierSessionHelper) {
    refs.cashierSessionHelper.textContent = state.cashier.authenticated
      ? "Puedes cambiar de sucursal o cerrar la sesion del cajero cuando lo necesites."
      : "Selecciona sucursal y entra con la clave del cajero para empezar a vender.";
  }

  if (refs.logoutCashierButton) {
    refs.logoutCashierButton.disabled = !state.cashier.authenticated;
  }
}

async function refreshCurrentSnapshot(branch = getActiveCashierBranch()) {
  const snapshot = await performJsonRequest(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}`,
  );
  applySnapshot(snapshot);
  return snapshot;
}

function applyAdminSnapshot(snapshot) {
  state.admin.snapshot = snapshot || null;
  if (snapshot?.store?.currentBranch) {
    state.admin.branch = snapshot.store.currentBranch;
  }
  renderAdminModal();
}

async function loadAdminSnapshot(branch = getAdminBranch()) {
  const snapshot = await requestAdminJson(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}`,
  );
  applyAdminSnapshot(snapshot);
  return snapshot;
}

async function loadAdminCashiers(branch = getAdminBranch()) {
  const query =
    branch && branch !== "all" ? `?branch=${encodeURIComponent(branch)}` : "";
  try {
    const response = await requestAdminJson(`/api/admin/cashiers${query}`);
    state.admin.cashiers = Array.isArray(response.cashiers) ? response.cashiers : [];
  } catch (_error) {
    state.admin.cashiers = [];
  }
  renderAdminCashiers();
}

async function refreshAdminWorkspace() {
  await Promise.allSettled([
    loadAdminSnapshot(getAdminBranch()),
    loadAdminEditorData(getAdminBranch()),
    loadAdminCashiers(getAdminBranch()),
  ]);
}

function renderSummary() {
  const topProductText = state.summary.topProduct
    ? `${state.summary.topProduct.name} lidera con ${formatCurrency(state.summary.topProduct.total)}`
    : "Sin ventas registradas hoy";

  refs.summaryCards.innerHTML = `
    <article class="stat-card">
      <h3>Ventas de hoy</h3>
      <div class="stat-value">${formatCurrency(state.summary.revenueToday)}</div>
      <div class="stat-foot">${state.summary.ticketsToday} tickets emitidos</div>
    </article>
    <article class="stat-card">
      <h3>Ticket promedio</h3>
      <div class="stat-value">${formatCurrency(state.summary.averageTicket)}</div>
      <div class="stat-foot">${formatQuantity(state.summary.unitsSoldToday)} unidades vendidas</div>
    </article>
    <article class="stat-card">
      <h3>Inventario valorizado</h3>
      <div class="stat-value">${formatCurrency(state.summary.inventoryValue)}</div>
      <div class="stat-foot">${state.summary.catalogSize} productos activos</div>
    </article>
    <article class="stat-card">
      <h3>Alertas de stock</h3>
      <div class="stat-value">${state.summary.lowStockCount}</div>
      <div class="stat-foot">${escapeHtml(topProductText)}</div>
    </article>
  `;
}

function renderCategoryFilters() {
  const categories = ["all"];
  state.products.forEach((product) => {
    if (!categories.includes(product.category)) {
      categories.push(product.category);
    }
  });

  categories.sort(
    (left, right) => CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right),
  );

  refs.categoryFilters.innerHTML = categories
    .map(
      (category) => `
        <button
          class="category-chip ${state.selectedCategory === category ? "active" : ""}"
          data-category="${category}"
          type="button"
        >
          ${escapeHtml(CATEGORY_LABELS[category] || category)}
        </button>
      `,
    )
    .join("");
}

function getFilteredProducts() {
  const search = refs.searchInput.value.trim().toLowerCase();

  return state.products.filter((product) => {
    const matchesCategory =
      state.selectedCategory === "all" || product.category === state.selectedCategory;
    const matchesSearch = product.name.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });
}

function resetVisibleProducts() {
  state.visibleProductLimit = PRODUCT_RENDER_BATCH;
  if (refs.productsGrid) {
    refs.productsGrid.scrollTop = 0;
  }
}

function loadMoreProducts() {
  const totalProducts = getFilteredProducts().length;
  if (state.visibleProductLimit >= totalProducts) {
    return;
  }

  state.visibleProductLimit = Math.min(
    totalProducts,
    state.visibleProductLimit + PRODUCT_RENDER_BATCH,
  );
  renderProducts();
}

function requestProductsRender(reset = false) {
  if (reset) {
    resetVisibleProducts();
  }

  if (typeof window === "undefined") {
    renderProducts();
    return;
  }

  window.requestAnimationFrame(() => {
    renderProducts();
  });
}

function renderProducts() {
  const renderStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const products = getFilteredProducts();
  const visibleProducts = products.slice(0, state.visibleProductLimit);

  if (products.length === 0) {
    refs.productsGrid.innerHTML = `
      <div class="empty-state">
        No hay productos que coincidan con tu busqueda actual.
      </div>
    `;
    state.performance.productsRenderMs = roundMetric(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
    );
    state.performance.renderedProductCount = 0;
    renderAdminModal();
    return;
  }

  refs.productsGrid.innerHTML = visibleProducts
    .map(
      (product) => `
        <button
          class="product-card ${product.status}"
          data-action="open-product"
          data-product-id="${product.id}"
          type="button"
        >
          <div class="product-top">
            <span class="product-chip">${escapeHtml(product.categoryLabel)}</span>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </div>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="product-bottom">
            <div class="product-stock">
              ${product.status === "capture"
                ? "Captura inicial pendiente"
                : `Quedan ${escapeHtml(formatProductStock(product))}`}
            </div>
            <div class="product-price">${formatCurrency(product.price)}</div>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderCart() {
  if (state.cart.length === 0) {
    refs.cartItems.innerHTML = `
      <div class="empty-state">
        El carrito esta vacio. Agrega productos para iniciar una venta.
      </div>
    `;
  } else {
    refs.cartItems.innerHTML = state.cart
      .map(
        (item, index) => `
          <article class="cart-item">
            <div class="cart-item-row">
              <div>
                <div class="cart-item-title">${escapeHtml(item.name)}</div>
                <p class="cart-item-subtitle">
                  ${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)} · ${formatCurrency(item.unitPrice)}
                </p>
              </div>
              <button class="icon-button" data-action="remove-cart-item" data-index="${index}" type="button">×</button>
            </div>
            <div class="cart-item-row">
              <span class="cart-item-subtitle">${escapeHtml(item.categoryLabel)}</span>
              <span class="cart-item-price">${formatCurrency(item.lineTotal)}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  refs.cartCount.textContent = `${getCartCount()} lineas`;
  refs.cartTotal.textContent = formatCurrency(getCartTotal());
}

function renderRecentSales() {
  if (state.recentSales.length === 0) {
    refs.recentSales.innerHTML = `
      <div class="empty-state">
        Cuando registres ventas apareceran aqui en tiempo real.
      </div>
    `;
    return;
  }

  refs.recentSales.innerHTML = state.recentSales
    .map(
      (sale) => `
        <article class="feed-item">
          <div class="feed-meta">
            <strong>${escapeHtml(sale.ticketNumber)}</strong>
            <span class="feed-total">${formatCurrency(sale.total)}</span>
          </div>
          <p>${escapeHtml(sale.itemsSummary)}</p>
          <p>${escapeHtml(sale.cashier)} · ${escapeHtml(sale.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
        </article>
      `,
    )
    .join("");
}

function renderLowStock() {
  if (state.lowStock.length === 0) {
    refs.lowStockList.innerHTML = `
      <div class="empty-state">
        Sin alertas. El inventario se ve estable por ahora.
      </div>
    `;
    return;
  }

  refs.lowStockList.innerHTML = state.lowStock
    .map(
      (product) => `
        <article class="alert-item">
          <div class="inventory-meta">
            <strong>${escapeHtml(product.name)}</strong>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </div>
          <p>
            Actual: ${escapeHtml(formatProductStock(product))} · Minimo: ${escapeHtml(formatQuantity(product.minStock))} ${escapeHtml(product.unit)}
          </p>
        </article>
      `,
    )
    .join("");
}

function renderTrendChart() {
  const bars = state.salesByHour;
  const maxValue = Math.max(...bars.map((bar) => bar.total), 1);

  refs.trendChart.innerHTML = bars
    .map((bar) => {
      const height = Math.max(12, Math.round((bar.total / maxValue) * 140));
      return `
        <div class="trend-bar">
          <div class="trend-bar-fill" style="height:${height}px"></div>
          <div class="trend-bar-value">${formatCurrency(bar.total)}</div>
          <div class="trend-bar-label">${escapeHtml(bar.label)}</div>
        </div>
      `;
    })
    .join("");
}

renderRecentSales = function renderRecentSalesDetailed() {
  if (state.recentSales.length === 0) {
    refs.recentSales.innerHTML = `
      <div class="empty-state">
        Cuando registres ventas apareceran aqui en tiempo real.
      </div>
    `;
    return;
  }

  refs.recentSales.innerHTML = state.recentSales
    .map(
      (sale) => `
        <button
          class="feed-item sale-card sale-card-button"
          data-action="open-activity-detail"
          data-kind="sale"
          data-id="${sale.id}"
          type="button"
        >
          <div class="sale-card-head">
            <div>
              <strong>${escapeHtml(sale.ticketNumber)}</strong>
              <p class="sale-card-datetime">${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
            </div>
            <span class="feed-total">${formatCurrency(sale.total)}</span>
          </div>

          <div class="sale-card-grid">
            <div class="sale-card-stat">
              <span>Cajero</span>
              <strong>${escapeHtml(sale.cashier)}</strong>
            </div>
            <div class="sale-card-stat">
              <span>Turno</span>
              <strong>${escapeHtml(sale.shift)}</strong>
            </div>
            <div class="sale-card-stat">
              <span>Metodo</span>
              <strong>${escapeHtml(sale.paymentMethod)}</strong>
            </div>
            <div class="sale-card-stat">
              <span>Unidades</span>
              <strong>${escapeHtml(formatQuantity(sale.itemCount || 0))}</strong>
            </div>
          </div>

          <div class="sale-lines">
            ${
              Array.isArray(sale.items) && sale.items.length > 0
                ? sale.items
                    .map(
                      (item) => `
                        <div class="sale-line">
                          <div>
                            <strong>${escapeHtml(item.productName)}</strong>
                            <p>${escapeHtml(formatQuantity(item.quantity))} x ${formatCurrency(item.unitPrice)}</p>
                          </div>
                          <span>${formatCurrency(item.lineTotal)}</span>
                        </div>
                      `,
                    )
                    .join("")
                : `<p class="cart-item-subtitle">Sin detalle de productos.</p>`
            }
          </div>

          <div class="sale-card-totals">
            <div class="sale-total-row">
              <span>Subtotal</span>
              <strong>${formatCurrency(sale.subtotal || sale.total)}</strong>
            </div>
            <div class="sale-total-row">
              <span>Recibido</span>
              <strong>${formatCurrency(sale.receivedAmount)}</strong>
            </div>
            <div class="sale-total-row">
              <span>Cambio</span>
              <strong>${formatCurrency(sale.changeAmount)}</strong>
            </div>
          </div>

          ${
            sale.notes
              ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(sale.notes)}</p>`
              : ""
          }
        </button>
      `,
    )
    .join("");
};

function formatActivityAmount(activity) {
  if (activity.kind === "inventory") {
    return `${activity.amountPrefix}${formatQuantity(activity.amount)}`;
  }

  return `${activity.amountPrefix || ""}${formatCurrency(activity.amount)}`;
}

function renderRecentActivity() {
  if (!refs.activityList) {
    return;
  }

  if (state.recentActivity.length === 0) {
    refs.activityList.innerHTML = `
      <div class="empty-state">
        Cuando registres ventas, cortes o ajustes apareceran aqui.
      </div>
    `;
    return;
  }

  refs.activityList.innerHTML = state.recentActivity
    .map(
      (activity) => `
        <button
          class="activity-item"
          data-action="open-activity-detail"
          data-kind="${activity.kind}"
          data-id="${activity.id}"
          type="button"
        >
          <div class="activity-item-head">
            <span class="small-pill">${escapeHtml(activity.tag)}</span>
            <strong>${escapeHtml(formatActivityAmount(activity))}</strong>
          </div>
          <div class="activity-item-body">
            <strong>${escapeHtml(activity.title)}</strong>
            <p>${escapeHtml(activity.subtitle)} · ${escapeHtml(dateTimeFormatter.format(new Date(activity.createdAt)))}</p>
          </div>
        </button>
      `,
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

function renderDetailViewer() {
  if (!refs.detailViewerModal) {
    return;
  }

  if (state.detailViewer.loading) {
    refs.detailViewerTitle.textContent = "Cargando detalle";
    refs.detailViewerMeta.textContent = "Preparando informacion...";
    refs.detailViewerBody.innerHTML = `
      <div class="empty-state">
        Cargando detalle completo...
      </div>
    `;
    return;
  }

  const { kind, detail } = state.detailViewer;
  if (!detail) {
    refs.detailViewerTitle.textContent = "Sin detalle";
    refs.detailViewerMeta.textContent = "";
    refs.detailViewerBody.innerHTML = `
      <div class="empty-state">
        Selecciona un ticket o movimiento para ver su informacion completa.
      </div>
    `;
    return;
  }

  if (kind === "sale") {
    refs.detailViewerTitle.textContent = detail.ticketNumber;
    refs.detailViewerMeta.textContent =
      `${detail.cashier} · ${detail.shift} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Total</span>
          <strong>${formatCurrency(detail.total)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Metodo</span>
          <strong>${escapeHtml(detail.paymentMethod)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Recibido</span>
          <strong>${formatCurrency(detail.receivedAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Cambio</span>
          <strong>${formatCurrency(detail.changeAmount)}</strong>
        </article>
      </div>
      <div class="detail-lines">
        ${detail.items
          .map(
            (item) => `
              <div class="detail-line">
                <div>
                  <strong>${escapeHtml(item.productName)}</strong>
                  <p>${escapeHtml(formatQuantity(item.quantity))} x ${formatCurrency(item.unitPrice)}</p>
                </div>
                <span>${formatCurrency(item.lineTotal)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      ${detail.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.notes)}</p>` : ""}
    `;
    return;
  }

  if (kind === "register") {
    refs.detailViewerTitle.textContent = getRegisterEventLabel(detail.eventType);
    refs.detailViewerMeta.textContent =
      `${detail.shift} · ${detail.cashier} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Caja inicial</span>
          <strong>${formatCurrency(detail.openingAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Efectivo esperado</span>
          <strong>${formatCurrency(detail.expectedCash)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Efectivo contado</span>
          <strong>${formatCurrency(detail.countedAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Diferencia</span>
          <strong>${formatCurrency(detail.differenceAmount)}</strong>
        </article>
      </div>
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Ventas efectivo</span>
          <strong>${formatCurrency(detail.cashSales)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Ventas no efectivo</span>
          <strong>${formatCurrency(detail.nonCashSales)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Total vendido</span>
          <strong>${formatCurrency(detail.totalSales)}</strong>
        </article>
      </div>
      ${detail.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.notes)}</p>` : ""}
    `;
    return;
  }

  if (kind === "inventory") {
    refs.detailViewerTitle.textContent = detail.productName;
    refs.detailViewerMeta.textContent =
      `${getInventoryMovementLabel(detail.movementType)} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Movimiento</span>
          <strong>${escapeHtml(getInventoryMovementLabel(detail.movementType))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Cantidad</span>
          <strong>${detail.quantityDelta >= 0 ? "+" : ""}${escapeHtml(formatQuantity(detail.quantityDelta))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Antes</span>
          <strong>${escapeHtml(formatQuantity(detail.stockBefore))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Despues</span>
          <strong>${escapeHtml(formatQuantity(detail.stockAfter))}</strong>
        </article>
      </div>
      <div class="detail-lines">
        <div class="detail-line">
          <div>
            <strong>Referencia</strong>
            <p>${escapeHtml(detail.referenceType || "Sin referencia")}${detail.referenceId ? ` #${escapeHtml(String(detail.referenceId))}` : ""}</p>
          </div>
        </div>
      </div>
      ${detail.note ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.note)}</p>` : ""}
    `;
  }
}

async function openActivityDetail(kind, id) {
  if (kind === "sale" && String(id).startsWith("offline-")) {
    state.detailViewer.loading = false;
    state.detailViewer.kind = kind;
    state.detailViewer.detail = state.recentSales.find((sale) => String(sale.id) === String(id)) || null;
    setModalOpen(refs.detailViewerModal, true);
    renderDetailViewer();
    return;
  }

  state.detailViewer.loading = true;
  state.detailViewer.kind = kind;
  state.detailViewer.detail = null;
  setModalOpen(refs.detailViewerModal, true);
  renderDetailViewer();

  try {
    const response = await performJsonRequest(`/api/activity/${encodeURIComponent(kind)}/${id}`);
    state.detailViewer.kind = response.kind;
    state.detailViewer.detail = response.detail;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.detailViewer.loading = false;
    renderDetailViewer();
  }
}

function closeDetailViewer() {
  setModalOpen(refs.detailViewerModal, false);
}

function renderShiftSummary() {
  if (state.shiftSummary.length === 0) {
    refs.shiftSummary.innerHTML = `
      <div class="shift-chip">Sin tickets registrados hoy</div>
    `;
    return;
  }

  refs.shiftSummary.innerHTML = state.shiftSummary
    .map(
      (item) => `
        <div class="shift-chip">
          ${escapeHtml(item.shift)} · ${item.tickets} tickets · ${formatCurrency(item.total)}
        </div>
      `,
    )
    .join("");
}

function renderInventory() {
  refs.inventoryBody.innerHTML = state.products
    .map(
      (product) => `
        <tr data-product-id="${product.id}">
          <td>
            <div class="inventory-name">
              <strong>${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(product.categoryLabel)} · ${escapeHtml(product.unit)}</small>
            </div>
          </td>
          <td>
            <input class="inventory-input" data-field="price" type="number" min="0" step="0.01" value="${product.price}" />
          </td>
          <td>
            <input class="inventory-input" data-field="stock" type="number" step="${getProductStep(product)}" value="${product.stock}" />
          </td>
          <td>
            <input class="inventory-input" data-field="minStock" type="number" min="0" step="${getProductStep(product)}" value="${product.minStock}" />
          </td>
          <td>
            <label class="inventory-toggle">
              <input data-field="active" type="checkbox" ${product.active ? "checked" : ""} />
              <span>${product.active ? "Activo" : "Inactivo"}</span>
            </label>
          </td>
          <td>
            <input class="inventory-input" data-field="note" type="text" maxlength="120" placeholder="Nota del ajuste" />
          </td>
          <td>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </td>
          <td>
            <button class="secondary-button" data-action="save-product" type="button">
              Guardar
            </button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function getQuickImportItems() {
  return Array.isArray(state.quickImport.items) ? state.quickImport.items : [];
}

function getCurrentQuickImportItem() {
  return getQuickImportItems()[state.quickImport.index] || null;
}

function normalizeQuickImportItem(item) {
  const normalizedId = Number(item?.id ?? item?.productId ?? item?.product_id);

  return {
    ...item,
    id: Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null,
    soldToday:
      item?.soldToday == null ? null : roundStock(item.soldToday),
    recordedStock: roundStock(item?.recordedStock ?? item?.stock),
  };
}

function formatQuickImportValue(value, unit) {
  return value == null ? "Sin dato" : `${formatQuantity(value)} ${unit}`;
}

function syncQuickImportItemsFromProducts() {
  if (getQuickImportItems().length === 0) {
    return;
  }

  const productMap = new Map(state.products.map((product) => [product.id, product]));
  state.quickImport.items = state.quickImport.items.map((rawItem) => {
    const item = normalizeQuickImportItem(rawItem);
    const nextProduct = item.id ? productMap.get(item.id) : null;
    if (!nextProduct) {
      return item;
    }

    return {
      ...item,
      ...nextProduct,
      recordedStock: roundStock(nextProduct.stock),
    };
  });
}

function resetQuickImportDraft(item = getCurrentQuickImportItem()) {
  state.quickImport.note = "";
  state.quickImport.currentValue = "";
}

function focusQuickImportValue() {
  if (!refs.quickImportModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportValue?.focus();
    refs.quickImportValue?.select();
  });
}

function setQuickImportIndex(nextIndex) {
  const items = getQuickImportItems();
  if (items.length === 0) {
    state.quickImport.index = 0;
    renderQuickImportModal();
    return;
  }

  state.quickImport.index = Math.min(Math.max(nextIndex, 0), items.length - 1);
  resetQuickImportDraft(items[state.quickImport.index]);
  renderQuickImportModal();
  focusQuickImportValue();
}

function setQuickImportMode(mode) {
  if (!["initial", "supplier"].includes(mode)) {
    return;
  }

  state.quickImport.mode = mode;
  resetQuickImportDraft();
  renderQuickImportModal();
  focusQuickImportValue();
}

function buildQuickImportFallbackItems() {
  return state.products
    .filter((product) => product.active)
    .map((product) => ({
      ...product,
      soldToday: null,
      recordedStock: roundStock(product.stock),
    }));
}

async function loadQuickImportItems() {
  state.quickImport.loading = true;
  renderQuickImportModal();

  try {
    const response = await requestAdminJson(
      `/api/inventory/quick-import?branch=${encodeURIComponent(getAdminActionBranch())}`,
    );
    state.quickImport.items = Array.isArray(response.items)
      ? response.items.map((item) => normalizeQuickImportItem(item))
      : [];
  } catch (_error) {
    state.quickImport.items = buildQuickImportFallbackItems();
    showToast(
      "No fue posible traer ventas del dia para la captura rapida. Se usara el inventario local.",
      "info",
    );
  } finally {
    state.quickImport.index = 0;
    state.quickImport.loading = false;
    resetQuickImportDraft(getCurrentQuickImportItem());
    renderQuickImportModal();
    focusQuickImportValue();
  }
}

function getQuickImportResultValue() {
  const item = getCurrentQuickImportItem();
  if (!item) {
    return 0;
  }

  const parsedValue = Number(state.quickImport.currentValue);
  if (!Number.isFinite(parsedValue)) {
    return roundStock(item.recordedStock);
  }

  if (state.quickImport.mode === "supplier") {
    return roundStock(
      item.recordedStock + (state.quickImport.direction === "out" ? -parsedValue : parsedValue),
    );
  }

  return roundStock(item.recordedStock + parsedValue);
}

function updateQuickImportResult() {
  const item = getCurrentQuickImportItem();
  if (!item || !refs.quickImportStockResult) {
    return;
  }

  refs.quickImportStockResult.textContent = formatQuickImportValue(
    getQuickImportResultValue(),
    item.unit,
  );
}

function renderQuickImportNextList() {
  if (!refs.quickImportNextList) {
    return;
  }

  const items = getQuickImportItems();
  if (items.length === 0) {
    refs.quickImportNextList.innerHTML = `
      <div class="empty-state">
        Cuando abras la captura apareceran aqui los productos siguientes.
      </div>
    `;
    return;
  }

  refs.quickImportNextList.innerHTML = items
    .slice(state.quickImport.index, state.quickImport.index + 5)
    .map((item, offset) => {
      const absoluteIndex = state.quickImport.index + offset;
      return `
        <button
          class="quick-import-next-item ${absoluteIndex === state.quickImport.index ? "active" : ""}"
          data-index="${absoluteIndex}"
          type="button"
        >
          <span>${absoluteIndex + 1}. ${escapeHtml(item.name)}</span>
          <strong>${formatQuickImportValue(item.recordedStock, item.unit)}</strong>
        </button>
      `;
    })
    .join("");
}

function renderQuickImportModal() {
  if (!refs.quickImportModal) {
    return;
  }

  const items = getQuickImportItems();
  const item = getCurrentQuickImportItem();
  const hasItems = items.length > 0 && item;
  const isSupplierMode = state.quickImport.mode === "supplier";
  const isSupplierOut = isSupplierMode && state.quickImport.direction === "out";
  const progress = hasItems ? ((state.quickImport.index + 1) / items.length) * 100 : 0;

  refs.quickImportModeBar?.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.quickImport.mode);
  });

  refs.quickImportDescription.textContent = isSupplierMode
    ? isSupplierOut
      ? "Descuenta rapido lo que el proveedor se lleva y avanza con Enter."
      : "Suma lo que entrega el proveedor sobre la existencia actual y avanza con Enter."
    : "Captura inventario inicial para sumarlo sobre lo ya descontado por ventas del dia.";
  refs.quickImportValueLabel.textContent = isSupplierMode
    ? isSupplierOut
      ? "Cantidad que se lleva"
      : "Cantidad recibida"
    : "Inventario inicial a sumar";
  refs.quickImportHelper.textContent = isSupplierMode
    ? isSupplierOut
      ? "Presiona Enter para descontar la salida del proveedor y pasar al siguiente producto."
      : "Presiona Enter para sumar la entrada del proveedor y pasar al siguiente producto."
    : "Presiona Enter para sumar el inventario inicial y conservar lo ya vendido hoy.";
  refs.quickImportDirectionField.hidden = !isSupplierMode;
  refs.quickImportProviderField.hidden = !isSupplierMode;
  refs.quickImportDirection.value = state.quickImport.direction;
  refs.quickImportSupplier.value = state.quickImport.supplierName;
  refs.quickImportNote.value = state.quickImport.note;

  refs.quickImportProgressText.textContent = hasItems
    ? `${state.quickImport.index + 1} de ${items.length}`
    : "0 de 0";
  refs.quickImportProgressFill.style.width = `${Math.max(progress, hasItems ? 8 : 0)}%`;

  if (state.quickImport.loading) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "Cargando productos para captura rapida...";
    refs.quickImportContent.hidden = true;
    refs.quickImportPrevButton.disabled = true;
    refs.quickImportSkipButton.disabled = true;
    refs.quickImportSaveButton.disabled = true;
    renderQuickImportNextList();
    return;
  }

  if (!hasItems) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "No hay productos activos para captura rapida.";
    refs.quickImportContent.hidden = true;
    refs.quickImportPrevButton.disabled = true;
    refs.quickImportSkipButton.disabled = false;
    refs.quickImportSkipButton.textContent = "Cerrar";
    refs.quickImportSaveButton.disabled = true;
    refs.quickImportSaveButton.textContent = "Guardar y siguiente";
    renderQuickImportNextList();
    return;
  }

  refs.quickImportEmpty.hidden = true;
  refs.quickImportContent.hidden = false;
  refs.quickImportProductName.textContent = item.name;
  refs.quickImportProductMeta.textContent = `${item.categoryLabel} · ${item.unit}`;
  refs.quickImportProductStatus.className = `status-chip ${item.status}`;
  refs.quickImportProductStatus.textContent = getStatusLabel(item.status);
  refs.quickImportStockBefore.textContent = formatQuickImportValue(item.recordedStock, item.unit);
  refs.quickImportSoldToday.textContent = formatQuickImportValue(item.soldToday, item.unit);

  refs.quickImportValue.step = String(getProductStep(item));
  refs.quickImportValue.min = isSupplierMode ? String(getProductMin(item)) : "0";
  refs.quickImportValue.placeholder = isSupplierMode
    ? isSupplierOut
      ? "Captura lo que se lleva"
      : "Captura lo recibido"
    : "Captura el inventario inicial";
  refs.quickImportValue.value = state.quickImport.currentValue;

  refs.quickImportPrevButton.disabled = state.quickImport.index === 0 || state.quickImport.saving;
  refs.quickImportSkipButton.disabled = state.quickImport.saving;
  refs.quickImportSkipButton.textContent =
    state.quickImport.index >= items.length - 1 ? "Cerrar" : "Saltar";
  refs.quickImportSaveButton.disabled = state.quickImport.saving;
  refs.quickImportSaveButton.textContent = state.quickImport.saving
    ? "Guardando..."
    : state.quickImport.index >= items.length - 1
      ? "Guardar y terminar"
      : "Guardar y siguiente";

  updateQuickImportResult();
  renderQuickImportNextList();
}

async function openQuickImportModal() {
  if (!state.admin.token) {
    await openAdminAuthModal();
    return;
  }

  if (getAdminBranch() === "all") {
    showToast("Selecciona una sucursal especifica en admin para la importacion rapida.", "info");
    return;
  }

  setModalOpen(refs.quickImportModal, true);
  await loadQuickImportItems();
}

function closeQuickImportModal() {
  setModalOpen(refs.quickImportModal, false);
}

async function saveQuickImportEntry() {
  const item = getCurrentQuickImportItem();

  // === DEBUG (quítalo después de que funcione) ===
  console.log('[QUICK-IMPORT FRONTEND DEBUG] item actual:', item);
  console.log('[QUICK-IMPORT FRONTEND DEBUG] quickImport.items.length:', getQuickImportItems().length);

  if (!item || state.quickImport.saving) {
    showToast("No hay producto seleccionado.", "error");
    return;
  }

  const rawValue = String(state.quickImport.currentValue || "").trim();
  if (rawValue === "") {
    showToast("Captura un valor antes de continuar.", "error");
    focusQuickImportValue();
    return;
  }

  const isSupplierMode = state.quickImport.mode === "supplier";
  const isSupplierOut = isSupplierMode && state.quickImport.direction === "out";
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue)) {
    showToast("El valor capturado no es valido.", "error");
    focusQuickImportValue();
    return;
  }

  const parsedValue = roundStock(numericValue);

  // VALIDACIONES
  if (isSupplierMode && parsedValue <= 0) {
    showToast("La cantidad del proveedor debe ser mayor a cero.", "error");
    focusQuickImportValue();
    return;
  }
  if (isSupplierOut && parsedValue > roundStock(item.recordedStock || 0)) {
    showToast("No puedes descontar más de lo que existe.", "error");
    focusQuickImportValue();
    return;
  }
  if (!isSupplierMode && parsedValue < 0) {
    showToast("La existencia no puede ser negativa.", "error");
    focusQuickImportValue();
    return;
  }

  // === PAYLOAD BLINDADO (esto arregla el {} vacío) ===
  const safeItem = {
    id: Number(item.id ?? item.productId ?? item.product_id),
    name: String(item.name || item.productName || "Producto sin nombre").trim(),
  };

  const payload = {
    productId: safeItem.id,
    productName: safeItem.name,
    mode: state.quickImport.mode,
    branch: getAdminActionBranch(),
    note: state.quickImport.note.trim(),
    supplierName: state.quickImport.supplierName.trim(),
  };

  if (isSupplierMode) {
    payload.quantity = parsedValue;
    payload.direction = state.quickImport.direction;
  } else {
    payload.stock = parsedValue;
  }

  console.log('[QUICK-IMPORT FRONTEND DEBUG] Payload que se envía:', payload);

  state.quickImport.saving = true;
  renderQuickImportModal();

  try {
    const response = await requestAdminJson("/api/inventory/quick-import", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await refreshCurrentSnapshot();
    await refreshAdminWorkspace();
    state.quickImport.saving = false;

    if (state.quickImport.index >= getQuickImportItems().length - 1) {
      closeQuickImportModal();
      showToast("Captura rapida completada.", "success");
      return;
    }

    setQuickImportIndex(state.quickImport.index + 1);
  } catch (error) {
    showToast(error.message, "error");
    state.quickImport.saving = false;
    renderQuickImportModal();
    focusQuickImportValue();
  }
}

function goToPreviousQuickImportItem() {
  if (state.quickImport.index <= 0) {
    return;
  }

  setQuickImportIndex(state.quickImport.index - 1);
}

function skipQuickImportItem() {
  if (state.quickImport.index >= getQuickImportItems().length - 1) {
    closeQuickImportModal();
    return;
  }

  setQuickImportIndex(state.quickImport.index + 1);
}

function getEmptyRegisterSummary() {
  return {
    shift: refs.shiftSelect?.value || "Tarde",
    openingAmount: 0,
    cashSales: 0,
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

function renderRegisterSummaryPill() {
  if (!refs.registerSummaryPill) {
    return;
  }

  const summary = state.register.summary;
  if (!summary || !summary.lastStartAt) {
    refs.registerSummaryPill.textContent = `Caja sin iniciar para ${refs.shiftSelect?.value || "este turno"}`;
    return;
  }

  refs.registerSummaryPill.textContent =
    `${summary.shift} · Inicial ${formatCurrency(summary.openingAmount)} · Esperado ${formatCurrency(summary.expectedCash)}`;
}

function focusRegisterAmount() {
  if (!refs.registerModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.registerAmountInput?.focus();
    refs.registerAmountInput?.select();
  });
}

function renderRegisterModal() {
  if (!refs.registerModal) {
    return;
  }

  const summary = state.register.summary || getEmptyRegisterSummary();
  const isStartMode = state.register.mode === "start";
  const isQuickCutMode = state.register.mode === "quick_cut";

  refs.registerModalEyebrow.textContent = isStartMode ? "Inicio de caja" : "Corte de caja";
  refs.registerModalTitle.textContent = isStartMode
    ? "Inicio de dia"
    : isQuickCutMode
      ? "Corte rapido"
      : "Corte final";
  refs.registerModalDescription.textContent = isStartMode
    ? "Registra con cuanto arranca la caja del turno actual."
    : "Revisa el resumen del turno y guarda el corte con el efectivo contado.";
  refs.registerAmountLabel.textContent = isStartMode
    ? "Monto inicial de caja"
    : "Efectivo contado";
  refs.registerHelperText.textContent = isStartMode
    ? `Se guardara para el turno ${summary.shift}.`
    : `Turno ${summary.shift} · ${summary.tickets} tickets · ${summary.quickCuts} cortes rapidos hoy.`;
  refs.saveRegisterButton.textContent = state.register.saving
    ? "Guardando..."
    : isStartMode
      ? "Guardar inicio"
      : isQuickCutMode
        ? "Guardar corte rapido"
        : "Guardar corte final";
  refs.saveRegisterButton.disabled = state.register.loading || state.register.saving;
  refs.registerAmountInput.disabled = state.register.loading || state.register.saving;
  refs.registerNoteInput.disabled = state.register.loading || state.register.saving;

  refs.registerOpeningAmount.textContent = formatCurrency(summary.openingAmount);
  refs.registerCashSales.textContent = formatCurrency(summary.cashSales);
  refs.registerExpectedCash.textContent = formatCurrency(summary.expectedCash);
  refs.registerTotalSales.textContent = formatCurrency(summary.totalSales);
  refs.registerAmountInput.value = state.register.amountInput;
  refs.registerNoteInput.value = state.register.note;
}

async function loadRegisterSummary(options = {}) {
  if (!refs.shiftSelect) {
    return null;
  }

  const shift = options.shift || refs.shiftSelect.value;
  if (!options.silent) {
    state.register.loading = true;
    renderRegisterModal();
  }

  try {
    const response = await performJsonRequest(
      `/api/register/summary?shift=${encodeURIComponent(shift)}&branch=${encodeURIComponent(getActiveCashierBranch())}`,
    );
    state.register.summary = response.summary || getEmptyRegisterSummary();
    renderRegisterSummaryPill();
    return state.register.summary;
  } catch (error) {
    if (!options.silent) {
      showToast(error.message, "error");
    }
    return null;
  } finally {
    state.register.loading = false;
    renderRegisterModal();
  }
}

async function openRegisterModal(mode) {
  if (!requireCashierSession("Inicia sesion de cajero para usar la caja.")) {
    return;
  }

  state.register.mode = mode;
  state.register.note = "";
  state.register.amountInput = "";
  setModalOpen(refs.registerModal, true);
  const summary = await loadRegisterSummary();
  if (mode === "start") {
    state.register.amountInput = "";
  } else {
    state.register.amountInput = String(summary?.expectedCash ?? 0);
  }
  renderRegisterModal();
  focusRegisterAmount();
}

function closeRegisterModal() {
  setModalOpen(refs.registerModal, false);
}

async function saveRegisterAction() {
  if (!requireCashierSession("Inicia sesion de cajero para registrar caja.")) {
    return;
  }

  if (state.register.saving) {
    return;
  }

  const rawValue = String(state.register.amountInput || "").trim();
  if (rawValue === "") {
    showToast("Captura un monto antes de continuar.", "error");
    focusRegisterAmount();
    return;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    showToast("El monto capturado no es valido.", "error");
    focusRegisterAmount();
    return;
  }

  const payload = {
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    notes: state.register.note.trim(),
  };

  let url = "/api/register/start";
  if (state.register.mode === "start") {
    payload.openingAmount = roundMoney(numericValue);
  } else {
    url = "/api/register/cut";
    payload.eventType = state.register.mode;
    payload.countedAmount = roundMoney(numericValue);
  }

  state.register.saving = true;
  renderRegisterModal();

  try {
    const response = await requestJson(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (response.snapshot) {
      applySnapshot(response.snapshot);
    }
    state.register.summary = response.summary || state.register.summary;
    renderRegisterSummaryPill();
    closeRegisterModal();
    showToast(
      state.register.mode === "start"
        ? "Inicio de caja guardado."
        : `Corte guardado. Diferencia ${formatCurrency(response.differenceAmount || 0)}.`,
      "success",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.register.saving = false;
    renderRegisterModal();
  }
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

function renderAdminModal() {
  if (!refs.adminModal) {
    return;
  }

  if (!refs.adminModal.classList.contains("open") && !state.admin.loading) {
    return;
  }

  const adminSnapshot = state.admin.snapshot;
  const serverMetrics = state.admin.metrics;
  const clientMetrics = getClientMetrics();
  const currentBranch = adminSnapshot?.store?.currentBranch || getAdminBranch();
  const currentBranchLabel =
    adminSnapshot?.store?.currentBranchLabel || getBranchLabel(currentBranch);
  const summary = adminSnapshot?.summary || state.summary;
  const shiftSummary = Array.isArray(adminSnapshot?.shiftSummary)
    ? adminSnapshot.shiftSummary
    : [];

  setSelectOptions(refs.adminBranchSelect, getBranchOptions(), currentBranch);
  state.admin.branch = currentBranch;

  if (refs.adminBranchTitle) {
    refs.adminBranchTitle.textContent = currentBranchLabel;
  }

  if (refs.adminBranchDescription) {
    refs.adminBranchDescription.textContent =
      currentBranch === "all"
        ? "Admin viendo ventas y movimientos de ambas sucursales al mismo tiempo."
        : `Admin enfocado en ${currentBranchLabel} sin mover la caja activa.`;
  }

  if (refs.adminSummaryCards) {
    const topProductText = summary.topProduct
      ? `${summary.topProduct.name} lidera con ${formatCurrency(summary.topProduct.total)}`
      : "Sin ventas registradas hoy";

    refs.adminSummaryCards.innerHTML = `
      <article class="admin-metric-card">
        <span>Ventas del dia</span>
        <strong>${formatCurrency(summary.revenueToday || 0)}</strong>
        <p>${formatQuantity(summary.ticketsToday || 0)} tickets</p>
      </article>
      <article class="admin-metric-card">
        <span>Ticket promedio</span>
        <strong>${formatCurrency(summary.averageTicket || 0)}</strong>
        <p>${formatQuantity(summary.unitsSoldToday || 0)} unidades</p>
      </article>
      <article class="admin-metric-card">
        <span>Inventario</span>
        <strong>${formatCurrency(summary.inventoryValue || 0)}</strong>
        <p>${formatQuantity(summary.catalogSize || 0)} productos activos</p>
      </article>
      <article class="admin-metric-card">
        <span>Alertas</span>
        <strong>${formatQuantity(summary.lowStockCount || 0)}</strong>
        <p>${escapeHtml(topProductText)}</p>
      </article>
    `;
  }

  if (refs.adminShiftSummary) {
    refs.adminShiftSummary.innerHTML = shiftSummary.length
      ? shiftSummary
          .map(
            (item) => `
              <div class="shift-chip">
                ${escapeHtml(item.shift)} · ${formatQuantity(item.tickets)} tickets · ${formatCurrency(item.total)}
              </div>
            `,
          )
          .join("")
      : `<div class="shift-chip">Sin tickets registrados en esta vista.</div>`;
  }

  refs.adminMetricsStatus.textContent = state.admin.loading
    ? "Actualizando..."
    : serverMetrics
      ? `Actualizado ${timeFormatter.format(new Date(serverMetrics.generatedAt))}`
      : "Esperando datos";
  refs.adminProcessCpu.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.cpuPercent)}%`
    : "0%";
  refs.adminProcessMemory.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.rssMb)} MB`
    : "0 MB";
  refs.adminProductsRender.textContent = `${formatQuantity(state.performance.productsRenderMs)} ms`;
  refs.adminSnapshotRender.textContent = `${formatQuantity(state.performance.snapshotRenderMs)} ms`;
  refs.adminVisibleProducts.textContent = `${state.performance.renderedProductCount}/${state.products.length}`;
  refs.adminDomNodes.textContent = formatQuantity(clientMetrics.domNodes);
  refs.adminServerRuntime.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.uptimeSeconds)} s`
    : "0 s";
  refs.adminServerMemory.textContent = serverMetrics
    ? `RAM sistema ${formatQuantity(serverMetrics.system.usedMemoryPercent)}% · ${serverMetrics.system.cpuCount} CPU`
    : "RAM sistema 0%";
  refs.adminClientMemory.textContent =
    clientMetrics.usedHeapMb != null
      ? `${formatQuantity(clientMetrics.usedHeapMb)} MB JS`
      : "Sin dato";
  refs.adminClientHardware.textContent =
    `CPU ${formatQuantity(clientMetrics.hardwareConcurrency)} · RAM ${formatQuantity(clientMetrics.deviceMemory)} GB`;
  refs.adminClientNetwork.textContent = clientMetrics.network
    ? `Red ${clientMetrics.network.effectiveType} · ${formatQuantity(clientMetrics.network.downlink)} Mbps · ${formatQuantity(clientMetrics.network.rtt)} ms · pendientes ${state.pendingQueue.length}`
    : `Red ${state.online ? "en linea" : "offline"} · pendientes ${state.pendingQueue.length}`;
}

async function loadAdminMetrics() {
  state.admin.loading = true;
  renderAdminModal();

  try {
    state.admin.metrics = await requestAdminJson("/api/admin/metrics");
  } catch (_error) {
    // Evita toasts repetidos si el panel admin queda abierto sin conexion.
  } finally {
    state.admin.loading = false;
    renderAdminModal();
  }
}

function stopAdminMetricsPolling() {
  if (state.admin.pollTimerId) {
    window.clearInterval(state.admin.pollTimerId);
    state.admin.pollTimerId = null;
  }
}

function startAdminMetricsPolling() {
  stopAdminMetricsPolling();
  void loadAdminMetrics();
  state.admin.pollTimerId = window.setInterval(() => {
    void loadAdminMetrics();
  }, 10000);
}

async function openAdminModal() {
  console.log("[ADMIN] Intentando abrir panel admin...");

  // Si NO tenemos token de admin → siempre mostramos el modal de login/setup
  if (!state.admin.token) {
    console.log("[ADMIN] No hay token → abriendo auth modal");
    await openAdminAuthModal();
    return;
  }

  // Si tenemos token, verificamos que siga siendo válido
  try {
    await requestAdminJson("/api/admin/auth/status");
    console.log("[ADMIN] Token válido → abriendo panel");
  } catch (error) {
    console.log("[ADMIN] Token inválido o expirado → forzando login");
    state.admin.token = "";
    writeStorageText(STORAGE_KEYS.adminToken, "");
    await openAdminAuthModal();
    return;
  }

  // Todo correcto → abrimos el panel admin
  setModalOpen(refs.adminModal, true);
  renderInventory();
  renderAdminModal();
  startAdminMetricsPolling();
  await refreshAdminWorkspace();
}

function closeAdminModal() {
  setModalOpen(refs.adminModal, false);
  stopAdminMetricsPolling();
}

async function logoutAdmin() {
  try {
    await performJsonRequest("/api/admin/auth/logout", {
      method: "POST",
      headers: getAdminAuthHeaders(),
    });
  } catch (_error) {
    // Ignorar errores
  }
  state.admin.token = "";
  writeStorageText(STORAGE_KEYS.adminToken, "");
  state.admin.authenticated = false;
  closeAdminModal();
  showToast("Sesion cerrada", "info");
}

function renderAdminRecordLists() {
  if (!refs.adminSalesList) {
    return;
  }

  const sales = state.admin.editorData.sales || [];
  const registerEvents = state.admin.editorData.registerEvents || [];
  const inventoryMovements = state.admin.editorData.inventoryMovements || [];

  refs.adminSalesList.innerHTML = sales.length
    ? sales
        .map(
          (sale) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="sale" data-id="${sale.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(sale.ticketNumber)}</strong>
                <span class="small-pill">${formatCurrency(sale.total)}</span>
              </div>
              <p>${escapeHtml(sale.cashier)} · ${escapeHtml(sale.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin ventas recientes para editar.</div>`;

  refs.adminRegisterEventsList.innerHTML = registerEvents.length
    ? registerEvents
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="register" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(getRegisterEventLabel(item.eventType))}</strong>
                <span class="small-pill">${formatCurrency(item.countedAmount)}</span>
              </div>
              <p>${escapeHtml(item.cashier)} · ${escapeHtml(item.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin cortes o inicios recientes.</div>`;

  refs.adminInventoryMovementsList.innerHTML = inventoryMovements.length
    ? inventoryMovements
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="inventory" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(item.productName)}</strong>
                <span class="small-pill">${item.quantityDelta >= 0 ? "+" : ""}${escapeHtml(formatQuantity(item.quantityDelta))}</span>
              </div>
              <p>${escapeHtml(getInventoryMovementLabel(item.movementType))} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin movimientos recientes para editar.</div>`;
}

async function loadAdminEditorData() {
  try {
    const response = await requestAdminJson("/api/admin/editor-data");
    state.admin.editorData = {
      sales: Array.isArray(response.sales) ? response.sales : [],
      registerEvents: Array.isArray(response.registerEvents) ? response.registerEvents : [],
      inventoryMovements: Array.isArray(response.inventoryMovements) ? response.inventoryMovements : [],
    };
  } catch (_error) {
    state.admin.editorData = {
      sales: [],
      registerEvents: [],
      inventoryMovements: [],
    };
  } finally {
    renderAdminRecordLists();
  }
}

function renderAdminRecordLists() {
  if (!refs.adminSalesList) {
    return;
  }

  const sales = state.admin.editorData.sales || [];
  const registerEvents = state.admin.editorData.registerEvents || [];
  const inventoryMovements = state.admin.editorData.inventoryMovements || [];

  refs.adminSalesList.innerHTML = sales.length
    ? sales
        .map(
          (sale) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="sale" data-id="${sale.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(sale.ticketNumber)}</strong>
                <span class="small-pill">${formatCurrency(sale.total)}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(sale.branch))} · ${escapeHtml(sale.cashier)} · ${escapeHtml(sale.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin ventas recientes para editar.</div>`;

  refs.adminRegisterEventsList.innerHTML = registerEvents.length
    ? registerEvents
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="register" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(getRegisterEventLabel(item.eventType))}</strong>
                <span class="small-pill">${formatCurrency(item.countedAmount)}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(item.branch))} · ${escapeHtml(item.cashier)} · ${escapeHtml(item.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin cortes o inicios recientes.</div>`;

  refs.adminInventoryMovementsList.innerHTML = inventoryMovements.length
    ? inventoryMovements
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="inventory" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(item.productName)}</strong>
                <span class="small-pill">${item.quantityDelta >= 0 ? "+" : ""}${escapeHtml(formatQuantity(item.quantityDelta))}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(item.branch))} · ${escapeHtml(getInventoryMovementLabel(item.movementType))} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin movimientos recientes para editar.</div>`;
}

function renderAdminCashiers() {
  if (!refs.adminCashiersList) {
    return;
  }

  refs.adminCashiersList.innerHTML = state.admin.cashiers.length
    ? state.admin.cashiers
        .map(
          (cashier) => `
            <article class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(cashier.name)}</strong>
                <span class="small-pill">${escapeHtml(getBranchLabel(cashier.branch))}</span>
              </div>
              <p>${cashier.active ? "Activo" : "Inactivo"} · Alta ${escapeHtml(dateFormatter.format(new Date(cashier.created_at)))}</p>
              <div class="admin-record-actions">
                <button class="secondary-button compact-button" data-action="edit-cashier" data-id="${cashier.id}" type="button">
                  Editar
                </button>
                <button class="ghost-button compact-button" data-action="toggle-cashier" data-id="${cashier.id}" data-active="${cashier.active ? "1" : "0"}" type="button">
                  ${cashier.active ? "Desactivar" : "Activar"}
                </button>
                <button class="ghost-button compact-button danger-button" data-action="delete-cashier" data-id="${cashier.id}" type="button">
                  Eliminar
                </button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">No hay cajeros registrados para esta vista.</div>`;
}

async function loadAdminEditorData(branch = getAdminBranch()) {
  try {
    const response = await requestAdminJson(
      `/api/admin/editor-data?branch=${encodeURIComponent(branch)}`,
    );
    state.admin.editorData = {
      sales: Array.isArray(response.sales) ? response.sales : [],
      registerEvents: Array.isArray(response.registerEvents) ? response.registerEvents : [],
      inventoryMovements: Array.isArray(response.inventoryMovements) ? response.inventoryMovements : [],
    };
  } catch (_error) {
    state.admin.editorData = {
      sales: [],
      registerEvents: [],
      inventoryMovements: [],
    };
  } finally {
    renderAdminRecordLists();
  }
}

function renderAdminAuthModal() {
  if (!refs.adminAuthModal) {
    return;
  }

  const isSetup = state.adminAuth.mode === "setup";
  refs.adminAuthTitle.textContent = isSetup ? "Crear contrasena admin" : "Acceso admin";
  refs.adminAuthDescription.textContent = isSetup
    ? "Configura la contrasena para proteger el panel admin."
    : "Ingresa la contrasena para abrir el panel admin.";
  refs.adminAuthPasswordLabel.textContent = isSetup ? "Nueva contrasena" : "Contrasena";
  refs.adminAuthConfirmField.hidden = !isSetup;
  refs.saveAdminAuthButton.textContent = state.adminAuth.loading
    ? "Guardando..."
    : isSetup
      ? "Crear contrasena"
      : "Entrar";
  refs.saveAdminAuthButton.disabled = state.adminAuth.loading;
  refs.adminAuthPassword.disabled = state.adminAuth.loading;
  refs.adminAuthConfirmPassword.disabled = state.adminAuth.loading;
}

async function openAdminAuthModal() {
  await loadAdminAuthStatus();
  state.adminAuth.mode = state.admin.configured ? "login" : "setup";
  refs.adminAuthPassword.value = "";
  refs.adminAuthConfirmPassword.value = "";
  setModalOpen(refs.adminAuthModal, true);
  renderAdminAuthModal();
  window.requestAnimationFrame(() => refs.adminAuthPassword.focus());
}

function closeAdminAuthModal() {
  setModalOpen(refs.adminAuthModal, false);
}

async function submitAdminAuth() {
  const password = refs.adminAuthPassword.value.trim();
  const confirmPassword = refs.adminAuthConfirmPassword.value.trim();
  const isSetup = state.adminAuth.mode === "setup";

  if (password.length < 4) {
    showToast("La contrasena admin debe tener al menos 4 caracteres.", "error");
    return;
  }

  if (isSetup && password !== confirmPassword) {
    showToast("La confirmacion de contrasena no coincide.", "error");
    return;
  }

  state.adminAuth.loading = true;
  renderAdminAuthModal();

  try {
    if (isSetup) {
      await performJsonRequest("/api/admin/auth/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
    }

    const loginResponse = await performJsonRequest("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    state.admin.token = loginResponse.token || "";
    state.admin.authenticated = Boolean(state.admin.token);
    writeStorageText(STORAGE_KEYS.adminToken, state.admin.token);
    closeAdminAuthModal();
    openAdminModal();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminAuth.loading = false;
    renderAdminAuthModal();
  }
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

function renderAdminEditorModal() {
  if (!refs.adminEditorModal) {
    return;
  }

  const { kind, detail, loading, saving } = state.adminEditor;
  if (loading) {
    refs.adminEditorTitle.textContent = "Cargando...";
    refs.adminEditorDescription.textContent = "Preparando formulario de edicion.";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Cargando datos...</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  if (!detail) {
    refs.adminEditorTitle.textContent = "Sin registro";
    refs.adminEditorDescription.textContent = "";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Selecciona un registro para editar.</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  refs.saveAdminEditorButton.disabled = saving;
  refs.saveAdminEditorButton.textContent = saving ? "Guardando..." : "Guardar cambios";

  if (kind === "sale") {
    refs.adminEditorTitle.textContent = `Editar ${detail.ticketNumber}`;
    refs.adminEditorDescription.textContent = "Puedes ajustar datos administrativos de la venta.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Metodo de pago</span>
        <select data-editor-field="paymentMethod">
          ${["Efectivo", "Tarjeta", "Transferencia"].map((method) => `<option value="${method}" ${detail.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Recibido</span>
        <input data-editor-field="receivedAmount" type="number" min="0" step="0.01" value="${detail.receivedAmount}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="240" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  if (kind === "register") {
    refs.adminEditorTitle.textContent = `Editar ${getRegisterEventLabel(detail.eventType)}`;
    refs.adminEditorDescription.textContent = "Ajusta datos del inicio o corte de caja.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Caja inicial</span>
        <input data-editor-field="openingAmount" type="number" min="0" step="0.01" value="${detail.openingAmount}" />
      </label>
      <label class="field">
        <span>Efectivo contado</span>
        <input data-editor-field="countedAmount" type="number" min="0" step="0.01" value="${detail.countedAmount}" />
      </label>
      <label class="field">
        <span>Efectivo esperado</span>
        <input data-editor-field="expectedCash" type="number" min="0" step="0.01" value="${detail.expectedCash}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="180" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  refs.adminEditorTitle.textContent = `Editar ${detail.productName}`;
  refs.adminEditorDescription.textContent =
    detail.movementType === "sale"
      ? "Los movimientos por venta solo permiten editar la nota."
      : "Puedes ajustar cantidad y nota del movimiento.";
  refs.adminEditorBody.innerHTML = `
    <label class="field">
      <span>Movimiento</span>
      <input type="text" value="${escapeHtml(getInventoryMovementLabel(detail.movementType))}" disabled />
    </label>
    <label class="field">
      <span>Cantidad delta</span>
      <input data-editor-field="quantityDelta" type="number" step="0.25" value="${detail.quantityDelta}" ${detail.movementType === "sale" ? "disabled" : ""} />
    </label>
    <label class="field">
      <span>Nota</span>
      <input data-editor-field="note" type="text" maxlength="120" value="${escapeHtml(detail.note || "")}" />
    </label>
  `;
}

async function openAdminEditor(kind, id) {
  state.adminEditor.kind = kind;
  state.adminEditor.id = id;
  state.adminEditor.loading = true;
  state.adminEditor.detail = null;
  setModalOpen(refs.adminEditorModal, true);
  renderAdminEditorModal();

  try {
    const response = await requestAdminJson(`/api/activity/${encodeURIComponent(kind)}/${id}`);
    state.adminEditor.kind = response.kind;
    state.adminEditor.detail = response.detail;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.loading = false;
    renderAdminEditorModal();
  }
}

function closeAdminEditor() {
  setModalOpen(refs.adminEditorModal, false);
}

async function saveAdminEditor() {
  if (!state.adminEditor.detail || state.adminEditor.saving) {
    return;
  }

  const root = refs.adminEditorBody;
  const payload = {};
  root.querySelectorAll("[data-editor-field]").forEach((field) => {
    if (field.type === "number") {
      payload[field.dataset.editorField] = field.value === "" ? "" : Number(field.value);
    } else {
      payload[field.dataset.editorField] = field.value;
    }
  });

  let url = "";
  if (state.adminEditor.kind === "sale") {
    url = `/api/admin/sales/${state.adminEditor.id}`;
  } else if (state.adminEditor.kind === "register") {
    url = `/api/admin/register-events/${state.adminEditor.id}`;
  } else {
    url = `/api/admin/inventory-movements/${state.adminEditor.id}`;
    if (payload.note !== undefined) {
      payload.note = String(payload.note || "").trim();
    }
  }

  state.adminEditor.saving = true;
  renderAdminEditorModal();

  try {
    const response = await requestAdminJson(url, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (response.snapshot) {
      applySnapshot(response.snapshot);
    }
    await loadAdminEditorData();
    closeAdminEditor();
    showToast("Registro actualizado desde admin.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.saving = false;
    renderAdminEditorModal();
  }
}

function renderAdminEditorModal() {
  if (!refs.adminEditorModal) {
    return;
  }

  const { kind, detail, loading, saving } = state.adminEditor;
  if (loading) {
    refs.adminEditorTitle.textContent = "Cargando...";
    refs.adminEditorDescription.textContent = "Preparando formulario de edicion.";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Cargando datos...</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  if (!detail) {
    refs.adminEditorTitle.textContent = "Sin registro";
    refs.adminEditorDescription.textContent = "";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Selecciona un registro para editar.</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  refs.saveAdminEditorButton.disabled = saving;
  refs.saveAdminEditorButton.textContent = saving ? "Guardando..." : "Guardar cambios";

  if (kind === "cashier") {
    refs.adminEditorTitle.textContent = `Editar acceso de ${detail.name}`;
    refs.adminEditorDescription.textContent = "Actualiza nombre, sucursal, estado y la nueva clave si la necesitas.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Nombre</span>
        <input data-editor-field="name" type="text" maxlength="60" value="${escapeHtml(detail.name)}" />
      </label>
      <label class="field">
        <span>Sucursal</span>
        <select data-editor-field="branch">
          ${getBranchOptions().filter((option) => option.value !== "all").map((option) => `<option value="${option.value}" ${detail.branch === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Nueva contrasena</span>
        <input data-editor-field="password" type="password" maxlength="60" placeholder="Deja vacio para conservar la actual" />
      </label>
      <label class="field">
        <span>Estado</span>
        <select data-editor-field="active">
          <option value="true" ${detail.active ? "selected" : ""}>Activo</option>
          <option value="false" ${detail.active ? "" : "selected"}>Inactivo</option>
        </select>
      </label>
    `;
    return;
  }

  if (kind === "sale") {
    refs.adminEditorTitle.textContent = `Editar ${detail.ticketNumber}`;
    refs.adminEditorDescription.textContent = "Puedes ajustar datos administrativos de la venta.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Metodo de pago</span>
        <select data-editor-field="paymentMethod">
          ${["Efectivo", "Tarjeta", "Transferencia"].map((method) => `<option value="${method}" ${detail.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Recibido</span>
        <input data-editor-field="receivedAmount" type="number" min="0" step="0.01" value="${detail.receivedAmount}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="240" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  if (kind === "register") {
    refs.adminEditorTitle.textContent = `Editar ${getRegisterEventLabel(detail.eventType)}`;
    refs.adminEditorDescription.textContent = "Ajusta datos del inicio o corte de caja.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Caja inicial</span>
        <input data-editor-field="openingAmount" type="number" min="0" step="0.01" value="${detail.openingAmount}" />
      </label>
      <label class="field">
        <span>Efectivo contado</span>
        <input data-editor-field="countedAmount" type="number" min="0" step="0.01" value="${detail.countedAmount}" />
      </label>
      <label class="field">
        <span>Efectivo esperado</span>
        <input data-editor-field="expectedCash" type="number" min="0" step="0.01" value="${detail.expectedCash}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="180" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  refs.adminEditorTitle.textContent = `Editar ${detail.productName}`;
  refs.adminEditorDescription.textContent =
    detail.movementType === "sale"
      ? "Los movimientos por venta solo permiten editar la nota."
      : "Puedes ajustar cantidad y nota del movimiento.";
  refs.adminEditorBody.innerHTML = `
    <label class="field">
      <span>Movimiento</span>
      <input type="text" value="${escapeHtml(getInventoryMovementLabel(detail.movementType))}" disabled />
    </label>
    <label class="field">
      <span>Cantidad delta</span>
      <input data-editor-field="quantityDelta" type="number" step="0.25" value="${detail.quantityDelta}" ${detail.movementType === "sale" ? "disabled" : ""} />
    </label>
    <label class="field">
      <span>Nota</span>
      <input data-editor-field="note" type="text" maxlength="120" value="${escapeHtml(detail.note || "")}" />
    </label>
  `;
}

async function openAdminEditor(kind, id) {
  state.adminEditor.kind = kind;
  state.adminEditor.id = id;
  state.adminEditor.loading = true;
  state.adminEditor.detail = null;
  setModalOpen(refs.adminEditorModal, true);
  renderAdminEditorModal();

  try {
    if (kind === "cashier") {
      state.adminEditor.detail = state.admin.cashiers.find((cashier) => cashier.id === Number(id)) || null;
    } else {
      const response = await requestAdminJson(`/api/activity/${encodeURIComponent(kind)}/${id}`);
      state.adminEditor.kind = response.kind;
      state.adminEditor.detail = response.detail;
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.loading = false;
    renderAdminEditorModal();
  }
}

function renderCashierAuthModal() {
  if (!refs.cashierAuthModal) {
    return;
  }

  refs.loginCashierButton.disabled = state.cashierAuth.loading;
  refs.loginCashierButton.textContent = state.cashierAuth.loading ? "Iniciando..." : "Iniciar sesion";
}

function openCashierAuthModal() {
  refs.cashierAuthName.value = state.cashier.name || "";
  refs.cashierAuthBranch.value = state.cashier.branch || getActiveCashierBranch();
  refs.cashierAuthPassword.value = "";
  setModalOpen(refs.cashierAuthModal, true);
  renderCashierAuthModal();
  refs.cashierAuthName.focus();
}

function closeCashierAuthModal() {
  if (!state.cashier.authenticated) {
    return;
  }

  setModalOpen(refs.cashierAuthModal, false);
}

function clearCartForSessionChange() {
  if (state.cart.length === 0) {
    return;
  }

  state.cart = [];
  saveCart();
  renderCart();
  closePaymentModal();
  showToast("Se limpio el carrito para cambiar de sucursal sin mezclar ventas.", "info");
}

async function loginCashier() {
  if (state.cashierAuth.loading) {
    return;
  }

  const name = refs.cashierAuthName.value.trim();
  const branch = refs.cashierAuthBranch.value;
  const password = refs.cashierAuthPassword.value;

  if (!name || !branch || !password) {
    showToast("Completa todos los campos.", "error");
    return;
  }

  state.cashierAuth.loading = true;
  renderCashierAuthModal();

  try {
    const response = await performJsonRequest("/api/cashier/auth", {
      method: "POST",
      body: JSON.stringify({ name, branch, password }),
    });

    if (response.authenticated) {
      clearCartForSessionChange();
      state.cashier.name = name;
      state.cashier.branch = branch;
      state.cashier.authenticated = true;
      persistCashierSession();
      closeCashierAuthModal();
      await refreshCurrentSnapshot(branch);
      await loadRegisterSummary({ silent: true });
      renderCashierSession();
      showToast(`Bienvenido, ${name} (${getBranchLabel(branch)}).`, "success");
    } else {
      showToast("Credenciales incorrectas.", "error");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.cashierAuth.loading = false;
    renderCashierAuthModal();
  }
}

function logoutCashier() {
  clearCartForSessionChange();
  state.cashier.name = "";
  state.cashier.branch = "";
  state.cashier.authenticated = false;
  persistCashierSession();
  renderCashierSession();
}

async function saveAdminEditor() {
  if (!state.adminEditor.detail || state.adminEditor.saving) {
    return;
  }

  const root = refs.adminEditorBody;
  const payload = {};
  root.querySelectorAll("[data-editor-field]").forEach((field) => {
    if (field.type === "number") {
      payload[field.dataset.editorField] = field.value === "" ? "" : Number(field.value);
      return;
    }

    if (field.dataset.editorField === "active") {
      payload.active = field.value === "true";
      return;
    }

    payload[field.dataset.editorField] = field.value;
  });

  let url = "";
  if (state.adminEditor.kind === "sale") {
    url = `/api/admin/sales/${state.adminEditor.id}`;
  } else if (state.adminEditor.kind === "register") {
    url = `/api/admin/register-events/${state.adminEditor.id}`;
  } else if (state.adminEditor.kind === "inventory") {
    url = `/api/admin/inventory-movements/${state.adminEditor.id}`;
    if (payload.note !== undefined) {
      payload.note = String(payload.note || "").trim();
    }
  } else {
    url = `/api/admin/cashiers/${state.adminEditor.id}`;
    payload.password = String(payload.password || "").trim();
  }

  state.adminEditor.saving = true;
  renderAdminEditorModal();

  try {
    await requestAdminJson(url, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace();
    closeAdminEditor();
    showToast("Registro actualizado desde admin.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.saving = false;
    renderAdminEditorModal();
  }
}

async function submitAdminCashier() {
  const name = refs.adminCashierName.value.trim();
  const branch = refs.adminCashierBranch.value;
  const password = refs.adminCashierPassword.value.trim();

  if (!name || !branch || !password) {
    showToast("Completa nombre, sucursal y contrasena del cajero.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/cashiers", {
      method: "POST",
      body: JSON.stringify({ name, branch, password }),
    });
    refs.adminCashierName.value = "";
    refs.adminCashierPassword.value = "";
    await loadAdminCashiers(getAdminBranch());
    showToast("Cajero creado correctamente.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleAdminCashier(cashierId, isActive) {
  try {
    await requestAdminJson(`/api/admin/cashiers/${cashierId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !isActive }),
    });
    await loadAdminCashiers(getAdminBranch());
    showToast("Estado del cajero actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteAdminCashier(cashierId) {
  try {
    await requestAdminJson(`/api/admin/cashiers/${cashierId}`, {
      method: "DELETE",
    });
    await loadAdminCashiers(getAdminBranch());
    showToast("Cajero eliminado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function setModalOpen(modal, isOpen) {
  modal.classList.toggle("open", isOpen);
}

function openItemModal(product) {
  if (!requireCashierSession("Inicia sesion de cajero antes de agregar productos.")) {
    return;
  }

  state.currentProduct = product;
  refs.itemModalName.textContent = product.name;
  refs.itemModalMeta.textContent = `${product.categoryLabel} · Precio base ${formatCurrency(product.price)} · Stock ${formatProductStock(product)}`;
  refs.itemQuantity.step = String(getProductStep(product));
  refs.itemQuantity.min = String(getProductMin(product));
  refs.itemQuantity.value = String(getProductMin(product));
  refs.itemTotal.value = roundMoney(product.price * getProductMin(product)).toFixed(2);
  setModalOpen(refs.itemModal, true);
  refs.itemQuantity.focus();
  refs.itemQuantity.select();
}

function closeItemModal() {
  state.currentProduct = null;
  setModalOpen(refs.itemModal, false);
}

function syncItemTotalFromQuantity() {
  if (!state.currentProduct) {
    return;
  }

  const quantity = normalizeQuantityToStep(refs.itemQuantity.value, state.currentProduct);
  refs.itemQuantity.value = String(quantity);
  refs.itemTotal.value = roundMoney(quantity * state.currentProduct.price).toFixed(2);
}

function syncItemQuantityFromTotal() {
  if (!state.currentProduct) {
    return;
  }

  const rawValue = String(refs.itemTotal.value || "").trim();
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return;
  }

  const lineTotal = roundMoney(parsedValue);
  const quantity = normalizeQuantityFromLineTotal(lineTotal, state.currentProduct);

  refs.itemQuantity.value = String(quantity);
}

function finalizeItemTotalInput() {
  if (!state.currentProduct) {
    return;
  }

  const lineTotal = roundMoney(refs.itemTotal.value);
  if (lineTotal <= 0) {
    refs.itemTotal.value = roundMoney(
      state.currentProduct.price * getProductMin(state.currentProduct),
    ).toFixed(2);
    syncItemQuantityFromTotal();
    return;
  }

  refs.itemTotal.value = lineTotal.toFixed(2);
  syncItemQuantityFromTotal();
}

function adjustItemQuantity(delta) {
  if (!state.currentProduct) {
    return;
  }

  const step = getProductStep(state.currentProduct);
  const nextValue = Math.max(
    getProductMin(state.currentProduct),
    roundStock(toNumber(refs.itemQuantity.value, getProductMin(state.currentProduct)) + delta * step),
  );
  refs.itemQuantity.value = String(nextValue);
  syncItemTotalFromQuantity();
}

function addCurrentProductToCart() {
  if (!state.currentProduct) {
    return;
  }

  const quantity = roundStock(refs.itemQuantity.value);
  const lineTotal = roundMoney(refs.itemTotal.value);

  if (quantity <= 0 || lineTotal <= 0) {
    showToast("Captura una cantidad y un monto validos.", "error");
    return;
  }

  state.cart.push({
    productId: state.currentProduct.id,
    name: state.currentProduct.name,
    category: state.currentProduct.category,
    categoryLabel: state.currentProduct.categoryLabel,
    unit: state.currentProduct.unit,
    quantity,
    unitPrice: state.currentProduct.price,
    lineTotal,
  });

  saveCart();
  renderCart();
  closeItemModal();
  showToast(`${state.currentProduct.name} agregado al carrito.`, "success");
}

function removeCartItem(index) {
  state.cart.splice(index, 1);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function updatePaymentView() {
  const total = getCartTotal();
  const receivedAmount =
    state.paymentMethod === "Efectivo" ? roundMoney(state.moneyInput) : total;
  const changeAmount =
    state.paymentMethod === "Efectivo"
      ? roundMoney(receivedAmount - total)
      : 0;

  refs.paymentTotal.textContent = formatCurrency(total);
  refs.moneyDisplay.textContent = formatCurrency(receivedAmount);
  refs.paymentReceived.textContent = formatCurrency(receivedAmount);
  refs.paymentChange.textContent =
    state.paymentMethod === "Efectivo"
      ? changeAmount >= 0
        ? formatCurrency(changeAmount)
        : "Falta efectivo"
      : formatCurrency(0);

  refs.confirmSaleButton.disabled =
    total <= 0 || (state.paymentMethod === "Efectivo" && receivedAmount < total);

  refs.cashPaymentBlock.style.display =
    state.paymentMethod === "Efectivo" ? "block" : "none";

  refs.paymentMethods.querySelectorAll("[data-method]").forEach((button) => {
    button.classList.toggle("active", button.dataset.method === state.paymentMethod);
  });
}

function openPaymentModal() {
  if (!requireCashierSession("Inicia sesion de cajero antes de cobrar.")) {
    return;
  }

  if (state.cart.length === 0) {
    showToast("Agrega productos antes de cobrar.", "error");
    return;
  }

  state.moneyInput = "0";
  state.paymentMethod = "Efectivo";
  updatePaymentView();
  setModalOpen(refs.paymentModal, true);
}

function closePaymentModal() {
  setModalOpen(refs.paymentModal, false);
}

function appendMoneyInput(fragment) {
  if (fragment === "." && state.moneyInput.includes(".")) {
    return;
  }

  if (fragment === "00" && state.moneyInput === "0") {
    state.moneyInput = "0";
  } else if (state.moneyInput === "0" && fragment !== ".") {
    state.moneyInput = fragment;
  } else {
    state.moneyInput += fragment;
  }

  updatePaymentView();
}

function clearMoneyInput() {
  state.moneyInput = "0";
  updatePaymentView();
}

function backspaceMoneyInput() {
  if (state.moneyInput.length <= 1) {
    state.moneyInput = "0";
  } else {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  if (state.moneyInput.endsWith(".")) {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  updatePaymentView();
}

async function submitSale() {
  if (!requireCashierSession("Inicia sesion de cajero antes de completar la venta.")) {
    return;
  }

  const payload = {
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    paymentMethod: state.paymentMethod,
    receivedAmount:
      state.paymentMethod === "Efectivo" ? roundMoney(state.moneyInput) : getCartTotal(),
    items: state.cart.map((item) => ({
      productId: item.productId,
      productName: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };

  refs.confirmSaleButton.disabled = true;
  refs.confirmSaleButton.textContent = "Guardando...";

  try {
    const response = await requestJson("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
      queueable: true,
    });

    state.cart = [];
    saveCart();
    renderCart();
    applySnapshot(response.snapshot);
    void loadRegisterSummary({ silent: true });
    closePaymentModal();
    showToast(`Venta ${response.sale.ticketNumber} registrada.`, "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      applyOptimisticSale(payload);
      state.cart = [];
      saveCart();
      renderCart();
      void loadRegisterSummary({ silent: true });
      closePaymentModal();
      showToast(error.message, "info");
    } else {
      showToast(error.message, "error");
    }
  } finally {
    refs.confirmSaleButton.disabled = false;
    refs.confirmSaleButton.textContent = "Completar venta";
    updatePaymentView();
  }
}

async function saveInventoryRow(row) {
  const productId = Number(row.dataset.productId);
  const payload = {
    price: roundMoney(row.querySelector('[data-field="price"]').value),
    stock: roundStock(row.querySelector('[data-field="stock"]').value),
    minStock: roundStock(row.querySelector('[data-field="minStock"]').value),
    active: row.querySelector('[data-field="active"]').checked,
    branch: getAdminActionBranch(),
    note: row.querySelector('[data-field="note"]').value.trim(),
  };

  try {
    await requestAdminJson(`/api/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace();
    showToast("Inventario actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reimportCatalog() {
  refs.refreshCatalogButton.disabled = true;
  refs.refreshCatalogButton.textContent = "Importando...";

  try {
    const response = await requestAdminJson("/api/import-workbook", {
      method: "POST",
      body: JSON.stringify({ branch: getAdminActionBranch() }),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace();
    showToast(
      `Catalogo sincronizado con ${response.result.importedCount} productos.`,
      "success",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    refs.refreshCatalogButton.disabled = false;
    refs.refreshCatalogButton.textContent = "Reimportar catalogo";
  }
}

function exportWorkbook() {
  fetch("/api/export-workbook", {
    headers: getAdminAuthHeaders(),
  })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "No fue posible exportar el Excel.");
      }

      return response.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "cremeria-rincon-export.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    })
    .catch((error) => {
      showToast(error.message, "error");
    });
}

function updateClock() {
  const now = new Date();
  refs.liveDate.textContent = dateFormatter.format(now);
  refs.liveTime.textContent = timeFormatter.format(now);
}

function connectSocket() {
  if (typeof io !== "function") {
    return;
  }

  state.socket = io();

  state.socket.on("connect", () => {
    refs.socketStatus.textContent = "En vivo";
    state.online = true;
    renderSyncStatus();
  });

  state.socket.on("disconnect", () => {
    refs.socketStatus.textContent = state.online ? "Reconectando..." : "Sin conexion";
  });

  state.socket.on("dashboard:snapshot", (snapshot) => {
    if (!state.online) {
      return;
    }

    void refreshCurrentSnapshot().catch(() => {});
    if (refs.adminModal?.classList.contains("open") && state.admin.token) {
      void refreshAdminWorkspace().catch(() => {});
    }
  });
}

async function syncPendingQueue() {
  if (!state.online || state.syncingQueue || state.pendingQueue.length === 0) {
    renderSyncStatus();
    return;
  }

  state.syncingQueue = true;
  renderSyncStatus();

  while (state.pendingQueue.length > 0) {
    const operation = state.pendingQueue[0];

    try {
      await performJsonRequest(operation.url, {
        method: operation.method,
        body: operation.body,
      });
      state.pendingQueue.shift();
      saveQueue();
      renderSyncStatus();
    } catch (error) {
      if (isNetworkError(error)) {
        break;
      }

      state.pendingQueue.shift();
      saveQueue();
      showToast("Una operacion pendiente fue descartada por error del servidor.", "error");
    }
  }

  state.syncingQueue = false;
  renderSyncStatus();

  if (state.online) {
    try {
      await refreshCurrentSnapshot();
      if (state.pendingQueue.length === 0) {
        showToast("Sincronizacion completada.", "success");
      }
    } catch (_error) {
      renderSyncStatus();
    }
  }
}

function registerConnectionEvents() {
  window.addEventListener("online", () => {
    state.online = true;
    refs.socketStatus.textContent = "Reconectando...";
    renderSyncStatus();
    syncPendingQueue();
  });

  window.addEventListener("offline", () => {
    state.online = false;
    refs.socketStatus.textContent = "Sin conexion";
    renderSyncStatus();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("/sw.js").catch(() => {
    showToast("No fue posible activar el modo offline completo.", "error");
  });
}

async function bootstrap() {
  refs.summaryCards = $("summary-cards");
  refs.productsGrid = $("products-grid");
  refs.categoryFilters = $("category-filters");
  refs.cartItems = $("cart-items");
  refs.cartCount = $("cart-count");
  refs.cartTotal = $("cart-total");
  refs.recentSales = $("recent-sales");
  refs.activityList = $("activity-list");
  refs.lowStockList = $("low-stock-list");
  refs.trendChart = $("trend-chart");
  refs.shiftSummary = $("shift-summary");
  refs.inventoryBody = $("inventory-body");
  refs.toastRegion = $("toast-region");
  refs.shiftSelect = $("shift-select");
  refs.cashierInput = $("cashier-input");
  refs.searchInput = $("search-input");
  refs.openAdminButton = $("open-admin-button");
  refs.headerAdminButton = $("header-admin-button");
  refs.branchDisplay = $("branch-display");
  refs.cashierSessionLabel = $("cashier-session-label");
  refs.cashierSessionHelper = $("cashier-session-helper");
  refs.switchCashierButton = $("switch-cashier-button");
  refs.logoutCashierButton = $("logout-cashier-button");
  refs.openStartRegisterButton = $("open-start-register-button");
  refs.openQuickCutButton = $("open-quick-cut-button");
  refs.openFinalCutButton = $("open-final-cut-button");
  refs.registerSummaryPill = $("register-summary-pill");
  refs.openQuickImportButton = $("open-quick-import-button");
  refs.refreshCatalogButton = $("refresh-catalog-button");
  refs.exportWorkbookButton = $("export-workbook-button");
  refs.openPaymentButton = $("open-payment-button");
  refs.clearCartButton = $("clear-cart-button");
  refs.itemModal = $("item-modal");
  refs.itemModalName = $("item-modal-name");
  refs.itemModalMeta = $("item-modal-meta");
  refs.itemQuantity = $("item-quantity");
  refs.itemTotal = $("item-total");
  refs.paymentModal = $("payment-modal");
  refs.paymentTotal = $("payment-total");
  refs.paymentMethods = $("payment-methods");
  refs.moneyDisplay = $("money-display");
  refs.paymentReceived = $("payment-received");
  refs.paymentChange = $("payment-change");
  refs.confirmSaleButton = $("confirm-sale-button");
  refs.cashPaymentBlock = $("cash-payment-block");
  refs.quickImportModal = $("quick-import-modal");
  refs.quickImportModeBar = $("quick-import-mode-bar");
  refs.quickImportDescription = $("quick-import-description");
  refs.quickImportProgressText = $("quick-import-progress-text");
  refs.quickImportProgressFill = $("quick-import-progress-fill");
  refs.quickImportEmpty = $("quick-import-empty");
  refs.quickImportContent = $("quick-import-content");
  refs.quickImportProductName = $("quick-import-product-name");
  refs.quickImportProductMeta = $("quick-import-product-meta");
  refs.quickImportProductStatus = $("quick-import-product-status");
  refs.quickImportStockBefore = $("quick-import-stock-before");
  refs.quickImportSoldToday = $("quick-import-sold-today");
  refs.quickImportStockResult = $("quick-import-stock-result");
  refs.quickImportDirectionField = $("quick-import-direction-field");
  refs.quickImportDirection = $("quick-import-direction");
  refs.quickImportProviderField = $("quick-import-provider-field");
  refs.quickImportSupplier = $("quick-import-supplier");
  refs.quickImportValueLabel = $("quick-import-value-label");
  refs.quickImportValue = $("quick-import-value");
  refs.quickImportNote = $("quick-import-note");
  refs.quickImportHelper = $("quick-import-helper");
  refs.quickImportNextList = $("quick-import-next-list");
  refs.quickImportPrevButton = $("quick-import-prev-button");
  refs.quickImportSkipButton = $("quick-import-skip-button");
  refs.quickImportSaveButton = $("quick-import-save-button");
  refs.registerModal = $("register-modal");
  refs.registerModalEyebrow = $("register-modal-eyebrow");
  refs.registerModalTitle = $("register-modal-title");
  refs.registerModalDescription = $("register-modal-description");
  refs.registerOpeningAmount = $("register-opening-amount");
  refs.registerCashSales = $("register-cash-sales");
  refs.registerExpectedCash = $("register-expected-cash");
  refs.registerTotalSales = $("register-total-sales");
  refs.registerAmountLabel = $("register-amount-label");
  refs.registerAmountInput = $("register-amount-input");
  refs.registerNoteInput = $("register-note-input");
  refs.registerHelperText = $("register-helper-text");
  refs.saveRegisterButton = $("save-register-button");
  refs.detailViewerModal = $("detail-viewer-modal");
  refs.detailViewerTitle = $("detail-viewer-title");
  refs.detailViewerMeta = $("detail-viewer-meta");
  refs.detailViewerBody = $("detail-viewer-body");
  refs.adminModal = $("admin-modal");
  refs.adminBranchSelect = $("admin-branch-select");
  refs.adminBranchTitle = $("admin-branch-title");
  refs.adminBranchDescription = $("admin-branch-description");
  refs.adminLogoutButton = $("admin-logout-button");
  refs.adminMetricsStatus = $("admin-metrics-status");
  refs.adminSummaryCards = $("admin-summary-cards");
  refs.adminShiftSummary = $("admin-shift-summary");
  refs.adminProcessCpu = $("admin-process-cpu");
  refs.adminProcessMemory = $("admin-process-memory");
  refs.adminProductsRender = $("admin-products-render");
  refs.adminSnapshotRender = $("admin-snapshot-render");
  refs.adminVisibleProducts = $("admin-visible-products");
  refs.adminDomNodes = $("admin-dom-nodes");
  refs.adminServerRuntime = $("admin-server-runtime");
  refs.adminServerMemory = $("admin-server-memory");
  refs.adminClientMemory = $("admin-client-memory");
  refs.adminClientHardware = $("admin-client-hardware");
  refs.adminClientNetwork = $("admin-client-network");
  refs.adminSalesList = $("admin-sales-list");
  refs.adminRegisterEventsList = $("admin-register-events-list");
  refs.adminInventoryMovementsList = $("admin-inventory-movements-list");
  refs.adminCashierName = $("admin-cashier-name");
  refs.adminCashierBranch = $("admin-cashier-branch");
  refs.adminCashierPassword = $("admin-cashier-password");
  refs.saveAdminCashierButton = $("save-admin-cashier-button");
  refs.adminCashiersList = $("admin-cashiers-list");
  refs.adminAuthModal = $("admin-auth-modal");
  refs.adminAuthTitle = $("admin-auth-title");
  refs.adminAuthDescription = $("admin-auth-description");
  refs.adminAuthPasswordLabel = $("admin-auth-password-label");
  refs.adminAuthPassword = $("admin-auth-password");
  refs.adminAuthConfirmField = $("admin-auth-confirm-field");
  refs.adminAuthConfirmPassword = $("admin-auth-confirm-password");
  refs.saveAdminAuthButton = $("save-admin-auth-button");
  refs.adminEditorModal = $("admin-editor-modal");
  refs.adminEditorTitle = $("admin-editor-title");
  refs.adminEditorDescription = $("admin-editor-description");
  refs.adminEditorBody = $("admin-editor-body");
  refs.saveAdminEditorButton = $("save-admin-editor-button");
  refs.liveDate = $("live-date");
  refs.liveTime = $("live-time");
  refs.socketStatus = $("socket-status");
  refs.networkStatus = $("network-status");
  refs.syncStatus = $("sync-status");
  refs.cashierAuthModal = $("cashier-auth-modal");
  refs.cashierAuthName = $("cashier-auth-name");
  refs.cashierAuthBranch = $("cashier-auth-branch");
  refs.cashierAuthPassword = $("cashier-auth-password");
  refs.loginCashierButton = $("login-cashier-button");
  refs.closeCashierAuthModal = $("close-cashier-auth-modal");

  await restorePreferences();
  await restoreCart();
  await restoreQueue();
  await restoreCashierSession();
  state.admin.token = readStorageText(STORAGE_KEYS.adminToken, "");
  try {
    await loadAdminAuthStatus();
    if (!state.admin.authenticated) {
      state.admin.token = "";
      writeStorageText(STORAGE_KEYS.adminToken, "");
    }
  } catch (_error) {
    state.admin.configured = false;
    state.admin.authenticated = false;
  }

  renderCart();
  renderCashierSession();
  renderQuickImportModal();
  renderRegisterModal();
  renderRegisterSummaryPill();
  renderRecentActivity();
  renderDetailViewer();
  renderAdminModal();
  renderAdminRecordLists();
  renderAdminAuthModal();
  renderAdminEditorModal();
  renderCashierAuthModal();
  updateClock();
  renderSyncStatus();
  window.setInterval(updateClock, 1000);

  refs.searchInput.addEventListener("input", () => requestProductsRender(true));
  refs.openAdminButton.addEventListener("click", openAdminModal);
  if (refs.headerAdminButton) {
    refs.headerAdminButton.addEventListener("click", openAdminModal);
  }
  refs.adminBranchSelect.addEventListener("change", async () => {
    const branch = refs.adminBranchSelect.value;
    try {
      state.admin.branch = branch;
      await refreshAdminWorkspace();
      showToast(`Vista admin cambiada a ${getBranchLabel(branch)}`, "info");
    } catch (_error) {
      showToast("Error al cambiar sucursal", "error");
    }
  });
  refs.adminLogoutButton.addEventListener("click", logoutAdmin);
  refs.shiftSelect.addEventListener("change", () => {
    persistPreferences();
    void loadRegisterSummary({ silent: true });
  });
  refs.switchCashierButton.addEventListener("click", openCashierAuthModal);
  refs.logoutCashierButton.addEventListener("click", logoutCashier);
  refs.openStartRegisterButton.addEventListener("click", () => openRegisterModal("start"));
  refs.openQuickCutButton.addEventListener("click", () => openRegisterModal("quick_cut"));
  refs.openFinalCutButton.addEventListener("click", () => openRegisterModal("final_cut"));
  refs.openQuickImportButton.addEventListener("click", openQuickImportModal);
  refs.refreshCatalogButton.addEventListener("click", reimportCatalog);
  refs.exportWorkbookButton.addEventListener("click", exportWorkbook);
  refs.openPaymentButton.addEventListener("click", openPaymentModal);
  refs.clearCartButton.addEventListener("click", clearCart);
  $("close-admin-modal").addEventListener("click", closeAdminModal);
  $("close-admin-auth-modal").addEventListener("click", closeAdminAuthModal);
  $("cancel-admin-auth-button").addEventListener("click", closeAdminAuthModal);
  refs.saveAdminAuthButton.addEventListener("click", submitAdminAuth);
  refs.adminAuthPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdminAuth();
    }
  });
  refs.adminAuthConfirmPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdminAuth();
    }
  });
  $("close-admin-editor-modal").addEventListener("click", closeAdminEditor);
  $("cancel-admin-editor-button").addEventListener("click", closeAdminEditor);
  refs.saveAdminEditorButton.addEventListener("click", saveAdminEditor);
  $("close-item-modal").addEventListener("click", closeItemModal);
  $("cancel-item-button").addEventListener("click", closeItemModal);
  $("add-item-button").addEventListener("click", addCurrentProductToCart);
  refs.itemQuantity.addEventListener("input", syncItemTotalFromQuantity);
  refs.itemTotal.addEventListener("input", syncItemQuantityFromTotal);
  refs.itemTotal.addEventListener("blur", finalizeItemTotalInput);
  refs.itemTotal.addEventListener("focus", () => refs.itemTotal.select());
  $("close-payment-modal").addEventListener("click", closePaymentModal);
  $("cancel-payment-button").addEventListener("click", closePaymentModal);
  refs.confirmSaleButton.addEventListener("click", submitSale);
  $("close-quick-import-modal").addEventListener("click", closeQuickImportModal);
  refs.quickImportPrevButton.addEventListener("click", goToPreviousQuickImportItem);
  refs.quickImportSkipButton.addEventListener("click", skipQuickImportItem);
  refs.quickImportSaveButton.addEventListener("click", saveQuickImportEntry);
  refs.quickImportDirection.addEventListener("change", () => {
    state.quickImport.direction = refs.quickImportDirection.value;
    updateQuickImportResult();
    renderQuickImportModal();
  });
  refs.quickImportModeBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }

    setQuickImportMode(button.dataset.mode);
  });
  refs.quickImportNextList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (!button) {
      return;
    }

    setQuickImportIndex(Number(button.dataset.index));
  });
  refs.quickImportSupplier.addEventListener("input", () => {
    state.quickImport.supplierName = refs.quickImportSupplier.value;
  });
  refs.quickImportValue.addEventListener("input", () => {
    state.quickImport.currentValue = refs.quickImportValue.value;
    updateQuickImportResult();
  });
  refs.quickImportNote.addEventListener("input", () => {
    state.quickImport.note = refs.quickImportNote.value;
  });
  $("close-register-modal").addEventListener("click", closeRegisterModal);
  $("cancel-register-button").addEventListener("click", closeRegisterModal);
  refs.saveRegisterButton.addEventListener("click", saveRegisterAction);
  refs.registerAmountInput.addEventListener("input", () => {
    state.register.amountInput = refs.registerAmountInput.value;
  });
  refs.registerNoteInput.addEventListener("input", () => {
    state.register.note = refs.registerNoteInput.value;
  });
  refs.registerAmountInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRegisterAction();
    }
  });
  refs.registerNoteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRegisterAction();
    }
  });
  refs.quickImportSupplier.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusQuickImportValue();
    }
  });
  refs.quickImportValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveQuickImportEntry();
    }
  });
  refs.quickImportNote.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveQuickImportEntry();
    }
  });

  refs.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) {
      return;
    }

    state.selectedCategory = button.dataset.category;
    renderCategoryFilters();
    requestProductsRender(true);
  });

  refs.productsGrid.addEventListener("click", (event) => {
    const loadMoreButton = event.target.closest('[data-action="load-more-products"]');
    if (loadMoreButton) {
      loadMoreProducts();
      return;
    }

    const button = event.target.closest('[data-action="open-product"]');
    if (!button) {
      return;
    }

    const product = state.products.find(
      (item) => item.id === Number(button.dataset.productId),
    );

    if (product) {
      openItemModal(product);
    }
  });

  refs.productsGrid.addEventListener("scroll", () => {
    if (
      refs.productsGrid.scrollTop + refs.productsGrid.clientHeight >=
      refs.productsGrid.scrollHeight - 240
    ) {
      loadMoreProducts();
    }
  });

  refs.cartItems.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-cart-item"]');
    if (!button) {
      return;
    }

    removeCartItem(Number(button.dataset.index));
  });

  refs.itemModal.addEventListener("click", (event) => {
    if (event.target === refs.itemModal) {
      closeItemModal();
    }
  });

  refs.paymentModal.addEventListener("click", (event) => {
    if (event.target === refs.paymentModal) {
      closePaymentModal();
    }
  });

  refs.recentSales.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-activity-detail"]');
    if (!button) {
      return;
    }

    void openActivityDetail(button.dataset.kind, button.dataset.id);
  });

  refs.activityList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-activity-detail"]');
    if (!button) {
      return;
    }

    void openActivityDetail(button.dataset.kind, button.dataset.id);
  });

  refs.adminSalesList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }

    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminRegisterEventsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }

    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminInventoryMovementsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }

    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminCashiersList.addEventListener("click", (event) => {
    const editButton = event.target.closest('[data-action="edit-cashier"]');
    if (editButton) {
      void openAdminEditor("cashier", editButton.dataset.id);
      return;
    }

    const toggleButton = event.target.closest('[data-action="toggle-cashier"]');
    if (toggleButton) {
      void toggleAdminCashier(
        Number(toggleButton.dataset.id),
        toggleButton.dataset.active === "1",
      );
      return;
    }

    const deleteButton = event.target.closest('[data-action="delete-cashier"]');
    if (deleteButton) {
      void deleteAdminCashier(Number(deleteButton.dataset.id));
    }
  });

  refs.quickImportModal.addEventListener("click", (event) => {
    if (event.target === refs.quickImportModal) {
      closeQuickImportModal();
    }
  });

  refs.registerModal.addEventListener("click", (event) => {
    if (event.target === refs.registerModal) {
      closeRegisterModal();
    }
  });

  $("close-detail-viewer-modal").addEventListener("click", closeDetailViewer);
  refs.detailViewerModal.addEventListener("click", (event) => {
    if (event.target === refs.detailViewerModal) {
      closeDetailViewer();
    }
  });

  refs.adminModal.addEventListener("click", (event) => {
    if (event.target === refs.adminModal) {
      closeAdminModal();
    }
  });

  refs.adminAuthModal.addEventListener("click", (event) => {
    if (event.target === refs.adminAuthModal) {
      closeAdminAuthModal();
    }
  });

  refs.adminEditorModal.addEventListener("click", (event) => {
    if (event.target === refs.adminEditorModal) {
      closeAdminEditor();
    }
  });

  refs.cashierAuthModal.addEventListener("click", (event) => {
    if (event.target === refs.cashierAuthModal) {
      closeCashierAuthModal();
    }
  });

  refs.closeCashierAuthModal.addEventListener("click", closeCashierAuthModal);
  refs.loginCashierButton.addEventListener("click", loginCashier);
  refs.saveAdminCashierButton.addEventListener("click", submitAdminCashier);
  refs.cashierAuthName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginCashier();
    }
  });
  refs.cashierAuthPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginCashier();
    }
  });

  refs.itemModal.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustItemQuantity(Number(button.dataset.step));
    });
  });

  refs.paymentMethods.addEventListener("click", (event) => {
    const button = event.target.closest("[data-method]");
    if (!button) {
      return;
    }

    state.paymentMethod = button.dataset.method;
    if (state.paymentMethod !== "Efectivo") {
      state.moneyInput = String(getCartTotal());
    }
    updatePaymentView();
  });

  $("payment-keypad").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    if (button.dataset.action === "clear-money") {
      clearMoneyInput();
      return;
    }

    if (button.dataset.action === "backspace") {
      backspaceMoneyInput();
      return;
    }

    if (button.dataset.digit) {
      appendMoneyInput(button.dataset.digit);
    }
  });

  refs.inventoryBody.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="save-product"]');
    if (!button) {
      return;
    }

    saveInventoryRow(button.closest("tr"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== refs.searchInput) {
      event.preventDefault();
      refs.searchInput.focus();
    }

    if (event.key === "Escape") {
      closeItemModal();
      closePaymentModal();
      closeQuickImportModal();
      closeRegisterModal();
      closeDetailViewer();
      closeAdminModal();
      closeAdminAuthModal();
      closeAdminEditor();
    }
  });

  registerConnectionEvents();
  registerServiceWorker();

  const cachedSnapshot = await restoreSnapshot();
  if (cachedSnapshot) {
    applySnapshot(cachedSnapshot, { skipPersist: true });
    if (!state.online) {
      refs.socketStatus.textContent = "Sin conexion";
      showToast("Cargando ultimo estado guardado en modo offline.", "info");
    }
  }

  try {
    const snapshot = await performJsonRequest(
      `/api/bootstrap?branch=${encodeURIComponent(getActiveCashierBranch())}`,
    );
    applySnapshot(snapshot);
  } catch (_error) {
    if (cachedSnapshot) {
      refs.socketStatus.textContent = "Sin conexion";
      showToast("Trabajando con el ultimo estado guardado localmente.", "info");
    } else {
      throw _error;
    }
  }

  connectSocket();
  updatePaymentView();
  await loadRegisterSummary({ silent: true });
  syncPendingQueue();
  if (refs.openAdminButton) {
  refs.openAdminButton.disabled = false;
  refs.openAdminButton.style.opacity = "1";
}
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((error) => {
    console.error(error);
    showToast("No fue posible cargar el panel inicial.", "error");
  });
});
