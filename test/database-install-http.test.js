const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");

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
    // Nada extra que hacer si ya cerro.
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

  async function request(pathname, options = {}) {
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

    return response;
  }

  return {
    async json(pathname, options = {}) {
      const response = await request(pathname, options);
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
    request,
  };
}

async function startServer(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-db-install-"));
  const port = 35000 + Math.floor(Math.random() * 1000);
  const dbPath = path.join(tempDir, "test.sqlite");
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
    await stopServerProcess(child);
    removeDirWithRetry(tempDir);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return { baseUrl, dbPath, tempDir };
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

test("install-db accepts a compatible POS sqlite and rejects foreign sqlite files", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const ownerClient = createCookieClient(server.baseUrl);
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
  const csrfToken = adminLogin.body.csrfToken;

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);

  const ownerLogin = await ownerClient.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 200);

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const cashierLogin = await cashierClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Juan", branch: "carrizal", password: "1234" }),
  });
  assert.equal(cashierLogin.status, 200);
  const cashierToken = cashierLogin.body.token;

  const downloadResponse = await adminClient.request("/api/admin/download-db", {
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(downloadResponse.status, 200);
  const compatibleBuffer = Buffer.from(await downloadResponse.arrayBuffer());
  assert.ok(compatibleBuffer.length > 0);

  const validUpload = new FormData();
  validUpload.append(
    "database",
    new Blob([compatibleBuffer], { type: "application/x-sqlite3" }),
    "compatible.sqlite",
  );
  const validInstallResponse = await adminClient.request("/api/admin/install-db", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: validUpload,
  });
  const validInstallBody = await validInstallResponse.json();
  assert.equal(validInstallResponse.status, 200);
  assert.equal(validInstallBody.message, "Base de datos instalada correctamente.");
  assert.equal(validInstallBody.requiresReauth, true);
  assert.equal(validInstallBody.sessionsPurged, true);

  const dbAfterInstall = new Database(server.dbPath, { readonly: true });
  const adminSessionCount = Number(dbAfterInstall.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count || 0);
  const ownerSessionCount = Number(dbAfterInstall.prepare("SELECT COUNT(*) AS count FROM owner_sessions").get()?.count || 0);
  const cashierSessionCount = Number(dbAfterInstall.prepare("SELECT COUNT(*) AS count FROM cashier_sessions").get()?.count || 0);
  dbAfterInstall.close();
  assert.equal(adminSessionCount, 0);
  assert.equal(ownerSessionCount, 0);
  assert.equal(cashierSessionCount, 0);

  const adminStatusAfterInstall = await adminClient.json("/api/admin/auth/status");
  assert.equal(adminStatusAfterInstall.status, 200);
  assert.equal(adminStatusAfterInstall.body.configured, true);
  assert.equal(adminStatusAfterInstall.body.authenticated, false);

  const ownerStatusAfterInstall = await ownerClient.json("/api/owner/auth/status");
  assert.equal(ownerStatusAfterInstall.status, 200);
  assert.equal(ownerStatusAfterInstall.body.configured, true);
  assert.equal(ownerStatusAfterInstall.body.authenticated, false);

  const cashierStatusAfterInstall = await cashierClient.json("/api/cashier/auth/status", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierStatusAfterInstall.status, 200);
  assert.equal(cashierStatusAfterInstall.body.authenticated, false);

  const adminRelogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminRelogin.status, 200);
  const csrfTokenAfterInstall = adminRelogin.body.csrfToken;

  const foreignDbPath = path.join(server.tempDir, "foreign.sqlite");
  const foreignDb = new Database(foreignDbPath);
  foreignDb.exec(`
    CREATE TABLE business_profile (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE branches (
      code TEXT PRIMARY KEY
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY,
      created_at TEXT
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER
    );
  `);
  foreignDb.close();
  const foreignBuffer = fs.readFileSync(foreignDbPath);

  const invalidUpload = new FormData();
  invalidUpload.append(
    "database",
    new Blob([foreignBuffer], { type: "application/x-sqlite3" }),
    "foreign.sqlite",
  );
  const invalidInstallResponse = await adminClient.request("/api/admin/install-db", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfTokenAfterInstall },
    body: invalidUpload,
  });
  const invalidInstallBody = await invalidInstallResponse.json();
  assert.equal(invalidInstallResponse.status, 400);
  assert.equal(invalidInstallBody.message, "El archivo SQLite no es compatible con este POS.");

  const healthResponse = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
});

test("install-export-workbook rejects contradictory duplicate tickets and preserves current DB", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);

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
  const csrfToken = adminLogin.body.csrfToken;

  const dbBefore = new Database(server.dbPath, { readonly: true });
  const salesCountBefore = Number(dbBefore.prepare("SELECT COUNT(*) AS count FROM sales").get()?.count || 0);
  dbBefore.close();

  const workbook = new ExcelJS.Workbook();
  const inventorySheet = workbook.addWorksheet("Inventario");
  inventorySheet.addRow(["ID", "Producto", "Categoria", "Unidad", "Precio", "Existencia", "Minimo", "Importe", "Activo", "Stock bajo"]);
  inventorySheet.addRow([1, "Producto Conflicto", "general", "pza", 11.5, 20, 0, 230, "Si", ""]);

  const salesSheet = workbook.addWorksheet("Ventas Detalle");
  salesSheet.addRow([
    "Ticket",
    "Fecha",
    "Sucursal",
    "Turno",
    "Cajero",
    "Cliente",
    "Cliente Key",
    "Metodo",
    "Cobrado hoy",
    "Cobrado por",
    "Producto",
    "Cantidad",
    "Precio Unit",
    "Total Linea",
    "Stock Antes",
    "Stock Despues",
  ]);
  salesSheet.addRow(["RIN-100", "2026-06-01T10:00:00.000Z", "Carrizal", "Tarde", "Ana", "", "", "Efectivo", 11.5, "Efectivo", "Producto Conflicto", 1, 11.5, 11.5, 20, 19]);
  salesSheet.addRow(["RIN-100", "2026-06-01T10:00:00.000Z", "Carrizal", "Tarde", "Luis", "", "", "Efectivo", 11.5, "Efectivo", "Producto Conflicto", 1, 11.5, 11.5, 19, 18]);
  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const invalidUpload = new FormData();
  invalidUpload.append(
    "workbook",
    new Blob([workbookBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "conflict.xlsx",
  );
  const invalidInstallResponse = await adminClient.request("/api/admin/install-export-workbook", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: invalidUpload,
  });
  const invalidInstallBody = await invalidInstallResponse.json();
  assert.equal(invalidInstallResponse.status, 400);
  assert.match(String(invalidInstallBody.message || ""), /datos contradictorios/i);

  const dbAfter = new Database(server.dbPath, { readonly: true });
  const salesCountAfter = Number(dbAfter.prepare("SELECT COUNT(*) AS count FROM sales").get()?.count || 0);
  dbAfter.close();
  assert.equal(salesCountAfter, salesCountBefore);

  const healthResponse = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
});
