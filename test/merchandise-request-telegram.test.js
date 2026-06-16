const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const Database = require("better-sqlite3");

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

async function startFakeTelegramServer(testContext, options = {}) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      let parsedBody = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch (_error) {
        parsedBody = rawBody;
      }

      requests.push({
        method: request.method,
        url: request.url,
        body: parsedBody,
      });

      const statusCode = Number(options.statusCode || 200);
      const payload = statusCode >= 400
        ? { ok: false, description: options.description || "telegram-error" }
        : { ok: true, result: { message_id: requests.length } };
      response.writeHead(statusCode, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(payload));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  testContext.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  return { baseUrl, requests };
}

async function startServer(testContext, envOverrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-telegram-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POS_DB_PATH: dbPath,
      POS_BOOTSTRAP_TOKEN: "bootstrap-secret-123",
      ...envOverrides,
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

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return { baseUrl, dbPath };
      }
    } catch (_error) {
      // Seguir esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor de prueba a tiempo:\n${logs}`);
}

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error("Tiempo agotado esperando la condicion de prueba.");
}

async function setupCashierFlow(server) {
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const cashierClient = createCookieClient(server.baseUrl);

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
  const adminCsrfToken = adminLogin.body.csrfToken;
  const db = new Database(server.dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO business_profile (
        id,
        business_name,
        slug,
        short_name,
        currency_code,
        locale,
        timezone,
        ticket_prefix,
        template_key,
        branding_json,
        visible_texts_json,
        modules_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        modules_json = excluded.modules_json,
        updated_at = excluded.updated_at
    `).run(
      1,
      "Retail Base POS",
      "retail-base-pos",
      "Retail POS",
      "MXN",
      "es-MX",
      "America/Mexico_City",
      "POS",
      "base",
      JSON.stringify({}),
      JSON.stringify({}),
      JSON.stringify(["weighted_audit", "merchandise_requests"]),
      now,
      now,
    );
  } finally {
    db.close();
  }

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

  return {
    adminClient,
    adminCsrfToken,
    cashierClient,
    cashierToken: cashierLogin.body.token,
  };
}

async function ensureTestProduct(server, adminClient, adminCsrfToken) {
  const db = new Database(server.dbPath, { readonly: true });
  try {
    const product = db.prepare(`
      SELECT id, price
      FROM products
      WHERE branch = 'carrizal' AND active = 1
      ORDER BY id ASC
      LIMIT 1
    `).get();
    if (product) {
      return product;
    }
  } finally {
    db.close();
  }

  const createProductResponse = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      branch: "carrizal",
      name: "Producto QA Telegram",
      price: 35,
      stock: 12,
      minStock: 0,
      category: "general",
      unit: "pza",
    }),
  });
  assert.equal(createProductResponse.status, 201);
  return {
    id: createProductResponse.body.product.id,
    price: createProductResponse.body.product.price,
  };
}

async function buildRequestPayload(server, adminClient, adminCsrfToken) {
  const product = await ensureTestProduct(server, adminClient, adminCsrfToken);
  return {
    supplierName: "Proveedor Norte",
    notes: "Pedido movil de prueba",
    items: [
      {
        productId: product.id,
        quantity: 1,
        totalValue: Number(product.price || 0) || 10,
        mode: "receive",
      },
    ],
  };
}

test("creating a merchandise request sends one Telegram alert per configured chat with the deep link", async (t) => {
  const telegramServer = await startFakeTelegramServer(t, { statusCode: 200 });
  const server = await startServer(t, {
    POS_PUBLIC_ORIGIN: "https://rincon.test",
    TELEGRAM_BOT_TOKEN: "telegram-bot-token",
    TELEGRAM_CHAT_IDS: "1001,1002",
    TELEGRAM_API_BASE_URL: telegramServer.baseUrl,
  });
  const { adminClient, adminCsrfToken, cashierClient, cashierToken } = await setupCashierFlow(server);

  const createResponse = await cashierClient.json("/api/merchandise-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify(await buildRequestPayload(server, adminClient, adminCsrfToken)),
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.request.status, "pending");

  await waitFor(() => telegramServer.requests.length === 2);

  const requestId = createResponse.body.request.id;
  const chatIds = telegramServer.requests.map((entry) => String(entry.body?.chat_id || "")).sort();
  assert.deepEqual(chatIds, ["1001", "1002"]);
  telegramServer.requests.forEach((entry) => {
    assert.equal(entry.method, "POST");
    assert.equal(entry.url, "/bottelegram-bot-token/sendMessage");
    assert.match(String(entry.body?.text || ""), new RegExp(`view=approvals&request=${requestId}`));
    assert.match(String(entry.body?.text || ""), /Proveedor Norte/);
  });
});

test("a Telegram failure does not block creation and leaves the request pending", async (t) => {
  const telegramServer = await startFakeTelegramServer(t, {
    statusCode: 500,
    description: "simulated-failure",
  });
  const server = await startServer(t, {
    POS_PUBLIC_ORIGIN: "https://rincon.test",
    TELEGRAM_BOT_TOKEN: "telegram-bot-token",
    TELEGRAM_CHAT_IDS: "5555",
    TELEGRAM_API_BASE_URL: telegramServer.baseUrl,
  });
  const { adminClient, adminCsrfToken, cashierClient, cashierToken } = await setupCashierFlow(server);

  const createResponse = await cashierClient.json("/api/merchandise-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify(await buildRequestPayload(server, adminClient, adminCsrfToken)),
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.request.status, "pending");

  await waitFor(() => telegramServer.requests.length === 1);

  const db = new Database(server.dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT status FROM merchandise_requests WHERE id = ?").get(createResponse.body.request.id);
    assert.equal(row.status, "pending");
  } finally {
    db.close();
  }
});

test("the same product can mix receive and return when the final balance stays non-negative", async (t) => {
  const server = await startServer(t);
  const { adminClient, adminCsrfToken, cashierClient, cashierToken } = await setupCashierFlow(server);
  const createProductResponse = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      branch: "carrizal",
      name: "Cecina Cambio",
      price: 40,
      stock: 0,
      minStock: 0,
      category: "general",
      unit: "pza",
    }),
  });
  assert.equal(createProductResponse.status, 201);
  const product = {
    id: createProductResponse.body.product.id,
    price: createProductResponse.body.product.price,
  };

  const createResponse = await cashierClient.json("/api/merchandise-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      supplierName: "Proveedor Norte",
      notes: "Solicitud contradictoria",
      items: [
        {
          productId: product.id,
          quantity: 2,
          totalValue: Number(product.price || 0) || 10,
          mode: "return",
        },
        {
          productId: product.id,
          quantity: 5,
          totalValue: Number(product.price || 0) || 10,
          mode: "receive",
        },
      ],
    }),
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.request.status, "pending");

  const approveResponse = await adminClient.json(
    `/api/merchandise-requests/${createResponse.body.request.id}/approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": adminCsrfToken,
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(approveResponse.status, 200);
  assert.equal(approveResponse.body.request.status, "approved");

  const db = new Database(server.dbPath, { readonly: true });
  try {
    const productRow = db.prepare("SELECT stock FROM products WHERE id = ? AND branch = 'carrizal'").get(product.id);
    assert.equal(Number(productRow.stock || 0), 3);

    const movementRows = db.prepare(`
      SELECT movement_type, stock_before, stock_after
      FROM inventory_movements
      WHERE reference_type = 'merchandise_request' AND reference_id = ?
      ORDER BY id ASC
    `).all(createResponse.body.request.id);
    assert.equal(movementRows.length, 2);
    assert.equal(movementRows[0].movement_type, "supplier");
    assert.equal(Number(movementRows[0].stock_before || 0), 0);
    assert.equal(Number(movementRows[0].stock_after || 0), 5);
    assert.equal(movementRows[1].movement_type, "supplier_out");
    assert.equal(Number(movementRows[1].stock_before || 0), 5);
    assert.equal(Number(movementRows[1].stock_after || 0), 3);
  } finally {
    db.close();
  }
});
