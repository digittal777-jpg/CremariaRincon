const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const express = require("express");
const { Server } = require("socket.io");

const { PORT, ROOT_DIR } = require("./config");
const {
  applyQuickInventoryEntry,
  createRegisterCut,
  createSale,
  ensureCatalogSeeded,
  exportWorkbookReport,
  getDashboardSnapshot,
  getInventoryMovementById,
  getQuickImportRows,
  getRecentInventoryMovements,
  getRecentRegisterEvents,
  getRecentSales,
  getRegisterEventById,
  getRegisterSummary,
  importCatalogFromWorkbook,
  startRegister,
  getSaleById,
  updateInventoryMovementAdmin,
  updateProduct,
  updateRegisterEventAdmin,
  updateSaleAdmin,
} = require("./store");
const { getDb, nowIso } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
const db = getDb();
let lastCpuSnapshot = {
  usage: process.cpuUsage(),
  time: process.hrtime.bigint(),
};
const adminSessions = new Map();

function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

function getStoredAdminPassword() {
  const raw = getSetting("admin.password");
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyAdminPassword(password) {
  const stored = getStoredAdminPassword();
  if (!stored) {
    return false;
  }

  const candidate = hashAdminPassword(password, stored.salt);
  return crypto.timingSafeEqual(
    Buffer.from(candidate.hash, "hex"),
    Buffer.from(stored.hash, "hex"),
  );
}

function getAdminTokenFromRequest(request) {
  const headerValue = request.headers.authorization || "";
  const tokenMatch = headerValue.match(/^Bearer\s+(.+)$/i);
  return tokenMatch ? tokenMatch[1] : "";
}

function isAdminAuthenticated(request) {
  const token = getAdminTokenFromRequest(request);
  if (!token || !adminSessions.has(token)) {
    return false;
  }

  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }

  session.expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  adminSessions.set(token, session);
  return true;
}

function requireAdminAuth(request, response, next) {
  if (!isAdminAuthenticated(request)) {
    response.status(401).json({
      message: "Necesitas la contrasena de admin para entrar aqui.",
    });
    return;
  }

  next();
}

function broadcastSnapshot(snapshot = getDashboardSnapshot()) {
  io.emit("dashboard:snapshot", snapshot);
}

function getProcessCpuPercent() {
  const nextUsage = process.cpuUsage();
  const nextTime = process.hrtime.bigint();
  const elapsedMicros = Number(nextTime - lastCpuSnapshot.time) / 1000;
  const cpuMicros =
    nextUsage.user -
    lastCpuSnapshot.usage.user +
    (nextUsage.system - lastCpuSnapshot.usage.system);

  lastCpuSnapshot = {
    usage: nextUsage,
    time: nextTime,
  };

  if (elapsedMicros <= 0) {
    return 0;
  }

  return Math.round((cpuMicros / elapsedMicros) * 1000) / 10;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/api/admin/auth/status", (request, response) => {
  response.json({
    configured: Boolean(getStoredAdminPassword()),
    authenticated: isAdminAuthenticated(request),
  });
});

app.post("/api/admin/auth/setup", (request, response) => {
  if (getStoredAdminPassword()) {
    response.status(409).json({
      message: "La contrasena de admin ya fue configurada.",
    });
    return;
  }

  const password = String(request.body?.password || "").trim();
  if (password.length < 4) {
    response.status(400).json({
      message: "La contrasena admin debe tener al menos 4 caracteres.",
    });
    return;
  }

  setSetting("admin.password", JSON.stringify(hashAdminPassword(password)));
  response.status(201).json({ configured: true });
});

app.post("/api/admin/auth/login", (request, response) => {
  const password = String(request.body?.password || "").trim();
  if (!verifyAdminPassword(password)) {
    response.status(401).json({
      message: "La contrasena de admin no es correcta.",
    });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8,
  });

  response.json({ token });
});

app.post("/api/admin/auth/logout", (request, response) => {
  const token = getAdminTokenFromRequest(request);
  if (token) {
    adminSessions.delete(token);
  }

  response.json({ ok: true });
});

app.get("/api/bootstrap", (_request, response) => {
  response.json(getDashboardSnapshot());
});

app.post("/api/sales", (request, response) => {
  const sale = createSale(request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.status(201).json({
    sale,
    snapshot,
  });
});

app.patch("/api/products/:id", requireAdminAuth, (request, response) => {
  const productId = Number(request.params.id);
  const product = updateProduct(productId, request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    product,
    snapshot,
  });
});

app.get("/api/admin/metrics", requireAdminAuth, (_request, response) => {
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  response.json({
    generatedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      cpuPercent: getProcessCpuPercent(),
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 10) / 10,
    },
    system: {
      cpuCount: os.cpus().length,
      totalMemoryMb: Math.round((totalMemory / 1024 / 1024) * 10) / 10,
      freeMemoryMb: Math.round((freeMemory / 1024 / 1024) * 10) / 10,
      usedMemoryPercent:
        Math.round((((totalMemory - freeMemory) / Math.max(totalMemory, 1)) * 100) * 10) / 10,
    },
  });
});

app.get("/api/admin/editor-data", requireAdminAuth, (_request, response) => {
  response.json({
    sales: getRecentSales(16),
    registerEvents: getRecentRegisterEvents(),
    inventoryMovements: getRecentInventoryMovements(),
    generatedAt: new Date().toISOString(),
  });
});

app.get("/api/inventory/quick-import", requireAdminAuth, (_request, response) => {
  response.json({
    items: getQuickImportRows(),
    generatedAt: new Date().toISOString(),
  });
});

app.post("/api/inventory/quick-import", requireAdminAuth, (request, response) => {
  const product = applyQuickInventoryEntry(request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    product,
    snapshot,
  });
});

app.get("/api/register/summary", (request, response) => {
  response.json({
    summary: getRegisterSummary(request.query.shift),
    generatedAt: new Date().toISOString(),
  });
});

app.post("/api/register/start", (request, response) => {
  const result = startRegister(request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.status(201).json({
    ...result,
    snapshot,
  });
});

app.post("/api/register/cut", (request, response) => {
  const result = createRegisterCut(request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.status(201).json({
    ...result,
    snapshot,
  });
});

app.get("/api/activity/:kind/:id", (request, response) => {
  const activityId = Number(request.params.id);
  let detail = null;

  if (request.params.kind === "sale") {
    detail = getSaleById(activityId);
  }

  if (request.params.kind === "register") {
    detail = getRegisterEventById(activityId);
  }

  if (request.params.kind === "inventory") {
    detail = getInventoryMovementById(activityId);
  }

  if (!detail) {
    response.status(404).json({
      message: "No encontre el detalle solicitado.",
    });
    return;
  }

  response.json({
    kind: request.params.kind,
    detail,
  });
});

app.patch("/api/admin/sales/:id", requireAdminAuth, (request, response) => {
  const saleId = Number(request.params.id);
  const sale = updateSaleAdmin(saleId, request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    sale,
    snapshot,
  });
});

app.patch("/api/admin/register-events/:id", requireAdminAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const registerEvent = updateRegisterEventAdmin(eventId, request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    registerEvent,
    snapshot,
  });
});

app.patch("/api/admin/inventory-movements/:id", requireAdminAuth, (request, response) => {
  const movementId = Number(request.params.id);
  const movement = updateInventoryMovementAdmin(movementId, request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    movement,
    snapshot,
  });
});

app.post("/api/import-workbook", requireAdminAuth, async (request, response) => {
  const result = await importCatalogFromWorkbook(request.body?.workbookPath);
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    result,
    snapshot,
  });
});

app.get("/api/export-workbook", requireAdminAuth, async (_request, response) => {
  const workbookBuffer = await exportWorkbookReport();
  const fileDate = new Date().toISOString().slice(0, 10);

  response.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="cremeria-rincon-export-${fileDate}.xlsx"`,
  );
  response.send(Buffer.from(workbookBuffer));
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(ROOT_DIR, "public", "index.html"));
});

app.use((error, _request, response, _next) => {
  const statusCode = Number(error.statusCode) || 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  response.status(statusCode).json({
    message:
      statusCode >= 500
        ? "Ocurrio un error interno en el servidor."
        : error.message,
  });
});

io.on("connection", (socket) => {
  socket.emit("dashboard:snapshot", getDashboardSnapshot());

  socket.on("disconnect", () => {
    socket.removeAllListeners();
  });
});

async function start() {
  const seedResult = await ensureCatalogSeeded();

  if (seedResult.seeded) {
    console.log(`Catalogo inicial importado desde ${seedResult.workbookPath}`);
  } else if (seedResult.reason === "workbook-not-found") {
    console.log("No se encontro el Excel para autoimportar el catalogo inicial.");
  }

  server.listen(PORT, () => {
    console.log(`POS disponible en http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
