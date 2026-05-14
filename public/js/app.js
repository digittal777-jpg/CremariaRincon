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
  refs.openMerchandiseRequestButton = $("open-merchandise-request-button");
  refs.refreshCatalogButton = $("refresh-catalog-button");
  refs.exportDateInput = $("export-date-input");
  refs.exportWorkbookButton = $("export-workbook-button");
  refs.downloadDbButton = $("download-db-button");
  refs.installDbButton = $("install-db-button");
  refs.installDbInput = $("install-db-input");
  refs.installWorkbookButton = $("install-workbook-button");
  refs.installWorkbookInput = $("install-workbook-input");
  refs.openPaymentButton = $("open-payment-button");
  refs.clearCartButton = $("clear-cart-button");
  refs.itemModal = $("item-modal");
  refs.itemModalName = $("item-modal-name");
  refs.itemModalMeta = $("item-modal-meta");
  refs.itemQuantity = $("item-quantity");
  refs.itemTotal = $("item-total");
  refs.itemUnitPrice = $("item-unit-price");
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
  refs.myMerchandiseRequestsList = $("my-merchandise-requests-list");
  refs.merchandiseRequestModal = $("merchandise-request-modal");
  refs.merchandiseRequestSearch = $("merchandise-request-search");
  refs.merchandiseRequestProducts = $("merchandise-request-products");
  refs.merchandiseRequestItems = $("merchandise-request-items");
  refs.merchandiseRequestSupplier = $("merchandise-request-supplier");
  refs.merchandiseRequestNote = $("merchandise-request-note");
  refs.merchandiseRequestTotalLabel = $("merchandise-request-total-label");
  refs.merchandiseRequestTotal = $("merchandise-request-total");
  refs.merchandiseRequestSaveButton = $("save-merchandise-request-button");
  refs.merchandiseRequestItemModal = $("merchandise-request-item-modal");
  refs.merchandiseRequestItemModeBar = $("merchandise-request-item-mode-bar");
  refs.merchandiseRequestItemName = $("merchandise-request-item-name");
  refs.merchandiseRequestItemMeta = $("merchandise-request-item-meta");
  refs.merchandiseRequestItemQuantity = $("merchandise-request-item-quantity");
  refs.merchandiseRequestItemUnitPrice = $("merchandise-request-item-unit-price");
  refs.merchandiseRequestItemTotal = $("merchandise-request-item-total");
  refs.merchandiseRequestItemAddButton = $("add-merchandise-request-item-button");
  refs.merchandiseRequestDetailModal = $("merchandise-request-detail-modal");
  refs.merchandiseRequestDetailTitle = $("merchandise-request-detail-title");
  refs.merchandiseRequestDetailMeta = $("merchandise-request-detail-meta");
  refs.merchandiseRequestDetailBody = $("merchandise-request-detail-body");
  refs.merchandiseRequestDetailCloseButton = $("close-merchandise-request-detail-button");
  refs.merchandiseRequestDetailApproveButton = $("approve-merchandise-request-button");
  refs.merchandiseRequestDetailRejectButton = $("reject-merchandise-request-button");
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
  refs.adminAuditLogList = $("admin-audit-log-list");
  refs.adminDevSummary = $("admin-dev-summary");
  refs.devRefreshAdminButton = $("dev-refresh-admin-button");
  refs.devSyncOfflineButton = $("dev-sync-offline-button");
  refs.devDownloadStateButton = $("dev-download-state-button");
  refs.adminInventoryWrap = $("admin-inventory-wrap");
  refs.inventoryBodyWrapper = $("admin-inventory-wrap");
  refs.adminInventoryStatus = $("admin-inventory-status");
  refs.toggleAdminInventoryButton = $("toggle-admin-inventory-button");
  refs.adminNewProductName = $("admin-new-product-name");
  refs.adminNewProductCategory = $("admin-new-product-category");
  refs.adminNewProductUnit = $("admin-new-product-unit");
  refs.adminNewProductPrice = $("admin-new-product-price");
  refs.adminNewProductStock = $("admin-new-product-stock");
  refs.adminNewProductMinStock = $("admin-new-product-min-stock");
  refs.saveAdminProductButton = $("save-admin-product-button");
  refs.adminCashierName = $("admin-cashier-name");
  refs.adminCashierBranch = $("admin-cashier-branch");
  refs.adminCashierPassword = $("admin-cashier-password");
  refs.saveAdminCashierButton = $("save-admin-cashier-button");
  refs.adminCashiersList = $("admin-cashiers-list");
  refs.adminMerchandiseRequestsList = $("admin-merchandise-requests-list");
  refs.adminMerchandiseRequestsStatus = $("admin-merchandise-requests-status");
  refs.adminWeightedAuditDate = $("admin-weighted-audit-date");
  refs.adminWeightedAuditShift = $("admin-weighted-audit-shift");
  refs.adminWeightedAuditStatus = $("admin-weighted-audit-status");
  refs.adminWeightedAuditSessions = $("admin-weighted-audit-sessions");
  refs.adminWeightedAuditItems = $("admin-weighted-audit-items");
  refs.loadWeightedAuditButton = $("load-weighted-audit-button");
  refs.createWeightedAuditButton = $("create-weighted-audit-button");
  refs.saveWeightedAuditItemsButton = $("save-weighted-audit-items-button");
  refs.completeWeightedAuditButton = $("complete-weighted-audit-button");
  refs.configAllowNegativeStock = $("config-allow-negative-stock");
  refs.saveAdminConfigButton = $("save-admin-config-button");
  refs.adminAuthModal = $("admin-auth-modal");
  refs.adminAuthTitle = $("admin-auth-title");
  refs.adminAuthDescription = $("admin-auth-description");
  refs.adminAuthUsername = $("admin-auth-username");
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

  if (refs.exportDateInput) {
    const todayValue = toDateInputValue();
    refs.exportDateInput.max = todayValue;
    refs.exportDateInput.min = shiftDateInputValue(todayValue, -14);
    refs.exportDateInput.value = todayValue;
  }
  if (refs.adminWeightedAuditDate) {
    refs.adminWeightedAuditDate.value = toDateInputValue();
  }
  state.admin.weightedAudit.dateKey = refs.adminWeightedAuditDate?.value || toDateInputValue();
  state.admin.weightedAudit.shift =
    refs.adminWeightedAuditShift?.value || refs.shiftSelect?.value || "Tarde";

  // Restaurar estado persistido
  await restorePreferences();
  await restoreCart();
  await restoreQueue();
  await restoreRegisterEvents();
  await restoreCashierSession();
  try {
    if (state.cashier.token) {
      await loadCashierAuthStatus();
    }
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      clearCashierSessionState();
    }
  }
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
  renderMyMerchandiseRequests();
  renderMerchandiseRequestModal();
  renderMerchandiseRequestItemModal();
  renderMerchandiseRequestDetailModal();
  renderRegisterModal();
  renderRegisterSummaryPill();
  renderRecentActivity();
  renderDetailViewer();
  renderAdminModal();
  renderAdminRecordLists();
  renderAdminMerchandiseRequests();
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
      await refreshAdminWorkspace(getAdminWorkspaceFullOptions(branch, true));
      showToast(`Vista admin cambiada a ${getBranchLabel(branch)}`, "info");
    } catch (_error) {
      showToast("Error al cambiar sucursal", "error");
    }
  });
  refs.adminLogoutButton.addEventListener("click", logoutAdmin);
  refs.loadWeightedAuditButton?.addEventListener("click", () => {
    void loadAdminWeightedAuditSessions();
  });
  refs.createWeightedAuditButton?.addEventListener("click", () => {
    void createAdminWeightedAuditSession();
  });
  refs.saveWeightedAuditItemsButton?.addEventListener("click", () => {
    void saveAdminWeightedAuditItems();
  });
  refs.completeWeightedAuditButton?.addEventListener("click", () => {
    void closeAdminWeightedAuditSession();
  });
  refs.adminWeightedAuditShift?.addEventListener("change", () => {
    state.admin.weightedAudit.shift = refs.adminWeightedAuditShift.value;
  });
  refs.adminWeightedAuditDate?.addEventListener("change", () => {
    state.admin.weightedAudit.dateKey = refs.adminWeightedAuditDate.value;
  });

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
  refs.openMerchandiseRequestButton.addEventListener("click", openMerchandiseRequestModal);
  refs.refreshCatalogButton.addEventListener("click", reimportCatalog);
  refs.exportWorkbookButton.addEventListener("click", exportWorkbook);
  refs.downloadDbButton.addEventListener("click", downloadDatabase);
  refs.installDbButton.addEventListener("click", () => refs.installDbInput.click());
  refs.installDbInput.addEventListener("change", installDatabaseFromPc);
  refs.installWorkbookButton.addEventListener("click", () => refs.installWorkbookInput.click());
  refs.installWorkbookInput.addEventListener("change", installExportWorkbookFromPc);
  refs.toggleAdminInventoryButton.addEventListener("click", toggleAdminInventoryPanel);
  refs.saveAdminProductButton.addEventListener("click", createAdminProduct);

  // Carrito y venta
  refs.openPaymentButton.addEventListener("click", openPaymentModal);
  refs.clearCartButton.addEventListener("click", clearCart);

  // Modal Admin
  $("close-admin-modal").addEventListener("click", closeAdminModal);

  // Modal Auth Admin
  $("close-admin-auth-modal").addEventListener("click", closeAdminAuthModal);
  $("cancel-admin-auth-button").addEventListener("click", closeAdminAuthModal);
  refs.saveAdminAuthButton.addEventListener("click", submitAdminAuth);
  refs.adminAuthUsername.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitAdminAuth();
    }
  });
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
  refs.itemUnitPrice.addEventListener("input", syncItemTotalFromQuantity);
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

  // Modal Solicitud de mercaderia
  $("close-merchandise-request-modal").addEventListener("click", closeMerchandiseRequestModal);
  $("cancel-merchandise-request-button").addEventListener("click", closeMerchandiseRequestModal);
  refs.merchandiseRequestSaveButton.addEventListener("click", submitMerchandiseRequest);
  refs.merchandiseRequestSearch.addEventListener("input", () => {
    state.merchandise.search = refs.merchandiseRequestSearch.value;
    renderMerchandiseRequestModal();
  });
  refs.merchandiseRequestSupplier.addEventListener("input", () => {
    state.merchandise.supplierName = refs.merchandiseRequestSupplier.value;
  });
  refs.merchandiseRequestNote.addEventListener("input", () => {
    state.merchandise.notes = refs.merchandiseRequestNote.value;
  });
  refs.merchandiseRequestProducts.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-merchandise-product"]');
    if (!button) {
      return;
    }
    openMerchandiseRequestItemModal(button.dataset.productId);
  });
  refs.merchandiseRequestItems.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-merchandise-item"]');
    if (!button) {
      return;
    }
    removeMerchandiseRequestItem(Number(button.dataset.index));
  });

  // Modal Item Solicitud
  $("close-merchandise-request-item-modal").addEventListener("click", closeMerchandiseRequestItemModal);
  $("cancel-merchandise-request-item-button").addEventListener("click", closeMerchandiseRequestItemModal);
  refs.merchandiseRequestItemAddButton.addEventListener("click", addMerchandiseRequestItem);
  refs.merchandiseRequestItemQuantity.addEventListener("input", () => {
    state.merchandise.currentQuantity = refs.merchandiseRequestItemQuantity.value;
    syncMerchandiseRequestItemTotal();
  });
  refs.merchandiseRequestItemTotal.addEventListener("input", syncMerchandiseRequestQuantityFromTotal);
  refs.merchandiseRequestItemTotal.addEventListener("blur", finalizeMerchandiseRequestItemTotalInput);
  refs.merchandiseRequestItemTotal.addEventListener("focus", () => refs.merchandiseRequestItemTotal.select());
  refs.merchandiseRequestItemModeBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }
    setMerchandiseRequestItemMode(button.dataset.mode);
  });
  refs.merchandiseRequestItemQuantity.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addMerchandiseRequestItem();
    }
  });
  refs.merchandiseRequestItemTotal.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addMerchandiseRequestItem();
    }
  });
  refs.merchandiseRequestItemModal.querySelectorAll("[data-merchandise-step]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustMerchandiseRequestItemQuantity(Number(button.dataset.merchandiseStep));
    });
  });

  // Modal detalle de solicitud
  refs.merchandiseRequestDetailCloseButton.addEventListener("click", closeMerchandiseRequestDetailModal);
  refs.merchandiseRequestDetailApproveButton.addEventListener("click", approveCurrentMerchandiseRequest);
  refs.merchandiseRequestDetailRejectButton.addEventListener("click", rejectCurrentMerchandiseRequest);

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

  refs.merchandiseRequestModal.addEventListener("click", (event) => {
    if (event.target === refs.merchandiseRequestModal) {
      closeMerchandiseRequestModal();
    }
  });

  refs.merchandiseRequestItemModal.addEventListener("click", (event) => {
    if (event.target === refs.merchandiseRequestItemModal) {
      closeMerchandiseRequestItemModal();
    }
  });

  refs.merchandiseRequestDetailModal.addEventListener("click", (event) => {
    if (event.target === refs.merchandiseRequestDetailModal) {
      closeMerchandiseRequestDetailModal();
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

  refs.myMerchandiseRequestsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-my-merchandise-request"]');
    if (!button) {
      return;
    }
    openMyMerchandiseRequestDetail(button.dataset.requestId);
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

  refs.adminMerchandiseRequestsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-admin-merchandise-request"]');
    if (!button) {
      return;
    }
    void openAdminMerchandiseRequestDetail(button.dataset.requestId);
  });

  refs.adminWeightedAuditSessions?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-weighted-audit-session"]');
    if (!button) {
      return;
    }
    void openAdminWeightedAuditSession(button.dataset.id);
  });

  refs.adminAuditLogList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-audit-log"]');
    if (!button) {
      return;
    }
    void openAdminAuditLogDetail(button.dataset.id);
  });

  // Cerrar modales con botones
  $("close-detail-viewer-modal").addEventListener("click", closeDetailViewer);
  refs.closeCashierAuthModal.addEventListener("click", closeCashierAuthModal);
  refs.loginCashierButton.addEventListener("click", loginCashier);
  refs.saveAdminCashierButton.addEventListener("click", submitAdminCashier);
  refs.saveAdminConfigButton.addEventListener("click", submitAdminConfig);
  refs.devRefreshAdminButton?.addEventListener("click", refreshAdminDevPanelData);
  refs.devSyncOfflineButton?.addEventListener("click", retryOfflineSyncFromDev);
  refs.devDownloadStateButton?.addEventListener("click", downloadDebugStateFromDev);

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

  // Inventario (modo simple y comparación) - Delegado en contenedor padre
  if (refs.inventoryBodyWrapper) {
    refs.inventoryBodyWrapper.addEventListener("click", (event) => {
      const saveButton = event.target.closest('[data-action="save-product"]');
      if (saveButton) {
        const row = saveButton.closest("tr");
        if (row) {
          // Detectar si es modo comparación (tiene data-branch)
          const branch = row.dataset.branch;
          saveInventoryRow(row, branch);
        }
        return;
      }
      const removeButton = event.target.closest('[data-action="remove-product"]');
      if (removeButton) {
        removeAdminProduct(removeButton.closest("tr"));
      }
    });
  }

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
      closeMerchandiseRequestModal();
      closeMerchandiseRequestItemModal();
      closeMerchandiseRequestDetailModal();
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

  // Cargar snapshot inicial con mejor manejo offline
  const cachedSnapshot = await restoreSnapshot();
  if (cachedSnapshot) {
    applySnapshot(cachedSnapshot, { skipPersist: true });
    if (!state.online) {
      refs.socketStatus.textContent = "Sin conexion";
      showToast("Cargando ultimo estado guardado en modo offline.", "info");
    }
  }

  // Intentar cargar desde servidor con reintentos
  let bootstrapLoaded = false;
  let bootstrapRetries = 0;
  const maxBootstrapRetries = 3;

  while (!bootstrapLoaded && bootstrapRetries < maxBootstrapRetries) {
    try {
      const snapshot = await performJsonRequest(
        `/api/bootstrap?branch=${encodeURIComponent(getActiveCashierBranch())}`,
        {
          timeout: 15000,
          retries: 2,
        }
      );
      applySnapshot(snapshot);
      bootstrapLoaded = true;
      
      if (refs.socketStatus.textContent === "Sin conexion") {
        refs.socketStatus.textContent = "Conectado";
      }
    } catch (error) {
      bootstrapRetries++;
      
      if (bootstrapRetries < maxBootstrapRetries) {
        // Esperar antes de reintentar
        await new Promise(resolve => setTimeout(resolve, 1000 * bootstrapRetries));
        continue;
      }

      // Si no hay snapshot cacheado, mostrar error
      if (!cachedSnapshot) {
        throw error;
      } else {
        // Con snapshot cacheado, apenas mostrar aviso
        refs.socketStatus.textContent = "Sin conexion";
        showToast("Trabajando con el ultimo estado guardado localmente.", "info");
      }
    }
  }

  // Inicializar socket y sincronización
  connectSocket();
  updatePaymentView();
  if (state.cashier.authenticated) {
    await loadRegisterSummary({ silent: true });
    await loadMyMerchandiseRequests({ silent: true });
  } else {
    state.register.summary = getEmptyRegisterSummary();
    renderRegisterSummaryPill();
    renderCashierSession();
  }
  
  // Iniciar sincronización si hay pendientes de ventas o caja
  if (state.pendingQueue.length > 0 || state.register.events.length > 0) {
    syncAllOfflineData().catch(() => {});
  }
  
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
