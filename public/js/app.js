// Punto de entrada principal - Inicialización de la aplicación

function updateClock() {
  const now = new Date();
  refs.liveDate.textContent = dateFormatter.format(now);
  refs.liveTime.textContent = timeFormatter.format(now);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("/sw.js").catch(() => {
    showToast("No fue posible activar el modo offline completo.", "error");
  });
}

async function bootstrap() {
  // Referencias a elementos del DOM
  refs.summaryCards = $("summary-cards");
  refs.productsGrid = $("products-grid");
  refs.categoryFilters = $("category-filters");
  refs.cartItems = $("cart-items");
  refs.cartCount = $("cart-count");
  refs.cartTotal = $("cart-total");
  refs.recentSales = $("recent-sales");
  refs.activityList = $("activity-list");
  refs.lowStockList = $("low-stock-list");
  refs.trendChart = $("trend-chart");
  refs.shiftSummary = $("shift-summary");
  refs.inventoryBody = $("inventory-body");
  refs.toastRegion = $("toast-region");
  refs.shiftSelect = $("shift-select");
  refs.cashierInput = $("cashier-input");
  refs.searchInput = $("search-input");
  refs.openAdminButton = $("open-admin-button");
  refs.headerAdminButton = $("header-admin-button");
  refs.branchDisplay = $("branch-display");
  refs.cashierSessionLabel = $("cashier-session-label");
  refs.cashierSessionHelper = $("cashier-session-helper");
  refs.switchCashierButton = $("switch-cashier-button");
  refs.logoutCashierButton = $("logout-cashier-button");
  refs.openStartRegisterButton = $("open-start-register-button");
  refs.openQuickCutButton = $("open-quick-cut-button");
  refs.openFinalCutButton = $("open-final-cut-button");
  refs.registerSummaryPill = $("register-summary-pill");
  refs.openQuickImportButton = $("open-quick-import-button");
  refs.refreshCatalogButton = $("refresh-catalog-button");
  refs.exportWorkbookButton = $("export-workbook-button");
  refs.openPaymentButton = $("open-payment-button");
  refs.clearCartButton = $("clear-cart-button");
  refs.itemModal = $("item-modal");
  refs.itemModalName = $("item-modal-name");
  refs.itemModalMeta = $("item-modal-meta");
  refs.itemQuantity = $("item-quantity");
  refs.itemTotal = $("item-total");
  refs.paymentModal = $("payment-modal");
  refs.paymentTotal = $("payment-total");
  refs.paymentMethods = $("payment-methods");
  refs.moneyDisplay = $("money-display");
  refs.paymentReceived = $("payment-received");
  refs.paymentChange = $("payment-change");
  refs.confirmSaleButton = $("confirm-sale-button");
  refs.cashPaymentBlock = $("cash-payment-block");
  refs.quickImportModal = $("quick-import-modal");
  refs.quickImportModeBar = $("quick-import-mode-bar");
  refs.quickImportDescription = $("quick-import-description");
  refs.quickImportProgressText = $("quick-import-progress-text");
  refs.quickImportProgressFill = $("quick-import-progress-fill");
  refs.quickImportEmpty = $("quick-import-empty");
  refs.quickImportContent = $("quick-import-content");
  refs.quickImportProductName = $("quick-import-product-name");
  refs.quickImportProductMeta = $("quick-import-product-meta");
  refs.quickImportProductStatus = $("quick-import-product-status");
  refs.quickImportStockBefore = $("quick-import-stock-before");
  refs.quickImportSoldToday = $("quick-import-sold-today");
  refs.quickImportStockResult = $("quick-import-stock-result");
  refs.quickImportDirectionField = $("quick-import-direction-field");
  refs.quickImportDirection = $("quick-import-direction");
  refs.quickImportProviderField = $("quick-import-provider-field");
  refs.quickImportSupplier = $("quick-import-supplier");
  refs.quickImportValueLabel = $("quick-import-value-label");
  refs.quickImportValue = $("quick-import-value");
  refs.quickImportNote = $("quick-import-note");
  refs.quickImportHelper = $("quick-import-helper");
  refs.quickImportNextList = $("quick-import-next-list");
  refs.quickImportPrevButton = $("quick-import-prev-button");
  refs.quickImportSkipButton = $("quick-import-skip-button");
  refs.quickImportSaveButton = $("quick-import-save-button");
  refs.registerModal = $("register-modal");
  refs.registerModalEyebrow = $("register-modal-eyebrow");
  refs.registerModalTitle = $("register-modal-title");
  refs.registerModalDescription = $("register-modal-description");
  refs.registerOpeningAmount = $("register-opening-amount");
  refs.registerCashSales = $("register-cash-sales");
  refs.registerExpectedCash = $("register-expected-cash");
  refs.registerWithdrawalsAmount = $("register-withdrawals-amount");
  refs.registerTotalSales = $("register-total-sales");
  refs.registerAmountLabel = $("register-amount-label");
  refs.registerAmountInput = $("register-amount-input");
  refs.registerWithdrawInput = $("register-withdraw-input");
  refs.registerApplyWithdrawButton = $("register-apply-withdraw-button");
  refs.registerNoteInput = $("register-note-input");
  refs.registerHelperText = $("register-helper-text");
  refs.saveRegisterButton = $("save-register-button");
  refs.detailViewerModal = $("detail-viewer-modal");
  refs.detailViewerTitle = $("detail-viewer-title");
  refs.detailViewerMeta = $("detail-viewer-meta");
  refs.detailViewerBody = $("detail-viewer-body");
  refs.adminModal = $("admin-modal");
  refs.adminBranchSelect = $("admin-branch-select");
  refs.adminBranchTitle = $("admin-branch-title");
  refs.adminBranchDescription = $("admin-branch-description");
  refs.adminLogoutButton = $("admin-logout-button");
  refs.adminMetricsStatus = $("admin-metrics-status");
  refs.adminSummaryCards = $("admin-summary-cards");
  refs.adminShiftSummary = $("admin-shift-summary");
  refs.adminProcessCpu = $("admin-process-cpu");
  refs.adminProcessMemory = $("admin-process-memory");
  refs.adminProductsRender = $("admin-products-render");
  refs.adminSnapshotRender = $("admin-snapshot-render");
  refs.adminVisibleProducts = $("admin-visible-products");
  refs.adminDomNodes = $("admin-dom-nodes");
  refs.adminServerRuntime = $("admin-server-runtime");
  refs.adminServerMemory = $("admin-server-memory");
  refs.adminClientMemory = $("admin-client-memory");
  refs.adminClientHardware = $("admin-client-hardware");
  refs.adminClientNetwork = $("admin-client-network");
  refs.adminSalesList = $("admin-sales-list");
  refs.adminRegisterEventsList = $("admin-register-events-list");
  refs.adminInventoryMovementsList = $("admin-inventory-movements-list");
  refs.adminCashierName = $("admin-cashier-name");
  refs.adminCashierBranch = $("admin-cashier-branch");
  refs.adminCashierPassword = $("admin-cashier-password");
  refs.saveAdminCashierButton = $("save-admin-cashier-button");
  refs.adminCashiersList = $("admin-cashiers-list");
  refs.configAllowNegativeStock = $("config-allow-negative-stock");
  refs.saveAdminConfigButton = $("save-admin-config-button");
  refs.adminAuthModal = $("admin-auth-modal");
  refs.adminAuthTitle = $("admin-auth-title");
  refs.adminAuthDescription = $("admin-auth-description");
  refs.adminAuthPasswordLabel = $("admin-auth-password-label");
  refs.adminAuthPassword = $("admin-auth-password");
  refs.adminAuthConfirmField = $("admin-auth-confirm-field");
  refs.adminAuthConfirmPassword = $("admin-auth-confirm-password");
  refs.saveAdminAuthButton = $("save-admin-auth-button");
  refs.adminEditorModal = $("admin-editor-modal");
  refs.adminEditorTitle = $("admin-editor-title");
  refs.adminEditorDescription = $("admin-editor-description");
  refs.adminEditorBody = $("admin-editor-body");
  refs.saveAdminEditorButton = $("save-admin-editor-button");
  refs.liveDate = $("live-date");
  refs.liveTime = $("live-time");
  refs.socketStatus = $("socket-status");
  refs.networkStatus = $("network-status");
  refs.syncStatus = $("sync-status");
  refs.cashierAuthModal = $("cashier-auth-modal");
  refs.cashierAuthName = $("cashier-auth-name");
  refs.cashierAuthBranch = $("cashier-auth-branch");
  refs.cashierAuthPassword = $("cashier-auth-password");
  refs.loginCashierButton = $("login-cashier-button");
  refs.closeCashierAuthModal = $("close-cashier-auth-modal");

  // Restaurar estado persistido
  await restorePreferences();
  await restoreCart();
  await restoreQueue();
  await restoreRegisterEvents();
  await restoreCashierSession();
  state.admin.token = readStorageText(STORAGE_KEYS.adminToken, "");
  try {
    await loadAdminAuthStatus();
    if (!state.admin.authenticated) {
      state.admin.token = "";
      writeStorageText(STORAGE_KEYS.adminToken, "");
    }
  } catch (_error) {
    state.admin.configured = false;
    state.admin.authenticated = false;
  }

  // Renderizados iniciales
  renderCart();
  renderCashierSession();
  renderQuickImportModal();
  renderRegisterModal();
  renderRegisterSummaryPill();
  renderRecentActivity();
  renderDetailViewer();
  renderAdminModal();
  renderAdminRecordLists();
  renderAdminAuthModal();
  renderAdminEditorModal();
  renderCashierAuthModal();
  updateClock();
  renderSyncStatus();
  window.setInterval(updateClock, 1000);

  // === Registro de eventos ===

  // Buscador
  refs.searchInput.addEventListener("input", () => requestProductsRender(true));

  // Admin
  refs.openAdminButton.addEventListener("click", openAdminModal);
  if (refs.headerAdminButton) {
    refs.headerAdminButton.addEventListener("click", openAdminModal);
  }
  refs.adminBranchSelect.addEventListener("change", async () => {
    const branch = refs.adminBranchSelect.value;
    try {
      state.admin.branch = branch;
      await refreshAdminWorkspace();
      showToast(`Vista admin cambiada a ${getBranchLabel(branch)}`, "info");
    } catch (_error) {
      showToast("Error al cambiar sucursal", "error");
    }
  });
  refs.adminLogoutButton.addEventListener("click", logoutAdmin);

  // Turno
  refs.shiftSelect.addEventListener("change", () => {
    persistPreferences();
    void loadRegisterSummary({ silent: true });
  });

  // Cajero
  refs.switchCashierButton.addEventListener("click", openCashierAuthModal);
  refs.logoutCashierButton.addEventListener("click", logoutCashier);

  // Caja
  refs.openStartRegisterButton.addEventListener("click", () => openRegisterModal("start"));
  refs.openQuickCutButton.addEventListener("click", () => openRegisterModal("quick_cut"));
  refs.openFinalCutButton.addEventListener("click", () => openRegisterModal("final_cut"));

  // Quick Import
  refs.openQuickImportButton.addEventListener("click", openQuickImportModal);
  refs.refreshCatalogButton.addEventListener("click", reimportCatalog);
  refs.exportWorkbookButton.addEventListener("click", exportWorkbook);

  // Carrito y venta
  refs.openPaymentButton.addEventListener("click", openPaymentModal);
  refs.clearCartButton.addEventListener("click", clearCart);

  // Modal Admin
  $("close-admin-modal").addEventListener("click", closeAdminModal);

  // Modal Auth Admin
  $("close-admin-auth-modal").addEventListener("click", closeAdminAuthModal);
  $("cancel-admin-auth-button").addEventListener("click", closeAdminAuthModal);
  refs.saveAdminAuthButton.addEventListener("click", submitAdminAuth);
  refs.adminAuthPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdminAuth();
    }
  });
  refs.adminAuthConfirmPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdminAuth();
    }
  });

  // Modal Editor Admin
  $("close-admin-editor-modal").addEventListener("click", closeAdminEditor);
  $("cancel-admin-editor-button").addEventListener("click", closeAdminEditor);
  refs.saveAdminEditorButton.addEventListener("click", saveAdminEditor);

  // Modal Item
  $("close-item-modal").addEventListener("click", closeItemModal);
  $("cancel-item-button").addEventListener("click", closeItemModal);
  $("add-item-button").addEventListener("click", addCurrentProductToCart);
  refs.itemQuantity.addEventListener("input", syncItemTotalFromQuantity);
  refs.itemTotal.addEventListener("input", syncItemQuantityFromTotal);
  refs.itemTotal.addEventListener("blur", finalizeItemTotalInput);
  refs.itemTotal.addEventListener("focus", () => refs.itemTotal.select());

  // Modal Payment
  $("close-payment-modal").addEventListener("click", closePaymentModal);
  $("cancel-payment-button").addEventListener("click", closePaymentModal);
  refs.confirmSaleButton.addEventListener("click", submitSale);

  // Modal Quick Import
  $("close-quick-import-modal").addEventListener("click", closeQuickImportModal);
  refs.quickImportPrevButton.addEventListener("click", goToPreviousQuickImportItem);
  refs.quickImportSkipButton.addEventListener("click", skipQuickImportItem);
  refs.quickImportSaveButton.addEventListener("click", saveQuickImportEntry);
  refs.quickImportDirection.addEventListener("change", () => {
    state.quickImport.direction = refs.quickImportDirection.value;
    updateQuickImportResult();
    renderQuickImportModal();
  });
  refs.quickImportModeBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }
    setQuickImportMode(button.dataset.mode);
  });
  refs.quickImportNextList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (!button) {
      return;
    }
    setQuickImportIndex(Number(button.dataset.index));
  });
  refs.quickImportSupplier.addEventListener("input", () => {
    state.quickImport.supplierName = refs.quickImportSupplier.value;
  });
  refs.quickImportValue.addEventListener("input", () => {
    state.quickImport.currentValue = refs.quickImportValue.value;
    updateQuickImportResult();
  });
  refs.quickImportNote.addEventListener("input", () => {
    state.quickImport.note = refs.quickImportNote.value;
  });
  refs.quickImportSupplier.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      focusQuickImportValue();
    }
  });
  refs.quickImportValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveQuickImportEntry();
    }
  });
  refs.quickImportNote.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveQuickImportEntry();
    }
  });

  // Modal Register
  $("close-register-modal").addEventListener("click", closeRegisterModal);
  $("cancel-register-button").addEventListener("click", closeRegisterModal);
  refs.saveRegisterButton.addEventListener("click", saveRegisterAction);
  refs.registerAmountInput.addEventListener("input", () => {
    state.register.amountInput = refs.registerAmountInput.value;
  });
  refs.registerWithdrawInput.addEventListener("input", () => {
    state.register.withdrawInput = refs.registerWithdrawInput.value;
  });
  refs.registerApplyWithdrawButton.addEventListener("click", applyRegisterWithdraw);
  refs.registerNoteInput.addEventListener("input", () => {
    state.register.note = refs.registerNoteInput.value;
  });
  refs.registerAmountInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRegisterAction();
    }
  });
  refs.registerNoteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRegisterAction();
    }
  });
  refs.registerWithdrawInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRegisterAction();
    }
  });

  // Filtros de categoría
  refs.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) {
      return;
    }
    state.selectedCategory = button.dataset.category;
    renderCategoryFilters();
    requestProductsRender(true);
  });

  // Grid de productos
  refs.productsGrid.addEventListener("click", (event) => {
    const loadMoreButton = event.target.closest('[data-action="load-more-products"]');
    if (loadMoreButton) {
      loadMoreProducts();
      return;
    }

    const button = event.target.closest('[data-action="open-product"]');
    if (!button) {
      return;
    }

    const product = state.products.find(
      (item) => item.id === Number(button.dataset.productId),
    );

    if (product) {
      openItemModal(product);
    }
  });

  refs.productsGrid.addEventListener("scroll", () => {
    if (
      refs.productsGrid.scrollTop + refs.productsGrid.clientHeight >=
      refs.productsGrid.scrollHeight - 240
    ) {
      loadMoreProducts();
    }
  });

  // Carrito
  refs.cartItems.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-cart-item"]');
    if (!button) {
      return;
    }
    removeCartItem(Number(button.dataset.index));
  });

  // Modales - click fuera para cerrar
  refs.itemModal.addEventListener("click", (event) => {
    if (event.target === refs.itemModal) {
      closeItemModal();
    }
  });

  refs.paymentModal.addEventListener("click", (event) => {
    if (event.target === refs.paymentModal) {
      closePaymentModal();
    }
  });

  refs.quickImportModal.addEventListener("click", (event) => {
    if (event.target === refs.quickImportModal) {
      closeQuickImportModal();
    }
  });

  refs.registerModal.addEventListener("click", (event) => {
    if (event.target === refs.registerModal) {
      closeRegisterModal();
    }
  });

  refs.detailViewerModal.addEventListener("click", (event) => {
    if (event.target === refs.detailViewerModal) {
      closeDetailViewer();
    }
  });

  refs.adminModal.addEventListener("click", (event) => {
    if (event.target === refs.adminModal) {
      closeAdminModal();
    }
  });

  refs.adminAuthModal.addEventListener("click", (event) => {
    if (event.target === refs.adminAuthModal) {
      closeAdminAuthModal();
    }
  });

  refs.adminEditorModal.addEventListener("click", (event) => {
    if (event.target === refs.adminEditorModal) {
      closeAdminEditor();
    }
  });

  refs.cashierAuthModal.addEventListener("click", (event) => {
    if (event.target === refs.cashierAuthModal) {
      closeCashierAuthModal();
    }
  });

  // Detalle de actividad
  refs.recentSales.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-activity-detail"]');
    if (!button) {
      return;
    }
    void openActivityDetail(button.dataset.kind, button.dataset.id);
  });

  refs.activityList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-activity-detail"]');
    if (!button) {
      return;
    }
    void openActivityDetail(button.dataset.kind, button.dataset.id);
  });

  // Admin - listas de registros
  refs.adminSalesList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }
    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminRegisterEventsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }
    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminInventoryMovementsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="edit-admin-record"]');
    if (!button) {
      return;
    }
    void openAdminEditor(button.dataset.kind, button.dataset.id);
  });

  refs.adminCashiersList.addEventListener("click", (event) => {
    const editButton = event.target.closest('[data-action="edit-cashier"]');
    if (editButton) {
      void openAdminEditor("cashier", editButton.dataset.id);
      return;
    }

    const toggleButton = event.target.closest('[data-action="toggle-cashier"]');
    if (toggleButton) {
      void toggleAdminCashier(
        Number(toggleButton.dataset.id),
        toggleButton.dataset.active === "1",
      );
      return;
    }

    const deleteButton = event.target.closest('[data-action="delete-cashier"]');
    if (deleteButton) {
      void deleteAdminCashier(Number(deleteButton.dataset.id));
    }
  });

  // Cerrar modales con botones
  $("close-detail-viewer-modal").addEventListener("click", closeDetailViewer);
  refs.closeCashierAuthModal.addEventListener("click", closeCashierAuthModal);
  refs.loginCashierButton.addEventListener("click", loginCashier);
  refs.saveAdminCashierButton.addEventListener("click", submitAdminCashier);
  refs.saveAdminConfigButton.addEventListener("click", submitAdminConfig);

  // Teclado en auth cajero
  refs.cashierAuthName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginCashier();
    }
  });
  refs.cashierAuthPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loginCashier();
    }
  });

  // Botones de cantidad en item modal
  refs.itemModal.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustItemQuantity(Number(button.dataset.step));
    });
  });

  // Métodos de pago
  refs.paymentMethods.addEventListener("click", (event) => {
    const button = event.target.closest("[data-method]");
    if (!button) {
      return;
    }

    state.paymentMethod = button.dataset.method;
    if (state.paymentMethod !== "Efectivo") {
      state.moneyInput = String(getCartTotal());
    }
    updatePaymentView();
  });

  // Keypad de pago
  $("payment-keypad").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    if (button.dataset.action === "clear-money") {
      clearMoneyInput();
      return;
    }

    if (button.dataset.action === "backspace") {
      backspaceMoneyInput();
      return;
    }

    if (button.dataset.digit) {
      appendMoneyInput(button.dataset.digit);
    }
  });

  // Inventario
  refs.inventoryBody.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="save-product"]');
    if (!button) {
      return;
    }
    saveInventoryRow(button.closest("tr"));
  });

  // Keyboard shortcuts globales
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== refs.searchInput) {
      event.preventDefault();
      refs.searchInput.focus();
    }

    if (event.key === "Escape") {
      closeItemModal();
      closePaymentModal();
      closeQuickImportModal();
      closeRegisterModal();
      closeDetailViewer();
      closeAdminModal();
      closeAdminAuthModal();
      closeAdminEditor();
    }
  });

  // Conexión y eventos
  registerConnectionEvents();
  registerServiceWorker();

  // Cargar snapshot inicial
  const cachedSnapshot = await restoreSnapshot();
  if (cachedSnapshot) {
    applySnapshot(cachedSnapshot, { skipPersist: true });
    if (!state.online) {
      refs.socketStatus.textContent = "Sin conexion";
      showToast("Cargando ultimo estado guardado en modo offline.", "info");
    }
  }

  try {
    const snapshot = await performJsonRequest(
      `/api/bootstrap?branch=${encodeURIComponent(getActiveCashierBranch())}`,
    );
    applySnapshot(snapshot);
  } catch (_error) {
    if (cachedSnapshot) {
      refs.socketStatus.textContent = "Sin conexion";
      showToast("Trabajando con el ultimo estado guardado localmente.", "info");
    } else {
      throw _error;
    }
  }

  // Inicializar socket y sincronización
  connectSocket();
  updatePaymentView();
  await loadRegisterSummary({ silent: true });
  syncPendingQueue();
  if (refs.openAdminButton) {
    refs.openAdminButton.disabled = false;
    refs.openAdminButton.style.opacity = "1";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((error) => {
    console.error(error);
    showToast("No fue posible cargar el panel inicial.", "error");
  });
});