// Funciones de ventas, caja y registro

function openItemModal(product) {
  if (!requireCashierSession("Inicia sesion de cajero antes de agregar productos.")) {
    return;
  }

  state.currentProduct = product;
  refs.itemModalName.textContent = product.name;
  refs.itemModalMeta.textContent = `${product.categoryLabel} · Precio base ${formatCurrency(product.price)} · Stock ${formatProductStock(product)}`;
  refs.itemQuantity.step = String(getProductStep(product));
  refs.itemQuantity.min = String(getProductMin(product));
  refs.itemQuantity.value = String(getProductMin(product));
  refs.itemTotal.value = roundMoney(product.price * getProductMin(product)).toFixed(2);
  setModalOpen(refs.itemModal, true);
  refs.itemQuantity.focus();
  refs.itemQuantity.select();
}

function closeItemModal() {
  state.currentProduct = null;
  setModalOpen(refs.itemModal, false);
}

function syncItemTotalFromQuantity() {
  if (!state.currentProduct) {
    return;
  }

  const quantity = normalizeQuantityToStep(refs.itemQuantity.value, state.currentProduct);
  refs.itemQuantity.value = String(quantity);
  refs.itemTotal.value = roundMoney(quantity * state.currentProduct.price).toFixed(2);
}

function syncItemQuantityFromTotal() {
  if (!state.currentProduct) {
    return;
  }

  const rawValue = String(refs.itemTotal.value || "").trim();
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return;
  }

  const lineTotal = roundMoney(parsedValue);
  const quantity = normalizeQuantityFromLineTotal(lineTotal, state.currentProduct);

  refs.itemQuantity.value = String(quantity);
}

function finalizeItemTotalInput() {
  if (!state.currentProduct) {
    return;
  }

  const lineTotal = roundMoney(refs.itemTotal.value);
  if (lineTotal <= 0) {
    refs.itemTotal.value = roundMoney(
      state.currentProduct.price * getProductMin(state.currentProduct),
    ).toFixed(2);
    syncItemQuantityFromTotal();
    return;
  }

  refs.itemTotal.value = lineTotal.toFixed(2);
  syncItemQuantityFromTotal();
}

function adjustItemQuantity(delta) {
  if (!state.currentProduct) {
    return;
  }

  const step = getProductStep(state.currentProduct);
  const nextValue = Math.max(
    getProductMin(state.currentProduct),
    roundStock(toNumber(refs.itemQuantity.value, getProductMin(state.currentProduct)) + delta * step),
  );
  refs.itemQuantity.value = String(nextValue);
  syncItemTotalFromQuantity();
}

function addCurrentProductToCart() {
  const product = state.currentProduct;

  if (!product) {
    console.warn("Product is null in addCurrentProductToCart");
    showToast("Error: producto no disponible. Refresca la pagina.", "error");
    return;
  }

  const quantity = roundStock(refs.itemQuantity.value);
  const lineTotal = roundMoney(refs.itemTotal.value);

  if (quantity <= 0 || lineTotal <= 0) {
    showToast("Captura una cantidad y un monto validos.", "error");
    return;
  }

  // ←←← AQUÍ ESTABA EL ERROR: usabas state.currentProduct después de cerrarlo
  state.cart.push({
    productId: product.id,
    name: product.name,
    category: product.category,          // ← corregido
    categoryLabel: product.categoryLabel, // ← corregido
    unit: product.unit,
    quantity,
    unitPrice: product.price,
    lineTotal,
  });

  saveCart();
  renderCart();

  // Guardamos el nombre ANTES de cerrar el modal
  const productName = product.name;

  closeItemModal();                    // ← ahora sí se pone a null, pero ya tenemos el nombre

  showToast(`${productName} agregado al carrito.`, "success");
}

function removeCartItem(index) {
  state.cart.splice(index, 1);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function updatePaymentView() {
  const total = getCartTotal();
  const receivedAmount =
    state.paymentMethod === "Efectivo" ? roundMoney(state.moneyInput) : total;
  const changeAmount =
    state.paymentMethod === "Efectivo"
      ? roundMoney(receivedAmount - total)
      : 0;

  refs.paymentTotal.textContent = formatCurrency(total);
  refs.moneyDisplay.textContent = formatCurrency(receivedAmount);
  refs.paymentReceived.textContent = formatCurrency(receivedAmount);
  refs.paymentChange.textContent =
    state.paymentMethod === "Efectivo"
      ? changeAmount >= 0
        ? formatCurrency(changeAmount)
        : "Falta efectivo"
      : formatCurrency(0);

  refs.confirmSaleButton.disabled =
    total <= 0 || (state.paymentMethod === "Efectivo" && receivedAmount < total);

  refs.cashPaymentBlock.style.display =
    state.paymentMethod === "Efectivo" ? "block" : "none";

  refs.paymentMethods.querySelectorAll("[data-method]").forEach((button) => {
    button.classList.toggle("active", button.dataset.method === state.paymentMethod);
  });
}

function openPaymentModal() {
  if (!requireCashierSession("Inicia sesion de cajero antes de cobrar.")) {
    return;
  }

  if (state.cart.length === 0) {
    showToast("Agrega productos antes de cobrar.", "error");
    return;
  }

  state.moneyInput = "0";
  state.paymentMethod = "Efectivo";
  updatePaymentView();
  setModalOpen(refs.paymentModal, true);
}

function closePaymentModal() {
  setModalOpen(refs.paymentModal, false);
}

function appendMoneyInput(fragment) {
  if (fragment === "." && state.moneyInput.includes(".")) {
    return;
  }

  if (fragment === "00" && state.moneyInput === "0") {
    state.moneyInput = "0";
  } else if (state.moneyInput === "0" && fragment !== ".") {
    state.moneyInput = fragment;
  } else {
    state.moneyInput += fragment;
  }

  updatePaymentView();
}

function clearMoneyInput() {
  state.moneyInput = "0";
  updatePaymentView();
}

function backspaceMoneyInput() {
  if (state.moneyInput.length <= 1) {
    state.moneyInput = "0";
  } else {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  if (state.moneyInput.endsWith(".")) {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  updatePaymentView();
}

async function submitSale() {
  if (!requireCashierSession("Inicia sesion de cajero antes de completar la venta.")) {
    return;
  }

  const payload = {
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    paymentMethod: state.paymentMethod,
    receivedAmount:
      state.paymentMethod === "Efectivo" ? roundMoney(state.moneyInput) : getCartTotal(),
    items: state.cart.map((item) => ({
      productId: item.productId,
      productName: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };

  refs.confirmSaleButton.disabled = true;
  refs.confirmSaleButton.textContent = "Guardando...";

  try {
    const response = await requestJson("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
      queueable: true,
    });

    state.cart = [];
    saveCart();
    renderCart();
    applySnapshot(response.snapshot);
    void loadRegisterSummary({ silent: true });
    closePaymentModal();
    showToast(`Venta ${response.sale.ticketNumber} registrada.`, "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      applyOptimisticSale(payload);
      state.cart = [];
      saveCart();
      renderCart();
      void loadRegisterSummary({ silent: true });
      closePaymentModal();
      showToast(error.message, "info");
    } else {
      showToast(error.message, "error");
    }
  } finally {
    refs.confirmSaleButton.disabled = false;
    refs.confirmSaleButton.textContent = "Completar venta";
    updatePaymentView();
  }
}

async function loadRegisterSummary(options = {}) {
  if (!refs.shiftSelect) {
    return null;
  }

  const shift = options.shift || refs.shiftSelect.value;
  if (!options.silent) {
    state.register.loading = true;
    renderRegisterModal();
  }

  try {
    const response = await performJsonRequest(
      `/api/register/summary?shift=${encodeURIComponent(shift)}&branch=${encodeURIComponent(getActiveCashierBranch())}`,
    );
    const serverSummary = response?.summary
      ? response.summary
      : response?.shift
        ? response
        : getEmptyRegisterSummary();
    
    // Combinar con eventos offline
    const offlineEvents = getRegisterEventsForCurrentShift();
    const combinedSummary = calculateRegisterSummaryWithOffline(serverSummary, offlineEvents);
    
    state.register.summary = combinedSummary;
    renderRegisterSummaryPill();
    return state.register.summary;
  } catch (error) {
    // Si hay error, usar solo eventos offline
    const offlineEvents = getRegisterEventsForCurrentShift();
    if (offlineEvents.length > 0) {
      const emptySummary = getEmptyRegisterSummary();
      state.register.summary = calculateRegisterSummaryWithOffline(emptySummary, offlineEvents);
      renderRegisterSummaryPill();
      return state.register.summary;
    }
    
    if (!options.silent) {
      showToast(error.message, "error");
    }
    return null;
  } finally {
    state.register.loading = false;
    renderRegisterModal();
  }
}

function applyRegisterWithdraw() {
  if (state.register.mode === "start") {
    showToast("El retiro solo aplica en corte rapido o final.", "info");
    return;
  }

  const summary = state.register.summary || getEmptyRegisterSummary();
  const withdrawAmount = roundMoney(state.register.withdrawInput);
  if (!Number.isFinite(withdrawAmount) || withdrawAmount < 0) {
    showToast("El monto de retiro no es valido.", "error");
    return;
  }

  const nextCounted = Math.max(0, roundMoney((summary.expectedCash || 0) - withdrawAmount));
  state.register.amountInput = String(nextCounted);
  renderRegisterModal();
}

async function openRegisterModal(mode) {
  if (!requireCashierSession("Inicia sesion de cajero para usar la caja.")) {
    return;
  }

  state.register.mode = mode;
  state.register.note = "";
  state.register.amountInput = "";
  state.register.withdrawInput = "0";
  setModalOpen(refs.registerModal, true);
  const summary = await loadRegisterSummary();
  if (mode === "start") {
    state.register.amountInput = "";
    state.register.withdrawInput = "0";
  } else {
    state.register.amountInput = String(summary?.expectedCash ?? 0);
    state.register.withdrawInput = "0";
  }
  renderRegisterModal();
  focusRegisterAmount();
}

function closeRegisterModal() {
  setModalOpen(refs.registerModal, false);
}

function focusRegisterAmount() {
  if (!refs.registerModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.registerAmountInput?.focus();
    refs.registerAmountInput?.select();
  });
}

async function saveRegisterAction() {
  if (!requireCashierSession("Inicia sesion de cajero para registrar caja.")) {
    return;
  }

  if (state.register.saving) {
    return;
  }

  const rawValue = String(state.register.amountInput || "").trim();
  if (rawValue === "") {
    showToast("Captura un monto antes de continuar.", "error");
    focusRegisterAmount();
    return;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    showToast("El monto capturado no es valido.", "error");
    focusRegisterAmount();
    return;
  }

  const payload = {
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    notes: state.register.note.trim(),
  };

  let url = "/api/register/start";
  if (state.register.mode === "start") {
    payload.openingAmount = roundMoney(numericValue);
  } else {
    const withdrawAmount = roundMoney(state.register.withdrawInput);
    if (!Number.isFinite(withdrawAmount) || withdrawAmount < 0) {
      showToast("El monto de retiro no es valido.", "error");
      return;
    }
    url = "/api/register/cut";
    payload.eventType = state.register.mode;
    payload.countedAmount = roundMoney(numericValue);
    payload.withdrawalsAmount = withdrawAmount;
  }

  state.register.saving = true;
  renderRegisterModal();

  try {
    // Caja se maneja con su propio log offline (state.register.events),
    // para evitar duplicados no debe entrar tambien a la cola general.
    const response = await performJsonRequest(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (response.snapshot) {
      applySnapshot(response.snapshot);
    }
    state.register.summary = response.summary || state.register.summary;
    renderRegisterSummaryPill();
    closeRegisterModal();
    showToast(
      state.register.mode === "start"
        ? "Inicio de caja guardado."
        : `Corte guardado. Diferencia ${formatCurrency(response.differenceAmount || 0)}.`,
      "success",
    );
  } catch (error) {
    // Si hay error de red, guardar evento offline
    if (isNetworkError(error)) {
      // Guardar evento offline
      const offlineEvent = addOfflineRegisterEvent({
        eventType: state.register.mode,
        shift: payload.shift,
        cashier: payload.cashier,
        branch: payload.branch,
        notes: payload.notes,
        openingAmount: payload.openingAmount || 0,
        countedAmount: payload.countedAmount || 0,
        expectedCash: state.register.summary?.expectedCash || 0,
        cashSales: state.register.summary?.cashSales || 0,
        withdrawalsAmount: payload.withdrawalsAmount || 0,
        differenceAmount: payload.countedAmount 
          ? roundMoney(
              payload.countedAmount -
              ((state.register.summary?.expectedCash || 0) - (payload.withdrawalsAmount || 0)),
            )
          : 0,
      });
      
      // Actualizar resumen local
      if (state.register.mode === "start") {
        state.register.summary = {
          ...state.register.summary,
          openingAmount: (state.register.summary?.openingAmount || 0) + payload.openingAmount,
          lastStartAt: offlineEvent.createdAt,
          lastStartCashier: payload.cashier,
        };
      } else {
        const nextWithdrawals = roundMoney(
          (state.register.summary?.withdrawalsAmount || 0) + (payload.withdrawalsAmount || 0),
        );
        state.register.summary = {
          ...state.register.summary,
          withdrawalsAmount: nextWithdrawals,
          expectedCash: roundMoney((state.register.summary?.expectedCash || 0) - (payload.withdrawalsAmount || 0)),
          quickCuts: state.register.summary?.quickCuts + (state.register.mode === "quick_cut" ? 1 : 0),
          finalCuts: state.register.summary?.finalCuts + (state.register.mode === "final_cut" ? 1 : 0),
        };
      }
      
      saveRegisterEvents();
      renderRegisterSummaryPill();
      closeRegisterModal();
      showToast("Corte guardado offline. Se sincronizara al reconectar.", "info");
    } else {
      showToast(error.message, "error");
    }
  } finally {
    state.register.saving = false;
    renderRegisterModal();
  }
}

async function openActivityDetail(kind, id) {
  if (kind === "sale" && String(id).startsWith("offline-")) {
    state.detailViewer.loading = false;
    state.detailViewer.kind = kind;
    state.detailViewer.detail = state.recentSales.find((sale) => String(sale.id) === String(id)) || null;
    setModalOpen(refs.detailViewerModal, true);
    renderDetailViewer();
    return;
  }

  state.detailViewer.loading = true;
  state.detailViewer.kind = kind;
  state.detailViewer.detail = null;
  setModalOpen(refs.detailViewerModal, true);
  renderDetailViewer();

  try {
    const response = await performJsonRequest(`/api/activity/${encodeURIComponent(kind)}/${id}`);
    state.detailViewer.kind = response.kind;
    state.detailViewer.detail = response.detail;
  } catch (error) {
    if (kind === "sale" && isNetworkError(error)) {
      state.detailViewer.kind = "sale";
      state.detailViewer.detail =
        state.recentSales.find((sale) => String(sale.id) === String(id)) || null;
      if (state.detailViewer.detail) {
        showToast("Mostrando ticket desde cache offline.", "info");
      } else {
        showToast("No se encontro el ticket en cache local.", "error");
      }
    } else {
      showToast(error.message, "error");
    }
  } finally {
    state.detailViewer.loading = false;
    renderDetailViewer();
  }
}

function closeDetailViewer() {
  setModalOpen(refs.detailViewerModal, false);
}