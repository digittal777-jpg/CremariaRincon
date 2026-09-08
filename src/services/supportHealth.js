const fs = require("node:fs");
const proxyaddr = require("proxy-addr");

const {
  CONTROL_API_URL,
  CONTROL_REQUIRE_HTTPS,
  DB_PATH,
  POS_FORCE_HTTPS,
  POS_HSTS_MAX_AGE_SECONDS,
  POS_PUBLIC_ORIGIN,
  POS_SUPPORT_LABEL,
  POS_SUPPORT_PHONE,
  POS_SUPPORT_WHATSAPP_URL,
  POS_TRUST_PROXY,
  POS_HTTPS_CERT_B64,
  POS_HTTPS_CERT_PATH,
  POS_HTTPS_KEY_B64,
  POS_HTTPS_KEY_PATH,
  SESSION_COOKIE_SECURE,
} = require("../config");
const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  getStoreDateKey,
  getStoreDateRangeForValue,
  normalizeBranch,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const { getRuntimeConfigEditorSnapshot } = require("../runtimeConfig");
const { getBackupStatusBundle, getClientSyncHealthSummary } = require("./backups");
const { listAppErrorReports } = require("./errorReports");
const { getServiceSubscription } = require("./subscription");

const db = getDb();
const HAS_DIRECT_POS_HTTPS = Boolean(
  (POS_HTTPS_CERT_PATH || POS_HTTPS_CERT_B64)
  && (POS_HTTPS_KEY_PATH || POS_HTTPS_KEY_B64),
);

function getDatabaseSize() {
  try {
    const stats = fs.statSync(DB_PATH);
    return {
      path: DB_PATH,
      bytes: stats.size,
      mb: roundMoney(stats.size / 1024 / 1024),
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch (_error) {
    return {
      path: DB_PATH,
      bytes: 0,
      mb: 0,
      modifiedAt: null,
    };
  }
}

function getLatestSale(branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const row = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT id, ticket_number, branch, cashier, total, item_count, created_at
      FROM sales
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get()
    : db.prepare(`
      SELECT id, ticket_number, branch, cashier, total, item_count, created_at
      FROM sales
      WHERE branch = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(normalizedBranch);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    branch: row.branch,
    cashier: row.cashier,
    total: roundMoney(row.total),
    itemCount: roundStock(row.item_count || 0),
    createdAt: row.created_at,
  };
}

function getOperationalCounts(branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const productRow = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        COUNT(*) AS products,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_products,
        COALESCE(SUM(CASE WHEN active = 1 AND COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products,
        COALESCE(SUM(CASE WHEN active = 1 AND stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products
      FROM products
    `).get()
    : db.prepare(`
      SELECT
        COUNT(*) AS products,
        COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_products,
        COALESCE(SUM(CASE WHEN active = 1 AND COALESCE(cost, 0) <= 0 THEN 1 ELSE 0 END), 0) AS missing_cost_products,
        COALESCE(SUM(CASE WHEN active = 1 AND stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_products
      FROM products
      WHERE branch = ?
    `).get(normalizedBranch);

  const today = new Date();
  const todayRange = getStoreDateRangeForValue(today);
  const tickets = normalizedBranch === ALL_BRANCHES
    ? db.prepare("SELECT COUNT(*) AS count FROM sales").get().count
    : db.prepare("SELECT COUNT(*) AS count FROM sales WHERE branch = ?").get(normalizedBranch).count;
  const ticketsToday = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT COUNT(*) AS count
      FROM sales
      WHERE created_at >= ? AND created_at < ?
    `).get(todayRange.startAt, todayRange.endAt).count
    : db.prepare(`
      SELECT COUNT(*) AS count
      FROM sales
      WHERE branch = ? AND created_at >= ? AND created_at < ?
    `).get(normalizedBranch, todayRange.startAt, todayRange.endAt).count;

  return {
    products: Number(productRow.products || 0),
    activeProducts: Number(productRow.active_products || 0),
    missingCostProducts: Number(productRow.missing_cost_products || 0),
    negativeStockProducts: Number(productRow.negative_stock_products || 0),
    tickets: Number(tickets || 0),
    ticketsToday: Number(ticketsToday || 0),
    todayDateKey: getStoreDateKey(today),
  };
}

function pushSemaphoreIssue(collection, code, message, action, severity = "risk") {
  collection.reasons.push({
    code,
    severity,
    message,
  });
  collection.actions.push({
    code,
    severity,
    message: action,
  });
}

function normalizeSecurityHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function isLoopbackSecurityHost(hostname) {
  const host = normalizeSecurityHostname(hostname);
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || host === "0.0.0.0"
    || host.startsWith("127.");
}

function parseSecurityUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    return new URL(text);
  } catch (_error) {
    return null;
  }
}

function classifyTrustProxyConfiguration(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text || ["false", "no", "off"].includes(text.toLowerCase())) {
    return {
      configured: false,
      overbroad: false,
      invalid: false,
    };
  }
  if (/^true$/i.test(text) || /^\d+$/.test(text)) {
    return {
      configured: false,
      overbroad: true,
      invalid: false,
    };
  }

  try {
    proxyaddr.compile(
      text
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    return {
      configured: true,
      overbroad: false,
      invalid: false,
    };
  } catch (_error) {
    return {
      configured: false,
      overbroad: false,
      invalid: true,
    };
  }
}

function buildSecurityPosture() {
  const trustProxyText = String(POS_TRUST_PROXY || "").trim();
  const trustProxyState = classifyTrustProxyConfiguration(trustProxyText);
  const publicOriginText = String(POS_PUBLIC_ORIGIN || "").trim();
  const controlApiText = String(CONTROL_API_URL || "").trim();
  const publicOriginUrl = parseSecurityUrl(POS_PUBLIC_ORIGIN);
  const controlApiUrl = parseSecurityUrl(CONTROL_API_URL);
  const publicOriginInvalid = Boolean(publicOriginText && !publicOriginUrl);
  const controlApiInvalid = Boolean(controlApiText && !controlApiUrl);
  const publicOriginRemote = Boolean(publicOriginUrl && !isLoopbackSecurityHost(publicOriginUrl.hostname));
  const controlApiRemote = Boolean(controlApiUrl && !isLoopbackSecurityHost(controlApiUrl.hostname));
  const result = {
    status: "ok",
    publicOrigin: publicOriginText,
    publicOriginInvalid,
    publicOriginRemote,
    publicOriginHttps: !publicOriginText
      || Boolean(publicOriginUrl && (publicOriginUrl.protocol === "https:" || !publicOriginRemote)),
    forceHttps: Boolean(POS_FORCE_HTTPS),
    secureCookies: Boolean(SESSION_COOKIE_SECURE),
    hstsEnabled: POS_HSTS_MAX_AGE_SECONDS > 0,
    controlApiUrl: controlApiText,
    controlApiInvalid,
    controlApiRemote,
    controlApiHttps: !controlApiText
      || Boolean(controlApiUrl && (controlApiUrl.protocol === "https:" || !controlApiRemote)),
    controlRequireHttps: Boolean(CONTROL_REQUIRE_HTTPS),
    directHttps: HAS_DIRECT_POS_HTTPS,
    trustProxyConfigured: trustProxyState.configured,
    trustProxyOverbroad: trustProxyState.overbroad,
    trustProxyInvalid: trustProxyState.invalid,
    reasons: [],
    actions: [],
  };

  if (result.publicOriginInvalid) {
    pushSemaphoreIssue(
      result,
      "public_origin_invalid",
      "POS_PUBLIC_ORIGIN no es una URL valida.",
      "Corregir POS_PUBLIC_ORIGIN para que el navegador y el semaforo lean un origen HTTPS valido.",
      "critical",
    );
  }

  if (result.publicOriginRemote && !result.publicOriginHttps) {
    pushSemaphoreIssue(
      result,
      "public_http_origin",
      "La URL publica del POS sigue en HTTP.",
      "Configurar POS_PUBLIC_ORIGIN con HTTPS real antes de exponer caja, admin o owner.",
      "critical",
    );
  }

  if (result.publicOriginRemote && !result.forceHttps) {
    pushSemaphoreIssue(
      result,
      "https_not_forced",
      "El POS tiene URL publica remota pero POS_FORCE_HTTPS esta apagado.",
      "Activar POS_FORCE_HTTPS para bloquear o redirigir trafico HTTP fuera de localhost.",
      "risk",
    );
  }

  if (result.publicOriginRemote && !result.secureCookies) {
    pushSemaphoreIssue(
      result,
      "insecure_admin_cookies",
      "Las cookies de sesion no estan marcadas como seguras.",
      "Activar POS_SECURE_COOKIES para que admin y owner no expongan sesion por HTTP.",
      "critical",
    );
  }

  if (result.publicOriginRemote && result.forceHttps && !result.directHttps && !result.trustProxyConfigured) {
    pushSemaphoreIssue(
      result,
      "https_termination_unconfigured",
      "HTTPS esta forzado pero el POS no termina TLS ni confia en un proxy HTTPS.",
      "Configurar certificado directo en el POS o definir POS_TRUST_PROXY con el proxy que envia X-Forwarded-Proto.",
      "critical",
    );
  }

  if (result.trustProxyOverbroad) {
    pushSemaphoreIssue(
      result,
      "trust_proxy_overbroad",
      "POS_TRUST_PROXY confia en cualquier proxy o en hops ambiguos.",
      "Usar una lista explicita de proxies o CIDRs confiables, por ejemplo loopback,linklocal,uniquelocal.",
      "critical",
    );
  }

  if (result.trustProxyInvalid) {
    pushSemaphoreIssue(
      result,
      "trust_proxy_invalid",
      "POS_TRUST_PROXY tiene una lista invalida y el proceso la desactiva.",
      "Usar una lista valida de proxies o CIDRs confiables, por ejemplo loopback,linklocal,uniquelocal.",
      "critical",
    );
  }

  if (result.controlApiInvalid) {
    pushSemaphoreIssue(
      result,
      "control_plane_url_invalid",
      "CONTROL_API_URL no es una URL valida.",
      "Corregir CONTROL_API_URL para que el POS pueda hablar con owner-control sin exponer secretos.",
      "critical",
    );
  }

  if (result.controlApiRemote && !result.controlApiHttps) {
    pushSemaphoreIssue(
      result,
      "control_plane_http",
      "La API central owner-control esta configurada en HTTP.",
      "Mover CONTROL_API_URL a HTTPS para no exponer secretos entre el POS y owner-control.",
      "critical",
    );
  }

  if (result.forceHttps && !result.hstsEnabled) {
    pushSemaphoreIssue(
      result,
      "hsts_disabled",
      "HTTPS esta forzado pero HSTS esta apagado.",
      "Definir POS_HSTS_MAX_AGE_SECONDS mayor a cero para que el navegador recuerde usar HTTPS.",
      "risk",
    );
  }

  if (result.reasons.some((reason) => reason.severity === "critical")) {
    result.status = "critical";
  } else if (result.reasons.length > 0) {
    result.status = "risk";
  }

  return result;
}

function buildSupportContactSummary() {
  const configuredUrl = String(POS_SUPPORT_WHATSAPP_URL || "").trim();
  const phoneDigits = String(POS_SUPPORT_PHONE || "").replace(/\D/g, "");
  const whatsappUrl = configuredUrl || (phoneDigits ? `https://wa.me/${phoneDigits}` : "");
  let valid = false;

  if (whatsappUrl) {
    try {
      const parsedUrl = new URL(whatsappUrl);
      valid = ["http:", "https:"].includes(parsedUrl.protocol);
    } catch (_error) {
      valid = false;
    }
  }

  return {
    label: POS_SUPPORT_LABEL || "Soporte",
    configured: valid,
    whatsappUrl: valid ? whatsappUrl : "",
    phoneConfigured: Boolean(phoneDigits),
    urlConfigured: Boolean(configuredUrl),
  };
}

function buildSupportHealthSemaphore({
  backupStatus,
  syncHealth,
  recentErrors,
  latestSale,
  counts,
  database,
  runtimeConfig,
  security,
  subscription,
}) {
  const result = {
    status: "ok",
    reasons: [],
    actions: [],
  };

  const lastBackupRun = backupStatus?.lastRun || null;
  if (backupStatus?.enabled) {
    if (!lastBackupRun) {
      pushSemaphoreIssue(
        result,
        "backup_missing",
        "Backups activos sin corrida registrada.",
        "Ejecutar o revisar el job de backup antes de cerrar instalacion.",
        "risk",
      );
    } else if (lastBackupRun.status === "failed") {
      pushSemaphoreIssue(
        result,
        "backup_failed",
        "El ultimo backup fallo.",
        "Revisar credenciales, destino de respaldo y descargar SQLite manual si el cliente esta en riesgo.",
        "critical",
      );
    } else if (lastBackupRun.status === "partial") {
      pushSemaphoreIssue(
        result,
        "backup_partial",
        "El ultimo backup quedo parcial.",
        "Resolver colas offline o reportes pendientes y repetir backup.",
        "risk",
      );
    }
  }

  if (syncHealth?.blockedReportCount > 0) {
    pushSemaphoreIssue(
      result,
      "sync_blocked",
      `${syncHealth.blockedReportCount} equipo(s) tienen cola offline bloqueada.`,
      "Abrir diagnostico offline y resolver el primer error de sincronizacion.",
      "critical",
    );
  } else if (syncHealth?.hasPending) {
    pushSemaphoreIssue(
      result,
      "sync_pending",
      "Hay ventas, abonos o eventos de caja pendientes de sincronizar.",
      "Mantener el dispositivo en linea y reintentar sync antes de backup/cierre.",
      "risk",
    );
  }

  if (Array.isArray(recentErrors) && recentErrors.length >= 5) {
    pushSemaphoreIssue(
      result,
      "many_recent_errors",
      `${recentErrors.length} errores recientes capturados.`,
      "Agrupar errores repetidos y cerrar la incidencia con responsable.",
      "critical",
    );
  } else if (Array.isArray(recentErrors) && recentErrors.length > 0) {
    pushSemaphoreIssue(
      result,
      "recent_errors",
      "Hay errores recientes capturados.",
      "Revisar el ultimo error antes de declarar sana la instancia.",
      "risk",
    );
  }

  if (subscription && ["suspended", "cancelled"].includes(subscription.effectiveStatus)) {
    pushSemaphoreIssue(
      result,
      "subscription_blocked",
      `Suscripcion en estado ${subscription.effectiveStatus}.`,
      "Confirmar pago o acuerdo comercial antes de dar soporte incluido.",
      "critical",
    );
  } else if (subscription?.overdue) {
    pushSemaphoreIssue(
      result,
      "subscription_overdue",
      subscription.inGrace
        ? "Suscripcion vencida dentro de periodo de gracia."
        : "Suscripcion vencida fuera de gracia.",
      "Registrar pago, ajustar fecha de corte o dejar nota comercial.",
      "risk",
    );
  }

  if (counts?.missingCostProducts > 0) {
    pushSemaphoreIssue(
      result,
      "missing_costs",
      `${counts.missingCostProducts} producto(s) activos sin costo.`,
      "Completar costos para que rentabilidad pueda justificar la mensualidad.",
      "risk",
    );
  }

  if (counts?.negativeStockProducts > 0) {
    pushSemaphoreIssue(
      result,
      "negative_stock",
      `${counts.negativeStockProducts} producto(s) con stock negativo.`,
      "Hacer conteo/correccion para evitar compras o margenes distorsionados.",
      "risk",
    );
  }

  if (!latestSale && Number(counts?.activeProducts || 0) > 0) {
    pushSemaphoreIssue(
      result,
      "no_sales",
      "No hay venta reciente registrada.",
      "Hacer venta de prueba o confirmar que el negocio aun no inicio operacion.",
      "risk",
    );
  }

  if (database?.bytes === 0) {
    pushSemaphoreIssue(
      result,
      "database_unreadable",
      "No pude leer el tamano de la base de datos.",
      "Verificar POS_DB_PATH y permisos del volumen.",
      "critical",
    );
  }

  if (runtimeConfig?.restartRequired) {
    const pendingKeys = Array.isArray(runtimeConfig.pendingRestartKeys) ? runtimeConfig.pendingRestartKeys : [];
    pushSemaphoreIssue(
      result,
      "runtime_restart_required",
      pendingKeys.length > 0
        ? `Hay variables runtime pendientes de reinicio: ${pendingKeys.join(", ")}.`
        : "Hay variables runtime pendientes de reinicio.",
      "Reiniciar el proceso Node para que el POS use la configuracion de arranque mas reciente.",
      "risk",
    );
  }

  if (security?.status && security.status !== "ok") {
    result.reasons.push(...security.reasons);
    result.actions.push(...security.actions);
  }

  if (result.reasons.some((reason) => reason.severity === "critical")) {
    result.status = "critical";
  } else if (result.reasons.length > 0) {
    result.status = "risk";
  }

  if (result.status === "ok") {
    result.reasons.push({
      code: "healthy",
      severity: "ok",
      message: "Ventas, respaldo, sync y suscripcion no muestran alertas inmediatas.",
    });
    result.actions.push({
      code: "keep_monitoring",
      severity: "ok",
      message: "Mantener monitoreo y registrar incidencias si aparece soporte.",
    });
  }

  return result;
}

function getSupportHealthReport(options = {}) {
  const branch = normalizeBranch(options.branch || ALL_BRANCHES, { allowAll: true });
  const backupStatus = getBackupStatusBundle();
  const packageInfo = require("../../package.json");
  const database = getDatabaseSize();
  const latestSale = getLatestSale(branch);
  const counts = getOperationalCounts(branch);
  const syncHealth = getClientSyncHealthSummary({ branch });
  const recentErrors = listAppErrorReports({ limit: Number(options.errorLimit || 10) });
  const runtimeSnapshot = getRuntimeConfigEditorSnapshot();
  const security = buildSecurityPosture();
  const subscription = getServiceSubscription();
  const supportContact = buildSupportContactSummary();

  return {
    branch,
    generatedAt: nowIso(),
    app: {
      name: packageInfo.name || "cremeria-rincon",
      version: packageInfo.version || "0.0.0",
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      printing: {
        mode: "browser",
        receiptWidthMm: 80,
        nativeDriverRequired: false,
      },
    },
    supportContact,
    database,
    latestSale,
    counts,
    backups: {
      enabled: backupStatus.enabled,
      processEnabled: backupStatus.processEnabled,
      restartRequired: backupStatus.restartRequired,
      storage: backupStatus.storage,
      lastRun: backupStatus.lastRun,
      recentRuns: backupStatus.recentRuns,
    },
    syncHealth,
    recentErrors,
    runtimeConfig: {
      loaded: Boolean(runtimeSnapshot.status?.loaded),
      sourcePath: runtimeSnapshot.status?.sourcePathRelative || runtimeSnapshot.status?.sourcePath || "",
      restartRequired: Boolean(runtimeSnapshot.status?.restartRequired),
      pendingRestartKeys: Array.isArray(runtimeSnapshot.status?.pendingRestartKeys)
        ? runtimeSnapshot.status.pendingRestartKeys
        : [],
      error: runtimeSnapshot.status?.error || "",
    },
    security,
    semaphore: buildSupportHealthSemaphore({
      backupStatus,
      syncHealth,
      recentErrors,
      latestSale,
      counts,
      database,
      runtimeConfig: runtimeSnapshot.status,
      security,
      subscription,
    }),
  };
}

module.exports = {
  buildSupportHealthSemaphore,
  getSupportHealthReport,
};
