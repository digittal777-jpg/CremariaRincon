// Lógica de acciones y eventos de la aplicación

function requireCashierSession(message = "Inicia sesion de cajero para continuar.") {
  if (state.cashier.authenticated) {
    return true;
  }

  showToast(message, "info");
  openCashierAuthModal();
  return false;
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
  if (refs.adminModal?.classList.contains("open")) {
    renderInventory();
  }
  renderQuickImportModal();
  renderSyncStatus();
  state.performance.snapshotRenderMs = roundMetric(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
  );
  renderAdminModal();
  renderAdminRecordLists();
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
  if (refs.adminModal?.classList.contains("open")) {
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

  const currentHourLabel = `${String(new Date().getHours()).padStart(2, "0")}:00`;
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
  if (refs.adminModal?.classList.contains("open")) {
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
  return snapshot;
}

async function loadAdminCashiers(branch = getAdminBranch()) {
  const query =
    branch && branch !== "all" ? `?branch=${encodeURIComponent(branch)}` : "";
  try {
    const response = await requestAdminJson(`/api/admin/cashiers${query}`);
    state.admin.cashiers = Array.isArray(response.cashiers) ? response.cashiers : [];
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

async function loadAdminConfig() {
  try {
    const response = await requestAdminJson("/api/admin/settings");
    const settings = response.settings || {};
    refs.configAllowNegativeStock.checked = settings["sales.allow_negative_stock"] === "true";
  } catch (error) {
    showToast("Error al cargar configuraciones.", "error");
  }
}

async function refreshAdminWorkspace() {
  await Promise.allSettled([
    loadAdminSnapshot(getAdminBranch()),
    loadAdminEditorData(getAdminBranch()),
    loadAdminCashiers(getAdminBranch()),
    loadAdminConfig(),
  ]);
}

async function loadAdminMetrics() {
  state.admin.loading = true;
  renderAdminModal();

  try {
    state.admin.metrics = await requestAdminJson("/api/admin/metrics");
  } catch (_error) {
    // Evita toasts repetidos si el panel admin queda abierto sin conexion.
  } finally {
    state.admin.loading = false;
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
  }, 10000);
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
  renderInventory();
  renderAdminModal();
  startAdminMetricsPolling();
  await refreshAdminWorkspace();
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
  refs.adminAuthPassword.value = "";
  refs.adminAuthConfirmPassword.value = "";
  setModalOpen(refs.adminAuthModal, true);
  renderAdminAuthModal();
  window.requestAnimationFrame(() => refs.adminAuthPassword.focus());
}

function closeAdminAuthModal() {
  setModalOpen(refs.adminAuthModal, false);
}

async function submitAdminAuth() {
  const password = refs.adminAuthPassword.value.trim();
  const confirmPassword = refs.adminAuthConfirmPassword.value.trim();
  const isSetup = state.adminAuth.mode === "setup";

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
        body: JSON.stringify({ password }),
      });
    }

    const loginResponse = await performJsonRequest("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
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
    await refreshAdminWorkspace();
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
    await refreshAdminWorkspace();
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

function exportWorkbook() {
  fetch("/api/export-workbook", {
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
      anchor.download = "cremeria-rincon-export.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    })
    .catch((error) => {
      showToast(error.message, "error");
    });
}

async function saveInventoryRow(row) {
  const productId = Number(row.dataset.productId);
  const payload = {
    price: roundMoney(row.querySelector('[data-field="price"]').value),
    stock: roundStock(row.querySelector('[data-field="stock"]').value),
    minStock: roundStock(row.querySelector('[data-field="minStock"]').value),
    active: row.querySelector('[data-field="active"]').checked,
    branch: getAdminActionBranch(),
    note: row.querySelector('[data-field="note"]').value.trim(),
  };

  try {
    await requestAdminJson(`/api/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshCurrentSnapshot();
    await refreshAdminWorkspace();
    showToast("Inventario actualizado.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}