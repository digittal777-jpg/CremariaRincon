const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const express = require("express");
const multer = require("multer");
const proxyaddr = require("proxy-addr");
const { Server } = require("socket.io");

const {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  ALLOWED_ORIGINS,
  BOOTSTRAP_TOKEN_HEADER_NAME,
  CONTROL_CONFIG_POLL_MS,
  OWNER_SESSION_COOKIE_NAME,
  OWNER_SESSION_TTL_MS,
  PORT,
  POS_FORCE_HTTPS,
  POS_HTTPS_CA_B64,
  POS_HTTPS_CA_PATH,
  POS_HTTPS_CERT_B64,
  POS_HTTPS_CERT_PATH,
  POS_HTTPS_KEY_B64,
  POS_HTTPS_KEY_PATH,
  POS_HSTS_MAX_AGE_SECONDS,
  POS_HTTP_REDIRECT_PORT,
  POS_PUBLIC_ORIGIN,
  POS_TRUST_PROXY,
  ROOT_DIR,
  SESSION_COOKIE_SECURE,
} = require("./config");
const { readFreshRuntimeConfigValue } = require("./runtimeConfig");
const {
  createDatabaseBackup,
  installDatabaseFromBuffer,
  nowIso,
  SQLITE_COMPATIBILITY_ERROR_MESSAGE,
} = require("./db");

const services = require("./services");
const adminAuth = require("./admin/auth");
const ownerAuth = require("./owner/auth");
const cashierAuth = require("./cashier/auth");
const {
  getBusinessProfile,
  getEnabledModules,
  getStoreDateKey,
  getStoreName,
  listMeasurementUnits,
  listProductAttributeDefinitions,
  listProductCategories,
} = require("./utils/helpers");
const { getSetting, setSetting } = require("./utils/settings");
const { getSystemMetrics } = require("./admin/metrics");
const {
  createPrimaryServer,
  createRedirectServer,
  loadHttpsCredentials,
} = require("./utils/httpsServer");
const {
  notifyMerchandiseRequestCreated,
} = require("./services/merchandiseRequestNotifications");

const app = express();
const httpsCredentials = loadHttpsCredentials({
  label: "POS HTTPS",
  baseDir: ROOT_DIR,
  certBase64: POS_HTTPS_CERT_B64,
  certPath: POS_HTTPS_CERT_PATH,
  keyBase64: POS_HTTPS_KEY_B64,
  keyPath: POS_HTTPS_KEY_PATH,
  caBase64: POS_HTTPS_CA_B64,
  caPath: POS_HTTPS_CA_PATH,
});
if (POS_HTTP_REDIRECT_PORT > 0 && !httpsCredentials.enabled) {
  throw new Error("POS_HTTP_REDIRECT_PORT requiere configurar certificado y llave HTTPS del POS.");
}
if (POS_HTTP_REDIRECT_PORT > 0 && POS_HTTP_REDIRECT_PORT === PORT) {
  throw new Error("POS_HTTP_REDIRECT_PORT no puede usar el mismo puerto que PORT.");
}
const server = createPrimaryServer(app, httpsCredentials);
const redirectServer = httpsCredentials.enabled && POS_HTTP_REDIRECT_PORT > 0
  ? createRedirectServer({
    publicOrigin: POS_PUBLIC_ORIGIN,
    httpsPort: PORT,
  })
  : null;
const io = new Server(server, {
  allowRequest(request, callback) {
    if (shouldRejectInsecureRequest(request)) {
      callback("HTTPS requerido para Socket.IO.", false);
      return;
    }
    callback(null, true);
  },
  cors: {
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origen no permitido para Socket.IO"));
    },
    credentials: true,
  },
});

const uploadTempDir = path.join(os.tmpdir(), "cremeria-rincon-uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination(_request, _file, callback) {
      fs.mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    },
    filename(_request, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

async function readUploadedFileBuffer(file) {
  if (file?.buffer) {
    return file.buffer;
  }
  if (!file?.path) {
    return Buffer.alloc(0);
  }
  return fs.promises.readFile(file.path);
}

function cleanupUploadedFile(file) {
  if (!file?.path) {
    return;
  }
  fs.promises.rm(file.path, { force: true }).catch(() => {});
}

let lastCpuSnapshot = { usage: process.cpuUsage(), time: process.hrtime.bigint() };
const adminSessions = null;
const CLIENT_ERROR_REPORT_WINDOW_MS = 60 * 1000;
const CLIENT_ERROR_REPORT_MAX_PER_WINDOW = 60;
const CLIENT_ERROR_REPORT_BUCKET_LIMIT = 500;
const clientErrorReportBuckets = new Map();
function buildPosContentSecurityPolicy() {
  const connectSources = POS_FORCE_HTTPS
    ? ["'self'", "wss:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"]
    : ["'self'", "ws:", "wss:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${[...new Set(connectSources)].join(" ")}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (POS_FORCE_HTTPS) {
    directives.push("upgrade-insecure-requests");
    directives.push("block-all-mixed-content");
  }
  return directives.join("; ");
}

const POS_CONTENT_SECURITY_POLICY = buildPosContentSecurityPolicy();

function pruneClientErrorReportBuckets(nowMs) {
  for (const [key, bucket] of clientErrorReportBuckets.entries()) {
    if (nowMs - bucket.startedAt >= CLIENT_ERROR_REPORT_WINDOW_MS) {
      clientErrorReportBuckets.delete(key);
    }
  }
}

function shouldAcceptClientErrorReport(request, nowMs = Date.now()) {
  const key = String(request.ip || request.socket?.remoteAddress || "unknown").slice(0, 120);
  const current = clientErrorReportBuckets.get(key);
  if (!current || nowMs - current.startedAt >= CLIENT_ERROR_REPORT_WINDOW_MS) {
    if (clientErrorReportBuckets.size >= CLIENT_ERROR_REPORT_BUCKET_LIMIT) {
      pruneClientErrorReportBuckets(nowMs);
    }
    clientErrorReportBuckets.set(key, { startedAt: nowMs, count: 1 });
    return true;
  }

  if (current.count >= CLIENT_ERROR_REPORT_MAX_PER_WINDOW) {
    return false;
  }

  current.count += 1;
  return true;
}

function getAdminActorName(request) {
  return String(
    request.adminSession?.username
      || request.headers["x-admin-user"]
      || adminAuth.getStoredAdminUsername()
      || "admin",
  );
}

function getDefaultBranchCode() {
  return services.listBranches({ includeInactive: false })[0]?.code || "carrizal";
}

function getRequestAccessContext(request, options = {}) {
  const cashierSession = cashierAuth.getCashierSessionFromRequest(request);
  const ownerSession = ownerAuth.getOwnerSession(request, {
    touch: options.touchOwner !== false,
  });
  const adminSession = adminAuth.getAdminSession(request, {
    touch: options.touchAdmin !== false,
  });

  let role = "guest";
  if (cashierSession) {
    role = "cashier";
  } else if (ownerSession) {
    role = "owner";
  } else if (adminSession) {
    role = "admin";
  }

  return {
    authenticated: Boolean(cashierSession || ownerSession || adminSession),
    role,
    cashierSession: cashierSession || null,
    adminSession: adminSession || null,
    ownerSession: ownerSession || null,
  };
}

function resolveRequestedBranch(request, accessContext, options = {}) {
  if (accessContext?.cashierSession?.branch) {
    return accessContext.cashierSession.branch;
  }

  const requestedBranch = String(
    options.branch
      ?? request.query?.branch
      ?? request.body?.branch
      ?? "",
  ).trim();

  if (!requestedBranch) {
    return getDefaultBranchCode();
  }

  if (requestedBranch === "all" && options.allowAll !== true) {
    return getDefaultBranchCode();
  }

  return requestedBranch;
}

function getAccessContextAdminCapabilities(accessContext) {
  return accessContext.adminSession || accessContext.ownerSession
    ? services.getAdminCapabilities()
    : [];
}

function canAccessAdminWorkspace(accessContext, adminCapabilities = getAccessContextAdminCapabilities(accessContext)) {
  return Boolean(
    accessContext.ownerSession
    || (accessContext.adminSession && adminCapabilities.length > 0),
  );
}

function canReadPrivateDashboard(accessContext, adminCapabilities = getAccessContextAdminCapabilities(accessContext)) {
  return Boolean(
    accessContext.cashierSession
    || accessContext.ownerSession
    || (accessContext.adminSession && adminCapabilities.length > 0),
  );
}

function buildBootstrapAuthState(accessContext, adminCapabilities = getAccessContextAdminCapabilities(accessContext)) {
  const canViewAdmin = canAccessAdminWorkspace(accessContext, adminCapabilities);
  return {
    role: accessContext.role || "guest",
    adminAuthenticated: Boolean(accessContext.adminSession),
    ownerAuthenticated: Boolean(accessContext.ownerSession),
    cashierAuthenticated: Boolean(accessContext.cashierSession),
    permissions: {
      canViewAdmin,
      canManageBranches: Boolean(
        accessContext.ownerSession
        || (accessContext.adminSession && adminCapabilities.includes("branches")),
      ),
      canOperateCashier: Boolean(accessContext.cashierSession),
    },
    admin: accessContext.adminSession
      ? {
          username: accessContext.adminSession.username,
          sessionExpiresAt: accessContext.adminSession.expiresAt,
        }
      : null,
    owner: accessContext.ownerSession
      ? {
          username: accessContext.ownerSession.username,
          sessionExpiresAt: accessContext.ownerSession.expiresAt,
        }
      : null,
    cashier: accessContext.cashierSession
      ? {
          id: accessContext.cashierSession.cashierId,
          name: accessContext.cashierSession.name,
          branch: accessContext.cashierSession.branch,
          expiresAt: accessContext.cashierSession.expiresAt,
        }
      : null,
  };
}

function requireAuthenticatedActor(request, response, next) {
  const accessContext = getRequestAccessContext(request);
  if (!accessContext.authenticated) {
    response.status(401).json({
      message: "Necesitas iniciar sesion para acceder a esta informacion.",
    });
    return;
  }

  request.accessContext = accessContext;
  next();
}

function requireAdminOrOwnerAuth(request, response, next) {
  if (ownerAuth.getOwnerSession(request, { touch: false })) {
    ownerAuth.requireOwnerAuth(request, response, next);
    return;
  }

  adminAuth.requireAdminAuth(request, response, next);
}

function requireAdminOrOwnerCapability(capabilityCode) {
  return (request, response, next) => {
    if (request.ownerSession) {
      next();
      return;
    }

    requireAdminCapability(capabilityCode)(request, response, next);
  };
}

function assertDetailAccessibleToRequester(detail, accessContext) {
  if (!detail || !accessContext?.cashierSession) {
    return;
  }

  if (detail.branch && detail.branch !== accessContext.cashierSession.branch) {
    const error = new Error("Actividad no encontrada");
    error.statusCode = 404;
    throw error;
  }
}

function requireClientSyncReporterAuth(request, response, next) {
  if (cashierAuth.getCashierTokenFromRequest(request)) {
    cashierAuth.requireCashierAuth(request, response, next);
    return;
  }

  if (ownerAuth.getOwnerSession(request, { touch: false })) {
    ownerAuth.requireOwnerAuth(request, response, next);
    return;
  }

  adminAuth.requireAdminAuth(request, response, next);
}

function getClientSyncReporterActor(request) {
  if (request.cashierSession) {
    return {
      actorType: "cashier",
      actorName: request.cashierSession.name,
      branch: request.cashierSession.branch,
    };
  }

  if (request.ownerSession) {
    return {
      actorType: "owner",
      actorName: request.ownerSession.username,
      branch: null,
    };
  }

  if (request.adminSession) {
    return {
      actorType: "admin",
      actorName: request.adminSession.username,
      branch: null,
    };
  }

  return {
    actorType: "device",
    actorName: "",
    branch: null,
  };
}

function setAdminSessionCookie(response, sessionId) {
  response.cookie(ADMIN_SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS,
  });
}

function clearAdminSessionCookie(response) {
  response.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
  });
}

function buildAdminAuthStatus(request) {
  const configured = Boolean(adminAuth.getStoredAdminPassword());
  const session = adminAuth.getAdminSession(request, { touch: false });
  return {
    configured,
    setupAllowed: !configured && Boolean(getEffectiveBootstrapToken()),
    username: adminAuth.getStoredAdminUsername(),
    authenticated: Boolean(session),
    csrfToken: session?.csrfToken || "",
    sessionExpiresAt: session?.expiresAt || null,
  };
}

function setOwnerSessionCookie(response, sessionId) {
  response.cookie(OWNER_SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: OWNER_SESSION_TTL_MS,
  });
}

function clearOwnerSessionCookie(response) {
  response.clearCookie(OWNER_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE_SECURE,
    path: "/",
  });
}

function buildOwnerAuthStatus(request) {
  const configured = Boolean(ownerAuth.getStoredOwnerPassword());
  const session = ownerAuth.getOwnerSession(request, { touch: false });
  return {
    configured,
    setupAllowed: !configured && Boolean(getEffectiveBootstrapToken()),
    username: ownerAuth.getStoredOwnerUsername(),
    authenticated: Boolean(session),
    csrfToken: session?.csrfToken || "",
    sessionExpiresAt: session?.expiresAt || null,
  };
}

function getBootstrapTokenFromRequest(request) {
  return String(request.headers[BOOTSTRAP_TOKEN_HEADER_NAME] || "").trim();
}

function getEffectiveBootstrapToken() {
  return String(readFreshRuntimeConfigValue("POS_BOOTSTRAP_TOKEN") || "").trim();
}

function assertBootstrapSetupAllowed(request, actorLabel) {
  const bootstrapToken = getEffectiveBootstrapToken();
  if (!bootstrapToken) {
    throw Object.assign(new Error(`El setup inicial de ${actorLabel} esta bloqueado en este despliegue.`), {
      statusCode: 403,
    });
  }

  if (getBootstrapTokenFromRequest(request) !== bootstrapToken) {
    throw Object.assign(new Error(`Necesitas un token de bootstrap valido para crear el acceso ${actorLabel}.`), {
      statusCode: 403,
    });
  }
}

function getManifestMimeType(assetPath) {
  const normalizedPath = String(assetPath || "").toLowerCase();
  if (normalizedPath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (normalizedPath.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedPath.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function buildManifestPayload() {
  const profile = getBusinessProfile();
  const businessName = profile.businessName || "Punto de Venta";
  const shortName = profile.shortName || "POS";
  const branding = profile.branding || {};
  const iconCandidates = [
    branding.logo192,
    branding.logo512,
    branding.logo,
    "/assets/branding/retail-base-badge.svg",
  ].filter(Boolean);
  const seenIcons = new Set();
  const icons = iconCandidates.reduce((entries, iconPath) => {
    if (seenIcons.has(iconPath)) {
      return entries;
    }

    seenIcons.add(iconPath);
    entries.push({
      src: iconPath,
      sizes: String(iconPath).endsWith(".svg")
        ? "any"
        : iconPath === branding.logo192
          ? "192x192"
          : iconPath === branding.logo512
            ? "512x512"
            : "512x512",
      type: getManifestMimeType(iconPath),
      purpose: "any maskable",
    });
    return entries;
  }, []);

  return {
    name: businessName,
    short_name: shortName,
    start_url: "/",
    display: "standalone",
    background_color: "#f4efe7",
    theme_color: "#6f5a4a",
    lang: profile.locale || "es-MX",
    icons,
  };
}

function buildBusinessTemplateSummaries() {
  return services.listBusinessTemplates().map((template) => {
    const loadedTemplate = services.loadBusinessTemplate(template.key);
    return {
      key: template.key,
      businessName: loadedTemplate.businessName || "",
      shortName: loadedTemplate.shortName || "",
      description: loadedTemplate.description || "",
      modules: Array.isArray(loadedTemplate.modules) ? loadedTemplate.modules : [],
      categories: Array.isArray(loadedTemplate.categories) ? loadedTemplate.categories.length : 0,
      units: Array.isArray(loadedTemplate.units) ? loadedTemplate.units.length : 0,
      branches: Array.isArray(loadedTemplate.branches) ? loadedTemplate.branches.length : 0,
    };
  });
}

function getFirstForwardedProto(request) {
  return String(request.headers["x-forwarded-proto"] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .find(Boolean) || "";
}

function parseTrustProxySetting(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }

  const lowerText = text.toLowerCase();
  if (["false", "no", "off"].includes(lowerText)) {
    return false;
  }
  if (lowerText === "true") {
    return true;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createTrustProxyMatcher(setting) {
  if (setting === false || setting === 0) {
    return () => false;
  }
  if (setting === true || typeof setting === "number") {
    throw new Error("usa true o hops numericos; captura proxies o CIDRs explicitos.");
  }
  const compiled = proxyaddr.compile(setting);
  return (address) => {
    if (!address) {
      return false;
    }
    return compiled(address, 0);
  };
}

function resolveTrustProxyConfiguration(rawValue, label) {
  const setting = parseTrustProxySetting(rawValue);
  try {
    return {
      trustProxySetting: setting,
      isTrustedProxyAddress: createTrustProxyMatcher(setting),
    };
  } catch (error) {
    console.warn(`${label} invalido; se desactiva trust proxy. ${error.message}`);
    return {
      trustProxySetting: false,
      isTrustedProxyAddress: () => false,
    };
  }
}

const {
  trustProxySetting: TRUST_PROXY_SETTING,
  isTrustedProxyAddress,
} = resolveTrustProxyConfiguration(POS_TRUST_PROXY, "POS_TRUST_PROXY");

function normalizeNetworkValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/^::ffff:/, "");
}

function isLoopbackAddress(address) {
  const normalizedAddress = normalizeNetworkValue(address);
  return normalizedAddress === "::1"
    || normalizedAddress === "localhost"
    || normalizedAddress.startsWith("127.");
}

function isLoopbackRequest(request) {
  return isLoopbackAddress(request.socket?.remoteAddress)
    || isLoopbackAddress(request.socket?.localAddress);
}

function isTrustedProxyRequest(request) {
  const remoteAddress = String(request.socket?.remoteAddress || request.connection?.remoteAddress || "").trim();
  return Boolean(remoteAddress) && isTrustedProxyAddress(remoteAddress);
}

function isHttpsRequest(request) {
  if (request.secure || request.socket?.encrypted) {
    return true;
  }
  return isTrustedProxyRequest(request) && getFirstForwardedProto(request) === "https";
}

function getConfiguredHttpsOrigin(originValue) {
  const value = String(originValue || "").trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.origin : "";
  } catch (_error) {
    return "";
  }
}

function buildHttpsRedirectUrl(request) {
  const publicOrigin = getConfiguredHttpsOrigin(POS_PUBLIC_ORIGIN);
  if (!publicOrigin) {
    return "";
  }
  return new URL(request.originalUrl || request.url || "/", publicOrigin).toString();
}

function isRailwayHealthcheckRequest(request) {
  const hostname = String(request.headers.host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return ["GET", "HEAD"].includes(request.method)
    && request.path === "/api/health"
    && hostname === "healthcheck.railway.app";
}

function shouldRejectInsecureRequest(request) {
  return POS_FORCE_HTTPS
    && !isRailwayHealthcheckRequest(request)
    && !isHttpsRequest(request)
    && !isLoopbackRequest(request);
}

function applySecurityHeaders(request, response, next) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", POS_CONTENT_SECURITY_POLICY);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Origin-Agent-Cluster", "?1");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (isHttpsRequest(request) && POS_HSTS_MAX_AGE_SECONDS > 0) {
    response.setHeader("Strict-Transport-Security", `max-age=${POS_HSTS_MAX_AGE_SECONDS}`);
  }

  if (shouldRejectInsecureRequest(request)) {
    response.setHeader("Cache-Control", "no-store");
    const redirectUrl = ["GET", "HEAD"].includes(String(request.method || "GET").toUpperCase()) && !request.path.startsWith("/api/")
      ? buildHttpsRedirectUrl(request)
      : "";
    if (redirectUrl) {
      response.redirect(308, redirectUrl);
      return;
    }
    response.status(426).json({
      message: "HTTPS requerido. Esta API no acepta HTTP fuera de localhost.",
    });
    return;
  }

  const origin = String(request.headers.origin || "").trim();
  if (origin && ALLOWED_ORIGINS.length > 0) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      response.status(403).json({ message: "Origen no permitido." });
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Cashier-Token, X-CSRF-Token, X-Admin-User, X-Bootstrap-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
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
  services.clearDashboardSnapshotCache();
  io.emit("dashboard:snapshot", {
    branch: snapshot?.store?.currentBranch || null,
    generatedAt: snapshot?.generatedAt || nowIso(),
  });
}

let controlPlaneConfigPollTimer = null;

async function syncControlPlaneRuntimeConfig(reason = "poll") {
  const status = services.getControlPlaneStatus();
  if (!status.usable) {
    return {
      skipped: true,
      reason: status.configured ? "invalid_config" : "not_configured",
      message: status.error || "",
    };
  }

  const result = await services.syncRuntimeConfigFromControlPlane();
  const updatedKeys = Array.isArray(result?.runtimeConfig?.updatedKeys) ? result.runtimeConfig.updatedKeys : [];
  const clearedKeys = Array.isArray(result?.runtimeConfig?.clearedKeys) ? result.runtimeConfig.clearedKeys : [];
  if (updatedKeys.length || clearedKeys.length) {
    const changedKeys = [...updatedKeys, ...clearedKeys].join(", ");
    console.warn(result.requiresRestart
      ? `[control-plane] Variables runtime sincronizadas (${reason}). Reinicia el POS para aplicar: ${changedKeys}`
      : `[control-plane] Variables runtime sincronizadas y activas (${reason}): ${changedKeys}`);
    services.reportSupportHealthToControlPlane({ branch: "all" }).catch((error) => {
      console.warn(`[control-plane] No pude reportar salud despues de aplicar variables runtime (${reason}): ${error.message}`);
    });
  }
  return result;
}

async function syncControlPlaneConfigAndBroadcast(reason = "poll") {
  const status = services.getControlPlaneStatus();
  if (!status.usable) {
    return {
      skipped: true,
      reason: status.configured ? "invalid_config" : "not_configured",
      message: status.error || "",
    };
  }

  const result = await services.refreshControlPlaneConfigIfStale({
    force: true,
    silent: true,
  });
  if (result?.ownerConsole && result.changed) {
    const snapshot = services.getDashboardSnapshot("all");
    broadcastSnapshot(snapshot);
    services.reportSupportHealthToControlPlane({ branch: "all" }).catch((error) => {
      console.warn(`[control-plane] No pude reportar salud despues de aplicar config (${reason}): ${error.message}`);
    });
  }
  return result;
}

function startControlPlanePolling() {
  if (!services.getControlPlaneStatus().usable) {
    return;
  }
  syncControlPlaneRuntimeConfig("startup").catch((error) => {
    console.warn(`[control-plane] No pude sincronizar variables runtime iniciales: ${error.message}`);
  });
  syncControlPlaneConfigAndBroadcast("startup").catch((error) => {
    console.warn(`[control-plane] No pude sincronizar configuracion inicial: ${error.message}`);
  });

  if (CONTROL_CONFIG_POLL_MS <= 0 || controlPlaneConfigPollTimer) {
    return;
  }

  controlPlaneConfigPollTimer = setInterval(() => {
    syncControlPlaneRuntimeConfig("poll").catch((error) => {
      console.warn(`[control-plane] No pude sincronizar variables runtime: ${error.message}`);
    });
    syncControlPlaneConfigAndBroadcast("poll").catch((error) => {
      console.warn(`[control-plane] No pude sincronizar configuracion central: ${error.message}`);
    });
  }, CONTROL_CONFIG_POLL_MS);
  if (typeof controlPlaneConfigPollTimer.unref === "function") {
    controlPlaneConfigPollTimer.unref();
  }
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

function broadcastWeightedAuditUpdate(session) {
  if (!session) {
    return;
  }

  io.emit("weighted-audit:updated", {
    id: session.id,
    branch: session.branch,
    shift: session.shift,
    auditedDateKey: session.auditedDateKey,
    status: session.status,
    sourceCashier: session.sourceCashier || "",
    sourceRegisterEventId: session.sourceRegisterEventId || null,
    completedAt: session.completedAt || null,
  });
}

function requireEnabledModule(moduleCode) {
  return (_request, _response, next) => {
    try {
      services.assertModuleEnabled(moduleCode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAdminCapability(capabilityCode) {
  return (_request, _response, next) => {
    try {
      services.assertAdminCapability(capabilityCode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY_SETTING);
app.use(applySecurityHeaders);
app.use(express.json({ limit: "1mb" }));

app.get("/manifest.webmanifest", (_request, response) => {
  response.type("application/manifest+json");
  response.setHeader("Cache-Control", "no-store");
  response.send(JSON.stringify(buildManifestPayload()));
});

app.use(express.static(path.join(ROOT_DIR, "public"), {
  index: false,
  setHeaders(response, filePath) {
    if (path.basename(filePath).toLowerCase() === "index.html") {
      response.setHeader("Cache-Control", "no-store");
    }
  },
}));

function sendPosShell(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.sendFile(path.join(ROOT_DIR, "public", "index.html"));
}

app.get("/", sendPosShell);

app.get("/administracion", sendPosShell);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, generatedAt: new Date().toISOString() });
});

app.get("/api/dashboard", requireAuthenticatedActor, async (request, response) => {
  await services.refreshControlPlaneConfigIfStale({ silent: true });
  const adminCapabilities = getAccessContextAdminCapabilities(request.accessContext);
  const branch = resolveRequestedBranch(request, request.accessContext, {
    allowAll: canAccessAdminWorkspace(request.accessContext, adminCapabilities),
  });
  response.json(
    canReadPrivateDashboard(request.accessContext, adminCapabilities)
      ? services.getDashboardSnapshot(branch, { useCache: true })
      : services.getPublicDashboardSnapshot(branch, { useCache: true }),
  );
});

function attachBootstrapMetadata(snapshot, accessContext, adminCapabilities) {
  snapshot.auth = buildBootstrapAuthState(accessContext, adminCapabilities);
  snapshot.profile = snapshot.profile || snapshot.store || {};
  snapshot.enabledModules = Array.isArray(snapshot.enabledModules) ? snapshot.enabledModules : [];
  snapshot.categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
  snapshot.units = Array.isArray(snapshot.units) ? snapshot.units : [];
  snapshot.productAttributeDefinitions = Array.isArray(snapshot.productAttributeDefinitions)
    ? snapshot.productAttributeDefinitions
    : [];
  snapshot.branding = snapshot.branding || snapshot.profile?.branding || snapshot.store?.branding || {};
  snapshot.adminCapabilities = adminCapabilities;
  return snapshot;
}

app.get("/api/bootstrap", async (request, response) => {
  try {
    await services.refreshControlPlaneConfigIfStale({ silent: true });
    const accessContext = getRequestAccessContext(request);
    const adminCapabilities = getAccessContextAdminCapabilities(accessContext);
    const branch = resolveRequestedBranch(request, accessContext, {
      allowAll: canAccessAdminWorkspace(accessContext, adminCapabilities),
    });
    const includeInactiveInventory =
      canAccessAdminWorkspace(accessContext, adminCapabilities)
      && ["1", "true"].includes(String(request.query.includeInactiveInventory || "").toLowerCase());
    const snapshot = canReadPrivateDashboard(accessContext, adminCapabilities)
      ? services.getDashboardSnapshot(branch, {
          includeInventoryInactive: includeInactiveInventory,
          useCache: true,
        })
      : services.getPublicDashboardSnapshot(branch, { useCache: true });
    response.json(attachBootstrapMetadata(snapshot, accessContext, adminCapabilities));
  } catch (err) {
    console.error("Error en /api/bootstrap:", err);
    response.status(500).json({
      message: "Error interno al generar bootstrap",
      detail: err.message
    });
  }
});

app.get("/api/admin/bootstrap", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, async (request, response) => {
  try {
    await services.refreshControlPlaneConfigIfStale({ silent: true });
    const accessContext = getRequestAccessContext(request);
    const adminCapabilities = getAccessContextAdminCapabilities(accessContext);
    if (!canAccessAdminWorkspace(accessContext, adminCapabilities)) {
      response.status(403).json({ message: "Esta seccion del admin esta bloqueada por el owner." });
      return;
    }

    const branch = resolveRequestedBranch(request, accessContext, { allowAll: true });
    const includeInactiveInventory = ["1", "true"].includes(
      String(request.query.includeInactiveInventory || "").toLowerCase(),
    );
    const snapshot = services.getDashboardSnapshot(branch, {
      includeInventoryInactive: includeInactiveInventory,
      useCache: true,
    });
    response.json(attachBootstrapMetadata(snapshot, accessContext, adminCapabilities));
  } catch (err) {
    console.error("Error en /api/admin/bootstrap:", err);
    response.status(500).json({
      message: "Error interno al generar bootstrap admin",
      detail: err.message,
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

app.post("/api/merchandise-requests", requireEnabledModule("merchandise_requests"), cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const merchandiseRequest = services.createMerchandiseRequest({
    ...(request.body || {}),
    requestedBy: cashierSession.name,
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
  void notifyMerchandiseRequestCreated(merchandiseRequest)
    .then((notificationResult) => {
      if (!notificationResult) {
        return;
      }

      if (notificationResult.skipped) {
        console.warn(
          `[merchandise-requests] Telegram alert skipped for request ${merchandiseRequest.id}: ${notificationResult.reason || "unknown-reason"}`,
        );
        return;
      }

      if (notificationResult.failedCount === 0) {
        return;
      }

      console.warn(
        `[merchandise-requests] Telegram alert partial failure for request ${merchandiseRequest.id}: `
          + notificationResult.failed.map((item) => `${item.chatId}: ${item.message}`).join(" | "),
      );
    })
    .catch((error) => {
      console.warn(
        `[merchandise-requests] Telegram alert failed for request ${merchandiseRequest.id}: ${error.message}`,
      );
    });
  broadcastMerchandiseRequestUpdate(merchandiseRequest);
  response.status(201).json({ request: merchandiseRequest });
});

app.get("/api/merchandise-requests/my", requireEnabledModule("merchandise_requests"), cashierAuth.requireCashierAuth, (request, response) => {
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
  requireEnabledModule("merchandise_requests")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next);
}, (request, response, next) => {
  requireAdminCapability("merchandise_requests")(request, response, next);
}, (request, response) => {
  const branch = request.query.branch || "all";
  const limit = Number(request.query.limit || 60);
  const requests = services.listPendingMerchandiseRequests(branch, limit);
  response.json({ requests, generatedAt: nowIso() });
});

app.get("/api/merchandise-requests/:id", (request, response, next) => {
  requireEnabledModule("merchandise_requests")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next);
}, (request, response, next) => {
  requireAdminCapability("merchandise_requests")(request, response, next);
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
  requireEnabledModule("merchandise_requests")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("merchandise_requests")(request, response, next);
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
  requireEnabledModule("merchandise_requests")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("merchandise_requests")(request, response, next);
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


app.get("/api/products/:id", requireAuthenticatedActor, (request, response) => {
  const adminCapabilities = getAccessContextAdminCapabilities(request.accessContext);
  if (request.accessContext.adminSession && !canAccessAdminWorkspace(request.accessContext, adminCapabilities)) {
    response.status(403).json({ message: "Esta seccion del admin esta bloqueada por el owner." });
    return;
  }
  const branch = resolveRequestedBranch(request, request.accessContext, {
    allowAll: canAccessAdminWorkspace(request.accessContext, adminCapabilities),
  });
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
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.json(services.getAdminConfigBundle());
});

app.patch("/api/admin/settings", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const payload = request.body || {};
  const settingsPayload = payload.settings && typeof payload.settings === "object"
    ? payload.settings
    : Object.fromEntries(
      Object.entries(payload).filter(([key]) => !["businessProfile", "enabledModules"].includes(key)),
    );
  const settings = Object.keys(settingsPayload).length > 0
    ? services.updateSettings(settingsPayload)
    : services.listSettings();
  const businessProfile = payload.businessProfile
    ? services.updateBusinessProfile(payload.businessProfile)
    : getBusinessProfile();
  const enabledModules = Array.isArray(payload.enabledModules)
    ? services.updateEnabledModules(payload.enabledModules)
    : getEnabledModules();
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "settings_update",
    entityType: "settings",
    entityId: "app",
    payload,
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({
    settings,
    businessProfile,
    enabledModules,
    adminCapabilities: services.getAdminCapabilities(),
    categories: listProductCategories({ includeInactive: true }),
    units: listMeasurementUnits({ includeInactive: true }),
    productAttributeDefinitions: listProductAttributeDefinitions({ includeInactive: true }),
  });
});

app.get("/api/admin/templates", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.json({ templates: buildBusinessTemplateSummaries(), generatedAt: nowIso() });
});

app.post("/api/admin/templates/:key/apply", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.status(403).json({
    message: "Aplicar una plantilla completa ahora es una operacion exclusiva del owner.",
  });
});

app.post("/api/admin/modules", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const enabledModules = services.updateEnabledModules(request.body?.enabledModules || []);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "modules_update",
    entityType: "settings",
    entityId: "modules",
    payload: { enabledModules },
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ enabledModules });
});

app.get("/api/admin/categories", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.json({
    categories: listProductCategories({ includeInactive: true }),
    generatedAt: nowIso(),
  });
});

app.post("/api/admin/categories", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const category = services.createProductCategory(request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "category_create",
    entityType: "product_category",
    entityId: category.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.status(201).json({ category });
});

app.patch("/api/admin/categories/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const category = services.updateProductCategory(request.params.id, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "category_update",
    entityType: "product_category",
    entityId: category.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ category });
});

app.delete("/api/admin/categories/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const category = services.deactivateProductCategory(request.params.id);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "category_deactivate",
    entityType: "product_category",
    entityId: category.id,
    payload: {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ category });
});

app.get("/api/admin/units", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.json({
    units: listMeasurementUnits({ includeInactive: true }),
    generatedAt: nowIso(),
  });
});

app.post("/api/admin/units", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const unit = services.createMeasurementUnit(request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "unit_create",
    entityType: "measurement_unit",
    entityId: unit.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.status(201).json({ unit });
});

app.patch("/api/admin/units/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const unit = services.updateMeasurementUnit(request.params.id, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "unit_update",
    entityType: "measurement_unit",
    entityId: unit.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ unit });
});

app.delete("/api/admin/units/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const unit = services.deactivateMeasurementUnit(request.params.id);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "unit_deactivate",
    entityType: "measurement_unit",
    entityId: unit.id,
    payload: {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ unit });
});

app.get("/api/admin/product-attributes", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (_request, response) => {
  response.json({
    productAttributeDefinitions: listProductAttributeDefinitions({ includeInactive: true }),
    generatedAt: nowIso(),
  });
});

app.post("/api/admin/product-attributes", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const productAttributeDefinition = services.createProductAttributeDefinition(request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_attribute_create",
    entityType: "product_attribute_definition",
    entityId: productAttributeDefinition.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.status(201).json({ productAttributeDefinition });
});

app.patch("/api/admin/product-attributes/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const productAttributeDefinition = services.updateProductAttributeDefinition(request.params.id, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_attribute_update",
    entityType: "product_attribute_definition",
    entityId: productAttributeDefinition.id,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ productAttributeDefinition });
});

app.delete("/api/admin/product-attributes/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("business_config")(request, response, next);
}, (request, response) => {
  const productAttributeDefinition = services.deactivateProductAttributeDefinition(request.params.id);
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "product_attribute_deactivate",
    entityType: "product_attribute_definition",
    entityId: productAttributeDefinition.id,
    payload: {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ productAttributeDefinition });
});

app.get("/api/admin/branches", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("branches")(request, response, next);
}, (_request, response) => {
  response.json({
    branches: services.listBranches({ includeInactive: true }),
    generatedAt: nowIso(),
  });
});

app.post("/api/admin/branches", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("branches")(request, response, next);
}, (request, response) => {
  const branch = services.createBranch(request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "branch_create",
    entityType: "branch",
    entityId: branch.code,
    branch: branch.code,
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.status(201).json({ branch });
});

app.patch("/api/admin/branches/:code", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("branches")(request, response, next);
}, (request, response) => {
  const branch = services.updateBranch(request.params.code, request.body || {});
  services.logAdminAction({
    actorName: getAdminActorName(request),
    action: "branch_update",
    entityType: "branch",
    entityId: branch.code,
    branch: branch.code,
    payload: {
      previousCode: request.params.code,
      ...request.body,
    },
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json({ branch });
});


app.get("/api/admin/auth/status", (request, response) => {
  response.json(buildAdminAuthStatus(request));
});

app.post("/api/admin/auth/setup", (request, response) => {
  if (adminAuth.getStoredAdminPassword()) {
    response.status(409).json({ message: "La contrasena de admin ya fue configurada." });
    return;
  }
  try {
    assertBootstrapSetupAllowed(request, "admin");
  } catch (error) {
    response.status(error.statusCode || 403).json({ message: error.message });
    return;
  }
  const username = String(request.body?.username || "").trim().toLowerCase();
  const password = String(request.body?.password || "").trim();
  if (username.length < 3) {
    response.status(400).json({ message: "El usuario admin debe tener al menos 3 caracteres." });
    return;
  }
  const passwordError = adminAuth.getAdminPasswordValidationError(password);
  if (passwordError) {
    response.status(400).json({ message: passwordError });
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
  const username = String(request.body?.username || "").trim().toLowerCase();
  const password = String(request.body?.password || "").trim();
  try {
    adminAuth.assertAdminLoginAllowed(request, username);
  } catch (error) {
    response.status(error.statusCode || 429).json({ message: error.message });
    return;
  }

  if (!adminAuth.verifyAdminCredentials(username, password)) {
    adminAuth.registerFailedAdminLogin(request, username);
    response.status(401).json({ message: "La contrasena de admin no es correcta." });
    return;
  }

  adminAuth.clearAdminLoginFailures(request, username);
  const session = adminAuth.createAdminSession(request, username);
  setAdminSessionCookie(response, session.sessionId);
  services.logAdminAction({
    actorName: username,
    action: "admin_login",
    entityType: "auth",
    entityId: "admin",
    payload: { username },
  });
  response.json({
    authenticated: true,
    username: session.username,
    csrfToken: session.csrfToken,
    sessionExpiresAt: session.expiresAt,
  });
});

app.post("/api/admin/auth/logout", (request, response) => {
  adminAuth.destroyAdminSession(request);
  clearAdminSessionCookie(response);
  response.json({ ok: true });
});

app.get("/api/owner/auth/status", (request, response) => {
  response.json(buildOwnerAuthStatus(request));
});

app.post("/api/owner/auth/setup", (request, response) => {
  if (ownerAuth.getStoredOwnerPassword()) {
    response.status(409).json({ message: "La contrasena owner ya fue configurada." });
    return;
  }

  try {
    assertBootstrapSetupAllowed(request, "owner");
    const result = ownerAuth.setStoredOwnerCredentials(request.body?.username, request.body?.password);
    services.logAdminAction({
      actorType: "owner",
      actorName: result.username,
      action: "owner_setup",
      entityType: "auth",
      entityId: "owner",
      payload: { username: result.username },
    });
    response.status(201).json({ configured: true, username: result.username });
  } catch (error) {
    response.status(error.statusCode || 400).json({ message: error.message });
  }
});

app.post("/api/owner/auth/login", (request, response) => {
  const username = String(request.body?.username || "").trim().toLowerCase();
  const password = String(request.body?.password || "").trim();

  try {
    ownerAuth.assertOwnerLoginAllowed(request);
  } catch (error) {
    response.status(error.statusCode || 429).json({ message: error.message });
    return;
  }

  if (!ownerAuth.verifyOwnerCredentials(username, password)) {
    ownerAuth.recordFailedOwnerLogin(request);
    response.status(401).json({ message: "Las credenciales owner no son correctas." });
    return;
  }

  ownerAuth.clearFailedOwnerLogin(request);
  const session = ownerAuth.createOwnerSession(request, username);
  setOwnerSessionCookie(response, session.sessionId);
  services.logAdminAction({
    actorType: "owner",
    actorName: username,
    action: "owner_login",
    entityType: "auth",
    entityId: "owner",
    payload: { username },
  });
  response.json({
    authenticated: true,
    username: session.username,
    csrfToken: session.csrfToken,
    sessionExpiresAt: session.expiresAt,
  });
});

app.post("/api/owner/auth/logout", (request, response) => {
  ownerAuth.destroyOwnerSessionFromRequest(request);
  clearOwnerSessionCookie(response);
  response.json({ ok: true });
});

app.get("/api/owner/config", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (_request, response) => {
  response.json(services.getOwnerConsoleBundle());
});

app.get("/api/owner/templates", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (_request, response) => {
  response.json({ templates: buildBusinessTemplateSummaries(), generatedAt: nowIso() });
});

app.patch("/api/owner/config", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response) => {
  const result = services.updateOwnerConsoleAccess(request.body || {});
  services.logAdminAction({
    actorType: "owner",
    actorName: request.ownerSession?.username || ownerAuth.getStoredOwnerUsername(),
    action: "owner_console_update",
    entityType: "owner_console",
    entityId: "access",
    payload: request.body || {},
  });
  broadcastSnapshot(services.getDashboardSnapshot("all"));
  response.json(result);
});

app.patch("/api/owner/runtime-config", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response, next) => {
  try {
    const result = services.saveOwnerRuntimeConfig(request.body || {});
    services.logAdminAction({
      actorType: "owner",
      actorName: request.ownerSession?.username || ownerAuth.getStoredOwnerUsername(),
      action: "owner_runtime_config_update",
      entityType: "runtime_config",
      entityId: result.sourcePathRelative || "pos-runtime-config",
      payload: {
        updatedKeys: result.updatedKeys,
        clearedKeys: result.clearedKeys,
        requiresRestart: result.requiresRestart,
      },
    });
    response.json({
      ...result,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/owner/runtime-config/sync", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, async (request, response, next) => {
  try {
    const result = await services.syncRuntimeConfigFromControlPlane();
    let healthReport = null;
    let healthReportError = null;
    try {
      healthReport = await services.reportSupportHealthToControlPlane({ branch: "all" });
    } catch (error) {
      healthReportError = error.message || "No pude reportar salud al owner-control.";
    }
    services.logAdminAction({
      actorType: "owner",
      actorName: request.ownerSession?.username || ownerAuth.getStoredOwnerUsername(),
      action: "owner_runtime_config_sync",
      entityType: "runtime_config",
      entityId: result.runtimeConfig?.sourcePathRelative || "pos-runtime-config",
      payload: {
        updatedKeys: result.runtimeConfig?.updatedKeys || [],
        clearedKeys: result.runtimeConfig?.clearedKeys || [],
        requiresRestart: result.requiresRestart,
      },
    });
    response.json({
      ...result,
      healthReport,
      healthReportError,
      operationGuide: services.getOwnerOperationGuide(),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/owner/templates/:key/apply", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, async (request, response) => {
  try {
    const template = services.loadBusinessTemplate(request.params.key);
    const result = await services.applyBusinessTemplateWithCatalog(template, {
      businessName: request.body?.businessName,
      slug: request.body?.slug,
      workbookPath: request.body?.workbookPath,
      confirmReset: request.body?.confirmReset === true,
      confirmText: request.body?.confirmText,
      actorType: "owner",
      actorName: request.ownerSession?.username || ownerAuth.getStoredOwnerUsername(),
    });
    const snapshot = services.getPublicDashboardSnapshot();
    ownerAuth.destroyOwnerSessionFromRequest(request);
    clearOwnerSessionCookie(response);
    clearAdminSessionCookie(response);
    broadcastSnapshot(snapshot);
    response.json({
      ...result,
      snapshot,
      requiresReauth: true,
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({ message: error.message });
  }
});


app.patch("/api/products/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("inventory")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("support_tools")(request, response, next);
}, (_request, response) => {
  const metrics = getSystemMetrics();
  metrics.process.cpuPercent = getProcessCpuPercent();
  response.json(metrics);
});

app.get("/api/admin/profitability", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), (request, response, next) => {
  try {
    response.json({
      report: services.getProfitabilityReport({
        period: request.query.period,
        anchorDateKey: request.query.anchorDateKey || request.query.dateKey,
        from: request.query.from,
        to: request.query.to,
        branch: request.query.branch || "all",
      }),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/service-subscription", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), (_request, response, next) => {
  try {
    response.json({
      subscription: services.getServiceSubscription(),
      payments: services.listServiceSubscriptionPayments(12),
      controlPlane: services.getControlPlaneStatus(),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/service-subscription/sync", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), async (_request, response, next) => {
  try {
    response.json({
      ...await services.syncServiceSubscriptionFromControlPlane(),
      payments: services.listServiceSubscriptionPayments(12),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/control-plane/config/sync", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), async (_request, response, next) => {
  try {
    const syncResult = await services.syncOwnerConsoleConfigFromControlPlane();
    let healthReport = null;
    let healthReportError = null;
    try {
      healthReport = await services.reportSupportHealthToControlPlane({ branch: "all" });
    } catch (error) {
      healthReportError = error.message || "No pude reportar salud al owner-control.";
    }
    const snapshot = services.getDashboardSnapshot("all");
    broadcastSnapshot(snapshot);
    response.json({
      ...syncResult,
      businessProfile: syncResult.ownerConsole.businessProfile,
      enabledModules: syncResult.ownerConsole.enabledModules,
      adminCapabilities: syncResult.ownerConsole.adminCapabilities,
      healthReport,
      healthReportError,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/control-plane/runtime-config/sync", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), async (_request, response, next) => {
  try {
    const syncResult = await services.syncRuntimeConfigFromControlPlane();
    let healthReport = null;
    let healthReportError = null;
    try {
      healthReport = await services.reportSupportHealthToControlPlane({ branch: "all" });
    } catch (error) {
      healthReportError = error.message || "No pude reportar salud al owner-control.";
    }
    response.json({
      ...syncResult,
      healthReport,
      healthReportError,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/control-plane/health/report", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), async (request, response, next) => {
  try {
    response.json({
      ...await services.reportSupportHealthToControlPlane({
        branch: request.body?.branch || request.query.branch || "all",
      }),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/service-subscription", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response, next) => {
  try {
    response.json({
      subscription: services.updateServiceSubscription(request.body || {}),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/service-subscription/payments", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response, next) => {
  try {
    response.status(201).json({
      ...services.recordServiceSubscriptionPayment(request.body || {}),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/owner/service-subscription", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (_request, response, next) => {
  try {
    response.json({
      subscription: services.getServiceSubscription(),
      payments: services.listServiceSubscriptionPayments(12),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/owner/service-subscription", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response, next) => {
  try {
    response.json({
      subscription: services.updateServiceSubscription(request.body || {}),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/owner/service-subscription/payments", (request, response, next) => {
  ownerAuth.requireOwnerAuth(request, response, next);
}, (request, response, next) => {
  try {
    response.status(201).json({
      ...services.recordServiceSubscriptionPayment(request.body || {}),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/support-health", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), (request, response, next) => {
  try {
    response.json({
      health: services.getSupportHealthReport({
        branch: request.query.branch || "all",
      }),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/error-reports", requireAdminOrOwnerAuth, requireAdminOrOwnerCapability("support_tools"), (request, response, next) => {
  try {
    response.json({
      errors: services.listAppErrorReports({
        limit: request.query.limit,
        source: request.query.source,
      }),
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/client-errors", (request, response) => {
  try {
    if (!shouldAcceptClientErrorReport(request)) {
      response.status(202).json({ ok: true, throttled: true, generatedAt: nowIso() });
      return;
    }

    const accessContext = getRequestAccessContext(request, {
      touchOwner: false,
      touchAdmin: false,
    });
    services.recordAppErrorReport(request.body || {}, {
      source: "frontend",
      role: accessContext.role,
      branch: accessContext.cashierSession?.branch || request.body?.branch || null,
      userAgent: request.headers["user-agent"],
      url: request.body?.url || request.originalUrl,
      method: request.method,
    });
  } catch (_error) {
    // El reporte de errores nunca debe romper la operacion principal.
  }
  response.status(202).json({ ok: true, generatedAt: nowIso() });
});

app.get("/api/admin/backups/status", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, (_request, response) => {
  response.json({
    ...services.getBackupStatusBundle(),
    generatedAt: nowIso(),
  });
});

app.get("/api/admin/period-closures/preview", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, (request, response, next) => {
  try {
    const preview = services.getPeriodClosurePreview({
      branch: request.query.branch || "all",
      periodType: request.query.periodType || "week",
      anchorDateKey: request.query.anchorDateKey || request.query.dateKey || getStoreDateKey(new Date()),
    });
    response.json({
      preview,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/period-closures", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, (request, response, next) => {
  try {
    const closures = services.listPeriodClosures({
      branch: request.query.branch || "all",
      periodType: request.query.periodType || "week",
      limit: Number(request.query.limit || 12),
    });
    response.json({
      closures,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/period-closures/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, (request, response, next) => {
  try {
    const closure = services.getPeriodClosureById(request.params.id);
    response.json({
      closure,
      generatedAt: nowIso(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/period-closures", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, (request, response, next) => {
  try {
    const closure = services.savePeriodClosure({
      branch: request.body?.branch || "all",
      periodType: request.body?.periodType || "week",
      anchorDateKey: request.body?.anchorDateKey || request.body?.dateKey || getStoreDateKey(new Date()),
      notes: request.body?.notes || "",
      createdBy: getAdminActorName(request),
    });
    services.logAdminAction({
      actorName: getAdminActorName(request),
      action: request.body?.regenerate ? "period_closure_regenerate" : "period_closure_save",
      entityType: "period_closure",
      entityId: closure.id,
      branch: closure.branch,
      payload: {
        periodType: closure.periodType,
        periodStartDateKey: closure.periodStartDateKey,
        periodEndDateKey: closure.periodEndDateKey,
        isStale: closure.isStale,
      },
    });
    response.json({ closure });
  } catch (error) {
    next(error);
  }
});

app.post("/api/client-sync-health", (request, response, next) => {
  requireClientSyncReporterAuth(request, response, next);
}, (request, response) => {
  try {
    const report = services.recordClientSyncHealth(request.body || {}, getClientSyncReporterActor(request));
    response.status(201).json({
      ok: true,
      report,
      generatedAt: nowIso(),
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      message: error.message || "No pude registrar el estado de sincronizacion.",
    });
  }
});

app.get("/api/admin/editor-data", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("daily_flow")(request, response, next);
}, (request, response) => {
  response.json({ items: services.getQuickImportRows(request.query.branch || "carrizal"), generatedAt: nowIso() });
});

app.post("/api/inventory/quick-import", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("daily_flow")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("inventory")(request, response, next);
}, (request, response) => {
  const branch = request.query.branch || "carrizal";
  response.json({ products: services.listProducts(branch), generatedAt: nowIso() });
});

app.post("/api/admin/products", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("daily_flow")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("inventory")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("inventory")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("audit_log")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
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
  (request, response, next) => {
    requireAdminCapability("backups")(request, response, next);
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

      const buffer = await readUploadedFileBuffer(request.file);
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
      clearAdminSessionCookie(response);
      clearOwnerSessionCookie(response);

      response.json({
        message: "Base de datos instalada correctamente.",
        backupPath: result.backupPath ? result.backupPath.replace(ROOT_DIR, "") : null,
        installedAt: result.installedAt,
        requiresReauth: true,
        sessionsPurged: result.sessionsPurged === true,
      });
    } catch (error) {
      if (
        error.message === "El archivo esta vacio o incompleto."
        || error.message === "El archivo no es una base de datos SQLite valida."
        || error.message === SQLITE_COMPATIBILITY_ERROR_MESSAGE
      ) {
        response.status(400).json({ message: error.message });
        return;
      }

      next(error);
    } finally {
      cleanupUploadedFile(request.file);
    }
  },
);

app.post(
  "/api/admin/install-export-workbook",
  (request, response, next) => {
    adminAuth.requireAdminAuth(request, response, next, adminSessions);
  },
  (request, response, next) => {
    requireAdminCapability("backups")(request, response, next);
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

      const buffer = await readUploadedFileBuffer(request.file);
      const result = await services.installOperationalDataFromWorkbookBuffer(buffer);
      services.logAdminAction({
        actorName: getAdminActorName(request),
        action: "workbook_install",
        entityType: "workbook",
        entityId: request.file.originalname || "upload",
        payload: {
          fileName: request.file.originalname || null,
          fileSize: request.file.size || buffer.length,
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
    } finally {
      cleanupUploadedFile(request.file);
    }
  },
);

app.get("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("cashiers")(request, response, next);
}, (request, response) => {
  const branchParam = request.query.branch;
  const branch = branchParam === "all" ? null : branchParam;
  const cashiers = services.listCashiers(branch);
  response.json({ cashiers, generatedAt: nowIso() });
});

app.post("/api/admin/cashiers", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("cashiers")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("cashiers")(request, response, next);
}, (request, response) => {
  const cashierId = Number(request.params.id);
  const cashier = services.updateCashier(cashierId, request.body || {});
  response.json({ cashier });
});

app.delete("/api/admin/cashiers/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("cashiers")(request, response, next);
}, (request, response) => {
  const cashierId = Number(request.params.id);
  const result = services.deleteCashier(cashierId);
  response.json({ result });
});

app.post("/api/admin/cashiers/init-test", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("cashiers")(request, response, next);
}, (_request, response) => {
  services.initializeTestCashiers();
  response.json({ ok: true });
});

app.post("/api/cashier/auth", (request, response) => {
  const { name, branch, password } = request.body || {};
  try {
    cashierAuth.assertCashierLoginAllowed(request, name, branch);
  } catch (error) {
    response.status(error.statusCode || 429).json({ message: error.message, authenticated: false });
    return;
  }

  const cashier = services.authenticateCashier(name, branch, password);
  if (cashier) {
    cashierAuth.clearFailedCashierLogin(request, name, branch);
    const session = cashierAuth.createCashierSession(cashier);
    response.json({
      authenticated: true,
      cashier: session.cashier,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  } else {
    cashierAuth.recordFailedCashierLogin(request, name, branch);
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
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const result = services.startRegister(request.query || {});
  response.json(result);
});

app.post("/api/admin/register/cut", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const result = services.createRegisterCut(request.body || {});
  response.json(result);
});

app.get("/api/admin/register/summary", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const summary = services.getRegisterSummary(
    request.query.shift || "Tarde",
    request.query.branch || "carrizal",
    { cashier: request.query.cashier || "" },
  );
  response.json(summary);
});

app.get("/api/admin/weighted-audit/sessions", (request, response, next) => {
  requireEnabledModule("weighted_audit")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("weighted_audit")(request, response, next);
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
  requireEnabledModule("weighted_audit")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("weighted_audit")(request, response, next);
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
  broadcastWeightedAuditUpdate(session);
  response.status(201).json({ session });
});

app.get("/api/admin/weighted-audit/sessions/:id", (request, response, next) => {
  requireEnabledModule("weighted_audit")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("weighted_audit")(request, response, next);
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
  requireEnabledModule("weighted_audit")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("weighted_audit")(request, response, next);
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
  broadcastWeightedAuditUpdate(session);
  response.json({ session });
});

app.post("/api/admin/weighted-audit/sessions/:id/complete", (request, response, next) => {
  requireEnabledModule("weighted_audit")(request, response, next);
}, (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("weighted_audit")(request, response, next);
}, (request, response) => {
  const sessionId = Number(request.params.id);
  const session = services.completeWeightedAuditSession(sessionId, {
    completedBy: request.body?.completedBy || getAdminActorName(request),
    notes: request.body?.notes,
    items: Array.isArray(request.body?.items) ? request.body.items : undefined,
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
  broadcastWeightedAuditUpdate(session);
  response.json({ session });
});


app.get("/api/admin/sales/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const saleId = Number(request.params.id);
  const sale = services.getSaleById(saleId);
  if (!sale) { response.status(404).json({ message: "Venta no encontrada" }); return; }
  response.json({ sale });
});

app.patch("/api/admin/sales/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
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
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const eventId = Number(request.params.id);
  const event = services.getRegisterEventById(eventId);
  if (!event) { response.status(404).json({ message: "Evento de caja no encontrado" }); return; }
  response.json({ event });
});

app.patch("/api/admin/register-events/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const eventId = Number(request.params.id);
  const event = services.updateRegisterEventAdmin(eventId, request.body || {});
  if (event?.eventType === "final_cut" && typeof services.getWeightedAuditSessionBySourceRegisterEventId === "function") {
    const session = services.getWeightedAuditSessionBySourceRegisterEventId(eventId);
    if (session) {
      broadcastWeightedAuditUpdate(session);
    }
  }
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
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
}, (request, response) => {
  const movementId = Number(request.params.id);
  const movement = services.getInventoryMovementById(movementId);
  if (!movement) { response.status(404).json({ message: "Movimiento de inventario no encontrado" }); return; }
  response.json({ movement });
});

app.patch("/api/admin/inventory-movements/:id", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("quick_edit")(request, response, next);
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
    blindAuditPrompt: services.findCashierBlindAuditPrompt({
      branch: cashierSession.branch,
      shift,
      cashier: cashierSession.name,
      dateKey: getStoreDateKey(new Date()),
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
  const blindAuditPrompt = result.auditSession
    ? services.findCashierBlindAuditPrompt({
      branch: cashierSession.branch,
      shift: result.auditSession.shift || request.body?.shift || "Tarde",
      cashier: cashierSession.name,
      dateKey: result.auditSession.auditedDateKey || getStoreDateKey(new Date()),
    })
    : null;
  if (result.auditSession) {
    broadcastWeightedAuditUpdate(result.auditSession);
  }
  response.json({
    ...result,
    blindAuditPrompt,
  });
});

app.get("/api/register/weighted-audit/:id/blind", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const sessionId = Number(request.params.id);
  const prompt = services.buildCashierBlindAuditPrompt(sessionId, {
    cashier: cashierSession.name,
  });

  if (!prompt) {
    response.status(404).json({ message: "No encontre la captura ciega para este corte." });
    return;
  }
  if (prompt.branch !== cashierSession.branch) {
    response.status(403).json({ message: "Esta captura pertenece a otra sucursal." });
    return;
  }

  response.json({ prompt });
});

app.post("/api/register/weighted-audit/:id/blind/preview", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const sessionId = Number(request.params.id);
  const prompt = services.buildCashierBlindAuditPrompt(sessionId, {
    cashier: cashierSession.name,
  });

  if (!prompt) {
    response.status(404).json({ message: "No encontre la captura ciega para este corte." });
    return;
  }
  if (prompt.branch !== cashierSession.branch) {
    response.status(403).json({ message: "Esta captura pertenece a otra sucursal." });
    return;
  }

  const preview = services.previewCashierBlindWeightedAuditItems(sessionId, request.body || {}, {
    cashier: cashierSession.name,
  });
  response.json(preview);
});

app.patch("/api/register/weighted-audit/:id/blind", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const sessionId = Number(request.params.id);
  const prompt = services.buildCashierBlindAuditPrompt(sessionId, {
    cashier: cashierSession.name,
  });

  if (!prompt) {
    response.status(404).json({ message: "No encontre la captura ciega para este corte." });
    return;
  }
  if (prompt.branch !== cashierSession.branch) {
    response.status(403).json({ message: "Esta captura pertenece a otra sucursal." });
    return;
  }

  const result = services.updateCashierBlindWeightedAuditItems(sessionId, request.body || {}, {
    cashier: cashierSession.name,
  });
  if (result.session) {
    broadcastWeightedAuditUpdate(result.session);
  }
  response.json(result);
});

app.get("/api/receivables", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const search = String(request.query.search || "");
  response.json({
    customers: services.listReceivableCustomers(cashierSession.branch, { search }),
  });
});

app.get("/api/receivables/customer/:customerKey", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const customer = services.getReceivableCustomerDetail(
    request.params.customerKey,
    cashierSession.branch,
  );

  if (!customer) {
    response.status(404).json({ message: "No encontre saldo pendiente para ese cliente." });
    return;
  }

  response.json({ customer });
});

app.post("/api/receivables/payments", cashierAuth.requireCashierAuth, (request, response) => {
  const cashierSession = request.cashierSession;
  const payment = services.createReceivablePayment({
    ...(request.body || {}),
    cashier: cashierSession.name,
    branch: cashierSession.branch,
  });
  const customer = services.getReceivableCustomerDetail(
    payment.customerKey || services.normalizeReceivableCustomerKey(payment.customerName),
    cashierSession.branch,
  );
  const snapshot = services.getDashboardSnapshot(cashierSession.branch);
  broadcastSnapshot(snapshot);
  response.status(201).json({
    payment,
    customer,
    snapshot,
  });
});

app.get("/api/activity/:kind/:id", requireAuthenticatedActor, (request, response, next) => {
  const adminCapabilities = getAccessContextAdminCapabilities(request.accessContext);
  if (request.accessContext.adminSession && !canAccessAdminWorkspace(request.accessContext, adminCapabilities)) {
    response.status(403).json({ message: "Esta seccion del admin esta bloqueada por el owner." });
    return;
  }
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
  } else if (kind === "credit-payment" || kind === "receivable-payment") {
    detail = services.getCreditPaymentById(id);
    foundKind = "credit-payment";
  }

  if (!detail) {
    response.status(404).json({ message: "Actividad no encontrada" });
    return;
  }

  try {
    assertDetailAccessibleToRequester(detail, request.accessContext);
    response.json({ kind: foundKind, detail });
  } catch (error) {
    next(error);
  }
});

app.get("/api/export-workbook", (request, response, next) => {
  adminAuth.requireAdminAuth(request, response, next, adminSessions);
}, (request, response, next) => {
  requireAdminCapability("backups")(request, response, next);
}, async (request, response, next) => {
  try {
    const branch = request.query.branch || "all";
    const scope = request.query.scope || "store-day";
    const baseDate = request.query.baseDate || null;
    const result = await services.exportWorkbookReport({ branch, scope, baseDate });
    const exportDateSuffix = result.exportDateKey || scope;
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader(
      "Content-Disposition",
      "attachment; filename=" + `${getStoreName()} - Exportacion-${branch}-${exportDateSuffix}.xlsx`,
    );
    await result.workbook.xlsx.write(response);
    response.end();
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

app.use((error, request, response, _next) => {
  console.error("Error:", error.message);
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    try {
      const accessContext = getRequestAccessContext(request, {
        touchOwner: false,
        touchAdmin: false,
      });
      services.recordAppErrorReport({
        source: "backend",
        level: "error",
        message: error.message || "Error interno del servidor",
        stack: process.env.NODE_ENV === "production" ? "" : error.stack,
        url: request.originalUrl,
        method: request.method,
        statusCode,
      }, {
        role: accessContext.role,
        branch: accessContext.cashierSession?.branch || null,
        userAgent: request.headers["user-agent"],
      });
    } catch (_reportError) {
      // El registro de soporte no debe cambiar la respuesta del error original.
    }
  }
  const payload = {
    message: error.message || "Error interno del servidor",
  };
  if (error.clientPayload && typeof error.clientPayload === "object") {
    Object.assign(payload, error.clientPayload);
  }
  response
    .status(statusCode)
    .json(payload);
});

// ── INICIO ────────────────────────────────────────────────────────────────────
services.ensureCatalogSeeded().catch((error) => {
  console.error("No pude preparar el catalogo inicial:", error.message);
});

server.listen(PORT, () => {
  const protocol = httpsCredentials.enabled ? "https" : "http";
  console.log(`Servidor corriendo en ${protocol}://localhost:${PORT}`);
  if (httpsCredentials.enabled && httpsCredentials.sources.length > 0) {
    console.log(`HTTPS directo activo con ${httpsCredentials.sources.join(", ")}`);
  }
  if (redirectServer) {
    redirectServer.listen(POS_HTTP_REDIRECT_PORT, () => {
      console.log(`Redireccion HTTP activa en http://localhost:${POS_HTTP_REDIRECT_PORT}`);
    });
  }
  if (POS_FORCE_HTTPS && !httpsCredentials.enabled && !String(POS_TRUST_PROXY || "").trim()) {
    console.warn("POS_FORCE_HTTPS esta activo pero este proceso no termina TLS ni confia en un proxy HTTPS.");
  }
  startControlPlanePolling();
});

module.exports = {
  app,
  server,
  io,
  redirectServer,
  httpsEnabled: httpsCredentials.enabled,
};
