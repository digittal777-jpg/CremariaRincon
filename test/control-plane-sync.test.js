const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const POS_SRC_DIR = path.join(ROOT_DIR, "src");
const { createApp } = require("../../owner-control/src/app");

async function startOwnerControlServer(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "control-plane-owner-"));
  const app = createApp({
    dbPath: path.join(tempDir, "owner-control.sqlite"),
    ownerToken: "owner-sync-token",
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.controlStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return `http://127.0.0.1:${address.port}`;
}

async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

function clearPosRequireCache() {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(POS_SRC_DIR))
    .forEach((entry) => {
      delete require.cache[entry];
    });
}

test("POS syncs local service subscription from owner-control credentials", async (t) => {
  const baseUrl = await startOwnerControlServer(t);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "control-plane-pos-"));
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_DB_PATH: process.env.POS_DB_PATH,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: process.env.CONTROL_CLIENT_SECRET,
  };

  t.after(() => {
    const dbModule = require("../src/db");
    dbModule.closeDatabaseConnection();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearPosRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createResponse = await json(baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "http://localhost:3100",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const paymentResponse = await json(baseUrl, "/api/owner/clients/cremeria-rincon/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
    body: JSON.stringify({
      amount: 799,
      paymentMethod: "Transferencia",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    }),
  });
  assert.equal(paymentResponse.status, 201);

  const configResponse = await json(baseUrl, "/api/owner/clients/cremeria-rincon/config", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
    body: JSON.stringify({
      enabledModules: ["weighted_audit"],
      adminCapabilities: ["daily_flow", "support_tools"],
    }),
  });
  assert.equal(configResponse.status, 200);

  const runtimeConfigPath = path.join(tempDir, "runtime.json");
  const runtimeResponse = await json(baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
    body: JSON.stringify({
      values: {
        POS_PUBLIC_ORIGIN: "https://cremeria.example",
        POS_ALLOWED_ORIGINS: "https://cremeria.example,http://localhost:3100",
        POS_SECURE_COOKIES: "true",
        CONTROL_CONFIG_POLL_MS: "45000",
        TELEGRAM_CHAT_IDS: "-100987654,12345",
      },
    }),
  });
  assert.equal(runtimeResponse.status, 200);

  process.env.POS_DB_PATH = path.join(tempDir, "pos.sqlite");
  process.env.POS_CONFIG_PATH = runtimeConfigPath;
  process.env.CONTROL_API_URL = baseUrl;
  process.env.CONTROL_CLIENT_SLUG = "cremeria-rincon";
  process.env.CONTROL_CLIENT_SECRET = createResponse.body.apiKey;
  clearPosRequireCache();

  const controlPlane = require("../src/services/controlPlane");
  const ownerConsoleService = require("../src/services/ownerConsole");
  const subscriptionService = require("../src/services/subscription");
  ownerConsoleService.updateOwnerConsoleAccess({
    enabledModules: ["merchandise_requests", "weighted_audit"],
    adminCapabilities: ownerConsoleService.DEFAULT_ADMIN_CAPABILITIES,
  });
  assert.equal(ownerConsoleService.getOwnerConsoleBundle().enabledModules.includes("merchandise_requests"), true);

  const syncResult = await controlPlane.syncServiceSubscriptionFromControlPlane();
  assert.equal(syncResult.subscription.status, "active");
  assert.equal(syncResult.subscription.monthlyAmount, 799);
  assert.equal(syncResult.subscription.currentPeriodEnd, "2026-07-31");
  assert.equal(syncResult.subscription.lastPaymentAt?.slice(0, 10), new Date(paymentResponse.body.payment.paidAt).toISOString().slice(0, 10));
  assert.equal(syncResult.controlPlane.configured, true);
  assert.equal(syncResult.controlPlane.usable, true);
  assert.equal(syncResult.controlPlane.clientSlug, "cremeria-rincon");
  assert.equal(syncResult.paymentsSync.inserted, 1);

  const paymentsAfterFirstSync = subscriptionService.listServiceSubscriptionPayments(12);
  assert.equal(paymentsAfterFirstSync.length, 1);
  assert.equal(paymentsAfterFirstSync[0].amount, 799);
  assert.equal(paymentsAfterFirstSync[0].periodStart, "2026-07-01");
  assert.equal(paymentsAfterFirstSync[0].periodEnd, "2026-07-31");

  const secondSync = await controlPlane.syncServiceSubscriptionFromControlPlane();
  assert.equal(secondSync.paymentsSync.inserted, 0);
  assert.equal(secondSync.paymentsSync.skipped, 1);
  assert.equal(subscriptionService.listServiceSubscriptionPayments(12).length, 1);

  const configSync = await controlPlane.refreshControlPlaneConfigIfStale({ force: true });
  assert.equal(configSync.controlPlane.configured, true);
  assert.equal(configSync.changed, true);
  assert.deepEqual(configSync.remoteConfig.enabledModules, ["weighted_audit"]);
  assert.deepEqual(configSync.remoteConfig.adminCapabilities, ["daily_flow", "support_tools"]);
  assert.deepEqual(configSync.ownerConsole.enabledModules, ["weighted_audit"]);
  assert.deepEqual(configSync.ownerConsole.adminCapabilities, ["daily_flow", "support_tools"]);
  assert.equal(configSync.configSyncReport?.configSync?.status, "applied");
  assert.equal(configSync.configSyncReport?.configSync?.inSync, true);

  const runtimeSync = await controlPlane.syncRuntimeConfigFromControlPlane();
  assert.equal(runtimeSync.controlPlane.configured, true);
  assert.equal(runtimeSync.runtimeConfig.saved, true);
  assert.equal(runtimeSync.runtimeConfig.updatedKeys.includes("POS_PUBLIC_ORIGIN"), true);
  assert.equal(runtimeSync.runtimeConfig.updatedKeys.includes("TELEGRAM_CHAT_IDS"), true);
  assert.equal(runtimeSync.runtimeConfig.keys.includes("CONTROL_API_URL"), false);
  assert.equal(runtimeSync.requiresRestart, true);
  assert.equal(runtimeSync.runtimeConfigSyncReport?.runtimeConfigSync?.status, "applied");
  assert.equal(runtimeSync.runtimeConfigSyncReport?.runtimeConfigSync?.inSync, true);
  const savedRuntime = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  assert.equal(savedRuntime.env.POS_PUBLIC_ORIGIN, "https://cremeria.example");
  assert.equal(savedRuntime.env.POS_SECURE_COOKIES, "true");
  assert.equal(savedRuntime.env.CONTROL_CONFIG_POLL_MS, "45000");
  assert.equal(savedRuntime.env.TELEGRAM_CHAT_IDS, "-100987654,12345");
  assert.equal(Object.prototype.hasOwnProperty.call(savedRuntime.env, "CONTROL_CLIENT_SECRET"), false);

  const runtimeSyncNoop = await controlPlane.syncRuntimeConfigFromControlPlane();
  assert.equal(runtimeSyncNoop.runtimeConfig.changed, false);
  assert.deepEqual(runtimeSyncNoop.runtimeConfig.updatedKeys, []);
  assert.deepEqual(runtimeSyncNoop.runtimeConfig.clearedKeys, []);
  assert.equal(runtimeSyncNoop.requiresRestart, false);

  const freshConfigSync = await controlPlane.refreshControlPlaneConfigIfStale({ maxAgeMs: 60_000 });
  assert.equal(freshConfigSync.skipped, true);
  assert.equal(freshConfigSync.reason, "fresh");

  const bundle = ownerConsoleService.getOwnerConsoleBundle();
  assert.deepEqual(bundle.enabledModules, ["weighted_audit"]);
  assert.deepEqual(bundle.adminCapabilities, ["daily_flow", "support_tools"]);

  const healthReport = await controlPlane.reportSupportHealthToControlPlane({ branch: "all" });
  assert.equal(healthReport.controlPlane.configured, true);
  assert.match(healthReport.remoteReport.status, /^(ok|risk|critical)$/);
  assert.equal(healthReport.remoteClient.healthStatus, healthReport.remoteReport.status);

  const centralDetail = await json(baseUrl, "/api/owner/clients/cremeria-rincon", {
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
  });
  assert.equal(centralDetail.status, 200);
  assert.equal(centralDetail.body.client.config.sync.status, "applied");
  assert.equal(centralDetail.body.client.config.sync.inSync, true);
  assert.equal(centralDetail.body.client.runtimeConfig.sync.status, "applied");
  assert.equal(centralDetail.body.client.runtimeConfig.sync.inSync, true);
  assert.equal(centralDetail.body.client.healthStatus, healthReport.remoteReport.status);
  assert.equal(centralDetail.body.healthReports.length, 1);
});

test("POS refuses insecure CONTROL_API_URL outside localhost even if env bypasses runtime validation", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "control-plane-https-"));
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_DB_PATH: process.env.POS_DB_PATH,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: process.env.CONTROL_CLIENT_SECRET,
    CONTROL_REQUIRE_HTTPS: process.env.CONTROL_REQUIRE_HTTPS,
  };

  t.after(() => {
    const dbModule = require("../src/db");
    dbModule.closeDatabaseConnection();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearPosRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_DB_PATH = path.join(tempDir, "pos.sqlite");
  process.env.POS_CONFIG_PATH = path.join(tempDir, "runtime.json");
  process.env.CONTROL_API_URL = "http://owner-control.example";
  process.env.CONTROL_CLIENT_SLUG = "cremeria-rincon";
  process.env.CONTROL_CLIENT_SECRET = "pos_test_secret";
  process.env.CONTROL_REQUIRE_HTTPS = "false";
  clearPosRequireCache();

  const controlPlane = require("../src/services/controlPlane");
  const status = controlPlane.getControlPlaneStatus();
  assert.equal(status.configured, true);
  assert.equal(status.usable, false);
  assert.match(status.error, /CONTROL_API_URL debe usar HTTPS fuera de localhost/i);
  await assert.rejects(
    () => controlPlane.syncServiceSubscriptionFromControlPlane(),
    /CONTROL_API_URL debe usar HTTPS fuera de localhost/,
  );
});

test("POS tracks recent control-plane auth failures after owner-control rotates the client key", async (t) => {
  const baseUrl = await startOwnerControlServer(t);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "control-plane-auth-"));
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_DB_PATH: process.env.POS_DB_PATH,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: process.env.CONTROL_CLIENT_SECRET,
  };

  t.after(() => {
    const dbModule = require("../src/db");
    dbModule.closeDatabaseConnection();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearPosRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createResponse = await json(baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "http://localhost:3100",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  process.env.POS_DB_PATH = path.join(tempDir, "pos.sqlite");
  process.env.POS_CONFIG_PATH = path.join(tempDir, "runtime.json");
  process.env.CONTROL_API_URL = baseUrl;
  process.env.CONTROL_CLIENT_SLUG = "cremeria-rincon";
  process.env.CONTROL_CLIENT_SECRET = createResponse.body.apiKey;
  clearPosRequireCache();

  let controlPlane = require("../src/services/controlPlane");
  await controlPlane.syncServiceSubscriptionFromControlPlane();
  let status = controlPlane.getControlPlaneStatus();
  assert.equal(status.runtimeStatus, "ok");
  assert.equal(status.degraded, false);
  assert.equal(status.authFailed, false);
  assert.ok(status.lastSuccessAt);

  const rotated = await json(baseUrl, "/api/owner/clients/cremeria-rincon/rotate-key", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": "owner-sync-token",
    },
  });
  assert.equal(rotated.status, 200);

  await assert.rejects(
    () => controlPlane.syncServiceSubscriptionFromControlPlane(),
    /Credenciales de cliente invalidas/i,
  );
  status = controlPlane.getControlPlaneStatus();
  assert.equal(status.usable, true);
  assert.equal(status.runtimeStatus, "failed");
  assert.equal(status.degraded, true);
  assert.equal(status.authFailed, true);
  assert.equal(status.lastErrorCode, 403);
  assert.ok(status.lastErrorAt);
  assert.match(status.lastError, /Credenciales de cliente invalidas/i);

  const dbModule = require("../src/db");
  dbModule.closeDatabaseConnection();
  process.env.CONTROL_CLIENT_SECRET = rotated.body.apiKey;
  clearPosRequireCache();

  controlPlane = require("../src/services/controlPlane");
  await controlPlane.syncServiceSubscriptionFromControlPlane();
  status = controlPlane.getControlPlaneStatus();
  assert.equal(status.runtimeStatus, "ok");
  assert.equal(status.degraded, false);
  assert.equal(status.authFailed, false);
  assert.ok(status.lastSuccessAt);
});
