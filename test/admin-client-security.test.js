const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAdminClientSecurityContext() {
  const rootDir = path.resolve(__dirname, "..");
  const persistedJsonWrites = new Map();
  const storageEntries = new Map();
  const createClassListStub = () => ({
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
      __store: storageEntries,
      getItem() {
        return storageEntries.has(arguments[0]) ? storageEntries.get(arguments[0]) : null;
      },
      setItem(key, value) {
        storageEntries.set(key, String(value));
      },
      removeItem(key) {
        storageEntries.delete(key);
      },
    },
    navigator: { onLine: true, maxTouchPoints: 0 },
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
    syncQuickImportItemsFromProducts() {},
    syncMerchandiseRequestProductsFromSnapshot() {},
    renderSummary() {},
    renderCashierSession() {},
    clearCartForSessionChange() {
      const appState = context.__adminClientSecurityApi?.state;
      if (!Array.isArray(appState?.cart)) {
        return;
      }

      appState.cart = [];
    },
    clearCashierSessionState() {
      const appState = context.__adminClientSecurityApi?.state;
      if (!appState?.cashier) {
        return;
      }

      appState.cashier.id = null;
      appState.cashier.token = "";
      appState.cashier.name = "";
      appState.cashier.branch = "";
      appState.cashier.authenticated = false;
    },
    renderCategoryFilters() {},
    requestProductsRender() {},
    renderLowStock() {},
    renderRecentSales() {},
    renderRecentActivity() {},
    renderTrendChart() {},
    renderShiftSummary() {},
    renderInventory() {
      context.__renderInventoryCalls = (context.__renderInventoryCalls || 0) + 1;
    },
    renderAdminModal() {
      context.__renderAdminModalCalls = (context.__renderAdminModalCalls || 0) + 1;
    },
    renderQuickImportModal() {},
    async openQuickImportModal() {
      context.__quickImportOpenCalls = (context.__quickImportOpenCalls || 0) + 1;
    },
    renderSyncStatus() {},
    saveSnapshot() {},
    saveCart() {},
    saveQueue() {},
    saveOfflineSales() {},
    saveRegisterEvents() {},
    persistJson(key, value) {
      persistedJsonWrites.set(key, value);
    },
    fetch: async () => {
      throw new Error("fetch no configurado en este test");
    },
    crypto: {
      randomUUID() {
        return "test-uuid";
      },
    },
    __createClassListStub: createClassListStub,
    persistedJsonWrites,
    __adminRouteActive: false,
    __administrationReturnCalls: 0,
    __renderInventoryCalls: 0,
    __renderAdminModalCalls: 0,
    __quickImportOpenCalls: 0,
    isAdministrationRoute() {
      return context.__adminRouteActive;
    },
    returnFromAdministrationRoute() {
      context.__administrationReturnCalls += 1;
      return context.__adminRouteActive;
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
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    refs.adminModal = { classList: globalThis.__createClassListStub() };
    refs.ownerConsoleModal = { classList: globalThis.__createClassListStub() };
    refs.ownerAuthModal = { classList: globalThis.__createClassListStub() };
    globalThis.__adminClientSecurityApi = {
      state,
      buildPublicSnapshotCacheView,
      getCashierTokenFromHeaders,
      handleCashierSessionAuthFailure,
      isAdminWorkspaceBlockedByOwner,
      normalizeSnapshotForAdminAccess,
      applySnapshot,
      refs,
      setAdministrationRouteActive(value) {
        globalThis.__adminRouteActive = Boolean(value);
      },
      getAdministrationReturnCalls() {
        return globalThis.__administrationReturnCalls;
      },
      sanitizeAfterCashierSessionLoss,
      shouldInvalidateCurrentCashierSessionForAuthFailure,
      shouldRevalidateAdminCapabilities,
      clearClientBusinessResetState,
      clearAffectedBranchOperationalState,
      getAdminWorkspaceSectionOptions,
      normalizeAdminSectionKey,
      normalizeAdminInventoryMode,
      normalizeAdminInventoryFilterKey,
      setAdminInventoryMode,
      setAdminInventoryFilter,
      updateAdminInventorySearch,
      openAdminInventoryMovement,
      openAdminInventoryCountMode,
      prepareForFullDatabaseInstallReload,
      readStorageJson,
      STORAGE_KEYS,
      persistedJsonWrites,
      getRenderInventoryCalls() {
        return globalThis.__renderInventoryCalls;
      },
      getRenderAdminModalCalls() {
        return globalThis.__renderAdminModalCalls;
      },
      getQuickImportOpenCalls() {
        return globalThis.__quickImportOpenCalls;
      },
    };
  `).runInContext(vmContext);

  return context.__adminClientSecurityApi;
}

test("admin client revalidates capability state when unresolved or explicitly empty", () => {
  const api = loadAdminClientSecurityContext();

  api.state.admin.authenticated = true;
  api.state.admin.capabilitiesResolved = false;
  api.state.adminCapabilities = [];
  api.state.owner.authenticated = false;
  assert.equal(api.shouldRevalidateAdminCapabilities(), true);

  api.state.admin.capabilitiesResolved = true;
  api.state.adminCapabilities = [];
  assert.equal(api.shouldRevalidateAdminCapabilities(), true);
  assert.equal(api.isAdminWorkspaceBlockedByOwner(), true);

  api.state.adminCapabilities = ["inventory"];
  assert.equal(api.shouldRevalidateAdminCapabilities(), false);
  assert.equal(api.isAdminWorkspaceBlockedByOwner(), false);

  api.state.owner.authenticated = true;
  api.state.adminCapabilities = [];
  assert.equal(api.shouldRevalidateAdminCapabilities(), false);
  assert.equal(api.isAdminWorkspaceBlockedByOwner(), false);
});

test("admin workspace section options load only the active admin area", () => {
  const api = loadAdminClientSecurityContext();

  const overview = api.getAdminWorkspaceSectionOptions("overview", "all", true);
  assert.equal(overview.profile, "custom");
  assert.equal(overview.branch, "all");
  assert.equal(overview.force, true);
  assert.equal(overview.snapshot, true);
  assert.equal(overview.cashiers, undefined);

  const team = api.getAdminWorkspaceSectionOptions("team", "miradores", false);
  assert.equal(team.branches, true);
  assert.equal(team.cashiers, true);
  assert.equal(team.snapshot, undefined);

  const config = api.getAdminWorkspaceSectionOptions("config", "carrizal", false);
  assert.equal(config.auditLogs, true);
  assert.equal(config.config, true);
  assert.equal(config.periodClosures, undefined);

  assert.equal(api.normalizeAdminSectionKey("no-existe"), "overview");
});

test("admin inventory workspace separates quick movement from full editing state", async () => {
  const api = loadAdminClientSecurityContext();

  assert.equal(api.normalizeAdminInventoryMode("weird"), "movement");
  assert.equal(api.normalizeAdminInventoryFilterKey("weird"), "all");

  api.setAdminInventoryMode("edit", { expand: true });
  assert.equal(api.state.admin.inventoryMode, "edit");
  assert.equal(api.state.admin.inventoryExpanded, true);
  assert.equal(api.getRenderInventoryCalls(), 1);
  assert.equal(api.getRenderAdminModalCalls(), 1);

  api.setAdminInventoryFilter("negative");
  assert.equal(api.state.admin.inventoryFilter, "negative");
  assert.equal(api.getRenderInventoryCalls(), 2);

  api.updateAdminInventorySearch("panela");
  assert.equal(api.state.admin.inventorySearch, "panela");
  assert.equal(api.getRenderInventoryCalls(), 3);

  await api.openAdminInventoryMovement("return");
  assert.equal(api.state.admin.inventoryMode, "movement");
  assert.equal(api.state.admin.inventoryExpanded, false);
  assert.equal(api.state.quickImport.mode, "return");
  assert.equal(api.getQuickImportOpenCalls(), 1);

  api.openAdminInventoryCountMode();
  assert.equal(api.state.admin.inventoryMode, "edit");
  assert.equal(api.state.admin.inventoryExpanded, true);
});

test("admin client normalizes blocked snapshots to public data before using them", () => {
  const api = loadAdminClientSecurityContext();
  const blockedSnapshot = {
    auth: {
      role: "admin",
      adminAuthenticated: true,
      ownerAuthenticated: false,
      cashierAuthenticated: false,
      permissions: {
        canViewAdmin: false,
      },
    },
    adminCapabilities: [],
    products: [{ id: 1, name: "Queso", stock: 9, cost: 15, stockInitialized: true }],
    inventoryProducts: [{ id: 2, name: "Panela", stock: 4, cost: 10, stockInitialized: true }],
    inventoryComparison: {
      branches: [
        {
          value: "carrizal",
          label: "Carrizal",
          products: [{ id: 3, name: "Hebra", stock: 12, cost: 20, stockInitialized: true }],
        },
      ],
    },
    summary: { catalogSize: 3 },
  };

  const normalized = api.normalizeSnapshotForAdminAccess(blockedSnapshot);
  assert.equal(normalized.adminAccessExplicitlyBlocked, true);
  assert.equal(normalized.effectiveSnapshot.auth.role, "guest");
  assert.equal(normalized.effectiveSnapshot.products[0].stock, 0);
  assert.equal(normalized.effectiveSnapshot.inventoryProducts[0].stock, 0);
  assert.equal(normalized.effectiveSnapshot.inventoryComparison.branches[0].products[0].stock, 0);
});

test("administration route stays open when public snapshot marks admin unauthenticated", () => {
  const api = loadAdminClientSecurityContext();
  let adminModalOpen = true;
  api.setAdministrationRouteActive(true);
  api.state.admin.authenticated = true;
  api.state.admin.csrfToken = "admin-csrf";
  api.refs.adminModal = {
    classList: {
      toggle(name, isOpen) {
        if (name === "open") {
          adminModalOpen = Boolean(isOpen);
        }
      },
      contains(name) {
        return name === "open" && adminModalOpen;
      },
    },
    setAttribute() {},
  };
  api.refs.adminAuthModal = {
    classList: {
      contains(name) {
        return name === "open";
      },
      toggle() {},
    },
    setAttribute() {},
  };

  api.applySnapshot({
    auth: {
      role: "guest",
      adminAuthenticated: false,
      ownerAuthenticated: false,
      cashierAuthenticated: false,
    },
    adminCapabilities: [],
    products: [],
    summary: { catalogSize: 0 },
  }, { syncAuthState: true });

  assert.equal(api.state.admin.authenticated, false);
  assert.equal(api.state.admin.csrfToken, "");
  assert.equal(adminModalOpen, false);
  assert.equal(api.getAdministrationReturnCalls(), 0);
});

test("cashier session loss sanitizes operational snapshot unless another privileged role stays active", () => {
  const api = loadAdminClientSecurityContext();
  const buildCashierSnapshot = () => ({
    products: api.state.products,
    recentSales: api.state.recentSales,
    recentActivity: api.state.recentActivity || [],
    lowStock: api.state.lowStock || [],
    salesByHour: api.state.salesByHour || [],
    shiftSummary: api.state.shiftSummary || [],
    summary: api.state.summary || { catalogSize: api.state.products.length },
    auth: {
      role: "cashier",
      cashierAuthenticated: true,
      adminAuthenticated: false,
      ownerAuthenticated: false,
    },
  });

  api.state.products = [{ id: 1, name: "Queso", stock: 9, cost: 25, stockInitialized: true }];
  api.state.recentSales = [{ id: 20, ticketNumber: "RIN-20" }];
  api.state.cashier.authenticated = false;
  api.state.admin.authenticated = false;
  api.state.owner.authenticated = false;

  assert.equal(api.sanitizeAfterCashierSessionLoss(buildCashierSnapshot(), { skipPersist: true }), true);
  assert.equal(api.state.products[0].stock, 0);
  assert.equal(api.state.recentSales.length, 0);
  assert.equal(api.state.cashier.authenticated, false);

  api.state.products = [{ id: 2, name: "Panela", stock: 5, cost: 14, stockInitialized: true }];
  api.state.recentSales = [{ id: 21, ticketNumber: "RIN-21" }];
  api.state.admin.authenticated = true;

  assert.equal(api.sanitizeAfterCashierSessionLoss(buildCashierSnapshot(), { skipPersist: true }), false);
  assert.equal(api.state.products[0].stock, 5);
  assert.equal(api.state.recentSales.length, 1);
});

test("cashier auth failure only drops the live session when the failing token matches the current cashier", () => {
  const api = loadAdminClientSecurityContext();

  api.state.cashier.token = "live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.products = [{ id: 1, name: "Queso", stock: 7, cost: 20, stockInitialized: true }];
  api.state.recentSales = [{ id: 30, ticketNumber: "RIN-30" }];

  assert.equal(api.getCashierTokenFromHeaders({ "X-Cashier-Token": "live-token" }), "live-token");
  assert.equal(api.shouldInvalidateCurrentCashierSessionForAuthFailure({ "x-cashier-token": "live-token" }), true);
  assert.equal(api.handleCashierSessionAuthFailure({ headers: { "x-cashier-token": "live-token" } }), true);
  assert.equal(api.state.cashier.authenticated, false);
  assert.equal(api.state.products[0].stock, 0);
  assert.equal(api.state.recentSales.length, 0);

  api.state.cashier.token = "live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.products = [{ id: 2, name: "Panela", stock: 5, cost: 14, stockInitialized: true }];
  api.state.recentSales = [{ id: 31, ticketNumber: "RIN-31" }];

  assert.equal(api.shouldInvalidateCurrentCashierSessionForAuthFailure({ "x-cashier-token": "old-token" }), false);
  assert.equal(api.handleCashierSessionAuthFailure({ headers: { "x-cashier-token": "old-token" } }), false);
  assert.equal(api.state.cashier.authenticated, true);
  assert.equal(api.state.products[0].stock, 5);
  assert.equal(api.state.recentSales.length, 1);
});

test("owner business reset clears cashier and offline device state before applying the new public snapshot", () => {
  const api = loadAdminClientSecurityContext();

  api.state.cart = [{ productId: 1, quantity: 2 }];
  api.state.cashier.token = "live-token";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.pendingQueue = [{ id: "queue-1" }];
  api.state.offlineSales = [{ id: "offline-1" }];
  api.state.register.events = [{ id: "event-1", synced: false }];
  api.state.syncingQueue = true;

  api.clearClientBusinessResetState();

  assert.equal(api.state.cart.length, 0);
  assert.equal(api.state.cashier.authenticated, false);
  assert.equal(api.state.cashier.token, "");
  assert.equal(api.state.pendingQueue.length, 0);
  assert.equal(api.state.offlineSales.length, 0);
  assert.equal(api.state.register.events.length, 0);
  assert.equal(api.state.syncingQueue, false);
});

test("branch-level operational reset only purges affected local branch data", () => {
  const api = loadAdminClientSecurityContext();

  api.state.cart = [{ productId: 1, quantity: 2 }];
  api.state.cashier.branch = "carrizal";
  api.state.pendingQueue = [
    {
      id: "sale-carrizal",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify({ branch: "carrizal", clientSaleId: "A-1" }),
    },
    {
      id: "sale-sur",
      url: "/api/sales",
      method: "POST",
      body: JSON.stringify({ branch: "sur", clientSaleId: "B-1" }),
    },
  ];
  api.state.offlineSales = [
    { clientSaleId: "A-1", branch: "carrizal" },
    { clientSaleId: "B-1", branch: "sur" },
  ];
  api.state.register.events = [
    { clientEventId: "evt-1", branch: "carrizal" },
    { clientEventId: "evt-2", branch: "sur" },
  ];

  assert.equal(api.clearAffectedBranchOperationalState(["carrizal"]), true);
  assert.equal(api.state.cart.length, 0);
  assert.equal(api.state.pendingQueue.length, 1);
  assert.equal(api.state.pendingQueue[0].id, "sale-sur");
  assert.equal(api.state.offlineSales.length, 1);
  assert.equal(api.state.offlineSales[0].branch, "sur");
  assert.equal(api.state.register.events.length, 1);
  assert.equal(api.state.register.events[0].branch, "sur");
});

test("full database install reload clears privileged auth and persisted operational state", () => {
  const api = loadAdminClientSecurityContext();

  api.state.cart = [{ productId: 1, quantity: 2 }];
  api.state.cashier.id = 7;
  api.state.cashier.token = "cashier-live";
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.authenticated = true;
  api.state.pendingQueue = [{ id: "queue-1", branch: "carrizal" }];
  api.state.offlineSales = [{ clientSaleId: "offline-1", branch: "carrizal" }];
  api.state.register.events = [{ clientEventId: "evt-1", branch: "carrizal" }];
  api.state.admin.authenticated = true;
  api.state.admin.csrfToken = "admin-csrf";
  api.state.admin.sessionExpiresAt = "2099-01-01T00:00:00.000Z";
  api.state.admin.setupAllowed = true;
  api.state.admin.snapshot = { products: [{ id: 1 }] };
  api.state.admin.inventoryProducts = [{ id: 2 }];
  api.state.admin.inventoryComparison = { branches: [] };
  api.state.admin.metrics = { totalSales: 99 };
  api.state.admin.backupsStatus = { ok: true };
  api.state.admin.auditLogs = [{ id: 10 }];
  api.state.admin.cashiers = [{ id: 11 }];
  api.state.admin.branches = [{ code: "carrizal" }];
  api.state.admin.merchandiseRequests = [{ id: 12 }];
  api.state.admin.editorData.sales = [{ id: 13 }];
  api.state.admin.editorData.registerEvents = [{ id: 14 }];
  api.state.admin.editorData.inventoryMovements = [{ id: 15 }];
  api.state.admin.workspaceLoadedAt = { dashboard: 123 };
  api.state.admin.capabilitiesResolved = true;
  api.state.admin.weightedAudit.sessions = [{ id: 16 }];
  api.state.admin.weightedAudit.currentSession = { id: 17 };
  api.state.admin.weightedAudit.loading = true;
  api.state.admin.weightedAudit.saving = true;
  api.state.admin.weightedAudit.draftItems = { "17": [{ id: 18 }] };
  api.state.admin.weightedAudit.notesDraft = "pendiente";
  api.state.admin.periodClosures.preview = { periodStartDateKey: "2026-06-15" };
  api.state.admin.periodClosures.closures = [{ id: 19 }];
  api.state.admin.periodClosures.currentClosure = { id: 20 };
  api.state.admin.periodClosures.selectedClosureId = 20;
  api.state.admin.periodClosures.loading = true;
  api.state.admin.periodClosures.detailLoading = true;
  api.state.admin.periodClosures.saving = true;
  api.state.admin.periodClosures.notesDraft = "nota semanal";
  api.state.owner.authenticated = true;
  api.state.owner.csrfToken = "owner-csrf";
  api.state.owner.sessionExpiresAt = "2099-02-01T00:00:00.000Z";
  api.state.owner.setupAllowed = true;
  api.state.owner.accessLoaded = true;
  api.state.adminCapabilities = ["inventory", "backups"];

  api.prepareForFullDatabaseInstallReload();

  assert.equal(api.state.cart.length, 0);
  assert.equal(api.state.cashier.id, null);
  assert.equal(api.state.cashier.token, "");
  assert.equal(api.state.cashier.authenticated, false);
  assert.equal(api.state.pendingQueue.length, 0);
  assert.equal(api.state.offlineSales.length, 0);
  assert.equal(api.state.register.events.length, 0);
  assert.equal(api.state.admin.authenticated, false);
  assert.equal(api.state.admin.csrfToken, "");
  assert.equal(api.state.admin.sessionExpiresAt, null);
  assert.equal(api.state.admin.setupAllowed, false);
  assert.equal(api.state.admin.snapshot, null);
  assert.equal(api.state.admin.inventoryProducts.length, 0);
  assert.equal(api.state.admin.inventoryComparison, null);
  assert.equal(api.state.admin.metrics, null);
  assert.equal(api.state.admin.backupsStatus, null);
  assert.equal(api.state.admin.auditLogs.length, 0);
  assert.equal(api.state.admin.cashiers.length, 0);
  assert.equal(api.state.admin.branches.length, 0);
  assert.equal(api.state.admin.merchandiseRequests.length, 0);
  assert.equal(api.state.admin.editorData.sales.length, 0);
  assert.equal(api.state.admin.editorData.registerEvents.length, 0);
  assert.equal(api.state.admin.editorData.inventoryMovements.length, 0);
  assert.equal(Object.keys(api.state.admin.workspaceLoadedAt).length, 0);
  assert.equal(api.state.admin.capabilitiesResolved, false);
  assert.equal(api.state.admin.weightedAudit.sessions.length, 0);
  assert.equal(api.state.admin.weightedAudit.currentSession, null);
  assert.equal(api.state.admin.weightedAudit.loading, false);
  assert.equal(api.state.admin.weightedAudit.saving, false);
  assert.equal(Object.keys(api.state.admin.weightedAudit.draftItems).length, 0);
  assert.equal(api.state.admin.weightedAudit.notesDraft, "");
  assert.equal(api.state.admin.periodClosures.preview, null);
  assert.equal(api.state.admin.periodClosures.closures.length, 0);
  assert.equal(api.state.admin.periodClosures.currentClosure, null);
  assert.equal(api.state.admin.periodClosures.selectedClosureId, null);
  assert.equal(api.state.admin.periodClosures.loading, false);
  assert.equal(api.state.admin.periodClosures.detailLoading, false);
  assert.equal(api.state.admin.periodClosures.saving, false);
  assert.equal(api.state.admin.periodClosures.notesDraft, "");
  assert.equal(api.state.owner.authenticated, false);
  assert.equal(api.state.owner.csrfToken, "");
  assert.equal(api.state.owner.sessionExpiresAt, null);
  assert.equal(api.state.owner.setupAllowed, false);
  assert.equal(api.state.owner.accessLoaded, false);
  assert.equal(api.state.adminCapabilities.length, 0);
  assert.equal(api.readStorageJson(api.STORAGE_KEYS.snapshot, "missing"), null);
  assert.equal(Object.keys(api.readStorageJson(api.STORAGE_KEYS.preparedSnapshots, {})).length, 0);
  assert.equal(api.readStorageJson(api.STORAGE_KEYS.cashierOfflineProfiles, []).length, 0);
});
