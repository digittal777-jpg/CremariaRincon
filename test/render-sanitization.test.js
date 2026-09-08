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
      getElementsByTagName() {
        return [];
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
    __adminRequests: [],
    async requestAdminJson(url, options = {}) {
      context.__adminRequests.push({
        url: String(url),
        options,
      });
      return {
        product: {
          id: 1,
          name: "Queso",
          categoryLabel: "Lacteos",
          unit: "kg",
          stock: JSON.parse(options.body || "{}").stock ?? 0,
          status: "normal",
        },
      };
    },
    async refreshCurrentSnapshot() {
      return {};
    },
    async refreshAdminWorkspace() {
      return {};
    },
    getAdminWorkspaceLiveOptions() {
      return {};
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
      renderCashierSession,
      renderDetailViewer,
      renderMyMerchandiseRequests,
      getFilteredMerchandiseProducts,
      getMerchandiseSupplierSuggestions,
      updateMerchandiseRequestQuickQuantity,
      addMerchandiseRequestQuickItem,
      renderAdminHealthPanel,
      buildPeriodClosureWarningMarkup,
      renderAdminModal,
      renderQuickImportCurrentItem,
      saveQuickImportEntry,
      updateCurrentQuickImportDraft,
      buildSaleTicketPrintHtml,
      getAdminRequests() {
        return globalThis.__adminRequests.slice();
      },
    };
  `).runInContext(vmContext);

  return vmContext.__renderSanitizationTestApi;
}

test("admin modal render keeps the selected branch view instead of snapshot branch", () => {
  const api = loadRenderSanitizationContext();
  const metricRef = () => ({ textContent: "", innerHTML: "", dataset: {}, children: [] });

  api.refs.adminModal = {
    classList: {
      contains(className) {
        return className === "open";
      },
    },
  };
  api.refs.adminCard = {
    classList: { add() {} },
    dataset: {},
  };
  api.refs.adminBranchSelect = { innerHTML: "", value: "" };
  api.refs.adminBranchTitle = { textContent: "" };
  api.refs.adminBranchDescription = { textContent: "" };
  api.refs.adminMetricsStatus = metricRef();
  api.refs.adminProcessCpu = metricRef();
  api.refs.adminProcessMemory = metricRef();
  api.refs.adminProductsRender = metricRef();
  api.refs.adminSnapshotRender = metricRef();
  api.refs.adminDomNodes = metricRef();
  api.refs.adminServerRuntime = metricRef();
  api.refs.adminServerMemory = metricRef();
  api.refs.adminClientMemory = metricRef();
  api.refs.adminClientHardware = metricRef();
  api.refs.adminClientNetwork = metricRef();
  api.refs.inventoryBody = { children: [] };
  api.state.admin.branch = "all";
  api.state.admin.snapshot = {
    store: {
      currentBranch: "chris",
      currentBranchLabel: "Chris",
    },
    summary: {},
    shiftSummary: [],
  };

  api.renderAdminModal();

  assert.equal(api.state.admin.branch, "all");
  assert.equal(api.refs.adminBranchSelect.value, "all");
  assert.equal(api.refs.adminBranchTitle.textContent, "Todas las sucursales");
  assert.match(api.refs.adminBranchDescription.textContent, /ambas sucursales/i);
});

test("sanitizeClassToken falls back when an unsafe class token arrives", () => {
  const api = loadRenderSanitizationContext();

  assert.equal(api.sanitizeClassToken('normal" onclick="boom', "safe"), "safe");
  assert.equal(api.sanitizeClassToken("  CRITICAL_status  ", "safe"), "critical_status");
  assert.equal(api.sanitizeClassToken("%%%"), "");
});

test("merchandise request searches by supplier brand sku and barcode", () => {
  const api = loadRenderSanitizationContext();

  api.state.products = [
    {
      id: 1,
      active: true,
      name: "Crema entera",
      categoryLabel: "Lacteos",
      unit: "pz",
      price: 22,
      stock: 4,
      supplierName: "Lala",
      brand: "Lala",
      sku: "CRE-LA",
      barcode: "7501001",
    },
    {
      id: 2,
      active: true,
      name: "Jamon de pavo",
      categoryLabel: "Carnes frias",
      unit: "kg",
      price: 96,
      stock: 3,
      supplierName: "Sigma",
      brand: "Fud",
      sku: "JAM-SI",
      barcode: "7502002",
    },
  ];

  api.state.merchandise.supplierName = "sig";
  api.state.merchandise.search = "7502002";

  assert.deepEqual(api.getFilteredMerchandiseProducts().map((product) => product.id), [2]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.getMerchandiseSupplierSuggestions().map((supplier) => supplier.label))),
    ["Lala", "Sigma"],
  );
});

test("merchandise quick card buttons add receive and return lines without item modal", () => {
  const api = loadRenderSanitizationContext();

  api.refs.merchandiseRequestModal = {};
  api.refs.merchandiseRequestSearch = { value: "" };
  api.refs.merchandiseRequestSupplier = { value: "" };
  api.refs.merchandiseRequestSupplierChips = { innerHTML: "" };
  api.refs.merchandiseRequestNote = { value: "" };
  api.refs.merchandiseRequestSaveButton = { disabled: false, textContent: "" };
  api.refs.merchandiseRequestProducts = { innerHTML: "" };
  api.refs.merchandiseRequestItems = { innerHTML: "" };
  api.refs.merchandiseRequestTotalLabel = { textContent: "" };
  api.refs.merchandiseRequestTotal = { textContent: "" };
  api.state.products = [
    {
      id: 7,
      active: true,
      name: "Queso panela",
      categoryLabel: "Lacteos",
      unit: "kg",
      unitStep: 0.25,
      allowDecimals: true,
      price: 80,
      stock: 2,
      status: "normal",
      supplierName: "Rancho",
    },
  ];

  api.updateMerchandiseRequestQuickQuantity(7, "2.5");
  api.addMerchandiseRequestQuickItem(7, "receive");
  api.updateMerchandiseRequestQuickQuantity(7, "1");
  api.addMerchandiseRequestQuickItem(7, "return");

  assert.equal(api.state.merchandise.items.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.state.merchandise.items.map((item) => ({
      productId: item.productId,
      mode: item.mode,
      quantity: item.quantity,
      totalValue: item.totalValue,
    })))),
    [
      { productId: 7, mode: "receive", quantity: 2.5, totalValue: 200 },
      { productId: 7, mode: "return", quantity: 1, totalValue: -80 },
    ],
  );
});

test("cashier session renders explicit offline readiness pill", () => {
  const api = loadRenderSanitizationContext();

  api.refs.branchDisplay = { value: "" };
  api.refs.cashierInput = { value: "" };
  api.refs.cashierSessionLabel = { textContent: "" };
  api.refs.cashierSessionHelper = { textContent: "" };
  api.refs.offlineReadyPill = { textContent: "", title: "", dataset: {} };
  api.refs.logoutCashierButton = { disabled: false };
  api.refs.openPaymentButton = { disabled: false };
  api.refs.openStartRegisterButton = { disabled: false };
  api.refs.openQuickCutButton = { disabled: false };
  api.refs.openFinalCutButton = { disabled: false };
  api.state.cashier.authenticated = true;
  api.state.cashier.name = "Ana";
  api.state.cashier.branch = "carrizal";
  api.state.cashier.token = "cashier-token";
  api.state.products = [{ id: 1 }, { id: 2 }];
  api.state.offlineSales = [];
  api.state.offlineReceivablePayments = [];

  api.renderCashierSession();

  assert.match(api.refs.offlineReadyPill.textContent, /Offline listo/i);
  assert.match(api.refs.offlineReadyPill.textContent, /Carrizal/i);
  assert.equal(api.refs.offlineReadyPill.dataset.status, "ready");
  assert.match(api.refs.offlineReadyPill.title, /preparado/i);
  assert.match(api.refs.offlineReadyPill.title, /2 producto/i);

  api.state.cashier.authenticated = false;
  api.state.cashier.token = "";
  api.state.offlineSales = [
    {
      clientSaleId: "sale-pending",
      status: "pending",
      cashier: "Ana",
      branch: "carrizal",
      requestPayload: {
        clientSaleId: "sale-pending",
        cashier: "Ana",
        branch: "carrizal",
        items: [],
      },
    },
  ];

  api.renderCashierSession();

  assert.equal(api.refs.offlineReadyPill.textContent, "Reactivar cajero");
  assert.equal(api.refs.offlineReadyPill.dataset.status, "needs_session");
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

test("sale detail exposes a print action and keeps ticket markup sanitized", () => {
  const api = loadRenderSanitizationContext();

  api.refs.detailViewerModal = {};
  api.refs.detailViewerTitle = { textContent: "" };
  api.refs.detailViewerMeta = { textContent: "" };
  api.refs.detailViewerBody = { innerHTML: "" };
  api.state.detailViewer = {
    loading: false,
    kind: "sale",
    detail: {
      id: 1,
      ticketNumber: 'T-1" onclick="boom',
      createdAt: "2026-07-05T12:00:00.000Z",
      cashier: "Caja",
      shift: "Tarde",
      paymentMethod: "Efectivo",
      customerName: '<script>alert("cliente")</script>',
      receivedAmount: 150,
      changeAmount: 25,
      total: 125,
      items: [
        {
          productName: '<img src=x onerror="boom">',
          quantity: 1,
          unitPrice: 125,
          lineTotal: 125,
        },
      ],
    },
  };

  api.renderDetailViewer();

  assert.match(api.refs.detailViewerBody.innerHTML, /data-action="print-sale-ticket"/);
  assert.match(api.refs.detailViewerBody.innerHTML, /&lt;script&gt;alert/);
  assert.match(api.refs.detailViewerBody.innerHTML, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.doesNotMatch(api.refs.detailViewerBody.innerHTML, /onclick=/i);

  const printHtml = api.buildSaleTicketPrintHtml(api.state.detailViewer.detail);
  assert.match(printHtml, /T-1&quot; onclick=&quot;boom/);
  assert.match(printHtml, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.doesNotMatch(printHtml, /<img src=x/i);
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
  api.refs.adminMerchantStatusSummary = { innerHTML: "" };
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
  assert.match(api.refs.adminMerchantStatusSummary.innerHTML, /Internet/);
  assert.doesNotMatch(api.refs.adminMerchantStatusSummary.innerHTML, /onclick=/i);
});

test("admin health panel surfaces runtime errors and invalid control URL labels safely", () => {
  const api = loadRenderSanitizationContext();

  api.refs.adminHealthSummary = { className: "", innerHTML: "" };
  api.refs.adminMerchantStatusSummary = { innerHTML: "" };
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
      lastRun: { status: "ok", backupDateKey: '2026-08-15" onclick="boom' },
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
    app: {
      name: 'Merxalia <script>alert("x")</script>',
      version: '1.0" onclick="boom',
      printing: {
        mode: "browser",
        receiptWidthMm: 80,
      },
    },
    supportContact: {
      configured: true,
      label: 'Soporte <img src=x onerror="boom">',
    },
  };

  api.renderAdminHealthPanel();

  assert.match(api.refs.adminHealthSummary.innerHTML, /runtime error/i);
  assert.match(api.refs.adminHealthSummary.innerHTML, /owner URL invalida/i);
  assert.match(api.refs.adminHealthSummary.innerHTML, /archivo roto &lt;script&gt;alert/i);
  assert.doesNotMatch(api.refs.adminHealthSummary.innerHTML, /<script|<img/i);
  assert.match(api.refs.adminMerchantStatusSummary.innerHTML, /Ultimo backup/);
  assert.match(api.refs.adminMerchantStatusSummary.innerHTML, /Merxalia &lt;script&gt;alert/);
  assert.match(api.refs.adminMerchantStatusSummary.innerHTML, /Soporte &lt;img/);
  assert.doesNotMatch(api.refs.adminMerchantStatusSummary.innerHTML, /<script|<img/i);
});

test("quick import downgrades unsafe product status classes", () => {
  const api = loadRenderSanitizationContext();

  api.refs.quickImportTitle = { textContent: "" };
  api.refs.quickImportDescription = { textContent: "" };
  api.refs.quickImportValueLabel = { textContent: "" };
  api.refs.quickImportHelper = { textContent: "" };
  api.refs.quickImportProviderField = { hidden: false };
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

test("quick import count mode uses absolute physical stock", async () => {
  const api = loadRenderSanitizationContext();
  const makeButton = () => ({ disabled: false, textContent: "" });

  api.refs.quickImportModal = { classList: { contains: () => true } };
  api.refs.quickImportTitle = { textContent: "" };
  api.refs.quickImportModeBar = { querySelectorAll: () => [] };
  api.refs.quickImportDescription = { textContent: "" };
  api.refs.quickImportValueLabel = { textContent: "" };
  api.refs.quickImportHelper = { textContent: "" };
  api.refs.quickImportProviderField = { hidden: false };
  api.refs.quickImportSupplier = { value: "" };
  api.refs.quickImportNote = { value: "" };
  api.refs.quickImportValue = {
    value: "",
    step: "",
    min: "",
    placeholder: "",
    focus() {},
    select() {},
  };
  api.refs.quickImportProductName = { textContent: "" };
  api.refs.quickImportProductMeta = { textContent: "" };
  api.refs.quickImportProductPosition = { textContent: "" };
  api.refs.quickImportProductStatus = { className: "", textContent: "" };
  api.refs.quickImportCurrentState = { className: "", textContent: "" };
  api.refs.quickImportStockBefore = { textContent: "" };
  api.refs.quickImportSoldToday = { textContent: "" };
  api.refs.quickImportStockResult = { textContent: "" };
  api.refs.quickImportProgressText = { textContent: "" };
  api.refs.quickImportProgressNote = { textContent: "" };
  api.refs.quickImportProgressFill = { className: "" };
  api.refs.quickImportTotalCount = { textContent: "" };
  api.refs.quickImportPendingCount = { textContent: "" };
  api.refs.quickImportSavedCount = { textContent: "" };
  api.refs.quickImportSkippedCount = { textContent: "" };
  api.refs.quickImportFilterSummary = { textContent: "" };
  api.refs.quickImportSearch = { value: "" };
  api.refs.quickImportNextList = { innerHTML: "", querySelector: () => null };
  api.refs.quickImportEmpty = { hidden: true, textContent: "" };
  api.refs.quickImportContent = { hidden: false };
  api.refs.quickImportPrevButton = makeButton();
  api.refs.quickImportNextButton = makeButton();
  api.refs.quickImportSkipButton = makeButton();
  api.refs.quickImportSaveCurrentButton = makeButton();
  api.refs.quickImportSaveButton = makeButton();

  api.state.admin.branch = "carrizal";
  api.state.quickImport.mode = "count";
  api.state.quickImport.index = 0;
  api.state.quickImport.filteredIndexes = [0];
  api.state.quickImport.items = [
    {
      id: 1,
      name: "Queso",
      categoryLabel: "Lacteos",
      unit: "kg",
      recordedStock: 10,
      soldToday: 2,
      status: "normal",
    },
  ];
  api.state.quickImport.draftsByProductId = {
    1: { quantity: "4", note: "", dirty: true },
  };

  api.renderQuickImportCurrentItem();

  assert.equal(api.refs.quickImportTitle.textContent, "Conteo fisico");
  assert.equal(api.refs.quickImportValueLabel.textContent, "Cantidad contada");
  assert.equal(api.refs.quickImportStockResult.textContent, "4 kg");
  assert.equal(api.refs.quickImportProviderField.hidden, true);

  await api.saveQuickImportEntry({ advance: false });
  const request = api.getAdminRequests().at(-1);
  assert.equal(request.url, "/api/products/1");
  assert.equal(request.options.method, "PATCH");
  assert.deepEqual(JSON.parse(request.options.body), {
    branch: "carrizal",
    stock: 4,
    note: "Conteo fisico de inventario",
  });

  api.state.quickImport.draftsByProductId = {
    1: { quantity: "-1", note: "", dirty: true },
  };
  const requestsBeforeInvalid = api.getAdminRequests().length;
  await api.saveQuickImportEntry({ advance: false });
  assert.equal(api.getAdminRequests().length, requestsBeforeInvalid);

  api.state.quickImport.draftsByProductId = {
    1: { quantity: "0", note: "", dirty: true },
  };
  await api.saveQuickImportEntry({ advance: false });
  assert.equal(JSON.parse(api.getAdminRequests().at(-1).options.body).stock, 0);
});
