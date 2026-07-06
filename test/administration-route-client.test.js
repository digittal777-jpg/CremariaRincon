const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAdministrationRouteApi({
  pathname = "/",
  openedWindow = null,
  onOpen = null,
  onClose = null,
  onTimeout = null,
} = {}) {
  const rootDir = path.resolve(__dirname, "..");
  const location = { pathname, href: pathname };
  const context = {
    console,
    Promise,
    String,
    Boolean,
    Array,
    Object,
    Math,
    navigator: { maxTouchPoints: 0 },
    window: {
      location,
      closed: false,
      open(url, target) {
        onOpen?.(url, target);
        return openedWindow;
      },
      close() {
        onClose?.();
      },
      setTimeout(callback) {
        onTimeout?.();
        callback();
      },
      matchMedia() {
        return { matches: false };
      },
    },
    document: {
      body: {
        classList: {
          add() {},
        },
      },
      addEventListener() {},
    },
    getStoreName() {
      return "Cremeria Rincon";
    },
    showToast() {},
    openAdminModal() {},
  };
  context.globalThis = context;

  const vmContext = vm.createContext(context);
  const source = fs.readFileSync(path.join(rootDir, "public/js/app.js"), "utf8");
  new vm.Script(source, { filename: "public/js/app.js" }).runInContext(vmContext);
  new vm.Script(`
    globalThis.__administrationRouteApi = {
      getApplicationMode,
      openAdministrationRoute,
      returnFromAdministrationRoute,
      shouldBootstrapCashierRuntime,
    };
  `).runInContext(vmContext);

  return {
    api: vmContext.__administrationRouteApi,
    window: context.window,
    location,
  };
}

function getCssRuleBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `No se encontro el selector ${selector}`);
  const openingBrace = css.indexOf("{", start);
  assert.notEqual(openingBrace, -1, `No se encontro bloque para ${selector}`);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openingBrace + 1, index);
      }
    }
  }
  assert.fail(`No se pudo cerrar el bloque de ${selector}`);
}

test("admin button opens a separate administration tab without redirecting cashier", () => {
  const openedWindow = {
    opener: "cashier",
    focused: false,
    focus() {
      this.focused = true;
    },
  };
  const openedRequests = [];
  const { api, location } = loadAdministrationRouteApi({
    openedWindow,
    onOpen(url, target) {
      openedRequests.push({ url, target });
    },
  });

  api.openAdministrationRoute();

  assert.deepEqual(openedRequests, [{ url: "/administracion", target: "_blank" }]);
  assert.equal(location.href, "/");
  assert.equal(openedWindow.opener, null);
  assert.equal(openedWindow.focused, true);
});

test("administration route uses the admin runtime instead of cashier bootstrap", () => {
  const cashierRoute = loadAdministrationRouteApi({ pathname: "/" });
  const adminRoute = loadAdministrationRouteApi({ pathname: "/administracion" });

  assert.equal(cashierRoute.api.getApplicationMode(), "cashier");
  assert.equal(cashierRoute.api.shouldBootstrapCashierRuntime(), true);
  assert.equal(adminRoute.api.getApplicationMode(), "admin");
  assert.equal(adminRoute.api.shouldBootstrapCashierRuntime(), false);
});

test("administration route lets the page scroll from inside the admin panel", () => {
  const rootDir = path.resolve(__dirname, "..");
  const css = fs.readFileSync(path.join(rootDir, "public/styles.css"), "utf8");
  const bodyBlock = getCssRuleBlock(css, "body.administration-page");
  const shellBlock = getCssRuleBlock(css, "body.administration-page #admin-modal.modal-shell");
  const cardBlock = getCssRuleBlock(css, "body.administration-page #admin-modal .admin-card");

  assert.match(bodyBlock, /overflow:\s*auto;/);
  assert.match(bodyBlock, /overscroll-behavior-y:\s*auto;/);
  assert.match(bodyBlock, /touch-action:\s*pan-y;/);
  assert.match(shellBlock, /overflow:\s*visible;/);
  assert.match(cardBlock, /overflow:\s*visible;/);
  assert.match(cardBlock, /overscroll-behavior:\s*auto;/);
  assert.match(cardBlock, /touch-action:\s*pan-y;/);
});

test("admin button only redirects the current tab when the popup is blocked", () => {
  const { api, location } = loadAdministrationRouteApi({ openedWindow: null });

  api.openAdministrationRoute();

  assert.equal(location.href, "/administracion");
});

test("administration close attempts to close its tab before falling back to cashier", () => {
  let closeCalls = 0;
  const { api, window, location } = loadAdministrationRouteApi({
    pathname: "/administracion",
    onClose() {
      closeCalls += 1;
      window.closed = true;
    },
  });

  assert.equal(api.returnFromAdministrationRoute(), true);

  assert.equal(closeCalls, 1);
  assert.equal(location.href, "/administracion");
});
