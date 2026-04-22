const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const express = require("express");
const { Server } = require("socket.io");

const { PORT, ROOT_DIR, STORE_NAME } = require("./config");
const { nowIso } = require("./db");

const services = require("./services");
const adminAuth = require("./admin/auth");
const { getSetting, setSetting } = require("./utils/settings");
const { getSystemMetrics } = require("./admin/metrics");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let lastCpuSnapshot = { usage: process.cpuUsage(), time: process.hrtime.bigint() };
const adminSessions = new Map();

function getProcessCpuPercent() {
  const nextUsage = process.cpuUsage();
  const nextTime = process.hrtime.bigint();
  const elapsedMicros = Number(nextTime - lastCpuSnapshot.time) / 1000;
  const cpuMicros = nextUsage.user - lastCpuSnapshot.usage.user + (nextUsage.system - lastCpuSnapshot.usage.system);
  lastCpuSnapshot = { usage: nextUsage, time: nextTime };
  if (elapsedMicros <= 0) return 0;
  return Math.round((cpuMicros / elapsedMicros) * 1000) / 10;
}

function broadcastSnapshot(snapshot = services.getDashboardSnapshot()) {
  io.emit("dashboard:snapshot", snapshot);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, generatedAt: new Date().toISOString() });
});

// ── DASHBOARD ────────────────────────────────────────────────────────────────
// FIX 1: bloque huérfano → GET /api/dashboard
app.get("/api/dashboard", (request, response) => {
  const branch = request.query.branch || "carrizal";
  response.json(services.getDashboardSnapshot(branch));
});

// ── BOOTSTRAP (SOLUCIÓN DEFINITIVA) ─────────────────────────────────────────
// Ruta que tu cliente (app.js + actions.js) está esperando
// Soporta tanto ?branch=carrizal (caja normal) como ?branch=all (modal admin)
app.get("/api/bootstrap", (request, response) => {
  const branch = request.query.branch || "carrizal";

  try {
    // Reutilizamos EXACTAMENTE la misma función que ya tienes funcionando
    // Esto garantiza que el snapshot sea idéntico al que ya usas en /api/dashboard
    const snapshot = services.getDashboardSnapshot(branch);

    // Opcional (pero recomendado): puedes enriquecerlo en el futuro aquí
    // snapshot.cashiers = services.listCashiers(branch === "all" ? null : branch);

    response.json(snapshot);
  } catch (err) {
    console.error("❌ Error en /api/bootstrap:", err);
    response.status(500).json({
      message: "Error interno al generar bootstrap",
      detail: err.message
    });
  }
});

// ── VENTAS ───────────────────────────────────────────────────────────────────
// FIX 2: bloque huérfano → POST /api/sales
app.post("/api/sales", (request, response) => {
  const sale = services.createSale(request.body || {});
  const snapshot = services.getDashboardSnapshot(sale.branch);
  broadcastSnapshot(snapshot);
  response.status(201).json({ sale, snapshot });
});

// ── PRODUCTOS (público) ───────────────────────────────────────────────────────
// FIX 3: bloque huérfano → GET /api/products/:id
app.get("/api/products/:id", (request, response) => {
  const branch = request.query.branch || "carrizal";
  const productId = Number(request.params.id);
  const product = services.getProductById(productId, branch);
  if (!product) {
    response.status(404).json({ message: "Producto no encontrado" });
    return;
  }
  response.json({ product });
});

// ── ADMIN SETTINGS ────────────────────────────────────────────────────────────
app.get("/api/admin/settings", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (_request, response) => {
  response.json({ settings: services.listSettings() });
});

app.patch("/api/admin/settings", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const updates = request.body || {};
  const settings = services.updateSettings(updates);
  response.json({ settings });
});

// ── ADMIN AUTH ────────────────────────────────────────────────────────────────
app.get("/api/admin/auth/status", (request, response) => {
  response.json({
    configured: Boolean(adminAuth.getStoredAdminPassword()),
    authenticated: adminAuth.isAdminAuthenticated(request, adminSessions)
  });
});

app.post("/api/admin/auth/setup", (request, response) => {
  if (adminAuth.getStoredAdminPassword()) {
    response.status(409).json({ message: "La contrasena de admin ya fue configurada." });
    return;
  }
  const password = String(request.body?.password || "").trim();
  if (password.length < 4) {
    response.status(400).json({ message: "La contrasena admin debe tener al menos 4 caracteres." });
    return;
  }
  adminAuth.setSetting("admin.password", JSON.stringify(adminAuth.hashAdminPassword(password)));
  response.status(201).json({ configured: true });
});

app.post("/api/admin/auth/login", (request, response) => {
  const password = String(request.body?.password || "").trim();
  if (!adminAuth.verifyAdminPassword(password)) {
    response.status(401).json({ message: "La contrasena de admin no es correcta." });
    return;
  }
  const token = adminAuth.createAdminSession(adminSessions);
  response.json({ token });
});

app.post("/api/admin/auth/logout", (request, response) => {
  adminAuth.destroyAdminSession(request, adminSessions);
  response.json({ ok: true });
});

// ── ADMIN PRODUCTS ────────────────────────────────────────────────────────────
app.patch("/api/products/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const productId = Number(request.params.id);
  const product = services.updateProduct(productId, request.body || {});
  const snapshot = services.getDashboardSnapshot(request.body?.branch || "carrizal");
  broadcastSnapshot(snapshot);
  response.json({ product, snapshot });
});

app.get("/api/admin/metrics", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (_request, response) => {
  const metrics = getSystemMetrics();
  metrics.process.cpuPercent = getProcessCpuPercent();
  response.json(metrics);
});

app.get("/api/admin/editor-data", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const branch = request.query.branch || "all";
  response.json({
    sales: services.getRecentSales(16, branch),
    registerEvents: services.getRecentRegisterEvents(16, branch),
    inventoryMovements: services.getRecentInventoryMovements(16, branch),
    generatedAt: nowIso()
  });
});

app.get("/api/inventory/quick-import", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  response.json({ items: services.getQuickImportRows(request.query.branch || "carrizal"), generatedAt: nowIso() });
});

app.post("/api/inventory/quick-import", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const product = services.applyQuickInventoryEntry(request.body || {});
  const snapshot = services.getDashboardSnapshot(request.body?.branch || "carrizal");
  broadcastSnapshot(snapshot);
  response.json({ product, snapshot });
});

app.get("/api/admin/products", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (_request, response) => {
  const branch = request.query.branch || "carrizal";
  response.json({ products: services.listProducts(branch), generatedAt: nowIso() });
});

app.post("/api/admin/products", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, async (request, response) => {
  const branch = request.body?.branch || "carrizal";
  const result = await services.ensureCatalogSeeded(request.body?.workbookPath);
  const snapshot = services.getDashboardSnapshot(branch);
  response.status(201).json({ ...result, snapshot });
});

// ── ADMIN CAJEROS ─────────────────────────────────────────────────────────────
app.get("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const branchParam = request.query.branch;
  const branch = branchParam === "all" ? null : branchParam;
  console.log("GET /api/admin/cashiers - branch:", branch);
  const cashiers = services.listCashiers(branch);
  console.log("Cashiers found:", cashiers.length);
  response.json({ cashiers, generatedAt: nowIso() });
});

app.post("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  try {
    const cashier = services.createCashier(request.body || {});
    response.status(201).json({ cashier });
  } catch (error) {
    console.error("Error creating cashier:", error.message);
    response.status(400).json({ message: error.message });
  }
});

app.patch("/api/admin/cashiers/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const cashierId = Number(request.params.id);
  const cashier = services.updateCashier(cashierId, request.body || {});
  response.json({ cashier });
});

app.delete("/api/admin/cashiers/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const cashierId = Number(request.params.id);
  const result = services.deleteCashier(cashierId);
  response.json({ result });
});

app.post("/api/admin/cashiers/init-test", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (_request, response) => {
  services.initializeTestCashiers();
  response.json({ ok: true });
});

app.post("/api/cashier/auth", (request, response) => {
  const { name, branch, password } = request.body || {};
  console.log("POST /api/cashier/auth - name:", name, "branch:", branch);
  const cashier = services.authenticateCashier(name, branch, password);
  console.log("Auth result:", cashier);
  if (cashier) {
    response.json({ authenticated: true, cashier });
  } else {
    response.status(401).json({ authenticated: false });
  }
});

// ── CAJA ──────────────────────────────────────────────────────────────────────
app.get("/api/admin/register/start", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const result = services.startRegister(request.query || {});
  response.json(result);
});

app.post("/api/admin/register/cut", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const result = services.createRegisterCut(request.body || {});
  response.json(result);
});

app.get("/api/admin/register/summary", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const summary = services.getRegisterSummary(request.query.shift || "Tarde", request.query.branch || "carrizal");
  response.json(summary);
});

// ── ADMIN VENTAS / EVENTOS / MOVIMIENTOS ──────────────────────────────────────
app.get("/api/admin/sales/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const saleId = Number(request.params.id);
  const sale = services.getSaleById(saleId);
  if (!sale) { response.status(404).json({ message: "Venta no encontrada" }); return; }
  response.json({ sale });
});

app.patch("/api/admin/sales/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const saleId = Number(request.params.id);
  const sale = services.updateSaleAdmin(saleId, request.body || {});
  response.json({ sale });
});

app.get("/api/admin/register-events/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const eventId = Number(request.params.id);
  const event = services.getRegisterEventById(eventId);
  if (!event) { response.status(404).json({ message: "Evento de caja no encontrado" }); return; }
  response.json({ event });
});

app.patch("/api/admin/register-events/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const eventId = Number(request.params.id);
  const event = services.updateRegisterEventAdmin(eventId, request.body || {});
  response.json({ event });
});

app.get("/api/admin/inventory-movements/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const movementId = Number(request.params.id);
  const movement = services.getInventoryMovementById(movementId);
  if (!movement) { response.status(404).json({ message: "Movimiento de inventario no encontrado" }); return; }
  response.json({ movement });
});

app.patch("/api/admin/inventory-movements/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const movementId = Number(request.params.id);
  const movement = services.updateInventoryMovementAdmin(movementId, request.body || {});
  response.json({ movement });
});

// ── REGISTRO PÚBLICO ──────────────────────────────────────────────────────────
app.get("/api/register/summary", (request, response) => {
  const shift = request.query.shift || "Tarde";
  const branch = request.query.branch || "carrizal";
  response.json(services.getRegisterSummary(shift, branch));
});

app.post("/api/register/start", (request, response) => {
  const result = services.startRegister(request.body || {});
  response.json(result);
});

app.post("/api/register/cut", (request, response) => {
  const result = services.createRegisterCut(request.body || {});
  response.json(result);
});

app.get("/api/activity/:kind/:id", (request, response) => {
  const kind = request.params.kind;
  const id = Number(request.params.id);
  let detail = null;
  let foundKind = kind;

  if (kind === "sale") {
    detail = services.getSaleById(id);
    foundKind = "sale";
  } else if (kind === "register-event" || kind === "register") {
    detail = services.getRegisterEventById(id);
    foundKind = "register";
  } else if (kind === "inventory-movement" || kind === "inventory") {
    detail = services.getInventoryMovementById(id);
    foundKind = "inventory";
  }

  if (!detail) {
    response.status(404).json({ message: "Actividad no encontrada" });
    return;
  }

  response.json({ kind: foundKind, detail });
});

app.get("/api/export-workbook", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, async (_request, response) => {
  const workbook = await services.exportWorkbookReport();
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", "attachment; filename=" + STORE_NAME + " - Exportacion.xlsx");
  await workbook.xlsx.write(response);
  response.end();
});

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Cliente conectado: " + socket.id);
  socket.on("disconnect", () => { console.log("Cliente desconectado: " + socket.id); });
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((error, _request, response, _next) => {
  console.error("Error:", error.message);
  response.status(500).json({ message: error.message || "Error interno del servidor" });
});

// ── INICIO ────────────────────────────────────────────────────────────────────
services.ensureCatalogSeeded().then(() => { services.initializeTestCashiers(); });

server.listen(PORT, () => { console.log("Servidor corriendo en http://localhost:" + PORT); });

module.exports = { app, server, io };