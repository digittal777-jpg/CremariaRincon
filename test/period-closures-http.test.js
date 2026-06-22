const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");

async function stopServerProcess(child) {
  if (child.exitCode != null) {
    return;
  }

  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Nada extra que hacer.
  }
}

function removeDirWithRetry(targetPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function createCookieClient(baseUrl) {
  const cookies = new Map();

  return {
    async json(pathname, options = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || "GET",
        headers: {
          ...(cookies.size > 0
            ? { Cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") }
            : {}),
          ...(options.headers || {}),
        },
        body: options.body,
      });

      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
      setCookies.forEach((entry) => {
        const firstSegment = String(entry || "").split(";")[0] || "";
        const separatorIndex = firstSegment.indexOf("=");
        if (separatorIndex <= 0) {
          return;
        }

        const key = firstSegment.slice(0, separatorIndex).trim();
        const value = firstSegment.slice(separatorIndex + 1).trim();
        if (!key) {
          return;
        }
        if (!value) {
          cookies.delete(key);
          return;
        }
        cookies.set(key, value);
      });

      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
  };
}

async function startServer(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-period-http-"));
  const port = 35000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POS_DB_PATH: path.join(tempDir, "test.sqlite"),
      POS_BOOTSTRAP_TOKEN: "bootstrap-secret-123",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  testContext.after(async () => {
    await stopServerProcess(child);
    removeDirWithRetry(tempDir);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return { baseUrl };
      }
    } catch (_error) {
      // seguir esperando
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor de prueba a tiempo:\n${logs}`);
}

async function setupAdminSession(baseUrl) {
  const guest = createCookieClient(baseUrl);
  const adminClient = createCookieClient(baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);

  return {
    adminClient,
    csrfToken: adminLogin.body.csrfToken,
  };
}

async function waitForSeededProduct(baseUrl, csrfToken, adminClient) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await adminClient.json("/api/bootstrap?branch=carrizal&includeInactiveInventory=1", {
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (snapshot.status === 200 && Array.isArray(snapshot.body.products) && snapshot.body.products.length > 0) {
      return snapshot.body.products[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("No encontre productos sembrados para probar ventas.");
}

test("weekly preview stays available but warns when activity has no final cut", async (t) => {
  const server = await startServer(t);
  const { adminClient, csrfToken } = await setupAdminSession(server.baseUrl);

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const product = await waitForSeededProduct(server.baseUrl, csrfToken, adminClient);

  const cashierLoginResponse = await fetch(`${server.baseUrl}/api/cashier/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Juan",
      branch: "carrizal",
      password: "1234",
    }),
  });
  assert.equal(cashierLoginResponse.status, 200);
  const cashierLogin = await cashierLoginResponse.json();

  const saleResponse = await fetch(`${server.baseUrl}/api/sales`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierLogin.token,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: Number(product.price || 25),
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: Number(product.price || 25),
        lineTotal: Number(product.price || 25),
      }],
    }),
  });
  assert.equal(saleResponse.status, 201);

  const preview = await adminClient.json("/api/admin/period-closures/preview?branch=carrizal&periodType=week", {
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.canSave, false);
  assert.ok(
    Array.isArray(preview.body.preview.warnings)
      && preview.body.preview.warnings.some((warning) => warning.code === "missing_final_cut"),
  );
});

test("weekly preview rejects impossible anchor dates with a 400", async (t) => {
  const server = await startServer(t);
  const { adminClient, csrfToken } = await setupAdminSession(server.baseUrl);

  const preview = await adminClient.json("/api/admin/period-closures/preview?branch=carrizal&periodType=week&anchorDateKey=2026-02-31", {
    headers: { "X-CSRF-Token": csrfToken },
  });

  assert.equal(preview.status, 400);
  assert.match(preview.body.message, /fecha ancla|YYYY-MM-DD/i);
});

test("saving a weekly closure fails explicitly while sync health is pending", async (t) => {
  const server = await startServer(t);
  const { adminClient, csrfToken } = await setupAdminSession(server.baseUrl);

  const reportResponse = await adminClient.json("/api/client-sync-health", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      deviceId: "tablet-carrizal",
      branch: "carrizal",
      pendingQueueCount: 2,
      blockedQueueCount: 1,
      registerEventsCount: 1,
      online: true,
    }),
  });
  assert.equal(reportResponse.status, 201);

  const saveResponse = await adminClient.json("/api/admin/period-closures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      branch: "carrizal",
      periodType: "week",
    }),
  });

  assert.equal(saveResponse.status, 409);
  assert.equal(saveResponse.body.code, "sync_pending");
  assert.ok(Array.isArray(saveResponse.body.warnings));
  assert.ok(saveResponse.body.warnings.some((warning) => warning.code === "sync_pending"));
  assert.match(saveResponse.body.message, /cola pendiente|sin sincronizar/i);
});

test("saving a branch weekly closure ignores other-branch sync pending and server-side createdBy wins", async (t) => {
  const server = await startServer(t);
  const { adminClient, csrfToken } = await setupAdminSession(server.baseUrl);

  const reportResponse = await adminClient.json("/api/client-sync-health", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      deviceId: "tablet-miradores",
      branch: "miradores",
      pendingQueueCount: 3,
      blockedQueueCount: 1,
      registerEventsCount: 1,
      online: true,
    }),
  });
  assert.equal(reportResponse.status, 201);

  const preview = await adminClient.json("/api/admin/period-closures/preview?branch=carrizal&periodType=week", {
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.canSave, true);
  assert.equal(
    preview.body.preview.warnings.some((warning) => warning.code === "sync_pending"),
    false,
  );

  const saveResponse = await adminClient.json("/api/admin/period-closures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      branch: "carrizal",
      periodType: "week",
      createdBy: "suplantado",
    }),
  });
  assert.equal(saveResponse.status, 200);
  assert.equal(saveResponse.body.closure.createdBy, "diana");
});
