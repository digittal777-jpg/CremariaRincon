// Funciones de Quick Import (captura rápida de inventario)

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
  if (!["initial", "supplier"].includes(mode)) {
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

  if (state.quickImport.mode === "supplier") {
    return roundStock(
      item.recordedStock + (state.quickImport.direction === "out" ? -parsedValue : parsedValue),
    );
  }

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
  const isSupplierMode = state.quickImport.mode === "supplier";
  const isSupplierOut = isSupplierMode && state.quickImport.direction === "out";
  const progress = hasItems ? ((state.quickImport.index + 1) / items.length) * 100 : 0;

  refs.quickImportModeBar?.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.quickImport.mode);
  });

  refs.quickImportDescription.textContent = isSupplierMode
    ? isSupplierOut
      ? "Descuenta rapido lo que el proveedor se lleva y avanza con Enter."
      : "Suma lo que entrega el proveedor sobre la existencia actual y avanza con Enter."
    : "Captura inventario inicial para sumarlo sobre lo ya descontado por ventas del dia.";
  refs.quickImportValueLabel.textContent = isSupplierMode
    ? isSupplierOut
      ? "Cantidad que se lleva"
      : "Cantidad recibida"
    : "Inventario inicial a sumar";
  refs.quickImportHelper.textContent = isSupplierMode
    ? isSupplierOut
      ? "Presiona Enter para descontar la salida del proveedor y pasar al siguiente producto."
      : "Presiona Enter para sumar la entrada del proveedor y pasar al siguiente producto."
    : "Presiona Enter para sumar el inventario inicial y conservar lo ya vendido hoy.";
  refs.quickImportDirectionField.hidden = !isSupplierMode;
  refs.quickImportProviderField.hidden = !isSupplierMode;
  refs.quickImportDirection.value = state.quickImport.direction;
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
  refs.quickImportValue.min = isSupplierMode ? String(getProductMin(item)) : "0";
  refs.quickImportValue.placeholder = isSupplierMode
    ? isSupplierOut
      ? "Captura lo que se lleva"
      : "Captura lo recibido"
    : "Captura el inventario inicial";
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

  const isSupplierMode = state.quickImport.mode === "supplier";
  const isSupplierOut = isSupplierMode && state.quickImport.direction === "out";
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue)) {
    showToast("El valor capturado no es valido.", "error");
    focusQuickImportValue();
    return;
  }

  const parsedValue = roundStock(numericValue);

  // VALIDACIONES
  if (isSupplierMode && parsedValue <= 0) {
    showToast("La cantidad del proveedor debe ser mayor a cero.", "error");
    focusQuickImportValue();
    return;
  }
  if (isSupplierOut && parsedValue > roundStock(item.recordedStock || 0)) {
    showToast("No puedes descontar más de lo que existe.", "error");
    focusQuickImportValue();
    return;
  }
  if (!isSupplierMode && parsedValue < 0) {
    showToast("La existencia no puede ser negativa.", "error");
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
    mode: state.quickImport.mode,
    branch: getAdminActionBranch(),
    note: state.quickImport.note.trim(),
    supplierName: state.quickImport.supplierName.trim(),
  };

  if (isSupplierMode) {
    payload.quantity = parsedValue;
    payload.direction = state.quickImport.direction;
  } else {
    payload.stock = parsedValue;
  }

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
    await refreshAdminWorkspace();
    state.quickImport.saving = false;

    if (state.quickImport.index >= getQuickImportItems().length - 1) {
      closeQuickImportModal();
      showToast("Captura rapida completada.", "success");
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