const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPreparedSnapshotContext() {
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
    "public/js/auth.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__preparedSnapshotTestApi = {
      state,
      STORAGE_KEYS,
      buildPersistedSnapshot,
      restoreSnapshot,
      saveSnapshot,
      flushDeferredJsonPersist,
      restorePreparedSnapshot,
      getPreparedOfflineSnapshot,
      buildPublicSnapshotCacheView,
      resolveStartupSnapshotFromCache,
      readStorageJson,
      persistJson,
    };
  `).runInContext(vmContext);

  return context.__preparedSnapshotTestApi;
}

test("prepared offline snapshots are only persisted from cashier sessions", async () => {
  const api = loadPreparedSnapshotContext();
  api.state.store.currentBranch = "carrizal";
  api.state.products = [{ id: 1, name: "Queso", stock: 3 }];

  api.state.owner.authenticated = true;
  api.saveSnapshot(api.buildPersistedSnapshot());
  api.flushDeferredJsonPersist(api.STORAGE_KEYS.preparedSnapshots);
  assert.equal(await api.restorePreparedSnapshot("carrizal"), null);

  api.state.owner.authenticated = false;
  api.state.cashier.authenticated = true;
  api.state.cashier.id = 10;
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";

  api.saveSnapshot(api.buildPersistedSnapshot());
  api.flushDeferredJsonPersist(api.STORAGE_KEYS.preparedSnapshots);

  const restoredSnapshot = await api.restorePreparedSnapshot("carrizal");
  assert.equal(restoredSnapshot?.auth?.role, "cashier");
  assert.equal(restoredSnapshot?.auth?.cashierAuthenticated, true);
  assert.equal(restoredSnapshot?.store?.currentBranch, "carrizal");
});

test("current in-memory owner state is not treated as a valid offline cashier snapshot", async () => {
  const api = loadPreparedSnapshotContext();
  api.state.store.currentBranch = "carrizal";
  api.state.products = [{ id: 2, name: "Panela", stock: 5 }];
  api.state.owner.authenticated = true;

  assert.equal(await api.getPreparedOfflineSnapshot("carrizal"), null);

  api.state.owner.authenticated = false;
  api.state.cashier.authenticated = true;
  api.state.cashier.id = 12;
  api.state.cashier.name = "Luis";
  api.state.cashier.branch = "carrizal";

  const currentSnapshot = await api.getPreparedOfflineSnapshot("carrizal");
  assert.equal(currentSnapshot?.auth?.role, "cashier");
  assert.equal(currentSnapshot?.auth?.cashierAuthenticated, true);
});

test("startup snapshot resolution never reuses privileged cached snapshots for offline cashier boot", () => {
  const api = loadPreparedSnapshotContext();
  const ownerCachedSnapshot = {
    store: { currentBranch: "carrizal" },
    products: [{ id: 4, name: "Asadero", stock: 7 }],
    summary: { catalogSize: 1 },
    auth: {
      role: "owner",
      ownerAuthenticated: true,
      adminAuthenticated: false,
      cashierAuthenticated: false,
      cashier: null,
    },
  };

  const resolvedGuestSnapshot = api.resolveStartupSnapshotFromCache(ownerCachedSnapshot, {
    branch: "carrizal",
  });
  assert.equal(resolvedGuestSnapshot.auth.role, "guest");
  assert.equal(resolvedGuestSnapshot.products[0].stock, 0);

  const preparedCashierSnapshot = {
    store: { currentBranch: "carrizal" },
    products: [{ id: 5, name: "Manchego", stock: 9 }],
    summary: { catalogSize: 1 },
    auth: {
      role: "cashier",
      ownerAuthenticated: false,
      adminAuthenticated: false,
      cashierAuthenticated: true,
      cashier: { id: 33, name: "Ana", branch: "carrizal" },
    },
  };
  const resolvedCashierSnapshot = api.resolveStartupSnapshotFromCache(ownerCachedSnapshot, {
    branch: "carrizal",
    preparedSnapshot: preparedCashierSnapshot,
  });
  assert.equal(resolvedCashierSnapshot.auth.role, "cashier");
  assert.equal(resolvedCashierSnapshot.products[0].stock, 9);
});

test("persisted snapshot cache strips privileged data but keeps cashier offline snapshots intact", async () => {
  const api = loadPreparedSnapshotContext();
  api.state.store.currentBranch = "carrizal";
  api.state.products = [{ id: 6, name: "Oaxaca", stock: 11, cost: 32, stockInitialized: true }];

  api.state.owner.authenticated = true;
  api.saveSnapshot(api.buildPersistedSnapshot());
  api.flushDeferredJsonPersist(api.STORAGE_KEYS.snapshot);

  const storedOwnerSnapshot = api.readStorageJson(api.STORAGE_KEYS.snapshot, null);
  assert.equal(storedOwnerSnapshot?.auth?.role, "guest");
  assert.equal(storedOwnerSnapshot?.products?.[0]?.stock, 0);
  assert.equal(storedOwnerSnapshot?.products?.[0]?.cost, 0);

  api.state.owner.authenticated = false;
  api.state.cashier.authenticated = true;
  api.state.cashier.id = 44;
  api.state.cashier.name = "Mara";
  api.state.cashier.branch = "carrizal";
  api.saveSnapshot(api.buildPersistedSnapshot());
  api.flushDeferredJsonPersist(api.STORAGE_KEYS.snapshot);
  api.flushDeferredJsonPersist(api.STORAGE_KEYS.preparedSnapshots);

  const storedCashierSnapshot = api.readStorageJson(api.STORAGE_KEYS.snapshot, null);
  assert.equal(storedCashierSnapshot?.auth?.role, "cashier");
  assert.equal(storedCashierSnapshot?.products?.[0]?.stock, 11);

  const storedPreparedSnapshot = await api.restorePreparedSnapshot("carrizal");
  assert.equal(storedPreparedSnapshot?.auth?.role, "cashier");
  assert.equal(storedPreparedSnapshot?.products?.[0]?.stock, 11);
});

test("restoring a legacy privileged snapshot rewrites the cache to its public-safe view", async () => {
  const api = loadPreparedSnapshotContext();
  const legacyOwnerSnapshot = {
    store: { currentBranch: "carrizal" },
    products: [{ id: 7, name: "Asadero", stock: 13, cost: 28, stockInitialized: true }],
    summary: { catalogSize: 1, inventoryValue: 364 },
    auth: {
      role: "owner",
      ownerAuthenticated: true,
      adminAuthenticated: false,
      cashierAuthenticated: false,
      cashier: null,
    },
  };

  api.persistJson(api.STORAGE_KEYS.snapshot, legacyOwnerSnapshot);

  const restoredSnapshot = await api.restoreSnapshot();
  assert.equal(restoredSnapshot?.auth?.role, "guest");
  assert.equal(restoredSnapshot?.products?.[0]?.stock, 0);

  const rewrittenSnapshot = api.readStorageJson(api.STORAGE_KEYS.snapshot, null);
  assert.equal(rewrittenSnapshot?.auth?.role, "guest");
  assert.equal(rewrittenSnapshot?.products?.[0]?.stock, 0);
  assert.equal(rewrittenSnapshot?.products?.[0]?.cost, 0);
});

test("public snapshot cache view also strips inventory snapshots and comparison stock", () => {
  const api = loadPreparedSnapshotContext();
  const privilegedSnapshot = {
    store: { currentBranch: "all" },
    products: [{ id: 1, name: "Queso", stock: 8, cost: 25, stockInitialized: true }],
    inventoryProducts: [{ id: 2, name: "Panela", stock: 5, cost: 18, stockInitialized: true }],
    inventoryComparison: {
      branches: [
        {
          value: "carrizal",
          label: "Carrizal",
          products: [{ id: 3, name: "Hebra", stock: 12, cost: 40, stockInitialized: true }],
        },
      ],
    },
    summary: { catalogSize: 3 },
    auth: {
      role: "owner",
      ownerAuthenticated: true,
      adminAuthenticated: false,
      cashierAuthenticated: false,
      cashier: null,
    },
  };

  const publicSnapshot = api.buildPublicSnapshotCacheView(privilegedSnapshot);
  assert.equal(publicSnapshot.auth.role, "guest");
  assert.equal(publicSnapshot.products[0].stock, 0);
  assert.equal(publicSnapshot.inventoryProducts[0].stock, 0);
  assert.equal(publicSnapshot.inventoryComparison.branches[0].products[0].stock, 0);
  assert.equal(publicSnapshot.inventoryComparison.branches[0].products[0].cost, 0);
});
