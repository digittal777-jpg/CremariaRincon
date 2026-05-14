function openCashierAuthModal() {
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
  state.register.summary = getEmptyRegisterSummary();
  if (typeof renderRegisterSummaryPill === "function") {
    renderRegisterSummaryPill();
  }
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
    const response = await performJsonRequest("/api/cashier/auth", {
      method: "POST",
      body: JSON.stringify({ name, branch, password }),
    });

    if (response.authenticated && response.cashier && response.token) {
      clearCartForSessionChange();
      state.cashier.id = Number(response.cashier.id || 0) || null;
      state.cashier.token = String(response.token || "");
      state.cashier.name = String(response.cashier.name || name);
      state.cashier.branch = String(response.cashier.branch || branch);
      state.cashier.authenticated = Boolean(
        state.cashier.token
        && state.cashier.name
        && state.cashier.branch,
      );
      persistCashierSession();
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
    showToast(error.message, "error");
  } finally {
    state.cashierAuth.loading = false;
    renderCashierAuthModal();
  }
}

async function logoutCashier() {
  clearCartForSessionChange();

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
  renderCashierSession();
}
