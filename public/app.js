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
  cashier: "cremeria.cashier",
  snapshot: "cremeria.snapshot",
  queue: "cremeria.queue",
};
const OFFLINE_DB_NAME = "cremeria-rincon-offline";
const OFFLINE_DB_VERSION = 1;
const OFFLINE_DB_STORE = "app_state";

const state = {
  products: [],
  lowStock: [],
  recentSales: [],
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
  currentProduct: null,
  cart: [],
  paymentMethod: "Efectivo",
  moneyInput: "0",
  socket: null,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  pendingQueue: [],
  syncingQueue: false,
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
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "No fue posible completar la accion.");
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
    products: state.products,
    lowStock: state.lowStock,
    recentSales: state.recentSales,
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
  persistText(STORAGE_KEYS.cashier, refs.cashierInput.value.trim());
}

async function restorePreferences() {
  const savedShift = await readPersistedText(STORAGE_KEYS.shift, "");
  const savedCashier = await readPersistedText(STORAGE_KEYS.cashier, "");

  if (savedShift) {
    refs.shiftSelect.value = savedShift;
  }

  if (savedCashier) {
    refs.cashierInput.value = savedCashier;
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
  state.products = Array.isArray(snapshot.products) ? snapshot.products : [];
  state.lowStock = Array.isArray(snapshot.lowStock) ? snapshot.lowStock : [];
  state.recentSales = Array.isArray(snapshot.recentSales) ? snapshot.recentSales : [];
  state.salesByHour = Array.isArray(snapshot.salesByHour) ? snapshot.salesByHour : [];
  state.shiftSummary = Array.isArray(snapshot.shiftSummary) ? snapshot.shiftSummary : [];
  state.summary = snapshot.summary || state.summary;
  if (!options.skipPersist) {
    saveSnapshot(buildPersistedSnapshot());
  }

  renderSummary();
  renderCategoryFilters();
  renderProducts();
  renderLowStock();
  renderRecentSales();
  renderTrendChart();
  renderShiftSummary();
  renderInventory();
  renderSyncStatus();
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
  renderProducts();
  renderLowStock();
  renderInventory();
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
  renderProducts();
  renderLowStock();
  renderRecentSales();
  renderTrendChart();
  renderShiftSummary();
  renderInventory();
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

function renderProducts() {
  const products = getFilteredProducts();

  if (products.length === 0) {
    refs.productsGrid.innerHTML = `
      <div class="empty-state">
        No hay productos que coincidan con tu busqueda actual.
      </div>
    `;
    return;
  }

  refs.productsGrid.innerHTML = products
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
        <article class="feed-item sale-card">
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
        </article>
      `,
    )
    .join("");
};

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

function setModalOpen(modal, isOpen) {
  modal.classList.toggle("open", isOpen);
}

function openItemModal(product) {
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
  const payload = {
    shift: refs.shiftSelect.value,
    cashier: refs.cashierInput.value.trim() || "Mostrador",
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
    closePaymentModal();
    showToast(`Venta ${response.sale.ticketNumber} registrada.`, "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      applyOptimisticSale(payload);
      state.cart = [];
      saveCart();
      renderCart();
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
    note: row.querySelector('[data-field="note"]').value.trim(),
  };

  try {
    const response = await requestJson(`/api/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      queueable: true,
    });
    applySnapshot(response.snapshot);
    showToast("Inventario actualizado.", "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      applyOptimisticProductUpdate(productId, payload);
      showToast(error.message, "info");
    } else {
      showToast(error.message, "error");
    }
  }
}

async function reimportCatalog() {
  refs.refreshCatalogButton.disabled = true;
  refs.refreshCatalogButton.textContent = "Importando...";

  try {
    const response = await requestJson("/api/import-workbook", {
      method: "POST",
      body: JSON.stringify({}),
    });
    applySnapshot(response.snapshot);
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
  const anchor = document.createElement("a");
  anchor.href = "/api/export-workbook";
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
    applySnapshot(snapshot);
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
      const snapshot = await performJsonRequest("/api/bootstrap");
      applySnapshot(snapshot);
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
  refs.lowStockList = $("low-stock-list");
  refs.trendChart = $("trend-chart");
  refs.shiftSummary = $("shift-summary");
  refs.inventoryBody = $("inventory-body");
  refs.toastRegion = $("toast-region");
  refs.shiftSelect = $("shift-select");
  refs.cashierInput = $("cashier-input");
  refs.searchInput = $("search-input");
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
  refs.liveDate = $("live-date");
  refs.liveTime = $("live-time");
  refs.socketStatus = $("socket-status");
  refs.networkStatus = $("network-status");
  refs.syncStatus = $("sync-status");

  await restorePreferences();
  await restoreCart();
  await restoreQueue();
  renderCart();
  updateClock();
  renderSyncStatus();
  window.setInterval(updateClock, 1000);

  refs.searchInput.addEventListener("input", renderProducts);
  refs.shiftSelect.addEventListener("change", persistPreferences);
  refs.cashierInput.addEventListener("input", persistPreferences);
  refs.refreshCatalogButton.addEventListener("click", reimportCatalog);
  refs.exportWorkbookButton.addEventListener("click", exportWorkbook);
  refs.openPaymentButton.addEventListener("click", openPaymentModal);
  refs.clearCartButton.addEventListener("click", clearCart);
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

  refs.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) {
      return;
    }

    state.selectedCategory = button.dataset.category;
    renderCategoryFilters();
    renderProducts();
  });

  refs.productsGrid.addEventListener("click", (event) => {
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
    const snapshot = await performJsonRequest("/api/bootstrap");
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
  syncPendingQueue();
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((error) => {
    console.error(error);
    showToast("No fue posible cargar el panel inicial.", "error");
  });
});
