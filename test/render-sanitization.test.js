const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRenderSanitizationContext() {
  const rootDir = path.resolve(__dirname, "..");
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
      history: {
        replaceState() {},
      },
      location: {
        href: "http://localhost/",
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
      createElement() {
        return {
          className: "",
          textContent: "",
          style: {},
          remove() {},
        };
      },
      getElementById() {
        return null;
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
    renderAdminModal() {},
    showToast() {},
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
    "public/js/render.js",
    "public/js/merchandise-requests.js",
    "public/js/render-admin.js",
    "public/js/quick-import.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__renderSanitizationTestApi = {
      refs,
      state,
      sanitizeClassToken,
      renderProducts,
      renderMyMerchandiseRequests,
      renderAdminHealthPanel,
      buildPeriodClosureWarningMarkup,
      renderQuickImportCurrentItem,
    };
  `).runInContext(vmContext);

  return vmContext.__renderSanitizationTestApi;
}

test("sanitizeClassToken falls back when an unsafe class token arrives", () => {
  const api = loadRenderSanitizationContext();

  assert.equal(api.sanitizeClassToken('normal" onclick="boom', "safe"), "safe");
  assert.equal(api.sanitizeClassToken("  CRITICAL_status  ", "safe"), "critical_status");
  assert.equal(api.sanitizeClassToken("%%%"), "");
});

test("renderProducts downgrades unsafe product status classes", () => {
  const api = loadRenderSanitizationContext();

  api.refs.searchInput = { value: "" };
  api.refs.searchQuickResults = { hidden: true, innerHTML: "" };
  api.refs.productsGrid = { innerHTML: "" };
  api.state.products = [
    {
      id: 1,
      name: '<script>alert("x")</script>',
      category: "quesos",
      categoryLabel: "Quesos",
      unit: "kg",
      stock: 1,
      price: 99,
      status: 'normal" onclick="boom',
    },
  ];
  api.state.selectedCategory = "all";
  api.state.visibleProductLimit = 10;

  api.renderProducts();

  assert.match(api.refs.productsGrid.innerHTML, /product-card safe|product-card normal/i);
  assert.doesNotMatch(api.refs.productsGrid.innerHTML, /onclick=/i);
  assert.match(api.refs.productsGrid.innerHTML, /&lt;script&gt;alert/i);
});

test("renderMyMerchandiseRequests downgrades unsafe request status classes", () => {
  const api = loadRenderSanitizationContext();

  api.refs.myMerchandiseRequestsList = { innerHTML: "" };
  api.state.cashier.authenticated = true;
  api.state.cashier.name = "Caja";
  api.state.cashier.branch = "carrizal";
  api.state.merchandise.loadingMyRequests = false;
  api.state.merchandise.myRequests = [
    {
      id: 9,
      status: 'approved" onclick="boom',
      supplierName: "Proveedor Norte",
      createdAt: "2026-07-05T12:00:00.000Z",
      totalValue: 250,
      itemCount: 1,
      itemsSummary: "1 producto",
    },
  ];

  api.renderMyMerchandiseRequests();

  assert.match(api.refs.myMerchandiseRequestsList.innerHTML, /request-status-pill pending/);
  assert.doesNotMatch(api.refs.myMerchandiseRequestsList.innerHTML, /onclick=/i);
});

test("period closure warnings downgrade unsafe severity classes", () => {
  const api = loadRenderSanitizationContext();

  const markup = api.buildPeriodClosureWarningMarkup({
    severity: 'critical" onmouseover="boom',
    code: "sync_warning",
    message: "Pendiente de revision",
  });

  assert.match(markup, /period-closure-warning info/);
  assert.doesNotMatch(markup, /onmouseover=/i);
  assert.match(markup, /Pendiente de revision/);
});

test("admin health panel downgrades unsafe semaphore classes", () => {
  const api = loadRenderSanitizationContext();

  api.refs.adminHealthSummary = { className: "", innerHTML: "" };
  api.refs.adminHealthStatus = { textContent: "", dataset: {} };
  api.refs.adminHealthReasons = { innerHTML: "" };
  api.refs.adminHealthActions = { innerHTML: "" };
  api.state.admin.supportHealth = {
    semaphore: {
      status: 'critical" onclick="boom',
      reasons: [],
      actions: [],
    },
    backups: {
      enabled: true,
      restartRequired: false,
      lastRun: { status: "ok" },
    },
    syncHealth: {
      hasPending: false,
    },
    recentErrors: [],
    latestSale: null,
  };

  api.renderAdminHealthPanel();

  assert.equal(api.refs.adminHealthSummary.className, "admin-health-banner unknown");
  assert.equal(api.refs.adminHealthStatus.dataset.status, "unknown");
  assert.doesNotMatch(api.refs.adminHealthSummary.innerHTML, /onclick=/i);
});

test("admin health panel surfaces runtime errors and invalid control URL labels safely", () => {
  const api = loadRenderSanitizationContext();

  api.refs.adminHealthSummary = { className: "", innerHTML: "" };
  api.refs.adminHealthStatus = { textContent: "", dataset: {} };
  api.refs.adminHealthReasons = { innerHTML: "" };
  api.refs.adminHealthActions = { innerHTML: "" };
  api.state.admin.supportHealth = {
    semaphore: {
      status: "risk",
      reasons: [],
      actions: [],
    },
    backups: {
      enabled: true,
      restartRequired: false,
      lastRun: { status: "ok" },
    },
    runtimeConfig: {
      error: 'archivo roto <script>alert("x")</script>',
      restartRequired: false,
      loaded: false,
      pendingRestartKeys: [],
    },
    security: {
      status: "critical",
      secureCookies: true,
      controlApiUrl: "nota-url",
      controlApiInvalid: true,
      controlApiHttps: false,
    },
    syncHealth: {
      hasPending: false,
    },
    recentErrors: [],
    latestSale: {
      ticketNumber: 'A-1" onclick="boom',
      total: 99,
    },
  };

  api.renderAdminHealthPanel();

  assert.match(api.refs.adminHealthSummary.innerHTML, /runtime error/i);
  assert.match(api.refs.adminHealthSummary.innerHTML, /owner URL invalida/i);
  assert.match(api.refs.adminHealthSummary.innerHTML, /archivo roto &lt;script&gt;alert/i);
  assert.doesNotMatch(api.refs.adminHealthSummary.innerHTML, /onclick=/i);
});

test("quick import downgrades unsafe product status classes", () => {
  const api = loadRenderSanitizationContext();

  api.refs.quickImportDescription = { textContent: "" };
  api.refs.quickImportValueLabel = { textContent: "" };
  api.refs.quickImportHelper = { textContent: "" };
  api.refs.quickImportSupplier = { value: "" };
  api.refs.quickImportNote = { value: "" };
  api.refs.quickImportValue = { value: "", step: "", min: "", placeholder: "" };
  api.refs.quickImportProductName = { textContent: "" };
  api.refs.quickImportProductMeta = { textContent: "" };
  api.refs.quickImportProductPosition = { textContent: "" };
  api.refs.quickImportProductStatus = { className: "", textContent: "" };
  api.refs.quickImportCurrentState = { className: "", textContent: "" };
  api.refs.quickImportStockBefore = { textContent: "" };
  api.refs.quickImportSoldToday = { textContent: "" };
  api.refs.quickImportStockResult = { textContent: "" };
  api.state.quickImport.mode = "receive";
  api.state.quickImport.index = 0;
  api.state.quickImport.items = [
    {
      id: 1,
      name: "Queso",
      categoryLabel: "Lacteos",
      unit: "kg",
      recordedStock: 3,
      soldToday: 1,
      status: 'normal" onclick="boom',
    },
  ];

  api.renderQuickImportCurrentItem();

  assert.equal(api.refs.quickImportProductStatus.className, "status-chip normal");
  assert.match(api.refs.quickImportCurrentState.className, /^quick-import-current-state /);
  assert.doesNotMatch(api.refs.quickImportCurrentState.className, /onclick=/i);
});
