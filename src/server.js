const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");

const { PORT, ROOT_DIR, STORE_NAME } = require("./config");
const { createDatabaseBackup, installDatabaseFromBuffer, nowIso } = require("./db");

const services = require("./services");
const adminAuth = require("./admin/auth");
const cashierAuth = require("./cashier/auth");
const { getSetting, setSetting } = require("./utils/settings");
const { getSystemMetrics } = require("./admin/metrics");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Configurar multer para uploads temporales en memoria
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

let lastCpuSnapshot = { usage: process.cpuUsage(), time: process.hrtime.bigint() };
const adminSessions = new Map();

function getAdminActorName(request) {
  return String(request.headers["x-admin-user"] || adminAuth.getStoredAdminUsername() || "admin");
}

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

function broadcastMerchandiseRequestUpdate(requestRecord) {
  if (!requestRecord) {
    return;
  }

  io.emit("merchandise-request:updated", {
    id: requestRecord.id,
    branch: requestRecord.branch,
    requestedBy: requestRecord.requestedBy,
    status: requestRecord.status,
    createdAt: requestRecord.createdAt,
    approvedAt: requestRecord.approvedAt,
    appliedAt: requestRecord.appliedAt,
  });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, generatedAt: new Date().toISOString() });
});

app.get("/api/dashboard", (request, response) => {
  const branch = request.query.branch || "carrizal";
  response.json(services.getDashboardSnapshot(branch));
});

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
    console.error("Error en /api/bootstrap:", err);
    response.status(500).json({
      message: "Error interno al generar bootstrap",
      detail: err.message
    });
  }
});

app.post("/api/sales", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const sale = services.createSale({
    ...(request.body || {}),
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
  const snapshot = services.getDashboardSnapshot(sale.branch);
  broadcastSnapshot(snapshot);
  response.status(201).json({ sale, snapshot });
});

app.post("/api/merchandise-requests", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const merchandiseRequest = services.createMerchandiseRequest({
    ...(request.body || {}),
    requestedBy: cashierSession.name,
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
  broadcastMerchandiseRequestUpdate(merchandiseRequest);
  response.status(201).json({ request: merchandiseRequest });
});

app.get("/api/merchandise-requests/my", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const status = request.query.status || "pending";
  const limit = Number(request.query.limit || 12);
  const requests = services.listMyMerchandiseRequests({
    requestedBy: cashierSession.name,
    branch: cashierSession.branch,
    status,
    limit,
  });
  response.json({ requests, generatedAt: nowIso() });
});

app.get("/api/merchandise-requests/pending", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const branch = request.query.branch || "all";
  const limit = Number(request.query.limit || 60);
  const requests = services.listPendingMerchandiseRequests(branch, limit);
  response.json({ requests, generatedAt: nowIso() });
});

app.get("/api/merchandise-requests/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const requestId = Number(request.params.id);
  const merchandiseRequest = services.getMerchandiseRequestById(requestId);
  if (!merchandiseRequest) {
    response.status(404).json({ message: "Solicitud de mercaderia no encontrada" });
    return;
  }

  response.json({ request: merchandiseRequest });
});

app.post("/api/merchandise-requests/:id/approve", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const requestId = Number(request.params.id);
  const merchandiseRequest = services.approveMerchandiseRequest(requestId);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "merchandise_request_approve",
    entityType: "merchandise_request",
    entityId: requestId,
    branch: merchandiseRequest.branch,
    payload: {
      supplierName: merchandiseRequest.supplierName,
      totalValue: merchandiseRequest.totalValue,
      itemCount: merchandiseRequest.itemCount,
    },
  });
  const snapshot = services.getDashboardSnapshot(merchandiseRequest.branch);
  broadcastSnapshot(snapshot);
  broadcastMerchandiseRequestUpdate(merchandiseRequest);
  response.json({ request: merchandiseRequest, snapshot });
});

app.post("/api/merchandise-requests/:id/reject", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const requestId = Number(request.params.id);
  const rejectionReason = request.body?.rejectionReason || request.body?.reason || "";
  const merchandiseRequest = services.rejectMerchandiseRequest(requestId, rejectionReason);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "merchandise_request_reject",
    entityType: "merchandise_request",
    entityId: requestId,
    branch: merchandiseRequest.branch,
    payload: {
      rejectionReason: merchandiseRequest.rejectionReason,
    },
  });
  broadcastMerchandiseRequestUpdate(merchandiseRequest);
  response.json({ request: merchandiseRequest });
});


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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "settings_update",
    entityType: "settings",
    entityId: "app",
    payload: updates,
  });
  response.json({ settings });
});


app.get("/api/admin/auth/status", (request, response) => {
  response.json({
    configured: Boolean(adminAuth.getStoredAdminPassword()),
    username: adminAuth.getStoredAdminUsername(),
    authenticated: adminAuth.isAdminAuthenticated(request, adminSessions)
  });
});

app.post("/api/admin/auth/setup", (request, response) => {
  if (adminAuth.getStoredAdminPassword()) {
    response.status(409).json({ message: "La contrasena de admin ya fue configurada." });
    return;
  }
  const username = String(request.body?.username || "").trim().toLowerCase();
  const password = String(request.body?.password || "").trim();
  if (username.length < 3) {
    response.status(400).json({ message: "El usuario admin debe tener al menos 3 caracteres." });
    return;
  }
  if (password.length < 4) {
    response.status(400).json({ message: "La contrasena admin debe tener al menos 4 caracteres." });
    return;
  }
  adminAuth.setSetting("admin.username", username);
  adminAuth.setSetting("admin.password", JSON.stringify(adminAuth.hashAdminPassword(password)));
  services.logAdminAction({
    actorName: username,
    action: "admin_setup",
    entityType: "auth",
    entityId: "admin",
    payload: { username },
  });
  response.status(201).json({ configured: true, username });
});

app.post("/api/admin/auth/login", (request, response) => {
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "").trim();
  if (!adminAuth.verifyAdminCredentials(username, password)) {
    response.status(401).json({ message: "La contrasena de admin no es correcta." });
    return;
  }
  const token = adminAuth.createAdminSession(adminSessions);
  services.logAdminAction({
    actorName: username,
    action: "admin_login",
    entityType: "auth",
    entityId: "admin",
    payload: { username },
  });
  response.json({ token });
});

app.post("/api/admin/auth/logout", (request, response) => {
  adminAuth.destroyAdminSession(request, adminSessions);
  response.json({ ok: true });
});


app.patch("/api/products/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const productId = Number(request.params.id);
  const product = services.updateProduct(productId, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_update",
    entityType: "product",
    entityId: productId,
    branch: request.body?.branch || "carrizal",
    payload: request.body || {},
  });
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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "quick_import_apply",
    entityType: "inventory",
    entityId: product?.id,
    branch: request.body?.branch || "carrizal",
    payload: request.body || {},
  });
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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "catalog_reimport",
    entityType: "catalog",
    entityId: branch,
    branch,
    payload: { workbookPath: request.body?.workbookPath || null },
  });
  const snapshot = services.getDashboardSnapshot(branch);
  response.status(201).json({ ...result, snapshot });
});

app.post("/api/admin/products/manual", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const product = services.createProduct(request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_create",
    entityType: "product",
    entityId: product?.id,
    branch: request.body?.branch || "carrizal",
    payload: request.body || {},
  });
  const snapshot = services.getDashboardSnapshot(request.body?.branch || "carrizal");
  broadcastSnapshot(snapshot);
  response.status(201).json({ product, snapshot });
});

app.delete("/api/admin/products/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const productId = Number(request.params.id);
  const branch = request.query.branch || "carrizal";
  const result = services.removeProduct(productId, branch);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_remove",
    entityType: "product",
    entityId: productId,
    branch,
    payload: { branch },
  });
  const snapshot = services.getDashboardSnapshot(branch);
  broadcastSnapshot(snapshot);
  response.json({ result, snapshot });
});

app.get("/api/admin/audit-log", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const branch = request.query.branch || "all";
  const limit = Number(request.query.limit || 120);
  response.json({
    logs: services.listRecentAuditLogs(Math.max(10, Math.min(limit, 500)), branch),
    generatedAt: nowIso(),
  });
});

app.get("/api/admin/download-db", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, async (_request, response, next) => {
  const backupPath = path.join(ROOT_DIR, "data", `download-db-${Date.now()}-${process.pid}.sqlite`);
  const cleanupBackup = () => {
    try {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (_error) {
      // Ignorar errores de limpieza para no romper la respuesta principal.
    }
  };

  try {
    await createDatabaseBackup(backupPath);
    response.download(backupPath, "cremaria-rincon.sqlite", (error) => {
      cleanupBackup();
      if (error && !response.headersSent) {
        next(error);
      }
    });
  } catch (error) {
    cleanupBackup();
    next(error);
  }
});

app.post(
  "/api/admin/install-db",
  (request, response, next) => {
    adminAuth.requireAdminAuth(request, response, next, adminSessions);
  },
  upload.single("database"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({
          message: "No se proporcionó un archivo de base de datos.",
        });
        return;
      }

      const buffer = request.file.buffer;
      const result = await installDatabaseFromBuffer(buffer);
      services.logAdminAction({
        actorName: getAdminActorName(request),
        action: "database_install",
        entityType: "database",
        entityId: request.file.originalname || "upload",
        payload: {
          fileName: request.file.originalname || null,
          fileSize: request.file.size || buffer.length,
          backupPath: result.backupPath,
        },
      });
      broadcastSnapshot(services.getDashboardSnapshot("all"));

      response.json({
        message: "Base de datos instalada correctamente.",
        backupPath: result.backupPath ? result.backupPath.replace(ROOT_DIR, "") : null,
        installedAt: result.installedAt,
      });
    } catch (error) {
      if (
        error.message === "El archivo esta vacio o incompleto."
        || error.message === "El archivo no es una base de datos SQLite valida."
      ) {
        response.status(400).json({ message: error.message });
        return;
      }

      next(error);
    }
  },
);

app.post(
  "/api/admin/install-export-workbook",
  (request, response, next) => {
    adminAuth.requireAdminAuth(request, response, next, adminSessions);
  },
  upload.single("workbook"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({
          message: "No se proporciono un archivo de Excel.",
        });
        return;
      }

      const result = await services.installOperationalDataFromWorkbookBuffer(request.file.buffer);
      services.logAdminAction({
        actorName: getAdminActorName(request),
        action: "workbook_install",
        entityType: "workbook",
        entityId: request.file.originalname || "upload",
        payload: {
          fileName: request.file.originalname || null,
          fileSize: request.file.size || request.file.buffer.length,
          branches: result.branches,
          counts: result.counts,
          backupPath: result.backupPath,
        },
      });
      broadcastSnapshot(services.getDashboardSnapshot("all"));

      response.json({
        message: "Datos del Excel instalados correctamente.",
        branches: result.branches,
        counts: result.counts,
        backupPath: result.backupPath ? result.backupPath.replace(ROOT_DIR, "") : null,
        installedAt: result.installedAt,
      });
    } catch (error) {
      if (error.statusCode === 400) {
        response.status(400).json({ message: error.message });
        return;
      }

      next(error);
    }
  },
);

app.get("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const branchParam = request.query.branch;
  const branch = branchParam === "all" ? null : branchParam;
  const cashiers = services.listCashiers(branch);
  response.json({ cashiers, generatedAt: nowIso() });
});

app.post("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  try {
    const cashier = services.createCashier(request.body || {});
    response.status(201).json({ cashier });
  } catch (error) {
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
  const cashier = services.authenticateCashier(name, branch, password);
  if (cashier) {
    const session = cashierAuth.createCashierSession(cashier);
    response.json({
      authenticated: true,
      cashier: session.cashier,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  } else {
    response.status(401).json({
      authenticated: false,
      message: "Credenciales incorrectas.",
    });
  }
});

app.get("/api/cashier/auth/status", (request, response) => {
  const cashierSession = cashierAuth.getCashierSessionFromRequest(request);
  if (!cashierSession) {
    response.json({ authenticated: false });
    return;
  }

  response.json({
    authenticated: true,
    cashier: {
      id: cashierSession.cashierId,
      name: cashierSession.name,
      branch: cashierSession.branch,
    },
    expiresAt: cashierSession.expiresAt,
  });
});

app.post("/api/cashier/auth/logout", (request, response) => {
  cashierAuth.destroyCashierSession(request);
  response.json({ ok: true });
});


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
  const summary = services.getRegisterSummary(
    request.query.shift || "Tarde",
    request.query.branch || "carrizal",
    { cashier: request.query.cashier || "" },
  );
  response.json(summary);
});

app.get("/api/admin/weighted-audit/sessions", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const sessions = services.listWeightedAuditSessions({
    branch: request.query.branch || "all",
    shift: request.query.shift || "",
    dateKey: request.query.dateKey || "",
    limit: Number(request.query.limit || 40),
  });
  response.json({ sessions, generatedAt: nowIso() });
});

app.post("/api/admin/weighted-audit/sessions", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const session = services.createWeightedAuditSession({
    branch: request.body?.branch || "carrizal",
    shift: request.body?.shift || "Tarde",
    dateKey: request.body?.dateKey || "",
    createdBy: request.body?.createdBy || getAdminActorName(request),
    notes: request.body?.notes || "",
  });
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "weighted_audit_session_create",
    entityType: "weighted_audit_session",
    entityId: session.id,
    branch: session.branch,
    payload: {
      shift: session.shift,
      auditedDateKey: session.auditedDateKey,
    },
  });
  response.status(201).json({ session });
});

app.get("/api/admin/weighted-audit/sessions/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const sessionId = Number(request.params.id);
  const session = services.getWeightedAuditSessionById(sessionId);
  if (!session) {
    response.status(404).json({ message: "Sesion de auditoria no encontrada" });
    return;
  }

  response.json({ session });
});

app.patch("/api/admin/weighted-audit/sessions/:id/items", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const sessionId = Number(request.params.id);
  const session = services.updateWeightedAuditItems(sessionId, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "weighted_audit_items_update",
    entityType: "weighted_audit_session",
    entityId: session.id,
    branch: session.branch,
    payload: {
      shift: session.shift,
      auditedDateKey: session.auditedDateKey,
      itemsUpdated: Array.isArray(request.body?.items) ? request.body.items.length : 0,
    },
  });
  response.json({ session });
});

app.post("/api/admin/weighted-audit/sessions/:id/complete", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response) => {
  const sessionId = Number(request.params.id);
  const session = services.completeWeightedAuditSession(sessionId, {
    completedBy: request.body?.completedBy || getAdminActorName(request),
    notes: request.body?.notes || "",
  });
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "weighted_audit_session_complete",
    entityType: "weighted_audit_session",
    entityId: session.id,
    branch: session.branch,
    payload: {
      shift: session.shift,
      auditedDateKey: session.auditedDateKey,
      incidents: session.summary?.incidentItems || 0,
    },
  });
  response.json({ session });
});


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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "sale_update_admin",
    entityType: "sale",
    entityId: saleId,
    branch: sale?.branch || null,
    payload: request.body || {},
  });
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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "register_event_update_admin",
    entityType: "register_event",
    entityId: eventId,
    branch: event?.branch || null,
    payload: request.body || {},
  });
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
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "inventory_movement_update_admin",
    entityType: "inventory_movement",
    entityId: movementId,
    branch: movement?.branch || null,
    payload: request.body || {},
  });
  response.json({ movement });
});


app.get("/api/register/summary", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const shift = request.query.shift || "Tarde";
  response.json({
    summary: services.getRegisterSummary(shift, cashierSession.branch, {
      cashier: cashierSession.name,
    }),
  });
});

app.post("/api/register/start", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const result = services.startRegister({
    ...(request.body || {}),
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
  response.json(result);
});

app.post("/api/register/cut", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const result = services.createRegisterCut({
    ...(request.body || {}),
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
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
}, async (request, response) => {
  const branch = request.query.branch || "all";
  const scope = request.query.scope || "store-day";
  const baseDate = request.query.baseDate || null;
  const result = await services.exportWorkbookReport({ branch, scope, baseDate });
  const exportDateSuffix = result.exportDateKey || scope;
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader(
    "Content-Disposition",
    "attachment; filename=" + `${STORE_NAME} - Exportacion-${branch}-${exportDateSuffix}.xlsx`,
  );
  await result.workbook.xlsx.write(response);
  response.end();
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

app.use((error, _request, response, _next) => {
  console.error("Error:", error.message);
  response
    .status(error.statusCode || 500)
    .json({ message: error.message || "Error interno del servidor" });
});

// ── INICIO ────────────────────────────────────────────────────────────────────
services.ensureCatalogSeeded().catch((error) => {
  console.error("No pude preparar el catalogo inicial:", error.message);
});

server.listen(PORT, () => { console.log("Servidor corriendo en http://localhost:" + PORT); });

module.exports = { app, server, io };
