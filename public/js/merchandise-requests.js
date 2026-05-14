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
  return product?.unit === "pza" ? 1 : 0.001;
}

function getMerchandiseRequestQuantityInputStep(product) {
  return product?.unit === "pza" ? 1 : 0.001;
}

function getMerchandiseRequestAdjustStep(product) {
  return product?.unit === "pza" ? 1 : 0.25;
}

function normalizeMerchandiseRequestQuantity(value, product) {
  if (product?.unit === "pza") {
    return Math.max(1, Math.round(toNumber(value, 1)));
  }

  return roundStock(
    Math.max(getMerchandiseRequestQuantityMin(product), toNumber(value, getMerchandiseRequestQuantityMin(product))),
  );
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
    return {
      ...item,
      productName: product.name,
      unit: product.unit,
      categoryLabel: product.categoryLabel,
      unitPrice,
      totalValue: roundMoney(unitPrice * item.quantity * (item.mode === "receive" ? 1 : -1)),
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

function syncMerchandiseRequestItemTotal() {
  if (!state.merchandise.currentProduct || !refs.merchandiseRequestItemTotal) {
    return;
  }

  const quantity = normalizeMerchandiseRequestQuantity(
    state.merchandise.currentQuantity || refs.merchandiseRequestItemQuantity?.value,
    state.merchandise.currentProduct,
  );
  state.merchandise.currentQuantity = String(quantity);

  if (refs.merchandiseRequestItemQuantity) {
    refs.merchandiseRequestItemQuantity.value = String(quantity);
  }

  const unitPrice = roundMoney(state.merchandise.currentProduct.price);
  const signedMultiplier = state.merchandise.currentMode === "return" ? -1 : 1;
  refs.merchandiseRequestItemUnitPrice.value = unitPrice.toFixed(2);
  refs.merchandiseRequestItemTotal.value = roundMoney(
    quantity * unitPrice * signedMultiplier,
  ).toFixed(2);
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

  const signedMultiplier = state.merchandise.currentMode === "return" ? -1 : 1;
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
  const totalValue = roundMoney(unitPrice * quantity * (mode === "receive" ? 1 : -1));
  const existingIndex = state.merchandise.items.findIndex(
    (item) => item.productId === product.id && item.mode === mode,
  );

  if (existingIndex >= 0) {
    const currentItem = state.merchandise.items[existingIndex];
    const nextQuantity = roundStock(currentItem.quantity + quantity);
    state.merchandise.items[existingIndex] = {
      ...currentItem,
      quantity: nextQuantity,
      unitPrice,
      totalValue: roundMoney(unitPrice * nextQuantity * (mode === "receive" ? 1 : -1)),
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
  renderMerchandiseRequestDetailModal();
  setModalOpen(refs.merchandiseRequestDetailModal, true);
}

async function openAdminMerchandiseRequestDetail(requestId) {
  state.merchandise.detailRequest = null;
  state.merchandise.detailAdminMode = true;
  state.merchandise.detailLoading = true;
  state.merchandise.detailProcessing = false;
  renderMerchandiseRequestDetailModal();
  setModalOpen(refs.merchandiseRequestDetailModal, true);

  try {
    const response = await requestAdminJson(`/api/merchandise-requests/${requestId}`);
    state.merchandise.detailRequest = response.request || null;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.merchandise.detailLoading = false;
    renderMerchandiseRequestDetailModal();
  }
}

function closeMerchandiseRequestDetailModal() {
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

async function loadAdminMerchandiseRequests(branch = getAdminBranch()) {
  if (!state.admin.token) {
    state.admin.merchandiseRequests = [];
    renderAdminMerchandiseRequests();
    return [];
  }

  try {
    const response = await requestAdminJson(
      `/api/merchandise-requests/pending?branch=${encodeURIComponent(branch)}&limit=60`,
    );
    state.admin.merchandiseRequests = Array.isArray(response.requests) ? response.requests : [];
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
    await requestAdminJson(`/api/merchandise-requests/${requestRecord.id}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
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

  const rejectionReason = window.prompt(
    `Escribe la razon de rechazo para la solicitud #${requestRecord.id}:`,
    requestRecord.rejectionReason || "",
  );

  if (rejectionReason == null) {
    return;
  }

  if (!String(rejectionReason).trim()) {
    showToast("Necesito una razon para rechazar la solicitud.", "error");
    return;
  }

  state.merchandise.detailProcessing = true;
  renderMerchandiseRequestDetailModal();

  try {
    await requestAdminJson(`/api/merchandise-requests/${requestRecord.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ rejectionReason: String(rejectionReason).trim() }),
    });
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
