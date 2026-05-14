function getQuickImportItems() {
  return Array.isArray(state.quickImport.items) ? state.quickImport.items : [];
}

function getCurrentQuickImportItem() {
  return getQuickImportItems()[state.quickImport.index] || null;
}

function normalizeQuickImportItem(item) {
  const normalizedId = Number(item?.id ?? item?.productId ?? item?.product_id);

  return {
    ...item,
    id: Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null,
    soldToday:
      item?.soldToday == null ? null : roundStock(item.soldToday),
    recordedStock: roundStock(item?.recordedStock ?? item?.stock),
  };
}

function formatQuickImportValue(value, unit) {
  return value == null ? "Sin dato" : `${formatQuantity(value)} ${unit}`;
}

function syncQuickImportItemsFromProducts() {
  if (getQuickImportItems().length === 0) {
    return;
  }

  const productMap = new Map(state.products.map((product) => [product.id, product]));
  state.quickImport.items = state.quickImport.items.map((rawItem) => {
    const item = normalizeQuickImportItem(rawItem);
    const nextProduct = item.id ? productMap.get(item.id) : null;
    if (!nextProduct) {
      return item;
    }

    return {
      ...item,
      ...nextProduct,
      recordedStock: roundStock(nextProduct.stock),
    };
  });
}

function resetQuickImportDraft(item = getCurrentQuickImportItem()) {
  state.quickImport.note = "";
  state.quickImport.currentValue = "";
}

function focusQuickImportValue() {
  if (!refs.quickImportModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportValue?.focus();
    refs.quickImportValue?.select();
  });
}

function setQuickImportIndex(nextIndex) {
  const items = getQuickImportItems();
  if (items.length === 0) {
    state.quickImport.index = 0;
    renderQuickImportModal();
    return;
  }

  state.quickImport.index = Math.min(Math.max(nextIndex, 0), items.length - 1);
  resetQuickImportDraft(items[state.quickImport.index]);
  renderQuickImportModal();
  focusQuickImportValue();
}

function setQuickImportMode(mode) {
  if (!["receive", "return"].includes(mode)) {
    return;
  }

  state.quickImport.mode = mode;
  resetQuickImportDraft();
  renderQuickImportModal();
  focusQuickImportValue();
}

function buildQuickImportFallbackItems() {
  return state.products
    .filter((product) => product.active)
    .map((product) => ({
      ...product,
      soldToday: null,
      recordedStock: roundStock(product.stock),
    }));
}

async function loadQuickImportItems() {
  state.quickImport.loading = true;
  renderQuickImportModal();

  try {
    const response = await requestAdminJson(
      `/api/inventory/quick-import?branch=${encodeURIComponent(getAdminActionBranch())}`,
    );
    state.quickImport.items = Array.isArray(response.items)
      ? response.items.map((item) => normalizeQuickImportItem(item))
      : [];
  } catch (_error) {
    state.quickImport.items = buildQuickImportFallbackItems();
    showToast(
      "No fue posible traer ventas del dia para la captura rapida. Se usara el inventario local.",
      "info",
    );
  } finally {
    state.quickImport.index = 0;
    state.quickImport.loading = false;
    resetQuickImportDraft(getCurrentQuickImportItem());
    renderQuickImportModal();
    focusQuickImportValue();
  }
}

function getQuickImportResultValue() {
  const item = getCurrentQuickImportItem();
  if (!item) {
    return 0;
  }

  const parsedValue = Number(state.quickImport.currentValue);
  if (!Number.isFinite(parsedValue)) {
    return roundStock(item.recordedStock);
  }

  // En ambos modos, interpretamos el valor capturado:
  // - "receive": suma la cantidad al stock actual
  // - "return": resta la cantidad del stock actual
  if (state.quickImport.mode === "return") {
    return roundStock(item.recordedStock - parsedValue);
  }

  // "receive" - sumar entrada de inventario
  return roundStock(item.recordedStock + parsedValue);
}

function updateQuickImportResult() {
  const item = getCurrentQuickImportItem();
  if (!item || !refs.quickImportStockResult) {
    return;
  }

  refs.quickImportStockResult.textContent = formatQuickImportValue(
    getQuickImportResultValue(),
    item.unit,
  );
}

function renderQuickImportNextList() {
  if (!refs.quickImportNextList) {
    return;
  }

  const items = getQuickImportItems();
  if (items.length === 0) {
    refs.quickImportNextList.innerHTML = `
      <div class="empty-state">
        Cuando abras la captura apareceran aqui los productos siguientes.
      </div>
    `;
    return;
  }

  refs.quickImportNextList.innerHTML = items
    .slice(state.quickImport.index, state.quickImport.index + 5)
    .map((item, offset) => {
      const absoluteIndex = state.quickImport.index + offset;
      return `
        <button
          class="quick-import-next-item ${absoluteIndex === state.quickImport.index ? "active" : ""}"
          data-index="${absoluteIndex}"
          type="button"
        >
          <span>${absoluteIndex + 1}. ${escapeHtml(item.name)}</span>
          <strong>${formatQuickImportValue(item.recordedStock, item.unit)}</strong>
        </button>
      `;
    })
    .join("");
}

function renderQuickImportModal() {
  if (!refs.quickImportModal) {
    return;
  }

  const items = getQuickImportItems();
  const item = getCurrentQuickImportItem();
  const hasItems = items.length > 0 && item;
  const isReturnMode = state.quickImport.mode === "return";
  const progress = hasItems ? ((state.quickImport.index + 1) / items.length) * 100 : 0;

  // Actualizar botones de modo
  refs.quickImportModeBar?.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.quickImport.mode);
  });

  // Textos dinámicos según modo
  refs.quickImportDescription.textContent = isReturnMode
    ? "Captura la cantidad que el proveedor retira. Se descuenta del inventario actual."
    : "Captura la cantidad de entrada. Se suma al inventario actual (compra, corrección, etc).";
  
  refs.quickImportValueLabel.textContent = isReturnMode
    ? "Cantidad a descontar"
    : "Cantidad a agregar";
  
  refs.quickImportHelper.textContent = isReturnMode
    ? "Presiona Enter para descontar la salida y pasar al siguiente producto."
    : "Presiona Enter para sumar la entrada y pasar al siguiente producto.";
  
  // Mostrar/ocultar campos según modo
  refs.quickImportProviderField.hidden = false; // Siempre visible para ambos modos
  refs.quickImportSupplier.value = state.quickImport.supplierName;
  refs.quickImportNote.value = state.quickImport.note;

  refs.quickImportProgressText.textContent = hasItems
    ? `${state.quickImport.index + 1} de ${items.length}`
    : "0 de 0";
  refs.quickImportProgressFill.style.width = `${Math.max(progress, hasItems ? 8 : 0)}%`;

  if (state.quickImport.loading) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "Cargando productos para captura rapida...";
    refs.quickImportContent.hidden = true;
    refs.quickImportPrevButton.disabled = true;
    refs.quickImportSkipButton.disabled = true;
    refs.quickImportSaveButton.disabled = true;
    renderQuickImportNextList();
    return;
  }

  if (!hasItems) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "No hay productos activos para captura rapida.";
    refs.quickImportContent.hidden = true;
    refs.quickImportPrevButton.disabled = true;
    refs.quickImportSkipButton.disabled = false;
    refs.quickImportSkipButton.textContent = "Cerrar";
    refs.quickImportSaveButton.disabled = true;
    refs.quickImportSaveButton.textContent = "Guardar y siguiente";
    renderQuickImportNextList();
    return;
  }

  refs.quickImportEmpty.hidden = true;
  refs.quickImportContent.hidden = false;
  refs.quickImportProductName.textContent = item.name;
  refs.quickImportProductMeta.textContent = `${item.categoryLabel} · ${item.unit}`;
  refs.quickImportProductStatus.className = `status-chip ${item.status}`;
  refs.quickImportProductStatus.textContent = getStatusLabel(item.status);
  refs.quickImportStockBefore.textContent = formatQuickImportValue(item.recordedStock, item.unit);
  refs.quickImportSoldToday.textContent = formatQuickImportValue(item.soldToday, item.unit);

  refs.quickImportValue.step = String(getProductStep(item));
  refs.quickImportValue.min = "0";
  refs.quickImportValue.placeholder = isReturnMode
    ? "Captura cantidad a descontar"
    : "Captura cantidad a agregar";
  refs.quickImportValue.value = state.quickImport.currentValue;

  refs.quickImportPrevButton.disabled = state.quickImport.index === 0 || state.quickImport.saving;
  refs.quickImportSkipButton.disabled = state.quickImport.saving;
  refs.quickImportSkipButton.textContent =
    state.quickImport.index >= items.length - 1 ? "Cerrar" : "Saltar";
  refs.quickImportSaveButton.disabled = state.quickImport.saving;
  refs.quickImportSaveButton.textContent = state.quickImport.saving
    ? "Guardando..."
    : state.quickImport.index >= items.length - 1
      ? "Guardar y terminar"
      : "Guardar y siguiente";

  updateQuickImportResult();
  renderQuickImportNextList();
}

async function openQuickImportModal() {
  if (!state.admin.token) {
    await openAdminAuthModal();
    return;
  }

  if (getAdminBranch() === "all") {
    showToast("Selecciona una sucursal especifica en admin para la importacion rapida.", "info");
    return;
  }

  setModalOpen(refs.quickImportModal, true);
  await loadQuickImportItems();
}

function closeQuickImportModal() {
  setModalOpen(refs.quickImportModal, false);
}

async function saveQuickImportEntry() {
  const item = getCurrentQuickImportItem();

  if (!item || state.quickImport.saving) {
    showToast("No hay producto seleccionado.", "error");
    return;
  }

  const rawValue = String(state.quickImport.currentValue || "").trim();
  if (rawValue === "") {
    showToast("Captura un valor antes de continuar.", "error");
    focusQuickImportValue();
    return;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    showToast("El valor capturado no es valido.", "error");
    focusQuickImportValue();
    return;
  }

  const parsedValue = roundStock(numericValue);
  const isReturnMode = state.quickImport.mode === "return";

  // VALIDACIONES
  if (parsedValue <= 0) {
    showToast("La cantidad debe ser mayor a cero.", "error");
    focusQuickImportValue();
    return;
  }

  if (isReturnMode && parsedValue > roundStock(item.recordedStock || 0)) {
    showToast("No puedes descontar mas de lo que existe en inventario.", "error");
    focusQuickImportValue();
    return;
  }

  const safeItem = {
    id: Number(item.id ?? item.productId ?? item.product_id),
    name: String(item.name || item.productName || "Producto sin nombre").trim(),
  };

  const payload = {
    productId: safeItem.id,
    productName: safeItem.name,
    mode: state.quickImport.mode, // "receive" o "return"
    quantity: parsedValue,
    branch: getAdminActionBranch(),
    note: state.quickImport.note.trim(),
    supplierName: state.quickImport.supplierName.trim(),
  };

  state.quickImport.saving = true;
  renderQuickImportModal();

  try {
    const response = await requestAdminJson("/api/inventory/quick-import", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Actualizar el item local con los datos del servidor
    if (response.product) {
      const currentIndex = state.quickImport.index;
      state.quickImport.items[currentIndex] = {
        ...state.quickImport.items[currentIndex],
        ...response.product,
        recordedStock: roundStock(response.product.stock),
      };
    }

    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    state.quickImport.saving = false;

    if (state.quickImport.index >= getQuickImportItems().length - 1) {
      closeQuickImportModal();
      showToast("Captura completada.", "success");
      return;
    }

    setQuickImportIndex(state.quickImport.index + 1);
  } catch (error) {
    showToast(error.message, "error");
    state.quickImport.saving = false;
    renderQuickImportModal();
    focusQuickImportValue();
  }
}

function goToPreviousQuickImportItem() {
  if (state.quickImport.index <= 0) {
    return;
  }

  setQuickImportIndex(state.quickImport.index - 1);
}

function skipQuickImportItem() {
  if (state.quickImport.index >= getQuickImportItems().length - 1) {
    closeQuickImportModal();
    return;
  }

  setQuickImportIndex(state.quickImport.index + 1);
}
