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

const deferredJsonTimers = new Map();
const deferredJsonValues = new Map();

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

function flushDeferredJsonPersist(key) {
  if (!deferredJsonValues.has(key)) {
    return;
  }

  const value = deferredJsonValues.get(key);
  deferredJsonValues.delete(key);

  if (deferredJsonTimers.has(key)) {
    clearTimeout(deferredJsonTimers.get(key));
    deferredJsonTimers.delete(key);
  }

  persistJson(key, value);
}

function persistJsonDeferred(key, value, delayMs = 250) {
  deferredJsonValues.set(key, value);

  if (deferredJsonTimers.has(key)) {
    clearTimeout(deferredJsonTimers.get(key));
  }

  const timerId = setTimeout(() => {
    flushDeferredJsonPersist(key);
  }, delayMs);
  deferredJsonTimers.set(key, timerId);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    flushDeferredJsonPersist(STORAGE_KEYS.snapshot);
    flushDeferredJsonPersist(STORAGE_KEYS.preparedSnapshots);
    flushDeferredJsonPersist(STORAGE_KEYS.offlineSales);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushDeferredJsonPersist(STORAGE_KEYS.snapshot);
      flushDeferredJsonPersist(STORAGE_KEYS.preparedSnapshots);
      flushDeferredJsonPersist(STORAGE_KEYS.offlineSales);
    }
  });
}

function buildPersistedSnapshot() {
  const authRole = state.cashier.authenticated
    ? "cashier"
    : state.owner.authenticated
      ? "owner"
      : state.admin.authenticated
        ? "admin"
        : "guest";
  return {
    store: state.store,
    profile: state.profile,
    enabledModules: state.enabledModules,
    categories: state.categories,
    units: state.units,
    productAttributeDefinitions: state.productAttributeDefinitions,
    products: state.products,
    lowStock: state.lowStock,
    recentSales: state.recentSales,
    recentActivity: state.recentActivity,
    salesByHour: state.salesByHour,
    shiftSummary: state.shiftSummary,
    summary: state.summary,
    auth: {
      role: authRole,
      adminAuthenticated: Boolean(state.admin.authenticated),
      cashierAuthenticated: Boolean(state.cashier.authenticated),
      ownerAuthenticated: Boolean(state.owner.authenticated),
      cashier: state.cashier.authenticated
        ? {
            id: state.cashier.id,
            name: state.cashier.name,
            branch: state.cashier.branch,
          }
        : null,
    },
    registerEvents: state.register.events,  // Incluir eventos de caja
  };
}

function canPersistPreparedSnapshot(snapshot) {
  const auth = snapshot?.auth;
  if (!auth || auth.role === "guest") {
    return false;
  }

  return Boolean(
    auth.cashierAuthenticated || auth.adminAuthenticated || auth.ownerAuthenticated,
  );
}

function saveSnapshot(snapshot, options = {}) {
  persistJsonDeferred(STORAGE_KEYS.snapshot, snapshot, 350);

  const snapshotBranch = String(snapshot?.store?.currentBranch || "");
  if (
    options.persistPreparedSnapshot !== false
    && canPersistPreparedSnapshot(snapshot)
    && snapshotBranch
    && snapshotBranch !== "all"
    && Array.isArray(snapshot?.products)
    && snapshot.products.length > 0
  ) {
    const currentPreparedSnapshots =
      deferredJsonValues.get(STORAGE_KEYS.preparedSnapshots)
      || readStorageJson(STORAGE_KEYS.preparedSnapshots, {});
    const nextPreparedSnapshots = {
      ...(currentPreparedSnapshots && typeof currentPreparedSnapshots === "object"
        ? currentPreparedSnapshots
        : {}),
      [snapshotBranch]: {
        ...snapshot,
        preparedAt: new Date().toISOString(),
      },
    };
    persistJsonDeferred(STORAGE_KEYS.preparedSnapshots, nextPreparedSnapshots, 350);
  }
}

async function restoreSnapshot() {
  return readPersistedJson(STORAGE_KEYS.snapshot, null);
}

async function restorePreparedSnapshot(branch) {
  const normalizedBranch = String(branch || "").trim();
  if (!normalizedBranch) {
    return null;
  }

  const preparedSnapshots = await readPersistedJson(STORAGE_KEYS.preparedSnapshots, {});
  if (!preparedSnapshots || typeof preparedSnapshots !== "object") {
    return null;
  }

  return preparedSnapshots[normalizedBranch] || null;
}

function saveQueue() {
  persistJson(STORAGE_KEYS.queue, state.pendingQueue);
  if (typeof syncOfflineSalesAuditWithQueue === "function") {
    syncOfflineSalesAuditWithQueue();
  }
  if (typeof scheduleClientSyncHealthReport === "function" && state.online) {
    scheduleClientSyncHealthReport();
  }
}

async function restoreQueue() {
  const restoredQueue = await readPersistedJson(STORAGE_KEYS.queue, []);
  state.pendingQueue = Array.isArray(restoredQueue)
    ? restoredQueue.map((operation) =>
        typeof normalizeQueuedOperation === "function"
          ? normalizeQueuedOperation(operation)
          : operation
      )
    : [];
}

function buildOfflineSaleTicketLabel(clientSaleId, fallbackValue = "") {
  const safeFallback = String(fallbackValue || "").trim();
  if (safeFallback) {
    return safeFallback;
  }

  const numericSuffix = String(clientSaleId || "")
    .replaceAll(/[^0-9]/g, "")
    .slice(-6);
  return `OFF-${numericSuffix || Date.now().toString().slice(-6)}`;
}

function buildOfflineSaleItemsSnapshot(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    productId: Number(item?.productId || 0) || null,
    productName: String(item?.productName || item?.name || "Producto"),
    quantity: roundStock(item?.quantity || 0),
    unitPrice: roundMoney(item?.unitPrice || 0),
    lineTotal: roundMoney(item?.lineTotal || 0),
  }));
}

function buildOfflineSaleTotals(items = []) {
  const normalizedItems = buildOfflineSaleItemsSnapshot(items);
  return {
    items: normalizedItems,
    total: roundMoney(
      normalizedItems.reduce((sum, item) => sum + roundMoney(item.lineTotal || 0), 0),
    ),
    itemCount: roundStock(
      normalizedItems.reduce((sum, item) => sum + roundStock(item.quantity || 0), 0),
    ),
  };
}

function normalizeOfflineSaleRecord(record = {}) {
  const payload =
    record.requestPayload && typeof record.requestPayload === "object"
      ? record.requestPayload
      : getOfflineSalePayload(record) || {};
  const totals = buildOfflineSaleTotals(record.items || payload.items || []);
  const clientSaleId = String(record.clientSaleId || payload.clientSaleId || "").trim();
  const queuedAt = record.queuedAt || record.createdAt || new Date().toISOString();
  const createdAt = record.createdAt || queuedAt;
  const safeStatus = ["pending", "synced", "rejected", "requires_review"].includes(record.status)
    ? record.status
    : "pending";
  const requestBody =
    typeof record.request?.body === "string" && record.request.body.trim()
      ? record.request.body
      : JSON.stringify(payload || {});

  return {
    clientSaleId,
    localSaleId: String(record.localSaleId || ""),
    localTicketNumber: buildOfflineSaleTicketLabel(clientSaleId, record.localTicketNumber),
    queueOperationId: String(record.queueOperationId || ""),
    shift: String(record.shift || payload.shift || ""),
    cashier: String(record.cashier || payload.cashier || ""),
    branch: String(record.branch || payload.branch || ""),
    paymentMethod: String(record.paymentMethod || payload.paymentMethod || "Efectivo"),
    receivedAmount: roundMoney(record.receivedAmount ?? payload.receivedAmount ?? 0),
    total: roundMoney(record.total ?? totals.total),
    itemCount: roundStock(record.itemCount ?? totals.itemCount),
    createdAt,
    queuedAt,
    status: safeStatus,
    retryCount: Math.max(0, Number(record.retryCount || 0)),
    lastSyncAttemptAt: record.lastSyncAttemptAt || null,
    syncedAt: record.syncedAt || null,
    syncedSaleId: Number(record.syncedSaleId || 0) || null,
    syncedTicketNumber: String(record.syncedTicketNumber || ""),
    lastError: String(record.lastError || ""),
    lastErrorCode: Number.isFinite(Number(record.lastErrorCode))
      ? Number(record.lastErrorCode)
      : null,
    rejectedAt: record.rejectedAt || null,
    rejectedReason: String(record.rejectedReason || ""),
    reviewReason: String(record.reviewReason || ""),
    requestPayload: payload,
    request: {
      url: String(record.request?.url || "/api/sales"),
      method: String(record.request?.method || "POST").toUpperCase(),
      body: requestBody,
      headers:
        record.request?.headers && typeof record.request.headers === "object"
          ? { ...record.request.headers }
          : {},
    },
    items: totals.items,
  };
}

function saveOfflineSales() {
  persistJsonDeferred(STORAGE_KEYS.offlineSales, state.offlineSales, 150);
}

async function restoreOfflineSales() {
  const restoredRecords = await readPersistedJson(STORAGE_KEYS.offlineSales, []);
  state.offlineSales = Array.isArray(restoredRecords)
    ? restoredRecords
        .map((record) => normalizeOfflineSaleRecord(record))
        .filter((record) => record.clientSaleId)
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    : [];
}

function getQueuedSaleOperationByClientSaleId(clientSaleId) {
  const safeClientSaleId = String(clientSaleId || "").trim();
  if (!safeClientSaleId) {
    return null;
  }

  return state.pendingQueue.find((operation) => {
    if (String(operation?.url || "") !== "/api/sales") {
      return false;
    }

    try {
      const payload = JSON.parse(operation.body || "{}");
      return String(payload?.clientSaleId || "") === safeClientSaleId;
    } catch (_error) {
      return false;
    }
  }) || null;
}

function buildOfflineSaleRecordFromQueuedOperation(operation = {}) {
  if (String(operation?.url || "") !== "/api/sales") {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(operation.body || "{}");
  } catch (_error) {
    payload = null;
  }

  if (!payload?.clientSaleId) {
    return null;
  }

  return normalizeOfflineSaleRecord({
    clientSaleId: payload.clientSaleId,
    queueOperationId: operation.id || "",
    shift: payload.shift || "",
    cashier: payload.cashier || "",
    branch: payload.branch || "",
    paymentMethod: payload.paymentMethod || "Efectivo",
    receivedAmount: payload.receivedAmount || 0,
    createdAt: operation.queuedAt || new Date().toISOString(),
    queuedAt: operation.queuedAt || new Date().toISOString(),
    status: operation.syncBlocked ? "requires_review" : "pending",
    retryCount: Math.max(0, Number(operation.syncAttempts || 0)),
    lastSyncAttemptAt: operation.lastSyncAttemptAt || null,
    lastError: operation.lastSyncError || "",
    lastErrorCode: operation.lastSyncErrorCode ?? null,
    requestPayload: payload,
    request: {
      url: "/api/sales",
      method: String(operation.method || "POST").toUpperCase(),
      body: operation.body || JSON.stringify(payload),
      headers:
        operation.headers && typeof operation.headers === "object"
          ? { ...operation.headers }
          : {},
    },
    items: payload.items || [],
  });
}

function upsertOfflineSaleRecord(record = {}) {
  const normalizedRecord = normalizeOfflineSaleRecord(record);
  if (!normalizedRecord.clientSaleId) {
    return null;
  }

  const currentRecords = Array.isArray(state.offlineSales) ? state.offlineSales : [];
  const index = currentRecords.findIndex(
    (entry) => String(entry?.clientSaleId || "") === normalizedRecord.clientSaleId,
  );
  if (index === -1) {
    state.offlineSales = [normalizedRecord, ...currentRecords].sort((left, right) =>
      String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
    );
  } else {
    const mergedRecord = normalizeOfflineSaleRecord({
      ...currentRecords[index],
      ...normalizedRecord,
      requestPayload: normalizedRecord.requestPayload || currentRecords[index].requestPayload,
      request: {
        ...(currentRecords[index].request || {}),
        ...(normalizedRecord.request || {}),
      },
    });
    state.offlineSales = currentRecords.slice();
    state.offlineSales[index] = mergedRecord;
  }

  saveOfflineSales();
  return getOfflineSaleRecordByClientSaleId(normalizedRecord.clientSaleId);
}

function syncOfflineSalesAuditWithQueue() {
  const saleOperations = state.pendingQueue
    .map((operation) => buildOfflineSaleRecordFromQueuedOperation(operation))
    .filter(Boolean);
  if (saleOperations.length === 0 && state.offlineSales.length === 0) {
    return;
  }

  saleOperations.forEach((record) => {
    const currentRecord = getOfflineSaleRecordByClientSaleId(record.clientSaleId);
    upsertOfflineSaleRecord({
      ...currentRecord,
      ...record,
      status:
        currentRecord?.status === "synced" || currentRecord?.status === "rejected"
          ? currentRecord.status
          : record.status,
    });
  });
}

function registerPendingOfflineSale(payload, options = {}) {
  const queueOperation =
    options.queueOperationId
      ? state.pendingQueue.find((operation) => operation.id === options.queueOperationId)
      : getQueuedSaleOperationByClientSaleId(payload?.clientSaleId);
  const tempSale = options.tempSale && typeof options.tempSale === "object" ? options.tempSale : null;
  return upsertOfflineSaleRecord({
    clientSaleId: payload?.clientSaleId,
    localSaleId: tempSale?.id || options.localSaleId || "",
    localTicketNumber: tempSale?.ticketNumber || options.localTicketNumber || "",
    queueOperationId: queueOperation?.id || options.queueOperationId || "",
    shift: payload?.shift || "",
    cashier: payload?.cashier || "",
    branch: payload?.branch || "",
    paymentMethod: payload?.paymentMethod || "Efectivo",
    receivedAmount: payload?.receivedAmount || 0,
    createdAt: tempSale?.createdAt || options.createdAt || new Date().toISOString(),
    queuedAt: queueOperation?.queuedAt || new Date().toISOString(),
    status: "pending",
    requestPayload: payload,
    request: {
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify(payload || {}),
      headers:
        queueOperation?.headers && typeof queueOperation.headers === "object"
          ? { ...queueOperation.headers }
          : {},
    },
    items: payload?.items || [],
    lastError: "",
    lastErrorCode: null,
    rejectedAt: null,
    rejectedReason: "",
    reviewReason: "",
  });
}

function markOfflineSaleSynced(clientSaleId, sale) {
  const currentRecord = getOfflineSaleRecordByClientSaleId(clientSaleId);
  const saleTicketNumber = String(sale?.ticketNumber || "");
  return upsertOfflineSaleRecord({
    ...currentRecord,
    clientSaleId,
    status: "synced",
    syncedAt: new Date().toISOString(),
    syncedSaleId: Number(sale?.id || 0) || null,
    syncedTicketNumber: saleTicketNumber,
    lastError: "",
    lastErrorCode: null,
    reviewReason: "",
  });
}

function markOfflineSaleForReview(clientSaleId, patch = {}) {
  const currentRecord = getOfflineSaleRecordByClientSaleId(clientSaleId);
  if (!currentRecord) {
    return null;
  }

  return upsertOfflineSaleRecord({
    ...currentRecord,
    status: patch.status || "requires_review",
    retryCount: Math.max(
      currentRecord.retryCount || 0,
      Number(patch.retryCount ?? currentRecord.retryCount ?? 0),
    ),
    lastSyncAttemptAt: patch.lastSyncAttemptAt || currentRecord.lastSyncAttemptAt || new Date().toISOString(),
    lastError: patch.lastError ?? currentRecord.lastError,
    lastErrorCode:
      patch.lastErrorCode === undefined
        ? currentRecord.lastErrorCode
        : patch.lastErrorCode,
    reviewReason: patch.reviewReason || currentRecord.reviewReason || "",
    queueOperationId: patch.queueOperationId || currentRecord.queueOperationId,
  });
}

function markOfflineSaleRejected(clientSaleId, reason = "") {
  const currentRecord = getOfflineSaleRecordByClientSaleId(clientSaleId);
  if (!currentRecord) {
    return null;
  }

  state.pendingQueue = state.pendingQueue.filter((operation) => {
    try {
      const payload = JSON.parse(operation.body || "{}");
      return String(payload?.clientSaleId || "") !== String(clientSaleId || "");
    } catch (_error) {
      return true;
    }
  });
  saveQueue();

  return upsertOfflineSaleRecord({
    ...currentRecord,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    rejectedReason: String(reason || "Marcada manualmente como rechazada."),
  });
}

function reactivateOfflineSaleRecord(clientSaleId) {
  const currentRecord = getOfflineSaleRecordByClientSaleId(clientSaleId);
  if (!currentRecord) {
    return null;
  }

  const nextOperation =
    typeof normalizeQueuedOperation === "function"
      ? normalizeQueuedOperation({
          url: currentRecord.request?.url || "/api/sales",
          method: currentRecord.request?.method || "POST",
          body: currentRecord.request?.body || JSON.stringify(currentRecord.requestPayload || {}),
          headers:
            currentRecord.request?.headers && typeof currentRecord.request.headers === "object"
              ? { ...currentRecord.request.headers }
              : {},
          syncBlocked: false,
          lastSyncError: "",
          lastSyncErrorCode: null,
        })
      : {
          id: `reactivated-${Date.now()}`,
          url: currentRecord.request?.url || "/api/sales",
          method: currentRecord.request?.method || "POST",
          body: currentRecord.request?.body || JSON.stringify(currentRecord.requestPayload || {}),
          headers:
            currentRecord.request?.headers && typeof currentRecord.request.headers === "object"
              ? { ...currentRecord.request.headers }
              : {},
          queuedAt: new Date().toISOString(),
          syncAttempts: 0,
          syncBlocked: false,
          lastSyncAttemptAt: null,
          lastSyncError: "",
          lastSyncErrorCode: null,
          kind: "sale",
        };

  state.pendingQueue.unshift(nextOperation);
  saveQueue();
  return upsertOfflineSaleRecord({
    ...currentRecord,
    status: "pending",
    queueOperationId: nextOperation.id,
    queuedAt: nextOperation.queuedAt || new Date().toISOString(),
    rejectedAt: null,
    rejectedReason: "",
    reviewReason: "",
    lastError: "",
    lastErrorCode: null,
  });
}

function saveCart() {
  persistJson(STORAGE_KEYS.cart, state.cart);
}

async function restoreCart() {
  state.cart = await readPersistedJson(STORAGE_KEYS.cart, []);
}

function persistPreferences() {
  persistText(STORAGE_KEYS.shift, refs.shiftSelect.value);
  persistText(STORAGE_KEYS.routeMode, state.ui?.routeMode ? "1" : "0");
}

async function restorePreferences() {
  const savedShift = await readPersistedText(STORAGE_KEYS.shift, "");
  const savedRouteMode = await readPersistedText(STORAGE_KEYS.routeMode, "");

  if (savedShift) {
    refs.shiftSelect.value = savedShift;
  }
  if (savedRouteMode === "1" || savedRouteMode === "0") {
    state.ui.routeMode = savedRouteMode === "1";
    return;
  }

  state.ui.routeMode = shouldPreferRouteModeByDefault();
}

function persistCashierSession() {
  persistText(
    STORAGE_KEYS.cashierSession,
    JSON.stringify({
      id: state.cashier.id,
      token: state.cashier.token,
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
    state.cashier.id = Number.isInteger(Number(parsed.id)) ? Number(parsed.id) : null;
    state.cashier.token = String(parsed.token || "");
    state.cashier.name = parsed.name || "";
    state.cashier.branch = parsed.branch || "";
    state.cashier.authenticated = Boolean(
      parsed.authenticated
      && state.cashier.token
      && parsed.name
      && parsed.branch,
    );
  } catch (_error) {
    state.cashier.id = null;
    state.cashier.token = "";
    state.cashier.name = "";
    state.cashier.branch = "";
    state.cashier.authenticated = false;
  }
}

// === Persistencia de eventos de caja (cortes) ===

function saveRegisterEvents() {
  persistJson(STORAGE_KEYS.registerEvents, state.register.events);
  if (typeof scheduleClientSyncHealthReport === "function" && state.online) {
    scheduleClientSyncHealthReport();
  }
}

async function restoreRegisterEvents() {
  state.register.events = await readPersistedJson(STORAGE_KEYS.registerEvents, []);
}

// Agregar un evento de caja offline
function addOfflineRegisterEvent(event) {
  const offlineEvent = {
    id: `offline-register-${Date.now()}`,
    clientEventId: event.clientEventId || `offline-register-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
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

function getOfflineCashSalesFromQueue(shift, branch) {
  return roundMoney(
    state.pendingQueue
      .filter((operation) => operation.url === "/api/sales" && operation.method === "POST")
      .reduce((sum, operation) => {
        try {
          const payload = JSON.parse(operation.body || "{}");
          if (payload.shift !== shift || payload.branch !== branch) {
            return sum;
          }
          if (payload.paymentMethod !== "Efectivo") {
            return sum;
          }
          const total = roundMoney(
            (Array.isArray(payload.items) ? payload.items : []).reduce(
              (lineSum, item) => lineSum + roundMoney(item.lineTotal || 0),
              0,
            ),
          );
          return roundMoney(sum + total);
        } catch (_error) {
          return sum;
        }
      }, 0),
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
  
  // Calcular entradas offline por inicio de caja y ventas pendientes en cola.
  const offlineOpeningAmount = roundMoney(
    shiftOfflineEvents
      .filter((e) => e.eventType === "start")
      .reduce((sum, e) => sum + roundMoney(e.openingAmount || 0), 0),
  );
  const offlineCashSales = getOfflineCashSalesFromQueue(currentShift, branch);
  const offlineWithdrawals = shiftOfflineEvents
    .filter((e) => e.eventType === "quick_cut" || e.eventType === "final_cut")
    .reduce((sum, e) => sum + roundMoney(e.withdrawalsAmount || 0), 0);
  
  // Combinar con resumen del servidor
  return {
    ...summary,
    openingAmount: roundMoney(summary.openingAmount + offlineOpeningAmount),
    cashSales: summary.cashSales + offlineCashSales,
    withdrawalsAmount: (summary.withdrawalsAmount || 0) + offlineWithdrawals,
    expectedCash: roundMoney(summary.expectedCash + offlineOpeningAmount + offlineCashSales - offlineWithdrawals),
    quickCuts: summary.quickCuts + shiftOfflineEvents.filter((e) => e.eventType === "quick_cut").length,
    finalCuts: summary.finalCuts + shiftOfflineEvents.filter((e) => e.eventType === "final_cut").length,
  };
}
