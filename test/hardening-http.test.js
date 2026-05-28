const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");
const WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");

async function stopServerProcess(child) {
  if (child.exitCode != null) {
    return;
  }

  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Si el proceso ya cerro, seguimos con la limpieza.
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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
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
          ...(cookies.size > 0 ? { Cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
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

async function startServer(testContext, { bootstrapToken = "" } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-hardening-"));
  const port = 33000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POS_DB_PATH: path.join(tempDir, "test.sqlite"),
      POS_BOOTSTRAP_TOKEN: bootstrapToken,
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
      // Seguir esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor de prueba a tiempo:\n${logs}`);
}

test("setup admin/owner stays blocked when bootstrap token is absent", async (t) => {
  const server = await startServer(t, { bootstrapToken: "" });
  const guest = createCookieClient(server.baseUrl);

  const adminStatus = await guest.json("/api/admin/auth/status");
  assert.equal(adminStatus.status, 200);
  assert.equal(adminStatus.body.configured, false);
  assert.equal(adminStatus.body.setupAllowed, false);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "adminroot", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 403);

  const ownerStatus = await guest.json("/api/owner/auth/status");
  assert.equal(ownerStatus.status, 200);
  assert.equal(ownerStatus.body.configured, false);
  assert.equal(ownerStatus.body.setupAllowed, false);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 403);
});

test("bootstrap token gates setup and owner-only template reset rebuilds the business", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const ownerClient = createCookieClient(server.baseUrl);

  const adminSetupNoToken = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetupNoToken.status, 403);

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

  const adminTemplateApply = await adminClient.json("/api/admin/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({ businessName: "Debe fallar" }),
  });
  assert.equal(adminTemplateApply.status, 403);

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
  const ownerCsrfToken = ownerLogin.body.csrfToken;

  const ownerConfig = await ownerClient.json("/api/owner/config", {
    headers: { "X-CSRF-Token": ownerCsrfToken },
  });
  assert.equal(ownerConfig.status, 200);
  const currentSlug = ownerConfig.body.businessProfile.slug;

  const ownerTemplates = await ownerClient.json("/api/owner/templates", {
    headers: { "X-CSRF-Token": ownerCsrfToken },
  });
  assert.equal(ownerTemplates.status, 200);
  assert.ok(Array.isArray(ownerTemplates.body.templates));
  assert.ok(ownerTemplates.body.templates.some((template) => template.key === "cremeria"));

  const failedConfirm = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: WORKBOOK_PATH,
      confirmReset: false,
      confirmText: currentSlug,
    }),
  });
  assert.equal(failedConfirm.status, 409);

  const failedWorkbook = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: ".\\no-existe.xlsx",
      confirmReset: true,
      confirmText: currentSlug,
    }),
  });
  assert.equal(failedWorkbook.status, 400);

  const appliedTemplate = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: WORKBOOK_PATH,
      confirmReset: true,
      confirmText: currentSlug,
    }),
  });
  assert.equal(appliedTemplate.status, 200);
  assert.equal(appliedTemplate.body.requiresReauth, true);
  assert.ok(appliedTemplate.body.importedCount > 0);
  assert.equal(appliedTemplate.body.businessProfile.businessName, "Negocio Duro");
  assert.equal(appliedTemplate.body.snapshot.profile.businessName, "Negocio Duro");
  assert.ok(Array.isArray(appliedTemplate.body.snapshot.products));
  assert.ok(appliedTemplate.body.snapshot.products.length > 0);

  const adminStatusAfter = await guest.json("/api/admin/auth/status");
  assert.equal(adminStatusAfter.status, 200);
  assert.equal(adminStatusAfter.body.configured, false);
  assert.equal(adminStatusAfter.body.authenticated, false);
  assert.equal(adminStatusAfter.body.setupAllowed, true);

  const ownerStatusAfter = await guest.json("/api/owner/auth/status");
  assert.equal(ownerStatusAfter.status, 200);
  assert.equal(ownerStatusAfter.body.configured, true);
  assert.equal(ownerStatusAfter.body.authenticated, false);
  assert.equal(ownerStatusAfter.body.setupAllowed, false);

  const manifestResponse = await fetch(`${server.baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "Negocio Duro");
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.length > 0);

  const homeResponse = await fetch(`${server.baseUrl}/`);
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(homeHtml, /<title>Punto de Venta \| POS<\/title>/);
  assert.doesNotMatch(homeHtml, /Cremeria El Rincon/);
});

test("guest bootstrap hides operational data while authenticated flows keep working", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const cashierClient = createCookieClient(server.baseUrl);

  const guestBootstrap = await guest.json("/api/bootstrap?branch=carrizal");
  assert.equal(guestBootstrap.status, 200);
  assert.equal(guestBootstrap.body.auth.role, "guest");
  assert.deepEqual(guestBootstrap.body.recentSales, []);
  assert.deepEqual(guestBootstrap.body.recentActivity, []);
  assert.deepEqual(guestBootstrap.body.lowStock, []);
  assert.ok(Array.isArray(guestBootstrap.body.products));
  assert.ok(
    guestBootstrap.body.products.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );

  const guestDashboard = await guest.json("/api/dashboard?branch=carrizal");
  assert.equal(guestDashboard.status, 401);

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

  const manualProduct = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      name: "Producto Smoke",
      branch: "carrizal",
      price: 18.5,
      stock: 5,
      minStock: 1,
      category: "general",
      unit: "pza",
    }),
  });
  assert.equal(manualProduct.status, 201);
  assert.equal(manualProduct.body.product.name, "Producto Smoke");

  const adminProducts = await adminClient.json("/api/admin/products?branch=carrizal", {
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(adminProducts.status, 200);
  assert.ok(Array.isArray(adminProducts.body.products));
  assert.ok(adminProducts.body.products.some((product) => product.name === "Producto Smoke"));

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
  assert.equal(cashierLogin.body.authenticated, true);
  const cashierToken = cashierLogin.body.token;

  const cashierBootstrap = await cashierClient.json("/api/bootstrap?branch=miradores", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierBootstrap.status, 200);
  assert.equal(cashierBootstrap.body.auth.role, "cashier");
  assert.equal(cashierBootstrap.body.store.currentBranch, "carrizal");
  const smokeProduct = cashierBootstrap.body.products.find((product) => product.name === "Producto Smoke");
  assert.ok(smokeProduct);
  assert.ok(smokeProduct.stock >= 5);

  const saleResponse = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 18.5,
      items: [
        {
          productId: smokeProduct.id,
          productName: smokeProduct.name,
          quantity: 1,
          unitPrice: smokeProduct.price,
          lineTotal: smokeProduct.price,
        },
      ],
    }),
  });
  assert.equal(saleResponse.status, 201);
  assert.equal(saleResponse.body.sale.branch, "carrizal");
  const saleId = saleResponse.body.sale.id;

  const guestActivity = await guest.json(`/api/activity/sale/${saleId}`);
  assert.equal(guestActivity.status, 401);

  const cashierActivity = await cashierClient.json(`/api/activity/sale/${saleId}`, {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierActivity.status, 200);
  assert.equal(cashierActivity.body.kind, "sale");
  assert.equal(cashierActivity.body.detail.branch, "carrizal");

  const quickImport = await adminClient.json("/api/inventory/quick-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      productId: smokeProduct.id,
      branch: "carrizal",
      mode: "receive",
      quantity: 2,
      supplierName: "Proveedor Smoke",
    }),
  });
  assert.equal(quickImport.status, 200);

  const editorData = await adminClient.json("/api/admin/editor-data?branch=carrizal", {
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(editorData.status, 200);
  const movement = editorData.body.inventoryMovements.find((item) =>
    item.productId === smokeProduct.id && item.movementType !== "sale");
  assert.ok(movement);

  const patchedMovement = await adminClient.json(`/api/admin/inventory-movements/${movement.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      quantityDelta: 3,
      note: "Ajuste smoke",
    }),
  });
  assert.equal(patchedMovement.status, 200);
  assert.equal(patchedMovement.body.movement.quantityDelta, 3);
});
