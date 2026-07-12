const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBrandingClientApi({
  fetchImpl,
  requestAdminJsonImpl,
  controllerDidTimeout = false,
} = {}) {
  const rootDir = path.resolve(__dirname, "..");
  const toastCalls = [];
  const objectUrls = [];
  const revokedUrls = [];
  const requestControllerCalls = [];
  const sessionFailureCalls = [];
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
    ADMIN_REQUEST_TIMEOUT_MS: 4321,
    navigator: { onLine: true },
    document: { title: "" },
    window: {
      confirm() {
        return true;
      },
    },
    URL: {
      createObjectURL(file) {
        const url = `blob:${file.name}`;
        objectUrls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    },
    FormData: class FormDataStub {},
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({}) })),
    requestAdminJson: requestAdminJsonImpl || (async () => ({})),
    createRequestController(signal, timeoutMs) {
      const call = { signal, timeoutMs, cleaned: false };
      requestControllerCalls.push(call);
      return {
        signal: { testSignal: true },
        didTimeout: () => controllerDidTimeout,
        cleanup() {
          call.cleaned = true;
        },
      };
    },
    createTimeoutError(timeoutMs) {
      return Object.assign(new Error(`timeout ${timeoutMs}`), { name: "AbortError", isTimeout: true });
    },
    isNetworkError(error) {
      return error?.name === "AbortError" || error instanceof TypeError;
    },
    markConnectionOffline() {},
    getAdminAuthHeaders() {
      return { "X-CSRF-Token": "csrf-token" };
    },
    handleAdminSessionFailure(error) {
      sessionFailureCalls.push(error);
      return error?.statusCode === 401 || error?.statusCode === 403;
    },
    getStoreProfile() {
      return context.__brandingApi.state.profile;
    },
    getStoreName() {
      return context.__brandingApi.state.profile.businessName;
    },
    getVisibleText(_key, fallback) {
      return fallback;
    },
    hasEnabledModule(code) {
      return context.__brandingApi.state.enabledModules.includes(code);
    },
    hasAdminCapability() {
      return true;
    },
    escapeHtml(value) {
      return String(value);
    },
    setSelectOptions() {},
    formatQuantity(value) {
      return String(value);
    },
    showToast(message, type) {
      toastCalls.push({ message, type });
    },
    updateModuleVisibility() {},
    renderCategoryFilters() {},
    syncAdminProductCatalogs() {},
    renderAdminBrandingEditor() {},
  };
  context.globalThis = context;
  context.window.document = context.document;

  const vmContext = vm.createContext(context);
  [
    "public/js/config.js",
    "public/js/state.js",
    "public/js/actions.js",
    "public/js/render-admin.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
    new vm.Script(source, { filename: relativePath }).runInContext(vmContext);
  });

  new vm.Script(`
    globalThis.__brandingApi = {
      state,
      refs,
      applyBusinessBranding,
      markAdminConfigDirty,
      buildAdminConfigPatchPayload,
      captureAdminConfigDirtyRevisions,
      loadAdminConfig,
      submitAdminConfig,
      renderAdminConfigPanel,
      selectAdminBrandingLogo,
      requestAdminMultipartJson,
    };
  `).runInContext(vmContext);

  return {
    api: context.__brandingApi,
    objectUrls,
    revokedUrls,
    requestControllerCalls,
    sessionFailureCalls,
    toastCalls,
  };
}

function createValueRef(value = "") {
  return { value };
}

function prepareAdminConfigRefs(api) {
  api.refs.adminModal = { classList: { contains: () => true } };
  api.refs.configAllowNegativeStock = { checked: false };
  api.refs.configBusinessName = createValueRef("");
  api.refs.configShortName = createValueRef("");
  api.refs.configSlug = createValueRef("");
  api.refs.configTimezone = createValueRef("");
  api.refs.configLocale = createValueRef("");
  api.refs.configCurrencyCode = createValueRef("");
  api.refs.configTicketPrefix = createValueRef("");
  api.refs.configModulesWrap = {
    innerHTML: "",
    querySelectorAll() {
      return [];
    },
  };
}

test("dirty admin config survives unrelated rerenders", () => {
  const { api } = loadBrandingClientApi();
  api.refs.adminModal = { classList: { contains: () => true } };
  api.refs.configBusinessName = createValueRef("Nombre que estoy escribiendo");
  api.refs.configShortName = createValueRef("Borrador");
  api.refs.configSlug = createValueRef("borrador");
  api.refs.configTimezone = createValueRef("America/Mexico_City");
  api.refs.configLocale = createValueRef("es-MX");
  api.refs.configCurrencyCode = createValueRef("MXN");
  api.refs.configTicketPrefix = createValueRef("BOR");
  api.refs.configModulesWrap = { innerHTML: "modulos-borrador" };

  api.state.profile.businessName = "Nombre guardado";
  api.state.profile.shortName = "Guardado";
  api.markAdminConfigDirty("businessProfile", "businessName");
  api.markAdminConfigDirty("businessProfile", "shortName");
  api.markAdminConfigDirty("enabledModules");
  api.renderAdminConfigPanel();

  assert.equal(api.state.admin.configDirty, true);
  assert.equal(api.refs.configBusinessName.value, "Nombre que estoy escribiendo");
  assert.equal(api.refs.configShortName.value, "Borrador");
  assert.equal(api.refs.configModulesWrap.innerHTML, "modulos-borrador");
});

test("config load finishing in the background does not erase an edit made while waiting", async () => {
  let resolveSettings;
  const settingsResponse = new Promise((resolve) => {
    resolveSettings = resolve;
  });
  const { api } = loadBrandingClientApi({
    requestAdminJsonImpl: async () => settingsResponse,
  });
  prepareAdminConfigRefs(api);

  const loading = api.loadAdminConfig();
  api.refs.configBusinessName.value = "Cambio durante la carga";
  api.markAdminConfigDirty("businessProfile", "businessName");
  resolveSettings({
    settings: { "sales.allow_negative_stock": "true" },
    businessProfile: { ...api.state.profile, businessName: "Nombre remoto" },
    enabledModules: [],
  });
  await loading;

  assert.equal(api.state.admin.configDirty, true);
  assert.equal(api.refs.configBusinessName.value, "Cambio durante la carga");
  assert.equal(api.refs.configAllowNegativeStock.checked, true);
});

test("config PATCH sends only edited fields and an older GET cannot overwrite it", async () => {
  let resolveOldGet;
  let patchPayload;
  const oldGet = new Promise((resolve) => {
    resolveOldGet = resolve;
  });
  const { api } = loadBrandingClientApi({
    requestAdminJsonImpl: async (url, options = {}) => {
      if (options.method === "PATCH") {
        patchPayload = JSON.parse(options.body);
        return {
          businessProfile: { ...api.state.profile, businessName: "Nombre nuevo" },
          enabledModules: ["weighted_audit"],
          settings: { "sales.allow_negative_stock": "false" },
        };
      }
      return oldGet;
    },
  });
  prepareAdminConfigRefs(api);
  api.state.enabledModules = ["weighted_audit"];
  api.refs.configBusinessName.value = "Nombre nuevo";

  const staleLoad = api.loadAdminConfig();
  api.markAdminConfigDirty("businessProfile", "businessName");
  await api.submitAdminConfig();
  resolveOldGet({
    businessProfile: { ...api.state.profile, businessName: "Nombre viejo" },
    enabledModules: [],
    settings: { "sales.allow_negative_stock": "true" },
  });
  await staleLoad;

  assert.deepEqual(patchPayload, { businessProfile: { businessName: "Nombre nuevo" } });
  assert.equal(api.state.profile.businessName, "Nombre nuevo");
  assert.deepEqual(api.state.enabledModules, ["weighted_audit"]);
  assert.equal(api.state.admin.configDirty, false);
});

test("an edit made while PATCH is pending keeps its newer field revision", async () => {
  let resolvePatch;
  let patchCalls = 0;
  const patchResponse = new Promise((resolve) => {
    resolvePatch = resolve;
  });
  const { api } = loadBrandingClientApi({
    requestAdminJsonImpl: async () => {
      patchCalls += 1;
      return patchResponse;
    },
  });
  prepareAdminConfigRefs(api);
  api.refs.configBusinessName.value = "Primera version";
  api.markAdminConfigDirty("businessProfile", "businessName");

  const saving = api.submitAdminConfig();
  api.refs.configBusinessName.value = "Version escrita durante guardado";
  api.markAdminConfigDirty("businessProfile", "businessName");
  await api.submitAdminConfig();
  assert.equal(patchCalls, 1);
  resolvePatch({
    businessProfile: { ...api.state.profile, businessName: "Primera version" },
    enabledModules: [],
  });
  await saving;

  assert.equal(api.state.admin.configDirty, true);
  assert.equal(api.refs.configBusinessName.value, "Version escrita durante guardado");
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.buildAdminConfigPatchPayload(api.captureAdminConfigDirtyRevisions()))),
    { businessProfile: { businessName: "Version escrita durante guardado" } },
  );
});

test("logo picker validates type and 2 MiB limit while keeping a local preview", () => {
  const { api, objectUrls, toastCalls } = loadBrandingClientApi();
  api.refs.configLogoInput = createValueRef();

  api.selectAdminBrandingLogo({
    target: {
      files: [{ name: "logo.svg", type: "image/svg+xml", size: 300 }],
      value: "logo.svg",
    },
  });
  assert.equal(api.state.admin.brandingLogo.file, null);
  assert.match(toastCalls.at(-1).message, /PNG o JPEG/);

  api.selectAdminBrandingLogo({
    target: {
      files: [{ name: "enorme.png", type: "image/png", size: (2 * 1024 * 1024) + 1 }],
      value: "enorme.png",
    },
  });
  assert.equal(api.state.admin.brandingLogo.file, null);
  assert.match(toastCalls.at(-1).message, /2 MiB/);

  const file = { name: "logo.jpg", type: "image/jpeg", size: 1024 };
  api.selectAdminBrandingLogo({ target: { files: [file], value: "logo.jpg" } });
  assert.equal(api.state.admin.brandingLogo.file, file);
  assert.equal(api.state.admin.brandingLogo.previewUrl, "blob:logo.jpg");
  assert.deepEqual(objectUrls, ["blob:logo.jpg"]);
});

test("branding prefers uploaded logo and multipart request keeps browser boundary and timeout", async () => {
  let request;
  const { api, requestControllerCalls } = loadBrandingClientApi({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ businessProfile: {} }) };
    },
  });
  api.state.profile = {
    businessName: "Mi negocio",
    shortName: "MNB",
    branding: {
      logo192: "/legacy.png",
      uploadedLogo: { url: "/api/branding/logo/version-1" },
    },
  };
  api.refs.storeLogo = { hidden: true, src: "", alt: "" };
  api.refs.storeLogoFallback = { hidden: false, textContent: "" };
  api.applyBusinessBranding();
  assert.equal(api.refs.storeLogo.src, "/api/branding/logo/version-1");

  const formData = new (class BrandingFormData {})();
  await api.requestAdminMultipartJson("/api/admin/branding/logo", formData);
  assert.equal(request.url, "/api/admin/branding/logo");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.headers["X-CSRF-Token"], "csrf-token");
  assert.equal(Object.hasOwn(request.options.headers, "Content-Type"), false);
  assert.equal(request.options.body, formData);
  assert.equal(requestControllerCalls[0].timeoutMs, 4321);
  assert.equal(requestControllerCalls[0].cleaned, true);
});

test("multipart request normalizes timeout and always cleans its controller", async () => {
  const { api, requestControllerCalls } = loadBrandingClientApi({
    controllerDidTimeout: true,
    fetchImpl: async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
  });
  await assert.rejects(
    () => api.requestAdminMultipartJson("/api/admin/branding/logo", {}),
    (error) => error.isTimeout === true && error.message === "timeout 4321",
  );
  assert.equal(requestControllerCalls[0].cleaned, true);
});

test("multipart auth failures invalidate the admin session through the shared handler", async () => {
  const { api, sessionFailureCalls } = loadBrandingClientApi({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: "Sesion vencida" }),
    }),
  });

  await assert.rejects(
    () => api.requestAdminMultipartJson("/api/admin/branding/logo", {}),
    /Sesion vencida/,
  );
  assert.equal(sessionFailureCalls.length, 1);
  assert.equal(sessionFailureCalls[0].statusCode, 401);
});

test("admin branding markup restricts the file selector to PNG and JPEG", () => {
  const rootDir = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(rootDir, "public/index.html"), "utf8");
  assert.match(html, /id="config-logo-input"[\s\S]*accept="image\/png,image\/jpeg,\.png,\.jpg,\.jpeg"/);
});
