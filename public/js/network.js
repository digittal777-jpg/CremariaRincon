// Funciones de red y comunicacion con el servidor

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const CASHIER_REQUEST_TIMEOUT_MS = 6000;
const ADMIN_REQUEST_TIMEOUT_MS = 10000;
const AUTH_STATUS_TIMEOUT_MS = 4000;
const CLIENT_ERROR_DUPLICATE_WINDOW_MS = 30000;
const recentClientErrorReports = new Map();

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createTimeoutError(timeoutMs) {
  const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  const error = new Error(`Tiempo de espera agotado al conectar con el servidor (${timeoutSeconds}s).`);
  error.name = "AbortError";
  error.isTimeout = true;
  return error;
}

function normalizeClientErrorReason(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message || reason.name || "Error frontend",
      stack: reason.stack || "",
    };
  }

  if (reason && typeof reason === "object") {
    return {
      message: String(reason.message || reason.statusText || "Error frontend"),
      stack: String(reason.stack || ""),
    };
  }

  return {
    message: String(reason || "Error frontend"),
    stack: "",
  };
}

function reportClientError(payload = {}) {
  if (typeof fetch !== "function") {
    return;
  }
  if (String(payload.url || "").includes("/api/client-errors")) {
    return;
  }

  const message = String(payload.message || "Error frontend").slice(0, 600);
  const signature = [
    message,
    payload.url || "",
    payload.statusCode || "",
  ].join("|");
  const now = Date.now();
  const previousAt = recentClientErrorReports.get(signature) || 0;
  if (now - previousAt < CLIENT_ERROR_DUPLICATE_WINDOW_MS) {
    return;
  }
  recentClientErrorReports.set(signature, now);

  const branch = typeof getActiveCashierBranch === "function"
    ? getActiveCashierBranch()
    : state.store?.currentBranch || "";
  const currentUrl = typeof window !== "undefined" && window.location
    ? window.location.href
    : "";
  const userAgent = typeof navigator !== "undefined"
    ? navigator.userAgent || ""
    : "";
  const body = JSON.stringify({
    source: "frontend",
    level: payload.level || "error",
    message,
    stack: String(payload.stack || "").slice(0, 2000),
    url: String(payload.url || currentUrl).slice(0, 500),
    method: payload.method || "",
    statusCode: payload.statusCode || null,
    role: state.cashier?.authenticated
      ? "cashier"
      : state.admin?.authenticated
        ? "admin"
        : state.owner?.authenticated
          ? "owner"
          : "guest",
    branch,
    userAgent,
    context: payload.context || null,
  });

  fetch("/api/client-errors", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
    },
    body,
  }).catch(() => {});
}

function createRequestController(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutId = null;
  let timedOut = false;
  let removeExternalAbortListener = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const onExternalAbort = () => {
        controller.abort(externalSignal.reason);
      };
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      removeExternalAbortListener = () => {
        externalSignal.removeEventListener("abort", onExternalAbort);
      };
    }
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    didTimeout() {
      return timedOut;
    },
    cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (removeExternalAbortListener) {
        removeExternalAbortListener();
      }
    },
  };
}

function markConnectionOffline() {
  state.online = false;
  if (refs.socketStatus) {
    refs.socketStatus.textContent = "Sin conexion";
  }
  renderSyncStatus();
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    scheduleConnectionRecovery("network-error");
  }
}

async function performJsonRequest(url, options = {}) {
  const {
    timeoutMs,
    timeout,
    retries,
    retryDelayMs,
    signal,
    headers,
    ...fetchOptions
  } = options;
  const effectiveTimeoutMs = Number(timeoutMs || timeout || DEFAULT_REQUEST_TIMEOUT_MS);
  const totalRetries = Math.max(0, Number(retries || 0));
  const baseRetryDelayMs = Math.max(150, Number(retryDelayMs || 350));
  const requestMethod = String(fetchOptions.method || "GET").toUpperCase();

  for (let attempt = 0; attempt <= totalRetries; attempt += 1) {
    const requestController = createRequestController(signal, effectiveTimeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: requestController.signal,
        credentials: fetchOptions.credentials || "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(headers || {}),
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(data.message || "No fue posible completar la accion.");
        error.statusCode = response.status;
        if (typeof data.code === "string" && data.code) {
          error.code = data.code;
        }
        if (Array.isArray(data.warnings)) {
          error.warnings = data.warnings;
        }
        if (response.status >= 500) {
          reportClientError({
            message: error.message,
            url,
            method: requestMethod,
            statusCode: response.status,
            context: {
              code: error.code || "",
            },
          });
        }
        throw error;
      }

      return data;
    } catch (error) {
      const normalizedError = requestController.didTimeout()
        ? createTimeoutError(effectiveTimeoutMs)
        : error;

      if (isNetworkError(normalizedError)) {
        markConnectionOffline();
      }

      const canRetry =
        attempt < totalRetries
        && requestMethod === "GET"
        && isNetworkError(normalizedError);

      if (!canRetry) {
        throw normalizedError;
      }

      await delay(baseRetryDelayMs * (attempt + 1));
    } finally {
      requestController.cleanup();
    }
  }
}

function isNetworkError(error) {
  return error instanceof TypeError || error?.name === "AbortError";
}

function isAdminSessionFailure(error) {
  if (!error) {
    return false;
  }

  if (error.statusCode === 401) {
    return true;
  }

  if (error.statusCode !== 403) {
    return false;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("sesion admin") || message.includes("validacion de seguridad");
}

function getAdminAuthHeaders() {
  return {
    ...(state.admin.username ? { "x-admin-user": state.admin.username } : {}),
    ...(state.admin.csrfToken ? { "x-csrf-token": state.admin.csrfToken } : {}),
  };
}

function getCashierAuthHeaders(token = state.cashier.token) {
  return token
    ? {
        "x-cashier-token": token,
      }
    : {};
}

function getCashierTokenFromHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return "";
  }

  const match = Object.entries(headers).find(([headerName, headerValue]) =>
    String(headerName || "").toLowerCase() === "x-cashier-token"
    && String(headerValue || "").trim(),
  );
  return match ? String(match[1] || "").trim() : "";
}

function stripSensitiveQueuedHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  return Object.entries(headers).reduce((result, [headerName, headerValue]) => {
    const normalizedHeaderName = String(headerName || "").toLowerCase();
    if (normalizedHeaderName === "x-cashier-token") {
      return result;
    }
    result[headerName] = headerValue;
    return result;
  }, {});
}

function shouldInvalidateCurrentCashierSessionForAuthFailure(headers = {}) {
  const currentToken = String(state.cashier.token || "").trim();
  if (!currentToken) {
    return false;
  }

  const failingToken = getCashierTokenFromHeaders(headers);
  if (!failingToken) {
    return true;
  }

  return failingToken === currentToken;
}

function handleCashierSessionAuthFailure(options = {}) {
  if (!shouldInvalidateCurrentCashierSessionForAuthFailure(options.headers || {})) {
    return false;
  }

  if (typeof clearCashierSessionState === "function") {
    clearCashierSessionState();
  }
  if (typeof sanitizeAfterCashierSessionLoss === "function") {
    sanitizeAfterCashierSessionLoss();
  }
  if (typeof clearReceivablesSessionChange === "function") {
    clearReceivablesSessionChange();
  }
  if (typeof renderCashierSession === "function") {
    renderCashierSession();
  }
  return true;
}

function buildClientRandomId(prefix = "client") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `${prefix}-${Date.now()}-${values[0].toString(16)}${values[1].toString(16)}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function buildQueuedOperationId() {
  return buildClientRandomId("queue");
}

function inferQueuedOperationKind(operation = {}) {
  const method = String(operation.method || "GET").toUpperCase();
  if (operation.url === "/api/sales" && method === "POST") {
    return "sale";
  }
  if (operation.url === "/api/receivables/payments" && method === "POST") {
    return "receivable_payment";
  }

  return "request";
}

function normalizeQueuedOperation(operation = {}) {
  const normalized = {
    id: buildQueuedOperationId(),
    kind: "request",
    queuedAt: new Date().toISOString(),
    headers: {},
    syncAttempts: 0,
    syncBlocked: false,
    lastSyncAttemptAt: null,
    lastSyncError: "",
    lastSyncErrorCode: null,
    ...operation,
  };

  normalized.headers =
    normalized.headers && typeof normalized.headers === "object"
      ? stripSensitiveQueuedHeaders(normalized.headers)
      : {};
  normalized.syncAttempts = Math.max(0, Number(normalized.syncAttempts || 0));
  normalized.syncBlocked = Boolean(normalized.syncBlocked);
  normalized.lastSyncAttemptAt = normalized.lastSyncAttemptAt || null;
  normalized.lastSyncError = String(normalized.lastSyncError || "");
  normalized.lastSyncErrorCode = Number.isFinite(Number(normalized.lastSyncErrorCode))
    ? Number(normalized.lastSyncErrorCode)
    : null;
  normalized.kind = inferQueuedOperationKind(normalized);

  return normalized;
}

function getBlockedPendingOperationCount() {
  return state.pendingQueue.filter((operation) => Boolean(operation?.syncBlocked)).length;
}

function getFirstBlockedPendingOperation() {
  return state.pendingQueue.find((operation) => Boolean(operation?.syncBlocked)) || null;
}

let syncHealthReportTimerId = null;
let lastSyncHealthSignature = "";
let connectionRecoveryTimerId = null;
let connectionRecoveryAttempt = 0;
let connectionRecoveryPromise = null;
let hiddenSocketPauseTimerId = null;
let socketPausedForHiddenTab = false;
const CONNECTION_RECOVERY_BASE_DELAY_MS = 2500;
const CONNECTION_RECOVERY_MAX_DELAY_MS = 15000;
const SOCKET_HIDDEN_IDLE_DISCONNECT_MS = 2 * 60 * 1000;

function getClientSyncHealthHeaders() {
  return {
    ...getCashierAuthHeaders(),
    ...getAdminAuthHeaders(),
    ...getOwnerAuthHeaders(),
  };
}

function getLocalDeviceId() {
  let deviceId = typeof readStorageText === "function"
    ? readStorageText(STORAGE_KEYS.deviceId, "")
    : "";
  if (deviceId) {
    return deviceId;
  }

  deviceId = buildClientRandomId("device");
  if (typeof persistText === "function") {
    persistText(STORAGE_KEYS.deviceId, deviceId);
  }

  return deviceId;
}

function buildClientSyncHealthPayload() {
  return {
    deviceId: getLocalDeviceId(),
    branch: state.cashier.branch || state.store.currentBranch || refs.branchSelect?.value || "carrizal",
    pendingQueueCount: state.pendingQueue.length,
    blockedQueueCount: getBlockedPendingOperationCount(),
    registerEventsCount: state.register.events.filter((event) => !event?.synced).length,
    online: state.online,
  };
}

async function reportClientSyncHealth(options = {}) {
  const hasSession =
    Boolean(state.cashier.token)
    || Boolean(state.admin.authenticated && state.admin.csrfToken)
    || Boolean(state.owner.authenticated && state.owner.csrfToken);
  if (!state.online || !hasSession) {
    return null;
  }

  const payload = buildClientSyncHealthPayload();
  const signature = JSON.stringify(payload);
  if (!options.force && signature === lastSyncHealthSignature) {
    return null;
  }

  try {
    await performJsonRequest("/api/client-sync-health", {
      method: "POST",
      timeoutMs: 4000,
      headers: getClientSyncHealthHeaders(),
      body: JSON.stringify(payload),
    });
    lastSyncHealthSignature = signature;
  } catch (error) {
    if (isNetworkError(error) || error.statusCode === 401 || error.statusCode === 403) {
      return null;
    }
    throw error;
  }

  return payload;
}

function scheduleClientSyncHealthReport(options = {}) {
  if (syncHealthReportTimerId) {
    window.clearTimeout(syncHealthReportTimerId);
    syncHealthReportTimerId = null;
  }

  const delayMs = Math.max(0, Number(options.delayMs ?? 350));
  syncHealthReportTimerId = window.setTimeout(() => {
    syncHealthReportTimerId = null;
    void reportClientSyncHealth({ force: options.force === true }).catch(() => {});
  }, delayMs);
}

function clearConnectionRecoveryTimer() {
  if (!connectionRecoveryTimerId || typeof window === "undefined") {
    return;
  }

  window.clearTimeout(connectionRecoveryTimerId);
  connectionRecoveryTimerId = null;
}

function resetConnectionRecoveryState() {
  clearConnectionRecoveryTimer();
  connectionRecoveryAttempt = 0;
}

function clearHiddenSocketPauseTimer() {
  if (!hiddenSocketPauseTimerId || typeof window === "undefined") {
    return;
  }

  window.clearTimeout(hiddenSocketPauseTimerId);
  hiddenSocketPauseTimerId = null;
}

function isDocumentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function hasPendingOfflineWork() {
  return state.pendingQueue.length > 0 || state.register.events.some((event) => !event?.synced);
}

function scheduleHiddenSocketPause() {
  if (
    typeof window === "undefined"
    || !isDocumentHidden()
    || !state.socket?.connected
    || hasPendingOfflineWork()
  ) {
    return;
  }

  clearHiddenSocketPauseTimer();
  hiddenSocketPauseTimerId = window.setTimeout(() => {
    hiddenSocketPauseTimerId = null;
    if (!isDocumentHidden() || !state.socket?.connected || hasPendingOfflineWork()) {
      return;
    }

    socketPausedForHiddenTab = true;
    state.socket.disconnect();
    if (refs.socketStatus) {
      refs.socketStatus.textContent = "Pausado";
    }
  }, SOCKET_HIDDEN_IDLE_DISCONNECT_MS);
}

function resumeHiddenSocketPause(reason = "visibility-change") {
  clearHiddenSocketPauseTimer();
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return;
  }

  if (socketPausedForHiddenTab || !state.socket?.connected) {
    socketPausedForHiddenTab = false;
    scheduleConnectionRecovery(reason, { immediate: true });
  }
}

function scheduleConnectionRecovery(reason = "retry", options = {}) {
  if (typeof window === "undefined") {
    return;
  }

  if (connectionRecoveryPromise) {
    return;
  }

  clearConnectionRecoveryTimer();
  const delayMs = options.immediate === true
    ? 0
    : Math.min(
        CONNECTION_RECOVERY_MAX_DELAY_MS,
        CONNECTION_RECOVERY_BASE_DELAY_MS * Math.max(1, connectionRecoveryAttempt || 1),
      );

  connectionRecoveryTimerId = window.setTimeout(() => {
    connectionRecoveryTimerId = null;
    void attemptConnectionRecovery(reason).catch(() => {});
  }, delayMs);
}

async function refreshRecoveredSessionData() {
  if (state.pendingQueue.length > 0 || state.register.events.length > 0) {
    await syncAllOfflineData();
    return;
  }

  await refreshCurrentSnapshot();
  if (state.cashier.authenticated && typeof loadRegisterSummary === "function") {
    await loadRegisterSummary({ silent: true });
  }
}

async function attemptConnectionRecovery(reason = "retry") {
  if (connectionRecoveryPromise) {
    return connectionRecoveryPromise;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    markConnectionOffline();
    return false;
  }

  connectionRecoveryAttempt += 1;
  if (refs.socketStatus && refs.socketStatus.textContent !== "En vivo") {
    refs.socketStatus.textContent = "Reconectando...";
  }

  connectionRecoveryPromise = (async () => {
    try {
      if (state.socket && typeof state.socket.connect === "function" && !state.socket.connected) {
        state.socket.connect();
      }

      await performJsonRequest("/api/health", {
        timeoutMs: 5000,
        retries: 1,
        retryDelayMs: 500,
      });

      state.online = true;
      renderSyncStatus();

      if (state.cashier.token) {
        try {
          await loadCashierAuthStatus();
        } catch (error) {
          if (isNetworkError(error)) {
            throw error;
          }
        }
      }

      try {
        await refreshRecoveredSessionData();
      } catch (error) {
        if (isNetworkError(error)) {
          throw error;
        }
      }

      if (typeof renderCashierSession === "function") {
        renderCashierSession();
      }
      if (refs.socketStatus && refs.socketStatus.textContent !== "En vivo") {
        refs.socketStatus.textContent = state.socket?.connected ? "En vivo" : "Conectado";
      }
      connectionRecoveryAttempt = 0;
      clearConnectionRecoveryTimer();
      return true;
    } catch (error) {
      if (isNetworkError(error)) {
        markConnectionOffline();
        return false;
      }

      state.online = true;
      renderSyncStatus();
      if (typeof renderCashierSession === "function") {
        renderCashierSession();
      }
      if (refs.socketStatus && refs.socketStatus.textContent === "Reconectando...") {
        refs.socketStatus.textContent = state.socket?.connected ? "En vivo" : "Conectado";
      }
      connectionRecoveryAttempt = 0;
      clearConnectionRecoveryTimer();
      return false;
    } finally {
      connectionRecoveryPromise = null;
    }
  })();

  return connectionRecoveryPromise;
}

async function requestJson(url, options = {}) {
  if (options.queueable && !state.online) {
    const queuedOperation = enqueueOperation({
      url,
      method: options.method || "GET",
      body: options.body || null,
      headers: options.headers || {},
    });
    const queuedError = new Error("Operacion guardada en modo offline. Se sincronizara al reconectar.");
    queuedError.queuedOperationId = queuedOperation?.id || "";
    throw queuedError;
  }

  try {
    return await performJsonRequest(url, options);
  } catch (error) {
    if (options.queueable && isNetworkError(error)) {
      const queuedOperation = enqueueOperation({
        url,
        method: options.method || "GET",
        body: options.body || null,
        headers: options.headers || {},
      });
      const queuedError = new Error("Operacion guardada en modo offline. Se sincronizara al reconectar.");
      queuedError.queuedOperationId = queuedOperation?.id || "";
      throw queuedError;
    }

    throw error;
  }
}

async function requestCashierJson(url, options = {}) {
  try {
    return await requestJson(url, {
      timeout: options.timeout ?? options.timeoutMs ?? CASHIER_REQUEST_TIMEOUT_MS,
      ...options,
      headers: {
        ...getCashierAuthHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      handleCashierSessionAuthFailure({
        headers: {
          ...getCashierAuthHeaders(),
          ...(options.headers || {}),
        },
      });
      throw new Error("La sesion del cajero vencio. Vuelve a iniciar sesion.");
    }

    throw error;
  }
}

function handleAdminSessionFailure(error) {
  if (!isAdminSessionFailure(error)) {
    return false;
  }

  state.admin.authenticated = false;
  state.admin.csrfToken = "";
  state.admin.sessionExpiresAt = null;
  if (typeof resetAdminSensitiveWorkspaceData === "function") {
    resetAdminSensitiveWorkspaceData();
  } else {
    state.admin.capabilitiesResolved = false;
  }
  if (!state.owner.authenticated) {
    state.adminCapabilities = [];
    if (typeof updateModuleVisibility === "function") {
      updateModuleVisibility();
    }
  }
  if (typeof closeAdminModal === "function") {
    closeAdminModal();
  }
  if (typeof renderAdminModal === "function") {
    renderAdminModal();
  }
  if (typeof handleApprovalsMobileAdminSessionLoss === "function") {
    handleApprovalsMobileAdminSessionLoss();
  }
  return true;
}

async function requestAdminJson(url, options = {}) {
  try {
    return await performJsonRequest(url, {
      timeout: options.timeout ?? options.timeoutMs ?? ADMIN_REQUEST_TIMEOUT_MS,
      ...options,
      headers: {
        ...getAdminAuthHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    handleAdminSessionFailure(error);
    throw error;
  }
}

async function loadAdminAuthStatus() {
  const response = await performJsonRequest("/api/admin/auth/status", {
    timeout: AUTH_STATUS_TIMEOUT_MS,
    headers: getAdminAuthHeaders(),
  });
  state.admin.configured = Boolean(response.configured);
  state.admin.setupAllowed = Boolean(response.setupAllowed);
  state.admin.username = String(response.username || state.admin.username || "admin");
  state.admin.authenticated = Boolean(response.authenticated);
  state.admin.csrfToken = state.admin.authenticated ? String(response.csrfToken || "") : "";
  state.admin.sessionExpiresAt = response.sessionExpiresAt || null;
  if (!state.admin.authenticated && !state.owner.authenticated) {
    state.admin.capabilitiesResolved = false;
  }
  if (state.online) {
    scheduleClientSyncHealthReport({ force: true, delayMs: 0 });
  }
  return response;
}

function getOwnerAuthHeaders() {
  return state.owner.authenticated && state.owner.csrfToken
    ? { "X-CSRF-Token": state.owner.csrfToken }
    : {};
}

async function requestOwnerJson(url, options = {}) {
  try {
    return await performJsonRequest(url, {
      timeout: options.timeout ?? options.timeoutMs ?? ADMIN_REQUEST_TIMEOUT_MS,
      ...options,
      headers: {
        ...getOwnerAuthHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      state.owner.authenticated = false;
      state.owner.csrfToken = "";
      state.owner.sessionExpiresAt = null;
      state.owner.accessLoaded = false;
      if (!state.admin.authenticated) {
        state.admin.capabilitiesResolved = false;
        state.adminCapabilities = [];
        if (typeof updateModuleVisibility === "function") {
          updateModuleVisibility();
        }
      }
      if (typeof closeOwnerConsoleModal === "function") {
        closeOwnerConsoleModal();
      }
      if (typeof closeOwnerAuthModal === "function") {
        closeOwnerAuthModal();
      }
    }

    throw error;
  }
}

async function loadOwnerAuthStatus() {
  const response = await performJsonRequest("/api/owner/auth/status", {
    timeout: AUTH_STATUS_TIMEOUT_MS,
    headers: getOwnerAuthHeaders(),
  });
  state.owner.configured = Boolean(response.configured);
  state.owner.setupAllowed = Boolean(response.setupAllowed);
  state.owner.username = String(response.username || state.owner.username || "owner");
  state.owner.authenticated = Boolean(response.authenticated);
  state.owner.csrfToken = state.owner.authenticated ? String(response.csrfToken || "") : "";
  state.owner.sessionExpiresAt = response.sessionExpiresAt || null;
  if (!state.owner.authenticated && !state.admin.authenticated) {
    state.admin.capabilitiesResolved = false;
  }
  if (state.online) {
    scheduleClientSyncHealthReport({ force: true, delayMs: 0 });
  }
  return response;
}

async function loadCashierAuthStatus() {
  const response = await performJsonRequest("/api/cashier/auth/status", {
    timeout: AUTH_STATUS_TIMEOUT_MS,
    headers: getCashierAuthHeaders(),
  });

  if (response.authenticated && response.cashier) {
    state.cashier.id = Number(response.cashier.id || 0) || null;
    state.cashier.name = String(response.cashier.name || "");
    state.cashier.branch = String(response.cashier.branch || "");
    state.cashier.expiresAt = String(response.expiresAt || "");
    state.cashier.authenticated = Boolean(
      state.cashier.token
      && state.cashier.name
      && state.cashier.branch,
    );
    persistCashierSession();
    if (typeof renderCashierSession === "function") {
      renderCashierSession();
    }
    if (state.online) {
      scheduleClientSyncHealthReport({ force: true, delayMs: 0 });
    }
    return response;
  }

  if (typeof clearCashierSessionState === "function") {
    clearCashierSessionState();
  } else {
    state.cashier.id = null;
    state.cashier.token = "";
    state.cashier.name = "";
    state.cashier.branch = "";
    state.cashier.expiresAt = "";
    state.cashier.authenticated = false;
    persistCashierSession();
  }
  if (typeof sanitizeAfterCashierSessionLoss === "function") {
    sanitizeAfterCashierSessionLoss();
  }
  if (typeof renderCashierSession === "function") {
    renderCashierSession();
  }
  if (state.online) {
    scheduleClientSyncHealthReport({ force: true, delayMs: 0 });
  }
  return response;
}

function enqueueOperation(operation) {
  const normalizedOperation = normalizeQueuedOperation(operation);
  state.pendingQueue.push(normalizedOperation);
  saveQueue();
  renderSyncStatus();
  return normalizedOperation;
}

function getQueuedSalePayload(operation = {}) {
  if (String(operation?.url || "") !== "/api/sales") {
    return null;
  }

  try {
    return JSON.parse(operation.body || "{}");
  } catch (_error) {
    return null;
  }
}

function getQueuedSaleClientSaleId(operation = {}) {
  return String(getQueuedSalePayload(operation)?.clientSaleId || "").trim();
}

function getQueuedSaleOperationIndexByClientSaleId(clientSaleId) {
  const safeClientSaleId = String(clientSaleId || "").trim();
  if (!safeClientSaleId) {
    return -1;
  }

  return state.pendingQueue.findIndex((operation) =>
    getQueuedSaleClientSaleId(operation) === safeClientSaleId,
  );
}

function getQueuedReceivablePaymentPayload(operation = {}) {
  if (String(operation?.url || "") !== "/api/receivables/payments") {
    return null;
  }

  try {
    return JSON.parse(operation.body || "{}");
  } catch (_error) {
    return null;
  }
}

function getQueuedReceivablePaymentClientPaymentId(operation = {}) {
  return String(getQueuedReceivablePaymentPayload(operation)?.clientPaymentId || "").trim();
}

function getQueuedOperationBranch(operation = {}) {
  const directBranch = String(operation?.branch || "").trim().toLowerCase();
  if (directBranch) {
    return directBranch;
  }

  try {
    const payload = JSON.parse(operation.body || "{}");
    return String(payload?.branch || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getPendingQueueBranchScope() {
  return (Array.isArray(state.pendingQueue) ? state.pendingQueue : []).reduce(
    (scope, operation) => {
      const branch = getQueuedOperationBranch(operation);
      if (branch) {
        scope.branches.add(branch);
      } else {
        scope.hasUnknownBranch = true;
      }
      return scope;
    },
    { branches: new Set(), hasUnknownBranch: false },
  );
}

function resolveQueuedReceivablePaymentPayload(operation = {}) {
  const payload = getQueuedReceivablePaymentPayload(operation);
  if (!payload) {
    return { payload: null, dependencyWaiting: false, dependencyMissing: false };
  }

  const linkedClientSaleId = String(payload.linkedClientSaleId || "").trim();
  if (!linkedClientSaleId) {
    return {
      payload,
      dependencyWaiting: false,
      dependencyMissing: false,
    };
  }

  const linkedSaleRecord = getOfflineSaleRecordByClientSaleId(linkedClientSaleId);
  if (!linkedSaleRecord) {
    return {
      payload,
      dependencyWaiting: false,
      dependencyMissing: true,
      linkedSaleRecord: null,
    };
  }

  const resolvedSaleId = Number(linkedSaleRecord.syncedSaleId || payload.saleId || 0) || null;
  if (!resolvedSaleId) {
    return {
      payload,
      dependencyWaiting: true,
      dependencyMissing: false,
      linkedSaleRecord,
    };
  }

  return {
    payload: {
      ...payload,
      saleId: resolvedSaleId,
    },
    dependencyWaiting: false,
    dependencyMissing: false,
    linkedSaleRecord,
  };
}

function classifyOfflineSaleReviewReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (
    message.includes("stock")
    || message.includes("disponible")
    || message.includes("agot")
    || message.includes("corte final")
    || message.includes("producto")
    || message.includes("sucursal")
    || message.includes("cajero")
  ) {
    return "stock_conflict";
  }

  return "sync_error";
}

function classifyOfflineReceivablePaymentReviewReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (
    message.includes("saldo")
    || message.includes("fiado")
    || message.includes("ticket")
    || message.includes("abono")
    || message.includes("corte final")
    || message.includes("sucursal")
    || message.includes("cajero")
  ) {
    return "payment_conflict";
  }

  return "sync_error";
}

function renderSyncStatus() {
  if (state.online) {
    scheduleClientSyncHealthReport();
  }

  if (refs.networkStatus) {
    refs.networkStatus.textContent = state.online ? "En linea" : "Offline";
  }

  if (typeof renderApprovalsMobileView === "function") {
    renderApprovalsMobileView();
  }

  if (!refs.syncStatus) {
    return;
  }

  const syncStatusTarget = refs.syncStatusButton || refs.syncStatus;

  if (state.syncingQueue) {
    refs.syncStatus.textContent = `Sincronizando ${state.pendingQueue.length}`;
    syncStatusTarget.title = "Sincronizando operaciones offline pendientes.";
    return;
  }

  const blockedCount = getBlockedPendingOperationCount();
  const offlineOperationSummary = typeof getOfflineOperationStatusSummary === "function"
    ? getOfflineOperationStatusSummary()
    : {
        pending: 0,
        requiresReview: 0,
        synced: 0,
        rejected: 0,
        outstanding: state.pendingQueue.length,
        sales: {
          pending: 0,
          requiresReview: 0,
          synced: 0,
          rejected: 0,
          outstanding: state.pendingQueue.length,
        },
        receivablePayments: {
          pending: 0,
          requiresReview: 0,
          synced: 0,
          rejected: 0,
          outstanding: 0,
        },
      };
  const pendingOperationsCount = Math.max(
    0,
    Number(offlineOperationSummary.outstanding || state.pendingQueue.length || 0),
  );
  let pendingSalesCount = Math.max(
    0,
    Number(offlineOperationSummary.sales?.outstanding || 0),
  );
  const pendingPaymentCount = Math.max(
    0,
    Number(offlineOperationSummary.receivablePayments?.outstanding || 0),
  );
  const pendingLabel = pendingPaymentCount > 0 && pendingSalesCount > 0
    ? "pendientes"
    : pendingPaymentCount > 0
      ? "abonos pendientes"
      : "ventas pendientes";
  pendingSalesCount = pendingOperationsCount;
  const needsCashierReauth = Boolean(
    state.online
    && pendingOperationsCount > 0
    && (!state.cashier.authenticated || !state.cashier.token),
  );
  const reviewCount = Math.max(blockedCount, offlineOperationSummary.requiresReview);
  if (reviewCount > 0) {
    const firstBlockedOperation = typeof getFirstBlockedPendingOperation === "function"
      ? getFirstBlockedPendingOperation()
      : null;
    const firstBlockedReason = String(firstBlockedOperation?.lastSyncError || "").trim();
    refs.syncStatus.textContent = reviewCount === 1
      ? "1 operacion requiere revision"
      : `${reviewCount} operaciones requieren revision`;
    syncStatusTarget.title = firstBlockedReason
      ? `Toca para revisar el registro local. Causa: ${firstBlockedReason}`
      : "Toca para revisar el registro local de operaciones offline.";
    return;
  }

  refs.syncStatus.textContent = pendingOperationsCount > 0
    ? needsCashierReauth
      ? `${pendingSalesCount} pendientes · iniciar sesion`
      : `${pendingOperationsCount} pendientes`
    : "Sin pendientes";
  syncStatusTarget.title = pendingSalesCount > 0
    ? `Toca para revisar ${pendingLabel} en este dispositivo.`
    : "Sin operaciones offline pendientes.";

}

async function syncPendingQueue(options = {}) {
  const forceBlocked = Boolean(options.forceBlocked);
  const targetClientSaleId = String(options.targetClientSaleId || "").trim();
  const stopAfterTarget = Boolean(targetClientSaleId && options.stopAfterTarget !== false);
  if (!state.online || state.syncingQueue || state.pendingQueue.length === 0) {
    renderSyncStatus();
    return;
  }

  state.syncingQueue = true;
  renderSyncStatus();

  while (state.pendingQueue.length > 0) {
    const queueIndex = targetClientSaleId
      ? getQueuedSaleOperationIndexByClientSaleId(targetClientSaleId)
      : 0;
    if (queueIndex < 0) {
      break;
    }

    const operation = normalizeQueuedOperation(state.pendingQueue[queueIndex]);
    state.pendingQueue[queueIndex] = operation;
    const clientSaleId = getQueuedSaleClientSaleId(operation);
    const clientPaymentId = getQueuedReceivablePaymentClientPaymentId(operation);

    if (operation.kind === "receivable_payment") {
      const resolvedPayment = resolveQueuedReceivablePaymentPayload(operation);
      if (resolvedPayment.dependencyMissing) {
        operation.syncBlocked = true;
        operation.lastSyncError = "El ticket offline ligado a este abono ya no esta disponible para sincronizar.";
        operation.lastSyncErrorCode = null;
        state.pendingQueue[queueIndex] = operation;
        saveQueue();
        if (clientPaymentId) {
          markOfflineReceivablePaymentForReview(clientPaymentId, {
            status: "requires_review",
            lastSyncAttemptAt: operation.lastSyncAttemptAt || new Date().toISOString(),
            lastError: operation.lastSyncError,
            lastErrorCode: null,
            reviewReason: "sale_dependency_missing",
            queueOperationId: operation.id,
          });
        }
        if (typeof refreshOfflineSalesUi === "function") {
          refreshOfflineSalesUi();
        }
        renderSyncStatus();
        showToast(
          "Un abono offline perdio la referencia del ticket original y necesita revision manual.",
          "error",
        );
        break;
      }

      if (resolvedPayment.dependencyWaiting) {
        renderSyncStatus();
        break;
      }

      if (resolvedPayment.payload) {
        operation.body = JSON.stringify(resolvedPayment.payload);
        state.pendingQueue[queueIndex] = operation;
      }
    }

    if (operation.syncBlocked && !forceBlocked) {
      saveQueue();
      renderSyncStatus();
      break;
    }

    operation.syncAttempts += 1;
    operation.lastSyncAttemptAt = new Date().toISOString();
    saveQueue();

    const hasStoredCashierToken = Boolean(getCashierTokenFromHeaders(operation.headers));
    let fallbackHeaders = {};
    if (!hasStoredCashierToken) {
      try {
        const payload = JSON.parse(operation.body || "{}");
        if (
          payload.cashier
          && payload.branch
          && payload.cashier === state.cashier.name
          && payload.branch === state.cashier.branch
        ) {
          fallbackHeaders = getCashierAuthHeaders();
        }
      } catch (_error) {
        fallbackHeaders = {};
      }
    }

    const operationHeaders = {
      ...fallbackHeaders,
      ...(operation.headers || {}),
    };

    try {
      const response = await performJsonRequest(operation.url, {
        method: operation.method,
        body: operation.body,
        headers: operationHeaders,
      });
      state.pendingQueue.splice(queueIndex, 1);
      saveQueue();
      if (clientSaleId) {
        markOfflineSaleSynced(clientSaleId, response?.sale || null);
      }
      if (clientPaymentId) {
        markOfflineReceivablePaymentSynced(clientPaymentId, response?.payment || null);
      }
      if (typeof refreshOfflineSalesUi === "function") {
        refreshOfflineSalesUi();
      }
      if (typeof refreshReceivablesUi === "function") {
        void refreshReceivablesUi({ silent: true });
      }
      renderSyncStatus();
      if (stopAfterTarget) {
        break;
      }
    } catch (error) {
      if (isNetworkError(error) || error.statusCode === 401 || error.statusCode === 403) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          const invalidatedCurrentSession = handleCashierSessionAuthFailure({
            headers: operationHeaders,
          });
          if (clientSaleId) {
            markOfflineSaleForReview(clientSaleId, {
              status: "pending",
              retryCount: operation.syncAttempts,
              lastSyncAttemptAt: operation.lastSyncAttemptAt,
              lastError: "La sesion del cajero necesita reactivarse para sincronizar esta venta.",
              lastErrorCode: error.statusCode,
              reviewReason: "auth_required",
              queueOperationId: operation.id,
            });
          }
          if (clientPaymentId) {
            markOfflineReceivablePaymentForReview(clientPaymentId, {
              status: "pending",
              retryCount: operation.syncAttempts,
              lastSyncAttemptAt: operation.lastSyncAttemptAt,
              lastError: "La sesion del cajero necesita reactivarse para sincronizar este abono.",
              lastErrorCode: error.statusCode,
              reviewReason: "auth_required",
              queueOperationId: operation.id,
            });
          }
          if (typeof refreshOfflineSalesUi === "function") {
            refreshOfflineSalesUi();
          }
          showToast(
            invalidatedCurrentSession
              ? "Hay operaciones pendientes, pero la sesion del cajero actual vencio."
              : "Hay operaciones pendientes, pero el cajero que las capturo necesita reactivar su sesion.",
            "error",
          );
        }
        break;
      }

      operation.syncBlocked = true;
      operation.lastSyncError = error.message || "Error del servidor";
      operation.lastSyncErrorCode = Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : null;
      saveQueue();
      if (clientSaleId) {
        markOfflineSaleForReview(clientSaleId, {
          status: "requires_review",
          retryCount: operation.syncAttempts,
          lastSyncAttemptAt: operation.lastSyncAttemptAt,
          lastError: operation.lastSyncError,
          lastErrorCode: operation.lastSyncErrorCode,
          reviewReason: classifyOfflineSaleReviewReason(error),
          queueOperationId: operation.id,
        });
      }
      if (clientPaymentId) {
        markOfflineReceivablePaymentForReview(clientPaymentId, {
          status: "requires_review",
          retryCount: operation.syncAttempts,
          lastSyncAttemptAt: operation.lastSyncAttemptAt,
          lastError: operation.lastSyncError,
          lastErrorCode: operation.lastSyncErrorCode,
          reviewReason: classifyOfflineReceivablePaymentReviewReason(error),
          queueOperationId: operation.id,
        });
      }
      if (typeof refreshOfflineSalesUi === "function") {
        refreshOfflineSalesUi();
      }
      if (typeof refreshReceivablesUi === "function") {
        void refreshReceivablesUi({ silent: true });
      }
      renderSyncStatus();
      showToast(
        clientPaymentId
          ? "Un abono offline fue rechazado por el servidor. Sigue pendiente para revision manual y no se descarto."
          : "Una venta offline fue rechazada por el servidor. Sigue pendiente para revision manual y no se descarto.",
        "error",
      );
      break;
    }
  }

  state.syncingQueue = false;
  renderSyncStatus();

  if (state.online && state.pendingQueue.length === 0) {
    try {
      await refreshCurrentSnapshot();
      showToast("Sincronizacion completada.", "success");
    } catch (_error) {
      renderSyncStatus();
    }
  }
}

async function retryOfflineSaleByClientSaleId(clientSaleId) {
  const safeClientSaleId = String(clientSaleId || "").trim();
  if (!safeClientSaleId) {
    throw new Error("No pude identificar la venta offline a reintentar.");
  }

  let queueIndex = getQueuedSaleOperationIndexByClientSaleId(safeClientSaleId);
  if (queueIndex < 0) {
    const reactivatedRecord = reactivateOfflineSaleRecord(safeClientSaleId);
    if (!reactivatedRecord) {
      throw new Error("No encontre la venta offline en el dispositivo.");
    }
    queueIndex = getQueuedSaleOperationIndexByClientSaleId(safeClientSaleId);
  }

  if (queueIndex < 0) {
    throw new Error("No pude rearmar la venta offline para reintentarla.");
  }

  const operation = normalizeQueuedOperation(state.pendingQueue[queueIndex]);
  operation.syncBlocked = false;
  operation.lastSyncError = "";
  operation.lastSyncErrorCode = null;
  operation.lastSyncAttemptAt = null;
  state.pendingQueue[queueIndex] = operation;
  saveQueue();
  markOfflineSaleForReview(safeClientSaleId, {
    status: "pending",
    lastError: "",
    lastErrorCode: null,
    reviewReason: "",
    queueOperationId: operation.id,
  });
  renderSyncStatus();

  if (!state.online) {
    return;
  }

  const hasStoredCashierToken = Boolean(
    Object.entries(operation.headers || {}).find(([headerName, headerValue]) =>
      String(headerName || "").toLowerCase() === "x-cashier-token" && String(headerValue || "").trim(),
    ),
  );
  if (!hasStoredCashierToken && (!state.cashier.authenticated || !state.cashier.token)) {
    throw new Error("Vuelve a iniciar sesion del cajero para sincronizar esta venta.");
  }

  await syncPendingQueue({
    forceBlocked: true,
    targetClientSaleId: safeClientSaleId,
    stopAfterTarget: true,
  });
}

// Sincronizar eventos de caja offline con el servidor
async function syncRegisterEvents(options = {}) {
  if (!state.online || state.register.events.length === 0) {
    return { attempted: 0, synced: 0, blocked: false };
  }

  const excludedBranches = new Set(
    [...(options.excludeBranches || [])]
      .map((branch) => String(branch || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const unsyncedEvents = state.register.events
    .filter((event) => !event.synced)
    .filter((event) => !excludedBranches.has(String(event.branch || "").trim().toLowerCase()))
    .sort((left, right) =>
      String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
      || String(left.clientEventId || left.id || "").localeCompare(String(right.clientEventId || right.id || "")),
    );
  let attempted = 0;
  let syncedCount = 0;
  let blocked = false;

  for (const event of unsyncedEvents) {
    let eventHeaders = {};
    try {
      const url = event.eventType === "start"
        ? "/api/register/start"
        : "/api/register/cut";

      const payload = {
        shift: event.shift,
        cashier: event.cashier,
        branch: event.branch,
        notes: event.notes || "",
        clientEventId: event.clientEventId || "",
        openingAmount: event.openingAmount,
        eventType: event.eventType,
        countedAmount: event.countedAmount,
        withdrawalsAmount: event.withdrawalsAmount || 0,
      };

      eventHeaders = event.cashierToken
        ? getCashierAuthHeaders(event.cashierToken)
        : event.cashier === state.cashier.name && event.branch === state.cashier.branch
          ? getCashierAuthHeaders(state.cashier.token || "")
          : {};

      event.lastSyncAttemptAt = new Date().toISOString();
      event.syncBlocked = false;
      event.lastSyncError = "";
      event.lastSyncErrorCode = null;
      attempted += 1;

      const response = await performJsonRequest(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: eventHeaders,
      });

      // Marcar como sincronizado
      event.synced = true;
      event.syncedAt = new Date().toISOString();
      syncedCount += 1;
      if (
        event.eventType === "final_cut"
        && event.cashier === state.cashier.name
        && event.branch === state.cashier.branch
        && typeof setCashierBlindAuditPrompt === "function"
      ) {
        setCashierBlindAuditPrompt(response?.blindAuditPrompt || null);
      }
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        const invalidatedCurrentSession = handleCashierSessionAuthFailure({
          headers: eventHeaders,
        });
        showToast(
          invalidatedCurrentSession
            ? "Hay cortes guardados offline, pero la sesion del cajero actual vencio."
            : "Hay cortes guardados offline, pero el cajero que los capturo necesita reactivar su sesion.",
          "error",
        );
        blocked = true;
        break;
      }
      event.syncBlocked = true;
      event.lastSyncError = error.message || "Error del servidor";
      event.lastSyncErrorCode = Number.isFinite(Number(error.statusCode))
        ? Number(error.statusCode)
        : null;
      blocked = true;
      console.error("Error sincronizando evento de caja:", error);
      if (typeof showToast === "function") {
        showToast(
          "Un corte offline no pudo sincronizarse. Se detuvo la cola de caja para conservar el orden.",
          "error",
        );
      }
      break;
    }
  }

  saveRegisterEvents();

  // Limpia eventos ya sincronizados para evitar crecimiento infinito del cache local.
  state.register.events = state.register.events.filter((event) => !event.synced);
  saveRegisterEvents();
  if (typeof loadRegisterSummary === "function" && state.cashier.authenticated) {
    await loadRegisterSummary({ silent: true });
  }

  return { attempted, synced: syncedCount, blocked };
}

// Sincronizar todo (cola + eventos de caja)
async function syncAllOfflineData(options = {}) {
  await syncPendingQueue(options);
  if (state.pendingQueue.length > 0) {
    const pendingScope = getPendingQueueBranchScope();
    if (pendingScope.hasUnknownBranch) {
      // Evita sincronizar cortes contra un snapshot que todavia no incluye ventas offline pendientes.
      return;
    }
    await syncRegisterEvents({ excludeBranches: pendingScope.branches });
    return;
  }

  await syncRegisterEvents();
  if (state.online) {
    try {
      await refreshCurrentSnapshot();
      if (state.cashier.authenticated) {
        await loadRegisterSummary({ silent: true });
      }
    } catch (_error) {
      // Mantener UI operativa aunque falle el refresco.
    }
  }
}

function registerConnectionEvents() {
  window.addEventListener("online", () => {
    state.online = true;
    refs.socketStatus.textContent = "Reconectando...";
    renderSyncStatus();
    const offlineOperationSummary = typeof getOfflineOperationStatusSummary === "function"
      ? getOfflineOperationStatusSummary()
      : {
          outstanding: 0,
          sales: { outstanding: 0 },
          receivablePayments: { outstanding: 0 },
        };
    const pendingOperationsCount = Math.max(
      0,
      Number(offlineOperationSummary.outstanding || 0),
    );
    const pendingSalesCount = Math.max(
      0,
      Number(offlineOperationSummary.sales?.outstanding || 0),
    );
    const pendingPaymentsCount = Math.max(
      0,
      Number(offlineOperationSummary.receivablePayments?.outstanding || 0),
    );
    const pendingLabel = pendingPaymentsCount > 0 && pendingSalesCount > 0
      ? "operaciones"
      : pendingPaymentsCount > 0
        ? "abonos"
        : "ventas";
    if (pendingOperationsCount > 0) {
      showToast(
        state.cashier.token
          ? `Tienes ${pendingOperationsCount} ${pendingLabel} pendientes. Intentando sincronizarlas ahora.`
          : `Tienes ${pendingOperationsCount} ${pendingLabel} pendientes. Vuelve a iniciar sesion para sincronizarlas.`,
        "info",
      );
    }
    if (typeof renderCashierSession === "function") {
      renderCashierSession();
    }
    if (isDocumentHidden()) {
      scheduleHiddenSocketPause();
      return;
    }
    scheduleConnectionRecovery("browser-online", { immediate: true });
  });

  window.addEventListener("offline", () => {
    state.online = false;
    refs.socketStatus.textContent = "Sin conexion";
    renderSyncStatus();
  });

  window.addEventListener("focus", () => {
    if (
      (typeof navigator === "undefined" || navigator.onLine !== false)
      && (!state.online || !state.socket?.connected)
    ) {
      resumeHiddenSocketPause("window-focus");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (
        (typeof navigator === "undefined" || navigator.onLine !== false)
        && (!state.online || !state.socket?.connected)
      ) {
        resumeHiddenSocketPause("visibility-change");
      } else {
        clearHiddenSocketPauseTimer();
      }
      return;
    }

    scheduleHiddenSocketPause();
  });
}

function connectSocket() {
  if (typeof io !== "function") {
    return;
  }

  state.socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 8000,
    transports: ["websocket", "polling"],
  });

  state.socket.on("connect", () => {
    const previousSocketStatus = refs.socketStatus?.textContent || "";
    const shouldRefreshAfterSocketConnect = Boolean(
      previousSocketStatus === "Reconectando..."
      || connectionRecoveryAttempt > 0
      || state.pendingQueue.length > 0
      || state.register.events.length > 0,
    );
    socketPausedForHiddenTab = false;
    clearHiddenSocketPauseTimer();
    resetConnectionRecoveryState();
    refs.socketStatus.textContent = "En vivo";
    state.online = true;
    renderSyncStatus();
    if (typeof renderCashierSession === "function") {
      renderCashierSession();
    }
    if (shouldRefreshAfterSocketConnect) {
      void attemptConnectionRecovery("socket-connect").catch(() => {});
    }
  });

  state.socket.on("disconnect", () => {
    if (socketPausedForHiddenTab && isDocumentHidden()) {
      if (refs.socketStatus) {
        refs.socketStatus.textContent = "Pausado";
      }
      return;
    }

    refs.socketStatus.textContent = state.online ? "Reconectando..." : "Sin conexion";
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      scheduleConnectionRecovery("socket-disconnect");
    }
  });

  state.socket.on("connect_error", () => {
    if (refs.socketStatus && refs.socketStatus.textContent !== "Sin conexion") {
      refs.socketStatus.textContent = "Reconectando...";
    }
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      scheduleConnectionRecovery("socket-connect-error");
    }
  });

  state.socket.on("dashboard:snapshot", (event = {}) => {
    if (!state.online) {
      return;
    }

    const eventBranch = getDashboardSnapshotEventBranch(event);

    if (shouldRefreshCashierFromDashboardSnapshotEvent(eventBranch)) {
      void refreshCurrentSnapshot().catch(() => {});
    }
    if (shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent(eventBranch)) {
      const adminRefreshOptions = typeof getAdminWorkspaceSectionLiveOptions === "function"
        ? getAdminWorkspaceSectionLiveOptions(getAdminBranch())
        : getAdminWorkspaceLiveOptions(getAdminBranch());
      void refreshAdminWorkspace(adminRefreshOptions).catch(() => {});
    }
  });

  state.socket.on("merchandise-request:updated", (event) => {
    if (!event) {
      return;
    }

    if (
      state.cashier.authenticated
      && state.cashier.branch === event.branch
      && state.cashier.name === event.requestedBy
    ) {
      void loadMyMerchandiseRequests({ silent: true }).catch(() => {});
    }

    if (refs.adminModal?.classList.contains("open") && state.admin.authenticated) {
      void loadAdminMerchandiseRequests(getAdminBranch()).catch(() => {});
    }

    if (state.mobileApprovals?.active && state.admin.authenticated) {
      void loadApprovalsMobileRequests({ silent: true }).then(() => {
        if (
          state.mobileApprovals.selectedRequestId
          && Number(state.mobileApprovals.selectedRequestId) === Number(event.id)
        ) {
          return loadApprovalsMobileDetail(event.id, {
            silent: true,
            resetReason: false,
          });
        }
        return null;
      }).catch(() => {});
    }

    if (
      refs.merchandiseRequestDetailModal?.classList.contains("open")
      && state.merchandise.detailAdminMode
      && Number(state.merchandise.detailRequest?.id) === Number(event.id)
      && state.admin.authenticated
    ) {
      void openAdminMerchandiseRequestDetail(event.id).catch(() => {});
    }
  });

  state.socket.on("weighted-audit:updated", (event) => {
    if (!event) {
      return;
    }

    if (refs.adminModal?.classList.contains("open") && state.admin.authenticated) {
      void loadAdminWeightedAuditSessions(getAdminBranch()).then(() => {
        if (
          state.admin.weightedAudit?.currentSession?.id
          && Number(state.admin.weightedAudit.currentSession.id) === Number(event.id)
        ) {
          return openAdminWeightedAuditSession(event.id);
        }
        return null;
      }).catch(() => {});
    }

    if (
      state.cashier.authenticated
      && event.branch === state.cashier.branch
      && event.sourceCashier === state.cashier.name
    ) {
      void loadRegisterSummary({ silent: true }).catch(() => {});
    }
  });
}

function getDashboardSnapshotEventBranch(event = {}) {
  const safeBranch = String(event?.branch || "").trim().toLowerCase();
  return safeBranch || "";
}

function doesDashboardSnapshotAffectBranch(eventBranch = "", targetBranch = "") {
  const safeEventBranch = String(eventBranch || "").trim().toLowerCase();
  const safeTargetBranch = String(targetBranch || "").trim().toLowerCase();
  if (!safeEventBranch || safeEventBranch === "all") {
    return true;
  }
  if (!safeTargetBranch) {
    return false;
  }
  return safeTargetBranch === "all" || safeTargetBranch === safeEventBranch;
}

function shouldRefreshCashierFromDashboardSnapshotEvent(eventBranch = "") {
  return doesDashboardSnapshotAffectBranch(
    eventBranch,
    typeof getActiveCashierBranch === "function" ? getActiveCashierBranch() : "",
  );
}

function shouldRefreshAdminWorkspaceFromDashboardSnapshotEvent(eventBranch = "") {
  if (!refs.adminModal?.classList.contains("open") || !state.admin.authenticated) {
    return false;
  }

  return doesDashboardSnapshotAffectBranch(
    eventBranch,
    typeof getAdminBranch === "function" ? getAdminBranch() : "",
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const normalized = normalizeClientErrorReason(event.error || event.message);
    reportClientError({
      message: normalized.message,
      stack: normalized.stack,
      url: event.filename || window.location.href,
      context: {
        line: event.lineno || "",
        column: event.colno || "",
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const normalized = normalizeClientErrorReason(event.reason);
    reportClientError({
      message: normalized.message,
      stack: normalized.stack,
      url: window.location.href,
      context: {
        kind: "unhandledrejection",
      },
    });
  });
}
