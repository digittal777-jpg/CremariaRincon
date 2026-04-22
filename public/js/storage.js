// Funciones de persistencia y almacenamiento offline

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
    registerEvents: state.register.events,  // Incluir eventos de caja
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

// === Persistencia de eventos de caja (cortes) ===

function saveRegisterEvents() {
  persistJson(STORAGE_KEYS.registerEvents, state.register.events);
}

async function restoreRegisterEvents() {
  state.register.events = await readPersistedJson(STORAGE_KEYS.registerEvents, []);
}

// Agregar un evento de caja offline
function addOfflineRegisterEvent(event) {
  const offlineEvent = {
    id: `offline-register-${Date.now()}`,
    ...event,
    createdAt: new Date().toISOString(),
    synced: false,
  };
  
  state.register.events.push(offlineEvent);
  saveRegisterEvents();
  
  return offlineEvent;
}

// Obtener eventos de caja para el turno actual
function getRegisterEventsForCurrentShift() {
  const currentShift = refs.shiftSelect?.value || "Tarde";
  return state.register.events.filter(
    (event) => event.shift === currentShift && event.branch === getActiveCashierBranch()
  );
}

// Calcular resumen de caja considerando eventos offline
function calculateRegisterSummaryWithOffline(summary, offlineEvents) {
  const currentShift = refs.shiftSelect?.value || "Tarde";
  const branch = getActiveCashierBranch();
  
  // Filtrar eventos offline del turno actual
  const shiftOfflineEvents = offlineEvents.filter(
    (e) => e.shift === currentShift && e.branch === branch
  );
  
  // Encontrar inicio de caja offline
  const offlineStartEvent = shiftOfflineEvents.find((e) => e.eventType === "start");
  
  // Calcular ventas offline
  const offlineCashSales = shiftOfflineEvents
    .filter((e) => e.eventType === "quick_cut" || e.eventType === "final_cut")
    .reduce((sum, e) => sum + (e.cashSales || 0), 0);
  const offlineWithdrawals = shiftOfflineEvents
    .filter((e) => e.eventType === "quick_cut" || e.eventType === "final_cut")
    .reduce((sum, e) => sum + (e.withdrawalsAmount || 0), 0);
  
  // Combinar con resumen del servidor
  return {
    ...summary,
    openingAmount: offlineStartEvent ? summary.openingAmount + offlineStartEvent.openingAmount : summary.openingAmount,
    cashSales: summary.cashSales + offlineCashSales,
    withdrawalsAmount: (summary.withdrawalsAmount || 0) + offlineWithdrawals,
    expectedCash: summary.expectedCash + offlineCashSales - offlineWithdrawals,
    quickCuts: summary.quickCuts + shiftOfflineEvents.filter((e) => e.eventType === "quick_cut").length,
    finalCuts: summary.finalCuts + shiftOfflineEvents.filter((e) => e.eventType === "final_cut").length,
  };
}