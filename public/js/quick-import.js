const quickImportStateContext =
  typeof globalThis !== "undefined" && globalThis.quickImportStateHelpers
    ? globalThis.quickImportStateHelpers
    : {};

const getQuickImportHelperItemId =
  typeof quickImportStateContext.getQuickImportItemId === "function"
    ? quickImportStateContext.getQuickImportItemId
    : (item) => {
        const normalizedId = Number(item?.id ?? item?.productId ?? item?.product_id);
        return Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null;
      };

const normalizeQuickImportDraftValue =
  typeof quickImportStateContext.normalizeQuickImportDraft === "function"
    ? quickImportStateContext.normalizeQuickImportDraft
    : (draft = {}) => ({
        quantity: draft?.quantity == null ? "" : String(draft.quantity),
        note: draft?.note == null ? "" : String(draft.note),
        dirty: Boolean(draft?.dirty),
      });

const hasQuickImportDraftContentValue =
  typeof quickImportStateContext.hasQuickImportDraftContent === "function"
    ? quickImportStateContext.hasQuickImportDraftContent
    : (draft = {}) => {
        const normalizedDraft = normalizeQuickImportDraftValue(draft);
        return normalizedDraft.quantity.trim() !== "" || normalizedDraft.note.trim() !== "";
      };

const buildQuickImportDraftMapValue =
  typeof quickImportStateContext.buildQuickImportDraftMap === "function"
    ? quickImportStateContext.buildQuickImportDraftMap
    : (_items = [], existingDrafts = {}) => ({ ...existingDrafts });

const filterQuickImportFlagMapValue =
  typeof quickImportStateContext.filterQuickImportFlagMap === "function"
    ? quickImportStateContext.filterQuickImportFlagMap
    : (_items = [], flagMap = {}) => ({ ...flagMap });

const getQuickImportFilteredIndexesValue =
  typeof quickImportStateContext.getQuickImportFilteredIndexes === "function"
    ? quickImportStateContext.getQuickImportFilteredIndexes
    : (items = [], search = "") =>
        items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) =>
            !String(search || "").trim()
              || [item.name, item.productName, item.categoryLabel, item.category, item.unit]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(String(search || "").trim().toLowerCase()),
          )
          .map(({ index }) => index);

const pickQuickImportVisibleIndexValue =
  typeof quickImportStateContext.pickQuickImportVisibleIndex === "function"
    ? quickImportStateContext.pickQuickImportVisibleIndex
    : (indexes = [], preferredIndex = 0) => {
        if (indexes.length === 0) {
          return null;
        }
        if (indexes.includes(preferredIndex)) {
          return preferredIndex;
        }
        const nextHigherIndex = indexes.find((index) => index > preferredIndex);
        return nextHigherIndex != null ? nextHigherIndex : indexes[indexes.length - 1];
      };

const getQuickImportAdjacentIndexValue =
  typeof quickImportStateContext.getQuickImportAdjacentIndex === "function"
    ? quickImportStateContext.getQuickImportAdjacentIndex
    : (indexes = [], currentIndex = 0, direction = 1) => {
        if (indexes.length === 0) {
          return null;
        }
        const position = indexes.indexOf(currentIndex);
        if (position === -1) {
          return direction > 0 ? indexes[0] : indexes[indexes.length - 1];
        }
        const nextPosition = position + direction;
        if (nextPosition < 0 || nextPosition >= indexes.length) {
          return null;
        }
        return indexes[nextPosition];
      };

const getQuickImportItemStatusValue =
  typeof quickImportStateContext.getQuickImportItemStatus === "function"
    ? quickImportStateContext.getQuickImportItemStatus
    : (options = {}) => {
        const productId = getQuickImportHelperItemId(options.item);
        const draft =
          productId == null
            ? normalizeQuickImportDraftValue()
            : normalizeQuickImportDraftValue((options.draftsByProductId || {})[productId]);

        if (draft.dirty && hasQuickImportDraftContentValue(draft)) {
          return "editing";
        }
        if (productId != null && (options.savedByProductId || {})[productId]) {
          return "saved";
        }
        if (productId != null && (options.skippedByProductId || {})[productId]) {
          return "skipped";
        }
        if (hasQuickImportDraftContentValue(draft)) {
          return "editing";
        }
        return "pending";
      };

const getQuickImportProgressSummaryValue =
  typeof quickImportStateContext.getQuickImportProgressSummary === "function"
    ? quickImportStateContext.getQuickImportProgressSummary
    : (options = {}) => {
        const items = Array.isArray(options.items) ? options.items : [];
        let saved = 0;
        let skipped = 0;
        let editing = 0;

        items.forEach((item, index) => {
          const status = getQuickImportItemStatusValue({
            item,
            index,
            draftsByProductId: options.draftsByProductId,
            savedByProductId: options.savedByProductId,
            skippedByProductId: options.skippedByProductId,
          });

          if (status === "saved") {
            saved += 1;
          } else if (status === "skipped") {
            skipped += 1;
          } else if (status === "editing") {
            editing += 1;
          }
        });

        return {
          total: items.length,
          visible: Array.isArray(options.filteredIndexes) ? options.filteredIndexes.length : items.length,
          saved,
          skipped,
          editing,
          pending: Math.max(0, items.length - saved - skipped - editing),
        };
      };

function ensureQuickImportStateDefaults() {
  state.quickImport.search = String(state.quickImport.search || "");
  state.quickImport.supplierName = String(state.quickImport.supplierName || "");
  state.quickImport.filteredIndexes = Array.isArray(state.quickImport.filteredIndexes)
    ? state.quickImport.filteredIndexes
    : [];
  state.quickImport.draftsByProductId =
    state.quickImport.draftsByProductId && typeof state.quickImport.draftsByProductId === "object"
      ? state.quickImport.draftsByProductId
      : {};
  state.quickImport.savedByProductId =
    state.quickImport.savedByProductId && typeof state.quickImport.savedByProductId === "object"
      ? state.quickImport.savedByProductId
      : {};
  state.quickImport.skippedByProductId =
    state.quickImport.skippedByProductId && typeof state.quickImport.skippedByProductId === "object"
      ? state.quickImport.skippedByProductId
      : {};
  state.quickImport.lastVisitedIndex = Number.isInteger(state.quickImport.lastVisitedIndex)
    ? state.quickImport.lastVisitedIndex
    : 0;
}

function getQuickImportItems() {
  return Array.isArray(state.quickImport.items) ? state.quickImport.items : [];
}

function getQuickImportItemId(item) {
  return getQuickImportHelperItemId(item);
}

function getQuickImportVisibleIndexes() {
  return Array.isArray(state.quickImport.filteredIndexes)
    ? state.quickImport.filteredIndexes
    : getQuickImportFilteredIndexesValue(getQuickImportItems(), state.quickImport.search);
}

function getCurrentQuickImportItem() {
  return getQuickImportItems()[state.quickImport.index] || null;
}

function getCurrentQuickImportProductId() {
  return getQuickImportItemId(getCurrentQuickImportItem());
}

function getQuickImportDraft(productId = getCurrentQuickImportProductId()) {
  if (productId == null) {
    return normalizeQuickImportDraftValue();
  }

  return normalizeQuickImportDraftValue(state.quickImport.draftsByProductId[productId]);
}

function persistQuickImportDraft(productId, draft) {
  if (productId == null) {
    return;
  }

  const nextDraft = normalizeQuickImportDraftValue(draft);
  const nextDrafts = { ...state.quickImport.draftsByProductId };
  if (hasQuickImportDraftContentValue(nextDraft)) {
    nextDrafts[productId] = nextDraft;
  } else {
    delete nextDrafts[productId];
  }
  state.quickImport.draftsByProductId = nextDrafts;
}

function normalizeQuickImportItem(item) {
  const normalizedId = getQuickImportItemId(item);

  return {
    ...item,
    id: normalizedId,
    soldToday: item?.soldToday == null ? null : roundStock(item.soldToday),
    recordedStock: roundStock(item?.recordedStock ?? item?.stock),
  };
}

function formatQuickImportValue(value, unit) {
  return value == null ? "Sin dato" : `${formatQuantity(value)} ${unit}`;
}

function getQuickImportStatusLabel(status) {
  if (status === "editing") {
    return "En edicion";
  }
  if (status === "saved") {
    return "Guardado";
  }
  if (status === "skipped") {
    return "Saltado";
  }
  return "Pendiente";
}

function getQuickImportItemStatus(item, index = state.quickImport.index) {
  return getQuickImportItemStatusValue({
    item,
    index,
    draftsByProductId: state.quickImport.draftsByProductId,
    savedByProductId: state.quickImport.savedByProductId,
    skippedByProductId: state.quickImport.skippedByProductId,
  });
}

function getQuickImportProgressSummary() {
  return getQuickImportProgressSummaryValue({
    items: getQuickImportItems(),
    filteredIndexes: getQuickImportVisibleIndexes(),
    draftsByProductId: state.quickImport.draftsByProductId,
    savedByProductId: state.quickImport.savedByProductId,
    skippedByProductId: state.quickImport.skippedByProductId,
  });
}

function pruneQuickImportCollections() {
  const items = getQuickImportItems();
  state.quickImport.draftsByProductId = buildQuickImportDraftMapValue(
    items,
    state.quickImport.draftsByProductId,
  );
  state.quickImport.savedByProductId = filterQuickImportFlagMapValue(
    items,
    state.quickImport.savedByProductId,
  );
  state.quickImport.skippedByProductId = filterQuickImportFlagMapValue(
    items,
    state.quickImport.skippedByProductId,
  );
}

function syncQuickImportFilters(options = {}) {
  const items = getQuickImportItems();
  const filteredIndexes = getQuickImportFilteredIndexesValue(items, state.quickImport.search);
  state.quickImport.filteredIndexes = filteredIndexes;

  if (items.length === 0) {
    state.quickImport.index = 0;
    state.quickImport.lastVisitedIndex = 0;
    return;
  }

  const currentIndex = Math.min(Math.max(state.quickImport.index, 0), items.length - 1);
  state.quickImport.index = currentIndex;

  if (filteredIndexes.length === 0) {
    state.quickImport.lastVisitedIndex = currentIndex;
    return;
  }

  if (options.preferCurrent && filteredIndexes.includes(currentIndex)) {
    state.quickImport.lastVisitedIndex = currentIndex;
    return;
  }

  const preferredIndex =
    options.preferredIndex != null
      ? options.preferredIndex
      : state.quickImport.lastVisitedIndex || currentIndex;
  const nextIndex = pickQuickImportVisibleIndexValue(filteredIndexes, preferredIndex);

  if (nextIndex != null) {
    state.quickImport.index = nextIndex;
    state.quickImport.lastVisitedIndex = nextIndex;
  }
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

function resetQuickImportSession() {
  ensureQuickImportStateDefaults();
  state.quickImport.items = [];
  state.quickImport.index = 0;
  state.quickImport.lastVisitedIndex = 0;
  state.quickImport.loading = false;
  state.quickImport.saving = false;
  state.quickImport.supplierName = "";
  state.quickImport.search = "";
  state.quickImport.filteredIndexes = [];
  state.quickImport.draftsByProductId = {};
  state.quickImport.savedByProductId = {};
  state.quickImport.skippedByProductId = {};
}

function syncQuickImportItemsFromProducts() {
  ensureQuickImportStateDefaults();
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

  pruneQuickImportCollections();
  syncQuickImportFilters({ preferCurrent: true, preferredIndex: state.quickImport.index });
}

function getQuickImportResultValue() {
  const item = getCurrentQuickImportItem();
  if (!item) {
    return 0;
  }

  const draft = getQuickImportDraft();
  const parsedValue = Number(draft.quantity);
  if (!Number.isFinite(parsedValue)) {
    return roundStock(item.recordedStock);
  }

  if (state.quickImport.mode === "count") {
    return roundStock(parsedValue);
  }

  if (state.quickImport.mode === "return") {
    return roundStock(item.recordedStock - parsedValue);
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

function getQuickImportDraftSummary(item) {
  const draft = getQuickImportDraft(getQuickImportItemId(item));
  const quantityText = String(draft.quantity || "").trim();
  if (quantityText !== "") {
    const numericValue = Number(quantityText);
    if (Number.isFinite(numericValue)) {
      return `Captura ${formatQuantity(roundStock(numericValue))} ${item.unit}`;
    }
    return "Captura pendiente de validar";
  }

  if (draft.note.trim()) {
    return "Nota lista";
  }

  if (item.soldToday != null) {
    return `Vendido hoy ${formatQuickImportValue(item.soldToday, item.unit)}`;
  }

  return `Stock actual ${formatQuickImportValue(item.recordedStock, item.unit)}`;
}

function renderQuickImportSummary() {
  const items = getQuickImportItems();
  const hasItems = items.length > 0;
  const summary = getQuickImportProgressSummary();
  const currentPosition = hasItems ? state.quickImport.index + 1 : 0;
  const resolvedCount = summary.saved + summary.skipped;
  const progressPercent = summary.total > 0 ? (resolvedCount / summary.total) * 100 : 0;

  refs.quickImportProgressText.textContent = hasItems
    ? `Producto ${currentPosition} de ${summary.total}`
    : "0 de 0";
  refs.quickImportProgressNote.textContent = hasItems
    ? `${summary.saved} guardados · ${summary.skipped} saltados · ${summary.editing} en edicion`
    : "Abre una sucursal y carga productos para empezar.";
  const progressStep = Math.min(100, Math.max(0, Math.round(Math.max(progressPercent, hasItems ? 8 : 0) / 5) * 5));
  refs.quickImportProgressFill.className = `quick-import-progress-fill progress-${progressStep}`;

  refs.quickImportTotalCount.textContent = formatQuantity(summary.total || 0);
  refs.quickImportPendingCount.textContent = formatQuantity(summary.pending || 0);
  refs.quickImportSavedCount.textContent = formatQuantity(summary.saved || 0);
  refs.quickImportSkippedCount.textContent = formatQuantity(summary.skipped || 0);

  if (state.quickImport.search.trim()) {
    refs.quickImportFilterSummary.textContent =
      summary.visible > 0
        ? `${summary.visible} de ${summary.total} visibles`
        : `Sin coincidencias en ${summary.total} productos`;
    return;
  }

  refs.quickImportFilterSummary.textContent =
    summary.total > 0 ? `${summary.total} productos en cola` : "Sin productos cargados";
}

function getQuickImportNavigationTarget(direction) {
  return getQuickImportAdjacentIndexValue(getQuickImportVisibleIndexes(), state.quickImport.index, direction);
}

function renderQuickImportActionButtons() {
  const items = getQuickImportItems();
  const hasItems = items.length > 0 && getCurrentQuickImportItem();
  const hasPrev = getQuickImportNavigationTarget(-1) != null;
  const hasNext = getQuickImportNavigationTarget(1) != null;
  const summary = getQuickImportProgressSummary();
  const remainingAfterCurrent = summary.pending + summary.editing;

  refs.quickImportPrevButton.disabled = !hasItems || !hasPrev || state.quickImport.saving;
  refs.quickImportNextButton.disabled = !hasItems || !hasNext || state.quickImport.saving;
  refs.quickImportSkipButton.disabled = !hasItems || state.quickImport.saving;
  refs.quickImportSaveCurrentButton.disabled = !hasItems || state.quickImport.saving;
  refs.quickImportSaveButton.disabled = !hasItems || state.quickImport.saving;

  refs.quickImportSkipButton.textContent = "Saltar";
  refs.quickImportSaveCurrentButton.textContent = state.quickImport.saving ? "Guardando..." : "Guardar";
  refs.quickImportSaveButton.textContent = state.quickImport.saving
    ? "Guardando..."
    : !hasNext && !state.quickImport.search.trim() && remainingAfterCurrent <= 1
      ? "Guardar y terminar"
      : hasNext
        ? "Guardar y avanzar"
        : "Guardar aqui";
}

function renderQuickImportCurrentStateBadge() {
  const item = getCurrentQuickImportItem();
  if (!item || !refs.quickImportCurrentState) {
    return;
  }

  const status = getQuickImportItemStatus(item);
  refs.quickImportCurrentState.className = `quick-import-current-state ${sanitizeClassToken(status, "pending")}`;
  refs.quickImportCurrentState.textContent = getQuickImportStatusLabel(status);
}

function renderQuickImportCurrentItem() {
  const item = getCurrentQuickImportItem();
  if (!item) {
    return;
  }

  const draft = getQuickImportDraft();
  const status = getQuickImportItemStatus(item);
  const isReturnMode = state.quickImport.mode === "return";
  const isCountMode = state.quickImport.mode === "count";

  if (refs.quickImportTitle) {
    refs.quickImportTitle.textContent = isCountMode
      ? "Conteo fisico"
      : isReturnMode
        ? "Salida de mercancia"
        : "Entrada de mercancia";
  }

  refs.quickImportDescription.textContent = isCountMode
    ? "Cuenta el producto fisicamente y captura la existencia real. El POS ajustara el stock a ese numero."
    : isReturnMode
      ? "Captura la cantidad que sale. Se descuenta del inventario actual."
      : "Captura la cantidad que entro. Se suma al inventario actual.";
  refs.quickImportValueLabel.textContent = isCountMode
    ? "Cantidad contada"
    : isReturnMode
      ? "Cantidad a descontar"
      : "Cantidad a agregar";
  refs.quickImportHelper.textContent =
    "Enter guarda y avanza. Shift+Enter guarda sin avanzar. Flechas izquierda y derecha cambian producto.";
  if (refs.quickImportProviderField) {
    refs.quickImportProviderField.hidden = isCountMode;
  }
  refs.quickImportSupplier.value = state.quickImport.supplierName;
  refs.quickImportNote.value = draft.note;
  refs.quickImportValue.value = draft.quantity;
  refs.quickImportValue.step = String(getProductStep(item));
  refs.quickImportValue.min = "0";
  refs.quickImportValue.placeholder = isCountMode
    ? "Captura cantidad contada"
    : isReturnMode
      ? "Captura cantidad a descontar"
      : "Captura cantidad a agregar";

  refs.quickImportProductName.textContent = item.name;
  refs.quickImportProductMeta.textContent = `${item.categoryLabel} · ${item.unit}`;
  refs.quickImportProductPosition.textContent = `${state.quickImport.index + 1} / ${getQuickImportItems().length}`;
  refs.quickImportProductStatus.className = `status-chip ${sanitizeClassToken(item.status, "normal")}`;
  refs.quickImportProductStatus.textContent = getStatusLabel(item.status);
  refs.quickImportCurrentState.className = `quick-import-current-state ${sanitizeClassToken(status, "pending")}`;
  refs.quickImportCurrentState.textContent = getQuickImportStatusLabel(status);
  refs.quickImportStockBefore.textContent = formatQuickImportValue(item.recordedStock, item.unit);
  refs.quickImportSoldToday.textContent = formatQuickImportValue(item.soldToday, item.unit);
  updateQuickImportResult();
}

function renderQuickImportNextList() {
  if (!refs.quickImportNextList) {
    return;
  }

  const items = getQuickImportItems();
  const visibleIndexes = getQuickImportVisibleIndexes();
  if (items.length === 0) {
    refs.quickImportNextList.innerHTML = `
      <div class="empty-state">
        Cuando abras la captura apareceran aqui los productos siguientes.
      </div>
    `;
    return;
  }

  if (visibleIndexes.length === 0) {
    refs.quickImportNextList.innerHTML = `
      <div class="empty-state">
        No hay productos que coincidan con la busqueda actual.
      </div>
    `;
    return;
  }

  refs.quickImportNextList.innerHTML = visibleIndexes
    .map((index) => {
      const item = items[index];
      const status = getQuickImportItemStatus(item, index);
      return `
        <button
          class="quick-import-next-item status-${status} ${index === state.quickImport.index ? "active" : ""}"
          data-index="${index}"
          type="button"
        >
          <div class="quick-import-next-item-head">
            <span class="quick-import-next-item-title">${index + 1}. ${escapeHtml(item.name)}</span>
            <span class="quick-import-inline-state">${escapeHtml(getQuickImportStatusLabel(status))}</span>
          </div>
          <div class="quick-import-next-item-meta">
            <strong>${escapeHtml(item.categoryLabel || "Sin categoria")} · ${escapeHtml(item.unit || "pz")}</strong>
            <small>${formatQuickImportValue(item.recordedStock, item.unit)}</small>
          </div>
          <small>${escapeHtml(getQuickImportDraftSummary(item))}</small>
        </button>
      `;
    })
    .join("");
}

function scrollQuickImportActiveItemIntoView() {
  if (!refs.quickImportNextList) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportNextList
      ?.querySelector(`[data-index="${state.quickImport.index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function focusQuickImportValue() {
  if (!refs.quickImportModal?.classList.contains("open") || refs.quickImportContent?.hidden) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportValue?.focus();
    refs.quickImportValue?.select();
  });
}

function focusQuickImportSearch() {
  if (!refs.quickImportModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportSearch?.focus();
  });
}

function focusQuickImportListItem(index = state.quickImport.index) {
  if (!refs.quickImportModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.quickImportNextList?.querySelector(`[data-index="${index}"]`)?.focus();
  });
}

function renderQuickImportModal() {
  ensureQuickImportStateDefaults();
  if (!refs.quickImportModal) {
    return;
  }

  refs.quickImportModeBar?.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.quickImport.mode);
  });

  refs.quickImportSearch.value = state.quickImport.search;
  renderQuickImportSummary();

  if (state.quickImport.loading) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "Cargando productos para capturar inventario...";
    refs.quickImportContent.hidden = true;
    refs.quickImportPrevButton.disabled = true;
    refs.quickImportNextButton.disabled = true;
    refs.quickImportSkipButton.disabled = true;
    refs.quickImportSaveCurrentButton.disabled = true;
    refs.quickImportSaveButton.disabled = true;
    renderQuickImportNextList();
    return;
  }

  if (getQuickImportItems().length === 0 || !getCurrentQuickImportItem()) {
    refs.quickImportEmpty.hidden = false;
    refs.quickImportEmpty.textContent = "No hay productos activos para capturar inventario.";
    refs.quickImportContent.hidden = true;
    renderQuickImportNextList();
    renderQuickImportActionButtons();
    return;
  }

  refs.quickImportEmpty.hidden = true;
  refs.quickImportContent.hidden = false;
  renderQuickImportCurrentItem();
  renderQuickImportNextList();
  renderQuickImportActionButtons();
  scrollQuickImportActiveItemIntoView();
}

function setQuickImportIndex(nextIndex, options = {}) {
  const items = getQuickImportItems();
  if (items.length === 0) {
    state.quickImport.index = 0;
    state.quickImport.lastVisitedIndex = 0;
    renderQuickImportModal();
    return;
  }

  const clampedIndex = Math.min(Math.max(nextIndex, 0), items.length - 1);
  state.quickImport.index = clampedIndex;
  state.quickImport.lastVisitedIndex = clampedIndex;
  renderQuickImportModal();

  if (options.focusTarget === "list") {
    focusQuickImportListItem(clampedIndex);
    return;
  }

  if (options.focusTarget === "search") {
    focusQuickImportSearch();
    return;
  }

  if (options.focusTarget !== "none") {
    focusQuickImportValue();
  }
}

function updateQuickImportSearch(value) {
  const previousIndex = state.quickImport.index;
  state.quickImport.search = String(value || "");
  syncQuickImportFilters({ preferCurrent: true, preferredIndex: state.quickImport.index });

  if (state.quickImport.index !== previousIndex) {
    renderQuickImportModal();
    focusQuickImportSearch();
    return;
  }

  renderQuickImportSummary();
  renderQuickImportNextList();
  renderQuickImportActionButtons();
  scrollQuickImportActiveItemIntoView();
}

function updateCurrentQuickImportDraft(patch = {}) {
  const productId = getCurrentQuickImportProductId();
  if (productId == null) {
    return;
  }

  const nextDraft = getQuickImportDraft(productId);
  if (patch.quantity !== undefined) {
    nextDraft.quantity = String(patch.quantity || "");
  }
  if (patch.note !== undefined) {
    nextDraft.note = String(patch.note || "");
  }
  nextDraft.dirty = true;

  persistQuickImportDraft(productId, nextDraft);

  if (hasQuickImportDraftContentValue(nextDraft)) {
    const nextSkipped = { ...state.quickImport.skippedByProductId };
    delete nextSkipped[productId];
    state.quickImport.skippedByProductId = nextSkipped;
  }

  renderQuickImportSummary();
  renderQuickImportCurrentStateBadge();
  updateQuickImportResult();
  renderQuickImportNextList();
  renderQuickImportActionButtons();
}

function setQuickImportMode(mode) {
  if (!["receive", "return", "count"].includes(mode)) {
    return;
  }

  state.quickImport.mode = mode;
  renderQuickImportModal();
  focusQuickImportValue();
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
      "No fue posible traer ventas del dia para la captura. Se usara el inventario local.",
      "info",
    );
  } finally {
    state.quickImport.loading = false;
    state.quickImport.index = 0;
    state.quickImport.lastVisitedIndex = 0;
    pruneQuickImportCollections();
    syncQuickImportFilters({ preferredIndex: 0 });
    renderQuickImportModal();
    if (getCurrentQuickImportItem()) {
      focusQuickImportValue();
    } else {
      focusQuickImportSearch();
    }
  }
}

async function openQuickImportModal() {
  if (!state.admin.authenticated) {
    await openAdminAuthModal();
    return;
  }

  const isCountMode = state.quickImport.mode === "count";
  if (!hasAdminCapability(isCountMode ? "inventory" : "daily_flow")) {
    showToast("La captura de inventario esta bloqueada por el owner para este admin.", "error");
    return;
  }

  if (getAdminBranch() === "all") {
    showToast("Selecciona una sucursal especifica en admin para capturar inventario.", "info");
    return;
  }

  resetQuickImportSession();
  setModalOpen(refs.quickImportModal, true);
  await loadQuickImportItems();
}

function closeQuickImportModal() {
  setModalOpen(refs.quickImportModal, false);
}

function getQuickImportSavePayload(item, parsedValue) {
  return {
    productId: Number(item.id ?? item.productId ?? item.product_id),
    productName: String(item.name || item.productName || "Producto sin nombre").trim(),
    mode: state.quickImport.mode,
    quantity: parsedValue,
    branch: getAdminActionBranch(),
    note: getQuickImportDraft().note.trim(),
    supplierName: state.quickImport.supplierName.trim(),
  };
}

async function saveQuickImportEntry(options = {}) {
  const item = getCurrentQuickImportItem();
  const productId = getCurrentQuickImportProductId();

  if (!item || productId == null || state.quickImport.saving) {
    showToast("No hay producto seleccionado.", "error");
    return;
  }

  const draft = getQuickImportDraft(productId);
  const rawValue = String(draft.quantity || "").trim();
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
  const isCountMode = state.quickImport.mode === "count";
  if (isCountMode ? parsedValue < 0 : parsedValue <= 0) {
    showToast(isCountMode ? "La cantidad contada no puede ser negativa." : "La cantidad debe ser mayor a cero.", "error");
    focusQuickImportValue();
    return;
  }

  if (isReturnMode && parsedValue > roundStock(item.recordedStock || 0)) {
    showToast("No puedes descontar mas de lo que existe en inventario.", "error");
    focusQuickImportValue();
    return;
  }

  state.quickImport.saving = true;
  renderQuickImportActionButtons();

  try {
    const response = isCountMode
      ? await requestAdminJson(`/api/products/${productId}`, {
          method: "PATCH",
          body: JSON.stringify({
            branch: getAdminActionBranch(),
            stock: parsedValue,
            note: getQuickImportDraft().note.trim() || "Conteo fisico de inventario",
          }),
        })
      : await requestAdminJson("/api/inventory/quick-import", {
          method: "POST",
          body: JSON.stringify(getQuickImportSavePayload(item, parsedValue)),
        });

    if (response.product) {
      const currentIndex = state.quickImport.index;
      state.quickImport.items[currentIndex] = {
        ...state.quickImport.items[currentIndex],
        ...response.product,
        recordedStock: roundStock(response.product.stock),
      };
    }

    const nextSaved = { ...state.quickImport.savedByProductId, [productId]: true };
    const nextSkipped = { ...state.quickImport.skippedByProductId };
    delete nextSkipped[productId];
    state.quickImport.savedByProductId = nextSaved;
    state.quickImport.skippedByProductId = nextSkipped;
    persistQuickImportDraft(productId, {
      quantity: "",
      note: draft.note,
      dirty: false,
    });

    await refreshCurrentSnapshot();
    await refreshAdminWorkspace({ ...getAdminWorkspaceLiveOptions(getAdminBranch()), force: true });
    state.quickImport.saving = false;
    syncQuickImportItemsFromProducts();

    if (!options.advance) {
      renderQuickImportModal();
      showToast("Captura guardada.", "success");
      focusQuickImportValue();
      return;
    }

    const nextIndex = getQuickImportNavigationTarget(1);
    if (nextIndex != null) {
      setQuickImportIndex(nextIndex);
      showToast("Captura guardada.", "success");
      return;
    }

    const summary = getQuickImportProgressSummary();
    if (!state.quickImport.search.trim() && summary.pending === 0 && summary.editing === 0) {
      closeQuickImportModal();
      showToast("Captura completada.", "success");
      return;
    }

    renderQuickImportModal();
    showToast("Captura guardada.", "success");
    focusQuickImportValue();
  } catch (error) {
    state.quickImport.saving = false;
    renderQuickImportActionButtons();
    showToast(error.message, "error");
    focusQuickImportValue();
  }
}

function goToPreviousQuickImportItem() {
  const previousIndex = getQuickImportNavigationTarget(-1);
  if (previousIndex == null) {
    return;
  }

  setQuickImportIndex(previousIndex);
}

function goToNextQuickImportItem() {
  const nextIndex = getQuickImportNavigationTarget(1);
  if (nextIndex == null) {
    return;
  }

  setQuickImportIndex(nextIndex);
}

function skipQuickImportItem() {
  const item = getCurrentQuickImportItem();
  const productId = getCurrentQuickImportProductId();
  if (!item || productId == null) {
    return;
  }

  const draft = getQuickImportDraft(productId);
  if (!hasQuickImportDraftContentValue(draft)) {
    state.quickImport.skippedByProductId = {
      ...state.quickImport.skippedByProductId,
      [productId]: true,
    };
  }

  const nextIndex = getQuickImportNavigationTarget(1);
  if (nextIndex != null) {
    setQuickImportIndex(nextIndex);
    return;
  }

  renderQuickImportModal();
}

function isQuickImportTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select"));
}

function handleQuickImportModalKeydown(event) {
  if (!refs.quickImportModal?.classList.contains("open")) {
    return;
  }

  if (event.key === "Escape" && !state.quickImport.saving) {
    event.preventDefault();
    closeQuickImportModal();
    return;
  }

  if (event.target === refs.quickImportSearch && event.key === "ArrowDown") {
    event.preventDefault();
    focusQuickImportListItem();
    return;
  }

  const queueButton = event.target.closest("[data-index]");
  if (queueButton && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    const nextIndex = getQuickImportAdjacentIndexValue(
      getQuickImportVisibleIndexes(),
      Number(queueButton.dataset.index),
      event.key === "ArrowDown" ? 1 : -1,
    );
    if (nextIndex != null) {
      setQuickImportIndex(nextIndex, { focusTarget: "list" });
    }
    return;
  }

  if (isQuickImportTypingTarget(event.target)) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToPreviousQuickImportItem();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    goToNextQuickImportItem();
  }
}
