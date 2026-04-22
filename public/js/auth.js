// Funciones de autenticación de cajeros

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
    return;
  }

  state.cart = [];
  saveCart();
  renderCart();
  closePaymentModal();
  showToast("Se limpio el carrito para cambiar de sucursal sin mezclar ventas.", "info");
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

    if (response.authenticated) {
      clearCartForSessionChange();
      state.cashier.name = name;
      state.cashier.branch = branch;
      state.cashier.authenticated = true;
      persistCashierSession();
      closeCashierAuthModal();
      await refreshCurrentSnapshot(branch);
      await loadRegisterSummary({ silent: true });
      renderCashierSession();
      showToast(`Bienvenido, ${name} (${getBranchLabel(branch)}).`, "success");
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

function logoutCashier() {
  clearCartForSessionChange();
  state.cashier.name = "";
  state.cashier.branch = "";
  state.cashier.authenticated = false;
  persistCashierSession();
  renderCashierSession();
}