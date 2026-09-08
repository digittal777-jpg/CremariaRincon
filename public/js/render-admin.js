function getAdminInventoryChromeProducts() {
  if (state.admin.branch === "all" && Array.isArray(state.admin.inventoryComparison?.branches)) {
    return state.admin.inventoryComparison.branches.flatMap((branchEntry) =>
      Array.isArray(branchEntry.products) ? branchEntry.products : [],
    );
  }
  return Array.isArray(state.admin.inventoryProducts) ? state.admin.inventoryProducts : [];
}

function updateAdminInventoryChrome(inventoryVisibleRows, inventoryTotal) {
  const inventoryMode = normalizeAdminInventoryMode(state.admin.inventoryMode);
  const isEditMode = inventoryMode === "edit";
  const isExpanded = isEditMode && Boolean(state.admin.inventoryExpanded);

  if (refs.adminVisibleProducts) {
    refs.adminVisibleProducts.textContent = isEditMode
      ? isExpanded
        ? `${inventoryVisibleRows}/${inventoryTotal}`
        : `Oculto/${inventoryTotal}`
      : `Rapido/${inventoryTotal}`;
  }

  if (refs.adminInventoryModeBar) {
    refs.adminInventoryModeBar.querySelectorAll("[data-inventory-mode]").forEach((button) => {
      const isActive = button.dataset.inventoryMode === inventoryMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  if (refs.adminInventoryMovementPanel) {
    refs.adminInventoryMovementPanel.hidden = isEditMode;
  }
  if (refs.adminInventoryFilterBar) {
    refs.adminInventoryFilterBar.hidden = !isExpanded;
  }
  if (refs.adminProductCreateForm) {
    refs.adminProductCreateForm.hidden = !isExpanded;
  }
  if (refs.adminOnboardingPanel) {
    refs.adminOnboardingPanel.hidden = !isExpanded;
  }
  if (refs.adminTableHint) {
    refs.adminTableHint.hidden = !isExpanded;
  }
  if (refs.adminInventorySearch && refs.adminInventorySearch.value !== state.admin.inventorySearch) {
    refs.adminInventorySearch.value = state.admin.inventorySearch || "";
  }
  if (isExpanded && typeof renderAdminInventoryFilterChips === "function") {
    renderAdminInventoryFilterChips(getAdminInventoryChromeProducts());
  }
  if (refs.adminInventoryWrap) {
    refs.adminInventoryWrap.hidden = !isExpanded;
  }
  if (refs.toggleAdminInventoryButton) {
    refs.toggleAdminInventoryButton.textContent = isEditMode
      ? isExpanded
        ? "Cerrar catalogo avanzado"
        : "Abrir catalogo avanzado"
      : "Abrir catalogo avanzado";
  }
  if (refs.adminInventoryStatus) {
    refs.adminInventoryStatus.textContent = isEditMode
      ? isExpanded
        ? "Catalogo avanzado abierto: busca un producto y edita solo el que necesites."
        : "Catalogo avanzado listo. Abrelo solo para cambiar productos, precios o importar listas."
      : "Elige una tarea diaria: entrada, salida o conteo fisico.";
  }
}

const ADMIN_ONBOARDING_FIELDS = [
  { key: "name", label: "Producto", required: true },
  { key: "price", label: "Precio", required: true },
  { key: "category", label: "Categoria" },
  { key: "unit", label: "Unidad" },
  { key: "stock", label: "Existencia" },
  { key: "minStock", label: "Minimo" },
  { key: "cost", label: "Costo" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Codigo barras" },
  { key: "brand", label: "Marca" },
  { key: "supplierName", label: "Proveedor" },
  { key: "packSize", label: "Contenido" },
  { key: "active", label: "Activo" },
];

function renderAdminProductOnboarding() {
  if (!refs.adminOnboardingPanel) {
    return;
  }

  const onboarding = state.admin.onboarding || {};
  const preview = onboarding.preview || null;
  const summary = preview?.summary || {};
  const hasFile = Boolean(onboarding.file);
  const hasErrors = Number(summary.errors || 0) > 0;
  const canApply = hasFile && preview && !hasErrors && !onboarding.loading && !onboarding.applying;

  if (refs.adminOnboardingStatus) {
    refs.adminOnboardingStatus.textContent = onboarding.loading
      ? "Leyendo..."
      : onboarding.applying
        ? "Importando..."
        : preview
          ? `${formatQuantity(summary.create || 0)} altas / ${formatQuantity(summary.update || 0)} cambios`
          : hasFile
            ? onboarding.file.name
            : "Sin archivo";
  }

  if (refs.previewAdminOnboardingButton) {
    refs.previewAdminOnboardingButton.disabled = !hasFile || onboarding.loading || onboarding.applying;
    refs.previewAdminOnboardingButton.textContent = onboarding.loading ? "Leyendo..." : "Revisar archivo";
  }
  if (refs.applyAdminOnboardingButton) {
    refs.applyAdminOnboardingButton.disabled = !canApply;
    refs.applyAdminOnboardingButton.textContent = onboarding.applying ? "Importando..." : "Importar productos revisados";
  }

  if (refs.adminOnboardingMapping) {
    const columns = Array.isArray(preview?.columns) ? preview.columns : [];
    const mapping = onboarding.mapping || preview?.mapping || {};
    refs.adminOnboardingMapping.innerHTML = columns.length
      ? ADMIN_ONBOARDING_FIELDS.map((field) => {
          const selected = Object.prototype.hasOwnProperty.call(mapping, field.key)
            && Number.isInteger(Number(mapping[field.key]))
            ? String(mapping[field.key])
            : "";
          const options = [
            `<option value="">No usar</option>`,
            ...columns.map((column) => `
              <option value="${column.index}" ${selected === String(column.index) ? "selected" : ""}>
                ${escapeHtml(column.label)}
              </option>
            `),
          ].join("");
          return `
            <label class="field admin-onboarding-map-field">
              <span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>
              <select data-onboarding-field="${escapeHtml(field.key)}">${options}</select>
            </label>
          `;
        }).join("")
      : "";
  }

  if (!refs.adminOnboardingPreview) {
    return;
  }

  if (!preview) {
    refs.adminOnboardingPreview.innerHTML = onboarding.status
      ? `<div class="empty-state">${escapeHtml(onboarding.status)}</div>`
      : `<div class="empty-state">Carga un CSV o Excel para revisar columnas, duplicados y coincidencias antes de cambiar el catalogo.</div>`;
    return;
  }

  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  const visibleRows = rows.slice(0, 12);
  const statusLabel = hasErrors
    ? `${formatQuantity(summary.errors || 0)} con error`
    : `${formatQuantity(summary.total || 0)} listos`;
  refs.adminOnboardingPreview.innerHTML = `
    <article class="admin-record-item admin-onboarding-summary">
      <div class="admin-record-item-head">
        <strong>${statusLabel}</strong>
        <span class="small-pill">${formatQuantity(summary.warnings || 0)} avisos</span>
      </div>
      <p>${formatQuantity(summary.create || 0)} nuevos - ${formatQuantity(summary.update || 0)} actualizaciones - sucursal ${escapeHtml(getBranchLabel(preview.branch))}</p>
    </article>
    ${visibleRows.map((row) => {
      const product = row.product || {};
      const messages = [...(row.errors || []), ...(row.warnings || [])];
      return `
        <article class="admin-record-item admin-onboarding-row ${row.status === "error" ? "needs-attention" : ""}">
          <div class="admin-record-item-head">
            <strong>Fila ${formatQuantity(row.rowNumber)} - ${escapeHtml(product.name || "Sin producto")}</strong>
            <span class="small-pill">${row.status === "update" ? "Actualizar" : row.status === "create" ? "Crear" : "Error"}</span>
          </div>
          <p>${formatCurrency(product.price || 0)} - ${escapeHtml(product.categoryLabel || product.category || "general")} - ${escapeHtml(product.unitLabel || product.unit || "pza")} - stock ${formatQuantity(product.stock || 0)}</p>
          ${messages.length ? `<p>${messages.map(escapeHtml).join(" / ")}</p>` : ""}
        </article>
      `;
    }).join("")}
    ${rows.length > visibleRows.length ? `<div class="empty-state">Mostrando 12 de ${formatQuantity(rows.length)} filas.</div>` : ""}
  `;
}

function renderAdminPerformanceMetrics() {
  if (!refs.adminModal?.classList.contains("open") || !refs.adminMetricsStatus) {
    return;
  }

  const serverMetrics = state.admin.metrics;
  const clientMetrics = getClientMetrics();

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
  if (refs.adminRouteQuickAdd) {
    refs.adminRouteQuickAdd.textContent = `${formatQuantity(state.performance.routeQuickAddMs)} ms`;
  }
  if (refs.adminRouteQuickAddDetail) {
    refs.adminRouteQuickAddDetail.textContent =
      `${formatQuantity(state.performance.routeQuickAddCount)} altas`;
  }
  if (refs.adminRouteEditorOpen) {
    refs.adminRouteEditorOpen.textContent =
      `${formatQuantity(state.performance.routeCartEditorOpenMs)} ms`;
  }
  if (refs.adminRouteEditorOpenDetail) {
    refs.adminRouteEditorOpenDetail.textContent =
      `${formatQuantity(state.performance.routeCartEditorOpenCount)} aperturas`;
  }

  const comparisonBranchOneRows = document.getElementById("inventory-body-branch-1")?.children?.length || 0;
  const comparisonBranchTwoRows = document.getElementById("inventory-body-branch-2")?.children?.length || 0;
  const inventoryVisibleRows = state.admin.branch === "all"
    ? comparisonBranchOneRows + comparisonBranchTwoRows
    : refs.inventoryBody?.children?.length || 0;
  const comparisonInventoryTotal = Array.isArray(state.admin.inventoryComparison?.branches)
    ? state.admin.inventoryComparison.branches.reduce(
        (sum, branchEntry) => sum + (Array.isArray(branchEntry.products) ? branchEntry.products.length : 0),
        0,
      )
    : 0;
  const inventoryTotal = state.admin.branch === "all"
    ? comparisonInventoryTotal
    : Array.isArray(state.admin.inventoryProducts)
      ? state.admin.inventoryProducts.length
      : 0;
  updateAdminInventoryChrome(inventoryVisibleRows, Number(state.admin.inventoryPage?.total || inventoryTotal));
  refs.adminDomNodes.textContent = formatQuantity(clientMetrics.domNodes);
  refs.adminServerRuntime.textContent = serverMetrics
    ? `${formatQuantity(serverMetrics.process.uptimeSeconds)} s`
    : "0 s";
  refs.adminServerMemory.textContent = serverMetrics
    ? `RAM sistema ${formatQuantity(serverMetrics.system.usedMemoryPercent)}% - ${serverMetrics.system.cpuCount} CPU`
    : "RAM sistema 0%";
  refs.adminClientMemory.textContent =
    clientMetrics.usedHeapMb != null
      ? `${formatQuantity(clientMetrics.usedHeapMb)} MB JS`
      : "Sin dato";
  refs.adminClientHardware.textContent =
    `CPU ${formatQuantity(clientMetrics.hardwareConcurrency)} - RAM ${formatQuantity(clientMetrics.deviceMemory)} GB`;
  refs.adminClientNetwork.textContent = clientMetrics.network
    ? `Red ${clientMetrics.network.effectiveType} - ${formatQuantity(clientMetrics.network.downlink)} Mbps - ${formatQuantity(clientMetrics.network.rtt)} ms - pendientes ${state.pendingQueue.length}`
    : `Red ${state.online ? "en linea" : "offline"} - pendientes ${state.pendingQueue.length}`;
}

function formatAdminDateKey(value) {
  return value ? String(value) : "sin fecha";
}

function formatAdminTimestamp(value) {
  if (!value) {
    return "sin registro";
  }
  try {
    return dateTimeFormatter.format(new Date(value));
  } catch (_error) {
    return String(value);
  }
}

function getAdminSeverityLabel(severity) {
  if (severity === "critical") return "Critico";
  if (severity === "risk") return "Riesgo";
  if (severity === "ok") return "OK";
  return "Info";
}

function getAdminHealthLabel(status) {
  if (status === "critical") return "Critico";
  if (status === "risk") return "Riesgo";
  if (status === "ok") return "Sano";
  return "Sin lectura";
}

function renderAdminActionList(container, items, emptyMessage) {
  if (!container) {
    return;
  }

  const safeItems = Array.isArray(items) ? items : [];
  container.innerHTML = safeItems.length
    ? safeItems.map((item) => `
        <article class="admin-action-item ${sanitizeClassToken(item.severity, "info")}">
          <div class="admin-record-item-head">
            <strong>${escapeHtml(item.title || item.code || item.message || "Accion")}</strong>
            <span class="small-pill">${escapeHtml(getAdminSeverityLabel(item.severity || "info"))}</span>
          </div>
          <p>${escapeHtml(item.detail || item.message || "")}</p>
        </article>
      `).join("")
    : `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
}

function renderAdminProfitabilityPanel() {
  if (!refs.adminProfitabilitySummary) {
    return;
  }

  const report = state.admin.profitability;
  if (refs.adminProfitabilityPeriod && refs.adminProfitabilityPeriod.value !== state.admin.profitabilityPeriod) {
    refs.adminProfitabilityPeriod.value = state.admin.profitabilityPeriod || "today";
  }
  if (refs.adminProfitabilityDate && refs.adminProfitabilityDate.value !== state.admin.profitabilityDateKey) {
    refs.adminProfitabilityDate.value = state.admin.profitabilityDateKey || "";
  }

  if (!report) {
    if (refs.adminProfitabilityStatus) refs.adminProfitabilityStatus.textContent = "Sin reporte";
    refs.adminProfitabilitySummary.innerHTML = `<div class="empty-state">Esperando rentabilidad.</div>`;
    renderAdminActionList(refs.adminProfitabilityActions, [], "Sin acciones de rentabilidad.");
    if (refs.adminProfitabilityLowMargin) refs.adminProfitabilityLowMargin.innerHTML = "";
    if (refs.adminProfitabilityMissingCost) refs.adminProfitabilityMissingCost.innerHTML = "";
    return;
  }

  const totals = report.totals || {};
  const inventory = report.inventory || {};
  if (refs.adminProfitabilityStatus) {
    refs.adminProfitabilityStatus.textContent =
      `${formatAdminDateKey(report.startDateKey)} a ${formatAdminDateKey(report.endDateKey)}`;
  }

  refs.adminProfitabilitySummary.innerHTML = `
    <article class="admin-metric-card">
      <span>Ventas periodo</span>
      <strong>${formatCurrency(totals.salesTotal || 0)}</strong>
      <p>${formatQuantity(totals.tickets || 0)} tickets - ${formatQuantity(totals.itemCount || 0)} piezas/kg</p>
    </article>
    <article class="admin-metric-card">
      <span>Utilidad bruta</span>
      <strong>${formatCurrency(totals.grossProfit || 0)}</strong>
      <p>${totals.isIncomplete ? "Incompleta por costos faltantes" : `${formatQuantity(totals.marginPercent || 0)}% margen`}</p>
    </article>
    <article class="admin-metric-card">
      <span>Inventario costo</span>
      <strong>${formatCurrency(inventory.costValue || 0)}</strong>
      <p>${formatQuantity(inventory.missingCostProductsCount || 0)} producto(s) sin costo</p>
    </article>
    <article class="admin-metric-card">
      <span>Inventario venta</span>
      <strong>${formatCurrency(inventory.saleValue || 0)}</strong>
      <p>${formatQuantity(inventory.negativeStockProductsCount || 0)} con stock negativo</p>
    </article>
  `;

  renderAdminActionList(refs.adminProfitabilityActions, report.actions, "Sin acciones de rentabilidad.");

  const lowMarginProducts = Array.isArray(report.lowMarginProducts) ? report.lowMarginProducts.slice(0, 5) : [];
  if (refs.adminProfitabilityLowMargin) {
    refs.adminProfitabilityLowMargin.innerHTML = lowMarginProducts.length
      ? lowMarginProducts.map((product) => `
          <article class="admin-record-item">
            <div class="admin-record-item-head">
              <strong>${escapeHtml(product.productName || "Producto")}</strong>
              <span class="small-pill">${formatQuantity(product.marginPercent || 0)}%</span>
            </div>
            <p>${formatCurrency(product.salesTotal || 0)} vendido - utilidad ${formatCurrency(product.grossProfit || 0)}</p>
          </article>
        `).join("")
      : `<div class="empty-state">Sin productos de margen bajo en esta lectura.</div>`;
  }

  const missingCostProducts = Array.isArray(report.missingCostProducts) ? report.missingCostProducts.slice(0, 5) : [];
  if (refs.adminProfitabilityMissingCost) {
    refs.adminProfitabilityMissingCost.innerHTML = missingCostProducts.length
      ? missingCostProducts.map((product) => `
          <article class="admin-record-item">
            <div class="admin-record-item-head">
              <strong>${escapeHtml(product.name || "Producto")}</strong>
              <span class="small-pill">${escapeHtml(getBranchLabel(product.branch))}</span>
            </div>
            <p>Precio ${formatCurrency(product.price || 0)} - stock ${formatQuantity(product.stock || 0)}</p>
          </article>
        `).join("")
      : `<div class="empty-state">Sin productos pendientes de costo.</div>`;
  }
}

function buildMerchantStatusItem({ status = "info", label, value, note }) {
  return `
    <article class="merchant-status-item ${sanitizeClassToken(status, "info")}">
      <span>${escapeHtml(label || "")}</span>
      <strong>${escapeHtml(value || "")}</strong>
      <p>${escapeHtml(note || "")}</p>
    </article>
  `;
}

function renderMerchantStatusSummary(health) {
  if (!refs.adminMerchantStatusSummary) {
    return;
  }

  const backupStatusBundle = state.admin.backupsStatus;
  const backups = backupStatusBundle || health?.backups || null;
  const backupEnabled = typeof backups?.enabled === "boolean" ? backups.enabled : true;
  const lastBackupRun = backupEnabled ? backups?.lastRun || null : null;
  const pendingQueueCount = Array.isArray(state.pendingQueue) ? state.pendingQueue.length : 0;
  const pendingRegisterCount = Array.isArray(state.register?.events)
    ? state.register.events.filter((event) => !event?.synced).length
    : 0;
  const blockedQueueCount = typeof getBlockedPendingOperationCount === "function"
    ? getBlockedPendingOperationCount()
    : 0;
  const pendingTotal = pendingQueueCount + pendingRegisterCount;
  const appVersion = health?.app?.version
    ? `${health.app.name || "POS"} ${health.app.version}`
    : "Sin lectura";
  const supportConfigured = Boolean(
    health?.supportContact?.configured
    || state.support?.configured
    || state.support?.whatsappUrl,
  );
  const supportLabel = health?.supportContact?.label || state.support?.label || "Soporte";
  const printingMode = health?.app?.printing?.mode === "browser"
    ? `${formatQuantity(health.app.printing.receiptWidthMm || 80)} mm navegador`
    : "Pendiente de lectura";
  const backupValue = !backupEnabled
    ? "Desactivado"
    : backups?.restartRequired
      ? "Reinicio pendiente"
      : lastBackupRun?.status === "ok"
        ? "OK"
        : lastBackupRun?.status === "partial"
          ? "Parcial"
          : lastBackupRun?.status === "failed"
            ? "Fallido"
            : "Sin corrida";
  const backupStatus = !backupEnabled
    ? "risk"
    : backups?.restartRequired || lastBackupRun?.status === "partial"
      ? "risk"
      : lastBackupRun?.status === "ok"
        ? "ok"
        : lastBackupRun?.status === "failed"
          ? "critical"
          : "risk";
  const backupNote = !backupEnabled
    ? "Backups apagados para este cliente."
    : lastBackupRun
      ? `${lastBackupRun.backupDateKey || "sin fecha"} - ${lastBackupRun.status || "sin estado"}`
      : "Falta ejecutar el primer backup.";
  const syncStatus = blockedQueueCount > 0
    ? "critical"
    : pendingTotal > 0
      ? "risk"
      : "ok";
  const syncValue = blockedQueueCount > 0
    ? "Revisar cola"
    : pendingTotal > 0
      ? `${pendingTotal} pendiente(s)`
      : "Sin pendientes";

  refs.adminMerchantStatusSummary.innerHTML = [
    buildMerchantStatusItem({
      status: state.online ? "ok" : "risk",
      label: "Internet",
      value: state.online ? "En linea" : "Sin conexion",
      note: state.online ? "La caja puede hablar con el servidor." : "Solo funciona si el equipo ya fue preparado.",
    }),
    buildMerchantStatusItem({
      status: syncStatus,
      label: "Offline",
      value: syncValue,
      note: blockedQueueCount > 0
        ? `${blockedQueueCount} operacion(es) necesitan revision.`
        : `${pendingQueueCount} venta/abono - ${pendingRegisterCount} evento(s) de caja.`,
    }),
    buildMerchantStatusItem({
      status: backupStatus,
      label: "Ultimo backup",
      value: backupValue,
      note: backupNote,
    }),
    buildMerchantStatusItem({
      status: health?.app?.version ? "ok" : "risk",
      label: "Version",
      value: appVersion,
      note: "Confirma que el cliente corre la version esperada.",
    }),
    buildMerchantStatusItem({
      status: supportConfigured ? "ok" : "risk",
      label: "Soporte",
      value: supportConfigured ? supportLabel : "Sin configurar",
      note: supportConfigured ? "Contacto visible para pedir ayuda." : "Configura WhatsApp o telefono.",
    }),
    buildMerchantStatusItem({
      status: health?.app?.printing?.mode === "browser" ? "ok" : "risk",
      label: "Impresion",
      value: printingMode,
      note: "Ticket por navegador; hardware real se valida aparte.",
    }),
  ].join("");
}

function renderAdminHealthPanel() {
  if (!refs.adminHealthSummary) {
    return;
  }

  const health = state.admin.supportHealth;
  const semaphore = health?.semaphore || null;
  const status = semaphore?.status || "";
  const backups = health?.backups || null;
  const runtimeConfig = health?.runtimeConfig || null;
  const security = health?.security || null;
  const backupsEnabled = typeof backups?.enabled === "boolean" ? backups.enabled : true;
  const backupBaseStatus = backupsEnabled
    ? (backups?.lastRun?.status || "sin corrida")
    : "desactivado";
  const backupStatus = backups?.restartRequired
    ? `${backupBaseStatus} (reinicio pendiente)`
    : backupBaseStatus;
  const runtimeStatus = runtimeConfig?.error
    ? "error"
    : runtimeConfig?.restartRequired
      ? "reinicio pendiente"
      : runtimeConfig?.loaded
        ? "activo"
        : "sin archivo";
  const securityStatus = security?.status || "";
  const securitySummary = !security
    ? "sin lectura"
    : securityStatus === "critical"
      ? "critica"
      : securityStatus === "risk"
        ? "en riesgo"
        : "cuidada";
  const controlSecurityLabel = security?.controlApiInvalid
    ? "URL invalida"
    : !security?.controlApiUrl
    ? "sin URL"
    : security.controlApiHttps
      ? "HTTPS"
      : "HTTP";
  const latestSale = health?.latestSale || null;
  const appVersionLabel = health?.app?.version
    ? `${health.app.name || "pos"} ${health.app.version}`
    : "version sin lectura";
  const printingLabel = health?.app?.printing?.mode === "browser"
    ? `impresion ${formatQuantity(health.app.printing.receiptWidthMm || 80)}mm navegador`
    : "impresion sin lectura";
  const supportContactLabel = health?.supportContact?.configured
    ? `${health.supportContact.label || "Soporte"} configurado`
    : "soporte sin WhatsApp";
  const runtimeDetail = runtimeConfig?.error
    ? runtimeConfig.error
    : runtimeConfig?.restartRequired
      ? Array.isArray(runtimeConfig.pendingRestartKeys) && runtimeConfig.pendingRestartKeys.length
        ? `Pendientes: ${runtimeConfig.pendingRestartKeys.join(", ")}`
        : "Hay variables runtime pendientes de reinicio."
      : latestSale
        ? `Ultima venta ${latestSale.ticketNumber || ""} por ${formatCurrency(latestSale.total || 0)}`
        : "Sin venta registrada";

  if (refs.adminHealthStatus) {
    refs.adminHealthStatus.textContent = getAdminHealthLabel(status);
    refs.adminHealthStatus.dataset.status = sanitizeClassToken(status, "unknown");
  }

  refs.adminHealthSummary.className = `admin-health-banner ${sanitizeClassToken(status, "unknown")}`;
  refs.adminHealthSummary.innerHTML = health
    ? `
        <strong>${escapeHtml(getAdminHealthLabel(status))}</strong>
        <p>Backup ${escapeHtml(backupStatus)} - runtime ${escapeHtml(runtimeStatus)} - sync ${health.syncHealth?.hasPending ? "pendiente" : "limpio"} - seguridad ${escapeHtml(securitySummary)}</p>
        <p>Errores ${formatQuantity(health.recentErrors?.length || 0)} - cookies ${security?.secureCookies ? "seguras" : "abiertas"} - owner ${escapeHtml(controlSecurityLabel)}</p>
        <p>${escapeHtml(appVersionLabel)} - ${escapeHtml(printingLabel)} - ${escapeHtml(supportContactLabel)}</p>
        <p>${escapeHtml(runtimeDetail)}</p>
      `
    : `<div class="empty-state">Esperando salud del cliente.</div>`;
  renderMerchantStatusSummary(health);

  renderAdminActionList(
    refs.adminHealthReasons,
    semaphore?.reasons,
    "Sin razones de riesgo.",
  );
  renderAdminActionList(
    refs.adminHealthActions,
    semaphore?.actions,
    "Sin acciones pendientes.",
  );
}

function shouldHydrateAdminSubscriptionForm() {
  const activeElement = document.activeElement;
  const fields = [
    refs.adminSubscriptionPlan,
    refs.adminSubscriptionState,
    refs.adminSubscriptionAmount,
    refs.adminSubscriptionPeriodEnd,
    refs.adminSubscriptionGrace,
    refs.adminSubscriptionNotes,
    refs.adminSubscriptionPaymentAmount,
    refs.adminSubscriptionPaymentMethod,
    refs.adminSubscriptionPaymentStart,
    refs.adminSubscriptionPaymentEnd,
    refs.adminSubscriptionPaymentNotes,
  ].filter(Boolean);

  return !fields.includes(activeElement);
}

function renderAdminSubscriptionPanel() {
  if (!refs.adminSubscriptionSummary) {
    return;
  }

  const subscription = state.admin.subscription;
  const payments = Array.isArray(state.admin.subscriptionPayments) ? state.admin.subscriptionPayments : [];
  const controlPlane = state.admin.subscriptionControl || {};
  const controlConfigured = Boolean(controlPlane.configured);
  const controlUsable = Boolean(controlPlane.usable);
  const controlDegraded = Boolean(controlPlane.degraded);
  const missing = Array.isArray(controlPlane.missing) ? controlPlane.missing.join(", ") : "";
  const controlStatusLabel = !controlConfigured
    ? "Sin configurar"
    : !controlUsable
      ? "Corregir config"
      : controlDegraded
        ? controlPlane.authFailed
          ? "Auth fallida"
          : "Con error"
        : controlPlane.lastSuccessAt
          ? "Conectado"
          : "Sin prueba";
  const controlStatusDetail = !controlConfigured
    ? `Configura ${missing || "CONTROL_*"} para enlazar owner-control.`
    : !controlUsable
      ? (controlPlane.error || "La configuracion central no es usable todavia.")
      : controlDegraded
        ? `${controlPlane.lastError || "Owner-control fallo recientemente."} (${formatAdminTimestamp(controlPlane.lastErrorAt)})`
        : controlPlane.lastSuccessAt
          ? `Ultimo OK ${formatAdminTimestamp(controlPlane.lastSuccessAt)}`
          : "Sin intentos recientes desde este proceso.";
  const canManageLocalSubscription = Boolean(state.owner.authenticated && !controlConfigured);
  const localSubscriptionFields = [
    refs.adminSubscriptionPlan,
    refs.adminSubscriptionState,
    refs.adminSubscriptionAmount,
    refs.adminSubscriptionPeriodEnd,
    refs.adminSubscriptionGrace,
    refs.adminSubscriptionNotes,
  ].filter(Boolean);
  const localPaymentFields = [
    refs.adminSubscriptionPaymentAmount,
    refs.adminSubscriptionPaymentMethod,
    refs.adminSubscriptionPaymentStart,
    refs.adminSubscriptionPaymentEnd,
    refs.adminSubscriptionPaymentNotes,
  ].filter(Boolean);
  localSubscriptionFields.forEach((field) => {
    const shell = typeof field.closest === "function" ? field.closest(".field") : null;
    if (shell) {
      shell.hidden = !canManageLocalSubscription;
    }
    field.disabled = !canManageLocalSubscription;
    field.title = canManageLocalSubscription ? "" : "La suscripcion se controla desde owner-control.";
  });
  localPaymentFields.forEach((field) => {
    field.disabled = !canManageLocalSubscription;
  });
  if (refs.saveAdminSubscriptionButton) {
    refs.saveAdminSubscriptionButton.hidden = !canManageLocalSubscription;
    refs.saveAdminSubscriptionButton.disabled = !canManageLocalSubscription;
    refs.saveAdminSubscriptionButton.textContent = "Guardar estado";
    refs.saveAdminSubscriptionButton.title = canManageLocalSubscription ? "" : "La suscripcion se controla desde owner-control.";
  }
  if (refs.syncAdminSubscriptionButton) {
    refs.syncAdminSubscriptionButton.disabled = !controlUsable;
    refs.syncAdminSubscriptionButton.textContent = controlUsable
      ? controlDegraded
        ? "Reintentar central"
        : "Sincronizar central"
      : "Sin control central";
    refs.syncAdminSubscriptionButton.title = controlUsable
      ? controlDegraded
        ? `Fallo reciente: ${controlPlane.lastError || "Sin detalle"}`
        : `Owner-control: ${controlPlane.clientSlug || ""}`
      : controlConfigured
        ? (controlPlane.error || "La configuracion central no es usable todavia.")
        : `Configura ${missing || "CONTROL_*"} para sincronizar owner-control.`;
  }
  if (refs.syncAdminControlConfigButton) {
    refs.syncAdminControlConfigButton.disabled = !controlUsable;
    refs.syncAdminControlConfigButton.textContent = controlUsable
      ? controlDegraded
        ? "Reintentar configuracion"
        : "Sincronizar configuracion"
      : "Sin control central";
    refs.syncAdminControlConfigButton.title = controlUsable
      ? controlDegraded
        ? `Fallo reciente: ${controlPlane.lastError || "Sin detalle"}`
        : `Aplicar configuracion POS desde owner-control (${controlPlane.clientSlug || ""}).`
      : controlConfigured
        ? (controlPlane.error || "La configuracion central no es usable todavia.")
        : `Configura ${missing || "CONTROL_*"} para sincronizar la configuracion POS.`;
  }
  if (refs.adminSubscriptionPaymentForm) {
    refs.adminSubscriptionPaymentForm.hidden = !canManageLocalSubscription;
  }
  if (refs.recordAdminSubscriptionPaymentButton) {
    refs.recordAdminSubscriptionPaymentButton.disabled = !canManageLocalSubscription;
    refs.recordAdminSubscriptionPaymentButton.textContent = "Registrar pago";
    refs.recordAdminSubscriptionPaymentButton.title = canManageLocalSubscription ? "" : "Los pagos se registran desde owner-control.";
  }

  if (refs.adminSubscriptionStatus) {
    refs.adminSubscriptionStatus.textContent = subscription?.effectiveStatus || "Sin estado";
  }

  refs.adminSubscriptionSummary.innerHTML = subscription
    ? `
        <article class="admin-metric-card">
          <span>Plan</span>
          <strong>${escapeHtml(subscription.planCode || "sin plan")}</strong>
          <p>${escapeHtml(subscription.effectiveStatus || subscription.status || "sin estado")}</p>
        </article>
        <article class="admin-metric-card">
          <span>Mensualidad</span>
          <strong>${formatCurrency(subscription.monthlyAmount || 0)}</strong>
          <p>${escapeHtml(subscription.currencyCode || "MXN")}</p>
        </article>
        <article class="admin-metric-card">
          <span>Fecha corte</span>
          <strong>${escapeHtml(formatAdminDateKey(subscription.currentPeriodEnd))}</strong>
          <p>Gracia ${escapeHtml(formatAdminDateKey(subscription.gracePeriodUntil))}</p>
        </article>
        <article class="admin-metric-card">
          <span>Ultimo pago</span>
          <strong>${escapeHtml(formatAdminDateKey(subscription.lastPaymentAt?.slice(0, 10)))}</strong>
          <p>${subscription.blocksOperation ? "Bloqueo activo" : "Aviso suave - caja libre"}</p>
        </article>
        <article class="admin-metric-card">
          <span>Owner-control</span>
          <strong>${escapeHtml(controlStatusLabel)}</strong>
          <p>${escapeHtml(controlStatusDetail)}</p>
        </article>
      `
    : `<div class="empty-state">Esperando estado de suscripcion.</div>`;

  if (subscription && shouldHydrateAdminSubscriptionForm()) {
    if (refs.adminSubscriptionPlan) refs.adminSubscriptionPlan.value = subscription.planCode || "";
    if (refs.adminSubscriptionState) refs.adminSubscriptionState.value = subscription.status || "trial";
    if (refs.adminSubscriptionAmount) refs.adminSubscriptionAmount.value = String(subscription.monthlyAmount || 0);
    if (refs.adminSubscriptionPeriodEnd) refs.adminSubscriptionPeriodEnd.value = subscription.currentPeriodEnd || "";
    if (refs.adminSubscriptionGrace) refs.adminSubscriptionGrace.value = subscription.gracePeriodUntil || "";
    if (refs.adminSubscriptionNotes) refs.adminSubscriptionNotes.value = subscription.notes || "";
    if (refs.adminSubscriptionPaymentAmount && !refs.adminSubscriptionPaymentAmount.value) {
      refs.adminSubscriptionPaymentAmount.value = String(subscription.monthlyAmount || "");
    }
    if (refs.adminSubscriptionPaymentMethod && !refs.adminSubscriptionPaymentMethod.value) {
      refs.adminSubscriptionPaymentMethod.value = "Transferencia";
    }
  }

  if (refs.adminSubscriptionPayments) {
    refs.adminSubscriptionPayments.innerHTML = payments.length
      ? payments.slice(0, 8).map((payment) => `
          <article class="admin-record-item">
            <div class="admin-record-item-head">
              <strong>${formatCurrency(payment.amount || 0)}</strong>
              <span class="small-pill">${escapeHtml(payment.paymentMethod || "Pago")}</span>
            </div>
            <p>${escapeHtml(formatAdminDateKey(payment.periodStart))} a ${escapeHtml(formatAdminDateKey(payment.periodEnd))}</p>
            <p>${escapeHtml(payment.notes || payment.paidAt || "")}</p>
          </article>
        `).join("")
      : `<div class="empty-state">Sin pagos registrados todavia.</div>`;
  }
}

function renderAdminModal() {
  if (!refs.adminModal) {
    return;
  }

  if (!refs.adminModal.classList.contains("open")) {
    return;
  }

  if (typeof renderAdminSectionNavigation === "function") {
    renderAdminSectionNavigation();
  }

  const adminSnapshot = state.admin.snapshot;
  const serverMetrics = state.admin.metrics;
  const clientMetrics = getClientMetrics();
  const currentBranch = getAdminBranch();
  const currentBranchLabel = getBranchLabel(currentBranch);
  const summary = adminSnapshot?.summary || state.summary;
  const shiftSummary = Array.isArray(adminSnapshot?.shiftSummary)
    ? adminSnapshot.shiftSummary
    : [];

  setSelectOptions(refs.adminBranchSelect, getBranchOptions(), currentBranch);

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
    const profitTotals = state.admin.profitability?.totals || null;
    const inventoryCostValue = summary.inventoryCostValue
      ?? state.admin.profitability?.inventory?.costValue
      ?? 0;
    const inventorySaleValue = summary.inventorySaleValue
      ?? summary.inventoryValue
      ?? state.admin.profitability?.inventory?.saleValue
      ?? 0;
    const missingCostProducts = summary.missingCostProductsCount
      ?? state.admin.profitability?.inventory?.missingCostProductsCount
      ?? 0;
    const negativeStockProducts = summary.negativeStockProductsCount
      ?? state.admin.profitability?.inventory?.negativeStockProductsCount
      ?? 0;

    refs.adminSummaryCards.innerHTML = `
      <article class="admin-metric-card">
        <span>Ventas del dia</span>
        <strong>${formatCurrency(summary.revenueToday || 0)}</strong>
        <p>${formatQuantity(summary.ticketsToday || 0)} tickets</p>
      </article>
      <article class="admin-metric-card">
        <span>Utilidad bruta</span>
        <strong>${formatCurrency(profitTotals?.grossProfit || 0)}</strong>
        <p>${profitTotals?.isIncomplete ? "Incompleta por costos faltantes" : `${formatQuantity(profitTotals?.marginPercent || 0)}% margen`}</p>
      </article>
      <article class="admin-metric-card">
        <span>Ticket promedio</span>
        <strong>${formatCurrency(summary.averageTicket || 0)}</strong>
        <p>${formatQuantity(summary.unitsSoldToday || 0)} unidades</p>
      </article>
      <article class="admin-metric-card">
        <span>Inventario venta</span>
        <strong>${formatCurrency(inventorySaleValue)}</strong>
        <p>${formatQuantity(summary.catalogSize || 0)} productos activos</p>
      </article>
      <article class="admin-metric-card">
        <span>Inventario costo</span>
        <strong>${formatCurrency(inventoryCostValue)}</strong>
        <p>${formatQuantity(missingCostProducts)} sin costo</p>
      </article>
      <article class="admin-metric-card">
        <span>Alertas</span>
        <strong>${formatQuantity(summary.lowStockCount || 0)}</strong>
        <p>${formatQuantity(negativeStockProducts)} stock negativo - ${escapeHtml(topProductText)}</p>
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
  if (refs.adminRouteQuickAdd) {
    refs.adminRouteQuickAdd.textContent = `${formatQuantity(state.performance.routeQuickAddMs)} ms`;
  }
  if (refs.adminRouteQuickAddDetail) {
    refs.adminRouteQuickAddDetail.textContent =
      `${formatQuantity(state.performance.routeQuickAddCount)} altas`;
  }
  if (refs.adminRouteEditorOpen) {
    refs.adminRouteEditorOpen.textContent =
      `${formatQuantity(state.performance.routeCartEditorOpenMs)} ms`;
  }
  if (refs.adminRouteEditorOpenDetail) {
    refs.adminRouteEditorOpenDetail.textContent =
      `${formatQuantity(state.performance.routeCartEditorOpenCount)} aperturas`;
  }
  const comparisonBranchOneRows = document.getElementById("inventory-body-branch-1")?.children?.length || 0;
  const comparisonBranchTwoRows = document.getElementById("inventory-body-branch-2")?.children?.length || 0;
  const inventoryVisibleRows = state.admin.branch === "all"
    ? comparisonBranchOneRows + comparisonBranchTwoRows
    : refs.inventoryBody?.children?.length || 0;
  const comparisonInventoryTotal = Array.isArray(state.admin.inventoryComparison?.branches)
    ? state.admin.inventoryComparison.branches.reduce(
        (sum, branchEntry) => sum + (Array.isArray(branchEntry.products) ? branchEntry.products.length : 0),
        0,
      )
    : 0;
  const inventoryTotal = state.admin.branch === "all"
    ? comparisonInventoryTotal
    : Array.isArray(state.admin.inventoryProducts)
      ? state.admin.inventoryProducts.length
      : 0;
  updateAdminInventoryChrome(inventoryVisibleRows, Number(state.admin.inventoryPage?.total || inventoryTotal));
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

  updateModuleVisibility();
  renderAdminProfitabilityPanel();
  renderAdminHealthPanel();
  renderAdminSubscriptionPanel();
  renderAdminDevPanel();
  renderAdminProductOnboarding();
  renderAdminBranches();
  renderAdminPeriodClosuresPanel();
  renderAdminWeightedAuditPanel();
  renderAdminRecordLists();
  updateModuleVisibility();
} // FIX: llave de cierre de renderAdminModal que faltaba

const ADMIN_AVAILABLE_MODULES = [
  { code: "merchandise_requests", label: "Solicitudes de mercaderia" },
  { code: "weighted_audit", label: "Auditoria de pesado" },
];

function syncAdminProductCatalogs() {
  if (refs.adminNewProductCategory) {
    const categoryOptions = state.categories.map((category) => ({
      value: String(category.id),
      label: category.label,
    }));
    setSelectOptions(
      refs.adminNewProductCategory,
      categoryOptions,
      refs.adminNewProductCategory.value || String(categoryOptions[0]?.value || ""),
    );
  }

  if (refs.adminNewProductUnit) {
    const unitOptions = state.units.map((unit) => ({
      value: String(unit.id),
      label: unit.label,
    }));
    setSelectOptions(
      refs.adminNewProductUnit,
      unitOptions,
      refs.adminNewProductUnit.value || String(unitOptions[0]?.value || ""),
    );
    const selectedUnit = getUnitRecord(Number(refs.adminNewProductUnit.value) || refs.adminNewProductUnit.value)
      || state.units[0]
      || null;
    const numericStep = Number(selectedUnit?.step || 0.25);
    const numericMin = selectedUnit?.allowDecimals === false ? 1 : Math.min(numericStep, 0.25);
    if (refs.adminNewProductStock) {
      refs.adminNewProductStock.step = String(numericStep);
      refs.adminNewProductStock.min = "0";
    }
    if (refs.adminNewProductMinStock) {
      refs.adminNewProductMinStock.step = String(numericStep);
      refs.adminNewProductMinStock.min = String(numericMin);
    }
    if (refs.adminNewProductPackSize) {
      refs.adminNewProductPackSize.step = String(numericStep);
    }
  }

  if (refs.adminNewProductAttributes) {
    const definitions = getProductAttributeDefinitions();
    refs.adminNewProductAttributes.innerHTML = definitions.length
      ? definitions
          .map((definition) => {
            if (definition.valueType === "boolean") {
              return `
                <label class="field">
                  <span>${escapeHtml(definition.label)}</span>
                  <label class="admin-inline-check">
                    <input
                      type="checkbox"
                      data-attribute-key="${escapeHtml(definition.key)}"
                      data-attribute-type="${escapeHtml(definition.valueType)}"
                    />
                    <span>Activo</span>
                  </label>
                </label>
              `;
            }

            if (definition.valueType === "select") {
              const options = Array.isArray(definition.options) ? definition.options : [];
              return `
                <label class="field">
                  <span>${escapeHtml(definition.label)}</span>
                  <select
                    data-attribute-key="${escapeHtml(definition.key)}"
                    data-attribute-type="${escapeHtml(definition.valueType)}"
                  >
                    <option value="">Selecciona</option>
                    ${options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}
                  </select>
                </label>
              `;
            }

            return `
              <label class="field">
                <span>${escapeHtml(definition.label)}</span>
                <input
                  type="${definition.valueType === "number" ? "number" : "text"}"
                  ${definition.valueType === "number" ? 'step="0.01"' : ""}
                  data-attribute-key="${escapeHtml(definition.key)}"
                  data-attribute-type="${escapeHtml(definition.valueType)}"
                />
              </label>
            `;
          })
          .join("")
      : `<small class="helper-text">Sin atributos extra activos para este negocio.</small>`;
  }
}

function renderAdminConfigPanel() {
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const profile = getStoreProfile();
  if (refs.saveAdminConfigButton) {
    refs.saveAdminConfigButton.disabled = Boolean(state.admin.configSaving);
    refs.saveAdminConfigButton.textContent = state.admin.configSaving
      ? "Guardando..."
      : "Guardar configuraciones";
  }
  if (refs.configBusinessName && !isAdminConfigFieldDirty("businessProfile", "businessName")) {
    refs.configBusinessName.value = profile.businessName || "";
  }
  if (refs.configShortName && !isAdminConfigFieldDirty("businessProfile", "shortName")) {
    refs.configShortName.value = profile.shortName || "";
  }
  if (refs.configSlug && !isAdminConfigFieldDirty("businessProfile", "slug")) {
    refs.configSlug.value = profile.slug || "";
  }
  if (refs.configTimezone && !isAdminConfigFieldDirty("businessProfile", "timezone")) {
    refs.configTimezone.value = profile.timezone || state.store.timezone || "America/Mexico_City";
  }
  if (refs.configLocale && !isAdminConfigFieldDirty("businessProfile", "locale")) {
    refs.configLocale.value = profile.locale || "es-MX";
  }
  if (refs.configCurrencyCode && !isAdminConfigFieldDirty("businessProfile", "currencyCode")) {
    refs.configCurrencyCode.value = profile.currencyCode || "MXN";
  }
  if (refs.configTicketPrefix && !isAdminConfigFieldDirty("businessProfile", "ticketPrefix")) {
    refs.configTicketPrefix.value = profile.ticketPrefix || "";
  }

  if (refs.configTemplateSelect) {
    setSelectOptions(
      refs.configTemplateSelect,
      state.businessTemplates.map((template) => ({
        value: template.key,
        label: `${template.key} - ${template.description || template.businessName || template.key}`,
      })),
      profile.templateKey || state.businessTemplates[0]?.key || "",
    );
  }

  if (refs.configModulesWrap && !isAdminConfigFieldDirty("enabledModules")) {
    refs.configModulesWrap.innerHTML = ADMIN_AVAILABLE_MODULES
      .map((module) => `
        <label class="admin-module-chip">
          <input
            type="checkbox"
            data-module-code="${escapeHtml(module.code)}"
            ${hasEnabledModule(module.code) ? "checked" : ""}
          />
          <span>${escapeHtml(module.label)}</span>
        </label>
      `)
      .join("");
  }

  renderAdminBrandingEditor();

  if (refs.configCategoriesList) {
    refs.configCategoriesList.innerHTML = state.categories.length
      ? state.categories
          .map((category) => `
            <div class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(category.label)}</strong>
                <span class="small-pill">${escapeHtml(category.code)}</span>
              </div>
              <p>Orden ${formatQuantity(category.sortOrder || 0)}</p>
              <button
                class="ghost-button compact-button"
                data-action="deactivate-category"
                data-category-id="${category.id}"
                type="button"
              >
                Desactivar
              </button>
            </div>
          `)
          .join("")
      : `<div class="empty-state">No hay categorias activas.</div>`;
  }

  if (refs.configUnitsList) {
    refs.configUnitsList.innerHTML = state.units.length
      ? state.units
          .map((unit) => `
            <div class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(unit.label)}</strong>
                <span class="small-pill">${escapeHtml(unit.code)}</span>
              </div>
              <p>Paso ${formatQuantity(unit.step || 0.25)} - ${unit.allowDecimals ? "decimales" : "enteros"}</p>
              <button
                class="ghost-button compact-button"
                data-action="deactivate-unit"
                data-unit-id="${unit.id}"
                type="button"
              >
                Desactivar
              </button>
            </div>
          `)
          .join("")
      : `<div class="empty-state">No hay unidades activas.</div>`;
  }

  if (refs.configAttributesList) {
    refs.configAttributesList.innerHTML = state.productAttributeDefinitions.length
      ? state.productAttributeDefinitions
          .map((definition) => `
            <div class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(definition.label)}</strong>
                <span class="small-pill">${escapeHtml(definition.key)}</span>
              </div>
              <p>${escapeHtml(definition.valueType)}${definition.required ? " - obligatorio" : ""}${definition.options?.length ? ` - ${escapeHtml(definition.options.join(", "))}` : ""}</p>
              <button
                class="ghost-button compact-button"
                data-action="deactivate-attribute"
                data-attribute-id="${definition.id}"
                type="button"
              >
                Desactivar
              </button>
            </div>
          `)
          .join("")
      : `<div class="empty-state">No hay atributos de producto activos.</div>`;
  }
}

function buildOfflineSaleRecordMarkup(record) {
  const displayState = getOfflineSaleDisplayState(record);
  const syncTimestamp = record.syncedAt || record.lastSyncAttemptAt || record.rejectedAt || record.queuedAt || record.createdAt;
  const syncLabel = syncTimestamp
    ? dateTimeFormatter.format(new Date(syncTimestamp))
    : "Sin fecha";
  const stateSummary = displayState.status === "synced"
    ? `Sincronizada ${syncLabel}`
    : displayState.status === "rejected"
      ? `Rechazada ${syncLabel}`
      : `Cola ${syncLabel}`;

  return `
    <article class="admin-record-item offline-sale-record">
      <div class="admin-record-item-head">
        <strong>${escapeHtml(record.localTicketNumber || record.syncedTicketNumber || "Venta offline")}</strong>
        <span class="offline-sale-status-pill ${sanitizeClassToken(displayState.status, "unknown")}">${escapeHtml(displayState.label)}</span>
      </div>
      <p>${escapeHtml(getBranchLabel(record.branch))} · ${escapeHtml(record.cashier || "Cajero")} · ${escapeHtml(record.shift || "Tarde")} · ${formatCurrency(record.total || 0)}</p>
      <p>${escapeHtml(stateSummary)} · ${escapeHtml(displayState.note)}</p>
      <p>${escapeHtml((record.items || []).map((item) => `${item.productName} x${formatQuantity(item.quantity || 0)}`).join(" · ") || "Sin detalle de productos.")}</p>
      <div class="admin-record-actions">
        ${displayState.canRetry ? `<button class="secondary-button compact-button" data-offline-sale-action="retry" data-client-sale-id="${escapeHtml(record.clientSaleId)}" type="button">Reintentar</button>` : ""}
        ${displayState.canReject ? `<button class="ghost-button compact-button" data-offline-sale-action="reject" data-client-sale-id="${escapeHtml(record.clientSaleId)}" type="button">Marcar rechazada</button>` : ""}
        ${displayState.canReactivate ? `<button class="secondary-button compact-button" data-offline-sale-action="reactivate" data-client-sale-id="${escapeHtml(record.clientSaleId)}" type="button">Reactivar</button>` : ""}
        <button class="ghost-button compact-button" data-offline-sale-action="download" data-client-sale-id="${escapeHtml(record.clientSaleId)}" type="button">Descargar</button>
      </div>
    </article>
  `;
}

function renderOfflineSalesPanel(listElement, statusElement) {
  if (!listElement || !statusElement) {
    return;
  }

  const records = Array.isArray(state.offlineSales) ? state.offlineSales : [];
  const summary = typeof getOfflineSalesStatusSummary === "function"
    ? getOfflineSalesStatusSummary(records)
    : {
        pending: 0,
        requiresReview: 0,
        synced: 0,
        rejected: 0,
        outstanding: 0,
      };
  const pendingCount = summary.pending;
  const reviewCount = summary.requiresReview;
  const syncedCount = summary.synced;
  const rejectedCount = summary.rejected;

  statusElement.textContent = records.length > 0
    ? `${pendingCount} pendientes · ${reviewCount} revision · ${syncedCount} sincronizadas · ${rejectedCount} rechazadas`
    : "Sin ventas offline";

  listElement.innerHTML = records.length > 0
    ? records.map((record) => buildOfflineSaleRecordMarkup(record)).join("")
    : `<div class="empty-state">No hay tickets offline guardados en este dispositivo.</div>`;
}

const ADMIN_DEV_SNAPSHOT_BYTES_CACHE_MS = 15000;
let adminDevSnapshotBytesCache = {
  signature: "",
  bytes: 0,
  measuredAt: 0,
};

function getAdminDevSnapshotSignature() {
  return [
    state.store?.currentBranch || "",
    Array.isArray(state.products) ? state.products.length : 0,
    Array.isArray(state.lowStock) ? state.lowStock.length : 0,
    Array.isArray(state.recentSales) ? state.recentSales.length : 0,
    Array.isArray(state.pendingQueue) ? state.pendingQueue.length : 0,
    Array.isArray(state.register?.events) ? state.register.events.length : 0,
    state.summary?.ticketsToday || 0,
    state.summary?.revenueToday || 0,
  ].join("|");
}

function getAdminDevSnapshotBytes() {
  const signature = getAdminDevSnapshotSignature();
  const now = Date.now();
  if (
    adminDevSnapshotBytesCache.signature === signature
    && now - adminDevSnapshotBytesCache.measuredAt < ADMIN_DEV_SNAPSHOT_BYTES_CACHE_MS
  ) {
    return adminDevSnapshotBytesCache.bytes;
  }

  const bytes = estimateSerializedBytes(buildPersistedSnapshot());
  adminDevSnapshotBytesCache = {
    signature,
    bytes,
    measuredAt: now,
  };
  return bytes;
}

function renderAdminDevPanel() {
  if (!refs.adminDevSummary) {
    return;
  }

  const backupStatusBundle = state.admin.backupsStatus;
  const supportHealth = state.admin.supportHealth;
  const subscription = state.admin.subscription;
  const latestSale = supportHealth?.latestSale || null;
  const recentErrors = Array.isArray(supportHealth?.recentErrors)
    ? supportHealth.recentErrors
    : [];
  const backupRuntime = backupStatusBundle || supportHealth?.backups || null;
  const backupCapabilityEnabled = hasAdminCapability("backups");
  const backupEnabled = typeof backupRuntime?.enabled === "boolean"
    ? backupRuntime.enabled
    : backupCapabilityEnabled;
  const backupRestartRequired = Boolean(backupRuntime?.restartRequired || supportHealth?.backups?.restartRequired);
  const lastBackupRun = backupEnabled
    ? (backupStatusBundle?.lastRun || supportHealth?.backups?.lastRun || null)
    : null;
  const lastBackupLabel = lastBackupRun
    ? lastBackupRun.status === "ok"
      ? "OK"
      : lastBackupRun.status === "partial"
        ? "Parcial"
        : lastBackupRun.status === "failed"
          ? "Fallido"
          : "Corriendo"
    : "Sin corridas";
  const backupLabel = !backupCapabilityEnabled
    ? "Bloqueado"
    : backupRestartRequired
      ? "Reinicio pendiente"
      : backupEnabled
        ? lastBackupLabel
        : "Desactivado";
  const snapshotBytes = getAdminDevSnapshotBytes();
  const queueBytes = estimateSerializedBytes(state.pendingQueue);
  const registerBytes = estimateSerializedBytes(state.register.events);
  const auditBytes = estimateSerializedBytes(state.admin.auditLogs);
  const blockedQueueCount =
    typeof getBlockedPendingOperationCount === "function" ? getBlockedPendingOperationCount() : 0;
  const blockedOperation =
    typeof getFirstBlockedPendingOperation === "function" ? getFirstBlockedPendingOperation() : null;
  const statusText = state.syncingQueue
    ? "Sincronizando"
    : blockedQueueCount > 0
      ? "Revision requerida"
      : state.online
        ? "En linea"
        : "Offline";
  const queueDetailText = blockedQueueCount > 0
    ? `${state.pendingQueue.length} pendientes · ${blockedQueueCount} con error`
    : `${state.pendingQueue.length} pendientes · ${state.register.events.length} eventos caja`;
  const queueStatusNote = blockedOperation?.lastSyncError
    ? escapeHtml(blockedOperation.lastSyncError)
    : `Cola ${formatBytes(queueBytes)} · cortes ${formatBytes(registerBytes)}`;

  const backupNote = !backupCapabilityEnabled
    ? "El owner bloqueo respaldos."
    : backupRestartRequired
      ? backupEnabled
        ? "Runtime cambiado; reinicia POS para encender el job con la configuracion nueva."
        : "Runtime desactivado; reinicia POS para apagar el job cargado en el proceso."
      : !backupEnabled
        ? "Backups apagados por owner-control; fallos historicos no cuentan como riesgo."
        : lastBackupRun
          ? `${lastBackupRun.backupDateKey} - SQLite ${formatBytes(lastBackupRun.sqliteBytes || 0)} - Excel ${formatBytes(lastBackupRun.workbookBytes || 0)}`
          : "Activa el job nocturno para ver respaldos.";

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
      <p>Productos render ${state.performance.renderedProductCount} · sesion ${state.admin.authenticated ? "activa" : "cerrada"}</p>
    </article>
  `;

  refs.adminDevSummary.insertAdjacentHTML("beforeend", `
    <article class="admin-metric-card">
      <span>Ultimo backup</span>
      <strong>${backupLabel}</strong>
      <p>${escapeHtml(backupNote)}</p>
    </article>
    <article class="admin-metric-card">
      <span>Ultima venta</span>
      <strong>${latestSale ? formatCurrency(latestSale.total || 0) : "Sin venta"}</strong>
      <p>${latestSale ? `${escapeHtml(latestSale.ticketNumber || "")} - ${timeFormatter.format(new Date(latestSale.createdAt))}` : "Esperando ticket"}</p>
    </article>
    <article class="admin-metric-card">
      <span>Base de datos</span>
      <strong>${formatQuantity(supportHealth?.database?.mb || 0)} MB</strong>
      <p>${formatQuantity(supportHealth?.counts?.tickets || 0)} tickets - ${formatQuantity(supportHealth?.counts?.activeProducts || 0)} productos</p>
    </article>
    <article class="admin-metric-card">
      <span>Suscripcion</span>
      <strong>${escapeHtml(subscription?.effectiveStatus || "sin estado")}</strong>
      <p>${subscription?.blocksOperation ? "Bloqueo activo" : "Aviso suave - caja libre"}</p>
    </article>
    <article class="admin-metric-card">
      <span>Errores recientes</span>
      <strong>${formatQuantity(recentErrors.length)}</strong>
      <p>${recentErrors[0] ? escapeHtml(recentErrors[0].message || "") : "Sin errores capturados"}</p>
    </article>
  `);

  const devSummaryNotes = refs.adminDevSummary.querySelectorAll(".admin-metric-card p");
  if (devSummaryNotes[0]) {
    devSummaryNotes[0].textContent = queueDetailText;
  }
  if (devSummaryNotes[1]) {
    devSummaryNotes[1].textContent = blockedOperation?.lastSyncError
      ? blockedOperation.lastSyncError
      : `Cola ${formatBytes(queueBytes)} · cortes ${formatBytes(registerBytes)}`;
  }
  if (devSummaryNotes[4]) {
    devSummaryNotes[4].textContent = backupEnabled && lastBackupRun?.errorMessage
      ? lastBackupRun.errorMessage
      : backupEnabled && lastBackupRun?.syncState === "partial"
        ? `${backupStatusBundle?.syncHealth?.pendingReportCount || 0} equipos con cola pendiente`
        : backupNote;
  }

  renderOfflineSalesPanel(refs.adminOfflineSalesList, refs.adminOfflineSalesStatus);
}

function renderAdminReceivableDuplicates() {
  if (!refs.adminReceivableDuplicatesList) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const candidates = Array.isArray(state.admin.receivableDuplicates)
    ? state.admin.receivableDuplicates
    : [];
  const loading = Boolean(state.admin.receivableDuplicatesLoading);
  const merging = Boolean(state.admin.receivableDuplicateMerging);

  if (refs.adminReceivableDuplicateSearch && refs.adminReceivableDuplicateSearch.value !== state.admin.receivableDuplicateSearch) {
    refs.adminReceivableDuplicateSearch.value = state.admin.receivableDuplicateSearch || "";
  }
  if (refs.adminReceivableDuplicatesStatus) {
    refs.adminReceivableDuplicatesStatus.textContent = loading
      ? "Buscando..."
      : candidates.length
        ? `${formatQuantity(candidates.length)} grupos`
        : "Sin duplicados";
  }

  if (loading && candidates.length === 0) {
    refs.adminReceivableDuplicatesList.innerHTML = `<div class="empty-state">Buscando clientes fiados duplicados.</div>`;
    return;
  }

  refs.adminReceivableDuplicatesList.innerHTML = candidates.length
    ? candidates.map((group) => {
        const target = (group.customers || [])[0] || null;
        const customers = Array.isArray(group.customers) ? group.customers : [];
        return `
          <article class="admin-record-item admin-receivable-duplicate-group">
            <div class="admin-record-item-head">
              <strong>${escapeHtml(group.customerName || "Cliente fiado")}</strong>
              <span class="small-pill">${escapeHtml(getBranchLabel(group.branch))}</span>
            </div>
            <p>${formatCurrency(group.pendingAmount || 0)} pendiente - ${formatQuantity(group.openSalesCount || 0)} ventas abiertas - ${formatQuantity(group.paymentsCount || 0)} abonos</p>
            <div class="admin-record-list compact-list">
              ${customers.map((customer) => `
                <div class="admin-record-item compact-record">
                  <div class="admin-record-item-head">
                    <strong>${escapeHtml(customer.customerName || "Cliente")}</strong>
                    <span class="small-pill">${formatCurrency(customer.pendingAmount || 0)}</span>
                  </div>
                  <p>${formatQuantity(customer.openSalesCount || 0)} abiertas - ${formatQuantity(customer.totalSalesCount || 0)} historicas - ${escapeHtml(customer.ticketNumbers?.slice(0, 3).join(", ") || "sin tickets")}</p>
                  <div class="admin-record-actions">
                    <button class="ghost-button compact-button" data-action="rename-receivable-customer" data-customer-key="${escapeHtml(customer.customerKey)}" type="button" ${merging ? "disabled" : ""}>
                      Corregir nombre
                    </button>
                    ${target && customer.customerKey !== target.customerKey ? `
                      <button class="secondary-button compact-button" data-action="merge-receivable-customer" data-source-customer-key="${escapeHtml(customer.customerKey)}" data-target-customer-key="${escapeHtml(target.customerKey)}" type="button" ${merging ? "disabled" : ""}>
                        Fusionar con principal
                      </button>
                    ` : `<span class="small-pill">Principal</span>`}
                  </div>
                </div>
              `).join("")}
            </div>
          </article>
        `;
      }).join("")
    : `<div class="empty-state">No hay clientes fiados duplicados en esta vista.</div>`;
}

function renderAdminProductDuplicates() {
  if (!refs.adminProductDuplicatesList) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const candidates = Array.isArray(state.admin.productDuplicates)
    ? state.admin.productDuplicates
    : [];
  const loading = Boolean(state.admin.productDuplicatesLoading);
  const merging = Boolean(state.admin.productDuplicateMerging);

  if (refs.adminProductDuplicateSearch && refs.adminProductDuplicateSearch.value !== state.admin.productDuplicateSearch) {
    refs.adminProductDuplicateSearch.value = state.admin.productDuplicateSearch || "";
  }
  if (refs.adminProductDuplicatesStatus) {
    refs.adminProductDuplicatesStatus.textContent = loading
      ? "Buscando..."
      : candidates.length
        ? `${formatQuantity(candidates.length)} grupos`
        : "Sin duplicados";
  }

  if (loading && candidates.length === 0) {
    refs.adminProductDuplicatesList.innerHTML = `<div class="empty-state">Buscando productos duplicados.</div>`;
    return;
  }

  refs.adminProductDuplicatesList.innerHTML = candidates.length
    ? candidates.map((group) => {
        const products = Array.isArray(group.products) ? group.products : [];
        const target = products.find((product) => product.active) || products[0] || null;
        return `
          <article class="admin-record-item admin-product-duplicate-group">
            <div class="admin-record-item-head">
              <strong>${escapeHtml(group.matchLabel || "Coincidencia")}: ${escapeHtml(group.matchValue || "")}</strong>
              <span class="small-pill">${escapeHtml(getBranchLabel(group.branch))}</span>
            </div>
            <p>${formatQuantity(group.activeCount || 0)} activos - stock unido ${formatQuantity(group.stockTotal || 0)}</p>
            <div class="admin-record-list compact-list">
              ${products.map((product) => `
                <div class="admin-record-item compact-record">
                  <div class="admin-record-item-head">
                    <strong>${escapeHtml(product.name || "Producto")}</strong>
                    <span class="small-pill">${product.active ? "Activo" : "Inactivo"}</span>
                  </div>
                  <p>
                    ${formatCurrency(product.price || 0)} venta - costo ${formatCurrency(product.cost || 0)} -
                    stock ${formatQuantity(product.stock || 0)}
                  </p>
                  <p>${escapeHtml([
                    product.supplierName ? `Proveedor ${product.supplierName}` : "",
                    product.brand ? `Marca ${product.brand}` : "",
                    product.sku ? `SKU ${product.sku}` : "",
                    product.barcode ? `Cod. ${product.barcode}` : "",
                  ].filter(Boolean).join(" - ") || "Sin codigos guardados")}</p>
                  <div class="admin-record-actions">
                    ${target && Number(product.id) !== Number(target.id) ? `
                      <button
                        class="secondary-button compact-button"
                        data-action="merge-product-duplicate"
                        data-source-product-id="${escapeHtml(String(product.id))}"
                        data-target-product-id="${escapeHtml(String(target.id))}"
                        type="button"
                        ${merging ? "disabled" : ""}
                      >
                        Fusionar con principal
                      </button>
                    ` : `<span class="small-pill">Principal</span>`}
                  </div>
                </div>
              `).join("")}
            </div>
          </article>
        `;
      }).join("")
    : `<div class="empty-state">No hay productos duplicados en esta vista.</div>`;
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

  renderAdminReceivableDuplicates();
  renderAdminProductDuplicates();

  refs.adminSalesList.innerHTML = sales.length
    ? sales
        .map(
          (sale) => `
            <button class="admin-record-item" data-action="edit-admin-record" data-kind="sale" data-id="${sale.id}" type="button">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(sale.ticketNumber)}</strong>
                <span class="small-pill">${formatCurrency(sale.total)}</span>
              </div>
              <p>${escapeHtml(getSalePaymentSummary(sale))}</p>
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

function renderAdminBranches() {
  if (!refs.adminBranchesList) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  if (refs.adminBranchTimezone && !refs.adminBranchTimezone.value) {
    refs.adminBranchTimezone.value = state.store.timezone || "America/Mexico_City";
  }

  refs.adminBranchesList.innerHTML = state.admin.branches.length
    ? state.admin.branches
        .map(
          (branch) => `
            <article class="admin-record-item">
              <div class="admin-record-item-head">
                <strong>${escapeHtml(branch.name)}</strong>
                <span class="small-pill">${escapeHtml(branch.code)}</span>
              </div>
              <p>${branch.active ? "Activa" : "Inactiva"} · ${escapeHtml(branch.timezone || "America/Mexico_City")}</p>
              <p>Orden ${escapeHtml(String(branch.sortOrder ?? 0))}</p>
              <div class="admin-record-actions">
                <button class="secondary-button compact-button" data-action="edit-branch" data-code="${escapeHtml(branch.code)}" type="button">
                  Editar
                </button>
                <button class="ghost-button compact-button ${branch.active ? "" : "is-active"}" data-action="toggle-branch" data-code="${escapeHtml(branch.code)}" data-active="${branch.active ? "1" : "0"}" type="button">
                  ${branch.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">No hay sucursales configuradas todavia.</div>`;
}

function renderAdminAuthModal() {
  if (!refs.adminAuthModal) {
    return;
  }

  const isSetup = state.adminAuth.mode === "setup";
  const isBlocked = state.adminAuth.mode === "blocked";
  refs.adminAuthTitle.textContent = isBlocked
    ? "Bootstrap admin bloqueado"
    : isSetup
      ? "Crear acceso admin"
      : "Acceso admin";
  refs.adminAuthDescription.textContent = isBlocked
    ? "Este despliegue no permite crear el acceso admin por web. Configura POS_BOOTSTRAP_TOKEN o prepara credenciales antes de exponerlo."
    : isSetup
      ? "Crea usuario y contrasena para proteger el panel admin."
      : state.mobileApprovals?.active
        ? "Ingresa usuario y contrasena para abrir la bandeja movil de aprobaciones."
        : "Ingresa usuario y contrasena para abrir el panel admin.";
  refs.adminAuthPasswordLabel.textContent = isSetup ? "Nueva contrasena" : "Contrasena";
  refs.adminAuthConfirmField.hidden = !isSetup;
  if (refs.adminAuthBootstrapStatus) {
    refs.adminAuthBootstrapStatus.hidden = !isSetup;
    refs.adminAuthBootstrapStatus.textContent = state.admin.setupAllowed
      ? "Captura el token de bootstrap para habilitar la creacion inicial."
      : "La creacion web de admin esta deshabilitada en este despliegue.";
  }
  if (refs.adminAuthBootstrapField) {
    refs.adminAuthBootstrapField.hidden = !isSetup || !state.admin.setupAllowed;
  }
  refs.saveAdminAuthButton.textContent = state.adminAuth.loading
    ? "Guardando..."
    : isBlocked
      ? "Bloqueado"
      : isSetup
      ? "Crear contrasena"
      : "Entrar";
  refs.saveAdminAuthButton.disabled = state.adminAuth.loading || isBlocked;
  refs.adminAuthUsername.disabled = state.adminAuth.loading || isBlocked;
  refs.adminAuthPassword.disabled = state.adminAuth.loading || isBlocked;
  refs.adminAuthConfirmPassword.disabled = state.adminAuth.loading || isBlocked;
  if (refs.adminAuthBootstrapToken) {
    refs.adminAuthBootstrapToken.disabled = state.adminAuth.loading || isBlocked || !isSetup || !state.admin.setupAllowed;
  }
}

function renderOwnerAuthModal() {
  if (!refs.ownerAuthModal) {
    return;
  }

  const isSetup = state.ownerAuth.mode === "setup";
  const isBlocked = state.ownerAuth.mode === "blocked";
  refs.ownerAuthTitle.textContent = isBlocked
    ? "Bootstrap owner bloqueado"
    : isSetup
      ? "Crear acceso owner"
      : "Acceso owner";
  refs.ownerAuthDescription.textContent = isBlocked
    ? "Este despliegue no permite crear el acceso owner por web. Configura POS_BOOTSTRAP_TOKEN o prepara el owner antes de publicarlo."
    : isSetup
      ? "Crea tu usuario y contrasena maestra para abrir la consola dev oculta."
      : "Ingresa tu usuario y contrasena maestra para abrir la consola dev oculta.";
  refs.ownerAuthPasswordLabel.textContent = isSetup ? "Nueva contrasena" : "Contrasena";
  refs.ownerAuthConfirmField.hidden = !isSetup;
  if (refs.ownerAuthBootstrapStatus) {
    refs.ownerAuthBootstrapStatus.hidden = !isSetup;
    refs.ownerAuthBootstrapStatus.textContent = state.owner.setupAllowed
      ? "Captura el token de bootstrap para crear el owner inicial."
      : "La creacion web de owner esta deshabilitada en este despliegue.";
  }
  if (refs.ownerAuthBootstrapField) {
    refs.ownerAuthBootstrapField.hidden = !isSetup || !state.owner.setupAllowed;
  }
  refs.saveOwnerAuthButton.textContent = state.ownerAuth.loading
    ? "Guardando..."
    : isBlocked
      ? "Bloqueado"
      : isSetup
      ? "Crear acceso"
      : "Entrar";
  refs.saveOwnerAuthButton.disabled = state.ownerAuth.loading || isBlocked;
  refs.ownerAuthUsername.disabled = state.ownerAuth.loading || isBlocked;
  refs.ownerAuthPassword.disabled = state.ownerAuth.loading || isBlocked;
  refs.ownerAuthConfirmPassword.disabled = state.ownerAuth.loading || isBlocked;
  if (refs.ownerAuthBootstrapToken) {
    refs.ownerAuthBootstrapToken.disabled = state.ownerAuth.loading || isBlocked || !isSetup || !state.owner.setupAllowed;
  }
}

function renderAdminBrandingEditor() {
  const brandingState = state.admin.brandingLogo || {};
  const branding = state.profile?.branding || {};
  const uploadedLogoUrl = String(branding.uploadedLogo?.url || "").trim();
  const savedLogoUrl = uploadedLogoUrl || branding.logo192 || branding.logo512 || branding.logo || "";
  const previewUrl = brandingState.previewUrl || savedLogoUrl;
  const isBusy = Boolean(brandingState.uploading || brandingState.removing);

  if (refs.configLogoPreview) {
    refs.configLogoPreview.hidden = !previewUrl;
    if (previewUrl) {
      refs.configLogoPreview.src = previewUrl;
    } else {
      refs.configLogoPreview.removeAttribute("src");
    }
  }
  if (refs.configLogoPreviewFallback) {
    refs.configLogoPreviewFallback.hidden = Boolean(previewUrl);
    refs.configLogoPreviewFallback.textContent = String(
      state.profile?.shortName || state.profile?.businessName || "POS",
    ).slice(0, 3).toUpperCase();
  }
  if (refs.configLogoInput) {
    refs.configLogoInput.disabled = isBusy;
  }
  if (refs.uploadConfigLogoButton) {
    refs.uploadConfigLogoButton.disabled = isBusy || !brandingState.file;
    refs.uploadConfigLogoButton.textContent = brandingState.uploading ? "Subiendo..." : "Subir logo";
  }
  if (refs.removeConfigLogoButton) {
    refs.removeConfigLogoButton.disabled = isBusy || !uploadedLogoUrl;
    refs.removeConfigLogoButton.textContent = brandingState.removing ? "Quitando..." : "Quitar logo";
  }
  if (refs.configLogoFileStatus) {
    refs.configLogoFileStatus.textContent = brandingState.uploading
      ? "Guardando logo..."
      : brandingState.removing
        ? "Quitando logo personalizado..."
        : brandingState.file
          ? `${brandingState.file.name} - ${(brandingState.file.size / 1024).toFixed(0)} KiB`
          : uploadedLogoUrl
            ? "Logo personalizado activo. PNG o JPEG, maximo 2 MiB."
            : "PNG o JPEG, maximo 2 MiB.";
  }
}

function renderOwnerOperationGuide() {
  if (!refs.ownerOperationGuide) {
    return;
  }

  const guide = state.owner.operationGuide;
  if (!guide) {
    refs.ownerOperationGuide.innerHTML = `<div class="empty-state">Cargando comandos owner...</div>`;
    return;
  }

  const current = guide.current || {};
  const controlPlane = current.controlPlane || {};
  const runtimeConfig = current.runtimeConfig || {};
  const commands = Array.isArray(guide.commands) ? guide.commands : [];
  const runtimeVariables = Array.isArray(guide.runtimeVariables) ? guide.runtimeVariables : [];
  const configExample = JSON.stringify(guide.localRuntimeConfigExample || {}, null, 2);
  const runtimeStatus = runtimeConfig.error
    ? `Error: ${runtimeConfig.error}`
    : runtimeConfig.loaded
      ? `Archivo: ${runtimeConfig.sourcePath || "config local"}`
      : "Sin archivo local detectado";
  const runtimeRestartRequired = Boolean(runtimeConfig.restartRequired);
  const runtimePendingKeys = Array.isArray(runtimeConfig.pendingRestartKeys) && runtimeConfig.pendingRestartKeys.length
    ? runtimeConfig.pendingRestartKeys.join(", ")
    : "sin cambios pendientes";
  const runtimeKeys = Array.isArray(runtimeConfig.keys) && runtimeConfig.keys.length
    ? runtimeConfig.keys.join(", ")
    : "sin llaves";
  const secretKeys = Array.isArray(runtimeConfig.secretKeys) && runtimeConfig.secretKeys.length
    ? runtimeConfig.secretKeys.join(", ")
    : "sin secretos detectados";
  const missingControl = controlPlane.error
    ? controlPlane.error
    : Array.isArray(controlPlane.missing) && controlPlane.missing.length
      ? controlPlane.missing.join(", ")
      : "completo";
  const controlUsable = Boolean(controlPlane.usable);
  const controlDegraded = Boolean(controlPlane.degraded);
  const controlLabel = controlUsable
    ? controlDegraded
      ? controlPlane.authFailed
        ? "Owner-control con auth fallida"
        : "Owner-control con fallo reciente"
      : controlPlane.lastSuccessAt
        ? "Owner-control conectado"
        : "Owner-control listo sin prueba reciente"
    : controlPlane.configured
      ? "Owner-control requiere correccion"
      : "Owner-control pendiente";
  const controlRuntimeDetail = !controlUsable
    ? missingControl
    : controlDegraded
      ? `${controlPlane.lastError || "Owner-control fallo recientemente."} (${formatAdminTimestamp(controlPlane.lastErrorAt)})`
      : controlPlane.lastSuccessAt
        ? `Ultimo OK ${formatAdminTimestamp(controlPlane.lastSuccessAt)}`
        : "Sin intentos recientes desde este proceso.";
  const runtimeGroups = runtimeVariables.reduce((groups, variable) => {
    const groupName = variable.group || "General";
    groups[groupName] = groups[groupName] || [];
    groups[groupName].push(variable);
    return groups;
  }, {});
  const runtimeSaving = Boolean(state.owner.runtimeConfigSaving);
  const runtimeSyncing = Boolean(state.owner.runtimeConfigSyncing);
  const runtimeBusy = runtimeSaving || runtimeSyncing;
  const renderRuntimeField = (variable) => {
    const isSecret = Boolean(variable.secret);
    const options = Array.isArray(variable.options) ? variable.options : [];
    const value = variable.value || "";
    const sourceLabel = variable.source === "owner"
      ? "owner"
      : variable.source === "service"
        ? "servicio"
        : "vacio";
    const restartLabel = variable.pendingRestart ? " - reinicio pendiente" : variable.restartRequired ? " - reinicio" : "";
    const helper = isSecret && variable.hasStoredValue
      ? "Guardado. Escribe un valor nuevo solo si quieres reemplazarlo."
      : variable.description || "";
    const fieldControl = variable.type === "select"
      ? `<select data-owner-runtime-key="${escapeHtml(variable.key)}" data-owner-runtime-secret="${isSecret ? "true" : "false"}" ${runtimeBusy ? "disabled" : ""}>
          ${options.map((option) => `<option value="${escapeHtml(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option || "sin valor")}</option>`).join("")}
        </select>`
      : `<input
          data-owner-runtime-key="${escapeHtml(variable.key)}"
          data-owner-runtime-secret="${isSecret ? "true" : "false"}"
          type="${isSecret ? "password" : "text"}"
          value="${isSecret ? "" : escapeHtml(value)}"
          placeholder="${escapeHtml(isSecret && variable.maskedValue ? variable.maskedValue : variable.placeholder || "")}"
          autocomplete="off"
          spellcheck="false"
          ${runtimeBusy ? "disabled" : ""}
        />`;

    return `
      <label class="field owner-runtime-field">
        <span>${escapeHtml(variable.label || variable.key)}</span>
        ${fieldControl}
        <small>${escapeHtml(variable.key)} - ${escapeHtml(sourceLabel)}${escapeHtml(restartLabel)}</small>
        <small>${escapeHtml(helper)}</small>
        <span class="owner-runtime-clear-row">
          <input data-owner-runtime-clear="${escapeHtml(variable.key)}" type="checkbox" ${runtimeBusy ? "disabled" : ""} />
          <small>Limpiar esta variable del archivo owner</small>
        </span>
      </label>
    `;
  };

  refs.ownerOperationGuide.innerHTML = `
    <div class="owner-operation-status-grid">
      <article class="admin-record-item">
        <div class="admin-record-item-head">
          <strong>${escapeHtml(current.slug || state.profile?.slug || "sin-slug")}</strong>
          <span class="small-pill">${escapeHtml(current.templateKey || "base")}</span>
        </div>
        <p>${escapeHtml(current.businessName || state.profile?.businessName || "Negocio")}</p>
        <p>DB ${escapeHtml(current.dbPath || "data/merxalia-pos.sqlite")}</p>
      </article>
      <article class="admin-record-item">
        <div class="admin-record-item-head">
          <strong>${escapeHtml(controlLabel)}</strong>
          <span class="small-pill">${escapeHtml(controlPlane.clientSlug || "sin slug")}</span>
        </div>
        <p>${escapeHtml(controlPlane.apiUrl || "sin CONTROL_API_URL")}</p>
        <p>${escapeHtml(controlRuntimeDetail)}</p>
      </article>
      <article class="admin-record-item">
        <div class="admin-record-item-head">
          <strong>Config local</strong>
          <span class="small-pill">${runtimeRestartRequired ? "reinicio pendiente" : runtimeConfig.loaded ? "activa" : "opcional"}</span>
        </div>
        <p>${escapeHtml(runtimeStatus)}</p>
        <p>${escapeHtml(runtimeKeys)} - ${escapeHtml(secretKeys)}</p>
        <p>${escapeHtml(runtimePendingKeys)}</p>
      </article>
    </div>

    <div class="owner-runtime-editor">
      <div class="admin-record-item-head">
        <div>
          <strong>Variables dentro del panel owner</strong>
          <p>Fuente central: owner-control. Este POS aplica una copia en ${escapeHtml(runtimeConfig.sourcePath || "data/pos-runtime-config.json")} para arrancar sin depender de Railway.</p>
        </div>
        <span class="small-pill">${runtimeSyncing ? "sincronizando" : runtimeSaving ? "guardando" : "owner-control"}</span>
      </div>
      <div class="admin-record-actions owner-runtime-actions">
        <button class="primary-button compact-button" data-owner-runtime-sync type="button" ${runtimeBusy || !controlUsable ? "disabled" : ""}>
          ${runtimeSyncing ? "Sincronizando..." : "Sincronizar desde owner-control"}
        </button>
        <button class="ghost-button compact-button" data-owner-runtime-save type="button" ${runtimeBusy ? "disabled" : ""}>
          ${runtimeSaving ? "Guardando..." : "Guardar cache local"}
        </button>
      </div>
      <div class="owner-runtime-groups">
        ${Object.entries(runtimeGroups).map(([groupName, variables]) => `
          <section class="owner-runtime-group">
            <h4>${escapeHtml(groupName)}</h4>
            <div class="owner-runtime-grid">
              ${variables.map(renderRuntimeField).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    </div>

    <div class="owner-command-list">
      ${commands.length ? commands.map((item) => `
        <article class="owner-command-item">
          <div class="admin-record-item-head">
            <div>
              <strong>${escapeHtml(item.label || item.id || "Comando")}</strong>
              <p>${escapeHtml(item.description || "")}</p>
            </div>
            <button class="ghost-button compact-button" data-owner-copy-command="${escapeHtml(item.id || "")}" type="button">
              Copiar
            </button>
          </div>
          <pre><code>${escapeHtml(item.command || "")}</code></pre>
        </article>
      `).join("") : `<div class="empty-state">Sin comandos owner disponibles.</div>`}
    </div>

    <div class="owner-runtime-example">
      <div class="admin-record-item-head">
        <strong>data/pos-runtime-config.json</strong>
        <span class="small-pill">plantilla</span>
      </div>
      <pre><code>${escapeHtml(configExample)}</code></pre>
    </div>
  `;
}

function renderOwnerConsoleModal() {
  if (!refs.ownerConsoleModal || !refs.ownerModulesWrap || !refs.ownerAdminSectionsWrap) {
    return;
  }

  refs.ownerConsoleTitle.textContent = "Panel dev oculto";
  refs.ownerConsoleDescription.textContent = state.owner.authenticated
    ? `Sesion owner activa como ${state.owner.username || "owner"}.`
    : "Acceso reservado para el desarrollador o dueño tecnico del sistema.";

  const modules = getOwnerAvailableModules();
  const adminSections = getOwnerAdminSections();
  const loading = state.owner.loading;
  const saving = state.owner.saving;
  const applyingTemplate = Boolean(state.owner.templateReset?.applying);
  const ownerTemplateBusy = loading || saving || applyingTemplate;

  refs.ownerModulesWrap.innerHTML = modules.length
    ? modules.map((module) => `
        <label class="admin-chip-toggle">
          <input
            type="checkbox"
            data-owner-module-code="${escapeHtml(module.code)}"
            ${hasEnabledModule(module.code) ? "checked" : ""}
            ${loading || saving ? "disabled" : ""}
          />
          <span>
            <strong>${escapeHtml(module.label)}</strong>
            <small>${escapeHtml(module.description || "")}</small>
          </span>
        </label>
      `).join("")
    : `<div class="empty-state">Sin modulos owner registrados.</div>`;

  refs.ownerAdminSectionsWrap.innerHTML = adminSections.length
    ? adminSections.map((section) => `
        <label class="admin-chip-toggle">
          <input
            type="checkbox"
            data-owner-capability-code="${escapeHtml(section.code)}"
            ${hasAdminCapability(section.code) ? "checked" : ""}
            ${loading || saving ? "disabled" : ""}
          />
          <span>
            <strong>${escapeHtml(section.label)}</strong>
            <small>${escapeHtml(section.description || "")}</small>
          </span>
        </label>
      `).join("")
    : `<div class="empty-state">Sin secciones owner registradas.</div>`;

  if (refs.ownerTemplateCurrentSlug) {
    refs.ownerTemplateCurrentSlug.textContent = state.profile?.slug || "(sin slug)";
  }
  if (refs.ownerTemplateStatus) {
    refs.ownerTemplateStatus.textContent = applyingTemplate
      ? "Rearmando negocio y catalogo..."
      : "Esta accion reinicia productos, cajeros, ventas y sesiones. Requiere el slug actual y un Excel valido.";
  }
  if (refs.ownerTemplateSelect) {
    setSelectOptions(
      refs.ownerTemplateSelect,
      (state.owner.templates || []).map((template) => ({
        value: template.key,
        label: `${template.key} - ${template.description || template.businessName || template.key}`,
      })),
      state.owner.templateReset?.selectedTemplateKey || state.owner.templates?.[0]?.key || "",
    );
    refs.ownerTemplateSelect.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.ownerTemplateBusinessName) {
    refs.ownerTemplateBusinessName.value = state.owner.templateReset?.businessName || "";
    refs.ownerTemplateBusinessName.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.ownerTemplateSlug) {
    refs.ownerTemplateSlug.value = state.owner.templateReset?.slug || "";
    refs.ownerTemplateSlug.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.ownerTemplateWorkbookPath) {
    refs.ownerTemplateWorkbookPath.value = state.owner.templateReset?.workbookPath || "";
    refs.ownerTemplateWorkbookPath.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.ownerTemplateConfirmText) {
    refs.ownerTemplateConfirmText.value = state.owner.templateReset?.confirmText || "";
    refs.ownerTemplateConfirmText.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.ownerTemplateConfirmReset) {
    refs.ownerTemplateConfirmReset.checked = Boolean(state.owner.templateReset?.confirmReset);
    refs.ownerTemplateConfirmReset.disabled = ownerTemplateBusy || !state.owner.authenticated;
  }
  if (refs.applyOwnerTemplateButton) {
    refs.applyOwnerTemplateButton.disabled = ownerTemplateBusy || !state.owner.authenticated;
    refs.applyOwnerTemplateButton.textContent = applyingTemplate ? "Reiniciando..." : "Aplicar plantilla completa";
  }
  if (refs.ownerAdminSimplePresetButton) {
    refs.ownerAdminSimplePresetButton.disabled = loading || saving || !state.owner.authenticated;
  }
  if (refs.ownerAdminFullPresetButton) {
    refs.ownerAdminFullPresetButton.disabled = loading || saving || !state.owner.authenticated;
  }

  renderOwnerOperationGuide();
  renderOfflineSalesPanel(refs.ownerOfflineSalesList, refs.ownerOfflineSalesStatus);
  refs.saveOwnerConsoleButton.disabled = loading || saving || applyingTemplate || !state.owner.authenticated;
  refs.saveOwnerConsoleButton.textContent = saving ? "Guardando..." : "Guardar cambios";
  refs.ownerLogoutButton.disabled = saving || applyingTemplate;
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
          ${getBranchOptions().filter((option) => option.value !== "all").map((option) => `<option value="${escapeHtml(option.value)}" ${detail.branch === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
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
          ${PAYMENT_METHOD_OPTIONS.map((method) => `<option value="${escapeHtml(method.value)}" ${detail.paymentMethod === method.value ? "selected" : ""}>${escapeHtml(method.label)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Cliente o referencia</span>
        <input data-editor-field="customerName" type="text" maxlength="80" value="${escapeHtml(detail.customerName || "")}" />
      </label>
      <label class="field">
        <span>Cobrado hoy / recibido</span>
        <input data-editor-field="receivedAmount" type="number" min="0" step="0.01" value="${escapeHtml(detail.receivedAmount ?? 0)}" />
      </label>
      <label class="field">
        <span>Cobrado por</span>
        <select data-editor-field="receivedPaymentMethod">
          <option value="">Sin abono</option>
          ${RECEIVED_PAYMENT_METHOD_OPTIONS.map((method) => {
            const selectedValue = getSaleReceivedPaymentMethod(
              detail.paymentMethod,
              detail.receivedPaymentMethod || "",
              detail.receivedAmount,
            );
            return `<option value="${escapeHtml(method.value)}" ${selectedValue === method.value ? "selected" : ""}>${escapeHtml(method.label)}</option>`;
          }).join("")}
        </select>
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
        <input data-editor-field="openingAmount" type="number" min="0" step="0.01" value="${escapeHtml(detail.openingAmount ?? 0)}" />
      </label>
      <label class="field">
        <span>Efectivo contado</span>
        <input data-editor-field="countedAmount" type="number" min="0" step="0.01" value="${escapeHtml(detail.countedAmount ?? 0)}" />
      </label>
      <label class="field">
        <span>Efectivo esperado</span>
        <input data-editor-field="expectedCash" type="number" min="0" step="0.01" value="${escapeHtml(detail.expectedCash ?? 0)}" />
      </label>
      <label class="field">
        <span>Se retira</span>
        <input data-editor-field="withdrawalsAmount" type="number" min="0" step="0.01" value="${escapeHtml(detail.withdrawalsAmount ?? 0)}" />
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
      <input data-editor-field="quantityDelta" type="number" step="0.25" value="${escapeHtml(detail.quantityDelta ?? 0)}" ${detail.movementType === "sale" ? "disabled" : ""} />
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

function buildPeriodClosureSummaryCards(summary = {}) {
  return `
    <article class="period-closure-summary-card">
      <span>Ventas</span>
      <strong>${formatCurrency(summary.totalSales || 0)}</strong>
      <p>${formatQuantity(summary.tickets || 0)} tickets · Promedio ${formatCurrency(summary.averageTicket || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Efectivo esperado</span>
      <strong>${formatCurrency(summary.expectedCash || 0)}</strong>
      <p>Aperturas ${formatCurrency(summary.openingAmount || 0)} · Retiros ${formatCurrency(summary.withdrawalsAmount || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Canales</span>
      <strong>${formatCurrency(summary.cashSales || 0)}</strong>
      <p>Tarjeta ${formatCurrency(summary.cardSales || 0)} · Transferencia ${formatCurrency(summary.transferSales || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Fiado</span>
      <strong>${formatCurrency(summary.creditSales || 0)}</strong>
      <p>Abonos cobrados ${formatCurrency(summary.creditCollections || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Cortes</span>
      <strong>${formatQuantity(summary.finalCuts || 0)}</strong>
      <p>Rapidos ${formatQuantity(summary.quickCuts || 0)} · Diferencia ${formatCurrency(summary.finalCutDifferenceTotal || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Auditoria kg</span>
      <strong>${formatQuantity(summary.weightedAuditCompletedSessions || 0)}</strong>
      <p>Pendientes ${formatQuantity(summary.weightedAuditPendingSessions || 0)} · Incidencias ${formatQuantity(summary.weightedAuditIncidentItems || 0)}</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Merma / sobrante</span>
      <strong>${formatQuantity(summary.weightedAuditShortageKg || 0)} / ${formatQuantity(summary.weightedAuditSurplusKg || 0)}</strong>
      <p>Kilos agregados o faltantes</p>
    </article>
    <article class="period-closure-summary-card">
      <span>Impacto</span>
      <strong>${formatCurrency(summary.weightedAuditVarianceValue || 0)}</strong>
      <p>Variacion economica de auditoria kg</p>
    </article>
  `;
}

function buildPeriodClosureWarningMarkup(warning = {}) {
  const severity = String(warning.severity || "info").toLowerCase();
  return `
    <article class="period-closure-warning ${sanitizeClassToken(severity, "info")}">
      <strong>${escapeHtml(String(warning.code || "warning").replaceAll("_", " "))}</strong>
      <p>${escapeHtml(warning.message || "Advertencia sin detalle.")}</p>
    </article>
  `;
}

function buildPeriodClosureBreakdownMarkup(title, items = [], labelBuilder) {
  return `
    <section class="period-closure-breakdown-block">
      <div class="panel-head admin-subhead compact-inline-head">
        <div>
          <p class="eyebrow">Desglose</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="period-closure-breakdown-grid">
        ${items.length
          ? items.map((item) => `
              <article class="period-closure-breakdown-card">
                <strong>${escapeHtml(labelBuilder(item))}</strong>
                <p>Ventas ${formatCurrency(item.totalSales || 0)} · Tickets ${formatQuantity(item.tickets || 0)}</p>
                <p>Efectivo ${formatCurrency(item.cashSales || 0)} · Fiado ${formatCurrency(item.creditSales || 0)}</p>
                <p>Cortes ${formatQuantity(item.finalCuts || 0)} · Kg incidencias ${formatQuantity(item.weightedAuditIncidentItems || 0)}</p>
              </article>
            `).join("")
          : `<div class="empty-state">Sin datos en este desglose.</div>`}
      </div>
    </section>
  `;
}

function buildPeriodClosureDetailMarkup(closure, emptyMessage) {
  if (!closure) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  const storedWarnings = Array.isArray(closure.storedWarnings)
    ? closure.storedWarnings
    : Array.isArray(closure.warnings)
      ? closure.warnings
      : [];
  const liveWarnings = Array.isArray(closure.liveWarnings) ? closure.liveWarnings : storedWarnings;
  const detailWarnings = closure.isStale ? liveWarnings : storedWarnings;
  const warningMarkup = detailWarnings.length
    ? detailWarnings.map((warning) => buildPeriodClosureWarningMarkup(warning)).join("")
    : `<div class="empty-state">${closure.isStale ? "Hoy no hay warnings activos, pero el snapshot guardado ya no coincide con los datos vivos." : "Este cierre no tiene warnings guardados."}</div>`;
  const staleWarningMarkup = closure.isStale
    ? `
        <article class="period-closure-warning error">
          <strong>snapshot desactualizado</strong>
          <p>Este cierre guardado ya no coincide con el estado actual del periodo. Revisa las advertencias vivas antes de confiar en este snapshot.</p>
        </article>
      `
    : "";

  return `
    <div class="period-closure-detail-head">
      <div>
        <p class="eyebrow">Detalle guardado</p>
        <h3>${escapeHtml(closure.periodStartDateKey)} a ${escapeHtml(closure.periodEndDateKey)}</h3>
      </div>
      <span class="small-pill ${closure.isStale ? "period-closure-pill-stale" : "period-closure-pill-fresh"}">
        ${closure.isStale ? "Desactualizado" : "Vigente"}
      </span>
    </div>
    <div class="period-closure-detail-grid">
      <article class="period-closure-detail-stat">
        <span>Sucursal</span>
        <strong>${escapeHtml(getBranchLabel(closure.branch))}</strong>
      </article>
      <article class="period-closure-detail-stat">
        <span>Actualizado</span>
        <strong>${escapeHtml(dateTimeFormatter.format(new Date(closure.updatedAt || closure.createdAt || Date.now())))}</strong>
      </article>
      <article class="period-closure-detail-stat">
        <span>Tickets</span>
        <strong>${formatQuantity(closure.summary?.tickets || 0)}</strong>
      </article>
      <article class="period-closure-detail-stat">
        <span>Ventas</span>
        <strong>${formatCurrency(closure.summary?.totalSales || 0)}</strong>
      </article>
    </div>
    <div class="period-closure-detail-notes">
      <strong>Notas</strong>
      <p>${escapeHtml(closure.notes || "Sin notas guardadas para este cierre.")}</p>
    </div>
    <div class="period-closure-detail-notes">
      <strong>${closure.isStale ? "Advertencias actuales" : "Advertencias guardadas"}</strong>
      <p>${closure.isStale ? "Estas advertencias se recalcularon con el estado vivo del periodo." : "Estas advertencias pertenecen al snapshot guardado."}</p>
    </div>
    <div class="period-closure-warning-list detail">${staleWarningMarkup}${warningMarkup}</div>
  `;
}

function renderAdminPeriodClosuresPanel() {
  if (
    !refs.adminPeriodClosuresStatus
    || !refs.adminPeriodClosuresSummary
    || !refs.adminPeriodClosuresWarnings
    || !refs.adminPeriodClosuresBreakdowns
    || !refs.adminPeriodClosureDetail
    || !refs.adminPeriodClosuresList
  ) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const periodState = state.admin.periodClosures || {};
  const preview = periodState.preview || null;
  const matchingClosure = preview?.matchingClosure || null;
  const selectedClosure = periodState.currentClosure || matchingClosure || null;

  if (refs.adminPeriodClosureDate) {
    if (refs.adminPeriodClosureDate.value !== (periodState.dateKey || toDateInputValue())) {
      refs.adminPeriodClosureDate.value = periodState.dateKey || toDateInputValue();
    }
    refs.adminPeriodClosureDate.disabled = Boolean(periodState.loading || periodState.saving);
  }
  if (refs.adminPeriodClosureNotes) {
    if (refs.adminPeriodClosureNotes.value !== (periodState.notesDraft || "")) {
      refs.adminPeriodClosureNotes.value = periodState.notesDraft || "";
    }
    refs.adminPeriodClosureNotes.disabled = Boolean(periodState.loading || periodState.saving || !preview);
  }

  const statusParts = [];
  if (periodState.loading) {
    statusParts.push("Cargando...");
  } else if (preview) {
    statusParts.push(`Semana ${preview.periodStartDateKey} a ${preview.periodEndDateKey}`);
    statusParts.push(preview.canSave ? "lista para cierre" : "con bloqueos");
  } else {
    statusParts.push("Sin semana cargada");
  }
  if (matchingClosure) {
    statusParts.push(matchingClosure.isStale ? "snapshot desactualizado" : "snapshot vigente");
  }
  refs.adminPeriodClosuresStatus.textContent = statusParts.join(" · ");

  refs.adminPeriodClosuresSummary.innerHTML = preview
    ? buildPeriodClosureSummaryCards(preview.summary || {})
    : `<div class="empty-state">Carga una fecha ancla para ver el consolidado semanal.</div>`;

  refs.adminPeriodClosuresWarnings.innerHTML = preview
    ? Array.isArray(preview.warnings) && preview.warnings.length
      ? preview.warnings.map((warning) => buildPeriodClosureWarningMarkup(warning)).join("")
      : `<div class="period-closure-warning ok"><strong>Sin bloqueos</strong><p>La vista previa semanal esta lista para guardarse como cierre oficial.</p></div>`
    : "";

  if (preview) {
    const breakdownBlocks = [
      buildPeriodClosureBreakdownMarkup(
        "Por dia",
        Array.isArray(preview.breakdowns?.byDate) ? preview.breakdowns.byDate : [],
        (item) => item.dateKey || "Sin fecha",
      ),
      buildPeriodClosureBreakdownMarkup(
        "Por turno",
        Array.isArray(preview.breakdowns?.byShift) ? preview.breakdowns.byShift : [],
        (item) => item.shift || "Sin turno",
      ),
      buildPeriodClosureBreakdownMarkup(
        "Por cajero",
        Array.isArray(preview.breakdowns?.byCashier) ? preview.breakdowns.byCashier : [],
        (item) => item.branchLabel && preview.branch === "all"
          ? `${item.branchLabel} · ${item.cashier || "Sin cajero"}`
          : item.cashier || "Sin cajero",
      ),
    ];

    if (Array.isArray(preview.breakdowns?.byBranch)) {
      breakdownBlocks.push(
        buildPeriodClosureBreakdownMarkup(
          "Por sucursal",
          preview.breakdowns.byBranch,
          (item) => item.branchLabel || item.branch || "Sin sucursal",
        ),
      );
    }

    refs.adminPeriodClosuresBreakdowns.innerHTML = breakdownBlocks.join("");
  } else {
    refs.adminPeriodClosuresBreakdowns.innerHTML = "";
  }

  refs.adminPeriodClosureDetail.innerHTML = buildPeriodClosureDetailMarkup(
    selectedClosure,
    periodState.detailLoading
      ? "Cargando detalle del cierre guardado..."
      : "Selecciona un cierre guardado para revisar su snapshot y su estado.",
  );

  refs.adminPeriodClosuresList.innerHTML = Array.isArray(periodState.closures) && periodState.closures.length
    ? periodState.closures.map((closure) => `
        <button
          class="admin-record-item ${Number(periodState.selectedClosureId || selectedClosure?.id || 0) === Number(closure.id) ? "active" : ""}"
          data-action="open-period-closure"
          data-id="${closure.id}"
          type="button"
        >
          <div class="admin-record-item-head">
            <strong>${escapeHtml(closure.periodStartDateKey)} a ${escapeHtml(closure.periodEndDateKey)}</strong>
            <span class="small-pill ${closure.isStale ? "period-closure-pill-stale" : "period-closure-pill-fresh"}">
              ${closure.isStale ? "Desactualizado" : "Vigente"}
            </span>
          </div>
          <p>${escapeHtml(getBranchLabel(closure.branch))} · ${formatCurrency(closure.summary?.totalSales || 0)} · ${formatQuantity(closure.summary?.tickets || 0)} tickets</p>
          <p>Actualizado ${escapeHtml(dateTimeFormatter.format(new Date(closure.updatedAt || closure.createdAt || Date.now())))}</p>
        </button>
      `).join("")
    : `<div class="empty-state">Aun no hay cierres semanales guardados para esta sucursal.</div>`;

  if (refs.loadAdminPeriodClosuresButton) {
    refs.loadAdminPeriodClosuresButton.disabled = Boolean(periodState.loading || periodState.saving);
  }
  if (refs.saveAdminPeriodClosureButton) {
    refs.saveAdminPeriodClosureButton.disabled = Boolean(
      periodState.loading
      || periodState.saving
      || !preview
      || !preview.canSave
      || matchingClosure,
    );
    refs.saveAdminPeriodClosureButton.textContent = periodState.saving && !matchingClosure
      ? "Guardando..."
      : "Guardar cierre semanal";
  }
  if (refs.regenerateAdminPeriodClosureButton) {
    refs.regenerateAdminPeriodClosureButton.disabled = Boolean(
      periodState.loading
      || periodState.saving
      || !preview
      || !preview.canSave
      || !matchingClosure,
    );
    refs.regenerateAdminPeriodClosureButton.textContent = periodState.saving && matchingClosure
      ? "Regenerando..."
      : "Regenerar";
  }
}

function renderAdminWeightedAuditPanelLegacy() {
  if (!refs.adminWeightedAuditSessions || !refs.adminWeightedAuditItems || !refs.adminWeightedAuditStatus) {
    return;
  }
  if (!refs.adminModal?.classList.contains("open")) {
    return;
  }

  const weightedPanelEnabled = hasEnabledModule("weighted_audit") && hasAdminCapability("weighted_audit");
  const weightedPanel = refs.adminWeightedAuditStatus.closest(".admin-weighted-panel");
  if (!weightedPanelEnabled) {
    if (weightedPanel) {
      weightedPanel.hidden = true;
    }
    refs.adminWeightedAuditStatus.textContent = "Auditoria desactivada";
    refs.adminWeightedAuditSessions.innerHTML = "";
    refs.adminWeightedAuditItems.innerHTML = "";
    if (refs.saveWeightedAuditItemsButton) {
      refs.saveWeightedAuditItemsButton.disabled = true;
    }
    if (refs.completeWeightedAuditButton) {
      refs.completeWeightedAuditButton.disabled = true;
    }
    return;
  }
  if (weightedPanel) {
    weightedPanel.hidden = false;
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
                  <span class="small-pill weighted-audit-pill ${sanitizeClassToken(item.statusKey, "pending")}${item.missingReason ? " needs-reason" : ""}" data-role="weighted-status">${escapeHtml(item.statusLabel)}</span>
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
              <td class="weighted-audit-difference ${sanitizeClassToken(item.statusKey, "pending")}" data-role="weighted-difference">${item.statusKey === "pending" ? "-" : item.statusKey === "invalid" ? "Invalido" : `${item.difference > 0 ? "+" : ""}${escapeHtml(formatQuantity(item.difference))}`}</td>
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
