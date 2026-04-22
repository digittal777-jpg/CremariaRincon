// Renderizado del panel de administración

// FIX: faltaba "function renderAdminModal() {" — el cuerpo estaba suelto,
// causando "Illegal return statement" y que renderAdminModal no estuviera definida.
function renderAdminModal() {
  if (!refs.adminModal) {
    return;
  }

  if (!refs.adminModal.classList.contains("open") && !state.admin.loading) {
    return;
  }

  const adminSnapshot = state.admin.snapshot;
  const serverMetrics = state.admin.metrics;
  const clientMetrics = getClientMetrics();
  const currentBranch = adminSnapshot?.store?.currentBranch || getAdminBranch();
  const currentBranchLabel =
    adminSnapshot?.store?.currentBranchLabel || getBranchLabel(currentBranch);
  const summary = adminSnapshot?.summary || state.summary;
  const shiftSummary = Array.isArray(adminSnapshot?.shiftSummary)
    ? adminSnapshot.shiftSummary
    : [];

  setSelectOptions(refs.adminBranchSelect, getBranchOptions(), currentBranch);
  state.admin.branch = currentBranch;

  if (refs.adminBranchTitle) {
    refs.adminBranchTitle.textContent = currentBranchLabel;
  }

  if (refs.adminBranchDescription) {
    refs.adminBranchDescription.textContent =
      currentBranch === "all"
        ? "Admin viendo ventas y movimientos de ambas sucursales al mismo tiempo."
        : `Admin enfocado en ${currentBranchLabel} sin mover la caja activa.`;
  }

  if (refs.adminSummaryCards) {
    const topProductText = summary.topProduct
      ? `${summary.topProduct.name} lidera con ${formatCurrency(summary.topProduct.total)}`
      : "Sin ventas registradas hoy";

    refs.adminSummaryCards.innerHTML = `
      <article class="admin-metric-card">
        <span>Ventas del dia</span>
        <strong>${formatCurrency(summary.revenueToday || 0)}</strong>
        <p>${formatQuantity(summary.ticketsToday || 0)} tickets</p>
      </article>
      <article class="admin-metric-card">
        <span>Ticket promedio</span>
        <strong>${formatCurrency(summary.averageTicket || 0)}</strong>
        <p>${formatQuantity(summary.unitsSoldToday || 0)} unidades</p>
      </article>
      <article class="admin-metric-card">
        <span>Inventario</span>
        <strong>${formatCurrency(summary.inventoryValue || 0)}</strong>
        <p>${formatQuantity(summary.catalogSize || 0)} productos activos</p>
      </article>
      <article class="admin-metric-card">
        <span>Alertas</span>
        <strong>${formatQuantity(summary.lowStockCount || 0)}</strong>
        <p>${escapeHtml(topProductText)}</p>
      </article>
    `;
  }

  if (refs.adminShiftSummary) {
    refs.adminShiftSummary.innerHTML = shiftSummary.length
      ? shiftSummary
          .map(
            (item) => `
              <div class="shift-chip">
                ${escapeHtml(item.shift)} · ${formatQuantity(item.tickets)} tickets · ${formatCurrency(item.total)}
              </div>
            `,
          )
          .join("")
      : `<div class="shift-chip">Sin tickets registrados en esta vista.</div>`;
  }

  refs.adminMetricsStatus.textContent = state.admin.loading
    ? "Actualizando..."
    : serverMetrics
      ? `Actualizado ${timeFormatter.format(new Date(serverMetrics.generatedAt))}`
      : "Esperando datos";
  refs.adminProcessCpu.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.cpuPercent)}%`
    : "0%";
  refs.adminProcessMemory.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.rssMb)} MB`
    : "0 MB";
  refs.adminProductsRender.textContent = `${formatQuantity(state.performance.productsRenderMs)} ms`;
  refs.adminSnapshotRender.textContent = `${formatQuantity(state.performance.snapshotRenderMs)} ms`;
  refs.adminVisibleProducts.textContent = `${state.performance.renderedProductCount}/${state.products.length}`;
  refs.adminDomNodes.textContent = formatQuantity(clientMetrics.domNodes);
  refs.adminServerRuntime.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.uptimeSeconds)} s`
    : "0 s";
  refs.adminServerMemory.textContent = serverMetrics
    ? `RAM sistema ${formatQuantity(serverMetrics.system.usedMemoryPercent)}% · ${serverMetrics.system.cpuCount} CPU`
    : "RAM sistema 0%";
  refs.adminClientMemory.textContent =
    clientMetrics.usedHeapMb != null
      ? `${formatQuantity(clientMetrics.usedHeapMb)} MB JS`
      : "Sin dato";
  refs.adminClientHardware.textContent =
    `CPU ${formatQuantity(clientMetrics.hardwareConcurrency)} · RAM ${formatQuantity(clientMetrics.deviceMemory)} GB`;
  refs.adminClientNetwork.textContent = clientMetrics.network
    ? `Red ${clientMetrics.network.effectiveType} · ${formatQuantity(clientMetrics.downlink)} Mbps · ${formatQuantity(clientMetrics.rtt)} ms · pendientes ${state.pendingQueue.length}`
    : `Red ${state.online ? "en linea" : "offline"} · pendientes ${state.pendingQueue.length}`;
} // FIX: llave de cierre de renderAdminModal que faltaba

function renderAdminRecordLists() {
  if (!refs.adminSalesList) {
    return;
  }

  const sales = state.admin.editorData.sales || [];
  const registerEvents = state.admin.editorData.registerEvents || [];
  const inventoryMovements = state.admin.editorData.inventoryMovements || [];

  refs.adminSalesList.innerHTML = sales.length
    ? sales
        .map(
          (sale) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="sale" data-id="${sale.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(sale.ticketNumber)}</strong>
                <span class="small-pill">${formatCurrency(sale.total)}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(sale.branch))} · ${escapeHtml(sale.cashier)} · ${escapeHtml(sale.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin ventas recientes para editar.</div>`;

  refs.adminRegisterEventsList.innerHTML = registerEvents.length
    ? registerEvents
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="register" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(getRegisterEventLabel(item.eventType))}</strong>
                <span class="small-pill">${formatCurrency(item.countedAmount)}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(item.branch))} · ${escapeHtml(item.cashier)} · ${escapeHtml(item.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin cortes o inicios recientes.</div>`;

  refs.adminInventoryMovementsList.innerHTML = inventoryMovements.length
    ? inventoryMovements
        .map(
          (item) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="inventory" data-id="${item.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(item.productName)}</strong>
                <span class="small-pill">${item.quantityDelta >= 0 ? "+" : ""}${escapeHtml(formatQuantity(item.quantityDelta))}</span>
              </div>
              <p>${escapeHtml(getBranchLabel(item.branch))} · ${escapeHtml(getInventoryMovementLabel(item.movementType))} · ${escapeHtml(dateTimeFormatter.format(new Date(item.createdAt)))}</p>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state">Sin movimientos recientes para editar.</div>`;
}

function renderAdminCashiers() {
  if (!refs.adminCashiersList) {
    return;
  }

  refs.adminCashiersList.innerHTML = state.admin.cashiers.length
    ? state.admin.cashiers
        .map(
          (cashier) => `
            <article class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(cashier.name)}</strong>
                <span class="small-pill">${escapeHtml(getBranchLabel(cashier.branch))}</span>
              </div>
              <p>${cashier.active ? "Activo" : "Inactivo"} · Alta ${escapeHtml(dateFormatter.format(new Date(cashier.created_at)))}</p>
              <div class="admin-record-actions">
                <button class="secondary-button compact-button" data-action="edit-cashier" data-id="${cashier.id}" type="button">
                  Editar
                </button>
                <button class="ghost-button compact-button" data-action="toggle-cashier" data-id="${cashier.id}" data-active="${cashier.active ? "1" : "0"}" type="button">
                  ${cashier.active ? "Desactivar" : "Activar"}
                </button>
                <button class="ghost-button compact-button danger-button" data-action="delete-cashier" data-id="${cashier.id}" type="button">
                  Eliminar
                </button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">No hay cajeros registrados para esta vista.</div>`;
}

function renderAdminAuthModal() {
  if (!refs.adminAuthModal) {
    return;
  }

  const isSetup = state.adminAuth.mode === "setup";
  refs.adminAuthTitle.textContent = isSetup ? "Crear contrasena admin" : "Acceso admin";
  refs.adminAuthDescription.textContent = isSetup
    ? "Configura la contrasena para proteger el panel admin."
    : "Ingresa la contrasena para abrir el panel admin.";
  refs.adminAuthPasswordLabel.textContent = isSetup ? "Nueva contrasena" : "Contrasena";
  refs.adminAuthConfirmField.hidden = !isSetup;
  refs.saveAdminAuthButton.textContent = state.adminAuth.loading
    ? "Guardando..."
    : isSetup
      ? "Crear contrasena"
      : "Entrar";
  refs.saveAdminAuthButton.disabled = state.adminAuth.loading;
  refs.adminAuthPassword.disabled = state.adminAuth.loading;
  refs.adminAuthConfirmPassword.disabled = state.adminAuth.loading;
}

function renderAdminEditorModal() {
  if (!refs.adminEditorModal) {
    return;
  }

  const { kind, detail, loading, saving } = state.adminEditor;
  if (loading) {
    refs.adminEditorTitle.textContent = "Cargando...";
    refs.adminEditorDescription.textContent = "Preparando formulario de edicion.";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Cargando datos...</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  if (!detail) {
    refs.adminEditorTitle.textContent = "Sin registro";
    refs.adminEditorDescription.textContent = "";
    refs.adminEditorBody.innerHTML = `<div class="empty-state">Selecciona un registro para editar.</div>`;
    refs.saveAdminEditorButton.disabled = true;
    return;
  }

  refs.saveAdminEditorButton.disabled = saving;
  refs.saveAdminEditorButton.textContent = saving ? "Guardando..." : "Guardar cambios";

  if (kind === "cashier") {
    refs.adminEditorTitle.textContent = `Editar acceso de ${detail.name}`;
    refs.adminEditorDescription.textContent = "Actualiza nombre, sucursal, estado y la nueva clave si la necesitas.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Nombre</span>
        <input data-editor-field="name" type="text" maxlength="60" value="${escapeHtml(detail.name)}" />
      </label>
      <label class="field">
        <span>Sucursal</span>
        <select data-editor-field="branch">
          ${getBranchOptions().filter((option) => option.value !== "all").map((option) => `<option value="${option.value}" ${detail.branch === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Nueva contrasena</span>
        <input data-editor-field="password" type="password" maxlength="60" placeholder="Deja vacio para conservar la actual" />
      </label>
      <label class="field">
        <span>Estado</span>
        <select data-editor-field="active">
          <option value="true" ${detail.active ? "selected" : ""}>Activo</option>
          <option value="false" ${detail.active ? "" : "selected"}>Inactivo</option>
        </select>
      </label>
    `;
    return;
  }

  if (kind === "sale") {
    refs.adminEditorTitle.textContent = `Editar ${detail.ticketNumber}`;
    refs.adminEditorDescription.textContent = "Puedes ajustar datos administrativos de la venta.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Metodo de pago</span>
        <select data-editor-field="paymentMethod">
          ${["Efectivo", "Tarjeta", "Transferencia"].map((method) => `<option value="${method}" ${detail.paymentMethod === method ? "selected" : ""}>${method}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Recibido</span>
        <input data-editor-field="receivedAmount" type="number" min="0" step="0.01" value="${detail.receivedAmount}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="240" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  if (kind === "register") {
    refs.adminEditorTitle.textContent = `Editar ${getRegisterEventLabel(detail.eventType)}`;
    refs.adminEditorDescription.textContent = "Ajusta datos del inicio o corte de caja.";
    refs.adminEditorBody.innerHTML = `
      <label class="field">
        <span>Turno</span>
        <select data-editor-field="shift">
          ${getShiftOptionsMarkup(detail.shift)}
        </select>
      </label>
      <label class="field">
        <span>Cajero</span>
        <input data-editor-field="cashier" type="text" value="${escapeHtml(detail.cashier)}" />
      </label>
      <label class="field">
        <span>Caja inicial</span>
        <input data-editor-field="openingAmount" type="number" min="0" step="0.01" value="${detail.openingAmount}" />
      </label>
      <label class="field">
        <span>Efectivo contado</span>
        <input data-editor-field="countedAmount" type="number" min="0" step="0.01" value="${detail.countedAmount}" />
      </label>
      <label class="field">
        <span>Efectivo esperado</span>
        <input data-editor-field="expectedCash" type="number" min="0" step="0.01" value="${detail.expectedCash}" />
      </label>
      <label class="field">
        <span>Se retira</span>
        <input data-editor-field="withdrawalsAmount" type="number" min="0" step="0.01" value="${detail.withdrawalsAmount || 0}" />
      </label>
      <label class="field">
        <span>Nota</span>
        <input data-editor-field="notes" type="text" maxlength="180" value="${escapeHtml(detail.notes || "")}" />
      </label>
    `;
    return;
  }

  refs.adminEditorTitle.textContent = `Editar ${detail.productName}`;
  refs.adminEditorDescription.textContent =
    detail.movementType === "sale"
      ? "Los movimientos por venta solo permiten editar la nota."
      : "Puedes ajustar cantidad y nota del movimiento.";
  refs.adminEditorBody.innerHTML = `
    <label class="field">
      <span>Movimiento</span>
      <input type="text" value="${escapeHtml(getInventoryMovementLabel(detail.movementType))}" disabled />
    </label>
    <label class="field">
      <span>Cantidad delta</span>
      <input data-editor-field="quantityDelta" type="number" step="0.25" value="${detail.quantityDelta}" ${detail.movementType === "sale" ? "disabled" : ""} />
    </label>
    <label class="field">
      <span>Nota</span>
      <input data-editor-field="note" type="text" maxlength="120" value="${escapeHtml(detail.note || "")}" />
    </label>
  `;
}

function renderCashierAuthModal() {
  if (!refs.cashierAuthModal) {
    return;
  }

  refs.loginCashierButton.disabled = state.cashierAuth.loading;
  refs.loginCashierButton.textContent = state.cashierAuth.loading ? "Iniciando..." : "Iniciar sesion";
}