const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRouteModalFocusContext() {
  const rootDir = path.resolve(__dirname, "..");
  let queuedFrame = null;
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
    navigator: { onLine: true, maxTouchPoints: 1 },
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
        queuedFrame = callback;
      },
      matchMedia() {
        return { matches: true };
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
    },
    performance: {
      now() {
        return 0;
      },
    },
    fetch: async () => {
      throw new Error("fetch no configurado en este test");
    },
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
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__routeModalFocusTestApi = {
      refs,
      focusAndSelectInput,
      openItemModal,
    };
  `).runInContext(vmContext);

  return {
    context: vmContext,
    api: vmContext.__routeModalFocusTestApi,
    hasQueuedFrame() {
      return typeof queuedFrame === "function";
    },
    runQueuedFrame() {
      if (typeof queuedFrame !== "function") {
        return;
      }
      const callback = queuedFrame;
      queuedFrame = null;
      callback();
    },
  };
}

test("focusAndSelectInput preserves the tap gesture before the animation frame", () => {
  const loaded = loadRouteModalFocusContext();
  const { api } = loaded;
  const focusCalls = [];
  const selectionRanges = [];
  let selectCalls = 0;
  const input = {
    value: "12.50",
    focus(options) {
      focusCalls.push(options);
    },
    select() {
      selectCalls += 1;
    },
    setSelectionRange(start, end) {
      selectionRanges.push([start, end]);
    },
  };

  api.focusAndSelectInput(input, { preserveGesture: true });

  assert.equal(focusCalls.length, 1);
  assert.equal(selectCalls, 1);
  assert.deepEqual(selectionRanges, [[0, 5]]);
  assert.equal(loaded.hasQueuedFrame(), true);

  loaded.runQueuedFrame();

  assert.equal(focusCalls.length, 2);
  assert.equal(selectCalls, 2);
});

test("openItemModal requests gesture-preserving focus for the mobile entry field", () => {
  const loaded = loadRouteModalFocusContext();
  const { context, api } = loaded;
  let focusCall = null;

  context.requireCashierSession = () => true;
  context.focusAndSelectInput = (input, options = {}) => {
    focusCall = { input, options };
  };

  api.refs.searchInput = {
    blur() {},
  };
  api.refs.itemModal = {
    classList: {
      toggle() {},
    },
  };
  api.refs.itemModalName = { textContent: "" };
  api.refs.itemModalMeta = { textContent: "" };
  api.refs.itemQuantity = { value: "", step: "", min: "" };
  api.refs.itemTotal = { value: "" };
  api.refs.itemUnitPrice = { value: "" };
  api.refs.itemQuickQuantities = { innerHTML: "" };
  api.refs.itemPricingHint = { textContent: "" };
  api.refs.itemRouteConfirmButton = {
    disabled: false,
    querySelector() {
      return null;
    },
  };
  api.refs.addItemButton = { textContent: "" };

  api.openItemModal({
    id: 7,
    name: "Queso Hebra",
    category: "quesos",
    categoryLabel: "Quesos",
    price: 120,
    stock: 8,
    unit: "kg",
    allowDecimals: true,
    unitStep: 0.25,
  });

  assert.equal(focusCall.input, api.refs.itemTotal);
  assert.equal(focusCall.options.preserveGesture, true);
});
