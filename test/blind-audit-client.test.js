const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBlindAuditClientContext() {
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
    navigator: { onLine: false, maxTouchPoints: 0 },
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
    globalThis.__blindAuditClientTestApi = {
      state,
      refs,
      updateCashierBlindAuditDraft,
      parseCashierBlindAuditCountedStock,
    };
  `).runInContext(vmContext);

  return {
    context: vmContext,
    api: vmContext.__blindAuditClientTestApi,
  };
}

test("cashier blind audit draft keeps partial decimal input without rebuilding the modal", () => {
  const loaded = loadBlindAuditClientContext();
  const { context, api } = loaded;

  api.state.cashierBlindAudit.prompt = {
    sessionId: 77,
    items: [
      {
        itemId: 10,
        productName: "Queso Hebra",
        countedStock: null,
      },
    ],
  };
  api.state.cashierBlindAudit.draftItems = {};
  api.state.cashierBlindAudit.previewByItemId = {};
  api.state.cashierBlindAudit.previewing = false;
  api.state.online = false;

  const capturedCounter = { textContent: "0" };
  const differenceLabel = { textContent: "", className: "" };

  api.refs.cashierBlindAuditSummary = {
    querySelector(selector) {
      return selector === "[data-blind-audit-captured-count]" ? capturedCounter : null;
    },
  };
  api.refs.cashierBlindAuditItems = {
    querySelector(selector) {
      return selector === '[data-blind-audit-difference-for="10"]' ? differenceLabel : null;
    },
  };

  let renderCalls = 0;
  context.renderCashierBlindAuditModal = () => {
    renderCalls += 1;
  };

  api.updateCashierBlindAuditDraft(10, "1.");

  assert.equal(api.state.cashierBlindAudit.draftItems[10], "1.");
  assert.equal(capturedCounter.textContent, "1");
  assert.match(differenceLabel.textContent, /pendiente/i);
  assert.match(differenceLabel.className, /pending/);
  assert.equal(renderCalls, 0);
});

test("cashier blind audit parser accepts point and comma decimals", () => {
  const { api } = loadBlindAuditClientContext();

  assert.equal(api.parseCashierBlindAuditCountedStock("1.594"), 1.594);
  assert.equal(api.parseCashierBlindAuditCountedStock("1,594"), 1.594);
  assert.equal(api.parseCashierBlindAuditCountedStock(""), null);
});
