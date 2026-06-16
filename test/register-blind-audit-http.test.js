const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");

async function stopProcess(child) {
  if (child.exitCode != null) {
    return;
  }

  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Si ya termino, no pasa nada.
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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
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
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (_error) {
        body = text;
      }

      return {
        status: response.status,
        body,
        headers: response.headers,
      };
    },
  };
}

async function startServer(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-blind-audit-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const port = 35000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POS_DB_PATH: dbPath,
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
    await stopProcess(child);
    removeDirWithRetry(tempDir);
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          logs,
          guest: createCookieClient(baseUrl),
          adminClient: createCookieClient(baseUrl),
          cashierClient: createCookieClient(baseUrl),
        };
      }
    } catch (_error) {
      // Seguimos intentando hasta que el servidor levante.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`El servidor no inicio a tiempo.\n${logs}`);
}

test("final cut requires blind kg capture for cashier-sold weighted products", async (t) => {
  const server = await startServer(t);
  const { guest, adminClient, cashierClient } = server;

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({
      username: "diana",
      password: "admin1234",
    }),
  });
  assert.equal(adminSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCsrfToken = adminLogin.body.csrfToken;

  const enableModulesResponse = await adminClient.json("/api/admin/modules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      enabledModules: ["weighted_audit"],
    }),
  });
  assert.equal(enableModulesResponse.status, 200);

  const productResponse = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      name: "Queso Ciego",
      branch: "carrizal",
      price: 80,
      stock: 6.5,
      minStock: 1,
      category: "quesos",
      unit: "kg",
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = productResponse.body.product;

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const cashierLogin = await cashierClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Juan", branch: "carrizal", password: "1234" }),
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = cashierLogin.body.token;

  const saleResponse = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 100,
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: 1.25,
          unitPrice: product.price,
          lineTotal: 100,
        },
      ],
    }),
  });
  assert.equal(saleResponse.status, 201);

  const finalCutResponse = await cashierClient.json("/api/register/cut", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      eventType: "final_cut",
      countedAmount: 100,
      withdrawalsAmount: 0,
      notes: "",
    }),
  });
  assert.equal(finalCutResponse.status, 200);
  assert.ok(finalCutResponse.body.auditSession);
  assert.ok(finalCutResponse.body.blindAuditPrompt);
  assert.equal(finalCutResponse.body.blindAuditPrompt.items.length, 1);
  assert.equal(finalCutResponse.body.blindAuditPrompt.items[0].productName, "Queso Ciego");
  assert.equal("posStock" in finalCutResponse.body.blindAuditPrompt.items[0], false);
  assert.equal("difference" in finalCutResponse.body.blindAuditPrompt.items[0], false);

  const summaryResponse = await cashierClient.json("/api/register/summary?shift=Tarde", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(summaryResponse.status, 200);
  assert.ok(summaryResponse.body.blindAuditPrompt);
  assert.equal(summaryResponse.body.blindAuditPrompt.items.length, 1);

  const previewResponse = await cashierClient.json(
    `/api/register/weighted-audit/${finalCutResponse.body.auditSession.id}/blind/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cashier-Token": cashierToken,
      },
      body: JSON.stringify({
        items: [
          {
            itemId: finalCutResponse.body.blindAuditPrompt.items[0].itemId,
            countedStock: 4.2,
          },
        ],
      }),
    },
  );
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.body.previews.length, 1);
  assert.equal(previewResponse.body.previews[0].difference, -1.05);
  assert.equal("posStock" in previewResponse.body.previews[0], false);

  const blindCaptureResponse = await cashierClient.json(
    `/api/register/weighted-audit/${finalCutResponse.body.auditSession.id}/blind`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Cashier-Token": cashierToken,
      },
      body: JSON.stringify({
        items: [
          {
            itemId: finalCutResponse.body.blindAuditPrompt.items[0].itemId,
            countedStock: 4.2,
          },
        ],
      }),
    },
  );
  assert.equal(blindCaptureResponse.status, 200);
  assert.equal(blindCaptureResponse.body.prompt.completed, true);
  assert.equal(blindCaptureResponse.body.prompt.items[0].countedStock, 4.2);

  const summaryAfterBlindCapture = await cashierClient.json("/api/register/summary?shift=Tarde", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(summaryAfterBlindCapture.status, 200);
  assert.equal(summaryAfterBlindCapture.body.blindAuditPrompt, null);

  const weightedItem = blindCaptureResponse.body.session.items.find((item) => item.productName === "Queso Ciego");
  assert.ok(weightedItem);
  assert.equal(weightedItem.countedStock, 4.2);
  assert.equal(weightedItem.posStock, 5.25);
});

test("blind final cuts stay isolated when two cashiers sell the same kg product", async (t) => {
  const server = await startServer(t);
  const { baseUrl, guest, adminClient, cashierClient } = server;
  const pedroClient = createCookieClient(baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({
      username: "diana",
      password: "admin1234",
    }),
  });
  assert.equal(adminSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCsrfToken = adminLogin.body.csrfToken;

  const enableModulesResponse = await adminClient.json("/api/admin/modules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      enabledModules: ["weighted_audit"],
    }),
  });
  assert.equal(enableModulesResponse.status, 200);

  const productResponse = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      name: "Queso Compartido",
      branch: "carrizal",
      price: 95,
      stock: 12,
      minStock: 1,
      category: "quesos",
      unit: "kg",
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = productResponse.body.product;

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const juanLogin = await cashierClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Juan", branch: "carrizal", password: "1234" }),
  });
  assert.equal(juanLogin.status, 200);
  const juanToken = juanLogin.body.token;

  const pedroLogin = await pedroClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pedro", branch: "carrizal", password: "1234" }),
  });
  assert.equal(pedroLogin.status, 200);
  const pedroToken = pedroLogin.body.token;

  const juanSale = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": juanToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 100,
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          lineTotal: 95,
        },
      ],
    }),
  });
  assert.equal(juanSale.status, 201);

  const pedroSale = await pedroClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": pedroToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 100,
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: 0.5,
          unitPrice: product.price,
          lineTotal: 47.5,
        },
      ],
    }),
  });
  assert.equal(pedroSale.status, 201);

  const juanFinalCut = await cashierClient.json("/api/register/cut", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": juanToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      eventType: "final_cut",
      countedAmount: 95,
      withdrawalsAmount: 0,
      notes: "",
    }),
  });
  assert.equal(juanFinalCut.status, 200);
  assert.ok(juanFinalCut.body.auditSession);
  assert.ok(juanFinalCut.body.blindAuditPrompt);

  const pedroFinalCut = await pedroClient.json("/api/register/cut", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": pedroToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      eventType: "final_cut",
      countedAmount: 47.5,
      withdrawalsAmount: 0,
      notes: "",
    }),
  });
  assert.equal(pedroFinalCut.status, 200);
  assert.ok(pedroFinalCut.body.auditSession);
  assert.ok(pedroFinalCut.body.blindAuditPrompt);

  assert.notEqual(juanFinalCut.body.auditSession.id, pedroFinalCut.body.auditSession.id);
  assert.notEqual(
    juanFinalCut.body.blindAuditPrompt.items[0].itemId,
    pedroFinalCut.body.blindAuditPrompt.items[0].itemId,
  );

  const juanSummary = await cashierClient.json("/api/register/summary?shift=Tarde", {
    headers: { "X-Cashier-Token": juanToken },
  });
  assert.equal(juanSummary.status, 200);
  assert.equal(juanSummary.body.blindAuditPrompt.sessionId, juanFinalCut.body.auditSession.id);

  const pedroSummary = await pedroClient.json("/api/register/summary?shift=Tarde", {
    headers: { "X-Cashier-Token": pedroToken },
  });
  assert.equal(pedroSummary.status, 200);
  assert.equal(pedroSummary.body.blindAuditPrompt.sessionId, pedroFinalCut.body.auditSession.id);

  const juanBlindCapture = await cashierClient.json(
    `/api/register/weighted-audit/${juanFinalCut.body.auditSession.id}/blind`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Cashier-Token": juanToken,
      },
      body: JSON.stringify({
        items: [
          {
            itemId: juanFinalCut.body.blindAuditPrompt.items[0].itemId,
            countedStock: 10.2,
          },
        ],
      }),
    },
  );
  assert.equal(juanBlindCapture.status, 200);
  assert.equal(juanBlindCapture.body.prompt.completed, true);

  const pedroSummaryAfterJuanCapture = await pedroClient.json("/api/register/summary?shift=Tarde", {
    headers: { "X-Cashier-Token": pedroToken },
  });
  assert.equal(pedroSummaryAfterJuanCapture.status, 200);
  assert.ok(pedroSummaryAfterJuanCapture.body.blindAuditPrompt);
  assert.equal(
    pedroSummaryAfterJuanCapture.body.blindAuditPrompt.sessionId,
    pedroFinalCut.body.auditSession.id,
  );
  assert.equal(
    pedroSummaryAfterJuanCapture.body.blindAuditPrompt.items[0].countedStock,
    null,
  );
});

test("admin can close a weighted audit with reasons from the final close request", async (t) => {
  const server = await startServer(t);
  const { guest, adminClient, cashierClient } = server;

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({
      username: "diana",
      password: "admin1234",
    }),
  });
  assert.equal(adminSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCsrfToken = adminLogin.body.csrfToken;

  const enableModulesResponse = await adminClient.json("/api/admin/modules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      enabledModules: ["weighted_audit"],
    }),
  });
  assert.equal(enableModulesResponse.status, 200);

  const productResponse = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      name: "Queso Cierre",
      branch: "carrizal",
      price: 80,
      stock: 6.5,
      minStock: 1,
      category: "quesos",
      unit: "kg",
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = productResponse.body.product;

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const cashierLogin = await cashierClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Juan", branch: "carrizal", password: "1234" }),
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = cashierLogin.body.token;

  const saleResponse = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 100,
      items: [
        {
          productId: product.id,
          productName: product.name,
          quantity: 1.25,
          unitPrice: product.price,
          lineTotal: 100,
        },
      ],
    }),
  });
  assert.equal(saleResponse.status, 201);

  const finalCutResponse = await cashierClient.json("/api/register/cut", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      eventType: "final_cut",
      countedAmount: 100,
      withdrawalsAmount: 0,
      notes: "",
    }),
  });
  assert.equal(finalCutResponse.status, 200);

  const blindCaptureResponse = await cashierClient.json(
    `/api/register/weighted-audit/${finalCutResponse.body.auditSession.id}/blind`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Cashier-Token": cashierToken,
      },
      body: JSON.stringify({
        items: [
          {
            itemId: finalCutResponse.body.blindAuditPrompt.items[0].itemId,
            countedStock: 4.2,
          },
        ],
      }),
    },
  );
  assert.equal(blindCaptureResponse.status, 200);

  const completeResponse = await adminClient.json(
    `/api/admin/weighted-audit/sessions/${finalCutResponse.body.auditSession.id}/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminCsrfToken,
      },
      body: JSON.stringify({
        notes: "Merma validada en cierre admin.",
        items: [
          {
            itemId: blindCaptureResponse.body.session.items[0].id,
            countedStock: 4.2,
            reason: "Pieza cortada para degustacion",
          },
        ],
      }),
    },
  );
  assert.equal(completeResponse.status, 200);
  assert.equal(completeResponse.body.session.status, "completed");
  assert.equal(completeResponse.body.session.notes, "Merma validada en cierre admin.");
  assert.equal(completeResponse.body.session.items[0].reason, "Pieza cortada para degustacion");
});
