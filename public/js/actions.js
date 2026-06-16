function requireCashierSession(message = "Inicia sesion de cajero para continuar.") {
  if (state.cashier.authenticated) {
    return true;
  }

  showToast(message, "info");
  openCashierAuthModal();
  return false;
}

let adminWorkspaceRefreshPromise = null;
let pendingAdminWorkspaceOptions = null;
const ADMIN_WORKSPACE_TTLS_MS = {
  snapshot: 5000,
  editorData: 8000,
  auditLogs: 60000,
  branches: 60000,
  cashiers: 60000,
  requests: 10000,
  config: 300000,
  weightedAudit: 15000,
};
const ADMIN_WORKSPACE_SECTION_KEYS = [
  "snapshot",
  "editorData",
  "auditLogs",
  "branches",
  "cashiers",
  "requests",
  "config",
  "weightedAudit",
];

function getAdminWorkspaceProfile(profile = "full") {
  if (profile === "live") {
    return {
      snapshot: true,
      editorData: true,
      auditLogs: false,
      branches: false,
      cashiers: false,
      requests: true,
      config: false,
      weightedAudit: false,
    };
  }

  return {
    snapshot: true,
    editorData: true,
    auditLogs: true,
    branches: true,
    cashiers: true,
    requests: true,
    config: true,
    weightedAudit: true,
  };
}

function getAdminWorkspaceFullOptions(branch = getAdminBranch(), force = true) {
  return {
    profile: "full",
    branch,
    force: Boolean(force),
  };
}

function getAdminWorkspaceLiveOptions(branch = getAdminBranch()) {
  return {
    profile: "live",
    branch,
  };
}

function markAdminWorkspaceLoaded(sectionKey) {
  if (!state.admin.workspaceLoadedAt) {
    state.admin.workspaceLoadedAt = {};
  }
  state.admin.workspaceLoadedAt[sectionKey] = Date.now();
}

function resetAdminSensitiveWorkspaceData() {
  state.admin.snapshot = null;
  state.admin.inventoryProducts = [];
  state.admin.inventoryComparison = null;
  state.admin.metrics = null;
  state.admin.backupsStatus = null;
  state.admin.auditLogs = [];
  state.admin.cashiers = [];
  state.admin.branches = [];
  state.admin.merchandiseRequests = [];
  state.admin.editorData.sales = [];
  state.admin.editorData.registerEvents = [];
  state.admin.editorData.inventoryMovements = [];
  state.admin.workspaceLoadedAt = {};
  state.admin.capabilitiesResolved = false;
  state.admin.metricsLoading = false;
  state.admin.configLoading = false;
  state.admin.weightedAudit.sessions = [];
  state.admin.weightedAudit.currentSession = null;
  state.admin.weightedAudit.loading = false;
  state.admin.weightedAudit.saving = false;
  state.admin.weightedAudit.draftItems = {};
  state.admin.weightedAudit.notesDraft = "";
}

function isAdminWorkspaceBlockedByOwner() {
  return Boolean(
    state.admin.authenticated
    && state.admin.capabilitiesResolved
    && Array.isArray(state.adminCapabilities)
    && state.adminCapabilities.length === 0
    && !state.owner.authenticated,
  );
}

function shouldRevalidateAdminCapabilities() {
  return Boolean(
    state.admin.authenticated
    && (
      !state.admin.capabilitiesResolved
      || (
        !state.owner.authenticated
        && Array.isArray(state.adminCapabilities)
        && state.adminCapabilities.length === 0
      )
    ),
  );
}

function normalizeSnapshotForAdminAccess(snapshot) {
  const sourceSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const adminAccessExplicitlyBlocked = Boolean(
    sourceSnapshot?.auth?.adminAuthenticated
    && sourceSnapshot?.auth?.permissions?.canViewAdmin === false
    && !sourceSnapshot?.auth?.ownerAuthenticated,
  );
  return {
    sourceSnapshot,
    adminAccessExplicitlyBlocked,
    effectiveSnapshot: adminAccessExplicitlyBlocked
      ? buildPublicSnapshotCacheView(sourceSnapshot)
      : sourceSnapshot,
  };
}

function shouldRefreshAdminWorkspaceSection(sectionKey, options) {
  if (options.force || options.ignoreFresh) {
    return true;
  }

  const ttlMs = ADMIN_WORKSPACE_TTLS_MS[sectionKey] || 0;
  const loadedAt = Number(state.admin.workspaceLoadedAt?.[sectionKey] || 0);
  if (!loadedAt) {
    return true;
  }

  return Date.now() - loadedAt > ttlMs;
}

function normalizeAdminWorkspaceOptions(options = {}) {
  const hasExplicitSections = ADMIN_WORKSPACE_SECTION_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(options, key),
  );
  const profile = String(options.profile || (hasExplicitSections ? "custom" : "full"));
  const profileDefaults = profile === "custom"
    ? {
        snapshot: false,
        editorData: false,
        auditLogs: false,
        branches: false,
        cashiers: false,
        requests: false,
        config: false,
        weightedAudit: false,
      }
    : getAdminWorkspaceProfile(profile);
  return {
    profile,
    branch: options.branch || getAdminBranch(),
    force: options.force === true,
    ignoreFresh: options.ignoreFresh === true,
    snapshot: options.snapshot === undefined ? profileDefaults.snapshot : options.snapshot !== false,
    editorData: options.editorData === undefined ? profileDefaults.editorData : options.editorData !== false,
    auditLogs: options.auditLogs === undefined ? profileDefaults.auditLogs : options.auditLogs !== false,
    branches: options.branches === undefined ? profileDefaults.branches : options.branches !== false,
    cashiers: options.cashiers === undefined ? profileDefaults.cashiers : options.cashiers !== false,
    requests: options.requests === undefined ? profileDefaults.requests : options.requests !== false,
    config: options.config === undefined ? profileDefaults.config : options.config !== false,
    weightedAudit: options.weightedAudit === undefined ? profileDefaults.weightedAudit : options.weightedAudit !== false,
  };
}

function mergeAdminWorkspaceOptions(baseOptions, nextOptions) {
  if (!baseOptions) {
    return normalizeAdminWorkspaceOptions(nextOptions);
  }

  const base = normalizeAdminWorkspaceOptions(baseOptions);
  const next = normalizeAdminWorkspaceOptions(nextOptions);
  return {
    profile: base.profile === "full" || next.profile === "full" ? "full" : next.profile,
    branch: next.branch || base.branch,
    force: base.force || next.force,
    ignoreFresh: base.ignoreFresh || next.ignoreFresh,
    snapshot: base.snapshot || next.snapshot,
    editorData: base.editorData || next.editorData,
    auditLogs: base.auditLogs || next.auditLogs,
    branches: base.branches || next.branches,
    cashiers: base.cashiers || next.cashiers,
    requests: base.requests || next.requests,
    config: base.config || next.config,
    weightedAudit: base.weightedAudit || next.weightedAudit,
  };
}

function getAdminWorkspaceTasks(options = {}) {
  const normalized = normalizeAdminWorkspaceOptions(options);
  const tasks = [];

  if (normalized.snapshot && shouldRefreshAdminWorkspaceSection("snapshot", normalized)) {
    tasks.push(loadAdminSnapshot(normalized.branch));
  }
  if (
    normalized.editorData
    && hasAdminCapability("quick_edit")
    && shouldRefreshAdminWorkspaceSection("editorData", normalized)
  ) {
    tasks.push(loadAdminEditorData(normalized.branch));
  }
  if (
    normalized.auditLogs
    && hasAdminCapability("audit_log")
    && shouldRefreshAdminWorkspaceSection("auditLogs", normalized)
  ) {
    tasks.push(loadAdminAuditLogs(normalized.branch));
  }
  if (
    normalized.branches
    && hasAdminCapability("branches")
    && shouldRefreshAdminWorkspaceSection("branches", normalized)
  ) {
    tasks.push(loadAdminBranches());
  }
  if (
    normalized.cashiers
    && hasAdminCapability("cashiers")
    && shouldRefreshAdminWorkspaceSection("cashiers", normalized)
  ) {
    tasks.push(loadAdminCashiers(normalized.branch));
  }
  if (
    normalized.requests
    && hasEnabledModule("merchandise_requests")
    && hasAdminCapability("merchandise_requests")
    && shouldRefreshAdminWorkspaceSection("requests", normalized)
  ) {
    tasks.push(loadAdminMerchandiseRequests(normalized.branch));
  }
  if (
    normalized.config
    && hasAdminCapability("business_config")
    && shouldRefreshAdminWorkspaceSection("config", normalized)
  ) {
    tasks.push(loadAdminConfig());
  }
  if (
    normalized.weightedAudit
    && hasEnabledModule("weighted_audit")
    && hasAdminCapability("weighted_audit")
    && shouldRefreshAdminWorkspaceSection("weightedAudit", normalized)
  ) {
    tasks.push(loadAdminWeightedAuditSessions(normalized.branch));
  }

  return tasks;
}

function applyBusinessBranding() {
  const profile = getStoreProfile();
  const businessName = getStoreName();
  const shortName = profile.shortName || businessName || "POS";
  const eyebrow = getVisibleText("eyebrow", "Centro de control comercial");
  const heroCopy = getVisibleText(
    "heroCopy",
    "Caja rapida, inventario vivo y seguimiento inmediato de cada venta.",
  );
  const logoPath = profile.branding?.logo192 || profile.branding?.logo || "";
  const iconPath = profile.branding?.logo192 || profile.branding?.logo || "/assets/branding/retail-base-badge.svg";

  document.title = `${businessName} | Punto de Venta`;

  if (refs.storeTitle) {
    refs.storeTitle.textContent = businessName;
  }
  if (refs.storeEyebrow) {
    refs.storeEyebrow.textContent = eyebrow;
  }
  if (refs.storeHeroCopy) {
    refs.storeHeroCopy.textContent = heroCopy;
  }
  if (refs.storeLogo) {
    if (logoPath) {
      refs.storeLogo.hidden = false;
      refs.storeLogo.src = logoPath;
      refs.storeLogo.alt = `Logo de ${businessName}`;
    } else {
      refs.storeLogo.hidden = true;
      refs.storeLogo.removeAttribute("src");
    }
  }
  if (refs.storeLogoFallback) {
    refs.storeLogoFallback.hidden = Boolean(logoPath);
    refs.storeLogoFallback.textContent = String(shortName || "POS").slice(0, 3).toUpperCase();
  }
  if (refs.storeFavicon) {
    refs.storeFavicon.href = iconPath;
  }
  if (refs.storeAppleTouchIcon) {
    refs.storeAppleTouchIcon.href = iconPath;
  }
}

function syncAuthStateFromSnapshot(snapshotAuth) {
  if (!snapshotAuth || typeof snapshotAuth !== "object") {
    return;
  }

  const adminAuthenticated = Boolean(snapshotAuth.adminAuthenticated);
  const ownerAuthenticated = Boolean(snapshotAuth.ownerAuthenticated);
  const cashierAuthenticated = Boolean(snapshotAuth.cashierAuthenticated);

  state.admin.authenticated = adminAuthenticated;
  state.admin.username = adminAuthenticated
    ? String(snapshotAuth.admin?.username || state.admin.username || "admin")
    : String(state.admin.username || "admin");
  state.admin.sessionExpiresAt = adminAuthenticated
    ? snapshotAuth.admin?.sessionExpiresAt || state.admin.sessionExpiresAt || null
    : null;
  if (!adminAuthenticated) {
    state.admin.csrfToken = "";
    if (typeof closeAdminModal === "function") {
      closeAdminModal();
    }
  }

  state.owner.authenticated = ownerAuthenticated;
  state.owner.username = ownerAuthenticated
    ? String(snapshotAuth.owner?.username || state.owner.username || "owner")
    : String(state.owner.username || "owner");
  state.owner.sessionExpiresAt = ownerAuthenticated
    ? snapshotAuth.owner?.sessionExpiresAt || state.owner.sessionExpiresAt || null
    : null;
  if (!ownerAuthenticated) {
    state.owner.csrfToken = "";
    state.owner.accessLoaded = false;
    if (typeof closeOwnerConsoleModal === "function") {
      closeOwnerConsoleModal();
    }
    if (typeof closeOwnerAuthModal === "function") {
      closeOwnerAuthModal();
    }
  }
  if (!adminAuthenticated && !ownerAuthenticated) {
    state.admin.capabilitiesResolved = false;
  }

  if (cashierAuthenticated) {
    state.cashier.id = Number(snapshotAuth.cashier?.id || 0) || state.cashier.id || null;
    state.cashier.name = String(snapshotAuth.cashier?.name || state.cashier.name || "");
    state.cashier.branch = String(snapshotAuth.cashier?.branch || state.cashier.branch || "");
    state.cashier.authenticated = Boolean(
      state.cashier.token
      && state.cashier.name
      && state.cashier.branch,
    );
  } else if (typeof clearCashierSessionState === "function") {
    clearCashierSessionState();
  } else {
    state.cashier.id = null;
    state.cashier.token = "";
    state.cashier.name = "";
    state.cashier.branch = "";
    state.cashier.authenticated = false;
    if (typeof persistCashierSession === "function") {
      persistCashierSession();
    }
  }
}

function applySnapshot(snapshot, options = {}) {
  const renderStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const previousCategories = JSON.stringify((state.categories || []).map((category) => [category.id, category.code]));
  const previousUnits = JSON.stringify((state.units || []).map((unit) => [unit.id, unit.code, unit.step]));
  const previousAttributes = JSON.stringify((state.productAttributeDefinitions || []).map((definition) => [definition.id, definition.key]));
  const {
    sourceSnapshot,
    adminAccessExplicitlyBlocked: snapshotAdminAccessExplicitlyBlocked,
    effectiveSnapshot,
  } = normalizeSnapshotForAdminAccess(snapshot);
  if (options.syncAuthState === true) {
    syncAuthStateFromSnapshot(sourceSnapshot?.auth);
  }
  const snapshotAdminCapabilities = Array.isArray(sourceSnapshot.adminCapabilities)
    ? sourceSnapshot.adminCapabilities
    : null;
  const snapshotAdminAccessAllowed = sourceSnapshot?.auth?.permissions?.canViewAdmin === true;
  const snapshotKeepsPrivilegedAccess = Boolean(
    sourceSnapshot?.auth?.ownerAuthenticated
      || sourceSnapshot?.auth?.role === "owner"
      || snapshotAdminAccessAllowed
  );
  state.store = effectiveSnapshot.store || state.store;
  state.profile = effectiveSnapshot.profile || state.profile;
  state.enabledModules = Array.isArray(effectiveSnapshot.enabledModules) ? effectiveSnapshot.enabledModules : state.enabledModules;
  if (snapshotAdminCapabilities) {
    state.admin.capabilitiesResolved = Boolean(
      sourceSnapshot?.auth?.adminAuthenticated || sourceSnapshot?.auth?.ownerAuthenticated,
    );
  }
  if (
    snapshotAdminCapabilities
    && (
      snapshotAdminCapabilities.length > 0
      || (!state.admin.authenticated && !state.owner.authenticated)
      || snapshotKeepsPrivilegedAccess
      || snapshotAdminAccessExplicitlyBlocked
    )
  ) {
    state.adminCapabilities = snapshotAdminCapabilities;
  }
  state.categories = Array.isArray(effectiveSnapshot.categories) ? effectiveSnapshot.categories : state.categories;
  state.units = Array.isArray(effectiveSnapshot.units) ? effectiveSnapshot.units : state.units;
  state.productAttributeDefinitions = Array.isArray(effectiveSnapshot.productAttributeDefinitions)
    ? effectiveSnapshot.productAttributeDefinitions
    : state.productAttributeDefinitions;
  state.products = Array.isArray(effectiveSnapshot.products) ? effectiveSnapshot.products : [];
  state.lowStock = Array.isArray(effectiveSnapshot.lowStock) ? effectiveSnapshot.lowStock : [];
  state.recentSales = Array.isArray(effectiveSnapshot.recentSales) ? effectiveSnapshot.recentSales : [];
  state.recentActivity = Array.isArray(effectiveSnapshot.recentActivity) ? effectiveSnapshot.recentActivity : [];
  state.salesByHour = Array.isArray(effectiveSnapshot.salesByHour) ? effectiveSnapshot.salesByHour : [];
  state.shiftSummary = Array.isArray(effectiveSnapshot.shiftSummary) ? effectiveSnapshot.shiftSummary : [];
  state.summary = effectiveSnapshot.summary || state.summary;
  if (snapshotAdminAccessExplicitlyBlocked) {
    state.admin.snapshot = effectiveSnapshot;
    state.admin.inventoryProducts = Array.isArray(effectiveSnapshot.inventoryProducts)
      ? effectiveSnapshot.inventoryProducts
      : [];
    state.admin.inventoryComparison = effectiveSnapshot.inventoryComparison || null;
    state.admin.metrics = null;
    state.admin.backupsStatus = null;
    state.admin.auditLogs = [];
    state.admin.cashiers = [];
    state.admin.branches = [];
    state.admin.merchandiseRequests = [];
    state.admin.editorData.sales = [];
    state.admin.editorData.registerEvents = [];
    state.admin.editorData.inventoryMovements = [];
    state.admin.weightedAudit.sessions = [];
    state.admin.weightedAudit.currentSession = null;
    state.admin.weightedAudit.draftItems = {};
    state.admin.weightedAudit.notesDraft = "";
    if (typeof closeAdminModal === "function") {
      closeAdminModal();
    }
  }
  state.admin.editorData.sales = state.recentSales.slice(0, 16);
  if (
    state.selectedCategory !== "all"
    && !state.categories.some((category) => category.code === state.selectedCategory)
  ) {
    state.selectedCategory = "all";
  }
  applyBusinessBranding();
  updateModuleVisibility();
  if (typeof syncCashierBranchOptions === "function") {
    syncCashierBranchOptions();
  }
  const catalogsChanged =
    previousCategories !== JSON.stringify((state.categories || []).map((category) => [category.id, category.code]))
    || previousUnits !== JSON.stringify((state.units || []).map((unit) => [unit.id, unit.code, unit.step]))
    || previousAttributes !== JSON.stringify((state.productAttributeDefinitions || []).map((definition) => [definition.id, definition.key]));
  if (catalogsChanged && typeof syncAdminProductCatalogs === "function") {
    syncAdminProductCatalogs();
  }
  syncQuickImportItemsFromProducts();
  syncMerchandiseRequestProductsFromSnapshot();
  if (!options.skipPersist) {
    saveSnapshot(buildPersistedSnapshot(), {
      persistPreparedSnapshot: options.persistPreparedSnapshot !== false,
    });
  }
  renderSummary();
  renderCashierSession();
  renderCategoryFilters();
  requestProductsRender();
  renderLowStock();
  renderRecentSales();
  renderRecentActivity();
  renderTrendChart();
  renderShiftSummary();
  if (refs.adminModal?.classList.contains("open") && state.admin.inventoryExpanded) {
    renderInventory();
  }
  renderQuickImportModal();
  renderSyncStatus();
  state.performance.snapshotRenderMs = roundMetric(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
  );
  if (refs.adminModal?.classList.contains("open")) {
    renderAdminModal();
    renderAdminRecordLists();
  }
}

function applyPublicSnapshot(sourceSnapshot = buildPersistedSnapshot(), options = {}) {
  const publicSnapshot = buildPublicSnapshotCacheView(sourceSnapshot);
  applySnapshot(publicSnapshot, {
    ...options,
    persistPreparedSnapshot: false,
  });
  return publicSnapshot;
}

function sanitizeAfterCashierSessionLoss(sourceSnapshot = buildPersistedSnapshot(), options = {}) {
  if (state.admin.authenticated || state.owner.authenticated) {
    return false;
  }

  applyPublicSnapshot(sourceSnapshot, options);
  return true;
}

function clearClientBusinessResetState(options = {}) {
  if (typeof clearCartForSessionChange === "function") {
    clearCartForSessionChange();
  } else if (Array.isArray(state.cart) && state.cart.length > 0) {
    state.cart = [];
    if (typeof saveCart === "function") {
      saveCart();
    }
  }

  if (typeof clearCashierSessionState === "function") {
    clearCashierSessionState();
  } else {
    state.cashier.id = null;
    state.cashier.token = "";
    state.cashier.name = "";
    state.cashier.branch = "";
    state.cashier.authenticated = false;
    if (typeof persistCashierSession === "function") {
      persistCashierSession();
    }
  }

  state.pendingQueue = [];
  state.offlineSales = [];
  state.offlineReceivablePayments = [];
  state.receivablesCache = { branches: {} };
  state.register.events = [];
  state.syncingQueue = false;

  if (typeof saveQueue === "function") {
    saveQueue();
  }
  if (typeof saveOfflineSales === "function") {
    saveOfflineSales();
  }
  if (typeof saveOfflineReceivablePayments === "function") {
    saveOfflineReceivablePayments();
  }
  if (typeof saveReceivablesCache === "function") {
    saveReceivablesCache();
  }
  if (typeof saveRegisterEvents === "function") {
    saveRegisterEvents();
  }
  if (typeof clearReceivablesSessionChange === "function") {
    clearReceivablesSessionChange();
  }
  if (typeof persistJson === "function" && typeof STORAGE_KEYS === "object") {
    if (options.clearSnapshot === true) {
      persistJson(STORAGE_KEYS.snapshot, null);
    }
    persistJson(STORAGE_KEYS.preparedSnapshots, {});
    persistJson(STORAGE_KEYS.receivablesCache, { branches: {} });
    persistJson(STORAGE_KEYS.cashierOfflineProfiles, []);
  }
  if (typeof renderSyncStatus === "function") {
    renderSyncStatus();
  }
}

function normalizeBranchCodeForClientReset(branchCode) {
  return String(branchCode || "").trim().toLowerCase();
}

function getQueuedOperationBranchForClientReset(operation = {}) {
  if (operation?.branch) {
    return normalizeBranchCodeForClientReset(operation.branch);
  }

  try {
    const payload = JSON.parse(operation?.body || "{}");
    return normalizeBranchCodeForClientReset(payload?.branch);
  } catch (_error) {
    return "";
  }
}

function clearAffectedBranchOperationalState(branches = []) {
  const affectedBranches = new Set(
    (Array.isArray(branches) ? branches : [])
      .map((branch) => normalizeBranchCodeForClientReset(branch))
      .filter(Boolean),
  );
  if (affectedBranches.size === 0) {
    return false;
  }

  const activeCashierBranch = normalizeBranchCodeForClientReset(state.cashier.branch);
  if (activeCashierBranch && affectedBranches.has(activeCashierBranch)) {
    if (typeof clearCartForSessionChange === "function") {
      clearCartForSessionChange();
    } else if (Array.isArray(state.cart) && state.cart.length > 0) {
      state.cart = [];
      if (typeof saveCart === "function") {
        saveCart();
      }
    }
    state.register.summary = getEmptyRegisterSummary();
    if (typeof renderRegisterSummaryPill === "function") {
      renderRegisterSummaryPill();
    }
  }

  state.pendingQueue = state.pendingQueue.filter((operation) => {
    const branch = getQueuedOperationBranchForClientReset(operation);
    return !branch || !affectedBranches.has(branch);
  });
  state.offlineSales = state.offlineSales.filter((record) =>
    !affectedBranches.has(normalizeBranchCodeForClientReset(record?.branch)),
  );
  state.offlineReceivablePayments = state.offlineReceivablePayments.filter((record) =>
    !affectedBranches.has(normalizeBranchCodeForClientReset(record?.branch)),
  );
  state.register.events = state.register.events.filter((event) =>
    !affectedBranches.has(normalizeBranchCodeForClientReset(event?.branch)),
  );

  if (typeof saveQueue === "function") {
    saveQueue();
  }
  if (typeof saveOfflineSales === "function") {
    saveOfflineSales();
  }
  if (typeof saveOfflineReceivablePayments === "function") {
    saveOfflineReceivablePayments();
  }
  if (typeof saveRegisterEvents === "function") {
    saveRegisterEvents();
  }
  if (typeof persistJson === "function" && typeof STORAGE_KEYS === "object") {
    const currentPreparedSnapshots = readStorageJson(STORAGE_KEYS.preparedSnapshots, {});
    const nextPreparedSnapshots = Object.fromEntries(
      Object.entries(currentPreparedSnapshots && typeof currentPreparedSnapshots === "object"
        ? currentPreparedSnapshots
        : {}
      ).filter(([branchCode]) => !affectedBranches.has(normalizeBranchCodeForClientReset(branchCode))),
    );
    const currentReceivablesCache = readStorageJson(STORAGE_KEYS.receivablesCache, { branches: {} });
    const currentReceivablesBranches =
      currentReceivablesCache?.branches && typeof currentReceivablesCache.branches === "object"
        ? currentReceivablesCache.branches
        : {};
    const nextReceivablesBranches = Object.fromEntries(
      Object.entries(currentReceivablesBranches).filter(
        ([branchCode]) => !affectedBranches.has(normalizeBranchCodeForClientReset(branchCode)),
      ),
    );
    persistJson(STORAGE_KEYS.preparedSnapshots, nextPreparedSnapshots);
    persistJson(STORAGE_KEYS.receivablesCache, { branches: nextReceivablesBranches });
    persistJson(STORAGE_KEYS.snapshot, null);
  }
  const currentReceivablesBranches =
    state.receivablesCache?.branches && typeof state.receivablesCache.branches === "object"
      ? state.receivablesCache.branches
      : {};
  state.receivablesCache = {
    branches: Object.fromEntries(
      Object.entries(currentReceivablesBranches).filter(
        ([branchCode]) => !affectedBranches.has(normalizeBranchCodeForClientReset(branchCode)),
      ),
    ),
  };
  if (typeof clearReceivablesSessionChange === "function" && activeCashierBranch && affectedBranches.has(activeCashierBranch)) {
    clearReceivablesSessionChange();
  }
  if (typeof renderSyncStatus === "function") {
    renderSyncStatus();
  }

  return true;
}

function prepareForFullDatabaseInstallReload() {
  clearClientBusinessResetState({ clearSnapshot: true });
  state.admin.authenticated = false;
  state.admin.csrfToken = "";
  state.admin.sessionExpiresAt = null;
  state.admin.setupAllowed = false;
  state.admin.username = String(state.admin.username || "admin");
  resetAdminSensitiveWorkspaceData();
  state.owner.authenticated = false;
  state.owner.csrfToken = "";
  state.owner.sessionExpiresAt = null;
  state.owner.setupAllowed = false;
  state.owner.accessLoaded = false;
  state.adminCapabilities = [];
  if (typeof closeAdminModal === "function") {
    closeAdminModal();
  }
  if (typeof closeOwnerConsoleModal === "function") {
    closeOwnerConsoleModal();
  }
  if (typeof closeOwnerAuthModal === "function") {
    closeOwnerAuthModal();
  }
  if (typeof updateModuleVisibility === "function") {
    updateModuleVisibility();
  }
}

function rebuildInventoryDerivedState() {
  state.products = state.products.map((product) => ({
    ...product,
    status: getStockStatus(product.stock, product.minStock, product.stockInitialized),
  }));
  state.lowStock = state.products
    .filter((product) => product.active && product.stockInitialized && product.stock <= product.minStock)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 8);
  state.summary.catalogSize = state.products.filter((product) => product.active).length;
  state.summary.inventoryValue = roundMoney(
    state.products
      .filter((product) => product.active)
      .reduce((sum, product) => sum + roundMoney(product.stock * product.price), 0),
  );
  state.summary.lowStockCount = state.products.filter(
    (product) => product.active && product.stockInitialized && product.stock <= product.minStock,
  ).length;
}

function applyOptimisticProductUpdate(productId, payload) {
  state.products = state.products.map((product) => {
    if (product.id !== productId) {
      return product;
    }

    const nextProduct = {
      ...product,
      price: payload.price ?? product.price,
      stock: payload.stock ?? product.stock,
      minStock: payload.minStock ?? product.minStock,
      active: payload.active ?? product.active,
      stockInitialized: true,
    };

    nextProduct.status = getStockStatus(
      nextProduct.stock,
      nextProduct.minStock,
      nextProduct.stockInitialized,
    );
    return nextProduct;
  });

  rebuildInventoryDerivedState();
  saveSnapshot(buildPersistedSnapshot());
  renderSummary();
  requestProductsRender();
  renderLowStock();
  if (refs.adminModal?.classList.contains("open") && state.admin.inventoryExpanded) {
    renderInventory();
  }
}

function applyOptimisticSale(payload) {
  const total = roundMoney(
    payload.items.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0),
  );
  const itemCount = roundStock(
    payload.items.reduce((sum, item) => sum + roundStock(item.quantity), 0),
  );
  const receivedAmount = roundMoney(payload.receivedAmount || 0);
  const paymentMethod = payload.paymentMethod || "Efectivo";
  const receivedPaymentMethod = getSaleReceivedPaymentMethod(
    paymentMethod,
    payload.receivedPaymentMethod || "",
    receivedAmount,
  );
  const pendingAmount = getSalePendingAmount(total, receivedAmount, paymentMethod);

  payload.items.forEach((item) => {
    state.products = state.products.map((product) => {
      if (product.id !== item.productId) {
        return product;
      }

      const nextStock = roundStock(product.stock - roundStock(item.quantity));
      return {
        ...product,
        stock: nextStock,
        stockInitialized: true,
        status: getStockStatus(nextStock, product.minStock, true),
      };
    });
  });

  const tempSale = {
    id: `offline-${Date.now()}`,
    ticketNumber: `OFF-${Date.now().toString().slice(-6)}`,
    clientSaleId: payload.clientSaleId || "",
    shift: payload.shift,
    cashier: payload.cashier,
    branch: payload.branch,
    paymentMethod,
    customerName: payload.customerName || "",
    subtotal: total,
    total,
    itemCount,
    notes: payload.notes || "",
    receivedAmount,
    receivedPaymentMethod,
    pendingAmount,
    changeAmount:
      paymentMethod === "Efectivo"
        ? roundMoney(receivedAmount - total)
        : 0,
    createdAt: new Date().toISOString(),
    items: payload.items.map((item) => ({
      productName: item.productName || "Producto",
      quantity: roundStock(item.quantity),
      unitPrice: roundMoney(item.unitPrice),
      lineTotal: roundMoney(item.lineTotal),
    })),
  };
  tempSale.itemsSummary = tempSale.items
    .map((item) => `${item.productName} x${formatQuantity(item.quantity)}`)
    .join(" · ");

  state.recentSales = [tempSale, ...state.recentSales].slice(0, 8);
  state.recentActivity = [
    {
      kind: "sale",
      id: tempSale.id,
      createdAt: tempSale.createdAt,
      title: tempSale.ticketNumber,
      subtitle: `${tempSale.cashier} · ${tempSale.shift}`,
      amount: tempSale.total,
      amountPrefix: "",
      tag: "Venta",
    },
    ...state.recentActivity,
  ].slice(0, 18);
  state.summary.revenueToday = roundMoney(state.summary.revenueToday + total);
  state.summary.ticketsToday += 1;
  state.summary.unitsSoldToday = roundStock(state.summary.unitsSoldToday + itemCount);
  state.summary.averageTicket = roundMoney(
    state.summary.revenueToday / Math.max(state.summary.ticketsToday, 1),
  );

  const currentHourLabel = getStoreHourLabel(new Date());
  state.salesByHour = state.salesByHour.map((slot) =>
    slot.label === currentHourLabel
      ? { ...slot, total: roundMoney(slot.total + total) }
      : slot,
  );
  state.shiftSummary = state.shiftSummary.map((item) =>
    item.shift === payload.shift
      ? {
          ...item,
          tickets: item.tickets + 1,
          total: roundMoney(item.total + total),
        }
      : item,
  );

  rebuildInventoryDerivedState();
  saveSnapshot(buildPersistedSnapshot());
  renderSummary();
  requestProductsRender();
  renderLowStock();
  renderRecentSales();
  renderRecentActivity();
  renderTrendChart();
  renderShiftSummary();
  if (refs.adminModal?.classList.contains("open") && state.admin.inventoryExpanded) {
    renderInventory();
  }
  return tempSale;
}

async function refreshCurrentSnapshot(branch = getActiveCashierBranch()) {
  const snapshotHeaders = {
    ...getCashierAuthHeaders(state.cashier.token || ""),
    ...getAdminAuthHeaders(),
    ...getOwnerAuthHeaders(),
  };
  const snapshot = await performJsonRequest(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}`,
    {
      headers: snapshotHeaders,
    },
  );
  applySnapshot(snapshot, { syncAuthState: true });
  return snapshot;
}

function syncAdminSharedState(snapshot) {
  const {
    effectiveSnapshot,
    adminAccessExplicitlyBlocked: snapshotAdminAccessExplicitlyBlocked,
  } = normalizeSnapshotForAdminAccess(snapshot);
  if (!effectiveSnapshot || typeof effectiveSnapshot !== "object") {
    return;
  }

  const previousCategories = JSON.stringify((state.categories || []).map((category) => [category.id, category.code]));
  const previousUnits = JSON.stringify((state.units || []).map((unit) => [unit.id, unit.code, unit.step]));
  const previousAttributes = JSON.stringify((state.productAttributeDefinitions || []).map((definition) => [definition.id, definition.key]));
  const snapshotAdminCapabilities = Array.isArray(effectiveSnapshot.adminCapabilities)
    ? effectiveSnapshot.adminCapabilities
    : null;
  const nextStore = effectiveSnapshot.store && typeof effectiveSnapshot.store === "object"
    ? {
        ...state.store,
        ...effectiveSnapshot.store,
      }
    : null;

  if (nextStore && effectiveSnapshot.store?.currentBranch === "all" && state.store?.currentBranch) {
    nextStore.currentBranch = state.store.currentBranch;
    nextStore.currentBranchLabel = state.store.currentBranchLabel || nextStore.currentBranchLabel;
  }

  if (nextStore) {
    state.store = nextStore;
  }
  state.profile = effectiveSnapshot.profile || state.profile;
  state.enabledModules = Array.isArray(effectiveSnapshot.enabledModules) ? effectiveSnapshot.enabledModules : state.enabledModules;
  if (snapshotAdminCapabilities) {
    state.adminCapabilities = snapshotAdminCapabilities;
  }
  state.categories = Array.isArray(effectiveSnapshot.categories) ? effectiveSnapshot.categories : state.categories;
  state.units = Array.isArray(effectiveSnapshot.units) ? effectiveSnapshot.units : state.units;
  state.productAttributeDefinitions = Array.isArray(effectiveSnapshot.productAttributeDefinitions)
    ? effectiveSnapshot.productAttributeDefinitions
    : state.productAttributeDefinitions;

  if (
    state.selectedCategory !== "all"
    && !state.categories.some((category) => category.code === state.selectedCategory)
  ) {
    state.selectedCategory = "all";
  }

  applyBusinessBranding();
  updateModuleVisibility();
  if (typeof syncCashierBranchOptions === "function") {
    syncCashierBranchOptions();
  }
  if (typeof renderCategoryFilters === "function") {
    renderCategoryFilters();
  }

  const catalogsChanged =
    previousCategories !== JSON.stringify((state.categories || []).map((category) => [category.id, category.code]))
    || previousUnits !== JSON.stringify((state.units || []).map((unit) => [unit.id, unit.code, unit.step]))
    || previousAttributes !== JSON.stringify((state.productAttributeDefinitions || []).map((definition) => [definition.id, definition.key]));
  if (catalogsChanged && typeof syncAdminProductCatalogs === "function") {
    syncAdminProductCatalogs();
  }
  if (snapshotAdminAccessExplicitlyBlocked) {
    state.admin.metrics = null;
    state.admin.backupsStatus = null;
    state.admin.auditLogs = [];
    state.admin.cashiers = [];
    state.admin.branches = [];
    state.admin.merchandiseRequests = [];
    state.admin.editorData.sales = [];
    state.admin.editorData.registerEvents = [];
    state.admin.editorData.inventoryMovements = [];
    state.admin.weightedAudit.sessions = [];
    state.admin.weightedAudit.currentSession = null;
    state.admin.weightedAudit.draftItems = {};
    state.admin.weightedAudit.notesDraft = "";
  }
}

function applyAdminSnapshot(snapshot) {
  const { effectiveSnapshot } = normalizeSnapshotForAdminAccess(snapshot);
  syncAdminSharedState(effectiveSnapshot);
  state.admin.snapshot = effectiveSnapshot || null;
  state.admin.inventoryProducts = Array.isArray(effectiveSnapshot?.inventoryProducts)
    ? effectiveSnapshot.inventoryProducts
    : Array.isArray(effectiveSnapshot?.products)
      ? effectiveSnapshot.products
      : [];
  state.admin.inventoryComparison = effectiveSnapshot?.inventoryComparison || null;
  if (effectiveSnapshot?.store?.currentBranch) {
    state.admin.branch = effectiveSnapshot.store.currentBranch;
  }
  renderAdminModal();
}

async function loadAdminSnapshot(branch = getAdminBranch()) {
  const snapshot = await requestAdminJson(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}&includeInactiveInventory=1`,
  );
  applyAdminSnapshot(snapshot);
  state.admin.capabilitiesResolved = Array.isArray(snapshot.adminCapabilities);
  markAdminWorkspaceLoaded("snapshot");
  return snapshot;
}

function getActiveAdminBranchOptions() {
  const activeBranches = (state.admin.branches || [])
    .filter((branch) => branch.active)
    .map((branch) => ({
      value: branch.code,
      label: branch.name,
    }));

  return activeBranches.length > 0
    ? activeBranches
    : getBranchOptions().filter((option) => option.value !== "all");
}

function syncCashierBranchOptions() {
  if (!refs.cashierAuthBranch) {
    return;
  }

  const activeOptions = getBranchOptions().filter((option) => option.value !== "all");
  const selectedValue = activeOptions.some((option) => option.value === refs.cashierAuthBranch.value)
    ? refs.cashierAuthBranch.value
    : state.cashier.branch || state.store.currentBranch || activeOptions[0]?.value || "";
  setSelectOptions(refs.cashierAuthBranch, activeOptions, selectedValue);
}

function syncAdminCashierBranchOptions() {
  if (!refs.adminCashierBranch) {
    return;
  }

  const activeOptions = getActiveAdminBranchOptions();
  const selectedValue = activeOptions.some((option) => option.value === refs.adminCashierBranch.value)
    ? refs.adminCashierBranch.value
    : activeOptions[0]?.value || "";
  setSelectOptions(refs.adminCashierBranch, activeOptions, selectedValue);
  syncCashierBranchOptions();
}

function resetAdminBranchForm(branch = null) {
  if (!refs.adminBranchCode || !refs.adminBranchName || !refs.adminBranchTimezone || !refs.adminBranchActive) {
    return;
  }

  refs.adminBranchCode.value = branch?.code || "";
  refs.adminBranchCode.disabled = Boolean(branch?.code);
  refs.adminBranchName.value = branch?.name || "";
  refs.adminBranchTimezone.value = branch?.timezone || state.store.timezone || "America/Mexico_City";
  refs.adminBranchActive.checked = branch ? Boolean(branch.active) : true;
  if (refs.saveAdminBranchButton) {
    refs.saveAdminBranchButton.dataset.branchCode = branch?.code || "";
    refs.saveAdminBranchButton.textContent = branch ? "Guardar cambios" : "Guardar sucursal";
  }
}

function openAdminBranchEditor(branchCode) {
  const branch = (state.admin.branches || []).find((item) => item.code === branchCode);
  if (!branch) {
    showToast("No pude encontrar esa sucursal.", "error");
    return;
  }

  resetAdminBranchForm(branch);
  refs.adminBranchName?.focus();
}

async function loadAdminBranches() {
  try {
    const response = await requestAdminJson("/api/admin/branches");
    state.admin.branches = Array.isArray(response.branches) ? response.branches : [];
    markAdminWorkspaceLoaded("branches");
  } catch (_error) {
    state.admin.branches = [];
  }

  syncAdminCashierBranchOptions();
  renderAdminBranches();
  return state.admin.branches;
}

async function loadAdminCashiers(branch = getAdminBranch()) {
  syncAdminCashierBranchOptions();
  const query =
    branch && branch !== "all" ? `?branch=${encodeURIComponent(branch)}` : "";
  try {
    const response = await requestAdminJson(`/api/admin/cashiers${query}`);
    state.admin.cashiers = Array.isArray(response.cashiers) ? response.cashiers : [];
    markAdminWorkspaceLoaded("cashiers");
  } catch (_error) {
    state.admin.cashiers = [];
  }
  renderAdminCashiers();
}

async function loadAdminEditorData(branch = getAdminBranch()) {
  try {
    const response = await requestAdminJson(
      `/api/admin/editor-data?branch=${encodeURIComponent(branch)}`,
    );
    state.admin.editorData = {
      sales: Array.isArray(response.sales) ? response.sales : [],
      registerEvents: Array.isArray(response.registerEvents) ? response.registerEvents : [],
      inventoryMovements: Array.isArray(response.inventoryMovements) ? response.inventoryMovements : [],
    };
    markAdminWorkspaceLoaded("editorData");
  } catch (_error) {
    state.admin.editorData = {
      sales: [],
      registerEvents: [],
      inventoryMovements: [],
    };
  } finally {
    renderAdminRecordLists();
  }
}

async function loadAdminAuditLogs(branch = getAdminBranch()) {
  try {
    const response = await requestAdminJson(
      `/api/admin/audit-log?branch=${encodeURIComponent(branch)}&limit=180`,
    );
    state.admin.auditLogs = Array.isArray(response.logs) ? response.logs : [];
    markAdminWorkspaceLoaded("auditLogs");
  } catch (_error) {
    state.admin.auditLogs = [];
  } finally {
    renderAdminRecordLists();
  }
}

async function loadAdminConfig() {
  state.admin.configLoading = true;
  try {
    const response = await requestAdminJson("/api/admin/settings");
    const settings = response.settings || {};
    state.profile = response.businessProfile || state.profile;
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.adminCapabilities = Array.isArray(response.adminCapabilities) ? response.adminCapabilities : state.adminCapabilities;
    state.admin.capabilitiesResolved = Array.isArray(response.adminCapabilities);
    state.categories = Array.isArray(response.categories)
      ? response.categories.filter((category) => category.active !== false)
      : state.categories;
    state.units = Array.isArray(response.units)
      ? response.units.filter((unit) => unit.active !== false)
      : state.units;
    state.productAttributeDefinitions = Array.isArray(response.productAttributeDefinitions)
      ? response.productAttributeDefinitions.filter((definition) => definition.active !== false)
      : state.productAttributeDefinitions;
    refs.configAllowNegativeStock.checked = settings["sales.allow_negative_stock"] === "true";
    applyBusinessBranding();
    updateModuleVisibility();
    renderCategoryFilters();
    if (typeof syncAdminProductCatalogs === "function") {
      syncAdminProductCatalogs();
    }
    if (typeof renderAdminConfigPanel === "function") {
      renderAdminConfigPanel();
    }
    markAdminWorkspaceLoaded("config");
  } catch (error) {
    if (error.statusCode !== 403) {
      showToast("Error al cargar configuraciones.", "error");
    }
  } finally {
    state.admin.configLoading = false;
  }
}

function resetWeightedAuditDraftState(session = null) {
  state.admin.weightedAudit.currentSession = session || null;
  state.admin.weightedAudit.notesDraft = session?.notes || "";
  state.admin.weightedAudit.draftItems = {};

  const items = Array.isArray(session?.items) ? session.items : [];
  items.forEach((item) => {
    state.admin.weightedAudit.draftItems[item.id] = {
      countedStock: item.countedStock == null ? "" : String(item.countedStock),
      reason: item.reason || "",
    };
  });
}

function setWeightedAuditCurrentSession(session = null) {
  resetWeightedAuditDraftState(session);
}

function getWeightedAuditDraftEntry(itemId) {
  return state.admin.weightedAudit.draftItems?.[Number(itemId)] || {};
}

function updateWeightedAuditNotesDraft(value) {
  state.admin.weightedAudit.notesDraft = String(value || "");
}

function updateWeightedAuditDraftField(itemId, field, value) {
  const safeItemId = Number(itemId);
  if (!Number.isInteger(safeItemId) || safeItemId <= 0) {
    return;
  }

  state.admin.weightedAudit.draftItems[safeItemId] = {
    ...getWeightedAuditDraftEntry(safeItemId),
    [field]: String(value ?? ""),
  };
}

function captureWeightedAuditDraftFromDom() {
  if (!refs.adminWeightedAuditItems) {
    return;
  }

  const nextDrafts = { ...(state.admin.weightedAudit.draftItems || {}) };
  refs.adminWeightedAuditItems.querySelectorAll("[data-weighted-item-row]").forEach((row) => {
    const itemId = Number(row.dataset.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return;
    }

    nextDrafts[itemId] = {
      countedStock: row.querySelector('[data-weighted-draft-field="countedStock"]')?.value ?? "",
      reason: row.querySelector('[data-weighted-draft-field="reason"]')?.value ?? "",
    };
  });

  const notesField = refs.adminWeightedAuditItems.querySelector("[data-weighted-session-notes]");
  if (notesField) {
    state.admin.weightedAudit.notesDraft = notesField.value;
  }

  state.admin.weightedAudit.draftItems = nextDrafts;
}

function getWeightedAuditStatusLabel(statusKey) {
  if (statusKey === "match") {
    return "Cuadra";
  }
  if (statusKey === "shortage") {
    return "Merma";
  }
  if (statusKey === "surplus") {
    return "Sobrante";
  }
  if (statusKey === "invalid") {
    return "Invalido";
  }
  return "Pendiente";
}

function getWeightedAuditPreviewItem(item) {
  const draft = getWeightedAuditDraftEntry(item.id);
  const rawCountedStock = draft.countedStock !== undefined
    ? String(draft.countedStock)
    : item.countedStock == null
      ? ""
      : String(item.countedStock);
  const safeRawCountedStock = rawCountedStock.trim();
  const reason = draft.reason !== undefined ? String(draft.reason || "") : String(item.reason || "");

  let countedStock = null;
  let difference = null;
  let statusKey = "pending";

  if (safeRawCountedStock !== "") {
    const parsedCountedStock = Number(safeRawCountedStock);
    if (Number.isFinite(parsedCountedStock) && parsedCountedStock >= 0) {
      countedStock = roundStock(parsedCountedStock);
      difference = roundStock(countedStock - roundStock(item.posStock));
      statusKey = difference < 0 ? "shortage" : difference > 0 ? "surplus" : "match";
    } else {
      countedStock = Number.NaN;
      statusKey = "invalid";
    }
  }

  const incident = Number.isFinite(difference) && difference !== 0;
  const reasonRequired = incident;
  const missingReason = reasonRequired && !reason.trim();

  return {
    ...item,
    rawCountedStock,
    countedStock,
    difference,
    reason,
    incident,
    reasonRequired,
    missingReason,
    statusKey,
    statusLabel: getWeightedAuditStatusLabel(statusKey),
  };
}

function getWeightedAuditStatusRank(statusKey) {
  if (statusKey === "pending") {
    return 0;
  }
  if (statusKey === "invalid") {
    return 1;
  }
  if (statusKey === "shortage" || statusKey === "surplus") {
    return 2;
  }
  return 3;
}

function getFilteredWeightedAuditItems(items = []) {
  const searchText = String(state.admin.weightedAudit.search || "").trim().toLowerCase();

  return items
    .map((item) => getWeightedAuditPreviewItem(item))
    .filter((item) => {
      if (searchText && !String(item.productName || "").toLowerCase().includes(searchText)) {
        return false;
      }

      if (state.admin.weightedAudit.showPendingOnly) {
        return item.statusKey === "pending" || item.statusKey === "invalid";
      }

      if (state.admin.weightedAudit.showIncidentsOnly) {
        return item.incident || item.missingReason;
      }

      return true;
    })
    .sort((left, right) => {
      const statusDelta = getWeightedAuditStatusRank(left.statusKey) - getWeightedAuditStatusRank(right.statusKey);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const differenceDelta = Math.abs(Number(right.difference || 0)) - Math.abs(Number(left.difference || 0));
      if (differenceDelta !== 0) {
        return differenceDelta;
      }

      return String(left.productName || "").localeCompare(String(right.productName || ""), "es");
    });
}

function buildWeightedAuditPreviewSummary(items = []) {
  return {
    totalItems: items.length,
    countedItems: items.filter((item) => Number.isFinite(item.countedStock)).length,
    pendingItems: items.filter((item) => !Number.isFinite(item.countedStock)).length,
    incidentItems: items.filter((item) => item.incident).length,
    shortageKg: roundStock(
      items
        .filter((item) => Number(item.difference) < 0)
        .reduce((sum, item) => sum + Math.abs(roundStock(item.difference)), 0),
    ),
    surplusKg: roundStock(
      items
        .filter((item) => Number(item.difference) > 0)
        .reduce((sum, item) => sum + roundStock(item.difference), 0),
    ),
    varianceValue: roundMoney(
      items.reduce(
        (sum, item) => sum + roundMoney((item.difference || 0) * roundMoney(item.unitPrice || 0)),
        0,
      ),
    ),
  };
}

function updateWeightedAuditFilters(partial = {}) {
  captureWeightedAuditDraftFromDom();
  state.admin.weightedAudit = {
    ...state.admin.weightedAudit,
    ...partial,
  };
  renderAdminWeightedAuditPanel();
}

function buildWeightedAuditPayloadItems(items = []) {
  return items
    .map((item) => {
      const preview = getWeightedAuditPreviewItem(item);
      return {
        itemId: item.id,
        productId: item.productId,
        countedStock: preview.rawCountedStock,
        reason: preview.reason || "",
      };
    })
    .filter((item) => String(item.countedStock || "").trim() !== "");
}

function fillVisibleWeightedAuditDraftsWithPos() {
  const session = state.admin.weightedAudit.currentSession;
  if (!session) {
    showToast("Abre una sesion de auditoria primero.", "info");
    return;
  }

  captureWeightedAuditDraftFromDom();
  getFilteredWeightedAuditItems(session.items || []).forEach((item) => {
    state.admin.weightedAudit.draftItems[item.id] = {
      ...getWeightedAuditDraftEntry(item.id),
      countedStock: String(roundStock(item.posStock)),
      reason: "",
    };
  });
  renderAdminWeightedAuditPanel();
}

function clearVisibleWeightedAuditDrafts() {
  const session = state.admin.weightedAudit.currentSession;
  if (!session) {
    showToast("No hay sesion de auditoria abierta.", "info");
    return;
  }

  captureWeightedAuditDraftFromDom();
  getFilteredWeightedAuditItems(session.items || []).forEach((item) => {
    state.admin.weightedAudit.draftItems[item.id] = {
      ...getWeightedAuditDraftEntry(item.id),
      countedStock: "",
      reason: "",
    };
  });
  renderAdminWeightedAuditPanel();
}

function applyWeightedAuditQuickAction(action, itemId) {
  const safeItemId = Number(itemId);
  if (!Number.isInteger(safeItemId) || safeItemId <= 0) {
    return;
  }

  captureWeightedAuditDraftFromDom();
  const sessionItem = state.admin.weightedAudit.currentSession?.items?.find((item) => item.id === safeItemId);
  if (!sessionItem) {
    return;
  }

  if (action === "set-pos") {
    state.admin.weightedAudit.draftItems[safeItemId] = {
      ...getWeightedAuditDraftEntry(safeItemId),
      countedStock: String(roundStock(sessionItem.posStock)),
      reason: "",
    };
  } else if (action === "set-zero") {
    state.admin.weightedAudit.draftItems[safeItemId] = {
      ...getWeightedAuditDraftEntry(safeItemId),
      countedStock: "0",
    };
  } else if (action === "clear-row") {
    state.admin.weightedAudit.draftItems[safeItemId] = {
      countedStock: "",
      reason: "",
    };
  }

  const row = refs.adminWeightedAuditItems?.querySelector(
    `[data-weighted-item-row][data-item-id="${safeItemId}"]`,
  );
  if (!row) {
    return;
  }

  const draft = getWeightedAuditDraftEntry(safeItemId);
  const countedField = row.querySelector('[data-weighted-draft-field="countedStock"]');
  const reasonField = row.querySelector('[data-weighted-draft-field="reason"]');
  if (countedField) {
    countedField.value = draft.countedStock || "";
  }
  if (reasonField && action !== "set-zero") {
    reasonField.value = draft.reason || "";
  }
  syncWeightedAuditRowPreview(row);
}

function syncWeightedAuditRowPreview(row) {
  const safeItemId = Number(row?.dataset?.itemId);
  if (!Number.isInteger(safeItemId) || safeItemId <= 0) {
    return;
  }

  const sessionItem = state.admin.weightedAudit.currentSession?.items?.find((item) => item.id === safeItemId);
  if (!sessionItem) {
    return;
  }

  const preview = getWeightedAuditPreviewItem(sessionItem);
  row.dataset.auditStatus = preview.statusKey;
  row.classList.toggle("weighted-audit-row-needs-reason", preview.missingReason);
  row.classList.toggle("weighted-audit-row-incident", preview.incident);

  const statusNode = row.querySelector('[data-role="weighted-status"]');
  if (statusNode) {
    statusNode.textContent = preview.statusLabel;
    statusNode.className = `small-pill weighted-audit-pill ${preview.statusKey}${preview.missingReason ? " needs-reason" : ""}`;
  }

  const differenceNode = row.querySelector('[data-role="weighted-difference"]');
  if (differenceNode) {
    const differenceText = preview.statusKey === "pending"
      ? "-"
      : preview.statusKey === "invalid"
        ? "Invalido"
        : `${preview.difference > 0 ? "+" : ""}${formatQuantity(preview.difference)}`;
    differenceNode.textContent = differenceText;
    differenceNode.className = `weighted-audit-difference ${preview.statusKey}`;
  }

  const helperNode = row.querySelector('[data-role="weighted-helper"]');
  if (helperNode) {
    let helperText = "Aun sin conteo.";
    if (preview.statusKey === "invalid") {
      helperText = "Captura un numero valido mayor o igual a 0.";
    } else if (preview.missingReason) {
      helperText = "Falta motivo para guardar la diferencia.";
    } else if (preview.incident) {
      helperText = preview.difference < 0
        ? `Faltan ${formatQuantity(Math.abs(preview.difference))} kg.`
        : `Sobran ${formatQuantity(preview.difference)} kg.`;
    } else if (preview.statusKey === "match") {
      helperText = "Cuadra con el stock del POS.";
    }
    helperNode.textContent = helperText;
  }

  const reasonField = row.querySelector('[data-weighted-draft-field="reason"]');
  if (reasonField) {
    reasonField.required = preview.reasonRequired;
    reasonField.placeholder = preview.reasonRequired
      ? "Motivo obligatorio si hay diferencia"
      : "Sin diferencia o nota opcional";
  }
}

function getAdminWeightedAuditFilters(branchOverride = getAdminBranch()) {
  const fallbackDate = toDateInputValue();
  const dateKey = String(
    refs.adminWeightedAuditDate?.value
      || state.admin.weightedAudit.dateKey
      || fallbackDate,
  ).trim();
  const shift = String(
    refs.adminWeightedAuditShift?.value
      || state.admin.weightedAudit.shift
      || refs.shiftSelect?.value
      || "Tarde",
  ).trim();

  state.admin.weightedAudit.dateKey = dateKey;
  state.admin.weightedAudit.shift = shift;
  if (refs.adminWeightedAuditDate && refs.adminWeightedAuditDate.value !== dateKey) {
    refs.adminWeightedAuditDate.value = dateKey;
  }
  if (refs.adminWeightedAuditShift && refs.adminWeightedAuditShift.value !== shift) {
    refs.adminWeightedAuditShift.value = shift;
  }

  return {
    branch: branchOverride || getAdminBranch(),
    dateKey,
    shift,
  };
}

async function loadAdminWeightedAuditSessions(branchOverride = getAdminBranch()) {
  const filters = getAdminWeightedAuditFilters(branchOverride);
  state.admin.weightedAudit.loading = true;
  renderAdminWeightedAuditPanel();

  try {
    const response = await requestAdminJson(
      `/api/admin/weighted-audit/sessions?branch=${encodeURIComponent(filters.branch)}&shift=${encodeURIComponent(filters.shift)}&dateKey=${encodeURIComponent(filters.dateKey)}&limit=60`,
    );
    state.admin.weightedAudit.sessions = Array.isArray(response.sessions) ? response.sessions : [];
    markAdminWorkspaceLoaded("weightedAudit");

    const currentId = state.admin.weightedAudit.currentSession?.id;
    if (currentId && !state.admin.weightedAudit.sessions.some((item) => item.id === currentId)) {
      setWeightedAuditCurrentSession(null);
    }

    if (!state.admin.weightedAudit.currentSession && state.admin.weightedAudit.sessions[0]) {
      await openAdminWeightedAuditSession(state.admin.weightedAudit.sessions[0].id);
    }
  } catch (_error) {
    state.admin.weightedAudit.sessions = [];
  } finally {
    state.admin.weightedAudit.loading = false;
    renderAdminWeightedAuditPanel();
  }
}

async function openAdminWeightedAuditSession(sessionId) {
  const id = Number(sessionId);
  if (!Number.isInteger(id) || id <= 0) {
    showToast("No pude identificar la sesion de auditoria.", "error");
    return;
  }

  state.admin.weightedAudit.loading = true;
  renderAdminWeightedAuditPanel();
  try {
    const response = await requestAdminJson(`/api/admin/weighted-audit/sessions/${id}`);
    setWeightedAuditCurrentSession(response.session || null);
    renderAdminWeightedAuditPanel();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.admin.weightedAudit.loading = false;
    renderAdminWeightedAuditPanel();
  }
}

async function createAdminWeightedAuditSession() {
  const branch = getAdminBranch();
  if (branch === "all") {
    showToast("Selecciona una sucursal especifica para abrir auditoria de pesado.", "info");
    return;
  }

  const filters = getAdminWeightedAuditFilters(branch);
  const existingSessionMatchesFilters = Boolean(
    state.admin.weightedAudit.currentSession
    && state.admin.weightedAudit.currentSession.branch === branch
    && state.admin.weightedAudit.currentSession.shift === filters.shift
    && state.admin.weightedAudit.currentSession.auditedDateKey === filters.dateKey,
  );
  state.admin.weightedAudit.saving = true;
  renderAdminWeightedAuditPanel();
  try {
    const response = await requestAdminJson("/api/admin/weighted-audit/sessions", {
      method: "POST",
      body: JSON.stringify({
        branch,
        shift: filters.shift,
        dateKey: filters.dateKey,
        createdBy: state.admin.username || "admin",
        notes: existingSessionMatchesFilters ? state.admin.weightedAudit.notesDraft || "" : "",
      }),
    });
    setWeightedAuditCurrentSession(response.session || null);
    await loadAdminWeightedAuditSessions(branch);
    showToast("Sesion de auditoria de pesado lista.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.admin.weightedAudit.saving = false;
    renderAdminWeightedAuditPanel();
  }
}

async function saveAdminWeightedAuditItems() {
  const session = state.admin.weightedAudit.currentSession;
  if (!session) {
    showToast("Abre una sesion de auditoria primero.", "info");
    return;
  }

  captureWeightedAuditDraftFromDom();
  const payloadItems = buildWeightedAuditPayloadItems(session.items || []);
  const nextNotes = state.admin.weightedAudit.notesDraft || "";

  if (payloadItems.length === 0 && !nextNotes.trim()) {
    showToast("Captura al menos un conteo fisico o una nota para guardar.", "info");
    return;
  }

  state.admin.weightedAudit.saving = true;
  renderAdminWeightedAuditPanel();
  try {
    const response = await requestAdminJson(
      `/api/admin/weighted-audit/sessions/${session.id}/items`,
      {
        method: "PATCH",
        body: JSON.stringify({ items: payloadItems, notes: nextNotes }),
      },
    );
    setWeightedAuditCurrentSession(response.session || session);
    await loadAdminWeightedAuditSessions(getAdminBranch());
    showToast("Conteos de pesado guardados.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.admin.weightedAudit.saving = false;
    renderAdminWeightedAuditPanel();
  }
}

async function closeAdminWeightedAuditSession() {
  const session = state.admin.weightedAudit.currentSession;
  if (!session) {
    showToast("No hay sesion de auditoria abierta.", "info");
    return;
  }

  state.admin.weightedAudit.saving = true;
  renderAdminWeightedAuditPanel();
  try {
    captureWeightedAuditDraftFromDom();
    const payloadItems = buildWeightedAuditPayloadItems(session.items || []);
    const response = await requestAdminJson(
      `/api/admin/weighted-audit/sessions/${session.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          completedBy: state.admin.username || "admin",
          notes: state.admin.weightedAudit.notesDraft || "",
          items: payloadItems,
        }),
      },
    );
    setWeightedAuditCurrentSession(response.session || session);
    await loadAdminWeightedAuditSessions(getAdminBranch());
    showToast("Auditoria de pesado cerrada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.admin.weightedAudit.saving = false;
    renderAdminWeightedAuditPanel();
  }
}

async function refreshAdminWorkspace(options = {}) {
  const normalized = normalizeAdminWorkspaceOptions(options);
  if (adminWorkspaceRefreshPromise) {
    pendingAdminWorkspaceOptions = mergeAdminWorkspaceOptions(
      pendingAdminWorkspaceOptions,
      normalized,
    );
    await adminWorkspaceRefreshPromise;
    if (pendingAdminWorkspaceOptions) {
      return refreshAdminWorkspace(pendingAdminWorkspaceOptions);
    }
    return;
  }

  adminWorkspaceRefreshPromise = (async () => {
    const needsCapabilityBootstrap = Boolean(
      state.admin.authenticated
      && !state.admin.capabilitiesResolved
      && (
        normalized.snapshot
        || normalized.editorData
        || normalized.auditLogs
        || normalized.branches
        || normalized.cashiers
        || normalized.requests
        || normalized.config
        || normalized.weightedAudit
      ),
    );
    const effectiveOptions = { ...normalized };

    if (needsCapabilityBootstrap) {
      await loadAdminSnapshot(normalized.branch);
      effectiveOptions.snapshot = false;
      effectiveOptions.force = true;
    }

    await Promise.allSettled(
      getAdminWorkspaceTasks(effectiveOptions),
    );

    if (refs.adminModal?.classList.contains("open")) {
      startAdminMetricsPolling();
    }
  })().finally(() => {
    adminWorkspaceRefreshPromise = null;
  });

  await adminWorkspaceRefreshPromise;

  if (pendingAdminWorkspaceOptions) {
    const nextOptions = pendingAdminWorkspaceOptions;
    pendingAdminWorkspaceOptions = null;
    await refreshAdminWorkspace(nextOptions);
  }
}

async function loadAdminMetrics() {
  if (typeof document !== "undefined" && document.hidden) {
    return;
  }
  if (!hasAdminCapability("support_tools")) {
    state.admin.metrics = null;
    state.admin.backupsStatus = null;
    state.admin.metricsLoading = false;
    renderAdminModal();
    return;
  }
  state.admin.metricsLoading = true;

  try {
    const [metricsResult, backupStatusResult] = await Promise.allSettled([
      requestAdminJson("/api/admin/metrics"),
      hasAdminCapability("backups")
        ? requestAdminJson("/api/admin/backups/status")
        : Promise.resolve(null),
    ]);

    if (metricsResult.status === "fulfilled") {
      state.admin.metrics = metricsResult.value;
    }
    if (backupStatusResult.status === "fulfilled") {
      state.admin.backupsStatus = backupStatusResult.value || null;
    }
  } catch (_error) {
    // Evita toasts repetidos si el panel admin queda abierto sin conexion.
  } finally {
    state.admin.metricsLoading = false;
    renderAdminModal();
  }
}

function stopAdminMetricsPolling() {
  if (state.admin.pollTimerId) {
    window.clearInterval(state.admin.pollTimerId);
    state.admin.pollTimerId = null;
  }
}

function startAdminMetricsPolling() {
  stopAdminMetricsPolling();
  if (!hasAdminCapability("support_tools")) {
    state.admin.metrics = null;
    renderAdminModal();
    return;
  }
  void loadAdminMetrics();
  state.admin.pollTimerId = window.setInterval(() => {
    void loadAdminMetrics();
  }, 15000);
}

function toggleAdminInventoryPanel() {
  state.admin.inventoryExpanded = !state.admin.inventoryExpanded;
  if (state.admin.inventoryExpanded) {
    renderInventory();
  }
  renderAdminModal();
}

async function openAdminModal() {
  if (!state.online && !state.admin.authenticated) {
    showToast("El admin necesita internet para validar la sesion.", "error");
    return;
  }

  if (!state.admin.authenticated) {
    await openAdminAuthModal();
    return;
  }

  if (state.online) {
    try {
      await loadAdminAuthStatus();
    } catch (error) {
      if (!isNetworkError(error)) {
        await openAdminAuthModal();
        return;
      }
    }

    if (!state.admin.authenticated) {
      await openAdminAuthModal();
      return;
    }
  }

  if (shouldRevalidateAdminCapabilities()) {
    try {
      await loadAdminSnapshot(getAdminBranch());
    } catch (_error) {
      // Si falla el bootstrap, dejamos que el refresh normal del modal lo vuelva a intentar.
    }
  }

  if (isAdminWorkspaceBlockedByOwner()) {
    showToast("El owner bloqueo este panel de admin.", "error");
    return;
  }

  setModalOpen(refs.adminModal, true);
  if (refs.saveAdminBranchButton && !refs.saveAdminBranchButton.dataset.branchCode) {
    resetAdminBranchForm();
  }
  if (state.admin.inventoryExpanded) {
    renderInventory();
  }
  renderAdminModal();
  startAdminMetricsPolling();
  void refreshAdminWorkspace(getAdminWorkspaceFullOptions(getAdminBranch(), true)).catch(() => {});
}

function closeAdminModal() {
  setModalOpen(refs.adminModal, false);
  stopAdminMetricsPolling();
}

async function logoutAdmin() {
  const branchBeforeLogout = state.cashier.branch || state.store.currentBranch || "carrizal";
  try {
    await requestAdminJson("/api/admin/auth/logout", {
      method: "POST",
    });
  } catch (_error) {
    // Ignorar errores
  }
  state.admin.authenticated = false;
  state.admin.csrfToken = "";
  state.admin.sessionExpiresAt = null;
  resetAdminSensitiveWorkspaceData();
  if (typeof handleApprovalsMobileAdminSessionLoss === "function") {
    handleApprovalsMobileAdminSessionLoss();
  }
  closeAdminModal();
  if (!state.cashier.authenticated && !state.owner.authenticated) {
    applyPublicSnapshot(buildPersistedSnapshot());
    if (state.online) {
      try {
        await refreshCurrentSnapshot(branchBeforeLogout);
      } catch (_error) {
        // Si falla el refresco publico, mantenemos la vista sanitizada local.
      }
    }
  }
  showToast("Sesion cerrada", "info");
}

async function openAdminAuthModal() {
  if (!state.online && !state.admin.authenticated) {
    showToast("Sin internet no puedo validar el acceso admin.", "error");
    return;
  }

  if (state.online) {
    await loadAdminAuthStatus();
  }
  state.adminAuth.mode = state.admin.configured
    ? "login"
    : state.admin.setupAllowed
      ? "setup"
      : "blocked";
  refs.adminAuthUsername.value = state.admin.username || "admin";
  refs.adminAuthPassword.value = "";
  refs.adminAuthConfirmPassword.value = "";
  if (refs.adminAuthBootstrapToken) {
    refs.adminAuthBootstrapToken.value = "";
  }
  setModalOpen(refs.adminAuthModal, true);
  renderAdminAuthModal();
  window.requestAnimationFrame(() => refs.adminAuthUsername.focus());
}

function closeAdminAuthModal() {
  setModalOpen(refs.adminAuthModal, false);
}

async function submitAdminAuth() {
  if (state.adminAuth.mode === "blocked") {
    showToast("Este despliegue no permite crear el acceso admin por web.", "error");
    return;
  }

  const username = refs.adminAuthUsername.value.trim().toLowerCase();
  const password = refs.adminAuthPassword.value.trim();
  const confirmPassword = refs.adminAuthConfirmPassword.value.trim();
  const isSetup = state.adminAuth.mode === "setup";
  const bootstrapToken = refs.adminAuthBootstrapToken?.value.trim() || "";

  if (username.length < 3) {
    showToast("El usuario admin debe tener al menos 3 caracteres.", "error");
    return;
  }

  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    showToast("La contrasena admin debe tener 8+ caracteres, letras y numeros.", "error");
    return;
  }

  if (isSetup && password !== confirmPassword) {
    showToast("La confirmacion de contrasena no coincide.", "error");
    return;
  }
  if (isSetup && !state.admin.setupAllowed) {
    showToast("El setup inicial de admin esta bloqueado en este despliegue.", "error");
    return;
  }
  if (isSetup && !bootstrapToken) {
    showToast("Captura el token de bootstrap para crear el acceso admin.", "error");
    return;
  }

  state.adminAuth.loading = true;
  renderAdminAuthModal();

  try {
    if (isSetup) {
      await performJsonRequest("/api/admin/auth/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        headers: { "X-Bootstrap-Token": bootstrapToken },
      });
    }

    const loginResponse = await performJsonRequest("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.admin.username = username;
    state.admin.configured = true;
    state.admin.setupAllowed = false;
    state.admin.authenticated = Boolean(loginResponse.authenticated);
    state.admin.csrfToken = String(loginResponse.csrfToken || "");
    state.admin.sessionExpiresAt = loginResponse.sessionExpiresAt || null;
    closeAdminAuthModal();
    if (state.mobileApprovals?.active) {
      await syncApprovalsMobileViewFromLocation({ autoOpenAuth: false });
    } else {
      await openAdminModal();
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminAuth.loading = false;
    renderAdminAuthModal();
  }
}

function registerOwnerRevealIntent() {
  const now = Date.now();
  if (now - state.ownerAuth.revealWindowStartedAt > 4500) {
    state.ownerAuth.revealClicks = 0;
  }

  state.ownerAuth.revealClicks += 1;
  state.ownerAuth.revealWindowStartedAt = now;
  if (state.ownerAuth.revealClicks >= 5) {
    state.ownerAuth.revealClicks = 0;
    state.ownerAuth.revealWindowStartedAt = 0;
    void openOwnerEntryPoint();
  }
}

async function openOwnerEntryPoint() {
  if (!state.online && !state.owner.authenticated) {
    showToast("Sin internet no puedo validar el acceso owner.", "error");
    return;
  }

  if (state.online) {
    try {
      await loadOwnerAuthStatus();
    } catch (_error) {
      // Ignorar y dejar que el modal de auth maneje el caso.
    }
  }

  if (!state.owner.authenticated) {
    await openOwnerAuthModal();
    return;
  }

  await openOwnerConsoleModal();
}

async function openOwnerAuthModal() {
  if (!state.online && !state.owner.authenticated) {
    showToast("Sin internet no puedo validar el acceso owner.", "error");
    return;
  }

  if (state.online) {
    await loadOwnerAuthStatus();
  }

  state.ownerAuth.mode = state.owner.configured
    ? "login"
    : state.owner.setupAllowed
      ? "setup"
      : "blocked";
  refs.ownerAuthUsername.value = state.owner.username || "owner";
  refs.ownerAuthPassword.value = "";
  refs.ownerAuthConfirmPassword.value = "";
  if (refs.ownerAuthBootstrapToken) {
    refs.ownerAuthBootstrapToken.value = "";
  }
  setModalOpen(refs.ownerAuthModal, true);
  renderOwnerAuthModal();
  window.requestAnimationFrame(() => refs.ownerAuthUsername.focus());
}

function closeOwnerAuthModal() {
  setModalOpen(refs.ownerAuthModal, false);
}

async function submitOwnerAuth() {
  if (state.ownerAuth.mode === "blocked") {
    showToast("Este despliegue no permite crear el acceso owner por web.", "error");
    return;
  }

  const username = refs.ownerAuthUsername.value.trim().toLowerCase();
  const password = refs.ownerAuthPassword.value.trim();
  const confirmPassword = refs.ownerAuthConfirmPassword.value.trim();
  const isSetup = state.ownerAuth.mode === "setup";
  const bootstrapToken = refs.ownerAuthBootstrapToken?.value.trim() || "";

  if (username.length < 3) {
    showToast("El usuario owner debe tener al menos 3 caracteres.", "error");
    return;
  }

  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    showToast("La contrasena owner debe tener 8+ caracteres, letras y numeros.", "error");
    return;
  }

  if (isSetup && password !== confirmPassword) {
    showToast("La confirmacion de contrasena owner no coincide.", "error");
    return;
  }
  if (isSetup && !state.owner.setupAllowed) {
    showToast("El setup inicial de owner esta bloqueado en este despliegue.", "error");
    return;
  }
  if (isSetup && !bootstrapToken) {
    showToast("Captura el token de bootstrap para crear el owner inicial.", "error");
    return;
  }

  state.ownerAuth.loading = true;
  renderOwnerAuthModal();

  try {
    if (isSetup) {
      await performJsonRequest("/api/owner/auth/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        headers: { "X-Bootstrap-Token": bootstrapToken },
      });
    }

    const loginResponse = await performJsonRequest("/api/owner/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.owner.username = username;
    state.owner.configured = true;
    state.owner.setupAllowed = false;
    state.owner.authenticated = Boolean(loginResponse.authenticated);
    state.owner.csrfToken = String(loginResponse.csrfToken || "");
    state.owner.sessionExpiresAt = loginResponse.sessionExpiresAt || null;
    closeOwnerAuthModal();
    await openOwnerConsoleModal();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.ownerAuth.loading = false;
    renderOwnerAuthModal();
  }
}

function getOwnerSelectedModules() {
  return refs.ownerModulesWrap
    ? [...refs.ownerModulesWrap.querySelectorAll('input[type="checkbox"][data-owner-module-code]')]
      .filter((input) => input.checked)
      .map((input) => input.dataset.ownerModuleCode)
    : [];
}

function getOwnerSelectedAdminCapabilities() {
  return refs.ownerAdminSectionsWrap
    ? [...refs.ownerAdminSectionsWrap.querySelectorAll('input[type="checkbox"][data-owner-capability-code]')]
      .filter((input) => input.checked)
      .map((input) => input.dataset.ownerCapabilityCode)
    : [];
}

async function loadOwnerConsoleConfig() {
  state.owner.loading = true;
  renderOwnerConsoleModal();
  try {
    const [response, templatesResponse] = await Promise.all([
      requestOwnerJson("/api/owner/config"),
      requestOwnerJson("/api/owner/templates"),
    ]);
    state.owner.availableModules = Array.isArray(response.availableModules) ? response.availableModules : [];
    state.owner.adminSections = Array.isArray(response.adminSections) ? response.adminSections : [];
    state.owner.templates = Array.isArray(templatesResponse.templates) ? templatesResponse.templates : [];
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.adminCapabilities = Array.isArray(response.adminCapabilities) ? response.adminCapabilities : state.adminCapabilities;
    state.admin.capabilitiesResolved = Array.isArray(response.adminCapabilities);
    state.profile = response.businessProfile || state.profile;
    if (!state.owner.templates.some((template) => template.key === state.owner.templateReset.selectedTemplateKey)) {
      state.owner.templateReset.selectedTemplateKey = state.owner.templates[0]?.key || "";
    }
    state.owner.templateReset.businessName = state.profile.businessName || "";
    state.owner.templateReset.slug = state.profile.slug || "";
    state.owner.accessLoaded = true;
    applyBusinessBranding();
    updateModuleVisibility();
    if (refs.adminModal?.classList.contains("open")) {
      renderAdminModal();
    }
  } catch (error) {
    showToast(error.message || "No pude cargar la consola owner.", "error");
  } finally {
    state.owner.loading = false;
    renderOwnerConsoleModal();
  }
}

async function openOwnerConsoleModal() {
  if (!state.owner.authenticated) {
    await openOwnerAuthModal();
    return;
  }

  setModalOpen(refs.ownerConsoleModal, true);
  renderOwnerConsoleModal();
  await loadOwnerConsoleConfig();
}

function closeOwnerConsoleModal() {
  setModalOpen(refs.ownerConsoleModal, false);
}

async function submitOwnerConsole() {
  if (!state.owner.authenticated) {
    await openOwnerAuthModal();
    return;
  }

  const selectedModules = getOwnerSelectedModules();
  const selectedAdminCapabilities = getOwnerSelectedAdminCapabilities();
  state.owner.saving = true;
  renderOwnerConsoleModal();
  try {
    const response = await requestOwnerJson("/api/owner/config", {
      method: "PATCH",
      body: JSON.stringify({
        enabledModules: selectedModules,
        adminCapabilities: selectedAdminCapabilities,
      }),
    });
    state.owner.availableModules = Array.isArray(response.availableModules) ? response.availableModules : state.owner.availableModules;
    state.owner.adminSections = Array.isArray(response.adminSections) ? response.adminSections : state.owner.adminSections;
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.adminCapabilities = Array.isArray(response.adminCapabilities) ? response.adminCapabilities : state.adminCapabilities;
    state.admin.capabilitiesResolved = Array.isArray(response.adminCapabilities);
    state.owner.accessLoaded = true;
    updateModuleVisibility();
    if (refs.adminModal?.classList.contains("open")) {
      renderAdminModal();
    }
    showToast("Panel owner actualizado.", "success");
  } catch (error) {
    showToast(error.message || "No pude guardar la consola owner.", "error");
  } finally {
    state.owner.saving = false;
    renderOwnerConsoleModal();
  }
}

async function applyOwnerTemplateReset() {
  if (!state.owner.authenticated) {
    await openOwnerAuthModal();
    return;
  }

  const selectedTemplateKey = refs.ownerTemplateSelect?.value || "";
  const businessName = refs.ownerTemplateBusinessName?.value.trim() || "";
  const slug = refs.ownerTemplateSlug?.value.trim() || "";
  const workbookPath = refs.ownerTemplateWorkbookPath?.value.trim() || "";
  const confirmText = refs.ownerTemplateConfirmText?.value.trim() || "";
  const confirmReset = Boolean(refs.ownerTemplateConfirmReset?.checked);
  const currentSlug = String(state.profile?.slug || "");

  state.owner.templateReset.selectedTemplateKey = selectedTemplateKey;
  state.owner.templateReset.businessName = businessName;
  state.owner.templateReset.slug = slug;
  state.owner.templateReset.workbookPath = workbookPath;
  state.owner.templateReset.confirmText = confirmText;
  state.owner.templateReset.confirmReset = confirmReset;

  if (!selectedTemplateKey) {
    showToast("Selecciona una plantilla antes de reiniciar el negocio.", "error");
    renderOwnerConsoleModal();
    return;
  }
  if (!businessName || !slug || !workbookPath) {
    showToast("Completa nombre, slug y ruta del Excel antes de continuar.", "error");
    renderOwnerConsoleModal();
    return;
  }
  if (!confirmReset) {
    showToast("Debes confirmar que entiendes el reinicio total del negocio.", "error");
    renderOwnerConsoleModal();
    return;
  }
  if (!currentSlug || confirmText !== currentSlug) {
    showToast("La confirmacion debe coincidir exactamente con el slug actual.", "error");
    renderOwnerConsoleModal();
    return;
  }

  state.owner.templateReset.applying = true;
  renderOwnerConsoleModal();

  try {
    const response = await requestOwnerJson(`/api/owner/templates/${encodeURIComponent(selectedTemplateKey)}/apply`, {
      method: "POST",
      body: JSON.stringify({
        businessName,
        slug,
        workbookPath,
        confirmReset: true,
        confirmText,
      }),
      timeout: 30000,
    });
    state.profile = response.businessProfile || state.profile;
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.adminCapabilities = Array.isArray(response.adminCapabilities) ? response.adminCapabilities : state.adminCapabilities;
    state.categories = Array.isArray(response.categories)
      ? response.categories.filter((category) => category.active !== false)
      : state.categories;
    state.units = Array.isArray(response.units)
      ? response.units.filter((unit) => unit.active !== false)
      : state.units;
    state.productAttributeDefinitions = Array.isArray(response.productAttributeDefinitions)
      ? response.productAttributeDefinitions.filter((definition) => definition.active !== false)
      : state.productAttributeDefinitions;
    state.admin.configured = false;
    state.admin.authenticated = false;
    state.admin.csrfToken = "";
    state.admin.sessionExpiresAt = null;
    state.admin.setupAllowed = false;
    resetAdminSensitiveWorkspaceData();
    state.owner.configured = true;
    state.owner.authenticated = false;
    state.owner.csrfToken = "";
    state.owner.sessionExpiresAt = null;
    state.owner.setupAllowed = false;
    state.owner.accessLoaded = false;
    clearClientBusinessResetState();
    if (response.snapshot) {
      applyPublicSnapshot(response.snapshot);
    } else {
      await refreshCurrentSnapshot();
    }
    state.owner.templateReset.confirmText = "";
    state.owner.templateReset.confirmReset = false;
    closeAdminModal();
    closeOwnerConsoleModal();
    closeOwnerAuthModal();
    showToast("Plantilla aplicada y catalogo reconstruido. Vuelve a iniciar sesion como owner o admin.", "success");
  } catch (error) {
    showToast(error.message || "No pude aplicar la plantilla completa.", "error");
  } finally {
    state.owner.templateReset.applying = false;
    renderOwnerConsoleModal();
  }
}

async function logoutOwner() {
  const branchBeforeLogout = state.cashier.branch || state.store.currentBranch || "carrizal";
  try {
    await requestOwnerJson("/api/owner/auth/logout", {
      method: "POST",
    });
  } catch (_error) {
    // Ignorar errores para no trabar la salida owner.
  }

  state.owner.authenticated = false;
  state.owner.csrfToken = "";
  state.owner.sessionExpiresAt = null;
  state.owner.setupAllowed = false;
  state.owner.accessLoaded = false;
  closeOwnerConsoleModal();
  closeOwnerAuthModal();
  if (!state.cashier.authenticated && !state.admin.authenticated) {
    applyPublicSnapshot(buildPersistedSnapshot());
    if (state.online) {
      try {
        await refreshCurrentSnapshot(branchBeforeLogout);
      } catch (_error) {
        // Si falla el refresco publico, mantenemos la vista sanitizada local.
      }
    }
  }
  showToast("Sesion owner cerrada", "info");
}

async function ensureAdminActionAccess(capabilityCode, blockedMessage) {
  if (!state.admin.authenticated) {
    await openAdminAuthModal();
    return false;
  }

  if (!hasAdminCapability(capabilityCode)) {
    showToast(blockedMessage || "Esta seccion del admin esta bloqueada por el owner.", "error");
    return false;
  }

  return true;
}

async function throwAdminResponseError(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  const error = new Error(data.message || fallbackMessage);
  error.statusCode = response.status;
  if (typeof handleAdminSessionFailure === "function") {
    handleAdminSessionFailure(error);
  }
  throw error;
}

async function downloadDatabase() {
  if (!await ensureAdminActionAccess("backups", "La descarga de base de datos esta bloqueada por el owner.")) {
    return;
  }

  try {
    const response = await fetch("/api/admin/download-db", {
      headers: getAdminAuthHeaders(),
      credentials: "same-origin",
    });
    if (!response.ok) {
      await throwAdminResponseError(response, "No fue posible descargar la base de datos.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "cremaria-rincon.sqlite";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function installDatabase(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  // Validar extensión
  if (!file.name.endsWith(".sqlite")) {
    showToast("El archivo debe tener extensión .sqlite", "error");
    refs.installDbInput.value = "";
    return;
  }

  // Validar tamaño (máximo 100MB para evitar problemas)
  const maxSizeBytes = 100 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    showToast("El archivo es muy grande (máximo 100MB)", "error");
    refs.installDbInput.value = "";
    return;
  }

  try {
    showToast("Instalando base de datos...", "info");

    const formData = new FormData();
    formData.append("database", file);

    const response = await fetch("/api/admin/install-db", {
      method: "POST",
      headers: getAdminAuthHeaders(),
      credentials: "same-origin",
      body: formData,
    });

    if (!response.ok) {
      await throwAdminResponseError(response, "No fue posible instalar la base de datos.");
    }

    prepareForFullDatabaseInstallReload();
    showToast("Base de datos instalada correctamente. Recargando...", "success");
    refs.installDbInput.value = "";

    // Esperar un momento y recargar la página
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (error) {
    showToast(error.message, "error");
    refs.installDbInput.value = "";
  }
}

async function installDatabaseFromPc(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!await ensureAdminActionAccess("backups", "La instalacion de bases esta bloqueada por el owner.")) {
    refs.installDbInput.value = "";
    return;
  }

  const lowerName = file.name.toLowerCase();
  const allowedExtensions = [".sqlite", ".sqlite3", ".db"];
  if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
    showToast("El archivo debe ser SQLite (.sqlite, .sqlite3 o .db)", "error");
    refs.installDbInput.value = "";
    return;
  }

  const maxSizeBytes = 100 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    showToast("El archivo es muy grande (maximo 100MB)", "error");
    refs.installDbInput.value = "";
    return;
  }

  const confirmed = window.confirm(
    `Se reemplazara la base actual con "${file.name}". Deseas continuar?`,
  );
  if (!confirmed) {
    refs.installDbInput.value = "";
    return;
  }

  const previousLabel = refs.installDbButton.textContent;
  refs.installDbButton.disabled = true;
  refs.installDbButton.textContent = "Instalando...";

  try {
    showToast(`Instalando ${file.name}...`, "info");

    const formData = new FormData();
    formData.append("database", file);

    const response = await fetch("/api/admin/install-db", {
      method: "POST",
      headers: getAdminAuthHeaders(),
      credentials: "same-origin",
      body: formData,
    });

    if (!response.ok) {
      await throwAdminResponseError(response, "No fue posible instalar la base de datos.");
    }
    const data = await response.json().catch(() => ({}));

    prepareForFullDatabaseInstallReload();
    const successMessage = data.backupPath
      ? `Base instalada correctamente. Respaldo guardado en ${data.backupPath}. Vuelve a iniciar sesion.`
      : "Base instalada correctamente. Vuelve a iniciar sesion.";
    showToast(successMessage, "success");
    refs.installDbInput.value = "";

    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (error) {
    showToast(error.message, "error");
    refs.installDbInput.value = "";
  } finally {
    refs.installDbButton.disabled = false;
    refs.installDbButton.textContent = previousLabel;
  }
}

async function installExportWorkbookFromPc(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!await ensureAdminActionAccess("backups", "La instalacion de workbooks esta bloqueada por el owner.")) {
    refs.installWorkbookInput.value = "";
    return;
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx")) {
    showToast("El archivo debe ser un Excel .xlsx exportado por el sistema.", "error");
    refs.installWorkbookInput.value = "";
    return;
  }

  const maxSizeBytes = 100 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    showToast("El archivo es muy grande (maximo 100MB).", "error");
    refs.installWorkbookInput.value = "";
    return;
  }

  const confirmed = window.confirm(
    `Se reemplazaran los datos operativos de las sucursales incluidas en "${file.name}". Deseas continuar?`,
  );
  if (!confirmed) {
    refs.installWorkbookInput.value = "";
    return;
  }

  const previousLabel = refs.installWorkbookButton.textContent;
  refs.installWorkbookButton.disabled = true;
  refs.installWorkbookButton.textContent = "Instalando...";

  try {
    showToast(`Leyendo ${file.name}...`, "info");

    const formData = new FormData();
    formData.append("workbook", file);

    const response = await fetch("/api/admin/install-export-workbook", {
      method: "POST",
      headers: getAdminAuthHeaders(),
      credentials: "same-origin",
      body: formData,
    });

    if (!response.ok) {
      await throwAdminResponseError(response, "No fue posible instalar el Excel exportado.");
    }
    const data = await response.json().catch(() => ({}));
    clearAffectedBranchOperationalState(data.branches);

    const branchText = Array.isArray(data.branches) && data.branches.length > 0
      ? data.branches.map((branch) => getBranchLabel(branch)).join(", ")
      : "las sucursales incluidas";
    const successMessage = data.backupPath
      ? `Excel instalado para ${branchText}. Respaldo guardado en ${data.backupPath}.`
      : `Excel instalado para ${branchText}.`;
    showToast(successMessage, "success");
    refs.installWorkbookInput.value = "";

    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (error) {
    showToast(error.message, "error");
    refs.installWorkbookInput.value = "";
  } finally {
    refs.installWorkbookButton.disabled = false;
    refs.installWorkbookButton.textContent = previousLabel;
  }
}

async function openAdminAuditLogDetail(auditLogId) {
  const entry = state.admin.auditLogs.find((item) => Number(item.id) === Number(auditLogId));
  if (!entry) {
    showToast("No pude encontrar esa entrada de bitacora.", "error");
    return;
  }

  state.detailViewer.loading = false;
  state.detailViewer.kind = "audit";
  state.detailViewer.detail = entry;
  setModalOpen(refs.detailViewerModal, true);
  renderDetailViewer();
}

async function refreshAdminDevPanelData() {
  try {
    await Promise.all([
      refreshCurrentSnapshot(),
      refreshAdminWorkspace(getAdminWorkspaceFullOptions(getAdminBranch(), true)),
      loadRegisterSummary({ silent: true }),
    ]);
    showToast("Panel admin recargado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function retryOfflineSyncFromDev() {
  try {
    await syncAllOfflineData({ forceBlocked: true });
    const blockedQueueCount =
      typeof getBlockedPendingOperationCount === "function" ? getBlockedPendingOperationCount() : 0;
    showToast(
      blockedQueueCount > 0
        ? "Se reintento la sincronizacion, pero siguen quedando ventas pendientes con error."
        : "Se relanzo la sincronizacion offline.",
      blockedQueueCount > 0 ? "info" : "success",
    );
  } catch (error) {
    showToast(error.message || "No fue posible relanzar la sincronizacion.", "error");
  }
}

function refreshOfflineSalesUi() {
  if (typeof renderSyncStatus === "function") {
    renderSyncStatus();
  }
  if (typeof renderCashierSession === "function") {
    renderCashierSession();
  }
  if (typeof renderRecentSales === "function") {
    renderRecentSales();
  }
  if (typeof renderAdminDevPanel === "function") {
    renderAdminDevPanel();
  }
  if (typeof renderOwnerConsoleModal === "function") {
    renderOwnerConsoleModal();
  }
}

function triggerJsonDownload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function buildOfflineSalesAuditPayload(options = {}) {
  const pendingOnly = Boolean(options.pendingOnly);
  const targetClientSaleId = String(options.clientSaleId || "").trim();
  const records = (Array.isArray(state.offlineSales) ? state.offlineSales : [])
    .filter((record) => {
      if (targetClientSaleId && String(record?.clientSaleId || "") !== targetClientSaleId) {
        return false;
      }
      if (pendingOnly) {
        return isOfflineSaleOutstandingStatus(String(record?.status || "pending"));
      }
      return true;
    })
    .map((record) => {
      const displayState = getOfflineSaleDisplayState(record);
        return {
          clientSaleId: record.clientSaleId,
          localSaleId: record.localSaleId,
          localTicketNumber: record.localTicketNumber,
          branch: record.branch,
          cashier: record.cashier,
          shift: record.shift,
          paymentMethod: record.paymentMethod,
          receivedPaymentMethod: record.receivedPaymentMethod || "",
          receivedAmount: record.receivedAmount || 0,
          customerName: record.customerName || "",
          total: record.total,
        itemCount: record.itemCount,
        createdAt: record.createdAt,
        queuedAt: record.queuedAt,
        status: displayState.status,
        statusLabel: displayState.label,
        statusNote: displayState.note,
        retryCount: record.retryCount,
        lastSyncAttemptAt: record.lastSyncAttemptAt,
        syncedAt: record.syncedAt,
        syncedTicketNumber: record.syncedTicketNumber,
        lastError: record.lastError,
        lastErrorCode: record.lastErrorCode,
        rejectedAt: record.rejectedAt,
        rejectedReason: record.rejectedReason,
        reviewReason: record.reviewReason,
        conflicts: displayState.conflicts,
        requestPayload: record.requestPayload,
        items: record.items,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    deviceId: typeof getLocalDeviceId === "function" ? getLocalDeviceId() : "",
    online: state.online,
    cashier: {
      authenticated: state.cashier.authenticated,
      name: state.cashier.name,
      branch: state.cashier.branch,
      hasToken: Boolean(state.cashier.token),
    },
    pendingQueueCount: state.pendingQueue.length,
    offlineSales: records,
    offlineReceivablePayments: Array.isArray(state.offlineReceivablePayments)
      ? state.offlineReceivablePayments
      : [],
  };
}

function downloadOfflineSalesAudit(options = {}) {
  const payload = buildOfflineSalesAuditPayload(options);
  if (!Array.isArray(payload.offlineSales) || payload.offlineSales.length === 0) {
    showToast(
      options.pendingOnly
        ? "No hay ventas offline pendientes para descargar."
        : "No hay ventas offline registradas en este dispositivo.",
      "info",
    );
    return;
  }

  const suffix = options.pendingOnly ? "offline-pendientes" : "offline-auditoria";
  triggerJsonDownload(
    payload,
    `${state.profile?.slug || "retail-pos"}-${suffix}-${toDateInputValue()}.json`,
  );
}

function downloadOfflineSalesAuditFromStatus() {
  downloadOfflineSalesAudit({ pendingOnly: true });
}

function downloadOfflineSalesAuditFromPanel() {
  downloadOfflineSalesAudit();
}

async function retryAllOfflineSalesFromPanel() {
  const pendingOfflineSalesCount = getPendingOfflineSalesCount();
  if (pendingOfflineSalesCount === 0) {
    showToast("No hay ventas offline pendientes por sincronizar.", "info");
    return;
  }

  try {
    await syncAllOfflineData({ forceBlocked: true });
    refreshOfflineSalesUi();
    const stillPending = getPendingOfflineSalesCount();
    showToast(
      stillPending > 0
        ? `Se reintento la sincronizacion. Aun quedan ${stillPending} venta(s) por resolver.`
        : "Se sincronizaron todas las ventas offline pendientes.",
      stillPending > 0 ? "info" : "success",
    );
  } catch (error) {
    showToast(error.message || "No pude reintentar las ventas offline.", "error");
  }
}

async function handleOfflineSaleAction(action, clientSaleId) {
  const safeClientSaleId = String(clientSaleId || "").trim();
  if (!safeClientSaleId) {
    showToast("No pude identificar esa venta offline.", "error");
    return;
  }

  try {
    if (action === "retry") {
      await retryOfflineSaleByClientSaleId(safeClientSaleId);
      showToast("Reintento programado para esa venta offline.", "success");
    } else if (action === "reject") {
      if (!window.confirm("Esta venta dejara de intentar sincronizarse automaticamente. ¿Quieres marcarla como rechazada?")) {
        return;
      }
      markOfflineSaleRejected(
        safeClientSaleId,
        "Marcada manualmente como rechazada desde el panel local.",
      );
      showToast("Venta offline marcada como rechazada.", "info");
    } else if (action === "reactivate") {
      reactivateOfflineSaleRecord(safeClientSaleId);
      showToast("Venta offline reactivada y devuelta a la cola.", "success");
    } else if (action === "download") {
      downloadOfflineSalesAudit({ clientSaleId: safeClientSaleId });
      return;
    } else {
      showToast("Accion offline no reconocida.", "error");
      return;
    }
  } catch (error) {
    showToast(error.message || "No pude completar la accion sobre la venta offline.", "error");
  } finally {
    refreshOfflineSalesUi();
  }
}

function downloadDebugStateFromDev() {
  const debugPayload = {
    generatedAt: new Date().toISOString(),
    branch: getAdminBranch(),
    online: state.online,
    syncingQueue: state.syncingQueue,
    pendingQueue: state.pendingQueue,
    offlineSales: state.offlineSales,
    offlineReceivablePayments: state.offlineReceivablePayments,
    receivablesCache: state.receivablesCache,
    registerEvents: state.register.events,
    performance: state.performance,
    summary: state.summary,
    admin: {
      branch: state.admin.branch,
      authenticated: state.admin.authenticated,
      auditLogs: state.admin.auditLogs,
      editorData: state.admin.editorData,
      metrics: state.admin.metrics,
    },
    snapshot: buildPersistedSnapshot(),
  };

  triggerJsonDownload(
    debugPayload,
    `${state.profile?.slug || "retail-pos"}-debug-${toDateInputValue()}.json`,
  );
}

async function openAdminEditor(kind, id) {
  state.adminEditor.kind = kind;
  state.adminEditor.id = id;
  state.adminEditor.loading = true;
  state.adminEditor.detail = null;
  setModalOpen(refs.adminEditorModal, true);
  renderAdminEditorModal();

  try {
    if (kind === "cashier") {
      state.adminEditor.detail = state.admin.cashiers.find((cashier) => cashier.id === Number(id)) || null;
    } else {
      const response = await requestAdminJson(`/api/activity/${encodeURIComponent(kind)}/${id}`);
      state.adminEditor.kind = response.kind;
      state.adminEditor.detail = response.detail;
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.loading = false;
    renderAdminEditorModal();
  }
}

function closeAdminEditor() {
  setModalOpen(refs.adminEditorModal, false);
}

async function saveAdminEditor() {
  if (!state.adminEditor.detail || state.adminEditor.saving) {
    return;
  }

  const root = refs.adminEditorBody;
  const payload = {};
  root.querySelectorAll("[data-editor-field]").forEach((field) => {
    if (field.type === "number") {
      payload[field.dataset.editorField] = field.value === "" ? "" : Number(field.value);
      return;
    }

    if (field.dataset.editorField === "active") {
      payload.active = field.value === "true";
      return;
    }

    payload[field.dataset.editorField] = field.value;
  });

  let url = "";
  if (state.adminEditor.kind === "sale") {
    url = `/api/admin/sales/${state.adminEditor.id}`;
  } else if (state.adminEditor.kind === "register") {
    url = `/api/admin/register-events/${state.adminEditor.id}`;
  } else if (state.adminEditor.kind === "inventory") {
    url = `/api/admin/inventory-movements/${state.adminEditor.id}`;
    if (payload.note !== undefined) {
      payload.note = String(payload.note || "").trim();
    }
  } else {
    url = `/api/admin/cashiers/${state.adminEditor.id}`;
    payload.password = String(payload.password || "").trim();
  }

  state.adminEditor.saving = true;
  renderAdminEditorModal();

  try {
    await requestAdminJson(url, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace(
      state.adminEditor.kind === "cashier"
        ? getAdminWorkspaceFullOptions(getAdminBranch(), true)
        : { ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true },
    );
    closeAdminEditor();
    showToast("Registro actualizado desde admin.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminEditor.saving = false;
    renderAdminEditorModal();
  }
}

async function submitAdminBranch() {
  const editingCode = String(refs.saveAdminBranchButton?.dataset.branchCode || "").trim();
  const code = refs.adminBranchCode?.value.trim();
  const name = refs.adminBranchName?.value.trim();
  const timezone = refs.adminBranchTimezone?.value.trim() || state.store.timezone || "America/Mexico_City";
  const active = Boolean(refs.adminBranchActive?.checked);

  if ((!editingCode && !code) || !name) {
    showToast("Completa codigo y nombre de la sucursal.", "error");
    return;
  }

  const payload = {
    code: editingCode || code,
    name,
    timezone,
    active,
  };

  try {
    const url = editingCode
      ? `/api/admin/branches/${encodeURIComponent(editingCode)}`
      : "/api/admin/branches";
    const method = editingCode ? "PATCH" : "POST";
    await requestAdminJson(url, {
      method,
      body: JSON.stringify(payload),
    });
    await refreshAdminWorkspace({
      ...getAdminWorkspaceFullOptions(getAdminBranch(), true),
      branches: true,
      snapshot: true,
      cashiers: true,
    });
    resetAdminBranchForm();
    showToast(editingCode ? "Sucursal actualizada." : "Sucursal creada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleAdminBranch(branchCode, isActive) {
  try {
    await requestAdminJson(`/api/admin/branches/${encodeURIComponent(branchCode)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !isActive }),
    });
    await refreshAdminWorkspace({
      ...getAdminWorkspaceFullOptions(getAdminBranch(), true),
      branches: true,
      snapshot: true,
      cashiers: true,
    });
    resetAdminBranchForm();
    showToast("Estado de sucursal actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function submitAdminCashier() {
  const name = refs.adminCashierName.value.trim();
  const branch = refs.adminCashierBranch.value;
  const password = refs.adminCashierPassword.value.trim();

  if (!name || !branch || !password) {
    showToast("Completa nombre, sucursal y contrasena del cajero.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/cashiers", {
      method: "POST",
      body: JSON.stringify({ name, branch, password }),
    });
    refs.adminCashierName.value = "";
    refs.adminCashierPassword.value = "";
    await loadAdminCashiers(getAdminBranch());
    showToast("Cajero creado correctamente.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function toggleAdminCashier(cashierId, isActive) {
  try {
    await requestAdminJson(`/api/admin/cashiers/${cashierId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !isActive }),
    });
    await loadAdminCashiers(getAdminBranch());
    showToast("Estado del cajero actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteAdminCashier(cashierId) {
  try {
    await requestAdminJson(`/api/admin/cashiers/${cashierId}`, {
      method: "DELETE",
    });
    await loadAdminCashiers(getAdminBranch());
    showToast("Cajero eliminado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function getAdminSelectedModules() {
  if (!refs.configModulesWrap) {
    return [];
  }

  return [...refs.configModulesWrap.querySelectorAll('input[type="checkbox"][data-module-code]')]
    .filter((input) => input.checked)
    .map((input) => input.dataset.moduleCode)
    .filter(Boolean);
}

function collectAdminProductAttributes() {
  if (!refs.adminNewProductAttributes) {
    return {};
  }

  return [...refs.adminNewProductAttributes.querySelectorAll("[data-attribute-key]")]
    .reduce((attributes, input) => {
      const attributeKey = input.dataset.attributeKey;
      if (!attributeKey) {
        return attributes;
      }

      if (input.type === "checkbox") {
        attributes[attributeKey] = input.checked;
        return attributes;
      }

      const rawValue = String(input.value || "").trim();
      if (!rawValue) {
        return attributes;
      }

      attributes[attributeKey] = input.dataset.attributeType === "number"
        ? toNumber(rawValue, 0)
        : rawValue;
      return attributes;
    }, {});
}

function resetAdminProductForm() {
  refs.adminNewProductName.value = "";
  refs.adminNewProductPrice.value = "";
  refs.adminNewProductStock.value = "0";
  refs.adminNewProductMinStock.value = "0";
  if (refs.adminNewProductCost) refs.adminNewProductCost.value = "";
  if (refs.adminNewProductSku) refs.adminNewProductSku.value = "";
  if (refs.adminNewProductBarcode) refs.adminNewProductBarcode.value = "";
  if (refs.adminNewProductBrand) refs.adminNewProductBrand.value = "";
  if (refs.adminNewProductSupplier) refs.adminNewProductSupplier.value = "";
  if (refs.adminNewProductPackSize) refs.adminNewProductPackSize.value = "";
  if (refs.adminNewProductAttributes) {
    refs.adminNewProductAttributes.querySelectorAll("input, select").forEach((input) => {
      if (input.type === "checkbox") {
        input.checked = false;
      } else {
        input.value = "";
      }
    });
  }
}

async function submitAdminConfig() {
  const payload = {
    settings: {
      "sales.allow_negative_stock": refs.configAllowNegativeStock.checked ? "true" : "false",
    },
    businessProfile: {
      businessName: refs.configBusinessName?.value.trim(),
      shortName: refs.configShortName?.value.trim(),
      slug: refs.configSlug?.value.trim(),
      timezone: refs.configTimezone?.value.trim(),
      locale: refs.configLocale?.value.trim(),
      currencyCode: refs.configCurrencyCode?.value.trim(),
      ticketPrefix: refs.configTicketPrefix?.value.trim(),
    },
    enabledModules: getAdminSelectedModules(),
  };

  try {
    const response = await requestAdminJson("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    state.profile = response.businessProfile || state.profile;
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.adminCapabilities = Array.isArray(response.adminCapabilities) ? response.adminCapabilities : state.adminCapabilities;
    state.categories = Array.isArray(response.categories)
      ? response.categories.filter((category) => category.active !== false)
      : state.categories;
    state.units = Array.isArray(response.units)
      ? response.units.filter((unit) => unit.active !== false)
      : state.units;
    state.productAttributeDefinitions = Array.isArray(response.productAttributeDefinitions)
      ? response.productAttributeDefinitions.filter((definition) => definition.active !== false)
      : state.productAttributeDefinitions;
    applyBusinessBranding();
    updateModuleVisibility();
    if (typeof syncAdminProductCatalogs === "function") {
      syncAdminProductCatalogs();
    }
    if (typeof renderAdminConfigPanel === "function") {
      renderAdminConfigPanel();
    }
    showToast("Configuraciones guardadas.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function applyAdminBusinessTemplate() {
  const templateKey = refs.configTemplateSelect?.value || "";
  if (!templateKey) {
    showToast("Selecciona una plantilla para aplicar.", "error");
    return;
  }

  if (!window.confirm("Esto limpiara productos, cajeros, ventas e historial operativo del negocio actual.")) {
    return;
  }

  try {
    const response = await requestAdminJson(`/api/admin/templates/${encodeURIComponent(templateKey)}/apply`, {
      method: "POST",
      body: JSON.stringify({
        businessName: refs.configBusinessName?.value.trim(),
        slug: refs.configSlug?.value.trim(),
      }),
    });
    state.profile = response.businessProfile || state.profile;
    state.enabledModules = Array.isArray(response.enabledModules) ? response.enabledModules : state.enabledModules;
    state.categories = Array.isArray(response.categories)
      ? response.categories.filter((category) => category.active !== false)
      : state.categories;
    state.units = Array.isArray(response.units)
      ? response.units.filter((unit) => unit.active !== false)
      : state.units;
    state.productAttributeDefinitions = Array.isArray(response.productAttributeDefinitions)
      ? response.productAttributeDefinitions.filter((definition) => definition.active !== false)
      : state.productAttributeDefinitions;
    resetAdminProductForm();
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceFullOptions("all", true), force: true });
    showToast(`Plantilla ${templateKey} aplicada.`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createAdminCategory() {
  const payload = {
    code: refs.configCategoryCode?.value.trim(),
    label: refs.configCategoryLabel?.value.trim(),
    sortOrder: Number(refs.configCategorySort?.value || state.categories.length),
  };
  if (!payload.code || !payload.label) {
    showToast("Captura codigo y etiqueta de la categoria.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refs.configCategoryCode.value = "";
    refs.configCategoryLabel.value = "";
    refs.configCategorySort.value = "";
    await loadAdminConfig();
    await refreshCurrentSnapshot();
    showToast("Categoria creada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deactivateAdminCategory(categoryId) {
  try {
    await requestAdminJson(`/api/admin/categories/${categoryId}`, { method: "DELETE" });
    await loadAdminConfig();
    await refreshCurrentSnapshot();
    showToast("Categoria desactivada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createAdminUnit() {
  const allowDecimals = refs.configUnitAllowDecimals?.checked !== false;
  const payload = {
    code: refs.configUnitCode?.value.trim(),
    label: refs.configUnitLabel?.value.trim(),
    step: Number(refs.configUnitStep?.value || (allowDecimals ? 0.25 : 1)),
    allowDecimals,
    sortOrder: Number(refs.configUnitSort?.value || state.units.length),
  };
  if (!payload.code || !payload.label) {
    showToast("Captura codigo y etiqueta de la unidad.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/units", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refs.configUnitCode.value = "";
    refs.configUnitLabel.value = "";
    refs.configUnitStep.value = "";
    refs.configUnitSort.value = "";
    refs.configUnitAllowDecimals.checked = true;
    await loadAdminConfig();
    await refreshCurrentSnapshot();
    showToast("Unidad creada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deactivateAdminUnit(unitId) {
  try {
    await requestAdminJson(`/api/admin/units/${unitId}`, { method: "DELETE" });
    await loadAdminConfig();
    await refreshCurrentSnapshot();
    showToast("Unidad desactivada.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createAdminProductAttribute() {
  const options = String(refs.configAttributeOptions?.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const payload = {
    key: refs.configAttributeKey?.value.trim(),
    label: refs.configAttributeLabel?.value.trim(),
    valueType: refs.configAttributeType?.value || "text",
    required: Boolean(refs.configAttributeRequired?.checked),
    sortOrder: Number(refs.configAttributeSort?.value || state.productAttributeDefinitions.length),
    options,
  };
  if (!payload.key || !payload.label) {
    showToast("Captura clave y etiqueta del atributo.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/product-attributes", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refs.configAttributeKey.value = "";
    refs.configAttributeLabel.value = "";
    refs.configAttributeOptions.value = "";
    refs.configAttributeSort.value = "";
    refs.configAttributeRequired.checked = false;
    await loadAdminConfig();
    showToast("Atributo creado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deactivateAdminProductAttribute(attributeId) {
  try {
    await requestAdminJson(`/api/admin/product-attributes/${attributeId}`, { method: "DELETE" });
    await loadAdminConfig();
    showToast("Atributo desactivado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reimportCatalog() {
  if (!await ensureAdminActionAccess("daily_flow", "La reimportacion de catalogo esta bloqueada por el owner.")) {
    return;
  }

  refs.refreshCatalogButton.disabled = true;
  refs.refreshCatalogButton.textContent = "Importando...";

  try {
    const response = await requestAdminJson("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({ workbookPath: refs.catalogWorkbookPath?.value.trim() || "" }),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    showToast(
      `Catalogo sincronizado con ${response.importedCount || response.result?.importedCount || 0} productos.`,
      "success",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    refs.refreshCatalogButton.disabled = false;
    refs.refreshCatalogButton.textContent = "Reimportar catalogo";
  }
}

async function createAdminProduct() {
  const payload = {
    branch: getAdminActionBranch(),
    name: refs.adminNewProductName.value.trim(),
    categoryId: Number(refs.adminNewProductCategory.value || 0) || refs.adminNewProductCategory.value,
    unitId: Number(refs.adminNewProductUnit.value || 0) || refs.adminNewProductUnit.value,
    price: roundMoney(refs.adminNewProductPrice.value),
    cost: roundMoney(refs.adminNewProductCost?.value || 0),
    stock: roundStock(refs.adminNewProductStock.value),
    minStock: roundStock(refs.adminNewProductMinStock.value),
    sku: refs.adminNewProductSku?.value.trim(),
    barcode: refs.adminNewProductBarcode?.value.trim(),
    brand: refs.adminNewProductBrand?.value.trim(),
    supplierName: refs.adminNewProductSupplier?.value.trim(),
    packSize: refs.adminNewProductPackSize?.value.trim(),
    attributes: collectAdminProductAttributes(),
  };

  if (!payload.name) {
    showToast("Captura el nombre del producto.", "error");
    return;
  }

  try {
    await requestAdminJson("/api/admin/products/manual", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    resetAdminProductForm();
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    showToast("Producto agregado correctamente.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function removeAdminProduct(row) {
  const productId = Number(row?.dataset?.productId);
  if (!productId) {
    showToast("No pude identificar el producto.", "error");
    return;
  }
  const name = row.querySelector(".inventory-name strong")?.textContent || "este producto";
  if (!window.confirm(`Se desactivara ${name}. ¿Deseas continuar?`)) {
    return;
  }

  try {
    await requestAdminJson(
      `/api/admin/products/${productId}?branch=${encodeURIComponent(getAdminActionBranch())}`,
      { method: "DELETE" },
    );
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    showToast("Producto desactivado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function exportWorkbook() {
  if (!state.admin.authenticated) {
    void openAdminAuthModal();
    return;
  }

  if (!hasAdminCapability("backups")) {
    showToast("La exportacion de Excel esta bloqueada por el owner.", "error");
    return;
  }

  const branch = getAdminBranch();
  const scope = "store-day";
  const selectedDate = refs.exportDateInput?.value || toDateInputValue();
  const minDate = refs.exportDateInput?.min || shiftDateInputValue(toDateInputValue(), -14);
  const maxDate = refs.exportDateInput?.max || toDateInputValue();

  if (selectedDate < minDate || selectedDate > maxDate) {
    showToast(`Solo puedes exportar fechas entre ${minDate} y ${maxDate}.`, "error");
    return;
  }

  fetch(`/api/export-workbook?branch=${encodeURIComponent(branch)}&scope=${encodeURIComponent(scope)}&baseDate=${encodeURIComponent(selectedDate)}`, {
    headers: getAdminAuthHeaders(),
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        await throwAdminResponseError(response, "No fue posible exportar el Excel.");
      }

      return response.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${state.profile?.slug || "retail-pos"}-export-${branch}-${selectedDate}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    })
    .catch((error) => {
      showToast(error.message, "error");
    });
}

async function saveInventoryRow(row, branchOverride) {
  const productId = Number(row.dataset.productId);
  const payload = {
    price: roundMoney(row.querySelector('[data-field="price"]').value),
    stock: roundStock(row.querySelector('[data-field="stock"]').value),
    minStock: roundStock(row.querySelector('[data-field="minStock"]').value),
    active: row.querySelector('[data-field="active"]').checked,
    branch: branchOverride || getAdminActionBranch(),
    note: row.querySelector('[data-field="note"]').value.trim(),
  };

  try {
    await requestAdminJson(`/api/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    showToast("Inventario actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}
