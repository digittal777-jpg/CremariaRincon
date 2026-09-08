const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadScannerContext() {
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
    },
    document: {
      activeElement: null,
      body: {},
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      createElement() {
        return {
          click() {},
          remove() {},
        };
      },
    },
    performance: {
      now() {
        return 0;
      },
    },
    showToast(message, type) {
      context.__toasts.push({ message, type });
    },
    saveCart() {},
    renderCart() {},
    updatePaymentView() {},
    requestProductsRender() {},
    pulseElement() {},
    persistPreferences() {},
    requireCashierSession() {
      return true;
    },
    openItemModal(product, options = {}) {
      context.__openedProduct = { product, options };
    },
    async ensureAdminActionAccess() {
      return true;
    },
    async requestAdminJson(_url, options = {}) {
      context.__lastAdminRequest = JSON.parse(options.body || "{}");
      return {
        product: {
          id: 77,
          name: context.__lastAdminRequest.name,
          category: "general",
          categoryLabel: "General",
          unit: "pza",
          price: 1,
          stock: 0,
          allowDecimals: false,
          unitStep: 1,
          barcode: context.__lastAdminRequest.barcode,
        },
        snapshot: {},
      };
    },
    applyPublicSnapshot() {},
    refreshCurrentSnapshot: async () => ({}),
    __toasts: [],
    __openedProduct: null,
    __lastAdminRequest: null,
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/helpers.js",
    "public/js/render.js",
    "public/js/sales.js",
    "public/js/app.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    commitCartUiState = function commitCartUiStateStub() {};
    markRouteCartLineMotion = function markRouteCartLineMotionStub() {};
    requestProductsRender = function requestProductsRenderStub() {};
    showToast = function showToastStub(message, type = "info") {
      globalThis.__toasts.push({ message, type });
    };
    openItemModal = function openItemModalStub(product, options = {}) {
      globalThis.__openedProduct = { product, options };
    };
  `).runInContext(vmContext);

  new vm.Script(`
    globalThis.__scannerModeApi = {
      refs,
      state,
      pickExactScannedProductMatch,
      submitScannerCode,
      createScannerProductFromLastCode,
      renderScannerMode,
    };
  `).runInContext(vmContext);

  return {
    api: context.__scannerModeApi,
    context,
  };
}

function installScannerRefs(api, context) {
  api.refs.searchInput = {
    value: "",
    focus() {
      context.document.activeElement = api.refs.searchInput;
    },
    select() {},
  };
  api.refs.scannerStatusPill = {
    textContent: "",
    dataset: {},
  };
  api.refs.scannerCreateProductButton = {
    hidden: true,
    disabled: false,
    textContent: "Crear producto",
  };
  api.refs.toggleScannerModeButton = {
    classList: {
      toggle() {},
    },
    setAttribute() {},
  };
  api.refs.paymentModal = {
    classList: {
      contains() {
        return false;
      },
    },
  };
}

test("scanner mode adds exact barcode matches and clears the scanner input", () => {
  const { api, context } = loadScannerContext();
  installScannerRefs(api, context);
  api.state.ui.scannerMode = true;
  api.state.cashier.authenticated = true;
  api.state.cashier.token = "cashier-token";
  api.state.products = [
    {
      id: 5,
      name: "Agua 600 ml",
      category: "bebidas",
      categoryLabel: "Bebidas",
      unit: "pza",
      price: 12,
      stock: 10,
      allowDecimals: false,
      unitStep: 1,
      barcode: "750100000001",
    },
  ];
  api.refs.searchInput.value = "750100000001";

  assert.equal(api.pickExactScannedProductMatch("750100000001")?.id, 5);
  assert.equal(api.submitScannerCode(), true);

  assert.equal(api.state.cart.length, 1);
  assert.equal(api.state.cart[0].productId, 5);
  assert.equal(api.state.cart[0].quantity, 1);
  assert.equal(api.refs.searchInput.value, "");
  assert.equal(api.refs.scannerStatusPill.dataset.status, "found");
  assert.equal(api.refs.scannerCreateProductButton.hidden, true);
});

test("scanner mode exposes quick product creation for an unknown code", () => {
  const { api, context } = loadScannerContext();
  installScannerRefs(api, context);
  api.state.ui.scannerMode = true;
  api.state.products = [];

  assert.equal(api.submitScannerCode("999001"), false);

  assert.equal(api.state.ui.scannerLastCode, "999001");
  assert.equal(api.refs.scannerStatusPill.dataset.status, "missing");
  assert.equal(api.refs.scannerCreateProductButton.hidden, false);
  assert.match(context.__toasts.at(-1).message, /Codigo no registrado/);
});

test("scanner quick creation uses admin manual product API and opens the product for correction", async () => {
  const { api, context } = loadScannerContext();
  installScannerRefs(api, context);
  api.state.ui.scannerMode = true;
  api.state.ui.scannerLastCode = "ABC-123";
  api.state.categories = [{ id: 1, code: "general", label: "General", active: true }];
  api.state.units = [{ id: 2, code: "pza", label: "Pieza", active: true, allowDecimals: false }];
  api.state.cashier.branch = "carrizal";

  await api.createScannerProductFromLastCode();

  assert.equal(context.__lastAdminRequest.branch, "carrizal");
  assert.equal(context.__lastAdminRequest.barcode, "ABC-123");
  assert.equal(context.__lastAdminRequest.price, 1);
  assert.equal(context.__lastAdminRequest.stock, 0);
  assert.equal(api.refs.scannerStatusPill.dataset.status, "created");
  assert.equal(context.__openedProduct.product.id, 77);
  assert.equal(context.__openedProduct.options.focusField, "total");
});
