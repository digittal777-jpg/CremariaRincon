const {
  CONTROL_API_URL,
  CONTROL_CLIENT_SECRET,
  CONTROL_CLIENT_SLUG,
} = require("../config");

const controlPlaneRuntimeState = {
  lastAttemptAt: "",
  lastSuccessAt: "",
  lastErrorAt: "",
  lastError: "",
  lastErrorCode: 0,
};

function normalizeControlHostname(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackControlHost(hostname) {
  const host = normalizeControlHostname(hostname);
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || host === "0.0.0.0"
    || host.startsWith("127.");
}

function resolveControlPlaneConfiguration() {
  const missing = [];
  if (!CONTROL_API_URL) missing.push("CONTROL_API_URL");
  if (!CONTROL_CLIENT_SLUG) missing.push("CONTROL_CLIENT_SLUG");
  if (!CONTROL_CLIENT_SECRET) missing.push("CONTROL_CLIENT_SECRET");
  let baseUrl = null;
  let error = "";
  let errorCode = 0;

  if (CONTROL_API_URL) {
    try {
      baseUrl = new URL(`${CONTROL_API_URL}/`);
      if (baseUrl.protocol !== "https:" && !isLoopbackControlHost(baseUrl.hostname)) {
        error = "CONTROL_API_URL debe usar HTTPS fuera de localhost para no exponer secretos.";
        errorCode = 409;
      }
    } catch (_error) {
      error = "CONTROL_API_URL no es una URL valida.";
      errorCode = 400;
    }
  }

  return {
    baseUrl,
    status: {
      configured: missing.length === 0,
      usable: missing.length === 0 && !error,
      apiUrl: CONTROL_API_URL || "",
      normalizedApiUrl: baseUrl ? baseUrl.origin : "",
      clientSlug: CONTROL_CLIENT_SLUG || "",
      missing,
      error,
      errorCode,
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeControlPlaneErrorCode(error, fallback = 0) {
  const rawCode = Number(error?.statusCode || error?.status || fallback || 0);
  return Number.isFinite(rawCode) && rawCode >= 0 ? rawCode : 0;
}

function noteControlPlaneAttempt(at = nowIso()) {
  controlPlaneRuntimeState.lastAttemptAt = at;
}

function noteControlPlaneSuccess(at = nowIso()) {
  controlPlaneRuntimeState.lastAttemptAt = controlPlaneRuntimeState.lastAttemptAt || at;
  controlPlaneRuntimeState.lastSuccessAt = at;
}

function noteControlPlaneFailure(error, at = nowIso()) {
  controlPlaneRuntimeState.lastAttemptAt = controlPlaneRuntimeState.lastAttemptAt || at;
  controlPlaneRuntimeState.lastErrorAt = at;
  controlPlaneRuntimeState.lastError = String(error?.message || error || "Owner-control no disponible.").trim();
  controlPlaneRuntimeState.lastErrorCode = normalizeControlPlaneErrorCode(error);
}

function getControlPlaneRuntimeStatus() {
  const lastSuccessAt = controlPlaneRuntimeState.lastSuccessAt || "";
  const lastErrorAt = controlPlaneRuntimeState.lastErrorAt || "";
  const degraded = Boolean(lastErrorAt && (!lastSuccessAt || lastErrorAt >= lastSuccessAt));
  const runtimeStatus = degraded
    ? "failed"
    : lastSuccessAt
      ? "ok"
      : "unknown";

  return {
    runtimeStatus,
    degraded,
    authFailed: degraded && [401, 403].includes(Number(controlPlaneRuntimeState.lastErrorCode || 0)),
    lastAttemptAt: controlPlaneRuntimeState.lastAttemptAt || "",
    lastSuccessAt,
    lastErrorAt,
    lastError: controlPlaneRuntimeState.lastError || "",
    lastErrorCode: Number(controlPlaneRuntimeState.lastErrorCode || 0),
  };
}

function getControlPlaneStatus() {
  return {
    ...resolveControlPlaneConfiguration().status,
    ...getControlPlaneRuntimeStatus(),
  };
}

module.exports = {
  getControlPlaneStatus,
  isLoopbackControlHost,
  noteControlPlaneAttempt,
  noteControlPlaneFailure,
  noteControlPlaneSuccess,
  resolveControlPlaneConfiguration,
};
