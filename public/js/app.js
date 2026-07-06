const TOUCH_DOUBLE_TAP_WINDOW_MS = 320;
const ROUTE_SWIPE_TRIGGER_PX = 84;
const ROUTE_SWIPE_LOCK_PX = 18;
const ROUTE_PAYMENT_SWIPE_TRIGGER_PX = 56;
const ROUTE_PAYMENT_SWIPE_LOCK_PX = 14;
const ADMINISTRATION_PATH = "/administracion";
const TOUCH_DOUBLE_TAP_SELECTOR = [
  "button",
  ".product-card",
  ".category-chip",
  ".payment-method",
  ".quick-import-next-item",
  ".stepper-button",
  ".sale-card-button",
  ".activity-item",
  ".feed-item",
  ".admin-record-item",
  ".shift-chip",
  '[data-touch-guard="true"]',
].join(", ");

function isAdministrationRoute() {
  const normalizedPath = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  return normalizedPath === ADMINISTRATION_PATH;
}

function getApplicationMode() {
  return isAdministrationRoute() ? "admin" : "cashier";
}

function shouldBootstrapCashierRuntime() {
  return getApplicationMode() !== "admin";
}

function openAdministrationRoute() {
  if (isAdministrationRoute()) {
    void openAdminModal();
    return;
  }

  const opened = window.open(ADMINISTRATION_PATH, "_blank");
  if (opened) {
    try {
      opened.opener = null;
      opened.focus?.();
    } catch (_error) {
      // Algunos navegadores no permiten tocar la ventana nueva; la apertura ya ocurrio.
    }
    return;
  }

  showToast("El navegador bloqueo la pestaña nueva. Abriendo administracion aqui.", "info");
  window.location.href = ADMINISTRATION_PATH;
}

function applyAdministrationRouteShell() {
  if (!isAdministrationRoute()) {
    return;
  }

  document.body.classList.add("administration-page");
  document.title = `${getStoreName()} | Administracion`;
}

function returnFromAdministrationRoute() {
  if (!isAdministrationRoute()) {
    return false;
  }

  try {
    window.close();
  } catch (_error) {
    // Si la pestaña no fue abierta por script, el navegador puede impedir cerrarla.
  }

  window.setTimeout(() => {
    if (!window.closed) {
      window.location.href = "/";
    }
  }, 120);
  return true;
}

function shouldUseTouchOptimizations() {
  return Boolean(
    window.matchMedia?.("(pointer: coarse)")?.matches
      || navigator.maxTouchPoints > 0,
  );
}

function installTouchOptimizations() {
  if (typeof document === "undefined" || !shouldUseTouchOptimizations()) {
    return;
  }

  let lastTouchEndedAt = 0;

  document.addEventListener(
    "touchend",
    (event) => {
      const target = event.target instanceof Element
        ? event.target.closest(TOUCH_DOUBLE_TAP_SELECTOR)
        : null;
      if (!target) {
        return;
      }

      const now = Date.now();
      const elapsed = now - lastTouchEndedAt;
      lastTouchEndedAt = now;
      if (elapsed <= 0 || elapsed > TOUCH_DOUBLE_TAP_WINDOW_MS) {
        return;
      }

      event.preventDefault();
      if (target instanceof HTMLInputElement) {
        target.focus({ preventScroll: true });
        target.select?.();
        return;
      }

      if ("disabled" in target && target.disabled) {
        return;
      }

      target.click();
    },
    { passive: false },
  );
}

function updateClock() {
  const now = new Date();
  refs.liveDate.textContent = dateFormatter.format(now);
  refs.liveTime.textContent = timeFormatter.format(now);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const serviceWorkerUrl = "/sw.js?v=15";
  let controllerRefreshScheduled = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controllerRefreshScheduled) {
      return;
    }
    controllerRefreshScheduled = true;
    window.location.reload();
  });

  navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: "none" }).then((registration) => {
    void registration.update();
  }).catch(() => {
    showToast("No fue posible activar el modo offline completo.", "error");
  });
}

function setRouteMode(enabled) {
  state.ui.routeMode = Boolean(enabled);
  if (state.ui.routeMode) {
    state.ui.routeRegisterCollapsed = true;
  }
  persistPreferences();
  renderRouteMode();
  pulseElement(refs.toggleRouteModeButton);
  pulseElement(refs.routeModePill);
  pulseElement(refs.productsGrid, "is-settling", { durationMs: 760 });
  pulseElement(refs.cartPanel, "is-settling", { durationMs: 620 });
  if (state.ui.routeMode) {
    focusRouteSearchInput();
  }
}

function toggleRouteMode() {
  const nextValue = !isRouteModeEnabled();
  setRouteMode(nextValue);
  showToast(
    nextValue
      ? "Modo ruta activado. La vista ahora prioriza vender mas rapido."
      : "Modo ruta desactivado. Regresaste a la vista completa.",
    "info",
  );
}

function setRouteRegisterCollapsed(collapsed) {
  state.ui.routeRegisterCollapsed = Boolean(collapsed);
  persistPreferences();
  renderRouteMode();
  pulseElement(refs.toggleRegisterToolbarButton);
  pulseElement(refs.cartPanel, "is-settling", { durationMs: 540 });
}

function toggleRouteRegisterCollapsed() {
  setRouteRegisterCollapsed(!state.ui.routeRegisterCollapsed);
}

function scrollToRouteCart() {
  refs.cartPanel?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function openCatalogProductById(productId) {
  const product = state.products.find((item) => item.id === Number(productId));
  if (!product) {
    return;
  }

  handleCatalogProductSelection(product);
}

let lastProductSearchSubmitAt = 0;

function pickDirectProductSearchMatch(rawSearch, products = []) {
  const normalizedSearch = normalizeSearchText(rawSearch);
  if (!normalizedSearch || !Array.isArray(products) || products.length === 0) {
    return null;
  }

  if (products.length === 1) {
    return products[0];
  }

  return products.find((product) => {
    const exactCandidates = [
      product.sku,
      product.barcode,
      product.name,
    ]
      .map((value) => normalizeSearchText(value))
      .filter(Boolean);
    return exactCandidates.includes(normalizedSearch);
  }) || null;
}

function submitProductSearchFromKeyboard() {
  if (!refs.searchInput) {
    return;
  }

  const search = refs.searchInput.value.trim();
  if (!search) {
    return;
  }

  const now = Date.now();
  if (now - lastProductSearchSubmitAt < 250) {
    return;
  }
  lastProductSearchSubmitAt = now;

  const filteredProducts = getFilteredProducts();
  const directMatch = pickDirectProductSearchMatch(search, filteredProducts);
  if (directMatch) {
    openCatalogProductById(directMatch.id);
    return;
  }

  requestProductsRender(true);
  refs.searchInput.blur();

  const revealResults = () => {
    const target = refs.searchQuickResults && !refs.searchQuickResults.hidden
      ? refs.searchQuickResults
      : refs.productsGrid;
    if (!target || !refs.productsGrid) {
      return;
    }

    refs.productsGrid.scrollTop = 0;
    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  window.requestAnimationFrame(revealResults);

  if (shouldUseTouchOptimizations()) {
    window.setTimeout(revealResults, 180);
  }
}

function updateRouteSwipeVisualState(bar, surface, deltaX = 0, lockPx = ROUTE_SWIPE_LOCK_PX) {
  if (!bar) {
    if (surface) {
      surface.classList.remove("is-swiping-left", "is-swiping-right");
    }
    return;
  }

  bar.classList.toggle("is-swiping-left", deltaX <= -lockPx);
  bar.classList.toggle("is-swiping-right", deltaX >= lockPx);
  if (surface) {
    surface.classList.toggle("is-swiping-left", deltaX <= -lockPx);
    surface.classList.toggle("is-swiping-right", deltaX >= lockPx);
  }
}

function installRouteSwipeDecisionSurface(surface, options = {}) {
  if (!surface) {
    return;
  }

  const bar = options.bar || null;
  const triggerPx = Number(options.triggerPx || ROUTE_SWIPE_TRIGGER_PX);
  const lockPx = Number(options.lockPx || ROUTE_SWIPE_LOCK_PX);
  let gesture = null;

  const resetGesture = () => {
    gesture = null;
    updateRouteSwipeVisualState(bar, surface, 0, lockPx);
  };

  const shouldHandleSwipe = () =>
    shouldUseRouteMobileUi()
    && surface.closest(".modal-shell")?.classList.contains("open");

  const onTouchStart = (event) => {
    if (!shouldHandleSwipe()) {
      resetGesture();
      return;
    }

    const touch = event.touches?.[0];
    if (!touch) {
      return;
    }

    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
    };
  };

  const onTouchMove = (event) => {
    if (!gesture || !shouldHandleSwipe()) {
      return;
    }

    const touch = event.touches?.[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    if (Math.abs(deltaX) < lockPx || Math.abs(deltaX) <= Math.abs(deltaY)) {
      updateRouteSwipeVisualState(bar, surface, 0, lockPx);
      return;
    }

    event.preventDefault();
    updateRouteSwipeVisualState(bar, surface, deltaX, lockPx);
  };

  const onTouchEnd = (event) => {
    if (!gesture) {
      return;
    }

    const touch = event.changedTouches?.[0];
    if (!touch) {
      resetGesture();
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const horizontalIntent =
      Math.abs(deltaX) >= triggerPx
      && Math.abs(deltaX) > Math.abs(deltaY) * 1.35;

    if (shouldHandleSwipe() && horizontalIntent) {
      event.preventDefault();
      if (deltaX > 0) {
        options.onRight?.();
      } else {
        options.onLeft?.();
      }
    }

    resetGesture();
  };

  surface.addEventListener("touchstart", onTouchStart, { passive: true });
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  surface.addEventListener("touchend", onTouchEnd, { passive: false });
  surface.addEventListener("touchcancel", resetGesture, { passive: true });
}

async function bootstrap() {
  installTouchOptimizations();
  const isAdminRuntime = !shouldBootstrapCashierRuntime();

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
  refs.storeLogo = $("store-logo");
  refs.storeLogoFallback = $("store-logo-fallback");
  refs.storeEyebrow = $("store-eyebrow");
  refs.storeTitle = $("store-title");
  refs.storeHeroCopy = $("store-hero-copy");
  refs.storeFavicon = $("store-favicon");
  refs.storeAppleTouchIcon = $("store-apple-touch-icon");
  refs.shiftSelect = $("shift-select");
  refs.cashierInput = $("cashier-input");
  refs.searchInput = $("search-input");
  refs.searchQuickResults = $("search-quick-results");
  refs.toggleRouteModeButton = $("toggle-route-mode-button");
  refs.routeModePill = $("route-mode-pill");
  refs.toggleRegisterToolbarButton = $("toggle-register-toolbar-button");
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
  refs.openReceivablesButton = $("open-receivables-button");
  refs.openMerchandiseRequestButton = $("open-merchandise-request-button");
  refs.refreshCatalogButton = $("refresh-catalog-button");
  refs.exportScopeSelect = $("export-scope-select");
  refs.exportDateInput = $("export-date-input");
  refs.exportWorkbookButton = $("export-workbook-button");
  refs.downloadDbButton = $("download-db-button");
  refs.installDbButton = $("install-db-button");
  refs.installDbInput = $("install-db-input");
  refs.installWorkbookButton = $("install-workbook-button");
  refs.installWorkbookInput = $("install-workbook-input");
  refs.openPaymentButton = $("open-payment-button");
  refs.clearCartButton = $("clear-cart-button");
  refs.cartPanel = $("cart-panel");
  refs.routeCartFab = $("route-cart-fab");
  refs.routeCartFabTotal = $("route-cart-fab-total");
  refs.routeCartFabCount = $("route-cart-fab-count");
  refs.approvalsMobileShell = $("approvals-mobile-shell");
  refs.approvalsMobileStatus = $("approvals-mobile-status");
  refs.approvalsMobileCount = $("approvals-mobile-count");
  refs.approvalsMobileNetwork = $("approvals-mobile-network");
  refs.closeApprovalsMobileButton = $("close-approvals-mobile-button");
  refs.approvalsMobileContent = $("approvals-mobile-content");
  refs.itemModal = $("item-modal");
  refs.itemModalCard = $("item-modal-card");
  refs.itemModalName = $("item-modal-name");
  refs.itemModalMeta = $("item-modal-meta");
  refs.itemQuantity = $("item-quantity");
  refs.itemQuickQuantities = $("item-quick-quantities");
  refs.itemRouteDecisionBar = $("item-route-decision-bar");
  refs.itemRouteCancelButton = $("item-route-cancel-button");
  refs.itemRouteConfirmButton = $("item-route-confirm-button");
  refs.itemTotal = $("item-total");
  refs.itemUnitPrice = $("item-unit-price");
  refs.itemPricingHint = $("item-pricing-hint");
  refs.addItemButton = $("add-item-button");
  refs.routeCartEditorModal = $("route-cart-editor-modal");
  refs.routeCartEditorCard = $("route-cart-editor-card");
  refs.routeCartEditorName = $("route-cart-editor-name");
  refs.routeCartEditorMeta = $("route-cart-editor-meta");
  refs.routeCartEditorQuantity = $("route-cart-editor-quantity");
  refs.routeCartEditorUnitPrice = $("route-cart-editor-unit-price");
  refs.routeCartEditorTotal = $("route-cart-editor-total");
  refs.routeCartEditorHint = $("route-cart-editor-hint");
  refs.routeCartEditorResetPriceButton = $("route-cart-editor-reset-price-button");
  refs.routeCartEditorRemoveButton = $("route-cart-editor-remove-button");
  refs.saveRouteCartEditorButton = $("save-route-cart-editor-button");
  refs.paymentModal = $("payment-modal");
  refs.paymentModalCard = $("payment-modal-card");
  refs.paymentTotal = $("payment-total");
  refs.paymentMethods = $("payment-methods");
  refs.paymentContextNote = $("payment-context-note");
  refs.paymentReceivedLabel = $("payment-received-label");
  refs.moneyDisplay = $("money-display");
  refs.paymentExactShortcutButton = $("payment-exact-shortcut-button");
  refs.paymentCustomerField = $("payment-customer-field");
  refs.paymentCustomerLabel = $("payment-customer-label");
  refs.paymentCustomerInput = $("payment-customer-input");
  refs.paymentReceivedMethodField = $("payment-received-method-field");
  refs.paymentReceivedMethodInput = $("payment-received-method-input");
  refs.paymentNoteField = $("payment-note-field");
  refs.paymentNoteInput = $("payment-note-input");
  refs.paymentReceived = $("payment-received");
  refs.paymentChangeLabel = $("payment-change-label");
  refs.paymentChange = $("payment-change");
  refs.confirmSaleButton = $("confirm-sale-button");
  refs.paymentRouteDecisionBar = $("payment-route-decision-bar");
  refs.paymentRouteCancelButton = $("payment-route-cancel-button");
  refs.paymentRouteConfirmButton = $("payment-route-confirm-button");
  refs.cashPaymentBlock = $("cash-payment-block");
  refs.quickImportModal = $("quick-import-modal");
  refs.quickImportModeBar = $("quick-import-mode-bar");
  refs.quickImportDescription = $("quick-import-description");
  refs.quickImportProgressText = $("quick-import-progress-text");
  refs.quickImportProgressNote = $("quick-import-progress-note");
  refs.quickImportProgressFill = $("quick-import-progress-fill");
  refs.quickImportTotalCount = $("quick-import-total-count");
  refs.quickImportPendingCount = $("quick-import-pending-count");
  refs.quickImportSavedCount = $("quick-import-saved-count");
  refs.quickImportSkippedCount = $("quick-import-skipped-count");
  refs.quickImportEmpty = $("quick-import-empty");
  refs.quickImportContent = $("quick-import-content");
  refs.quickImportCurrentState = $("quick-import-current-state");
  refs.quickImportProductName = $("quick-import-product-name");
  refs.quickImportProductMeta = $("quick-import-product-meta");
  refs.quickImportProductPosition = $("quick-import-product-position");
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
  refs.quickImportFilterSummary = $("quick-import-filter-summary");
  refs.quickImportSearch = $("quick-import-search");
  refs.quickImportNextList = $("quick-import-next-list");
  refs.quickImportPrevButton = $("quick-import-prev-button");
  refs.quickImportNextButton = $("quick-import-next-button");
  refs.quickImportSkipButton = $("quick-import-skip-button");
  refs.quickImportSaveCurrentButton = $("quick-import-save-current-button");
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
  refs.receivablesModal = $("receivables-modal");
  refs.receivablesSearch = $("receivables-search");
  refs.receivablesCustomerList = $("receivables-customer-list");
  refs.receivablesCustomerDetail = $("receivables-customer-detail");
  refs.receivablePaymentModal = $("receivable-payment-modal");
  refs.receivablePaymentTitle = $("receivable-payment-title");
  refs.receivablePaymentMeta = $("receivable-payment-meta");
  refs.receivablePaymentSummary = $("receivable-payment-summary");
  refs.receivablePaymentAmount = $("receivable-payment-amount");
  refs.receivablePaymentMethod = $("receivable-payment-method");
  refs.receivablePaymentNote = $("receivable-payment-note");
  refs.saveReceivablePaymentButton = $("save-receivable-payment-button");
  refs.registerModal = $("register-modal");
  refs.registerModalEyebrow = $("register-modal-eyebrow");
  refs.registerModalTitle = $("register-modal-title");
  refs.registerModalDescription = $("register-modal-description");
  refs.registerOpeningAmount = $("register-opening-amount");
  refs.registerCashSales = $("register-cash-sales");
  refs.registerCreditSales = $("register-credit-sales");
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
  refs.cashierBlindAuditModal = $("cashier-blind-audit-modal");
  refs.cashierBlindAuditTitle = $("cashier-blind-audit-title");
  refs.cashierBlindAuditMeta = $("cashier-blind-audit-meta");
  refs.cashierBlindAuditSummary = $("cashier-blind-audit-summary");
  refs.cashierBlindAuditItems = $("cashier-blind-audit-items");
  refs.cashierBlindAuditHelper = $("cashier-blind-audit-helper");
  refs.saveCashierBlindAuditButton = $("save-cashier-blind-audit-button");
  refs.detailViewerModal = $("detail-viewer-modal");
  refs.detailViewerTitle = $("detail-viewer-title");
  refs.detailViewerMeta = $("detail-viewer-meta");
  refs.detailViewerBody = $("detail-viewer-body");
  refs.adminModal = $("admin-modal");
  refs.adminCard = $("admin-card");
  refs.adminSectionNav = $("admin-section-nav");
  refs.adminBranchSelect = $("admin-branch-select");
  refs.adminBranchTitle = $("admin-branch-title");
  refs.adminBranchDescription = $("admin-branch-description");
  refs.adminLogoutButton = $("admin-logout-button");
  refs.adminMetricsStatus = $("admin-metrics-status");
  refs.adminSummaryCards = $("admin-summary-cards");
  refs.adminShiftSummary = $("admin-shift-summary");
  refs.adminProfitabilityStatus = $("admin-profitability-status");
  refs.adminProfitabilityPeriod = $("admin-profitability-period");
  refs.adminProfitabilityDate = $("admin-profitability-date");
  refs.refreshAdminProfitabilityButton = $("refresh-admin-profitability-button");
  refs.adminProfitabilitySummary = $("admin-profitability-summary");
  refs.adminProfitabilityActions = $("admin-profitability-actions");
  refs.adminProfitabilityLowMargin = $("admin-profitability-low-margin");
  refs.adminProfitabilityMissingCost = $("admin-profitability-missing-cost");
  refs.adminHealthStatus = $("admin-health-status");
  refs.adminHealthSummary = $("admin-health-summary");
  refs.adminHealthReasons = $("admin-health-reasons");
  refs.adminHealthActions = $("admin-health-actions");
  refs.adminSubscriptionStatus = $("admin-subscription-status");
  refs.adminSubscriptionSummary = $("admin-subscription-summary");
  refs.adminSubscriptionPanel = $("admin-subscription-panel");
  refs.adminSubscriptionPlan = $("admin-subscription-plan");
  refs.adminSubscriptionState = $("admin-subscription-state");
  refs.adminSubscriptionAmount = $("admin-subscription-amount");
  refs.adminSubscriptionPeriodEnd = $("admin-subscription-period-end");
  refs.adminSubscriptionGrace = $("admin-subscription-grace");
  refs.adminSubscriptionNotes = $("admin-subscription-notes");
  refs.syncAdminSubscriptionButton = $("sync-admin-subscription-button");
  refs.syncAdminControlConfigButton = $("sync-admin-control-config-button");
  refs.saveAdminSubscriptionButton = $("save-admin-subscription-button");
  refs.adminSubscriptionPaymentForm = $("admin-subscription-payment-form");
  refs.adminSubscriptionPaymentAmount = $("admin-subscription-payment-amount");
  refs.adminSubscriptionPaymentMethod = $("admin-subscription-payment-method");
  refs.adminSubscriptionPaymentStart = $("admin-subscription-payment-start");
  refs.adminSubscriptionPaymentEnd = $("admin-subscription-payment-end");
  refs.adminSubscriptionPaymentNotes = $("admin-subscription-payment-notes");
  refs.recordAdminSubscriptionPaymentButton = $("record-admin-subscription-payment-button");
  refs.adminSubscriptionPayments = $("admin-subscription-payments");
  refs.adminProcessCpu = $("admin-process-cpu");
  refs.adminProcessMemory = $("admin-process-memory");
  refs.adminProductsRender = $("admin-products-render");
  refs.adminSnapshotRender = $("admin-snapshot-render");
  refs.adminVisibleProducts = $("admin-visible-products");
  refs.adminDomNodes = $("admin-dom-nodes");
  refs.adminRouteQuickAdd = $("admin-route-quick-add");
  refs.adminRouteQuickAddDetail = $("admin-route-quick-add-detail");
  refs.adminRouteEditorOpen = $("admin-route-editor-open");
  refs.adminRouteEditorOpenDetail = $("admin-route-editor-open-detail");
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
  refs.adminOfflineSalesStatus = $("admin-offline-sales-status");
  refs.adminOfflineSalesList = $("admin-offline-sales-list");
  refs.retryOfflineSalesButton = $("retry-offline-sales-button");
  refs.downloadOfflineSalesButton = $("download-offline-sales-button");
  refs.adminInventoryWrap = $("admin-inventory-wrap");
  refs.inventoryBodyWrapper = $("admin-inventory-wrap");
  refs.adminInventoryStatus = $("admin-inventory-status");
  refs.toggleAdminInventoryButton = $("toggle-admin-inventory-button");
  refs.adminInventoryModeBar = $("admin-inventory-mode-bar");
  refs.adminInventoryMovementPanel = $("admin-inventory-movement-panel");
  refs.openInventoryReceiveButton = $("open-inventory-receive-button");
  refs.openInventoryReturnButton = $("open-inventory-return-button");
  refs.openInventoryCountButton = $("open-inventory-count-button");
  refs.adminInventoryFilterBar = $("admin-inventory-filter-bar");
  refs.adminInventorySearch = $("admin-inventory-search");
  refs.adminInventoryFilterChips = $("admin-inventory-filter-chips");
  refs.adminProductCreateForm = $("admin-product-create-form");
  refs.inventoryCardList = $("inventory-card-list");
  refs.adminNewProductName = $("admin-new-product-name");
  refs.adminNewProductCategory = $("admin-new-product-category");
  refs.adminNewProductUnit = $("admin-new-product-unit");
  refs.adminNewProductPrice = $("admin-new-product-price");
  refs.adminNewProductCost = $("admin-new-product-cost");
  refs.adminNewProductStock = $("admin-new-product-stock");
  refs.adminNewProductMinStock = $("admin-new-product-min-stock");
  refs.adminNewProductSku = $("admin-new-product-sku");
  refs.adminNewProductBarcode = $("admin-new-product-barcode");
  refs.adminNewProductBrand = $("admin-new-product-brand");
  refs.adminNewProductSupplier = $("admin-new-product-supplier");
  refs.adminNewProductPackSize = $("admin-new-product-pack-size");
  refs.adminNewProductAttributes = $("admin-new-product-attributes");
  refs.saveAdminProductButton = $("save-admin-product-button");
  refs.adminCashierName = $("admin-cashier-name");
  refs.adminCashierBranch = $("admin-cashier-branch");
  refs.adminCashierPassword = $("admin-cashier-password");
  refs.saveAdminCashierButton = $("save-admin-cashier-button");
  refs.adminCashiersList = $("admin-cashiers-list");
  refs.adminBranchCode = $("admin-branch-code");
  refs.adminBranchName = $("admin-branch-name");
  refs.adminBranchTimezone = $("admin-branch-timezone");
  refs.adminBranchActive = $("admin-branch-active");
  refs.saveAdminBranchButton = $("save-admin-branch-button");
  refs.resetAdminBranchButton = $("reset-admin-branch-button");
  refs.adminBranchesList = $("admin-branches-list");
  refs.adminMerchandiseRequestsList = $("admin-merchandise-requests-list");
  refs.adminMerchandiseRequestsStatus = $("admin-merchandise-requests-status");
  refs.adminPeriodClosureDate = $("admin-period-closure-date");
  refs.adminPeriodClosuresStatus = $("admin-period-closures-status");
  refs.adminPeriodClosuresSummary = $("admin-period-closures-summary");
  refs.adminPeriodClosuresWarnings = $("admin-period-closures-warnings");
  refs.adminPeriodClosureNotes = $("admin-period-closure-notes");
  refs.adminPeriodClosuresBreakdowns = $("admin-period-closures-breakdowns");
  refs.adminPeriodClosureDetail = $("admin-period-closure-detail");
  refs.adminPeriodClosuresList = $("admin-period-closures-list");
  refs.loadAdminPeriodClosuresButton = $("load-admin-period-closures-button");
  refs.saveAdminPeriodClosureButton = $("save-admin-period-closure-button");
  refs.regenerateAdminPeriodClosureButton = $("regenerate-admin-period-closure-button");
  refs.adminWeightedAuditDate = $("admin-weighted-audit-date");
  refs.adminWeightedAuditShift = $("admin-weighted-audit-shift");
  refs.adminWeightedAuditStatus = $("admin-weighted-audit-status");
  refs.adminWeightedAuditSessions = $("admin-weighted-audit-sessions");
  refs.adminWeightedAuditItems = $("admin-weighted-audit-items");
  refs.loadWeightedAuditButton = $("load-weighted-audit-button");
  refs.createWeightedAuditButton = $("create-weighted-audit-button");
  refs.saveWeightedAuditItemsButton = $("save-weighted-audit-items-button");
  refs.completeWeightedAuditButton = $("complete-weighted-audit-button");
  refs.adminWeightedAuditSearch = $("admin-weighted-audit-search");
  refs.toggleWeightedAuditPendingButton = $("toggle-weighted-audit-pending-button");
  refs.toggleWeightedAuditIncidentsButton = $("toggle-weighted-audit-incidents-button");
  refs.fillWeightedAuditVisibleButton = $("fill-weighted-audit-visible-button");
  refs.clearWeightedAuditVisibleButton = $("clear-weighted-audit-visible-button");
  refs.configAllowNegativeStock = $("config-allow-negative-stock");
  refs.configBusinessName = $("config-business-name");
  refs.configShortName = $("config-short-name");
  refs.configSlug = $("config-slug");
  refs.configTimezone = $("config-timezone");
  refs.configLocale = $("config-locale");
  refs.configCurrencyCode = $("config-currency-code");
  refs.configTicketPrefix = $("config-ticket-prefix");
  refs.configTemplateSelect = $("config-template-select");
  refs.applyAdminTemplateButton = $("apply-admin-template-button");
  refs.configModulesWrap = $("config-modules-wrap");
  refs.catalogWorkbookPath = $("catalog-workbook-path");
  refs.configCategoryCode = $("config-category-code");
  refs.configCategoryLabel = $("config-category-label");
  refs.configCategorySort = $("config-category-sort");
  refs.saveConfigCategoryButton = $("save-config-category-button");
  refs.configCategoriesList = $("config-categories-list");
  refs.configUnitCode = $("config-unit-code");
  refs.configUnitLabel = $("config-unit-label");
  refs.configUnitStep = $("config-unit-step");
  refs.configUnitSort = $("config-unit-sort");
  refs.configUnitAllowDecimals = $("config-unit-allow-decimals");
  refs.saveConfigUnitButton = $("save-config-unit-button");
  refs.configUnitsList = $("config-units-list");
  refs.configAttributeKey = $("config-attribute-key");
  refs.configAttributeLabel = $("config-attribute-label");
  refs.configAttributeType = $("config-attribute-type");
  refs.configAttributeOptions = $("config-attribute-options");
  refs.configAttributeSort = $("config-attribute-sort");
  refs.configAttributeRequired = $("config-attribute-required");
  refs.saveConfigAttributeButton = $("save-config-attribute-button");
  refs.configAttributesList = $("config-attributes-list");
  refs.saveAdminConfigButton = $("save-admin-config-button");
  refs.adminAuthModal = $("admin-auth-modal");
  refs.adminModalSecretTrigger = $("admin-modal-secret-trigger");
  refs.adminAuthTitle = $("admin-auth-title");
  refs.adminAuthDescription = $("admin-auth-description");
  refs.adminAuthUsername = $("admin-auth-username");
  refs.adminAuthPasswordLabel = $("admin-auth-password-label");
  refs.adminAuthPassword = $("admin-auth-password");
  refs.adminAuthConfirmField = $("admin-auth-confirm-field");
  refs.adminAuthConfirmPassword = $("admin-auth-confirm-password");
  refs.adminAuthBootstrapStatus = $("admin-auth-bootstrap-status");
  refs.adminAuthBootstrapField = $("admin-auth-bootstrap-field");
  refs.adminAuthBootstrapToken = $("admin-auth-bootstrap-token");
  refs.saveAdminAuthButton = $("save-admin-auth-button");
  refs.ownerAuthModal = $("owner-auth-modal");
  refs.ownerAuthTitle = $("owner-auth-title");
  refs.ownerAuthDescription = $("owner-auth-description");
  refs.ownerAuthUsername = $("owner-auth-username");
  refs.ownerAuthPasswordLabel = $("owner-auth-password-label");
  refs.ownerAuthPassword = $("owner-auth-password");
  refs.ownerAuthConfirmField = $("owner-auth-confirm-field");
  refs.ownerAuthConfirmPassword = $("owner-auth-confirm-password");
  refs.ownerAuthBootstrapStatus = $("owner-auth-bootstrap-status");
  refs.ownerAuthBootstrapField = $("owner-auth-bootstrap-field");
  refs.ownerAuthBootstrapToken = $("owner-auth-bootstrap-token");
  refs.saveOwnerAuthButton = $("save-owner-auth-button");
  refs.ownerConsoleModal = $("owner-console-modal");
  refs.ownerConsoleTitle = $("owner-console-title");
  refs.ownerConsoleDescription = $("owner-console-description");
  refs.ownerModulesWrap = $("owner-modules-wrap");
  refs.ownerAdminSectionsWrap = $("owner-admin-sections-wrap");
  refs.ownerTemplateSelect = $("owner-template-select");
  refs.ownerTemplateBusinessName = $("owner-template-business-name");
  refs.ownerTemplateSlug = $("owner-template-slug");
  refs.ownerTemplateWorkbookPath = $("owner-template-workbook-path");
  refs.ownerTemplateConfirmText = $("owner-template-confirm-text");
  refs.ownerTemplateConfirmReset = $("owner-template-confirm-reset");
  refs.ownerTemplateCurrentSlug = $("owner-template-current-slug");
  refs.ownerTemplateStatus = $("owner-template-status");
  refs.applyOwnerTemplateButton = $("apply-owner-template-button");
  refs.ownerOperationGuide = $("owner-operation-guide");
  refs.ownerOfflineSalesStatus = $("owner-offline-sales-status");
  refs.ownerOfflineSalesList = $("owner-offline-sales-list");
  refs.ownerRetryOfflineSalesButton = $("owner-retry-offline-sales-button");
  refs.ownerDownloadOfflineSalesButton = $("owner-download-offline-sales-button");
  refs.saveOwnerConsoleButton = $("save-owner-console-button");
  refs.ownerLogoutButton = $("owner-logout-button");
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
  refs.syncStatusButton = $("sync-status-button");
  refs.cashierAuthModal = $("cashier-auth-modal");
  refs.cashierAuthName = $("cashier-auth-name");
  refs.cashierAuthBranch = $("cashier-auth-branch");
  refs.cashierAuthPassword = $("cashier-auth-password");
  refs.loginCashierButton = $("login-cashier-button");
  refs.closeCashierAuthModal = $("close-cashier-auth-modal");
  document.querySelectorAll(".modal-shell").forEach((modal) => {
    modal.setAttribute("aria-hidden", modal.classList.contains("open") ? "false" : "true");
  });

  if (refs.exportDateInput) {
    const todayValue = toDateInputValue();
    refs.exportDateInput.max = todayValue;
    refs.exportDateInput.min = shiftDateInputValue(todayValue, -14);
    refs.exportDateInput.value = todayValue;
  }
  if (refs.adminPeriodClosureDate) {
    refs.adminPeriodClosureDate.value = toDateInputValue();
  }
  if (refs.adminWeightedAuditDate) {
    refs.adminWeightedAuditDate.value = toDateInputValue();
  }
  state.admin.periodClosures.dateKey = refs.adminPeriodClosureDate?.value || toDateInputValue();
  state.admin.weightedAudit.dateKey = refs.adminWeightedAuditDate?.value || toDateInputValue();
  state.admin.weightedAudit.shift =
    refs.adminWeightedAuditShift?.value || refs.shiftSelect?.value || "Tarde";

  // Restaurar estado persistido
  await restorePreferences();
  await restoreQueue();
  await restoreOfflineSales();
  await restoreOfflineReceivablePayments();
  syncOfflineSalesAuditWithQueue();
  syncOfflineReceivablePaymentsAuditWithQueue();
  let cachedSnapshot = null;

  if (!isAdminRuntime) {
    await restoreCart();
    await restoreReceivablesCache();
    await restoreRegisterEvents();
    await restoreCashierSession();
    cachedSnapshot = await restoreSnapshot();
    if (cachedSnapshot) {
      const offlineCashierBranch = state.cashier.branch || getActiveCashierBranch();
      const preparedOfflineSnapshot =
        !state.online
        && state.cashier.authenticated
        && typeof getPreparedOfflineSnapshot === "function"
          ? await getPreparedOfflineSnapshot(offlineCashierBranch)
          : null;
      const initialSnapshot = resolveStartupSnapshotFromCache(cachedSnapshot, {
        branch: offlineCashierBranch,
        preparedSnapshot: preparedOfflineSnapshot,
      });
      applySnapshot(initialSnapshot, {
        skipPersist: true,
        persistPreparedSnapshot: false,
      });
    }
    try {
      if (state.cashier.token) {
        await loadCashierAuthStatus();
      }
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        clearCashierSessionState();
        if (typeof sanitizeAfterCashierSessionLoss === "function") {
          sanitizeAfterCashierSessionLoss();
        }
      }
    }
  }
  try {
    if (state.online) {
      await loadAdminAuthStatus();
    }
  } catch (error) {
    if (!isNetworkError(error)) {
      state.admin.configured = false;
      state.admin.setupAllowed = false;
      state.admin.authenticated = false;
      state.admin.csrfToken = "";
      state.admin.capabilitiesResolved = false;
    }
  }
  try {
    if (state.online && !isAdminRuntime) {
      await loadOwnerAuthStatus();
    }
  } catch (error) {
    if (!isNetworkError(error)) {
      state.owner.configured = false;
      state.owner.setupAllowed = false;
      state.owner.authenticated = false;
      state.owner.csrfToken = "";
      state.owner.accessLoaded = false;
      if (!state.admin.authenticated) {
        state.admin.capabilitiesResolved = false;
      }
    }
  }

  // Renderizados iniciales
  if (isAdminRuntime) {
    renderQuickImportModal();
    renderMerchandiseRequestDetailModal();
    renderDetailViewer();
    renderAdminModal();
    renderAdminRecordLists();
    renderAdminMerchandiseRequests();
    renderAdminAuthModal();
    renderAdminEditorModal();
  } else {
    renderCart();
    renderCashierSession();
    renderQuickImportModal();
    renderMyMerchandiseRequests();
    renderMerchandiseRequestModal();
    renderMerchandiseRequestItemModal();
    renderMerchandiseRequestDetailModal();
    renderApprovalsMobileView();
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
  }
  updateClock();
  renderSyncStatus();
  if (!isAdminRuntime) {
    renderRouteMode();
  }
  window.setInterval(updateClock, 1000);
  if (!isAdminRuntime) {
    window.addEventListener("resize", renderRouteMode);
    installRouteSwipeDecisionSurface(refs.itemModalCard, {
      bar: refs.itemRouteDecisionBar,
      onLeft: closeItemModal,
      onRight: () => {
        if (!refs.itemRouteConfirmButton?.disabled) {
          addCurrentProductToCart();
        }
      },
    });
    installRouteSwipeDecisionSurface(refs.paymentModalCard, {
      bar: refs.paymentRouteDecisionBar,
      triggerPx: ROUTE_PAYMENT_SWIPE_TRIGGER_PX,
      lockPx: ROUTE_PAYMENT_SWIPE_LOCK_PX,
      onLeft: closePaymentModal,
      onRight: () => {
        if (!refs.paymentRouteConfirmButton?.disabled) {
          submitSale();
        }
      },
    });
  }

  // === Registro de eventos ===

  // Buscador
  refs.searchInput.addEventListener("input", () => requestProductsRender(true));
  refs.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitProductSearchFromKeyboard();
  });
  refs.searchInput.addEventListener("search", submitProductSearchFromKeyboard);
  refs.searchQuickResults?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-search-product"]');
    if (!button) {
      return;
    }

    event.preventDefault();
    openCatalogProductById(button.dataset.productId);
  });
  refs.toggleRouteModeButton?.addEventListener("click", toggleRouteMode);
  refs.toggleRegisterToolbarButton?.addEventListener("click", toggleRouteRegisterCollapsed);
  refs.routeCartFab?.addEventListener("click", scrollToRouteCart);

  // Admin
  refs.openAdminButton.addEventListener("click", openAdministrationRoute);
  if (refs.headerAdminButton) {
    refs.headerAdminButton.addEventListener("click", openAdministrationRoute);
  }
  refs.adminModalSecretTrigger?.addEventListener("click", registerOwnerRevealIntent);
  refs.adminBranchSelect.addEventListener("change", async () => {
    const branch = refs.adminBranchSelect.value;
    try {
      state.admin.branch = branch;
      await refreshAdminWorkspace(
        getAdminWorkspaceSectionOptions(state.admin.activeSection, branch, true),
      );
      showToast(`Vista admin cambiada a ${getBranchLabel(branch)}`, "info");
    } catch (_error) {
      showToast("Error al cambiar sucursal", "error");
    }
  });
  refs.adminSectionNav?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-section-tab]");
    if (!button) {
      return;
    }
    setAdminActiveSection(button.dataset.adminSectionTab, { refresh: true });
  });
  refs.adminProfitabilityPeriod?.addEventListener("change", () => {
    state.admin.profitabilityPeriod = refs.adminProfitabilityPeriod.value || "today";
    void loadAdminMetrics();
  });
  refs.adminProfitabilityDate?.addEventListener("change", () => {
    state.admin.profitabilityDateKey = refs.adminProfitabilityDate.value || "";
    void loadAdminMetrics();
  });
  refs.refreshAdminProfitabilityButton?.addEventListener("click", () => {
    void loadAdminMetrics();
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
  refs.loadAdminPeriodClosuresButton?.addEventListener("click", () => {
    void loadAdminPeriodClosuresWorkspace(getAdminBranch(), { toastOnError: true });
  });
  refs.saveAdminPeriodClosureButton?.addEventListener("click", () => {
    void saveAdminPeriodClosure();
  });
  refs.regenerateAdminPeriodClosureButton?.addEventListener("click", () => {
    void saveAdminPeriodClosure({ regenerate: true });
  });
  refs.adminPeriodClosureDate?.addEventListener("change", () => {
    state.admin.periodClosures.dateKey = refs.adminPeriodClosureDate.value;
  });
  refs.adminPeriodClosureNotes?.addEventListener("input", () => {
    updateAdminPeriodClosureNotesDraft(refs.adminPeriodClosureNotes.value);
  });
  refs.adminWeightedAuditSearch?.addEventListener("input", () => {
    updateWeightedAuditFilters({ search: refs.adminWeightedAuditSearch.value });
  });
  refs.toggleWeightedAuditPendingButton?.addEventListener("click", () => {
    updateWeightedAuditFilters({
      showPendingOnly: !state.admin.weightedAudit.showPendingOnly,
      showIncidentsOnly: false,
    });
  });
  refs.toggleWeightedAuditIncidentsButton?.addEventListener("click", () => {
    updateWeightedAuditFilters({
      showPendingOnly: false,
      showIncidentsOnly: !state.admin.weightedAudit.showIncidentsOnly,
    });
  });
  refs.fillWeightedAuditVisibleButton?.addEventListener("click", () => {
    fillVisibleWeightedAuditDraftsWithPos();
  });
  refs.clearWeightedAuditVisibleButton?.addEventListener("click", () => {
    clearVisibleWeightedAuditDrafts();
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
  refs.openReceivablesButton.addEventListener("click", openReceivablesModal);
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
  refs.adminNewProductUnit?.addEventListener("change", syncAdminProductCatalogs);
  refs.adminInventoryModeBar?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inventory-mode]");
    if (!button) {
      return;
    }
    setAdminInventoryMode(button.dataset.inventoryMode, {
      expand: button.dataset.inventoryMode === "edit",
    });
  });
  refs.adminInventorySearch?.addEventListener("input", () => {
    updateAdminInventorySearch(refs.adminInventorySearch.value);
  });
  refs.adminInventoryFilterChips?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inventory-filter]");
    if (!button) {
      return;
    }
    setAdminInventoryFilter(button.dataset.inventoryFilter);
  });
  refs.openInventoryReceiveButton?.addEventListener("click", () => {
    void openAdminInventoryMovement("receive");
  });
  refs.openInventoryReturnButton?.addEventListener("click", () => {
    void openAdminInventoryMovement("return");
  });
  refs.openInventoryCountButton?.addEventListener("click", openAdminInventoryCountMode);

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

  // Modal Auth Owner
  $("close-owner-auth-modal").addEventListener("click", closeOwnerAuthModal);
  $("cancel-owner-auth-button").addEventListener("click", closeOwnerAuthModal);
  refs.saveOwnerAuthButton.addEventListener("click", submitOwnerAuth);
  refs.ownerAuthUsername.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitOwnerAuth();
    }
  });
  refs.ownerAuthPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitOwnerAuth();
    }
  });
  refs.ownerAuthConfirmPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitOwnerAuth();
    }
  });

  // Owner Console
  $("close-owner-console-modal").addEventListener("click", closeOwnerConsoleModal);
  refs.ownerLogoutButton.addEventListener("click", logoutOwner);
  refs.saveOwnerConsoleButton.addEventListener("click", submitOwnerConsole);
  refs.applyOwnerTemplateButton?.addEventListener("click", applyOwnerTemplateReset);
  refs.ownerOperationGuide?.addEventListener("click", copyOwnerOperationCommand);
  refs.ownerRetryOfflineSalesButton?.addEventListener("click", retryAllOfflineSalesFromPanel);
  refs.ownerDownloadOfflineSalesButton?.addEventListener("click", downloadOfflineSalesAuditFromPanel);

  // Modal Editor Admin
  $("close-admin-editor-modal").addEventListener("click", closeAdminEditor);
  $("cancel-admin-editor-button").addEventListener("click", closeAdminEditor);
  refs.saveAdminEditorButton.addEventListener("click", saveAdminEditor);

  // Modal Item
  $("close-item-modal").addEventListener("click", closeItemModal);
  $("cancel-item-button").addEventListener("click", closeItemModal);
  $("add-item-button").addEventListener("click", addCurrentProductToCart);
  refs.itemRouteCancelButton?.addEventListener("click", closeItemModal);
  refs.itemRouteConfirmButton?.addEventListener("click", addCurrentProductToCart);
  refs.itemQuantity.addEventListener("input", syncItemTotalFromQuantity);
  refs.itemQuantity.addEventListener("focus", () => focusAndSelectInput(refs.itemQuantity, { defer: false }));
  refs.itemTotal.addEventListener("input", syncItemQuantityFromTotal);
  refs.itemUnitPrice.addEventListener("input", syncItemFromUnitPrice);
  refs.itemQuantity.addEventListener("keydown", submitCurrentProductFromKeyboard);
  refs.itemTotal.addEventListener("keydown", submitCurrentProductFromKeyboard);
  refs.itemUnitPrice.addEventListener("keydown", submitCurrentProductFromKeyboard);
  refs.itemTotal.addEventListener("blur", finalizeItemTotalInput);
  refs.itemUnitPrice.addEventListener("blur", finalizeItemUnitPriceInput);
  refs.itemTotal.addEventListener("focus", () => focusAndSelectInput(refs.itemTotal, { defer: false }));
  refs.itemUnitPrice.addEventListener("focus", () => focusAndSelectInput(refs.itemUnitPrice, { defer: false }));
  refs.itemQuickQuantities?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity]");
    if (!button) {
      return;
    }
    applyItemQuickQuantity(Number(button.dataset.quantity));
  });

  // Modal Edicion rapida de carrito
  $("close-route-cart-editor-modal").addEventListener("click", closeRouteCartEditor);
  $("cancel-route-cart-editor-button").addEventListener("click", closeRouteCartEditor);
  refs.saveRouteCartEditorButton.addEventListener("click", saveRouteCartEditor);
  refs.routeCartEditorRemoveButton.addEventListener("click", () => {
    if (Number.isInteger(state.routeCartEditor.index)) {
      removeCartItem(state.routeCartEditor.index);
    }
  });
  refs.routeCartEditorResetPriceButton.addEventListener("click", restoreRouteCartEditorBasePrice);
  refs.routeCartEditorQuantity.addEventListener("input", syncRouteCartEditorFromQuantity);
  refs.routeCartEditorQuantity.addEventListener("focus", () => focusAndSelectInput(refs.routeCartEditorQuantity, { defer: false }));
  refs.routeCartEditorUnitPrice.addEventListener("input", syncRouteCartEditorFromUnitPrice);
  refs.routeCartEditorUnitPrice.addEventListener("focus", () => focusAndSelectInput(refs.routeCartEditorUnitPrice, { defer: false }));
  refs.routeCartEditorTotal.addEventListener("input", syncRouteCartEditorFromTotal);
  refs.routeCartEditorTotal.addEventListener("focus", () => focusAndSelectInput(refs.routeCartEditorTotal, { defer: false }));
  refs.routeCartEditorTotal.addEventListener("blur", finalizeRouteCartEditorTotalInput);
  refs.routeCartEditorUnitPrice.addEventListener("blur", finalizeRouteCartEditorUnitPriceInput);
  refs.routeCartEditorQuantity.addEventListener("keydown", submitRouteCartEditorFromKeyboard);
  refs.routeCartEditorUnitPrice.addEventListener("keydown", submitRouteCartEditorFromKeyboard);
  refs.routeCartEditorTotal.addEventListener("keydown", submitRouteCartEditorFromKeyboard);

  // Modal Payment
  $("close-payment-modal").addEventListener("click", closePaymentModal);
  $("cancel-payment-button").addEventListener("click", closePaymentModal);
  refs.confirmSaleButton.addEventListener("click", submitSale);
  refs.paymentRouteCancelButton?.addEventListener("click", closePaymentModal);
  refs.paymentRouteConfirmButton?.addEventListener("click", submitSale);

  // Modal Quick Import
  $("close-quick-import-modal").addEventListener("click", closeQuickImportModal);
  refs.quickImportPrevButton.addEventListener("click", goToPreviousQuickImportItem);
  refs.quickImportNextButton.addEventListener("click", goToNextQuickImportItem);
  refs.quickImportSkipButton.addEventListener("click", skipQuickImportItem);
  refs.quickImportSaveCurrentButton.addEventListener("click", () => {
    saveQuickImportEntry({ advance: false });
  });
  refs.quickImportSaveButton.addEventListener("click", () => {
    saveQuickImportEntry({ advance: true });
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
  refs.quickImportSearch.addEventListener("input", () => {
    updateQuickImportSearch(refs.quickImportSearch.value);
  });
  refs.quickImportSupplier.addEventListener("input", () => {
    state.quickImport.supplierName = refs.quickImportSupplier.value;
  });
  refs.quickImportValue.addEventListener("input", () => {
    updateCurrentQuickImportDraft({ quantity: refs.quickImportValue.value });
  });
  refs.quickImportNote.addEventListener("input", () => {
    updateCurrentQuickImportDraft({ note: refs.quickImportNote.value });
  });
  refs.quickImportSearch.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusQuickImportListItem();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusQuickImportValue();
    }
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
      saveQuickImportEntry({ advance: !event.shiftKey });
    }
  });
  refs.quickImportNote.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveQuickImportEntry({ advance: !event.shiftKey });
    }
  });
  refs.quickImportModal.addEventListener("keydown", handleQuickImportModalKeydown);

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
    syncMerchandiseRequestItemTotal({ preserveTypedQuantity: true });
  });
  refs.merchandiseRequestItemQuantity.addEventListener("blur", finalizeMerchandiseRequestItemQuantityInput);
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
  refs.merchandiseRequestDetailBody.addEventListener("input", (event) => {
    const rejectField = event.target.closest("[data-merchandise-detail-reject-reason]");
    if (!rejectField) {
      return;
    }
    state.merchandise.detailRejectReason = rejectField.value;
  });

  // Bandeja movil de aprobaciones
  refs.closeApprovalsMobileButton?.addEventListener("click", closeApprovalsMobileView);
  refs.approvalsMobileContent?.addEventListener("click", (event) => {
    void handleApprovalsMobileContentClick(event);
  });
  refs.approvalsMobileContent?.addEventListener("input", handleApprovalsMobileContentInput);

  // Modal Cartera
  $("close-receivables-modal").addEventListener("click", closeReceivablesModal);
  refs.receivablesSearch.addEventListener("input", () => {
    state.receivables.search = refs.receivablesSearch.value;
    queueReceivablesSearch();
  });
  refs.receivablesCustomerList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="select-receivable-customer"]');
    if (!button) {
      return;
    }
    state.receivables.selectedCustomerKey = button.dataset.customerKey || "";
    void loadReceivableCustomerDetail(state.receivables.selectedCustomerKey);
  });
  refs.receivablesCustomerDetail.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-receivable-payment"]');
    if (!button) {
      return;
    }
    openReceivablePaymentModal(button.dataset.saleRef || button.dataset.saleId);
  });

  // Modal Abono cartera
  $("close-receivable-payment-modal").addEventListener("click", closeReceivablePaymentModal);
  $("cancel-receivable-payment-button").addEventListener("click", closeReceivablePaymentModal);
  refs.saveReceivablePaymentButton.addEventListener("click", submitReceivablePayment);
  refs.receivablePaymentAmount.addEventListener("input", () => {
    state.receivables.paymentAmount = refs.receivablePaymentAmount.value;
  });
  refs.receivablePaymentMethod.addEventListener("change", () => {
    state.receivables.paymentMethod = refs.receivablePaymentMethod.value;
  });
  refs.receivablePaymentNote.addEventListener("input", () => {
    state.receivables.paymentNote = refs.receivablePaymentNote.value;
  });
  refs.receivablePaymentAmount.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitReceivablePayment();
    }
  });
  refs.receivablePaymentNote.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitReceivablePayment();
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
  refs.cashierBlindAuditItems?.addEventListener("input", (event) => {
    const field = event.target.closest("[data-blind-audit-item-id]");
    if (!field) {
      return;
    }
    updateCashierBlindAuditDraft(field.dataset.blindAuditItemId, field.value);
  });
  refs.cashierBlindAuditItems?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    saveCashierBlindAuditCapture();
  });
  refs.saveCashierBlindAuditButton?.addEventListener("click", saveCashierBlindAuditCapture);

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

    openCatalogProductById(button.dataset.productId);
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
    const stepButton = event.target.closest('[data-action="route-cart-step"]');
    if (stepButton) {
      quickAdjustCartItemQuantity(
        Number(stepButton.dataset.index),
        Number(stepButton.dataset.delta || 0),
      );
      return;
    }

    const openEditorButton = event.target.closest('[data-action="open-cart-item"]');
    if (openEditorButton) {
      openCartItemForEditing(Number(openEditorButton.dataset.index));
      return;
    }

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

  refs.routeCartEditorModal.addEventListener("click", (event) => {
    if (event.target === refs.routeCartEditorModal) {
      closeRouteCartEditor();
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

  refs.receivablesModal.addEventListener("click", (event) => {
    if (event.target === refs.receivablesModal) {
      closeReceivablesModal();
    }
  });

  refs.merchandiseRequestItemModal.addEventListener("click", (event) => {
    if (event.target === refs.merchandiseRequestItemModal) {
      closeMerchandiseRequestItemModal();
    }
  });

  refs.receivablePaymentModal.addEventListener("click", (event) => {
    if (event.target === refs.receivablePaymentModal) {
      closeReceivablePaymentModal();
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

  refs.adminBranchesList?.addEventListener("click", (event) => {
    const editButton = event.target.closest('[data-action="edit-branch"]');
    if (editButton) {
      openAdminBranchEditor(editButton.dataset.code);
      return;
    }

    const toggleButton = event.target.closest('[data-action="toggle-branch"]');
    if (toggleButton) {
      void toggleAdminBranch(toggleButton.dataset.code, toggleButton.dataset.active === "1");
    }
  });

  refs.adminMerchandiseRequestsList.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-admin-merchandise-request"]');
    if (!button) {
      return;
    }
    void openAdminMerchandiseRequestDetail(button.dataset.requestId);
  });
  refs.adminPeriodClosuresList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-period-closure"]');
    if (!button) {
      return;
    }
    void openAdminPeriodClosureDetail(button.dataset.id);
  });

  refs.adminWeightedAuditSessions?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-weighted-audit-session"]');
    if (!button) {
      return;
    }
    void openAdminWeightedAuditSession(button.dataset.id);
  });
  refs.adminWeightedAuditItems?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "weighted-audit-set-pos") {
      applyWeightedAuditQuickAction("set-pos", button.dataset.itemId);
      return;
    }

    if (button.dataset.action === "weighted-audit-set-zero") {
      applyWeightedAuditQuickAction("set-zero", button.dataset.itemId);
      return;
    }

    if (button.dataset.action === "weighted-audit-clear-row") {
      applyWeightedAuditQuickAction("clear-row", button.dataset.itemId);
    }
  });
  refs.adminWeightedAuditItems?.addEventListener("input", (event) => {
    const notesField = event.target.closest("[data-weighted-session-notes]");
    if (notesField) {
      updateWeightedAuditNotesDraft(notesField.value);
      return;
    }

    const field = event.target.closest("[data-weighted-draft-field]");
    const row = event.target.closest("[data-weighted-item-row]");
    if (!field || !row) {
      return;
    }

    updateWeightedAuditDraftField(
      row.dataset.itemId,
      field.dataset.weightedDraftField,
      field.value,
    );
    syncWeightedAuditRowPreview(row);
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
  refs.saveAdminBranchButton?.addEventListener("click", submitAdminBranch);
  refs.resetAdminBranchButton?.addEventListener("click", resetAdminBranchForm);
  refs.saveAdminCashierButton.addEventListener("click", submitAdminCashier);
  refs.saveAdminConfigButton.addEventListener("click", submitAdminConfig);
  refs.applyAdminTemplateButton?.addEventListener("click", applyAdminBusinessTemplate);
  refs.saveConfigCategoryButton?.addEventListener("click", createAdminCategory);
  refs.saveConfigUnitButton?.addEventListener("click", createAdminUnit);
  refs.saveConfigAttributeButton?.addEventListener("click", createAdminProductAttribute);
  refs.syncAdminSubscriptionButton?.addEventListener("click", syncAdminSubscriptionFromControlPlane);
  refs.syncAdminControlConfigButton?.addEventListener("click", syncAdminControlConfigFromControlPlane);
  refs.saveAdminSubscriptionButton?.addEventListener("click", saveAdminSubscriptionSettings);
  refs.recordAdminSubscriptionPaymentButton?.addEventListener("click", recordAdminSubscriptionPayment);
  refs.devRefreshAdminButton?.addEventListener("click", refreshAdminDevPanelData);
  refs.devSyncOfflineButton?.addEventListener("click", retryOfflineSyncFromDev);
  refs.devDownloadStateButton?.addEventListener("click", downloadDebugStateFromDev);
  refs.retryOfflineSalesButton?.addEventListener("click", retryAllOfflineSalesFromPanel);
  refs.downloadOfflineSalesButton?.addEventListener("click", downloadOfflineSalesAuditFromPanel);
  refs.syncStatusButton?.addEventListener("click", downloadOfflineSalesAuditFromStatus);

  refs.adminOfflineSalesList?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-offline-sale-action]");
    if (!actionButton) {
      return;
    }
    void handleOfflineSaleAction(
      actionButton.dataset.offlineSaleAction,
      actionButton.dataset.clientSaleId,
    );
  });

  refs.ownerOfflineSalesList?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-offline-sale-action]");
    if (!actionButton) {
      return;
    }
    void handleOfflineSaleAction(
      actionButton.dataset.offlineSaleAction,
      actionButton.dataset.clientSaleId,
    );
  });

  refs.configCategoriesList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="deactivate-category"]');
    if (!button) {
      return;
    }
    void deactivateAdminCategory(button.dataset.categoryId);
  });

  refs.configUnitsList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="deactivate-unit"]');
    if (!button) {
      return;
    }
    void deactivateAdminUnit(button.dataset.unitId);
  });

  refs.configAttributesList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="deactivate-attribute"]');
    if (!button) {
      return;
    }
    void deactivateAdminProductAttribute(button.dataset.attributeId);
  });

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
    if (isCashPaymentMethod(state.paymentMethod)) {
      state.moneyInput = String(getCartTotal());
      state.paymentReceivedMethod = "Efectivo";
    } else if (isCreditPaymentMethod(state.paymentMethod)) {
      state.moneyInput = "0";
      state.paymentReceivedMethod = normalizeReceivedPaymentMethod(
        state.paymentReceivedMethod,
        "Efectivo",
      );
    } else {
      state.moneyInput = String(getCartTotal());
      state.paymentReceivedMethod = state.paymentMethod;
    }
    updatePaymentView();
    if (requiresPaymentCustomer(state.paymentMethod)) {
      refs.paymentCustomerInput?.focus();
      refs.paymentCustomerInput?.select?.();
    }
  });
  refs.paymentCustomerInput?.addEventListener("input", () => {
    state.paymentCustomerName = refs.paymentCustomerInput.value;
    updatePaymentView();
  });
  refs.paymentReceivedMethodInput?.addEventListener("change", () => {
    state.paymentReceivedMethod = normalizeReceivedPaymentMethod(
      refs.paymentReceivedMethodInput.value,
      "Efectivo",
    );
    updatePaymentView();
  });
  refs.paymentNoteInput?.addEventListener("input", () => {
    state.paymentNote = refs.paymentNoteInput.value;
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
  $("payment-shortcuts").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    if (button.dataset.action === "exact-money") {
      setMoneyToExactTotal();
      return;
    }

    if (!button.dataset.amount) {
      return;
    }

    addMoneyShortcut(Number(button.dataset.amount));
  });

  if (refs.inventoryBodyWrapper) {
    refs.inventoryBodyWrapper.addEventListener("click", (event) => {
      const saveButton = event.target.closest('[data-action="save-product"]');
      if (saveButton) {
        const record = saveButton.closest("[data-inventory-record], tr");
        if (record) {
          // Detectar si es modo comparación (tiene data-branch)
          const branch = record.dataset.branch;
          saveInventoryRow(record, branch);
        }
        return;
      }
      const removeButton = event.target.closest('[data-action="remove-product"]');
      if (removeButton) {
        removeAdminProduct(removeButton.closest("[data-inventory-record], tr"));
      }
    });
  }

  // Keyboard shortcuts globales
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void openOwnerEntryPoint();
      return;
    }

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
      closeOwnerAuthModal();
      closeOwnerConsoleModal();
      closeAdminEditor();
    }
  });

  // Conexión y eventos
  registerConnectionEvents();
  registerServiceWorker();

  // Intentar cargar desde servidor con reintentos acotados
  let bootstrapLoaded = false;

  if (!state.online && cachedSnapshot) {
    bootstrapLoaded = true;
    refs.socketStatus.textContent = "Sin conexion";
    showToast("Trabajando con el ultimo estado guardado localmente.", "info");
  }

  if (!bootstrapLoaded) {
    if (isAdminRuntime && !state.admin.authenticated) {
      bootstrapLoaded = true;
    } else {
      try {
        const snapshotHeaders = isAdminRuntime
          ? getAdminAuthHeaders()
          : {
              ...getCashierAuthHeaders(state.cashier.token || ""),
              ...getAdminAuthHeaders(),
              ...getOwnerAuthHeaders(),
            };
        const snapshotUrl = isAdminRuntime
          ? `/api/admin/bootstrap?branch=${encodeURIComponent(getAdminBranch())}&includeInactiveInventory=1`
          : `/api/bootstrap?branch=${encodeURIComponent(getActiveCashierBranch())}`;
        const snapshot = await performJsonRequest(
          snapshotUrl,
          {
            headers: snapshotHeaders,
            timeout: 15000,
            retries: 2,
          }
        );
        if (isAdminRuntime) {
          applyAdminSnapshot(snapshot);
          state.admin.capabilitiesResolved = Array.isArray(snapshot.adminCapabilities);
        } else {
          applySnapshot(snapshot, { syncAuthState: true });
        }
        bootstrapLoaded = true;

        if (refs.socketStatus.textContent === "Sin conexion") {
          refs.socketStatus.textContent = "Conectado";
        }
      } catch (error) {
        // Si no hay snapshot cacheado, mostrar error
        if (!cachedSnapshot || isAdminRuntime) {
          throw error;
        } else {
          // Con snapshot cacheado, apenas mostrar aviso
          refs.socketStatus.textContent = "Sin conexion";
          showToast("Trabajando con el ultimo estado guardado localmente.", "info");
        }
      }
    }
  }

  // Inicializar socket y sincronización
  connectSocket();
  if (!isAdminRuntime) {
    updatePaymentView();
    window.addEventListener("popstate", () => {
      void syncApprovalsMobileViewFromLocation({ autoOpenAuth: false, silent: true });
    });
    await syncApprovalsMobileViewFromLocation({ silent: true });
    if (state.cashier.authenticated) {
      void Promise.allSettled([
        loadRegisterSummary({ silent: true }),
        loadMyMerchandiseRequests({ silent: true }),
      ]);
    } else {
      state.register.summary = getEmptyRegisterSummary();
      renderRegisterSummaryPill();
      renderCashierSession();
    }
  
  // Iniciar sincronización si hay pendientes de ventas o caja
    if (state.pendingQueue.length > 0 || state.register.events.length > 0) {
      syncAllOfflineData().catch(() => {});
    }
  }
  
  if (refs.openAdminButton) {
    refs.openAdminButton.disabled = false;
    refs.openAdminButton.style.opacity = "1";
  }

  if (isAdministrationRoute()) {
    applyAdministrationRouteShell();
    await openAdminModal();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyAdministrationRouteShell();
  bootstrap().catch((error) => {
    console.error(error);
    showToast("No fue posible cargar el panel inicial.", "error");
  });
});
