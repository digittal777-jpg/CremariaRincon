const OFFLINE_CASHIER_PROFILE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const OFFLINE_CASHIER_PROFILE_ITERATIONS = 120000;

function openCashierAuthModal() {
  if (typeof syncCashierBranchOptions === "function") {
    syncCashierBranchOptions();
  }
  refs.cashierAuthName.value = state.cashier.name || "";
  refs.cashierAuthBranch.value = state.cashier.branch || getActiveCashierBranch();
  refs.cashierAuthPassword.value = "";
  setModalOpen(refs.cashierAuthModal, true);
  renderCashierAuthModal();
  refs.cashierAuthName.focus();
}

function closeCashierAuthModal() {
  setModalOpen(refs.cashierAuthModal, false);
}

function clearCartForSessionChange() {
  if (state.cart.length === 0) {
    resetMerchandiseRequestDraft();
    closeMerchandiseRequestModal();
    closeMerchandiseRequestItemModal();
    closeMerchandiseRequestDetailModal();
    return;
  }

  state.cart = [];
  saveCart();
  renderCart();
  closePaymentModal();
  resetMerchandiseRequestDraft();
  closeMerchandiseRequestModal();
  closeMerchandiseRequestItemModal();
  closeMerchandiseRequestDetailModal();
  showToast("Se limpio el carrito para cambiar de sucursal sin mezclar ventas.", "info");
}

function clearCashierSessionState() {
  state.cashier.id = null;
  state.cashier.token = "";
  state.cashier.name = "";
  state.cashier.branch = "";
  state.cashier.authenticated = false;
  persistCashierSession();
  clearMerchandiseRequestsForSessionChange();
  if (typeof clearReceivablesSessionChange === "function") {
    clearReceivablesSessionChange();
  }
  state.register.summary = getEmptyRegisterSummary();
  if (typeof clearCashierBlindAuditPrompt === "function") {
    clearCashierBlindAuditPrompt();
  }
  if (typeof renderRegisterSummaryPill === "function") {
    renderRegisterSummaryPill();
  }
}

function supportsOfflineCashierAccess() {
  return Boolean(
    typeof window !== "undefined"
    && window.crypto?.subtle
    && typeof window.crypto.getRandomValues === "function"
    && typeof TextEncoder !== "undefined"
    && typeof btoa === "function"
    && typeof atob === "function",
  );
}

function normalizeOfflineCashierKey(name, branch) {
  return `${String(branch || "").trim().toLowerCase()}::${String(name || "").trim().toLowerCase()}`;
}

function encodeBytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveOfflineCashierHash(password, saltBytes, iterations = OFFLINE_CASHIER_PROFILE_ITERATIONS) {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    256,
  );

  return encodeBytesToBase64(new Uint8Array(bits));
}

function pruneOfflineCashierProfiles(records) {
  const now = Date.now();
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (!record || typeof record !== "object") {
      return false;
    }

    if (!record.key || !record.name || !record.branch || !record.salt || !record.hash) {
      return false;
    }

    const expiresAt = Number(record.expiresAt || 0);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

async function readOfflineCashierProfiles() {
  const records = await readPersistedJson(STORAGE_KEYS.cashierOfflineProfiles, []);
  return pruneOfflineCashierProfiles(records);
}

function persistOfflineCashierProfiles(records) {
  persistJson(STORAGE_KEYS.cashierOfflineProfiles, pruneOfflineCashierProfiles(records));
}

async function cacheOfflineCashierProfile(cashier, password) {
  if (!supportsOfflineCashierAccess() || !cashier?.name || !cashier?.branch || !password) {
    return;
  }

  const now = Date.now();
  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveOfflineCashierHash(password, saltBytes);
  const key = normalizeOfflineCashierKey(cashier.name, cashier.branch);
  const currentProfiles = await readOfflineCashierProfiles();
  const nextProfiles = currentProfiles.filter((profile) => profile.key !== key);

  nextProfiles.push({
    key,
    cashierId: Number(cashier.id || 0) || null,
    name: String(cashier.name || ""),
    branch: String(cashier.branch || ""),
    salt: encodeBytesToBase64(saltBytes),
    hash,
    iterations: OFFLINE_CASHIER_PROFILE_ITERATIONS,
    verifiedAt: now,
    expiresAt: now + OFFLINE_CASHIER_PROFILE_TTL_MS,
  });

  persistOfflineCashierProfiles(nextProfiles.slice(-12));
}

async function findOfflineCashierProfile(name, branch) {
  const key = normalizeOfflineCashierKey(name, branch);
  const profiles = await readOfflineCashierProfiles();
  const nextProfiles = pruneOfflineCashierProfiles(profiles);

  if (nextProfiles.length !== profiles.length) {
    persistOfflineCashierProfiles(nextProfiles);
  }

  return nextProfiles.find((profile) => profile.key === key) || null;
}

async function getPreparedOfflineSnapshot(branch) {
  const normalizedBranch = String(branch || "").trim();
  if (!normalizedBranch) {
    return null;
  }

  if (
    state.cashier.authenticated
    && 
    normalizedBranch === String(state.store?.currentBranch || "")
    && Array.isArray(state.products)
    && state.products.length > 0
  ) {
    return buildPersistedSnapshot();
  }

  return restorePreparedSnapshot(normalizedBranch);
}

async function hasOfflineSnapshotForBranch(branch) {
  const snapshot = await getPreparedOfflineSnapshot(branch);
  return Boolean(
    snapshot
    && String(snapshot.store?.currentBranch || "") === String(branch)
    && Array.isArray(snapshot.products)
    && snapshot.products.length > 0,
  );
}

function applyCashierSession(cashier, token = "") {
  state.cashier.id = Number(cashier?.id || 0) || null;
  state.cashier.token = String(token || "");
  state.cashier.name = String(cashier?.name || "");
  state.cashier.branch = String(cashier?.branch || "");
  state.cashier.authenticated = Boolean(state.cashier.name && state.cashier.branch);
  persistCashierSession();
}

async function activateOfflineCashierSession(name, branch, password) {
  if (!supportsOfflineCashierAccess()) {
    throw new Error("Este celular no soporta acceso local offline para cajeros.");
  }

  const preparedSnapshot = await getPreparedOfflineSnapshot(branch);
  if (
    !preparedSnapshot
    || String(preparedSnapshot.store?.currentBranch || "") !== String(branch)
    || !Array.isArray(preparedSnapshot.products)
    || preparedSnapshot.products.length === 0
  ) {
    throw new Error("Este dispositivo no tiene datos offline guardados para esa sucursal.");
  }

  const profile = await findOfflineCashierProfile(name, branch);
  if (!profile) {
    throw new Error("Este cajero no ha iniciado sesion antes en este dispositivo con internet.");
  }

  const derivedHash = await deriveOfflineCashierHash(
    password,
    decodeBase64ToBytes(profile.salt),
    Number(profile.iterations || OFFLINE_CASHIER_PROFILE_ITERATIONS),
  );

  if (derivedHash !== profile.hash) {
    throw new Error("No pude validar ese cajero offline. Revisa nombre, sucursal o clave.");
  }

  clearCartForSessionChange();
  if (typeof applySnapshot === "function") {
    applySnapshot(preparedSnapshot, { skipPersist: true });
  }
  applyCashierSession(
    {
      id: profile.cashierId,
      name: profile.name,
      branch: profile.branch,
    },
    "",
  );
  closeCashierAuthModal();
  await Promise.allSettled([
    loadRegisterSummary({ silent: true }),
    loadMyMerchandiseRequests({ silent: true }),
  ]);
  renderCashierSession();
  showToast(
    `Sesion local activada para ${profile.name}. Podras vender offline y al reconectar deberas iniciar sesion para sincronizar.`,
    "info",
  );
}

async function loginCashier() {
  if (state.cashierAuth.loading) {
    return;
  }

  const name = refs.cashierAuthName.value.trim();
  const branch = refs.cashierAuthBranch.value;
  const password = refs.cashierAuthPassword.value;

  if (!name || !branch || !password) {
    showToast("Completa todos los campos.", "error");
    return;
  }

  state.cashierAuth.loading = true;
  renderCashierAuthModal();

  try {
    if (!state.online) {
      await activateOfflineCashierSession(name, branch, password);
      return;
    }

    const response = await performJsonRequest("/api/cashier/auth", {
      method: "POST",
      body: JSON.stringify({ name, branch, password }),
      timeout: 5000,
    });

    if (response.authenticated && response.cashier && response.token) {
      clearCartForSessionChange();
      applyCashierSession(
        {
          id: response.cashier.id,
          name: String(response.cashier.name || name),
          branch: String(response.cashier.branch || branch),
        },
        String(response.token || ""),
      );
      try {
        await cacheOfflineCashierProfile(response.cashier, password);
      } catch (_error) {
        // Si falla el cache local, no bloqueamos el acceso normal.
      }
      closeCashierAuthModal();
      await refreshCurrentSnapshot(state.cashier.branch);
      await loadRegisterSummary({ silent: true });
      await loadMyMerchandiseRequests({ silent: true });
      renderCashierSession();
      showToast(`Bienvenido, ${state.cashier.name} (${getBranchLabel(state.cashier.branch)}).`, "success");
    } else {
      showToast("Credenciales incorrectas.", "error");
    }
  } catch (error) {
    if (isNetworkError(error)) {
      try {
        await activateOfflineCashierSession(name, branch, password);
        return;
      } catch (offlineError) {
        showToast(offlineError.message, "error");
        return;
      }
    }

    showToast(error.message, "error");
  } finally {
    state.cashierAuth.loading = false;
    renderCashierAuthModal();
  }
}

async function logoutCashier() {
  clearCartForSessionChange();
  const branchBeforeLogout = state.cashier.branch || state.store.currentBranch || "carrizal";

  const token = state.cashier.token;
  if (token && state.online) {
    try {
      await performJsonRequest("/api/cashier/auth/logout", {
        method: "POST",
        headers: getCashierAuthHeaders(token),
      });
    } catch (_error) {
      // Si el servidor ya perdio la sesion, limpiamos localmente de todos modos.
    }
  }

  clearCashierSessionState();
  if (!state.admin.authenticated && !state.owner.authenticated) {
    applyPublicSnapshot(buildPersistedSnapshot());
  }
  if (state.online) {
    try {
      await refreshCurrentSnapshot(branchBeforeLogout);
    } catch (_error) {
      // Mantener la salida local aunque el refresco publico falle.
    }
  }
  renderCashierSession();
}
