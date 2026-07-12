const crypto = require("node:crypto");

const {
  CONTROL_CONFIG_SYNC_MAX_AGE_MS,
  CONTROL_CLIENT_SECRET,
  CONTROL_CLIENT_SLUG,
  CONTROL_SYNC_TIMEOUT_MS,
} = require("../config");
const { nowIso } = require("../db");
const { saveRuntimeConfigValues } = require("../runtimeConfig");
const { createHttpError, normalizeText } = require("../utils/helpers");
const {
  syncServiceSubscriptionPayments,
  syncServiceSubscriptionSnapshot,
} = require("./subscription");
const {
  getOwnerConsoleBundle,
  updateOwnerConsoleAccess,
} = require("./ownerConsole");
const { getSupportHealthReport } = require("./supportHealth");
const {
  getControlPlaneStatus,
  noteControlPlaneAttempt,
  noteControlPlaneFailure,
  noteControlPlaneSuccess,
  resolveControlPlaneConfiguration,
} = require("./controlPlaneStatus");

const DEFAULT_CONFIG_SYNC_MAX_AGE_MS = CONTROL_CONFIG_SYNC_MAX_AGE_MS;
const ownerConsoleConfigSyncState = {
  inFlight: null,
  lastSyncedAt: 0,
};

function buildSignedClientHeaders(method, pathname, body) {
  if (!CONTROL_CLIENT_SECRET) {
    return {};
  }
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = [
    String(method || "GET").toUpperCase(),
    String(pathname || ""),
    timestamp,
    nonce,
    String(body || ""),
  ].join("\n");
  return {
    "X-Client-Timestamp": timestamp,
    "X-Client-Nonce": nonce,
    "X-Client-Signature": crypto.createHmac("sha256", CONTROL_CLIENT_SECRET).update(payload).digest("hex"),
  };
}

function sameList(left, right) {
  const leftList = Array.isArray(left) ? left.slice().sort() : [];
  const rightList = Array.isArray(right) ? right.slice().sort() : [];
  return leftList.length === rightList.length && leftList.every((item, index) => item === rightList[index]);
}

function buildControlPlaneUrl(pathname) {
  const { status, baseUrl } = resolveControlPlaneConfiguration();
  if (!status.configured) {
    throw createHttpError(`Falta configurar ${status.missing.join(", ")} en el POS.`, 409);
  }
  if (!status.usable || !baseUrl) {
    throw createHttpError(status.error || "CONTROL_API_URL no es usable.", status.errorCode || 409);
  }
  return new URL(pathname, baseUrl).toString();
}

async function requestControlPlaneJson(pathname, options = {}) {
  const status = getControlPlaneStatus();
  if (!status.configured) {
    throw createHttpError(`Falta configurar ${status.missing.join(", ")} en el POS.`, 409);
  }
  if (!status.usable) {
    throw createHttpError(status.error || "CONTROL_API_URL no es usable.", status.errorCode || 409);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTROL_SYNC_TIMEOUT_MS);
  const method = options.method || "GET";
  const requestBody = options.body;
  noteControlPlaneAttempt();
  try {
    const response = await fetch(buildControlPlaneUrl(pathname), {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Slug": CONTROL_CLIENT_SLUG,
        Authorization: `Bearer ${CONTROL_CLIENT_SECRET}`,
        ...buildSignedClientHeaders(method, pathname, requestBody),
        ...(options.headers || {}),
      },
      body: requestBody,
      signal: controller.signal,
    });
    const text = await response.text();
    let responseBody = null;
    try {
      responseBody = text ? JSON.parse(text) : null;
    } catch (_error) {
      responseBody = { message: text };
    }
    if (!response.ok) {
      const httpError = createHttpError(
        responseBody?.message || `Owner-control respondio HTTP ${response.status}.`,
        response.status,
      );
      httpError.controlPlaneRecorded = true;
      noteControlPlaneFailure(httpError);
      throw httpError;
    }
    noteControlPlaneSuccess();
    return responseBody;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = createHttpError("Owner-control no respondio a tiempo.", 504);
      timeoutError.controlPlaneRecorded = true;
      noteControlPlaneFailure(timeoutError);
      throw timeoutError;
    }
    if (!error.controlPlaneRecorded) {
      noteControlPlaneFailure(error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRemoteRuntimeValues(input) {
  const values = input && typeof input === "object" && !Array.isArray(input)
    ? input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : input
    : {};
  return Object.entries(values).reduce((result, [key, value]) => {
    const safeKey = String(key || "").trim();
    if (!safeKey || value == null) {
      return result;
    }
    result[safeKey] = Array.isArray(value) ? value.join(",") : String(value);
    return result;
  }, {});
}

async function syncServiceSubscriptionFromControlPlane() {
  const response = await requestControlPlaneJson("/api/client/subscription");
  const remoteSubscription = response?.subscription;
  if (!remoteSubscription || typeof remoteSubscription !== "object") {
    throw createHttpError("Owner-control no regreso una suscripcion valida.", 502);
  }

  const syncedAt = nowIso();
  const subscription = syncServiceSubscriptionSnapshot({
    ...remoteSubscription,
    notes: normalizeText(
      `Sincronizado desde owner-control (${response?.client?.slug || CONTROL_CLIENT_SLUG}) el ${syncedAt}.`,
      1000,
    ),
  });
  const paymentsSync = syncServiceSubscriptionPayments(response?.payments || []);

  return {
    controlPlane: getControlPlaneStatus(),
    remoteSubscription,
    remotePayments: Array.isArray(response?.payments) ? response.payments : [],
    paymentsSync,
    subscription,
    syncedAt,
  };
}

async function syncOwnerConsoleConfigFromControlPlane() {
  const response = await requestControlPlaneJson("/api/client/config");
  const remoteConfig = response?.config;
  if (!remoteConfig || typeof remoteConfig !== "object") {
    throw createHttpError("Owner-control no regreso una configuracion POS valida.", 502);
  }
  if (!Array.isArray(remoteConfig.enabledModules) || !Array.isArray(remoteConfig.adminCapabilities)) {
    throw createHttpError("Owner-control regreso listas de configuracion incompletas.", 502);
  }

  const syncedAt = nowIso();
  const previousConsole = getOwnerConsoleBundle();
  const ownerConsole = updateOwnerConsoleAccess({
    enabledModules: remoteConfig.enabledModules,
    adminCapabilities: remoteConfig.adminCapabilities,
  });
  ownerConsoleConfigSyncState.lastSyncedAt = Date.now();
  const changed = !sameList(previousConsole.enabledModules, ownerConsole.enabledModules)
    || !sameList(previousConsole.adminCapabilities, ownerConsole.adminCapabilities);
  let configSyncReport = null;
  let configSyncReportError = null;
  try {
    configSyncReport = await requestControlPlaneJson("/api/client/config-sync", {
      method: "POST",
      body: JSON.stringify({
        status: "applied",
        enabledModules: ownerConsole.enabledModules,
        adminCapabilities: ownerConsole.adminCapabilities,
        reportedAt: syncedAt,
        message: changed
          ? "Configuracion aplicada por el POS y snapshot actualizado."
          : "Configuracion verificada por el POS; no hubo cambios locales.",
      }),
    });
  } catch (error) {
    configSyncReportError = error.message || "No pude reportar aplicacion de configuracion.";
  }

  return {
    changed,
    configSyncReport,
    configSyncReportError,
    controlPlane: getControlPlaneStatus(),
    remoteConfig,
    ownerConsole,
    syncedAt,
  };
}

async function syncRuntimeConfigFromControlPlane() {
  const response = await requestControlPlaneJson("/api/client/runtime-config");
  const remoteRuntimeConfig = response?.runtimeConfig;
  const remoteValues = normalizeRemoteRuntimeValues(remoteRuntimeConfig);
  if (!remoteRuntimeConfig || typeof remoteRuntimeConfig !== "object") {
    throw createHttpError("Owner-control no regreso variables runtime validas.", 502);
  }

  const syncedAt = nowIso();
  const saveResult = saveRuntimeConfigValues({
    values: remoteValues,
    clearKeys: Array.isArray(remoteRuntimeConfig.clearKeys) ? remoteRuntimeConfig.clearKeys : [],
    replaceManagedValues: true,
    preserveBlankSecrets: false,
    preservePairingKeys: true,
  });
  let runtimeConfigSyncReport = null;
  let runtimeConfigSyncReportError = null;
  try {
    runtimeConfigSyncReport = await requestControlPlaneJson("/api/client/runtime-config-sync", {
      method: "POST",
      body: JSON.stringify({
        status: "applied",
        keys: Object.keys(remoteValues).sort(),
        runtimeHash: remoteRuntimeConfig.runtimeHash || "",
        reportedAt: syncedAt,
        message: saveResult.updatedKeys.length || saveResult.clearedKeys.length
          ? saveResult.requiresRestart
            ? "Variables runtime aplicadas por el POS. Reinicio requerido para tomarlas en proceso."
            : "Variables runtime aplicadas por el POS y activas sin reinicio."
          : "Variables runtime verificadas por el POS; no hubo cambios locales.",
      }),
    });
  } catch (error) {
    runtimeConfigSyncReportError = error.message || "No pude reportar aplicacion de variables runtime.";
  }

  return {
    controlPlane: getControlPlaneStatus(),
    remoteRuntimeConfig: {
      ...remoteRuntimeConfig,
      values: undefined,
    },
    runtimeConfig: saveResult,
    runtimeConfigSyncReport,
    runtimeConfigSyncReportError,
    syncedAt,
    requiresRestart: Boolean(saveResult.requiresRestart),
  };
}

async function refreshControlPlaneConfigIfStale(options = {}) {
  const status = getControlPlaneStatus();
  if (!status.configured) {
    return {
      skipped: true,
      reason: "not_configured",
      controlPlane: status,
    };
  }

  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || DEFAULT_CONFIG_SYNC_MAX_AGE_MS));
  const ageMs = Date.now() - Number(ownerConsoleConfigSyncState.lastSyncedAt || 0);
  if (!options.force && ownerConsoleConfigSyncState.lastSyncedAt > 0 && ageMs < maxAgeMs) {
    return {
      skipped: true,
      reason: "fresh",
      ageMs,
      controlPlane: status,
    };
  }

  if (!ownerConsoleConfigSyncState.inFlight) {
    ownerConsoleConfigSyncState.inFlight = syncOwnerConsoleConfigFromControlPlane()
      .finally(() => {
        ownerConsoleConfigSyncState.inFlight = null;
      });
  }

  try {
    return await ownerConsoleConfigSyncState.inFlight;
  } catch (error) {
    if (options.silent) {
      return {
        skipped: true,
        reason: "sync_failed",
        message: error.message || "No pude sincronizar configuracion central.",
        controlPlane: status,
      };
    }
    throw error;
  }
}

async function reportSupportHealthToControlPlane(options = {}) {
  const branch = options.branch || "all";
  const health = getSupportHealthReport({ branch });
  const syncedAt = nowIso();
  const response = await requestControlPlaneJson("/api/client/health", {
    method: "POST",
    body: JSON.stringify({
      health,
      reportedAt: health.generatedAt || syncedAt,
    }),
  });

  return {
    controlPlane: getControlPlaneStatus(),
    health,
    remoteReport: response?.report || null,
    remoteClient: response?.client || null,
    syncedAt,
  };
}

module.exports = {
  getControlPlaneStatus,
  reportSupportHealthToControlPlane,
  refreshControlPlaneConfigIfStale,
  syncOwnerConsoleConfigFromControlPlane,
  syncRuntimeConfigFromControlPlane,
  syncServiceSubscriptionFromControlPlane,
};
