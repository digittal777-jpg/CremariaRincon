// Funciones de red y comunicacion con el servidor

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const CASHIER_REQUEST_TIMEOUT_MS = 6000;
const ADMIN_REQUEST_TIMEOUT_MS = 10000;
const AUTH_STATUS_TIMEOUT_MS = 4000;

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
        headers: {
          "Content-Type": "application/json",
          ...(headers || {}),
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(data.message || "No fue posible completar la accion.");
        error.statusCode = response.status;
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

function getAdminAuthHeaders() {
  return state.admin.token
    ? {
        Authorization: `Bearer ${state.admin.token}`,
        "x-admin-user": state.admin.username || "admin",
      }
    : {};
}

function getCashierAuthHeaders(token = state.cashier.token) {
  return token
    ? {
        "x-cashier-token": token,
      }
    : {};
}

async function requestJson(url, options = {}) {
  if (options.queueable && !state.online) {
    enqueueOperation({
      url,
      method: options.method || "GET",
      body: options.body || null,
      headers: options.headers || {},
    });
    throw new Error("Operacion guardada en modo offline. Se sincronizara al reconectar.");
  }

  try {
    return await performJsonRequest(url, options);
  } catch (error) {
    if (options.queueable && isNetworkError(error)) {
      enqueueOperation({
        url,
        method: options.method || "GET",
        body: options.body || null,
        headers: options.headers || {},
      });
      throw new Error("Operacion guardada en modo offline. Se sincronizara al reconectar.");
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
      if (typeof clearCashierSessionState === "function") {
        clearCashierSessionState();
      }
      if (typeof renderCashierSession === "function") {
        renderCashierSession();
      }
      throw new Error("La sesion del cajero vencio. Vuelve a iniciar sesion.");
    }

    throw error;
  }
}

async function requestAdminJson(url, options = {}) {
  return performJsonRequest(url, {
    timeout: options.timeout ?? options.timeoutMs ?? ADMIN_REQUEST_TIMEOUT_MS,
    ...options,
    headers: {
      ...getAdminAuthHeaders(),
      ...(options.headers || {}),
    },
  });
}

async function loadAdminAuthStatus() {
  const response = await performJsonRequest("/api/admin/auth/status", {
    timeout: AUTH_STATUS_TIMEOUT_MS,
    headers: getAdminAuthHeaders(),
  });
  state.admin.configured = Boolean(response.configured);
  state.admin.username = String(response.username || state.admin.username || "admin");
  state.admin.authenticated = Boolean(response.authenticated) && Boolean(state.admin.token);
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
    state.cashier.authenticated = Boolean(
      state.cashier.token
      && state.cashier.name
      && state.cashier.branch,
    );
    persistCashierSession();
    if (typeof renderCashierSession === "function") {
      renderCashierSession();
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
    state.cashier.authenticated = false;
    persistCashierSession();
  }
  if (typeof renderCashierSession === "function") {
    renderCashierSession();
  }
  return response;
}

function enqueueOperation(operation) {
  state.pendingQueue.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    headers: {},
    ...operation,
  });
  saveQueue();
  renderSyncStatus();
}

function renderSyncStatus() {
  if (refs.networkStatus) {
    refs.networkStatus.textContent = state.online ? "En linea" : "Offline";
  }

  if (!refs.syncStatus) {
    return;
  }

  if (state.syncingQueue) {
    refs.syncStatus.textContent = `Sincronizando ${state.pendingQueue.length}`;
    return;
  }

  refs.syncStatus.textContent =
    state.pendingQueue.length > 0
      ? `${state.pendingQueue.length} pendientes`
      : "Sin pendientes";
}

async function syncPendingQueue() {
  if (!state.online || state.syncingQueue || state.pendingQueue.length === 0) {
    renderSyncStatus();
    return;
  }

  state.syncingQueue = true;
  renderSyncStatus();

  while (state.pendingQueue.length > 0) {
    const operation = state.pendingQueue[0];
    let fallbackHeaders = {};
    if (Object.keys(operation.headers || {}).length === 0) {
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

    const operationHeaders = Object.keys(operation.headers || {}).length > 0
      ? operation.headers
      : fallbackHeaders;

    try {
      await performJsonRequest(operation.url, {
        method: operation.method,
        body: operation.body,
        headers: operationHeaders,
      });
      state.pendingQueue.shift();
      saveQueue();
      renderSyncStatus();
    } catch (error) {
      if (isNetworkError(error) || error.statusCode === 401 || error.statusCode === 403) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          showToast("Hay ventas pendientes, pero la sesion del cajero necesita reactivarse.", "error");
        }
        break;
      }

      state.pendingQueue.shift();
      saveQueue();
      showToast("Una operacion pendiente fue descartada por error del servidor.", "error");
    }
  }

  state.syncingQueue = false;
  renderSyncStatus();

  if (state.online) {
    try {
      await refreshCurrentSnapshot();
      if (state.pendingQueue.length === 0) {
        showToast("Sincronizacion completada.", "success");
      }
    } catch (_error) {
      renderSyncStatus();
    }
  }
}

// Sincronizar eventos de caja offline con el servidor
async function syncRegisterEvents() {
  if (!state.online || state.register.events.length === 0) {
    return;
  }

  const unsyncedEvents = state.register.events.filter((event) => !event.synced);

  for (const event of unsyncedEvents) {
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

      const eventHeaders = event.cashierToken
        ? getCashierAuthHeaders(event.cashierToken)
        : event.cashier === state.cashier.name && event.branch === state.cashier.branch
          ? getCashierAuthHeaders(state.cashier.token || "")
          : {};

      await performJsonRequest(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: eventHeaders,
      });

      // Marcar como sincronizado
      event.synced = true;
      event.syncedAt = new Date().toISOString();
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        showToast("Hay cortes guardados offline, pero la sesion del cajero vencio.", "error");
        break;
      }
      console.error("Error sincronizando evento de caja:", error);
      // Continuar con otros eventos
    }
  }

  saveRegisterEvents();

  // Limpia eventos ya sincronizados para evitar crecimiento infinito del cache local.
  state.register.events = state.register.events.filter((event) => !event.synced);
  saveRegisterEvents();
}

// Sincronizar todo (cola + eventos de caja)
async function syncAllOfflineData() {
  await syncPendingQueue();
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
    if (state.cashier.token) {
      void loadCashierAuthStatus().catch(() => {});
    }
    syncAllOfflineData();
  });

  window.addEventListener("offline", () => {
    state.online = false;
    refs.socketStatus.textContent = "Sin conexion";
    renderSyncStatus();
  });
}

function connectSocket() {
  if (typeof io !== "function") {
    return;
  }

  state.socket = io();

  state.socket.on("connect", () => {
    refs.socketStatus.textContent = "En vivo";
    state.online = true;
    renderSyncStatus();
  });

  state.socket.on("disconnect", () => {
    refs.socketStatus.textContent = state.online ? "Reconectando..." : "Sin conexion";
  });

  state.socket.on("dashboard:snapshot", () => {
    if (!state.online) {
      return;
    }

    void refreshCurrentSnapshot().catch(() => {});
    if (refs.adminModal?.classList.contains("open") && state.admin.token) {
      void refreshAdminWorkspace(getAdminWorkspaceLiveOptions(getAdminBranch())).catch(() => {});
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

    if (refs.adminModal?.classList.contains("open") && state.admin.token) {
      void loadAdminMerchandiseRequests(getAdminBranch()).catch(() => {});
    }

    if (
      refs.merchandiseRequestDetailModal?.classList.contains("open")
      && state.merchandise.detailAdminMode
      && Number(state.merchandise.detailRequest?.id) === Number(event.id)
      && state.admin.token
    ) {
      void openAdminMerchandiseRequestDetail(event.id).catch(() => {});
    }
  });
}
