const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDashboardSnapshotNetworkApi() {
  const rootDir = path.resolve(__dirname, "..");
  const createClassListStub = (initialOpen = false) => ({
    contains(name) {
      return name === "open" ? initialOpen : false;
    },
    toggle() {},
  });
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
    AbortController,
    navigator: { onLine: true, maxTouchPoints: 0 },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
      requestAnimationFrame(callback) {
        if (typeof callback === "function") {
          callback();
        }
      },
      matchMedia() {
        return { matches: false };
      },
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
    fetch: async () => {
      throw new Error("fetch no configurado en este test");
    },
    renderSyncStatus() {},
    scheduleConnectionRecovery() {},
    resetConnectionRecoveryState() {},
    attemptConnectionRecovery() {
      return Promise.resolve();
    },
    renderCashierSession() {},
    showToast() {},
    __createClassListStub: createClassListStub,
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
    "public/js/network.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    refs.adminModal = { classList: globalThis.__createClassListStub(false) };
    refs.socketStatus = { textContent: "" };
    state.cashier.branch = "miradores";
    state.store.currentBranch = "miradores";
    state.admin.authenticated = true;
    state.admin.branch = "all";
    globalThis.__dashboardSnapshotNetworkApi = {
      refs,
      state,
      doesDashboardSnapshotAffectBranch,
      shouldRefreshCashierFromDashboardSnapshotEvent,
      shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent,
      getDashboardSnapshotEventBranch,
    };
  `).runInContext(vmContext);

  return context.__dashboardSnapshotNetworkApi;
}

test("dashboard snapshot branch matching ignores unrelated cashier branches", () => {
  const api = loadDashboardSnapshotNetworkApi();

  assert.equal(api.doesDashboardSnapshotAffectBranch("carrizal", "miradores"), false);
  assert.equal(api.shouldRefreshCashierFromDashboardSnapshotEvent("carrizal"), false);
  assert.equal(api.shouldRefreshCashierFromDashboardSnapshotEvent("all"), true);
  assert.equal(api.shouldRefreshCashierFromDashboardSnapshotEvent("miradores"), true);
});

test("dashboard snapshot admin refresh only runs for the active admin branch or all", () => {
  const api = loadDashboardSnapshotNetworkApi();

  api.refs.adminModal.classList = {
    contains(name) {
      return name === "open";
    },
    toggle() {},
  };

  api.state.admin.branch = "miradores";
  assert.equal(api.shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent("carrizal"), false);
  assert.equal(api.shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent("miradores"), true);

  api.state.admin.branch = "all";
  assert.equal(api.shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent("carrizal"), true);
  assert.equal(api.getDashboardSnapshotEventBranch({ branch: " Carrizal " }), "carrizal");
});
