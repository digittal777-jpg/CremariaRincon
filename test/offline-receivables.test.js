const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadOfflineReceivablesContext() {
  const rootDir = path.resolve(__dirname, "..");
  const storageEntries = new Map();
  const toResponse = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  });
  const toClassList = () => ({
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  });
  const context = {
    console,
    Intl,
    Date,
    Math,
    JSON,
    Map,
    Set,
    URL,
    Blob,
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
    localStorage: {
      getItem(key) {
        return storageEntries.has(key) ? storageEntries.get(key) : null;
      },
      setItem(key, value) {
        storageEntries.set(key, String(value));
      },
      removeItem(key) {
        storageEntries.delete(key);
      },
    },
    indexedDB: undefined,
    navigator: { onLine: true, maxTouchPoints: 0 },
    window: {
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(callback) {
        if (typeof callback === "function") {
          callback();
        }
      },
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
      createElement() {
        return {
          click() {},
          remove() {},
          set href(_value) {},
          set download(_value) {},
        };
      },
    },
    performance: {
      now() {
        return 0;
      },
    },
    refs: {
      receivablesModal: { classList: toClassList() },
      receivablePaymentModal: { classList: toClassList() },
      syncStatus: { textContent: "", title: "" },
      syncStatusButton: { title: "" },
      socketStatus: { textContent: "" },
      networkStatus: { textContent: "" },
    },
    showToast() {},
    renderCashierSession() {},
    renderRegisterSummaryPill() {},
    renderRegisterModal() {},
    renderSummary() {},
    requestProductsRender() {},
    renderLowStock() {},
    renderRecentSales() {},
    renderRecentActivity() {},
    renderTrendChart() {},
    renderShiftSummary() {},
    renderAdminDevPanel() {},
    renderOwnerConsoleModal() {},
    saveCart() {},
    renderCart() {},
    setModalOpen() {},
    requireCashierSession() {
      return true;
    },
    clearCashierSessionState() {
      const api = context.__offlineReceivablesApi;
      if (!api?.state?.cashier) {
        return;
      }
      api.state.cashier.id = null;
      api.state.cashier.token = "";
      api.state.cashier.name = "";
      api.state.cashier.branch = "";
      api.state.cashier.authenticated = false;
    },
    persistCashierSession() {},
    syncQuickImportItemsFromProducts() {},
    syncMerchandiseRequestProductsFromSnapshot() {},
    refreshCurrentSnapshot: async () => ({}),
    loadRegisterSummary: async () => ({}),
    applySnapshot() {},
    fetch: async () => toResponse({ ok: true }, 200),
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
    "public/js/actions.js",
    "public/js/network.js",
    "public/js/receivables.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    refreshCurrentSnapshot = async function refreshCurrentSnapshotStub() {
      return {};
    };
    applySnapshot = function applySnapshotStub() {};
    loadRegisterSummary = async function loadRegisterSummaryStub() {
      return {};
    };
  `).runInContext(vmContext);

  new vm.Script(`
    globalThis.__offlineReceivablesApi = {
      state,
      refs,
      STORAGE_KEYS,
      buildMergedReceivableCustomers,
      buildMergedReceivableCustomerDetail,
      getCachedReceivableCustomers,
      getCachedReceivableCustomerDetail,
      upsertReceivablesCacheCustomers,
      upsertReceivablesCacheCustomerDetail,
      registerPendingOfflineSale,
      registerPendingOfflineReceivablePayment,
      getOfflineReceivablePaymentRecordByClientPaymentId,
      getOfflineSaleRecordByClientSaleId,
      normalizeQueuedOperation,
      saveQueue,
      syncPendingQueue,
    };
  `).runInContext(vmContext);

  return {
    api: context.__offlineReceivablesApi,
    context,
    toResponse,
  };
}

test("receivables merge cached debt, local fiados and queued offline payments into one offline view", () => {
  const { api } = loadOfflineReceivablesContext();

  api.state.cashier.authenticated = true;
  api.state.cashier.token = "cashier-live";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";

  api.upsertReceivablesCacheCustomers("carrizal", [
    {
      customerKey: "cust-ana",
      customerName: "Ana Perez",
      branch: "carrizal",
      pendingAmount: 100,
      paidAmount: 20,
      openSalesCount: 1,
      oldestSaleAt: "2026-06-10T10:00:00.000Z",
      latestActivityAt: "2026-06-10T10:00:00.000Z",
    },
  ]);
  api.upsertReceivablesCacheCustomerDetail("carrizal", {
    customerKey: "cust-ana",
    customerName: "Ana Perez",
    branch: "carrizal",
    pendingAmount: 100,
    paidAmount: 20,
    openSalesCount: 1,
    oldestSaleAt: "2026-06-10T10:00:00.000Z",
    latestActivityAt: "2026-06-10T10:00:00.000Z",
    sales: [
      {
        id: 11,
        saleId: 11,
        ticketNumber: "RIN-0011",
        shift: "Tarde",
        cashier: "Ana",
        branch: "carrizal",
        paymentMethod: "Fiado",
        customerName: "Ana Perez",
        customerKey: "cust-ana",
        total: 120,
        receivedAmount: 20,
        laterPaymentsTotal: 0,
        paidAmount: 20,
        pendingAmount: 100,
        notes: "",
        createdAt: "2026-06-10T10:00:00.000Z",
        payments: [],
      },
    ],
  });

  api.registerPendingOfflineSale({
    clientSaleId: "offline-fiado-1",
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    paymentMethod: "Fiado",
    receivedAmount: 10,
    customerName: "Ana Perez",
    notes: "ruta",
    items: [
      {
        productId: 7,
        productName: "Queso Fresco",
        quantity: 2,
        unitPrice: 30,
        lineTotal: 60,
      },
    ],
  }, {
    tempSale: {
      id: "offline-sale-1",
      ticketNumber: "OFF-001",
      createdAt: "2026-06-10T12:00:00.000Z",
    },
  });

  api.registerPendingOfflineReceivablePayment({
    clientPaymentId: "payment-offline-1",
    saleId: 11,
    linkedClientSaleId: "",
    ticketNumber: "RIN-0011",
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    customerName: "Ana Perez",
    customerKey: "cust-ana",
    amount: 25,
    paymentMethod: "Efectivo",
    notes: "abono parcial",
    createdAt: "2026-06-10T13:00:00.000Z",
  });

  const customers = api.buildMergedReceivableCustomers(
    api.getCachedReceivableCustomers("carrizal"),
    {
      branch: "carrizal",
      search: "",
    },
  );

  assert.equal(customers.length, 1);
  assert.equal(customers[0].customerKey, "cust-ana");
  assert.equal(customers[0].pendingAmount, 125);
  assert.equal(customers[0].paidAmount, 55);
  assert.equal(customers[0].openSalesCount, 2);
  assert.equal(customers[0].localSaleCount, 1);
  assert.equal(customers[0].localPaymentCount, 1);

  const detail = api.buildMergedReceivableCustomerDetail(
    api.getCachedReceivableCustomerDetail("carrizal", "cust-ana"),
    {
      branch: "carrizal",
      customerKey: "cust-ana",
    },
  );

  assert.equal(detail.sales.length, 2);
  assert.equal(detail.pendingAmount, 125);
  assert.equal(detail.sales[0].ticketNumber, "RIN-0011");
  assert.equal(detail.sales[0].pendingAmount, 75);
  assert.equal(detail.sales[0].pendingSyncPaymentsCount, 1);
  assert.equal(detail.sales[0].payments.length, 1);
  assert.equal(detail.sales[0].payments[0].pendingSync, true);
  assert.equal(detail.sales[1].ticketNumber, "OFF-001");
  assert.equal(detail.sales[1].isLocalOnly, true);
  assert.equal(detail.sales[1].pendingAmount, 50);
});

test("offline receivable payments wait for the linked fiado sale and sync with the resolved sale id", async () => {
  const { api, context, toResponse } = loadOfflineReceivablesContext();
  const requests = [];

  api.state.cashier.authenticated = true;
  api.state.cashier.token = "cashier-live";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.online = true;

  const salePayload = {
    clientSaleId: "offline-fiado-2",
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    paymentMethod: "Fiado",
    receivedAmount: 20,
    customerName: "Luis",
    items: [
      {
        productId: 9,
        productName: "Crema",
        quantity: 2,
        unitPrice: 40,
        lineTotal: 80,
      },
    ],
  };
  const paymentPayload = {
    clientPaymentId: "payment-offline-2",
    saleId: null,
    linkedClientSaleId: "offline-fiado-2",
    ticketNumber: "OFF-202",
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    customerName: "Luis",
    customerKey: "",
    amount: 15,
    paymentMethod: "Efectivo",
    notes: "primer abono",
    createdAt: "2026-06-11T10:15:00.000Z",
  };

  context.fetch = async (url, options = {}) => {
    const parsedBody = JSON.parse(options.body || "{}");
    requests.push({
      url,
      body: parsedBody,
    });

    if (url === "/api/sales") {
      return toResponse({
        sale: {
          id: 501,
          ticketNumber: "RIN-0501",
        },
      }, 201);
    }

    if (url === "/api/receivables/payments") {
      return toResponse({
        payment: {
          id: 801,
          saleId: parsedBody.saleId,
        },
      }, 201);
    }

    return toResponse({}, 200);
  };

  api.state.pendingQueue = [
    api.normalizeQueuedOperation({
      id: "sale-op",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify(salePayload),
      headers: { "x-cashier-token": "cashier-live" },
      queuedAt: "2026-06-11T10:00:00.000Z",
    }),
    api.normalizeQueuedOperation({
      id: "payment-op",
      url: "/api/receivables/payments",
      method: "POST",
      body: JSON.stringify(paymentPayload),
      headers: { "x-cashier-token": "cashier-live" },
      queuedAt: "2026-06-11T10:10:00.000Z",
    }),
  ];
  api.saveQueue();

  await api.syncPendingQueue();

  assert.equal(api.state.pendingQueue.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "/api/sales");
  assert.equal(requests[1].url, "/api/receivables/payments");
  assert.equal(requests[1].body.saleId, 501);
  assert.equal(requests[1].body.linkedClientSaleId, "offline-fiado-2");
  assert.equal(
    api.getOfflineSaleRecordByClientSaleId("offline-fiado-2").syncedSaleId,
    501,
  );
  assert.equal(
    api.getOfflineReceivablePaymentRecordByClientPaymentId("payment-offline-2").status,
    "synced",
  );
  assert.equal(
    api.getOfflineReceivablePaymentRecordByClientPaymentId("payment-offline-2").syncedSaleId,
    501,
  );
});
