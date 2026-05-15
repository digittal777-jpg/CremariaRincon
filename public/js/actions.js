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
  cashiers: 60000,
  requests: 10000,
  config: 300000,
  weightedAudit: 15000,
};
const ADMIN_WORKSPACE_SECTION_KEYS = [
  "snapshot",
  "editorData",
  "auditLogs",
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
  if (normalized.editorData && shouldRefreshAdminWorkspaceSection("editorData", normalized)) {
    tasks.push(loadAdminEditorData(normalized.branch));
  }
  if (normalized.auditLogs && shouldRefreshAdminWorkspaceSection("auditLogs", normalized)) {
    tasks.push(loadAdminAuditLogs(normalized.branch));
  }
  if (normalized.cashiers && shouldRefreshAdminWorkspaceSection("cashiers", normalized)) {
    tasks.push(loadAdminCashiers(normalized.branch));
  }
  if (normalized.requests && shouldRefreshAdminWorkspaceSection("requests", normalized)) {
    tasks.push(loadAdminMerchandiseRequests(normalized.branch));
  }
  if (normalized.config && shouldRefreshAdminWorkspaceSection("config", normalized)) {
    tasks.push(loadAdminConfig());
  }
  if (normalized.weightedAudit && shouldRefreshAdminWorkspaceSection("weightedAudit", normalized)) {
    tasks.push(loadAdminWeightedAuditSessions(normalized.branch));
  }

  return tasks;
}

function applySnapshot(snapshot, options = {}) {
  const renderStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  state.store = snapshot.store || state.store;
  state.products = Array.isArray(snapshot.products) ? snapshot.products : [];
  state.lowStock = Array.isArray(snapshot.lowStock) ? snapshot.lowStock : [];
  state.recentSales = Array.isArray(snapshot.recentSales) ? snapshot.recentSales : [];
  state.recentActivity = Array.isArray(snapshot.recentActivity) ? snapshot.recentActivity : [];
  state.salesByHour = Array.isArray(snapshot.salesByHour) ? snapshot.salesByHour : [];
  state.shiftSummary = Array.isArray(snapshot.shiftSummary) ? snapshot.shiftSummary : [];
  state.summary = snapshot.summary || state.summary;
  state.admin.editorData.sales = state.recentSales.slice(0, 16);
  syncQuickImportItemsFromProducts();
  syncMerchandiseRequestProductsFromSnapshot();
  if (!options.skipPersist) {
    saveSnapshot(buildPersistedSnapshot());
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
    shift: payload.shift,
    cashier: payload.cashier,
    paymentMethod: payload.paymentMethod,
    subtotal: total,
    total,
    itemCount,
    notes: payload.notes || "",
    receivedAmount: payload.receivedAmount,
    changeAmount:
      payload.paymentMethod === "Efectivo"
        ? roundMoney(payload.receivedAmount - total)
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
}

async function refreshCurrentSnapshot(branch = getActiveCashierBranch()) {
  const snapshot = await performJsonRequest(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}`,
  );
  applySnapshot(snapshot);
  return snapshot;
}

function applyAdminSnapshot(snapshot) {
  state.admin.snapshot = snapshot || null;
  state.admin.inventoryComparison = snapshot?.inventoryComparison || null;
  if (snapshot?.store?.currentBranch) {
    state.admin.branch = snapshot.store.currentBranch;
  }
  renderAdminModal();
}

async function loadAdminSnapshot(branch = getAdminBranch()) {
  const snapshot = await requestAdminJson(
    `/api/bootstrap?branch=${encodeURIComponent(branch)}`,
  );
  applyAdminSnapshot(snapshot);
  markAdminWorkspaceLoaded("snapshot");
  return snapshot;
}

async function loadAdminCashiers(branch = getAdminBranch()) {
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
  try {
    const response = await requestAdminJson("/api/admin/settings");
    const settings = response.settings || {};
    refs.configAllowNegativeStock.checked = settings["sales.allow_negative_stock"] === "true";
    markAdminWorkspaceLoaded("config");
  } catch (error) {
    showToast("Error al cargar configuraciones.", "error");
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
  const payloadItems = (session.items || [])
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
    const response = await requestAdminJson(
      `/api/admin/weighted-audit/sessions/${session.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          completedBy: state.admin.username || "admin",
          notes: state.admin.weightedAudit.notesDraft || "",
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

  adminWorkspaceRefreshPromise = Promise.allSettled(
    getAdminWorkspaceTasks(normalized),
  ).finally(() => {
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
  state.admin.metricsLoading = true;

  try {
    state.admin.metrics = await requestAdminJson("/api/admin/metrics");
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
  if (!state.admin.token) {
    await openAdminAuthModal();
    return;
  }

  try {
    await requestAdminJson("/api/admin/auth/status");
  } catch (error) {
    state.admin.token = "";
    writeStorageText(STORAGE_KEYS.adminToken, "");
    await openAdminAuthModal();
    return;
  }

  setModalOpen(refs.adminModal, true);
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
  try {
    await performJsonRequest("/api/admin/auth/logout", {
      method: "POST",
      headers: getAdminAuthHeaders(),
    });
  } catch (_error) {
    // Ignorar errores
  }
  state.admin.token = "";
  writeStorageText(STORAGE_KEYS.adminToken, "");
  state.admin.authenticated = false;
  closeAdminModal();
  showToast("Sesion cerrada", "info");
}

async function openAdminAuthModal() {
  await loadAdminAuthStatus();
  state.adminAuth.mode = state.admin.configured ? "login" : "setup";
  refs.adminAuthUsername.value = state.admin.username || "admin";
  refs.adminAuthPassword.value = "";
  refs.adminAuthConfirmPassword.value = "";
  setModalOpen(refs.adminAuthModal, true);
  renderAdminAuthModal();
  window.requestAnimationFrame(() => refs.adminAuthUsername.focus());
}

function closeAdminAuthModal() {
  setModalOpen(refs.adminAuthModal, false);
}

async function submitAdminAuth() {
  const username = refs.adminAuthUsername.value.trim().toLowerCase();
  const password = refs.adminAuthPassword.value.trim();
  const confirmPassword = refs.adminAuthConfirmPassword.value.trim();
  const isSetup = state.adminAuth.mode === "setup";

  if (username.length < 3) {
    showToast("El usuario admin debe tener al menos 3 caracteres.", "error");
    return;
  }

  if (password.length < 4) {
    showToast("La contrasena admin debe tener al menos 4 caracteres.", "error");
    return;
  }

  if (isSetup && password !== confirmPassword) {
    showToast("La confirmacion de contrasena no coincide.", "error");
    return;
  }

  state.adminAuth.loading = true;
  renderAdminAuthModal();

  try {
    if (isSetup) {
      await performJsonRequest("/api/admin/auth/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    }

    const loginResponse = await performJsonRequest("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.admin.username = username;
    state.admin.token = loginResponse.token || "";
    state.admin.authenticated = Boolean(state.admin.token);
    writeStorageText(STORAGE_KEYS.adminToken, state.admin.token);
    closeAdminAuthModal();
    openAdminModal();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.adminAuth.loading = false;
    renderAdminAuthModal();
  }
}

async function downloadDatabase() {
  try {
    const response = await fetch("/api/admin/download-db", {
      headers: getAdminAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "No fue posible descargar la base de datos.");
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
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data.message || "No fue posible instalar la base de datos.",
      );
    }

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
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "No fue posible instalar la base de datos.");
    }

    const successMessage = data.backupPath
      ? `Base instalada correctamente. Respaldo guardado en ${data.backupPath}.`
      : "Base instalada correctamente.";
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
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "No fue posible instalar el Excel exportado.");
    }

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
    await syncAllOfflineData();
    showToast("Se relanzo la sincronizacion offline.", "success");
  } catch (error) {
    showToast(error.message || "No fue posible relanzar la sincronizacion.", "error");
  }
}

function downloadDebugStateFromDev() {
  const debugPayload = {
    generatedAt: new Date().toISOString(),
    branch: getAdminBranch(),
    online: state.online,
    syncingQueue: state.syncingQueue,
    pendingQueue: state.pendingQueue,
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

  const blob = new Blob([JSON.stringify(debugPayload, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `cremeria-rincon-debug-${toDateInputValue()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
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

async function submitAdminConfig() {
  const updates = {
    "sales.allow_negative_stock": refs.configAllowNegativeStock.checked ? "true" : "false",
  };

  try {
    await requestAdminJson("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    showToast("Configuraciones guardadas.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reimportCatalog() {
  refs.refreshCatalogButton.disabled = true;
  refs.refreshCatalogButton.textContent = "Importando...";

  try {
    const response = await requestAdminJson("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({ workbookPath: "Queseria El rincon V1.5.xlsx" }),
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
    category: refs.adminNewProductCategory.value,
    unit: refs.adminNewProductUnit.value,
    price: roundMoney(refs.adminNewProductPrice.value),
    stock: roundStock(refs.adminNewProductStock.value),
    minStock: roundStock(refs.adminNewProductMinStock.value),
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
    refs.adminNewProductName.value = "";
    refs.adminNewProductPrice.value = "";
    refs.adminNewProductStock.value = "0";
    refs.adminNewProductMinStock.value = "0";
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
  })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "No fue posible exportar el Excel.");
      }

      return response.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `cremeria-rincon-export-${branch}-${selectedDate}.xlsx`;
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
