function getMerchandiseRequestStatusLabel(status) {
  if (status === "approved") {
    return "Aprobada";
  }

  if (status === "rejected") {
    return "Rechazada";
  }

  return "Pendiente";
}

function getMerchandiseRequestModeLabel(mode) {
  return mode === "return" ? "Salida" : "Entrada";
}

function formatMerchandiseSignedValue(value) {
  const normalizedValue = roundMoney(value);
  if (normalizedValue > 0) {
    return `+${formatCurrency(normalizedValue)}`;
  }
  if (normalizedValue < 0) {
    return `-${formatCurrency(Math.abs(normalizedValue))}`;
  }
  return formatCurrency(0);
}

function getMerchandiseRequestTotal() {
  return roundMoney(
    state.merchandise.items.reduce((sum, item) => sum + roundMoney(item.totalValue), 0),
  );
}

function getApprovalsMobileLocationState() {
  if (typeof window === "undefined") {
    return { active: false, requestId: null };
  }

  const params = new URLSearchParams(window.location.search || "");
  if (params.get("view") !== "approvals") {
    return { active: false, requestId: null };
  }

  const requestId = Number(params.get("request"));
  return {
    active: true,
    requestId: Number.isInteger(requestId) && requestId > 0 ? requestId : null,
  };
}

function replaceApprovalsMobileLocation(options = {}) {
  if (typeof window === "undefined" || !window.history?.replaceState) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  if (options.active) {
    nextUrl.searchParams.set("view", "approvals");
    if (options.requestId != null) {
      nextUrl.searchParams.set("request", String(options.requestId));
    } else {
      nextUrl.searchParams.delete("request");
    }
  } else {
    nextUrl.searchParams.delete("view");
    nextUrl.searchParams.delete("request");
  }

  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

function resetApprovalsMobileState(options = {}) {
  state.mobileApprovals.accessState = options.accessState || "idle";
  state.mobileApprovals.statusMessage = options.statusMessage || "";
  state.mobileApprovals.requests = [];
  state.mobileApprovals.listLoading = false;
  state.mobileApprovals.detailLoading = false;
  state.mobileApprovals.processing = false;
  state.mobileApprovals.selectedRequestId = options.preserveSelection ? state.mobileApprovals.selectedRequestId : null;
  state.mobileApprovals.detail = null;
  state.mobileApprovals.rejectReason = "";
  state.mobileApprovals.confirmApprove = false;
}

function setApprovalsMobileActive(active) {
  state.mobileApprovals.active = Boolean(active);
  if (typeof document !== "undefined") {
    document.body.classList.toggle("approvals-mobile-view", state.mobileApprovals.active);
  }
  if (refs.approvalsMobileShell) {
    refs.approvalsMobileShell.hidden = !state.mobileApprovals.active;
  }
}

function getApprovalsMobileStatusCopy() {
  if (!state.online) {
    return state.admin.authenticated
      ? "Sin conexion. Puedes revisar el ultimo estado cargado, pero aprobar y rechazar estan bloqueados."
      : "Sin conexion. Reconecta para validar la sesion admin y revisar pendientes.";
  }

  if (state.mobileApprovals.accessState === "auth-required") {
    return state.mobileApprovals.statusMessage || "Inicia sesion admin para revisar y aprobar solicitudes.";
  }

  if (state.mobileApprovals.accessState === "access-denied") {
    return state.mobileApprovals.statusMessage || "Tu cuenta admin no tiene permiso para aprobar mercaderia.";
  }

  if (state.mobileApprovals.accessState === "error") {
    return state.mobileApprovals.statusMessage || "No pude cargar la bandeja movil.";
  }

  return state.mobileApprovals.statusMessage
    || "Revisa pendientes, aprueba o rechaza sin abrir el panel admin completo.";
}

function getFilteredMerchandiseProducts() {
  const search = String(state.merchandise.search || "").trim().toLowerCase();
  return state.products.filter((product) => {
    if (!product.active) {
      return false;
    }

    if (!search) {
      return true;
    }

    return product.name.toLowerCase().includes(search);
  });
}

function getMerchandiseRequestQuantityMin(product) {
  return product?.allowDecimals === false ? 1 : 0.001;
}

function getMerchandiseRequestQuantityInputStep(product) {
  return product?.allowDecimals === false ? 1 : 0.001;
}

function getMerchandiseRequestAdjustStep(product) {
  return product?.allowDecimals === false ? 1 : Number(product?.unitStep || 0.25);
}

function normalizeMerchandiseRequestQuantity(value, product) {
  if (product?.allowDecimals === false) {
    return Math.max(1, Math.round(toNumber(value, 1)));
  }

  return roundStock(
    Math.max(getMerchandiseRequestQuantityMin(product), toNumber(value, getMerchandiseRequestQuantityMin(product))),
  );
}

function getMerchandiseRequestItemSignedMultiplier(mode = state.merchandise.currentMode) {
  return mode === "return" ? -1 : 1;
}

function resetMerchandiseRequestDraft() {
  state.merchandise.items = [];
  state.merchandise.supplierName = "";
  state.merchandise.notes = "";
  state.merchandise.search = "";
  state.merchandise.saving = false;
  state.merchandise.currentProduct = null;
  state.merchandise.currentMode = "receive";
  state.merchandise.currentQuantity = "";
}

function syncMerchandiseRequestProductsFromSnapshot() {
  if (!Array.isArray(state.merchandise.items) || state.merchandise.items.length === 0) {
    return;
  }

  const productMap = new Map(state.products.map((product) => [product.id, product]));

  state.merchandise.items = state.merchandise.items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      return item;
    }

    const unitPrice = roundMoney(product.price);
    const fallbackTotalValue = roundMoney(
      unitPrice * item.quantity * getMerchandiseRequestItemSignedMultiplier(item.mode),
    );
    return {
      ...item,
      productName: product.name,
      unit: product.unit,
      categoryLabel: product.categoryLabel,
      unitPrice,
      totalValue: Number.isFinite(Number(item.totalValue))
        ? roundMoney(item.totalValue)
        : fallbackTotalValue,
    };
  });

  if (state.merchandise.currentProduct) {
    state.merchandise.currentProduct =
      productMap.get(state.merchandise.currentProduct.id) || state.merchandise.currentProduct;
  }

  if (refs.merchandiseRequestModal?.classList.contains("open")) {
    renderMerchandiseRequestModal();
  }

  if (refs.merchandiseRequestItemModal?.classList.contains("open")) {
    renderMerchandiseRequestItemModal();
  }
}

function renderMyMerchandiseRequests() {
  if (!refs.myMerchandiseRequestsList) {
    return;
  }

  if (!state.cashier.authenticated) {
    refs.myMerchandiseRequestsList.innerHTML = `
      <div class="empty-state">
        Inicia sesion como cajero para crear y seguir solicitudes de mercaderia.
      </div>
    `;
    return;
  }

  if (state.merchandise.loadingMyRequests) {
    refs.myMerchandiseRequestsList.innerHTML = `
      <div class="empty-state">
        Cargando tus solicitudes...
      </div>
    `;
    return;
  }

  if (state.merchandise.myRequests.length === 0) {
    refs.myMerchandiseRequestsList.innerHTML = `
      <div class="empty-state">
        Todavia no tienes solicitudes registradas en esta sucursal.
      </div>
    `;
    return;
  }

  refs.myMerchandiseRequestsList.innerHTML = state.merchandise.myRequests
    .map((requestRecord) => `
      <button
        class="admin-record-item"
        data-action="open-my-merchandise-request"
        data-request-id="${requestRecord.id}"
        type="button"
      >
        <div class="admin-record-item-head">
          <strong>Solicitud #${requestRecord.id}</strong>
          <span class="request-status-pill ${requestRecord.status}">
            ${escapeHtml(getMerchandiseRequestStatusLabel(requestRecord.status))}
          </span>
        </div>
        <p>
          ${escapeHtml(requestRecord.supplierName || "Sin proveedor")} ·
          ${escapeHtml(dateTimeFormatter.format(new Date(requestRecord.createdAt)))} ·
          ${formatMerchandiseSignedValue(requestRecord.totalValue)}
        </p>
        <p>${escapeHtml(requestRecord.itemsSummary || `${requestRecord.itemCount} productos`)}</p>
      </button>
    `)
    .join("");
}

async function loadMyMerchandiseRequests(options = {}) {
  if (!state.cashier.authenticated || !state.cashier.name || !state.cashier.branch) {
    state.merchandise.myRequests = [];
    state.merchandise.loadingMyRequests = false;
    renderMyMerchandiseRequests();
    return [];
  }

  if (!options.silent) {
    state.merchandise.loadingMyRequests = true;
    renderMyMerchandiseRequests();
  }

  const previousStatuses = new Map(
    state.merchandise.myRequests.map((requestRecord) => [requestRecord.id, requestRecord.status]),
  );

  try {
    const response = await requestCashierJson(
      `/api/merchandise-requests/my?requestedBy=${encodeURIComponent(state.cashier.name)}&branch=${encodeURIComponent(state.cashier.branch)}&status=all&limit=12`,
    );
    state.merchandise.myRequests = Array.isArray(response.requests) ? response.requests : [];

    state.merchandise.myRequests.forEach((requestRecord) => {
      const previousStatus = previousStatuses.get(requestRecord.id);
      if (previousStatus === "pending" && requestRecord.status === "approved") {
        showToast(`La solicitud #${requestRecord.id} fue aprobada.`, "success");
      }
      if (previousStatus === "pending" && requestRecord.status === "rejected") {
        showToast(`La solicitud #${requestRecord.id} fue rechazada.`, "info");
      }
    });

    return state.merchandise.myRequests;
  } catch (error) {
    if (!options.silent) {
      showToast(error.message, "error");
    }
    return state.merchandise.myRequests;
  } finally {
    state.merchandise.loadingMyRequests = false;
    renderMyMerchandiseRequests();
  }
}

function clearMerchandiseRequestsForSessionChange() {
  state.merchandise.myRequests = [];
  state.merchandise.loadingMyRequests = false;
  state.merchandise.detailRequest = null;
  state.merchandise.detailLoading = false;
  state.merchandise.detailProcessing = false;
  state.merchandise.detailAdminMode = false;
  state.merchandise.detailRejectReason = "";
  renderMyMerchandiseRequests();
  renderMerchandiseRequestDetailModal();
}

function openMerchandiseRequestModal() {
  if (!requireCashierSession("Inicia sesion de cajero para crear una solicitud.")) {
    return;
  }

  resetMerchandiseRequestDraft();
  renderMerchandiseRequestModal();
  setModalOpen(refs.merchandiseRequestModal, true);
  window.requestAnimationFrame(() => {
    refs.merchandiseRequestSearch?.focus();
  });
}

function closeMerchandiseRequestModal() {
  setModalOpen(refs.merchandiseRequestModal, false);
}

function openMerchandiseRequestItemModal(productId) {
  const product = state.products.find((item) => item.id === Number(productId));
  if (!product) {
    showToast("No pude abrir ese producto para la solicitud.", "error");
    return;
  }

  state.merchandise.currentProduct = product;
  state.merchandise.currentMode = "receive";
  state.merchandise.currentQuantity = String(getMerchandiseRequestQuantityMin(product));
  renderMerchandiseRequestItemModal();
  setModalOpen(refs.merchandiseRequestItemModal, true);
  window.requestAnimationFrame(() => {
    refs.merchandiseRequestItemQuantity?.focus();
    refs.merchandiseRequestItemQuantity?.select();
  });
}

function closeMerchandiseRequestItemModal() {
  state.merchandise.currentProduct = null;
  state.merchandise.currentMode = "receive";
  state.merchandise.currentQuantity = "";
  setModalOpen(refs.merchandiseRequestItemModal, false);
}

function syncMerchandiseRequestItemTotal(options = {}) {
  if (!state.merchandise.currentProduct || !refs.merchandiseRequestItemTotal) {
    return;
  }

  const rawQuantity = state.merchandise.currentQuantity || refs.merchandiseRequestItemQuantity?.value;
  const parsedQuantity = Number(rawQuantity);
  const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0
    ? normalizeMerchandiseRequestQuantity(parsedQuantity, state.merchandise.currentProduct)
    : null;
  const unitPrice = roundMoney(state.merchandise.currentProduct.price);
  const signedMultiplier = getMerchandiseRequestItemSignedMultiplier();
  refs.merchandiseRequestItemUnitPrice.value = unitPrice.toFixed(2);

  if (options.preserveTypedQuantity && quantity == null) {
    return;
  }

  if (!options.preserveTypedQuantity) {
    const normalizedQuantity = quantity
      ?? getMerchandiseRequestQuantityMin(state.merchandise.currentProduct);
    state.merchandise.currentQuantity = String(normalizedQuantity);

    if (refs.merchandiseRequestItemQuantity) {
      refs.merchandiseRequestItemQuantity.value = state.merchandise.currentQuantity;
    }
  }

  if (quantity == null) {
    return;
  }

  refs.merchandiseRequestItemTotal.value = roundMoney(
    quantity * unitPrice * signedMultiplier,
  ).toFixed(2);
}

function finalizeMerchandiseRequestItemQuantityInput() {
  if (!state.merchandise.currentProduct || !refs.merchandiseRequestItemQuantity) {
    return;
  }

  state.merchandise.currentQuantity = refs.merchandiseRequestItemQuantity.value;
  syncMerchandiseRequestItemTotal();
}

function syncMerchandiseRequestQuantityFromTotal() {
  if (!state.merchandise.currentProduct || !refs.merchandiseRequestItemTotal) {
    return;
  }

  const rawValue = String(refs.merchandiseRequestItemTotal.value || "").trim();
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return;
  }

  const lineTotal = roundMoney(Math.abs(parsedValue));
  const quantity = normalizeQuantityFromLineTotal(
    lineTotal,
    state.merchandise.currentProduct,
  );

  state.merchandise.currentQuantity = String(
    normalizeMerchandiseRequestQuantity(quantity, state.merchandise.currentProduct),
  );
  refs.merchandiseRequestItemQuantity.value = state.merchandise.currentQuantity;
}

function finalizeMerchandiseRequestItemTotalInput() {
  if (!state.merchandise.currentProduct || !refs.merchandiseRequestItemTotal) {
    return;
  }

  const lineTotal = roundMoney(Math.abs(refs.merchandiseRequestItemTotal.value));
  if (lineTotal <= 0) {
    syncMerchandiseRequestItemTotal();
    return;
  }

  const signedMultiplier = getMerchandiseRequestItemSignedMultiplier();
  refs.merchandiseRequestItemTotal.value = roundMoney(lineTotal * signedMultiplier).toFixed(2);
  syncMerchandiseRequestQuantityFromTotal();
}

function adjustMerchandiseRequestItemQuantity(delta) {
  if (!state.merchandise.currentProduct) {
    return;
  }

  const step = getMerchandiseRequestAdjustStep(state.merchandise.currentProduct);
  const minimum = getMerchandiseRequestQuantityMin(state.merchandise.currentProduct);
  const nextValue = Math.max(
    minimum,
    roundStock(
      toNumber(state.merchandise.currentQuantity, minimum) + delta * step,
    ),
  );
  state.merchandise.currentQuantity = String(nextValue);
  syncMerchandiseRequestItemTotal();
}

function setMerchandiseRequestItemMode(mode) {
  if (!["receive", "return"].includes(mode)) {
    return;
  }

  state.merchandise.currentMode = mode;
  renderMerchandiseRequestItemModal();
}

function renderMerchandiseRequestModal() {
  if (!refs.merchandiseRequestModal) {
    return;
  }

  const filteredProducts = getFilteredMerchandiseProducts();
  const totalValue = getMerchandiseRequestTotal();
  const totalLabel = totalValue > 0
    ? "Entrada neta"
    : totalValue < 0
      ? "Salida neta"
      : "Balance neto";

  refs.merchandiseRequestSearch.value = state.merchandise.search;
  refs.merchandiseRequestSupplier.value = state.merchandise.supplierName;
  refs.merchandiseRequestNote.value = state.merchandise.notes;
  refs.merchandiseRequestSaveButton.disabled =
    state.merchandise.saving || state.merchandise.items.length === 0;
  refs.merchandiseRequestSaveButton.textContent = state.merchandise.saving
    ? "Guardando..."
    : "Enviar a admin";

  if (filteredProducts.length === 0) {
    refs.merchandiseRequestProducts.innerHTML = `
      <div class="empty-state">
        No hay productos que coincidan con la busqueda.
      </div>
    `;
  } else {
    refs.merchandiseRequestProducts.innerHTML = filteredProducts
      .map((product) => `
        <button
          class="product-card ${product.status}"
          data-action="open-merchandise-product"
          data-product-id="${product.id}"
          type="button"
        >
          <div class="product-top">
            <span class="product-chip">${escapeHtml(product.categoryLabel)}</span>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </div>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="product-bottom">
            <div class="product-stock">
              ${escapeHtml(formatProductStock(product))}
            </div>
            <div class="product-price">${formatCurrency(product.price)}</div>
          </div>
        </button>
      `)
      .join("");
  }

  if (state.merchandise.items.length === 0) {
    refs.merchandiseRequestItems.innerHTML = `
      <div class="empty-state">
        Agrega productos para armar la solicitud de mercaderia.
      </div>
    `;
  } else {
    refs.merchandiseRequestItems.innerHTML = state.merchandise.items
      .map((item, index) => `
        <article class="merchandise-request-line">
          <div class="merchandise-request-line-head">
            <div>
              <strong>${escapeHtml(item.productName)}</strong>
              <p>
                ${escapeHtml(getMerchandiseRequestModeLabel(item.mode))} ·
                ${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)} ·
                ${formatCurrency(item.unitPrice)}
              </p>
            </div>
            <button
              class="icon-button"
              data-action="remove-merchandise-item"
              data-index="${index}"
              type="button"
            >
              ×
            </button>
          </div>
          <div class="merchandise-request-line-foot">
            <span class="request-mode-pill ${item.mode}">
              ${escapeHtml(getMerchandiseRequestModeLabel(item.mode))}
            </span>
            <strong>${formatMerchandiseSignedValue(item.totalValue)}</strong>
          </div>
        </article>
      `)
      .join("");
  }

  refs.merchandiseRequestTotalLabel.textContent = totalLabel;
  refs.merchandiseRequestTotal.textContent = formatMerchandiseSignedValue(totalValue);
}

function renderMerchandiseRequestItemModal() {
  if (!refs.merchandiseRequestItemModal) {
    return;
  }

  const product = state.merchandise.currentProduct;
  if (!product) {
    refs.merchandiseRequestItemName.textContent = "Producto";
    refs.merchandiseRequestItemMeta.textContent = "";
    return;
  }

  refs.merchandiseRequestItemName.textContent = product.name;
  refs.merchandiseRequestItemMeta.textContent =
    `${product.categoryLabel} · ${formatProductStock(product)} disponibles`;
  refs.merchandiseRequestItemQuantity.step = String(getMerchandiseRequestQuantityInputStep(product));
  refs.merchandiseRequestItemQuantity.min = String(getMerchandiseRequestQuantityMin(product));
  refs.merchandiseRequestItemQuantity.value =
    state.merchandise.currentQuantity || String(getMerchandiseRequestQuantityMin(product));
  refs.merchandiseRequestItemAddButton.textContent = "Agregar a solicitud";
  refs.merchandiseRequestItemModeBar.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.merchandise.currentMode);
  });

  syncMerchandiseRequestItemTotal();
}

function addMerchandiseRequestItem() {
  const product = state.merchandise.currentProduct;
  if (!product) {
    showToast("No hay producto abierto para la solicitud.", "error");
    return;
  }

  const quantity = normalizeMerchandiseRequestQuantity(
    state.merchandise.currentQuantity || refs.merchandiseRequestItemQuantity.value,
    product,
  );

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showToast("Captura una cantidad valida para la solicitud.", "error");
    return;
  }

  const mode = state.merchandise.currentMode;
  const unitPrice = roundMoney(product.price);
  const signedMultiplier = getMerchandiseRequestItemSignedMultiplier(mode);
  const rawLineTotal = roundMoney(
    Math.abs(refs.merchandiseRequestItemTotal?.value || unitPrice * quantity),
  );
  if (!Number.isFinite(rawLineTotal) || rawLineTotal <= 0) {
    showToast("Captura un valor valido para la linea.", "error");
    return;
  }

  const totalValue = roundMoney(rawLineTotal * signedMultiplier);
  const existingIndex = state.merchandise.items.findIndex(
    (item) => item.productId === product.id && item.mode === mode,
  );

  state.merchandise.currentQuantity = String(quantity);
  refs.merchandiseRequestItemQuantity.value = state.merchandise.currentQuantity;
  refs.merchandiseRequestItemTotal.value = totalValue.toFixed(2);

  if (existingIndex >= 0) {
    const currentItem = state.merchandise.items[existingIndex];
    const nextQuantity = roundStock(currentItem.quantity + quantity);
    state.merchandise.items[existingIndex] = {
      ...currentItem,
      quantity: nextQuantity,
      unitPrice,
      totalValue: roundMoney(currentItem.totalValue + totalValue),
    };
  } else {
    state.merchandise.items.push({
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      categoryLabel: product.categoryLabel,
      quantity,
      unitPrice,
      totalValue,
      mode,
    });
  }

  renderMerchandiseRequestModal();
  closeMerchandiseRequestItemModal();
  showToast(`${product.name} agregado a la solicitud.`, "success");
}

function removeMerchandiseRequestItem(index) {
  state.merchandise.items.splice(index, 1);
  renderMerchandiseRequestModal();
}

async function submitMerchandiseRequest() {
  if (!requireCashierSession("Inicia sesion de cajero para enviar una solicitud.")) {
    return;
  }

  if (state.merchandise.items.length === 0) {
    showToast("Agrega al menos un producto a la solicitud.", "error");
    return;
  }

  const payload = {
    requestedBy: state.cashier.name,
    branch: getActiveCashierBranch(),
    supplierName: state.merchandise.supplierName.trim(),
    notes: state.merchandise.notes.trim(),
    items: state.merchandise.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      totalValue: item.totalValue,
      mode: item.mode,
    })),
  };

  state.merchandise.saving = true;
  renderMerchandiseRequestModal();

  try {
    await requestCashierJson("/api/merchandise-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    closeMerchandiseRequestModal();
    resetMerchandiseRequestDraft();
    await loadMyMerchandiseRequests({ silent: true });
    showToast("Solicitud enviada a revision admin.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.merchandise.saving = false;
    renderMerchandiseRequestModal();
  }
}

function openMyMerchandiseRequestDetail(requestId) {
  const requestRecord = state.merchandise.myRequests.find(
    (item) => Number(item.id) === Number(requestId),
  );

  if (!requestRecord) {
    showToast("No pude encontrar esa solicitud.", "error");
    return;
  }

  state.merchandise.detailRequest = requestRecord;
  state.merchandise.detailAdminMode = false;
  state.merchandise.detailLoading = false;
  state.merchandise.detailProcessing = false;
  state.merchandise.detailRejectReason = requestRecord.rejectionReason || "";
  renderMerchandiseRequestDetailModal();
  setModalOpen(refs.merchandiseRequestDetailModal, true);
}

async function openAdminMerchandiseRequestDetail(requestId) {
  state.merchandise.detailRequest = null;
  state.merchandise.detailAdminMode = true;
  state.merchandise.detailLoading = true;
  state.merchandise.detailProcessing = false;
  state.merchandise.detailRejectReason = "";
  renderMerchandiseRequestDetailModal();
  setModalOpen(refs.merchandiseRequestDetailModal, true);

  try {
    state.merchandise.detailRequest = await fetchAdminMerchandiseRequestDetail(requestId);
    state.merchandise.detailRejectReason = state.merchandise.detailRequest?.rejectionReason || "";
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.merchandise.detailLoading = false;
    renderMerchandiseRequestDetailModal();
  }
}

function closeMerchandiseRequestDetailModal() {
  state.merchandise.detailRejectReason = "";
  setModalOpen(refs.merchandiseRequestDetailModal, false);
}

function renderMerchandiseRequestDetailModal() {
  if (!refs.merchandiseRequestDetailModal || !refs.merchandiseRequestDetailBody) {
    return;
  }

  if (state.merchandise.detailLoading) {
    refs.merchandiseRequestDetailTitle.textContent = "Cargando solicitud";
    refs.merchandiseRequestDetailMeta.textContent = "Preparando detalle completo...";
    refs.merchandiseRequestDetailBody.innerHTML = `
      <div class="empty-state">
        Cargando solicitud...
      </div>
    `;
    refs.merchandiseRequestDetailApproveButton.hidden = true;
    refs.merchandiseRequestDetailRejectButton.hidden = true;
    return;
  }

  const requestRecord = state.merchandise.detailRequest;
  if (!requestRecord) {
    refs.merchandiseRequestDetailTitle.textContent = "Sin solicitud";
    refs.merchandiseRequestDetailMeta.textContent = "";
    refs.merchandiseRequestDetailBody.innerHTML = `
      <div class="empty-state">
        Selecciona una solicitud para ver su detalle.
      </div>
    `;
    refs.merchandiseRequestDetailApproveButton.hidden = true;
    refs.merchandiseRequestDetailRejectButton.hidden = true;
    return;
  }

  refs.merchandiseRequestDetailTitle.textContent = `Solicitud #${requestRecord.id}`;
  refs.merchandiseRequestDetailMeta.textContent =
    `${requestRecord.requestedBy} · ${getBranchLabel(requestRecord.branch)} · ${dateTimeFormatter.format(new Date(requestRecord.createdAt))}`;
  refs.merchandiseRequestDetailBody.innerHTML = `
    <div class="detail-stat-grid">
      <article class="detail-stat-card">
        <span>Estado</span>
        <strong>${escapeHtml(getMerchandiseRequestStatusLabel(requestRecord.status))}</strong>
      </article>
      <article class="detail-stat-card">
        <span>Proveedor</span>
        <strong>${escapeHtml(requestRecord.supplierName || "Sin proveedor")}</strong>
      </article>
      <article class="detail-stat-card">
        <span>Valor neto</span>
        <strong>${formatMerchandiseSignedValue(requestRecord.totalValue)}</strong>
      </article>
      <article class="detail-stat-card">
        <span>Productos</span>
        <strong>${escapeHtml(String(requestRecord.itemCount || requestRecord.items?.length || 0))}</strong>
      </article>
    </div>
    <div class="detail-lines">
      ${(requestRecord.items || []).map((item) => `
        <div class="detail-line">
          <div>
            <strong>${escapeHtml(item.productName)}</strong>
            <p>
              ${escapeHtml(getMerchandiseRequestModeLabel(item.mode))} ·
              ${escapeHtml(formatQuantity(item.quantity))} ·
              ${formatCurrency(item.unitPrice)}
            </p>
          </div>
          <span>${formatMerchandiseSignedValue(item.totalValue)}</span>
        </div>
      `).join("")}
    </div>
    ${requestRecord.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(requestRecord.notes)}</p>` : ""}
    ${requestRecord.rejectionReason ? `<p class="sale-notes"><strong>Rechazo:</strong> ${escapeHtml(requestRecord.rejectionReason)}</p>` : ""}
    ${state.merchandise.detailAdminMode && requestRecord.status === "pending" ? `
      <label class="field">
        <span>Razon para rechazo</span>
        <textarea
          data-merchandise-detail-reject-reason="true"
          placeholder="Escribe por que se rechaza esta solicitud."
        >${escapeHtml(state.merchandise.detailRejectReason || "")}</textarea>
      </label>
    ` : ""}
  `;

  const showAdminActions = state.merchandise.detailAdminMode && requestRecord.status === "pending";
  refs.merchandiseRequestDetailApproveButton.hidden = !showAdminActions;
  refs.merchandiseRequestDetailRejectButton.hidden = !showAdminActions;
  refs.merchandiseRequestDetailApproveButton.disabled = state.merchandise.detailProcessing;
  refs.merchandiseRequestDetailRejectButton.disabled = state.merchandise.detailProcessing;
  refs.merchandiseRequestDetailApproveButton.textContent = state.merchandise.detailProcessing
    ? "Procesando..."
    : "Aprobar";
  refs.merchandiseRequestDetailRejectButton.textContent = state.merchandise.detailProcessing
    ? "Procesando..."
    : "Rechazar";
}

function renderAdminMerchandiseRequests() {
  if (!refs.adminMerchandiseRequestsList) {
    return;
  }

  const requests = Array.isArray(state.admin.merchandiseRequests)
    ? state.admin.merchandiseRequests
    : [];
  if (refs.adminMerchandiseRequestsStatus) {
    refs.adminMerchandiseRequestsStatus.textContent = requests.length
      ? `${requests.length} pendientes`
      : "Sin pendientes";
  }

  if (requests.length === 0) {
    refs.adminMerchandiseRequestsList.innerHTML = `
      <div class="empty-state">
        No hay solicitudes pendientes por revisar.
      </div>
    `;
    return;
  }

  refs.adminMerchandiseRequestsList.innerHTML = requests
    .map((requestRecord) => `
      <button
        class="admin-record-item"
        data-action="open-admin-merchandise-request"
        data-request-id="${requestRecord.id}"
        type="button"
      >
        <div class="admin-record-item-head">
          <strong>Solicitud #${requestRecord.id}</strong>
          <span class="request-status-pill pending">Pendiente</span>
        </div>
        <p>
          ${escapeHtml(getBranchLabel(requestRecord.branch))} ·
          ${escapeHtml(requestRecord.requestedBy)} ·
          ${escapeHtml(requestRecord.supplierName || "Sin proveedor")}
        </p>
        <p>
          ${escapeHtml(dateTimeFormatter.format(new Date(requestRecord.createdAt)))} ·
          ${escapeHtml(String(requestRecord.itemCount || 0))} lineas ·
          ${formatMerchandiseSignedValue(requestRecord.totalValue)}
        </p>
        <p>${escapeHtml(requestRecord.itemsSummary || `${requestRecord.itemCount} productos`)}</p>
      </button>
    `)
    .join("");
}

async function fetchPendingMerchandiseRequests(branch = getAdminBranch(), limit = 60) {
  const response = await requestAdminJson(
    `/api/merchandise-requests/pending?branch=${encodeURIComponent(branch)}&limit=${encodeURIComponent(limit)}`,
  );
  return Array.isArray(response.requests) ? response.requests : [];
}

async function fetchAdminMerchandiseRequestDetail(requestId) {
  const response = await requestAdminJson(`/api/merchandise-requests/${requestId}`);
  return response.request || null;
}

async function sendApproveMerchandiseRequest(requestId) {
  const response = await requestAdminJson(`/api/merchandise-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return response.request || null;
}

async function sendRejectMerchandiseRequest(requestId, rejectionReason) {
  const response = await requestAdminJson(`/api/merchandise-requests/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejectionReason: String(rejectionReason || "").trim() }),
  });
  return response.request || null;
}

function setApprovalsMobileSelection(requestId, options = {}) {
  state.mobileApprovals.selectedRequestId =
    Number.isInteger(Number(requestId)) && Number(requestId) > 0
      ? Number(requestId)
      : null;
  state.mobileApprovals.detail = null;
  state.mobileApprovals.detailLoading = false;
  state.mobileApprovals.processing = false;
  state.mobileApprovals.rejectReason = "";
  state.mobileApprovals.confirmApprove = false;
  if (options.updateLocation !== false) {
    replaceApprovalsMobileLocation({
      active: state.mobileApprovals.active,
      requestId: state.mobileApprovals.selectedRequestId,
    });
  }
}

function buildApprovalsMobileStateMarkup(title, message, options = {}) {
  return `
    <div class="approvals-mobile-state">
      <strong>${escapeHtml(title)}</strong>
      <p class="modal-note">${escapeHtml(message)}</p>
      ${options.showLoginButton ? `
        <div class="approvals-mobile-action-row">
          <button class="primary-button" data-action="approvals-login" type="button">
            Entrar como admin
          </button>
        </div>
      ` : ""}
      ${options.showRetryButton ? `
        <div class="approvals-mobile-action-row">
          <button class="secondary-button" data-action="approvals-retry" type="button">
            Reintentar
          </button>
        </div>
      ` : ""}
    </div>
  `;
}

function buildApprovalsMobileListMarkup() {
  if (state.mobileApprovals.listLoading) {
    return buildApprovalsMobileStateMarkup("Cargando pendientes", "Preparando la bandeja movil...");
  }

  if (state.mobileApprovals.requests.length === 0) {
    return buildApprovalsMobileStateMarkup(
      "Sin pendientes",
      "No hay solicitudes pendientes por revisar en este momento.",
    );
  }

  return `
    <div class="approvals-mobile-list">
      ${state.mobileApprovals.requests.map((requestRecord) => `
        <button
          class="admin-record-item approvals-mobile-list-button ${Number(state.mobileApprovals.selectedRequestId) === Number(requestRecord.id) ? "is-selected" : ""}"
          data-action="open-approvals-request"
          data-request-id="${requestRecord.id}"
          type="button"
        >
          <div class="admin-record-item-head">
            <strong>Solicitud #${requestRecord.id}</strong>
            <span class="request-status-pill pending">Pendiente</span>
          </div>
          <p>${escapeHtml(getBranchLabel(requestRecord.branch))} · ${escapeHtml(requestRecord.requestedBy)} · ${escapeHtml(requestRecord.supplierName || "Sin proveedor")}</p>
          <p>${escapeHtml(dateTimeFormatter.format(new Date(requestRecord.createdAt)))} · ${escapeHtml(String(requestRecord.itemCount || 0))} lineas · ${formatMerchandiseSignedValue(requestRecord.totalValue)}</p>
          <p>${escapeHtml(requestRecord.itemsSummary || `${requestRecord.itemCount} productos`)}</p>
        </button>
      `).join("")}
    </div>
  `;
}

function buildApprovalsMobileDetailMarkup() {
  if (state.mobileApprovals.detailLoading) {
    return buildApprovalsMobileStateMarkup("Cargando solicitud", "Preparando el detalle completo...");
  }

  const requestRecord = state.mobileApprovals.detail;
  if (!requestRecord) {
    return buildApprovalsMobileStateMarkup(
      "Solicitud no disponible",
      state.mobileApprovals.statusMessage || "No pude abrir esa solicitud. Vuelve a la lista e intenta otra vez.",
      { showRetryButton: true },
    );
  }

  const canActOnRequest = state.mobileApprovals.accessState === "ready"
    && state.online
    && requestRecord.status === "pending"
    && state.mobileApprovals.processing === false;
  const rejectionReason = state.mobileApprovals.rejectReason || "";

  return `
    <div class="approvals-mobile-detail">
      <div class="approvals-mobile-action-row">
        <button class="ghost-button" data-action="approvals-back-to-list" type="button">
          Volver a pendientes
        </button>
      </div>

      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Estado</span>
          <strong>${escapeHtml(getMerchandiseRequestStatusLabel(requestRecord.status))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Sucursal</span>
          <strong>${escapeHtml(getBranchLabel(requestRecord.branch))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Proveedor</span>
          <strong>${escapeHtml(requestRecord.supplierName || "Sin proveedor")}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Valor neto</span>
          <strong>${formatMerchandiseSignedValue(requestRecord.totalValue)}</strong>
        </article>
      </div>

      <div class="approvals-mobile-request-meta">
        <p><strong>Solicitud #${requestRecord.id}</strong><br />${escapeHtml(dateTimeFormatter.format(new Date(requestRecord.createdAt)))}</p>
        <p><strong>Cajera</strong><br />${escapeHtml(requestRecord.requestedBy)}</p>
      </div>

      <div class="detail-lines">
        ${(requestRecord.items || []).map((item) => `
          <div class="approvals-mobile-request-line">
            <div>
              <strong>${escapeHtml(item.productName)}</strong>
              <p>${escapeHtml(getMerchandiseRequestModeLabel(item.mode))} · ${escapeHtml(formatQuantity(item.quantity))} · ${formatCurrency(item.unitPrice)}</p>
            </div>
            <strong>${formatMerchandiseSignedValue(item.totalValue)}</strong>
          </div>
        `).join("")}
      </div>

      ${requestRecord.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(requestRecord.notes)}</p>` : ""}
      ${requestRecord.rejectionReason ? `<p class="sale-notes"><strong>Rechazo:</strong> ${escapeHtml(requestRecord.rejectionReason)}</p>` : ""}

      ${requestRecord.status === "pending" ? `
        <div class="approvals-mobile-action-stack">
          <label class="field">
            <span>Razon para rechazo</span>
            <textarea
              data-role="approvals-reject-reason"
              placeholder="Escribe por que se rechaza esta solicitud."
              ${state.mobileApprovals.processing ? "disabled" : ""}
            >${escapeHtml(rejectionReason)}</textarea>
          </label>
          <div class="approvals-mobile-action-row">
            ${state.mobileApprovals.confirmApprove ? `
              <button
                class="primary-button"
                data-action="confirm-approve-request"
                type="button"
                ${canActOnRequest ? "" : "disabled"}
              >
                ${state.mobileApprovals.processing ? "Procesando..." : "Confirmar aprobacion"}
              </button>
              <button
                class="ghost-button"
                data-action="cancel-approve-request"
                type="button"
                ${state.mobileApprovals.processing ? "disabled" : ""}
              >
                Cancelar
              </button>
            ` : `
              <button
                class="primary-button"
                data-action="prepare-approve-request"
                type="button"
                ${canActOnRequest ? "" : "disabled"}
              >
                Aprobar solicitud
              </button>
            `}
            <button
              class="ghost-button"
              data-action="reject-approvals-request"
              type="button"
              ${canActOnRequest ? "" : "disabled"}
            >
              ${state.mobileApprovals.processing ? "Procesando..." : "Rechazar con motivo"}
            </button>
          </div>
          <p class="modal-note">
            ${!state.online
              ? "Reconecta para aprobar o rechazar esta solicitud."
              : state.mobileApprovals.confirmApprove
                ? "Confirma la aprobacion para aplicar inventario y cerrar la solicitud."
                : "La aprobacion requiere confirmacion. El rechazo exige motivo escrito."}
          </p>
        </div>
      ` : `
        <p class="modal-note">Esta solicitud ya no esta pendiente, asi que solo queda en modo lectura.</p>
      `}
    </div>
  `;
}

function renderApprovalsMobileView() {
  if (!refs.approvalsMobileShell || !refs.approvalsMobileContent) {
    return;
  }

  setApprovalsMobileActive(state.mobileApprovals.active);
  if (!state.mobileApprovals.active) {
    return;
  }

  refs.approvalsMobileCount.textContent = state.mobileApprovals.requests.length
    ? `${state.mobileApprovals.requests.length} pendientes`
    : "Sin pendientes";
  refs.approvalsMobileNetwork.textContent = state.online ? "En linea" : "Offline";
  refs.approvalsMobileStatus.textContent = getApprovalsMobileStatusCopy();

  if (state.mobileApprovals.accessState === "auth-required") {
    refs.approvalsMobileContent.innerHTML = buildApprovalsMobileStateMarkup(
      "Acceso admin requerido",
      getApprovalsMobileStatusCopy(),
      { showLoginButton: state.online },
    );
    return;
  }

  if (state.mobileApprovals.accessState === "access-denied") {
    refs.approvalsMobileContent.innerHTML = buildApprovalsMobileStateMarkup(
      "Acceso denegado",
      getApprovalsMobileStatusCopy(),
    );
    return;
  }

  if (state.mobileApprovals.accessState === "error" && !state.mobileApprovals.selectedRequestId) {
    refs.approvalsMobileContent.innerHTML = buildApprovalsMobileStateMarkup(
      "No pude cargar la bandeja",
      getApprovalsMobileStatusCopy(),
      { showRetryButton: true },
    );
    return;
  }

  refs.approvalsMobileContent.innerHTML = state.mobileApprovals.selectedRequestId
    ? buildApprovalsMobileDetailMarkup()
    : buildApprovalsMobileListMarkup();
}

async function loadApprovalsMobileDetail(requestId, options = {}) {
  if (!state.mobileApprovals.active || !requestId) {
    return null;
  }

  state.mobileApprovals.selectedRequestId = Number(requestId);
  state.mobileApprovals.detailLoading = options.silent !== true;
  state.mobileApprovals.statusMessage = "";
  if (options.resetReason !== false) {
    state.mobileApprovals.rejectReason = "";
  }
  renderApprovalsMobileView();

  try {
    const requestRecord = await fetchAdminMerchandiseRequestDetail(requestId);
    state.mobileApprovals.detail = requestRecord;
    state.mobileApprovals.statusMessage = "";
    return requestRecord;
  } catch (error) {
    state.mobileApprovals.detail = null;
    state.mobileApprovals.accessState = state.admin.authenticated ? "error" : "auth-required";
    state.mobileApprovals.statusMessage = state.admin.authenticated
      ? error.message
      : "La sesion admin vencio. Vuelve a iniciar sesion.";
    return null;
  } finally {
    state.mobileApprovals.detailLoading = false;
    renderApprovalsMobileView();
  }
}

async function loadApprovalsMobileRequests(options = {}) {
  if (!state.mobileApprovals.active) {
    return [];
  }

  state.mobileApprovals.listLoading = options.silent !== true;
  state.mobileApprovals.statusMessage = "";
  renderApprovalsMobileView();

  try {
    state.mobileApprovals.requests = await fetchPendingMerchandiseRequests("all", 60);
    state.mobileApprovals.accessState = "ready";
    if (state.mobileApprovals.selectedRequestId) {
      await loadApprovalsMobileDetail(state.mobileApprovals.selectedRequestId, {
        silent: true,
        resetReason: false,
      });
    }
    return state.mobileApprovals.requests;
  } catch (error) {
    state.mobileApprovals.requests = [];
    state.mobileApprovals.accessState = state.admin.authenticated ? "error" : "auth-required";
    state.mobileApprovals.statusMessage = state.admin.authenticated
      ? error.message
      : "La sesion admin vencio. Vuelve a iniciar sesion.";
    return [];
  } finally {
    state.mobileApprovals.listLoading = false;
    renderApprovalsMobileView();
  }
}

async function ensureApprovalsMobileAccess(options = {}) {
  setApprovalsMobileActive(true);

  if (!state.admin.authenticated) {
    state.mobileApprovals.requests = [];
    state.mobileApprovals.detail = null;
    state.mobileApprovals.accessState = "auth-required";
    state.mobileApprovals.statusMessage = state.online
      ? "Inicia sesion admin para abrir la bandeja de aprobaciones."
      : "Reconecta para validar la sesion admin y abrir la bandeja.";
    renderApprovalsMobileView();
    if (options.autoOpenAuth !== false && state.online) {
      await openAdminAuthModal();
    }
    return false;
  }

  if (state.online) {
    try {
      await loadAdminAuthStatus();
    } catch (error) {
      if (!isNetworkError(error)) {
        state.mobileApprovals.requests = [];
        state.mobileApprovals.detail = null;
        state.mobileApprovals.accessState = "auth-required";
        state.mobileApprovals.statusMessage = "La sesion admin vencio. Vuelve a iniciar sesion.";
        renderApprovalsMobileView();
        if (options.autoOpenAuth !== false) {
          await openAdminAuthModal();
        }
        return false;
      }
    }
  }

  if (!state.admin.authenticated) {
    state.mobileApprovals.requests = [];
    state.mobileApprovals.detail = null;
    state.mobileApprovals.accessState = "auth-required";
    state.mobileApprovals.statusMessage = "La sesion admin vencio. Vuelve a iniciar sesion.";
    renderApprovalsMobileView();
    if (options.autoOpenAuth !== false && state.online) {
      await openAdminAuthModal();
    }
    return false;
  }

  if (state.online) {
    try {
      await refreshCurrentSnapshot();
    } catch (error) {
      if (!isNetworkError(error)) {
        state.mobileApprovals.accessState = "error";
        state.mobileApprovals.statusMessage = error.message;
        renderApprovalsMobileView();
        return false;
      }
    }
  }

  if (!hasEnabledModule("merchandise_requests")) {
    state.mobileApprovals.requests = [];
    state.mobileApprovals.detail = null;
    state.mobileApprovals.accessState = "access-denied";
    state.mobileApprovals.statusMessage = "El modulo de mercaderia esta desactivado en este negocio.";
    renderApprovalsMobileView();
    return false;
  }

  if (!hasAdminCapability("merchandise_requests")) {
    state.mobileApprovals.requests = [];
    state.mobileApprovals.detail = null;
    state.mobileApprovals.accessState = "access-denied";
    state.mobileApprovals.statusMessage = "Tu usuario admin no tiene permiso para aprobar solicitudes de mercaderia.";
    renderApprovalsMobileView();
    return false;
  }

  state.mobileApprovals.accessState = "ready";
  state.mobileApprovals.statusMessage = state.online
    ? ""
    : "Sin conexion. La vista queda en modo lectura hasta reconectar.";
  renderApprovalsMobileView();
  return true;
}

async function syncApprovalsMobileViewFromLocation(options = {}) {
  const locationState = getApprovalsMobileLocationState();
  if (!locationState.active) {
    if (state.mobileApprovals.active) {
      resetApprovalsMobileState();
    }
    setApprovalsMobileActive(false);
    renderApprovalsMobileView();
    return false;
  }

  setApprovalsMobileActive(true);
  if (locationState.requestId !== state.mobileApprovals.selectedRequestId) {
    setApprovalsMobileSelection(locationState.requestId, { updateLocation: false });
  }

  const accessGranted = await ensureApprovalsMobileAccess(options);
  if (!accessGranted) {
    return false;
  }

  await loadApprovalsMobileRequests({ silent: options.silent === true });
  return true;
}

async function openApprovalsMobileRequest(requestId) {
  setApprovalsMobileSelection(requestId);
  state.mobileApprovals.accessState = "ready";
  renderApprovalsMobileView();
  await loadApprovalsMobileDetail(requestId);
}

function closeApprovalsMobileView() {
  resetApprovalsMobileState();
  setApprovalsMobileActive(false);
  replaceApprovalsMobileLocation({ active: false });
  if (refs.adminAuthModal?.classList.contains("open")) {
    closeAdminAuthModal();
  }
}

function handleApprovalsMobileAdminSessionLoss() {
  if (!state.mobileApprovals.active) {
    return;
  }

  resetApprovalsMobileState({
    accessState: "auth-required",
    statusMessage: state.online
      ? "La sesion admin vencio. Vuelve a iniciar sesion para seguir aprobando."
      : "Reconecta para validar otra vez la sesion admin.",
  });
  renderApprovalsMobileView();
}

async function loadAdminMerchandiseRequests(branch = getAdminBranch()) {
  if (!state.admin.authenticated) {
    state.admin.merchandiseRequests = [];
    renderAdminMerchandiseRequests();
    return [];
  }

  try {
    state.admin.merchandiseRequests = await fetchPendingMerchandiseRequests(branch, 60);
    if (typeof markAdminWorkspaceLoaded === "function") {
      markAdminWorkspaceLoaded("requests");
    }
  } catch (_error) {
    state.admin.merchandiseRequests = [];
  } finally {
    renderAdminMerchandiseRequests();
  }

  return state.admin.merchandiseRequests;
}

async function approveCurrentMerchandiseRequest() {
  const requestRecord = state.merchandise.detailRequest;
  if (!requestRecord || state.merchandise.detailProcessing) {
    return;
  }

  state.merchandise.detailProcessing = true;
  renderMerchandiseRequestDetailModal();

  try {
    await sendApproveMerchandiseRequest(requestRecord.id);
    await Promise.all([
      refreshCurrentSnapshot(),
      refreshAdminWorkspace({ requests: true, snapshot: true, editorData: true }),
      loadMyMerchandiseRequests({ silent: true }),
      loadRegisterSummary({ silent: true }),
    ]);
    closeMerchandiseRequestDetailModal();
    showToast(`Solicitud #${requestRecord.id} aprobada.`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.merchandise.detailProcessing = false;
    renderMerchandiseRequestDetailModal();
  }
}

async function rejectCurrentMerchandiseRequest() {
  const requestRecord = state.merchandise.detailRequest;
  if (!requestRecord || state.merchandise.detailProcessing) {
    return;
  }

  const rejectionReason = String(state.merchandise.detailRejectReason || "").trim();
  if (!rejectionReason) {
    showToast("Necesito una razon para rechazar la solicitud.", "error");
    return;
  }

  state.merchandise.detailProcessing = true;
  renderMerchandiseRequestDetailModal();

  try {
    await sendRejectMerchandiseRequest(requestRecord.id, rejectionReason);
    await Promise.all([
      refreshAdminWorkspace({ requests: true }),
      loadMyMerchandiseRequests({ silent: true }),
    ]);
    closeMerchandiseRequestDetailModal();
    showToast(`Solicitud #${requestRecord.id} rechazada.`, "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.merchandise.detailProcessing = false;
    renderMerchandiseRequestDetailModal();
  }
}

async function approveApprovalsMobileRequest() {
  const requestRecord = state.mobileApprovals.detail;
  if (!requestRecord || requestRecord.status !== "pending" || state.mobileApprovals.processing || !state.online) {
    return;
  }

  state.mobileApprovals.processing = true;
  renderApprovalsMobileView();

  try {
    await sendApproveMerchandiseRequest(requestRecord.id);
    const followUpTasks = [
      refreshCurrentSnapshot(),
      loadMyMerchandiseRequests({ silent: true }),
      loadApprovalsMobileRequests({ silent: true }),
    ];
    if (state.cashier.authenticated) {
      followUpTasks.push(loadRegisterSummary({ silent: true }));
    }
    if (refs.adminModal?.classList.contains("open") && state.admin.authenticated) {
      followUpTasks.push(
        refreshAdminWorkspace({ requests: true, snapshot: true, editorData: true }),
      );
    }
    await Promise.allSettled(followUpTasks);
    state.mobileApprovals.confirmApprove = false;
    state.mobileApprovals.rejectReason = "";
    if (state.mobileApprovals.selectedRequestId) {
      await loadApprovalsMobileDetail(state.mobileApprovals.selectedRequestId, {
        silent: true,
        resetReason: false,
      });
    }
    showToast(`Solicitud #${requestRecord.id} aprobada.`, "success");
  } catch (error) {
    state.mobileApprovals.accessState = "error";
    state.mobileApprovals.statusMessage = error.message;
    if (!state.admin.authenticated) {
      state.mobileApprovals.accessState = "auth-required";
    }
    showToast(error.message, "error");
  } finally {
    state.mobileApprovals.processing = false;
    renderApprovalsMobileView();
  }
}

async function rejectApprovalsMobileRequest() {
  const requestRecord = state.mobileApprovals.detail;
  const rejectionReason = String(state.mobileApprovals.rejectReason || "").trim();
  if (!requestRecord || requestRecord.status !== "pending" || state.mobileApprovals.processing || !state.online) {
    return;
  }

  if (!rejectionReason) {
    showToast("Necesito una razon para rechazar la solicitud.", "error");
    return;
  }

  state.mobileApprovals.processing = true;
  renderApprovalsMobileView();

  try {
    await sendRejectMerchandiseRequest(requestRecord.id, rejectionReason);
    const followUpTasks = [
      loadMyMerchandiseRequests({ silent: true }),
      loadApprovalsMobileRequests({ silent: true }),
    ];
    if (refs.adminModal?.classList.contains("open") && state.admin.authenticated) {
      followUpTasks.push(refreshAdminWorkspace({ requests: true }));
    }
    await Promise.allSettled(followUpTasks);
    state.mobileApprovals.confirmApprove = false;
    state.mobileApprovals.rejectReason = "";
    if (state.mobileApprovals.selectedRequestId) {
      await loadApprovalsMobileDetail(state.mobileApprovals.selectedRequestId, {
        silent: true,
        resetReason: false,
      });
    }
    showToast(`Solicitud #${requestRecord.id} rechazada.`, "info");
  } catch (error) {
    state.mobileApprovals.accessState = "error";
    state.mobileApprovals.statusMessage = error.message;
    if (!state.admin.authenticated) {
      state.mobileApprovals.accessState = "auth-required";
    }
    showToast(error.message, "error");
  } finally {
    state.mobileApprovals.processing = false;
    renderApprovalsMobileView();
  }
}

async function handleApprovalsMobileContentClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "approvals-login") {
    if (state.online) {
      await openAdminAuthModal();
    }
    return;
  }

  if (button.dataset.action === "approvals-retry") {
    await syncApprovalsMobileViewFromLocation({ autoOpenAuth: false });
    return;
  }

  if (button.dataset.action === "open-approvals-request") {
    await openApprovalsMobileRequest(button.dataset.requestId);
    return;
  }

  if (button.dataset.action === "approvals-back-to-list") {
    state.mobileApprovals.accessState = "ready";
    state.mobileApprovals.statusMessage = "";
    setApprovalsMobileSelection(null);
    renderApprovalsMobileView();
    return;
  }

  if (button.dataset.action === "prepare-approve-request") {
    state.mobileApprovals.confirmApprove = true;
    renderApprovalsMobileView();
    return;
  }

  if (button.dataset.action === "cancel-approve-request") {
    state.mobileApprovals.confirmApprove = false;
    renderApprovalsMobileView();
    return;
  }

  if (button.dataset.action === "confirm-approve-request") {
    await approveApprovalsMobileRequest();
    return;
  }

  if (button.dataset.action === "reject-approvals-request") {
    await rejectApprovalsMobileRequest();
  }
}

function handleApprovalsMobileContentInput(event) {
  const rejectField = event.target.closest('[data-role="approvals-reject-reason"]');
  if (!rejectField) {
    return;
  }

  state.mobileApprovals.rejectReason = rejectField.value;
}
