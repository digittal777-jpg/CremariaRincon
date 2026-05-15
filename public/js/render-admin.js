function renderAdminModal() {
  if (!refs.adminModal) {
    return;
  }

  if (!refs.adminModal.classList.contains("open")) {
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

  refs.adminMetricsStatus.textContent = state.admin.metricsLoading
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
  const inventoryVisibleRows = refs.inventoryBody?.children?.length || 0;
  refs.adminVisibleProducts.textContent = state.admin.inventoryExpanded
    ? `${inventoryVisibleRows}/${state.products.length}`
    : `Oculto/${state.products.length}`;
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
    ? `Red ${clientMetrics.network.effectiveType} · ${formatQuantity(clientMetrics.network.downlink)} Mbps · ${formatQuantity(clientMetrics.network.rtt)} ms · pendientes ${state.pendingQueue.length}`
    : `Red ${state.online ? "en linea" : "offline"} · pendientes ${state.pendingQueue.length}`;

  if (refs.adminInventoryWrap && refs.toggleAdminInventoryButton && refs.adminInventoryStatus) {
    refs.adminInventoryWrap.hidden = !state.admin.inventoryExpanded;
    refs.toggleAdminInventoryButton.textContent = state.admin.inventoryExpanded
      ? "Ocultar inventario"
      : "Mostrar inventario";
    refs.adminInventoryStatus.textContent = state.admin.inventoryExpanded
      ? "Vista expandida. Puede tardar con catalogos grandes."
      : "Vista compacta. Abre inventario solo cuando lo necesites.";
  }

  renderAdminDevPanel();
  renderAdminWeightedAuditPanel();
} // FIX: llave de cierre de renderAdminModal que faltaba

function renderAdminDevPanel() {
  if (!refs.adminDevSummary) {
    return;
  }

  const snapshotBytes = estimateSerializedBytes(buildPersistedSnapshot());
  const queueBytes = estimateSerializedBytes(state.pendingQueue);
  const registerBytes = estimateSerializedBytes(state.register.events);
  const auditBytes = estimateSerializedBytes(state.admin.auditLogs);
  const statusText = state.syncingQueue ? "Sincronizando" : state.online ? "En linea" : "Offline";

  refs.adminDevSummary.innerHTML = `
    <article class="admin-metric-card">
      <span>Sync offline</span>
      <strong>${statusText}</strong>
      <p>${state.pendingQueue.length} pendientes · ${state.register.events.length} eventos caja</p>
    </article>
    <article class="admin-metric-card">
      <span>Cache snapshot</span>
      <strong>${formatBytes(snapshotBytes)}</strong>
      <p>Cola ${formatBytes(queueBytes)} · cortes ${formatBytes(registerBytes)}</p>
    </article>
    <article class="admin-metric-card">
      <span>Bitacora admin</span>
      <strong>${state.admin.auditLogs.length} registros</strong>
      <p>Carga estimada ${formatBytes(auditBytes)}</p>
    </article>
    <article class="admin-metric-card">
      <span>Vista actual</span>
      <strong>${escapeHtml(getBranchLabel(getAdminBranch()))}</strong>
      <p>Productos render ${state.performance.renderedProductCount} · token ${state.admin.token ? "activo" : "sin token"}</p>
    </article>
  `;
}

function renderAdminRecordLists() {
  if (!refs.adminSalesList) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const sales = state.admin.editorData.sales || [];
  const registerEvents = state.admin.editorData.registerEvents || [];
  const inventoryMovements = state.admin.editorData.inventoryMovements || [];
  const auditLogs = state.admin.auditLogs || [];

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

  if (refs.adminAuditLogList) {
    refs.adminAuditLogList.innerHTML = auditLogs.length
      ? auditLogs
          .map(
            (entry) => `
              <button class="admin-record-item" data-action="open-audit-log" data-id="${entry.id}" type="button">
                <div class="admin-record-item-head">
                  <strong>${escapeHtml(entry.action)}</strong>
                  <span class="small-pill">${escapeHtml(entry.entityType)}</span>
                </div>
                <p>${escapeHtml(getBranchLabel(entry.branch || "all"))} · ${escapeHtml(entry.actorName || "admin")} · ${escapeHtml(dateTimeFormatter.format(new Date(entry.createdAt)))}</p>
              </button>
            `,
          )
          .join("")
      : `<div class="empty-state">Sin cambios recientes en bitacora.</div>`;
  }
}

function renderAdminCashiers() {
  if (!refs.adminCashiersList) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
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
  refs.adminAuthTitle.textContent = isSetup ? "Crear acceso admin" : "Acceso admin";
  refs.adminAuthDescription.textContent = isSetup
    ? "Crea usuario y contrasena para proteger el panel admin."
    : "Ingresa usuario y contrasena para abrir el panel admin.";
  refs.adminAuthPasswordLabel.textContent = isSetup ? "Nueva contrasena" : "Contrasena";
  refs.adminAuthConfirmField.hidden = !isSetup;
  refs.saveAdminAuthButton.textContent = state.adminAuth.loading
    ? "Guardando..."
    : isSetup
      ? "Crear contrasena"
      : "Entrar";
  refs.saveAdminAuthButton.disabled = state.adminAuth.loading;
  refs.adminAuthUsername.disabled = state.adminAuth.loading;
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

function renderAdminWeightedAuditPanel() {
  if (!refs.adminWeightedAuditSessions || !refs.adminWeightedAuditItems || !refs.adminWeightedAuditStatus) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const weightedState = state.admin.weightedAudit || {};
  const sessions = Array.isArray(weightedState.sessions) ? weightedState.sessions : [];
  const currentSession = weightedState.currentSession || null;
  const statusText = weightedState.loading
    ? "Cargando auditorias..."
    : currentSession
      ? `${currentSession.auditedDateKey} · ${currentSession.shift} · ${currentSession.status === "completed" ? "cerrada" : "pendiente"}`
      : "Sin auditoria cargada";
  refs.adminWeightedAuditStatus.textContent = statusText;

  refs.adminWeightedAuditSessions.innerHTML = sessions.length
    ? sessions.map((session) => `
        <button
          class="admin-record-item ${currentSession?.id === session.id ? "active" : ""}"
          data-action="open-weighted-audit-session"
          data-id="${session.id}"
          type="button"
        >
          <div class="admin-record-item-head">
            <strong>${escapeHtml(session.auditedDateKey)} · ${escapeHtml(session.shift)}</strong>
            <span class="small-pill">${escapeHtml(getBranchLabel(session.branch))}</span>
          </div>
          <p>${session.summary?.countedItems || 0}/${session.summary?.totalItems || 0} conteos · Incidentes ${session.summary?.incidentItems || 0}</p>
        </button>
      `).join("")
    : `<div class="empty-state">No hay sesiones para los filtros actuales.</div>`;

  if (!currentSession) {
    refs.adminWeightedAuditItems.innerHTML = `
      <div class="empty-state">
        Crea o abre una sesion para capturar conteos fisicos de productos kg.
      </div>
    `;
    if (refs.saveWeightedAuditItemsButton) {
      refs.saveWeightedAuditItemsButton.disabled = true;
    }
    if (refs.completeWeightedAuditButton) {
      refs.completeWeightedAuditButton.disabled = true;
    }
    return;
  }

  const isCompleted = currentSession.status === "completed";
  const items = Array.isArray(currentSession.items) ? currentSession.items : [];
  refs.adminWeightedAuditItems.innerHTML = `
    <div class="detail-lines">
      <div class="detail-line">
        <div>
          <strong>Resumen de auditoria</strong>
          <p>Productos ${currentSession.summary?.totalItems || 0} · Contados ${currentSession.summary?.countedItems || 0} · Incidentes ${currentSession.summary?.incidentItems || 0}</p>
        </div>
      </div>
    </div>
    <div class="inventory-table-wrap">
      <table class="inventory-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Stock POS</th>
            <th>Conteo fisico</th>
            <th>Diferencia</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr data-weighted-item-row data-item-id="${item.id}" data-product-id="${item.productId}">
              <td>
                <div class="inventory-name">
                  <strong>${escapeHtml(item.productName)}</strong>
                  <small>${escapeHtml(item.unit)}</small>
                </div>
              </td>
              <td>${escapeHtml(formatQuantity(item.posStock))}</td>
              <td>
                <input class="inventory-input" data-field="countedStock" type="number" min="0" step="0.001" value="${item.countedStock == null ? "" : item.countedStock}" ${isCompleted ? "disabled" : ""} />
              </td>
              <td>${item.difference == null ? "-" : escapeHtml(formatQuantity(item.difference))}</td>
              <td>
                <input class="inventory-input" data-field="reason" type="text" maxlength="240" value="${escapeHtml(item.reason || "")}" placeholder="Obligatorio si hay diferencia" ${isCompleted ? "disabled" : ""} />
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (refs.saveWeightedAuditItemsButton) {
    refs.saveWeightedAuditItemsButton.disabled = Boolean(weightedState.loading || weightedState.saving || isCompleted);
    refs.saveWeightedAuditItemsButton.textContent = weightedState.saving ? "Guardando..." : "Guardar conteos";
  }
  if (refs.completeWeightedAuditButton) {
    refs.completeWeightedAuditButton.disabled = Boolean(weightedState.loading || weightedState.saving || isCompleted);
    refs.completeWeightedAuditButton.textContent = isCompleted ? "Auditoria cerrada" : "Cerrar auditoria";
  }
}

function renderAdminWeightedAuditPanel() {
  if (!refs.adminWeightedAuditSessions || !refs.adminWeightedAuditItems || !refs.adminWeightedAuditStatus) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const weightedState = state.admin.weightedAudit || {};
  const sessions = Array.isArray(weightedState.sessions) ? weightedState.sessions : [];
  const currentSession = weightedState.currentSession || null;
  const statusText = weightedState.loading
    ? "Cargando auditorias..."
    : currentSession
      ? `${currentSession.auditedDateKey} · ${currentSession.shift} · ${currentSession.status === "completed" ? "cerrada" : "pendiente"}`
      : "Sin auditoria cargada";
  refs.adminWeightedAuditStatus.textContent = statusText;

  if (refs.adminWeightedAuditSearch) {
    refs.adminWeightedAuditSearch.value = weightedState.search || "";
    refs.adminWeightedAuditSearch.disabled = Boolean(weightedState.loading);
  }
  if (refs.toggleWeightedAuditPendingButton) {
    refs.toggleWeightedAuditPendingButton.classList.toggle("is-active", Boolean(weightedState.showPendingOnly));
    refs.toggleWeightedAuditPendingButton.disabled = Boolean(weightedState.loading || !currentSession);
  }
  if (refs.toggleWeightedAuditIncidentsButton) {
    refs.toggleWeightedAuditIncidentsButton.classList.toggle("is-active", Boolean(weightedState.showIncidentsOnly));
    refs.toggleWeightedAuditIncidentsButton.disabled = Boolean(weightedState.loading || !currentSession);
  }
  if (refs.fillWeightedAuditVisibleButton) {
    refs.fillWeightedAuditVisibleButton.disabled = Boolean(weightedState.loading || !currentSession || currentSession?.status === "completed");
  }
  if (refs.clearWeightedAuditVisibleButton) {
    refs.clearWeightedAuditVisibleButton.disabled = Boolean(weightedState.loading || !currentSession || currentSession?.status === "completed");
  }

  refs.adminWeightedAuditSessions.innerHTML = sessions.length
    ? sessions.map((session) => `
        <button
          class="admin-record-item ${currentSession?.id === session.id ? "active" : ""}"
          data-action="open-weighted-audit-session"
          data-id="${session.id}"
          type="button"
        >
          <div class="admin-record-item-head">
            <strong>${escapeHtml(session.auditedDateKey)} · ${escapeHtml(session.shift)}</strong>
            <span class="small-pill">${escapeHtml(getBranchLabel(session.branch))}</span>
          </div>
          <p>${session.summary?.countedItems || 0}/${session.summary?.totalItems || 0} conteos · Pendientes ${session.summary?.pendingItems || 0} · Incidentes ${session.summary?.incidentItems || 0}</p>
          <p>${escapeHtml(session.createdBy || "Sin origen")} · ${session.status === "completed" ? "Cerrada" : "Pendiente"}</p>
        </button>
      `).join("")
    : `<div class="empty-state">No hay sesiones para los filtros actuales.</div>`;

  if (!currentSession) {
    refs.adminWeightedAuditItems.innerHTML = `
      <div class="empty-state">
        Crea o abre una sesion para capturar conteos fisicos de productos kg. Los cortes finales ya pueden dejar esta sesion preparada automaticamente.
      </div>
    `;
    if (refs.saveWeightedAuditItemsButton) {
      refs.saveWeightedAuditItemsButton.disabled = true;
    }
    if (refs.completeWeightedAuditButton) {
      refs.completeWeightedAuditButton.disabled = true;
    }
    return;
  }

  const isCompleted = currentSession.status === "completed";
  const items = Array.isArray(currentSession.items) ? currentSession.items : [];
  const previewItems = items.map((item) => getWeightedAuditPreviewItem(item));
  const visibleItems = getFilteredWeightedAuditItems(items);
  const summary = buildWeightedAuditPreviewSummary(previewItems);
  const visibleSummary = buildWeightedAuditPreviewSummary(visibleItems);

  refs.adminWeightedAuditItems.innerHTML = `
    <div class="detail-lines">
      <div class="detail-line">
        <div>
          <strong>Resumen de auditoria</strong>
          <p>${escapeHtml(currentSession.createdBy || "Sin origen")} · ${currentSession.completedBy ? `Cerrada por ${escapeHtml(currentSession.completedBy)}` : "Pendiente de cierre"}</p>
        </div>
      </div>
    </div>
    <div class="weighted-audit-summary-grid">
      <article class="weighted-audit-summary-card">
        <span>Conteos</span>
        <strong>${summary.countedItems}/${summary.totalItems}</strong>
        <p>Pendientes ${summary.pendingItems}</p>
      </article>
      <article class="weighted-audit-summary-card">
        <span>Diferencias</span>
        <strong>${summary.incidentItems}</strong>
        <p>Visibles ${visibleSummary.totalItems}</p>
      </article>
      <article class="weighted-audit-summary-card">
        <span>Merma / sobrante</span>
        <strong>${formatQuantity(summary.shortageKg)} / ${formatQuantity(summary.surplusKg)}</strong>
        <p>Kg comprometidos</p>
      </article>
      <article class="weighted-audit-summary-card">
        <span>Impacto</span>
        <strong>${formatCurrency(summary.varianceValue)}</strong>
        <p>${visibleItems.length === items.length ? "Vista completa" : `Filtrado ${visibleItems.length}/${items.length}`}</p>
      </article>
    </div>
    <label class="field weighted-audit-notes-field">
      <span>Notas del reporte</span>
      <textarea data-weighted-session-notes rows="3" ${isCompleted ? "disabled" : ""}>${escapeHtml(weightedState.notesDraft || currentSession.notes || "")}</textarea>
      <small>Guarda contexto del cierre, incidencias del pesado o instrucciones para el admin final.</small>
    </label>
    <div class="inventory-table-wrap">
      <table class="inventory-table">
        <thead>
          <tr>
            <th>Estado</th>
            <th>Producto</th>
            <th>Stock POS</th>
            <th>Conteo fisico</th>
            <th>Diferencia</th>
            <th>Motivo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${visibleItems.map((item) => `
            <tr
              data-weighted-item-row
              data-item-id="${item.id}"
              data-product-id="${item.productId}"
              class="weighted-audit-row ${item.incident ? "weighted-audit-row-incident" : ""} ${item.missingReason ? "weighted-audit-row-needs-reason" : ""}"
            >
              <td>
                <div class="weighted-audit-status-stack">
                  <span class="small-pill weighted-audit-pill ${item.statusKey}${item.missingReason ? " needs-reason" : ""}" data-role="weighted-status">${item.statusLabel}</span>
                  <small data-role="weighted-helper">${item.statusKey === "pending" ? "Aun sin conteo." : item.missingReason ? "Falta motivo para guardar la diferencia." : item.incident ? item.difference < 0 ? `Faltan ${formatQuantity(Math.abs(item.difference))} kg.` : `Sobran ${formatQuantity(item.difference)} kg.` : item.statusKey === "invalid" ? "Captura un numero valido mayor o igual a 0." : "Cuadra con el stock del POS."}</small>
                </div>
              </td>
              <td>
                <div class="inventory-name">
                  <strong>${escapeHtml(item.productName)}</strong>
                  <small>${escapeHtml(item.unit)} · ${formatCurrency(item.unitPrice || 0)} por ${escapeHtml(item.unit)}</small>
                </div>
              </td>
              <td>${escapeHtml(formatQuantity(item.posStock))}</td>
              <td>
                <input class="inventory-input" data-weighted-draft-field="countedStock" type="number" min="0" step="0.001" value="${escapeHtml(item.rawCountedStock)}" ${isCompleted ? "disabled" : ""} />
              </td>
              <td class="weighted-audit-difference ${item.statusKey}" data-role="weighted-difference">${item.statusKey === "pending" ? "-" : item.statusKey === "invalid" ? "Invalido" : `${item.difference > 0 ? "+" : ""}${escapeHtml(formatQuantity(item.difference))}`}</td>
              <td>
                <input class="inventory-input" data-weighted-draft-field="reason" type="text" maxlength="240" value="${escapeHtml(item.reason || "")}" placeholder="${item.reasonRequired ? "Motivo obligatorio si hay diferencia" : "Sin diferencia o nota opcional"}" ${isCompleted ? "disabled" : ""} />
              </td>
              <td>
                <div class="weighted-audit-row-actions">
                  <button class="ghost-button compact-button" data-action="weighted-audit-set-pos" data-item-id="${item.id}" type="button" ${isCompleted ? "disabled" : ""}>
                    Igualar
                  </button>
                  <button class="ghost-button compact-button" data-action="weighted-audit-set-zero" data-item-id="${item.id}" type="button" ${isCompleted ? "disabled" : ""}>
                    0 kg
                  </button>
                  <button class="ghost-button compact-button" data-action="weighted-audit-clear-row" data-item-id="${item.id}" type="button" ${isCompleted ? "disabled" : ""}>
                    Limpiar
                  </button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (visibleItems.length === 0) {
    refs.adminWeightedAuditItems.insertAdjacentHTML(
      "beforeend",
      `<div class="empty-state">No hay productos kg visibles con los filtros actuales.</div>`,
    );
  }

  refs.adminWeightedAuditItems
    .querySelectorAll("[data-weighted-item-row]")
    .forEach((row) => syncWeightedAuditRowPreview(row));

  if (refs.saveWeightedAuditItemsButton) {
    refs.saveWeightedAuditItemsButton.disabled = Boolean(weightedState.loading || weightedState.saving || isCompleted);
    refs.saveWeightedAuditItemsButton.textContent = weightedState.saving ? "Guardando..." : "Guardar conteos";
  }
  if (refs.completeWeightedAuditButton) {
    refs.completeWeightedAuditButton.disabled = Boolean(weightedState.loading || weightedState.saving || isCompleted);
    refs.completeWeightedAuditButton.textContent = isCompleted ? "Auditoria cerrada" : "Cerrar auditoria";
  }
}
