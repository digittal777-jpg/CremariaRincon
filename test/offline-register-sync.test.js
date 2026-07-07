const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createStorageStub() {
  const entries = new Map();
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function loadOfflineRegisterSyncContext(fetchImpl = async () => jsonResponse({ ok: true })) {
  const rootDir = path.resolve(__dirname, "..");
  const localStorage = createStorageStub();
  const sessionStorage = createStorageStub();
  const toasts = [];
  const loggedErrors = [];
  let summaryLoads = 0;
  let snapshotRefreshes = 0;

  const context = {
    console: {
      ...console,
      error(...args) {
        loggedErrors.push(args);
      },
    },
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Blob,
    URL,
    Request,
    Response,
    Headers,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    AbortController,
    localStorage,
    sessionStorage,
    indexedDB: undefined,
    navigator: { onLine: true, maxTouchPoints: 0 },
    window: {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
    },
    document: {
      addEventListener() {},
      visibilityState: "visible",
      body: {
        classList: {
          toggle() {},
        },
      },
      querySelectorAll() {
        return [];
      },
    },
    performance: {
      now() {
        return 0;
      },
    },
    fetch: fetchImpl,
    refs: {
      networkStatus: { textContent: "" },
      syncStatus: { textContent: "" },
      syncStatusButton: { title: "" },
      socketStatus: { textContent: "" },
    },
    showToast(message, type) {
      toasts.push({ message, type });
    },
    renderCashierSession() {},
    renderRegisterSummaryPill() {},
    renderRegisterModal() {},
    renderApprovalsMobileView() {},
    syncOfflineSalesAuditWithQueue() {},
    syncOfflineReceivablePaymentsAuditWithQueue() {},
    scheduleClientSyncHealthReport() {},
    markOfflineSaleSynced() {},
    markOfflineSaleForReview() {},
    markOfflineReceivablePaymentSynced() {},
    markOfflineReceivablePaymentForReview() {},
    refreshOfflineSalesUi() {},
    refreshReceivablesUi() {
      return Promise.resolve();
    },
    setCashierBlindAuditPrompt() {},
    loadRegisterSummary() {
      summaryLoads += 1;
      return Promise.resolve({});
    },
    refreshCurrentSnapshot() {
      snapshotRefreshes += 1;
      return Promise.resolve({});
    },
    sanitizeAfterCashierSessionLoss() {},
    clearReceivablesSessionChange() {},
    clearCashierSessionState() {
      const cashier = context.__offlineRegisterSyncApi?.state?.cashier;
      if (!cashier) {
        return;
      }
      cashier.id = null;
      cashier.token = "";
      cashier.name = "";
      cashier.branch = "";
      cashier.authenticated = false;
    },
    crypto: {
      randomUUID() {
        return "test-device";
      },
    },
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
    "public/js/storage.js",
    "public/js/network.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__offlineRegisterSyncApi = {
      state,
      refs,
      STORAGE_KEYS,
      normalizeQueuedOperation,
      saveQueue,
      syncRegisterEvents,
      syncAllOfflineData,
      readStorageJson,
    };
  `).runInContext(vmContext);

  return {
    api: context.__offlineRegisterSyncApi,
    toasts,
    loggedErrors,
    localStorageEntries: localStorage.entries,
    getSummaryLoads() {
      return summaryLoads;
    },
    getSnapshotRefreshes() {
      return snapshotRefreshes;
    },
  };
}

function buildRegisterEvent(overrides = {}) {
  return {
    id: overrides.id || "event-1",
    clientEventId: overrides.clientEventId || "event-1",
    eventType: overrides.eventType || "final_cut",
    shift: overrides.shift || "Tarde",
    cashier: overrides.cashier || "Ana",
    branch: overrides.branch || "carrizal",
    notes: overrides.notes || "",
    openingAmount: overrides.openingAmount || 0,
    countedAmount: overrides.countedAmount || 100,
    withdrawalsAmount: overrides.withdrawalsAmount || 0,
    createdAt: overrides.createdAt || "2026-07-06T20:00:00.000Z",
    synced: false,
  };
}

test("offline register sync handles expired cashier auth without losing the queued cut", async () => {
  const requests = [];
  const { api, toasts } = loadOfflineRegisterSyncContext(async (url, options = {}) => {
    requests.push({ url, headers: options.headers || {} });
    return jsonResponse({ message: "Sesion vencida" }, 401);
  });

  api.state.online = true;
  api.state.cashier.token = "cashier-live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.register.events = [buildRegisterEvent()];

  const result = await api.syncRegisterEvents();

  assert.equal(result.blocked, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["x-cashier-token"], "cashier-live-token");
  assert.equal(api.state.cashier.authenticated, false);
  assert.equal(api.state.register.events.length, 1);
  assert.equal(api.state.register.events[0].synced, false);
  assert.match(toasts.at(-1)?.message || "", /cortes guardados offline/i);
});

test("offline register sync stops at the first server error to preserve event order", async () => {
  const requests = [];
  const { api, toasts } = loadOfflineRegisterSyncContext(async (url, options = {}) => {
    requests.push({ url, body: JSON.parse(options.body || "{}") });
    return jsonResponse({ message: "Caja inconsistente" }, 409);
  });

  api.state.online = true;
  api.state.cashier.token = "cashier-live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.register.events = [
    buildRegisterEvent({
      id: "start-1",
      clientEventId: "start-1",
      eventType: "start",
      openingAmount: 100,
      createdAt: "2026-07-06T18:00:00.000Z",
    }),
    buildRegisterEvent({
      id: "cut-1",
      clientEventId: "cut-1",
      eventType: "quick_cut",
      createdAt: "2026-07-06T19:00:00.000Z",
    }),
  ];

  const result = await api.syncRegisterEvents();

  assert.equal(result.attempted, 1);
  assert.equal(result.synced, 0);
  assert.equal(result.blocked, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.clientEventId, "start-1");
  assert.equal(api.state.register.events.length, 2);
  assert.equal(api.state.register.events[0].syncBlocked, true);
  assert.equal(api.state.register.events[1].synced, false);
  assert.match(api.state.register.events[0].lastSyncError, /Caja inconsistente/);
  assert.match(toasts.at(-1)?.message || "", /conservar el orden/i);
});

test("offline register sync can upload another branch while a queue item blocks one branch", async () => {
  const requests = [];
  const { api, getSnapshotRefreshes } = loadOfflineRegisterSyncContext(async (url, options = {}) => {
    requests.push({ url, body: JSON.parse(options.body || "{}") });
    return jsonResponse({ summary: {} }, 201);
  });

  api.state.online = true;
  api.state.cashier.token = "cashier-live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "miradores";
  api.state.cashier.authenticated = true;
  api.state.pendingQueue = [
    api.normalizeQueuedOperation({
      id: "blocked-sale",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify({
        clientSaleId: "sale-carrizal",
        cashier: "Ana",
        branch: "carrizal",
      }),
      syncBlocked: true,
      lastSyncError: "Stock pendiente",
    }),
  ];
  api.saveQueue();
  api.state.register.events = [
    buildRegisterEvent({
      id: "cut-carrizal",
      clientEventId: "cut-carrizal",
      branch: "carrizal",
      createdAt: "2026-07-06T19:00:00.000Z",
    }),
    buildRegisterEvent({
      id: "cut-miradores",
      clientEventId: "cut-miradores",
      branch: "miradores",
      createdAt: "2026-07-06T19:05:00.000Z",
    }),
  ];

  await api.syncAllOfflineData();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/register/cut");
  assert.equal(requests[0].body.branch, "miradores");
  assert.equal(api.state.pendingQueue.length, 1);
  assert.equal(api.state.register.events.length, 1);
  assert.equal(api.state.register.events[0].branch, "carrizal");
  assert.equal(getSnapshotRefreshes(), 0);
});
