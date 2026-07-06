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

function loadCashierSessionHardeningContext(fetchImpl = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) {
  const rootDir = path.resolve(__dirname, "..");
  const localStorage = createStorageStub();
  const sessionStorage = createStorageStub();
  const toasts = [];
  const syncedSales = [];
  let refreshCalls = 0;

  const context = {
    console,
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
    refs: {},
    renderApprovalsMobileView() {},
    syncOfflineSalesAuditWithQueue() {},
    syncOfflineReceivablePaymentsAuditWithQueue() {},
    scheduleClientSyncHealthReport() {},
    markOfflineSaleSynced(clientSaleId, sale) {
      syncedSales.push({ clientSaleId, sale });
    },
    markOfflineSaleForReview() {},
    markOfflineReceivablePaymentSynced() {},
    markOfflineReceivablePaymentForReview() {},
    refreshOfflineSalesUi() {},
    refreshReceivablesUi() {
      return Promise.resolve();
    },
    refreshCurrentSnapshot() {
      refreshCalls += 1;
      return Promise.resolve();
    },
    showToast(message, type) {
      toasts.push({ message, type });
    },
    renderCashierSession() {},
    sanitizeAfterCashierSessionLoss() {},
    clearCashierSessionState() {
      const cashier = context.__cashierSessionHardeningApi?.state?.cashier;
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
        return "test-uuid";
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
    refs.networkStatus = { textContent: "" };
    refs.syncStatus = { textContent: "" };
    refs.syncStatusButton = { title: "" };
    refs.socketStatus = { textContent: "" };
    globalThis.__cashierSessionHardeningApi = {
      refs,
      state,
      STORAGE_KEYS,
      persistCashierSession,
      restoreCashierSession,
      readStorageText,
      readSessionStorageText,
      normalizeQueuedOperation,
      syncPendingQueue,
      getCashierTokenFromHeaders,
    };
  `).runInContext(vmContext);

  return {
    api: context.__cashierSessionHardeningApi,
    localStorageEntries: localStorage.entries,
    sessionStorageEntries: sessionStorage.entries,
    toasts,
    syncedSales,
    getRefreshCalls() {
      return refreshCalls;
    },
  };
}

test("cashier session is stored only in sessionStorage and not durable storage", async () => {
  const { api, localStorageEntries, sessionStorageEntries } = loadCashierSessionHardeningContext();

  api.state.cashier.id = 7;
  api.state.cashier.token = "cashier-live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;

  api.persistCashierSession();

  assert.equal(localStorageEntries.has(api.STORAGE_KEYS.cashierSession), false);
  assert.equal(api.readStorageText(api.STORAGE_KEYS.cashierSession, ""), "");
  assert.equal(Boolean(sessionStorageEntries.get(api.STORAGE_KEYS.cashierSession)), true);

  api.state.cashier.id = null;
  api.state.cashier.token = "";
  api.state.cashier.name = "";
  api.state.cashier.branch = "";
  api.state.cashier.authenticated = false;

  await api.restoreCashierSession();

  assert.equal(api.state.cashier.id, 7);
  assert.equal(api.state.cashier.token, "cashier-live-token");
  assert.equal(api.state.cashier.name, "Ana");
  assert.equal(api.state.cashier.branch, "carrizal");
  assert.equal(api.state.cashier.authenticated, true);
});

test("restoring a legacy durable cashier session migrates it and clears the old copy", async () => {
  const { api, localStorageEntries, sessionStorageEntries } = loadCashierSessionHardeningContext();
  const legacyValue = JSON.stringify({
    id: 9,
    token: "legacy-token",
    name: "Luis",
    branch: "miradores",
    authenticated: true,
  });
  localStorageEntries.set(api.STORAGE_KEYS.cashierSession, legacyValue);

  await api.restoreCashierSession();

  assert.equal(api.state.cashier.id, 9);
  assert.equal(api.state.cashier.token, "legacy-token");
  assert.equal(api.state.cashier.name, "Luis");
  assert.equal(api.state.cashier.branch, "miradores");
  assert.equal(api.state.cashier.authenticated, true);
  assert.equal(localStorageEntries.has(api.STORAGE_KEYS.cashierSession), false);
  assert.equal(sessionStorageEntries.get(api.STORAGE_KEYS.cashierSession), legacyValue);
});

test("queued offline operations strip stored cashier tokens but keep non-secret headers", () => {
  const { api } = loadCashierSessionHardeningContext();

  const operation = api.normalizeQueuedOperation({
    url: "/api/sales",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": "cashier-live-token",
    },
  });

  assert.equal(api.getCashierTokenFromHeaders(operation.headers), "");
  assert.equal(operation.headers["Content-Type"], "application/json");
});

test("queued offline sales reuse the live cashier session when the stored token was stripped", async () => {
  let capturedHeaders = null;
  const { api, toasts, getRefreshCalls } = loadCashierSessionHardeningContext(
    async (_url, options = {}) => {
      capturedHeaders = { ...(options.headers || {}) };
      return new Response(JSON.stringify({
        sale: {
          id: 77,
          ticketNumber: "RIN-77",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  api.state.online = true;
  api.state.cashier.token = "cashier-live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.pendingQueue = [
    api.normalizeQueuedOperation({
      url: "/api/sales",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cashier-Token": "cashier-live-token",
      },
      body: JSON.stringify({
        clientSaleId: "sale-1",
        cashier: "Ana",
        branch: "carrizal",
      }),
    }),
  ];

  await api.syncPendingQueue();

  assert.equal(capturedHeaders["x-cashier-token"], "cashier-live-token");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
  assert.equal(api.state.pendingQueue.length, 0);
  assert.equal(getRefreshCalls(), 1);
  assert.equal(toasts.at(-1)?.type, "success");
});
