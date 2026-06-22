const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadNetworkApi(fetchImpl) {
  const rootDir = path.resolve(__dirname, "..");
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Error,
    TypeError,
    Promise,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Math,
    fetch: fetchImpl,
    navigator: { onLine: true },
    refs: {},
    state: {
      online: true,
      admin: {
        authenticated: true,
        csrfToken: "csrf-token",
        username: "diana",
      },
      owner: {
        authenticated: false,
      },
      adminCapabilities: [],
      cashier: {
        token: "",
      },
    },
    renderSyncStatus() {},
    scheduleConnectionRecovery() {},
    closeAdminModal() {},
    renderAdminModal() {},
    handleApprovalsMobileAdminSessionLoss() {},
  };
  context.globalThis = context;

  const vmContext = vm.createContext(context);
  const source = fs.readFileSync(path.join(rootDir, "public/js/network.js"), "utf8");
  new vm.Script(source, { filename: "public/js/network.js" }).runInContext(vmContext);
  new vm.Script(`
    globalThis.__networkApi = {
      requestAdminJson,
    };
  `).runInContext(vmContext);
  return context.__networkApi;
}

test("requestAdminJson preserves structured admin errors", async () => {
  const api = loadNetworkApi(async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      message: "Hay cola pendiente por sincronizar.",
      code: "sync_pending",
      warnings: [{
        code: "sync_pending",
        severity: "error",
        message: "Hay cola pendiente por sincronizar.",
      }],
    }),
  }));

  await assert.rejects(
    () => api.requestAdminJson("/api/admin/period-closures", { method: "POST" }),
    (error) => {
      assert.equal(error.message, "Hay cola pendiente por sincronizar.");
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "sync_pending");
      assert.ok(Array.isArray(error.warnings));
      assert.equal(error.warnings[0].code, "sync_pending");
      return true;
    },
  );
});
