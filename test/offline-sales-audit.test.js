const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadOfflineSalesContext() {
  const rootDir = path.resolve(__dirname, "..");
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

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
    localStorage,
    indexedDB: undefined,
    navigator: { onLine: true, maxTouchPoints: 0 },
    window: {
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      addEventListener() {},
      visibilityState: "visible",
    },
    performance: {
      now() {
        return 0;
      },
    },
    refs: {},
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
    "public/js/storage.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__offlineSalesTestApi = {
      refs,
      state,
      calculateRegisterSummaryWithOffline,
      getEmptyRegisterSummary,
      registerPendingOfflineSale,
      markOfflineSaleForReview,
      markOfflineSaleRejected,
      reactivateOfflineSaleRecord,
      markOfflineSaleSynced,
      getOfflineSaleRecordByClientSaleId,
      getOfflineSaleDisplayState,
      getOfflineSalesStatusSummary,
      buildOfflineOperationReviewGuidance,
    };
  `).runInContext(vmContext);

  return context.__offlineSalesTestApi;
}

test("offline sales audit survives rejection, reactivation and final sync", () => {
  const api = loadOfflineSalesContext();
  const queuedAt = "2026-05-25T12:00:00.000Z";
  const payload = {
    clientSaleId: "sale-1",
    cashier: "Ana",
    branch: "carrizal",
    shift: "Tarde",
    paymentMethod: "Efectivo",
    receivedAmount: 80,
    items: [
      {
        productId: 1,
        productName: "Queso Oaxaca",
        quantity: 2,
        unitPrice: 10,
        lineTotal: 20,
      },
    ],
  };

  api.state.pendingQueue = [
    {
      id: "op-1",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "x-cashier-token": "cashier-token" },
      queuedAt,
    },
  ];

  const record = api.registerPendingOfflineSale(payload, {
    queueOperationId: "op-1",
    tempSale: {
      id: "offline-sale-1",
      ticketNumber: "OFF-001",
      createdAt: queuedAt,
    },
  });

  assert.equal(record.status, "pending");
  assert.equal(record.localTicketNumber, "OFF-001");
  assert.equal(record.total, 20);
  assert.equal(api.state.offlineSales.length, 1);

  api.markOfflineSaleRejected("sale-1", "Revision manual");
  assert.equal(api.state.pendingQueue.length, 0);
  assert.equal(
    api.getOfflineSaleRecordByClientSaleId("sale-1").status,
    "rejected",
  );

  api.reactivateOfflineSaleRecord("sale-1");
  assert.equal(api.state.pendingQueue.length, 1);
  assert.equal(
    api.getOfflineSaleRecordByClientSaleId("sale-1").status,
    "pending",
  );

  api.markOfflineSaleSynced("sale-1", {
    id: 77,
    ticketNumber: "RIN-77",
  });

  const syncedRecord = api.getOfflineSaleRecordByClientSaleId("sale-1");
  assert.equal(syncedRecord.status, "synced");
  assert.equal(syncedRecord.syncedTicketNumber, "RIN-77");
});

test("offline sale summary promotes local stock conflicts to review", () => {
  const api = loadOfflineSalesContext();
  const payload = {
    clientSaleId: "sale-2",
    cashier: "Luis",
    branch: "carrizal",
    shift: "Tarde",
    paymentMethod: "Efectivo",
    items: [
      {
        productId: 5,
        productName: "Jamon",
        quantity: 3,
        unitPrice: 12,
        lineTotal: 36,
      },
    ],
  };

  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.cashier.token = "cashier-token";
  api.state.products = [
    {
      id: 5,
      name: "Jamon",
      stock: 1,
      unit: "kg",
    },
  ];
  api.state.pendingQueue = [
    {
      id: "op-2",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify(payload),
      queuedAt: "2026-05-25T13:00:00.000Z",
    },
  ];

  const record = api.registerPendingOfflineSale(payload, {
    queueOperationId: "op-2",
  });
  const displayState = api.getOfflineSaleDisplayState(record);

  assert.equal(displayState.status, "requires_review");
  assert.match(displayState.note, /Conflicto de stock/i);
  assert.match(displayState.action, /Corrige inventario/i);
  assert.equal(displayState.reviewReason, "stock_conflict");
  assert.deepEqual(JSON.parse(JSON.stringify(api.getOfflineSalesStatusSummary())), {
    pending: 0,
    requiresReview: 1,
    synced: 0,
    rejected: 0,
    outstanding: 1,
  });
});

test("guest context does not invent stock conflicts for pending offline sales", () => {
  const api = loadOfflineSalesContext();
  const payload = {
    clientSaleId: "sale-3",
    cashier: "Luis",
    branch: "carrizal",
    shift: "Tarde",
    paymentMethod: "Efectivo",
    items: [
      {
        productId: 8,
        productName: "Queso Panela",
        quantity: 2,
        unitPrice: 15,
        lineTotal: 30,
      },
    ],
  };

  api.state.cashier.branch = "carrizal";
  api.state.products = [
    {
      id: 8,
      name: "Queso Panela",
      stock: 0,
      unit: "kg",
    },
  ];
  api.state.pendingQueue = [
    {
      id: "op-3",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify(payload),
      queuedAt: "2026-05-25T14:00:00.000Z",
    },
  ];

  const record = api.registerPendingOfflineSale(payload, {
    queueOperationId: "op-3",
  });
  const displayState = api.getOfflineSaleDisplayState(record);

  assert.equal(displayState.status, "pending");
  assert.match(displayState.note, /inicia sesion/i);
  assert.equal(displayState.reviewReason, "auth_required");
  assert.match(displayState.action, /Luis/i);
});

test("offline sale display state explains branch and server rejection actions", () => {
  const api = loadOfflineSalesContext();
  const payload = {
    clientSaleId: "sale-4",
    cashier: "Marta",
    branch: "miradores",
    shift: "Tarde",
    paymentMethod: "Efectivo",
    items: [
      {
        productId: 11,
        productName: "Leche",
        quantity: 1,
        unitPrice: 20,
        lineTotal: 20,
      },
    ],
  };

  api.state.cashier.name = "Marta";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.cashier.token = "cashier-token";

  const branchRecord = api.registerPendingOfflineSale(payload, {
    queueOperationId: "op-4",
  });
  const branchDisplay = api.getOfflineSaleDisplayState(branchRecord);

  assert.equal(branchDisplay.status, "requires_review");
  assert.equal(branchDisplay.reviewReason, "branch_mismatch");
  assert.match(branchDisplay.note, /otra sucursal|Miradores/i);
  assert.match(branchDisplay.action, /sucursal/i);

  api.markOfflineSaleForReview("sale-4", {
    status: "requires_review",
    lastError: "Producto ya no existe.",
    lastErrorCode: 409,
    reviewReason: "sync_error",
  });

  api.state.cashier.branch = "miradores";
  const rejectedDisplay = api.getOfflineSaleDisplayState(
    api.getOfflineSaleRecordByClientSaleId("sale-4"),
  );
  assert.equal(rejectedDisplay.status, "requires_review");
  assert.match(rejectedDisplay.reason, /Producto ya no existe/i);
  assert.match(rejectedDisplay.action, /rechazo no fue un simple corte de internet/i);
});

test("offline final cut locks the current cashier locally until sync", () => {
  const api = loadOfflineSalesContext();
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.refs.shiftSelect = { value: "Tarde" };

  const summary = api.calculateRegisterSummaryWithOffline(
    api.getEmptyRegisterSummary(),
    [
      {
        eventType: "final_cut",
        shift: "Tarde",
        branch: "carrizal",
        cashier: "Ana",
        withdrawalsAmount: 0,
        createdAt: "2026-06-14T22:10:00.000Z",
      },
      {
        eventType: "quick_cut",
        shift: "Tarde",
        branch: "carrizal",
        cashier: "Otro",
        withdrawalsAmount: 10,
        createdAt: "2026-06-14T21:00:00.000Z",
      },
    ],
  );

  assert.equal(summary.cashierLocked, true);
  assert.equal(summary.cashierFinalCutAt, "2026-06-14T22:10:00.000Z");
  assert.equal(summary.finalCuts, 1);
});
