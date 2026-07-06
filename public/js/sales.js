const ITEM_MODAL_EDIT_SOURCE = {
  QUANTITY: "quantity",
  TOTAL: "total",
};

let itemModalLastEditedField = ITEM_MODAL_EDIT_SOURCE.QUANTITY;

function setItemModalEditSource(source) {
  if (!Object.values(ITEM_MODAL_EDIT_SOURCE).includes(source)) {
    return;
  }

  itemModalLastEditedField = source;
  renderItemPricingHint();
}

function setRouteCartEditorEditSource(source) {
  if (!Object.values(ITEM_MODAL_EDIT_SOURCE).includes(source)) {
    return;
  }

  state.routeCartEditor.editSource = source;
  renderRouteCartEditorHint();
}

function getPricingHintText(editSource, options = {}) {
  const weightedCopy = options.weighted !== false;
  if (editSource === ITEM_MODAL_EDIT_SOURCE.TOTAL) {
    return weightedCopy
      ? "Total fijo: si cambias el precio/kg recalculamos la cantidad sin mover el total de la bascula."
      : "Total fijo: si cambias el precio recalculamos la cantidad sin mover el total.";
  }

  return weightedCopy
    ? "Cantidad fija: si cambias el precio/kg recalculamos el total de la linea."
    : "Cantidad fija: si cambias el precio recalculamos el total de la linea.";
}

function getEditableProductContext(product = {}) {
  const allowDecimals = product.allowDecimals === undefined
    ? product.unit !== "pza"
    : Boolean(product.allowDecimals);
  const unitStep = Number(product.unitStep || (allowDecimals ? 0.25 : 1));
  return {
    ...product,
    price: roundMoney(product.price || 0),
    unit: product.unit || "pza",
    allowDecimals,
    unitStep: Number.isFinite(unitStep) && unitStep > 0 ? unitStep : (allowDecimals ? 0.25 : 1),
  };
}

function getCartLineProduct(item = {}) {
  const productId = Number(item.productId || 0);
  const product = state.products.find((candidate) => candidate.id === productId) || null;
  if (product) {
    return product;
  }

  return getEditableProductContext({
    id: productId,
    name: item.name || "Producto",
    category: item.category || "general",
    categoryLabel: item.categoryLabel || getCategoryLabel(item.category),
    unit: item.unit || "pza",
    price: roundMoney(item.baseUnitPrice || item.unitPrice || 0),
    allowDecimals: item.allowDecimals,
    unitStep: item.unitStep,
    stock: 0,
  });
}

function isRouteSimpleProduct(product) {
  const safeProduct = getEditableProductContext(product);
  return getProductMin(safeProduct) >= 1
    && getProductStep(safeProduct) >= 1
    && safeProduct.allowDecimals === false;
}

function parseItemModalDecimal(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundItemModalMoney(value, fallback = 0) {
  return roundMoney(parseItemModalDecimal(value, fallback));
}

function roundItemModalStock(value, fallback = 0) {
  return roundStock(parseItemModalDecimal(value, fallback));
}

function normalizeUnitPriceValue(value, fallback = 0) {
  const normalized = roundMoney(value || fallback);
  if (normalized > 0) {
    return normalized;
  }

  return roundMoney(fallback || 0);
}

function buildCartItem(product, values = {}) {
  const safeProduct = getEditableProductContext(product);
  const unitPrice = normalizeUnitPriceValue(values.unitPrice, safeProduct.price);
  const hasExplicitLineTotal = values.lineTotal !== undefined && values.lineTotal !== null;
  const lineTotal = hasExplicitLineTotal
    ? roundMoney(values.lineTotal)
    : null;
  const quantity = hasExplicitLineTotal && safeProduct.allowDecimals !== false
    ? roundStock(Math.max(
        parseItemModalDecimal(
          values.quantity ?? (unitPrice > 0 ? lineTotal / unitPrice : getProductMin(safeProduct)),
          0,
        ),
        0.001,
      ))
    : normalizeQuantityToStep(values.quantity, safeProduct);
  return {
    productId: safeProduct.id,
    name: safeProduct.name,
    category: safeProduct.category,
    categoryLabel: safeProduct.categoryLabel,
    unit: safeProduct.unit,
    quantity,
    unitPrice,
    lineTotal: hasExplicitLineTotal ? lineTotal : roundMoney(quantity * unitPrice),
    allowDecimals: safeProduct.allowDecimals,
    unitStep: getProductStep(safeProduct),
    baseUnitPrice: roundMoney(safeProduct.price),
  };
}

function syncLineDraftFromQuantity(product, draft = {}) {
  const safeProduct = getEditableProductContext(product);
  const quantity = normalizeQuantityToStep(draft.quantity, safeProduct);
  const unitPrice = normalizeUnitPriceValue(draft.unitPrice, safeProduct.price);
  return {
    quantity,
    unitPrice,
    lineTotal: roundMoney(quantity * unitPrice),
  };
}

function syncLineDraftFromTotal(product, draft = {}) {
  const safeProduct = getEditableProductContext(product);
  const unitPrice = normalizeUnitPriceValue(draft.unitPrice, safeProduct.price);
  const lineTotal = roundMoney(draft.lineTotal);
  if (lineTotal <= 0) {
    const quantity = getProductMin(safeProduct);
    return {
      quantity,
      unitPrice,
      lineTotal: roundMoney(quantity * unitPrice),
    };
  }

  const quantity = normalizeQuantityFromLineTotal(
    lineTotal,
    { ...safeProduct, price: unitPrice },
  );
  return {
    quantity,
    unitPrice,
    lineTotal,
  };
}

function syncLineDraftFromUnitPrice(product, draft = {}, editSource = ITEM_MODAL_EDIT_SOURCE.QUANTITY) {
  return editSource === ITEM_MODAL_EDIT_SOURCE.TOTAL
    ? syncLineDraftFromTotal(product, draft)
    : syncLineDraftFromQuantity(product, draft);
}

function readItemModalDraft() {
  return {
    quantity: parseItemModalDecimal(refs.itemQuantity?.value, 0),
    unitPrice: parseItemModalDecimal(refs.itemUnitPrice?.value, 0),
    lineTotal: parseItemModalDecimal(refs.itemTotal?.value, 0),
  };
}

function applyItemModalDraft(draft = {}, options = {}) {
  const preserveField = options.preserveField || "";
  if (preserveField !== ITEM_MODAL_EDIT_SOURCE.QUANTITY) {
    refs.itemQuantity.value = String(draft.quantity);
  }
  if (preserveField !== "unitPrice") {
    refs.itemUnitPrice.value = roundMoney(draft.unitPrice).toFixed(2);
  }
  if (preserveField !== ITEM_MODAL_EDIT_SOURCE.TOTAL) {
    refs.itemTotal.value = roundMoney(draft.lineTotal).toFixed(2);
  }
  renderItemQuickQuantityChips();
  updateItemRouteDecisionState();
}

function readRouteCartEditorDraft() {
  return {
    quantity: refs.routeCartEditorQuantity?.value || 0,
    unitPrice: refs.routeCartEditorUnitPrice?.value || 0,
    lineTotal: refs.routeCartEditorTotal?.value || 0,
  };
}

function applyRouteCartEditorDraft(draft = {}, options = {}) {
  const preserveField = options.preserveField || "";
  if (preserveField !== ITEM_MODAL_EDIT_SOURCE.QUANTITY) {
    refs.routeCartEditorQuantity.value = String(draft.quantity);
  }
  if (preserveField !== "unitPrice") {
    refs.routeCartEditorUnitPrice.value = roundMoney(draft.unitPrice).toFixed(2);
  }
  if (preserveField !== ITEM_MODAL_EDIT_SOURCE.TOTAL) {
    refs.routeCartEditorTotal.value = roundMoney(draft.lineTotal).toFixed(2);
  }
  updateRouteCartEditorState();
}

function setItemModalPrimaryActionLabel() {
  const editing = Number.isInteger(state.currentProductCartIndex);
  if (refs.addItemButton) {
    refs.addItemButton.textContent = editing ? "Guardar cambios" : "Agregar";
  }
  const routeConfirmLabel = refs.itemRouteConfirmButton?.querySelector("strong");
  if (routeConfirmLabel) {
    routeConfirmLabel.textContent = editing ? "Guardar" : "Agregar";
  }
}

function commitCartUiState() {
  saveCart();
  renderCart();
  if (refs.paymentModal?.classList.contains("open")) {
    updatePaymentView();
  }
}

function markRouteCartLineMotion(index) {
  if (!isRouteModeEnabled() || !state.ui || !Number.isInteger(index) || index < 0) {
    return;
  }

  state.ui.routeCartMotionIndex = index;
}

function recordRoutePerformanceMetric(avgKey, countKey, durationMs) {
  const safeDuration = roundMetric(Math.max(0, durationMs || 0));
  const nextCount = Number(state.performance[countKey] || 0) + 1;
  const previousAverage = Number(state.performance[avgKey] || 0);
  state.performance[countKey] = nextCount;
  state.performance[avgKey] = roundMetric(
    ((previousAverage * (nextCount - 1)) + safeDuration) / nextCount,
  );
}

function recordRouteQuickAddDuration(durationMs) {
  recordRoutePerformanceMetric("routeQuickAddMs", "routeQuickAddCount", durationMs);
}

function recordRouteCartEditorOpenDuration(durationMs) {
  recordRoutePerformanceMetric("routeCartEditorOpenMs", "routeCartEditorOpenCount", durationMs);
}

function shouldMergeWithRouteBaseLine(item, product) {
  return isRouteSimpleProduct(product)
    && roundMoney(item.unitPrice) === roundMoney(product.price);
}

function findRouteBaseCartLineIndex(product, options = {}) {
  const safeProduct = getEditableProductContext(product);
  const excludeIndex = Number.isInteger(options.excludeIndex) ? options.excludeIndex : null;
  return state.cart.findIndex((item, index) =>
    index !== excludeIndex
      && Number(item.productId) === Number(safeProduct.id)
      && roundMoney(item.unitPrice) === roundMoney(safeProduct.price)
  );
}

function mergeCartLineItems(currentItem, nextItem) {
  const quantity = roundStock(roundStock(currentItem.quantity) + roundStock(nextItem.quantity));
  const unitPrice = roundMoney(nextItem.unitPrice || currentItem.unitPrice);
  return {
    ...currentItem,
    ...nextItem,
    quantity,
    unitPrice,
    lineTotal: roundMoney(quantity * unitPrice),
  };
}

function upsertCartItem(nextItem, options = {}) {
  const replaceIndex = Number.isInteger(options.replaceIndex) ? options.replaceIndex : null;
  const mergeProduct = options.mergeBaseLineProduct || null;
  const canMergeBase = Boolean(
    mergeProduct
    && shouldMergeWithRouteBaseLine(nextItem, mergeProduct),
  );
  const mergeIndex = canMergeBase
    ? findRouteBaseCartLineIndex(mergeProduct, { excludeIndex: replaceIndex })
    : -1;

  if (mergeIndex >= 0) {
    state.cart[mergeIndex] = mergeCartLineItems(state.cart[mergeIndex], nextItem);
    if (replaceIndex !== null) {
      state.cart.splice(replaceIndex, 1);
      return mergeIndex > replaceIndex ? mergeIndex - 1 : mergeIndex;
    }
    return mergeIndex;
  }

  if (replaceIndex !== null) {
    state.cart[replaceIndex] = nextItem;
    return replaceIndex;
  }

  state.cart.push(nextItem);
  return state.cart.length - 1;
}

function syncCartEditingIndexesAfterRemoval(index, options = {}) {
  const focusSearch = options.focusSearch !== false;
  if (state.routeCartEditor.index === index) {
    closeRouteCartEditor({ focusSearch });
  } else if (Number.isInteger(state.routeCartEditor.index) && state.routeCartEditor.index > index) {
    state.routeCartEditor.index -= 1;
  }

  if (state.currentProductCartIndex === index) {
    closeItemModal({ focusSearch });
  } else if (Number.isInteger(state.currentProductCartIndex) && state.currentProductCartIndex > index) {
    state.currentProductCartIndex -= 1;
  }
}

function renderItemPricingHint() {
  if (!refs.itemPricingHint) {
    return;
  }

  refs.itemPricingHint.textContent = getPricingHintText(itemModalLastEditedField, {
    weighted: true,
  });
}

function renderRouteCartEditorHint() {
  if (!refs.routeCartEditorHint) {
    return;
  }

  refs.routeCartEditorHint.textContent = getPricingHintText(
    state.routeCartEditor.editSource,
    { weighted: false },
  );
}

function openItemModal(product, options = {}) {
  if (!requireCashierSession("Inicia sesion de cajero antes de agregar productos.")) {
    return;
  }

  const safeProduct = getEditableProductContext(product);
  const cartIndex = Number.isInteger(options.cartIndex) ? options.cartIndex : null;
  const defaultEditSource = safeProduct.allowDecimals === false
    ? ITEM_MODAL_EDIT_SOURCE.QUANTITY
    : ITEM_MODAL_EDIT_SOURCE.TOTAL;
  const editSource = options.editSource || (
    cartIndex !== null ? ITEM_MODAL_EDIT_SOURCE.TOTAL : defaultEditSource
  );
  const quantity = options.quantity ?? getProductMin(safeProduct);
  const unitPrice = options.unitPrice ?? safeProduct.price;
  const lineTotal = options.lineTotal ?? roundMoney(quantity * unitPrice);
  const draft = editSource === ITEM_MODAL_EDIT_SOURCE.TOTAL
    ? syncLineDraftFromTotal(safeProduct, { quantity, unitPrice, lineTotal })
    : syncLineDraftFromQuantity(safeProduct, { quantity, unitPrice, lineTotal });

  refs.searchInput?.blur();
  setItemModalEditSource(editSource);
  state.currentProduct = safeProduct;
  state.currentProductCartIndex = cartIndex;
  refs.itemModalName.textContent = safeProduct.name;
  refs.itemModalMeta.textContent = `${product.categoryLabel} · Precio base ${formatCurrency(product.price)} · Stock ${formatProductStock(product)}`;
  refs.itemQuantity.step = String(getProductStep(safeProduct));
  refs.itemQuantity.min = String(getProductMin(safeProduct));
  applyItemModalDraft(draft);
  setModalOpen(refs.itemModal, true);
  const focusField = options.focusField || "total";
  const focusTarget = focusField === "quantity"
    ? refs.itemQuantity
    : focusField === "unitPrice"
      ? refs.itemUnitPrice
      : refs.itemTotal;
  focusAndSelectInput(focusTarget, { preserveGesture: true });
}

function getItemQuickQuantityPresets(product) {
  const minimum = getProductMin(product);
  const step = getProductStep(product);
  const allowDecimals = minimum < 1 || step < 1;
  const sourceValues = allowDecimals
    ? [minimum, step, 0.5, 1, 2, 5]
    : [minimum, 2, 3, 5, 10];
  return [...new Set(
    sourceValues
      .map((value) => normalizeQuantityToStep(value, product))
      .filter((value) => value >= minimum),
  )].slice(0, 5);
}

function renderItemQuickQuantityChips() {
  if (!refs.itemQuickQuantities) {
    return;
  }

  const product = state.currentProduct;
  if (!product) {
    refs.itemQuickQuantities.innerHTML = "";
    return;
  }

  const selectedQuantity = normalizeQuantityToStep(
    refs.itemQuantity.value || getProductMin(product),
    product,
  );
  refs.itemQuickQuantities.innerHTML = getItemQuickQuantityPresets(product)
    .map((quantity) => `
      <button
        class="quick-quantity-chip ${quantity === selectedQuantity ? "is-active" : ""}"
        data-quantity="${quantity}"
        type="button"
      >
        ${escapeHtml(formatQuantity(quantity))} ${escapeHtml(product.unit)}
      </button>
    `)
    .join("");
}

function updateItemRouteDecisionState() {
  if (!refs.itemRouteConfirmButton) {
    return;
  }

  const product = state.currentProduct;
  const quantity = roundItemModalStock(refs.itemQuantity?.value, 0);
  const lineTotal = roundItemModalMoney(refs.itemTotal?.value, 0);
  const unitPrice = roundItemModalMoney(refs.itemUnitPrice?.value, product?.price || 0);
  refs.itemRouteConfirmButton.disabled = !(
    product
    && quantity > 0
    && lineTotal > 0
    && unitPrice > 0
  );
  renderItemPricingHint();
  setItemModalPrimaryActionLabel();
}

function updateRouteCartEditorState() {
  if (!refs.saveRouteCartEditorButton) {
    return;
  }

  const cartItem = state.cart[state.routeCartEditor.index] || null;
  const quantity = roundStock(refs.routeCartEditorQuantity?.value || 0);
  const lineTotal = roundMoney(refs.routeCartEditorTotal?.value || 0);
  const unitPrice = roundMoney(refs.routeCartEditorUnitPrice?.value || 0);
  const product = cartItem ? getCartLineProduct(cartItem) : null;
  refs.saveRouteCartEditorButton.disabled = !(
    cartItem
    && product
    && quantity > 0
    && lineTotal > 0
    && unitPrice > 0
  );
  if (refs.routeCartEditorResetPriceButton) {
    refs.routeCartEditorResetPriceButton.disabled = !product
      || roundMoney(unitPrice) === roundMoney(product.price || 0);
  }
  renderRouteCartEditorHint();
}

function createClientEventId(prefix = "register") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function closeItemModal(options = {}) {
  setItemModalEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  state.currentProduct = null;
  state.currentProductCartIndex = null;
  if (refs.itemQuickQuantities) {
    refs.itemQuickQuantities.innerHTML = "";
  }
  updateItemRouteDecisionState();
  setModalOpen(refs.itemModal, false);
  if (options.focusSearch !== false) {
    focusRouteSearchInput();
  }
}

function syncItemTotalFromQuantity() {
  if (!state.currentProduct) {
    return;
  }

  setItemModalEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  applyItemModalDraft(
    syncLineDraftFromQuantity(state.currentProduct, readItemModalDraft()),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.QUANTITY },
  );
}

function syncItemQuantityFromTotal() {
  if (!state.currentProduct) {
    return;
  }

  setItemModalEditSource(ITEM_MODAL_EDIT_SOURCE.TOTAL);
  const rawValue = String(refs.itemTotal.value || "").trim();
  const parsedValue = parseItemModalDecimal(rawValue, NaN);
  if (!Number.isFinite(parsedValue)) {
    return;
  }

  applyItemModalDraft(
    syncLineDraftFromTotal(state.currentProduct, {
      ...readItemModalDraft(),
      lineTotal: parsedValue,
    }),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.TOTAL },
  );
}

function syncItemFromUnitPrice() {
  if (!state.currentProduct) {
    return;
  }

  applyItemModalDraft(
    syncLineDraftFromUnitPrice(
      state.currentProduct,
      readItemModalDraft(),
      itemModalLastEditedField,
    ),
    { preserveField: "unitPrice" },
  );
}

function finalizeItemTotalInput() {
  if (!state.currentProduct) {
    return;
  }

  const lineTotal = roundItemModalMoney(refs.itemTotal.value);
  if (lineTotal <= 0) {
    applyItemModalDraft(
      syncLineDraftFromTotal(state.currentProduct, {
        ...readItemModalDraft(),
        lineTotal: 0,
      }),
    );
    return;
  }

  applyItemModalDraft(
    syncLineDraftFromTotal(state.currentProduct, {
      ...readItemModalDraft(),
      lineTotal,
    }),
  );
}

function finalizeItemUnitPriceInput() {
  if (!state.currentProduct) {
    return;
  }

  applyItemModalDraft(
    syncLineDraftFromUnitPrice(
      state.currentProduct,
      readItemModalDraft(),
      itemModalLastEditedField,
    ),
  );
}

function adjustItemQuantity(delta) {
  if (!state.currentProduct) {
    return;
  }

  const step = getProductStep(state.currentProduct);
  const nextValue = Math.max(
    getProductMin(state.currentProduct),
    roundStock(toNumber(refs.itemQuantity.value, getProductMin(state.currentProduct)) + delta * step),
  );
  refs.itemQuantity.value = String(nextValue);
  applyItemModalDraft(
    syncLineDraftFromQuantity(state.currentProduct, readItemModalDraft()),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.QUANTITY },
  );
}

function applyItemQuickQuantity(quantity) {
  if (!state.currentProduct) {
    return;
  }

  refs.itemQuantity.value = String(
    normalizeQuantityToStep(quantity, state.currentProduct),
  );
  applyItemModalDraft(
    syncLineDraftFromQuantity(state.currentProduct, readItemModalDraft()),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.QUANTITY },
  );
}

function submitCurrentProductFromKeyboard(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (!refs.itemRouteConfirmButton?.disabled) {
    addCurrentProductToCart();
  }
}

function addCurrentProductToCart() {
  const product = state.currentProduct;

  if (!product) {
    console.warn("Product is null in addCurrentProductToCart");
    showToast("Error: producto no disponible. Refresca la pagina.", "error");
    return;
  }

  const quantity = roundItemModalStock(refs.itemQuantity.value);
  const lineTotal = roundItemModalMoney(refs.itemTotal.value);
  const unitPrice = roundItemModalMoney(refs.itemUnitPrice.value, product.price);

  if (quantity <= 0 || lineTotal <= 0 || unitPrice <= 0) {
    showToast("Captura una cantidad y un monto validos.", "error");
    return;
  }

  // ←←← AQUÍ ESTABA EL ERROR: usabas state.currentProduct después de cerrarlo
  const cartItem = buildCartItem(product, {
    category: product.category,          // ← corregido
    categoryLabel: product.categoryLabel, // ← corregido
    unit: product.unit,
    quantity,
    unitPrice,
    lineTotal,
  });

  const replaceIndex = Number.isInteger(state.currentProductCartIndex)
    ? state.currentProductCartIndex
    : null;
  const changedIndex = upsertCartItem(cartItem, { replaceIndex });
  markRouteCartLineMotion(changedIndex);
  commitCartUiState();

  // Guardamos el nombre ANTES de cerrar el modal
  const productName = product.name;
  const editing = replaceIndex !== null;

  closeItemModal();                    // ← ahora sí se pone a null, pero ya tenemos el nombre

  showToast(
    editing
      ? `${productName} actualizado en el carrito.`
      : `${productName} agregado al carrito.`,
    "success",
  );
}

function removeCartItem(index, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= state.cart.length) {
    return;
  }

  syncCartEditingIndexesAfterRemoval(index, options);
  state.cart.splice(index, 1);
  commitCartUiState();
}

function clearCart() {
  closeRouteCartEditor({ focusSearch: false });
  if (Number.isInteger(state.currentProductCartIndex)) {
    closeItemModal({ focusSearch: false });
  }
  state.cart = [];
  commitCartUiState();
}

function openRouteCartEditor(index) {
  const cartItem = state.cart[index];
  if (!cartItem) {
    return;
  }

  const startTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const product = getCartLineProduct(cartItem);
  if (!product || !isRouteSimpleProduct(product)) {
    openItemModal(product || getEditableProductContext(cartItem), {
      cartIndex: index,
      quantity: cartItem.quantity,
      unitPrice: cartItem.unitPrice,
      lineTotal: cartItem.lineTotal,
      editSource: ITEM_MODAL_EDIT_SOURCE.TOTAL,
      focusField: "total",
    });
    return;
  }

  state.routeCartEditor.index = index;
  setRouteCartEditorEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  refs.routeCartEditorName.textContent = cartItem.name;
  refs.routeCartEditorMeta.textContent =
    `${cartItem.categoryLabel || product.categoryLabel} - Precio base ${formatCurrency(product.price)} - ${formatQuantity(cartItem.quantity)} ${cartItem.unit}`;
  refs.routeCartEditorQuantity.step = String(getProductStep(product));
  refs.routeCartEditorQuantity.min = String(getProductMin(product));
  applyRouteCartEditorDraft(
    syncLineDraftFromQuantity(product, {
      quantity: cartItem.quantity,
      unitPrice: cartItem.unitPrice,
      lineTotal: cartItem.lineTotal,
    }),
  );
  setModalOpen(refs.routeCartEditorModal, true);
  focusAndSelectInput(refs.routeCartEditorQuantity, { preserveGesture: true });
  recordRouteCartEditorOpenDuration(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime,
  );
}

function closeRouteCartEditor(options = {}) {
  state.routeCartEditor.index = null;
  setRouteCartEditorEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  setModalOpen(refs.routeCartEditorModal, false);
  if (options.focusSearch !== false) {
    focusRouteSearchInput();
  }
}

function syncRouteCartEditorFromQuantity() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  setRouteCartEditorEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  applyRouteCartEditorDraft(
    syncLineDraftFromQuantity(getCartLineProduct(cartItem), readRouteCartEditorDraft()),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.QUANTITY },
  );
}

function syncRouteCartEditorFromTotal() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  const rawValue = String(refs.routeCartEditorTotal.value || "").trim();
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    return;
  }

  setRouteCartEditorEditSource(ITEM_MODAL_EDIT_SOURCE.TOTAL);
  applyRouteCartEditorDraft(
    syncLineDraftFromTotal(getCartLineProduct(cartItem), {
      ...readRouteCartEditorDraft(),
      lineTotal: parsedValue,
    }),
    { preserveField: ITEM_MODAL_EDIT_SOURCE.TOTAL },
  );
}

function syncRouteCartEditorFromUnitPrice() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  applyRouteCartEditorDraft(
    syncLineDraftFromUnitPrice(
      getCartLineProduct(cartItem),
      readRouteCartEditorDraft(),
      state.routeCartEditor.editSource,
    ),
    { preserveField: "unitPrice" },
  );
}

function finalizeRouteCartEditorTotalInput() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  applyRouteCartEditorDraft(
    syncLineDraftFromTotal(getCartLineProduct(cartItem), {
      ...readRouteCartEditorDraft(),
      lineTotal: roundMoney(refs.routeCartEditorTotal.value || 0),
    }),
  );
}

function finalizeRouteCartEditorUnitPriceInput() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  applyRouteCartEditorDraft(
    syncLineDraftFromUnitPrice(
      getCartLineProduct(cartItem),
      readRouteCartEditorDraft(),
      state.routeCartEditor.editSource,
    ),
  );
}

function restoreRouteCartEditorBasePrice() {
  const cartItem = state.cart[state.routeCartEditor.index];
  if (!cartItem) {
    return;
  }

  const product = getCartLineProduct(cartItem);
  setRouteCartEditorEditSource(ITEM_MODAL_EDIT_SOURCE.QUANTITY);
  applyRouteCartEditorDraft(
    syncLineDraftFromQuantity(product, {
      ...readRouteCartEditorDraft(),
      unitPrice: product.price,
    }),
  );
}

function saveRouteCartEditor() {
  const index = state.routeCartEditor.index;
  const currentItem = state.cart[index];
  if (!currentItem) {
    return;
  }

  const product = getCartLineProduct(currentItem);
  const quantity = roundStock(refs.routeCartEditorQuantity.value);
  const unitPrice = roundMoney(refs.routeCartEditorUnitPrice.value || product.price);
  const lineTotal = roundMoney(refs.routeCartEditorTotal.value);
  if (quantity <= 0 || unitPrice <= 0 || lineTotal <= 0) {
    showToast("Captura una cantidad y un monto validos.", "error");
    return;
  }

  const nextItem = buildCartItem(product, {
    quantity,
    unitPrice,
    lineTotal,
  });
  const changedIndex = upsertCartItem(nextItem, {
    replaceIndex: index,
    mergeBaseLineProduct: product,
  });
  markRouteCartLineMotion(changedIndex);
  commitCartUiState();
  closeRouteCartEditor();
  showToast(`${product.name} actualizado en el carrito.`, "success");
}

function submitRouteCartEditorFromKeyboard(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (!refs.saveRouteCartEditorButton?.disabled) {
    saveRouteCartEditor();
  }
}

function openCartItemForEditing(index) {
  const cartItem = state.cart[index];
  if (!cartItem) {
    return;
  }

  const product = getCartLineProduct(cartItem);
  if (!product) {
    showToast("No fue posible encontrar ese producto para editar.", "error");
    return;
  }

  if (isRouteModeEnabled() && isRouteSimpleProduct(product)) {
    openRouteCartEditor(index);
    return;
  }

  openItemModal(product, {
    cartIndex: index,
    quantity: cartItem.quantity,
    unitPrice: cartItem.unitPrice,
    lineTotal: cartItem.lineTotal,
    editSource: ITEM_MODAL_EDIT_SOURCE.TOTAL,
    focusField: "total",
  });
}

function quickAdjustCartItemQuantity(index, delta) {
  const currentItem = state.cart[index];
  if (!currentItem) {
    return;
  }

  const product = getCartLineProduct(currentItem);
  const step = getProductStep(product);
  const minimum = getProductMin(product);
  const nextValue = roundStock(toNumber(currentItem.quantity, minimum) + (delta * step));
  if (nextValue < minimum) {
    removeCartItem(index, { focusSearch: false });
    return;
  }

  const nextItem = buildCartItem(product, {
    quantity: nextValue,
    unitPrice: currentItem.unitPrice,
  });
  state.cart[index] = nextItem;
  markRouteCartLineMotion(index);
  commitCartUiState();
}

function quickAddRouteProduct(product) {
  if (!requireCashierSession("Inicia sesion de cajero antes de agregar productos.")) {
    return;
  }

  const startTime =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const cartItem = buildCartItem(product, {
    quantity: getProductMin(product),
    unitPrice: product.price,
  });
  const changedIndex = upsertCartItem(cartItem, {
    mergeBaseLineProduct: product,
  });
  markRouteCartLineMotion(changedIndex);
  commitCartUiState();
  recordRouteQuickAddDuration(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime,
  );
  focusRouteSearchInput();
}

function handleCatalogProductSelection(product, options = {}) {
  if (
    isRouteModeEnabled()
    && isRouteSimpleProduct(product)
    && options.forceModal !== true
  ) {
    quickAddRouteProduct(product);
    return;
  }

  openItemModal(product, options);
}

function getCurrentPaymentReceivedAmount(total = getCartTotal()) {
  if (isCashPaymentMethod(state.paymentMethod)) {
    return roundMoney(state.moneyInput);
  }
  if (isCreditPaymentMethod(state.paymentMethod)) {
    return roundMoney(state.moneyInput);
  }

  return roundMoney(total);
}

function getCurrentPaymentPendingAmount(total = getCartTotal()) {
  return getSalePendingAmount(
    total,
    getCurrentPaymentReceivedAmount(total),
    state.paymentMethod,
  );
}

function getCurrentPaymentReceivedMethod(total = getCartTotal()) {
  return getSaleReceivedPaymentMethod(
    state.paymentMethod,
    state.paymentReceivedMethod,
    getCurrentPaymentReceivedAmount(total),
  );
}

function updatePaymentView() {
  const total = getCartTotal();
  const routeCompact = isRouteModeEnabled();
  const isCash = isCashPaymentMethod(state.paymentMethod);
  const isCredit = isCreditPaymentMethod(state.paymentMethod);
  const receivedAmount = getCurrentPaymentReceivedAmount(total);
  const pendingAmount = getCurrentPaymentPendingAmount(total);
  const changeAmount = isCash ? roundMoney(receivedAmount - total) : 0;
  const customerRequired = requiresPaymentCustomer(state.paymentMethod);
  const hasCustomer = Boolean(String(state.paymentCustomerName || "").trim());
  const receivedMethod = getCurrentPaymentReceivedMethod(total);
  const hasReceivedMethod = Boolean(receivedMethod);
  const invalidCreditSettlement = isCredit && pendingAmount <= 0;

  refs.paymentTotal.textContent = formatCurrency(total);
  refs.moneyDisplay.textContent = formatCurrency(receivedAmount);
  refs.paymentReceived.textContent = formatCurrency(receivedAmount);
  if (refs.paymentReceivedLabel) {
    refs.paymentReceivedLabel.textContent = isCredit ? "Abono hoy" : "Recibido";
  }
  if (refs.paymentChangeLabel) {
    refs.paymentChangeLabel.textContent = isCredit ? "Pendiente" : "Cambio";
  }
  refs.paymentChange.textContent =
    isCash
      ? changeAmount >= 0
        ? formatCurrency(changeAmount)
        : "Falta efectivo"
      : isCredit
        ? formatCurrency(pendingAmount)
        : formatCurrency(0);

  refs.confirmSaleButton.disabled =
    total <= 0
    || (isCash && receivedAmount < total)
    || (customerRequired && !hasCustomer)
    || invalidCreditSettlement
    || (isCredit && receivedAmount > 0 && !hasReceivedMethod);
  if (refs.paymentRouteConfirmButton) {
    refs.paymentRouteConfirmButton.disabled = refs.confirmSaleButton.disabled;
  }

  refs.cashPaymentBlock.style.display = isCash || isCredit ? "block" : "none";
  if (refs.paymentExactShortcutButton) {
    refs.paymentExactShortcutButton.textContent = isCredit
      ? "Sin abono"
      : `Exacto ${formatCurrency(total)}`;
    refs.paymentExactShortcutButton.disabled = total <= 0 && !isCredit;
  }
  if (refs.paymentCustomerField) {
    refs.paymentCustomerField.hidden = isCash;
  }
  if (refs.paymentCustomerLabel) {
    refs.paymentCustomerLabel.textContent = getPaymentCustomerFieldLabel(state.paymentMethod);
  }
  if (refs.paymentCustomerInput) {
    refs.paymentCustomerInput.required = customerRequired;
    refs.paymentCustomerInput.placeholder = getPaymentCustomerPlaceholder(state.paymentMethod);
    if (refs.paymentCustomerInput.value !== state.paymentCustomerName) {
      refs.paymentCustomerInput.value = state.paymentCustomerName;
    }
  }
  if (refs.paymentReceivedMethodField) {
    refs.paymentReceivedMethodField.hidden = !isCredit || receivedAmount <= 0;
  }
  if (refs.paymentReceivedMethodInput) {
    const normalizedMethod = normalizeReceivedPaymentMethod(
      state.paymentReceivedMethod,
      "Efectivo",
    );
    refs.paymentReceivedMethodInput.required = isCredit && receivedAmount > 0;
    refs.paymentReceivedMethodInput.disabled = !isCredit || receivedAmount <= 0;
    if (refs.paymentReceivedMethodInput.value !== normalizedMethod) {
      refs.paymentReceivedMethodInput.value = normalizedMethod;
    }
  }
  if (refs.paymentNoteField) {
    refs.paymentNoteField.hidden = isCash;
  }
  if (refs.paymentNoteInput) {
    refs.paymentNoteInput.placeholder = getPaymentNotePlaceholder(state.paymentMethod);
    if (refs.paymentNoteInput.value !== state.paymentNote) {
      refs.paymentNoteInput.value = state.paymentNote;
    }
  }
  if (refs.paymentContextNote) {
    if (!isCredit) {
      refs.paymentContextNote.textContent = routeCompact
        ? (
          isCash
            ? "Captura lo recibido para calcular el cambio."
            : "Se registra como no efectivo y no aumenta el efectivo esperado."
        )
        : getPaymentContextCopy(state.paymentMethod);
    } else if (receivedAmount <= 0) {
      refs.paymentContextNote.textContent =
        routeCompact
          ? "Todo quedara pendiente. Si hay abono hoy, capturalo con su medio."
          : "Todo el ticket quedara pendiente. Si hoy te pagan una parte, captura el abono y el medio para que caja cuadre.";
    } else if (invalidCreditSettlement) {
      refs.paymentContextNote.textContent =
        routeCompact
          ? "Si liquida todo hoy, usa un metodo directo en lugar de Fiado."
          : "Si el cliente liquida todo hoy, usa Efectivo, Tarjeta o Transferencia en lugar de Fiado.";
    } else {
      refs.paymentContextNote.textContent =
        routeCompact
          ? `Cobras ${formatCurrency(receivedAmount)} hoy por ${receivedMethod || "Efectivo"} y quedan ${formatCurrency(pendingAmount)} pendientes.`
          : `Se cobran ${formatCurrency(receivedAmount)} hoy por ${receivedMethod || "Efectivo"} y quedan ${formatCurrency(pendingAmount)} pendientes.`;
    }
  }

  refs.paymentMethods.querySelectorAll("[data-method]").forEach((button) => {
    button.classList.toggle("active", button.dataset.method === state.paymentMethod);
  });
}

function openPaymentModal() {
  if (!requireCashierSession("Inicia sesion de cajero antes de cobrar.")) {
    return;
  }

  if (state.register.summary?.cashierLocked) {
    showToast("Este cajero ya hizo corte final hoy. Venta bloqueada hasta el siguiente dia.", "error");
    return;
  }

  if (state.cart.length === 0) {
    showToast("Agrega productos antes de cobrar.", "error");
    return;
  }

  state.moneyInput = "0";
  state.paymentMethod = "Efectivo";
  state.paymentReceivedMethod = "Efectivo";
  state.paymentCustomerName = "";
  state.paymentNote = "";
  updatePaymentView();
  setModalOpen(refs.paymentModal, true);
}

function closePaymentModal() {
  setModalOpen(refs.paymentModal, false);
  focusRouteSearchInput();
}

function appendMoneyInput(fragment) {
  if (fragment === "." && state.moneyInput.includes(".")) {
    return;
  }

  if (fragment === "00" && state.moneyInput === "0") {
    state.moneyInput = "0";
  } else if (state.moneyInput === "0" && fragment !== ".") {
    state.moneyInput = fragment;
  } else {
    state.moneyInput += fragment;
  }

  updatePaymentView();
}

function clearMoneyInput() {
  state.moneyInput = "0";
  updatePaymentView();
}

function addMoneyShortcut(amount) {
  const shortcutAmount = roundMoney(amount);
  if (shortcutAmount <= 0) {
    return;
  }

  state.moneyInput = String(shortcutAmount);
  updatePaymentView();
}

function setMoneyToExactTotal() {
  if (isCreditPaymentMethod(state.paymentMethod)) {
    state.moneyInput = "0";
    updatePaymentView();
    return;
  }

  state.moneyInput = String(roundMoney(getCartTotal()));
  updatePaymentView();
}

function getExactReceivableCustomerMatches(customers = [], customerName = "") {
  const normalizedName = normalizeSearchText(customerName);
  if (!normalizedName) {
    return [];
  }

  return (Array.isArray(customers) ? customers : []).filter((customer) =>
    normalizeSearchText(customer?.customerName || "") === normalizedName
  );
}

async function resolveExistingReceivableCustomerKeyForSale(customerName) {
  if (!isCreditPaymentMethod(state.paymentMethod)) {
    return "";
  }

  const normalizedName = normalizeSearchText(customerName);
  if (!normalizedName || !state.cashier.authenticated) {
    return "";
  }

  const cachedMatches = getExactReceivableCustomerMatches(
    state.receivables?.customers || [],
    customerName,
  );
  if (cachedMatches.length === 1) {
    return String(cachedMatches[0].customerKey || "");
  }

  const cachedCustomer = typeof findCachedReceivableCustomerByName === "function"
    ? findCachedReceivableCustomerByName(customerName, getActiveCashierBranch())
    : null;
  if (cachedCustomer?.customerKey) {
    return String(cachedCustomer.customerKey);
  }

  if (!state.online) {
    return "";
  }

  try {
    const response = await requestCashierJson(
      `/api/receivables?search=${encodeURIComponent(customerName)}`,
      { timeoutMs: 3500 },
    );
    const exactMatches = getExactReceivableCustomerMatches(response?.customers || [], customerName);
    return exactMatches.length === 1
      ? String(exactMatches[0].customerKey || "")
      : "";
  } catch (_error) {
    return "";
  }
}

function backspaceMoneyInput() {
  if (state.moneyInput.length <= 1) {
    state.moneyInput = "0";
  } else {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  if (state.moneyInput.endsWith(".")) {
    state.moneyInput = state.moneyInput.slice(0, -1);
  }

  updatePaymentView();
}

async function submitSale() {
  if (!requireCashierSession("Inicia sesion de cajero antes de completar la venta.")) {
    return;
  }

  const latestSummary = await loadRegisterSummary({ silent: true });
  if (latestSummary?.cashierLocked) {
    showToast("Este cajero ya hizo corte final hoy. No puedes registrar mas ventas.", "error");
    return;
  }

  const customerName = String(state.paymentCustomerName || "").trim();
  const note = String(state.paymentNote || "").trim();
  const total = getCartTotal();
  const receivedAmount = getCurrentPaymentReceivedAmount(total);
  const pendingAmount = getCurrentPaymentPendingAmount(total);
  const receivedPaymentMethod = getCurrentPaymentReceivedMethod(total);
  const customerKey = isCreditPaymentMethod(state.paymentMethod)
    ? await resolveExistingReceivableCustomerKeyForSale(customerName)
    : "";
  if (requiresPaymentCustomer(state.paymentMethod) && !customerName) {
    showToast("Captura el nombre del cliente antes de guardar el fiado.", "error");
    refs.paymentCustomerInput?.focus();
    return;
  }
  if (isCreditPaymentMethod(state.paymentMethod) && pendingAmount <= 0) {
    showToast("Si el cliente liquida todo hoy, usa un metodo directo en lugar de fiado.", "error");
    return;
  }

  const payload = {
    clientSaleId: createClientEventId("sale"),
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    paymentMethod: state.paymentMethod,
    receivedAmount,
    receivedPaymentMethod,
    customerName,
    customerKey,
    notes: note,
    items: state.cart.map((item) => ({
      productId: item.productId,
      productName: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };

  refs.confirmSaleButton.disabled = true;
  refs.confirmSaleButton.textContent = "Guardando...";

  try {
    const response = await requestCashierJson("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
      queueable: true,
    });

    state.cart = [];
    saveCart();
    renderCart();
    applySnapshot(response.snapshot);
    void loadRegisterSummary({ silent: true });
    if (typeof refreshReceivablesUi === "function" && isCreditPaymentMethod(payload.paymentMethod)) {
      void refreshReceivablesUi({ silent: true });
    }
    closePaymentModal();
    showToast(`Venta ${response.sale.ticketNumber} registrada.`, "success");
  } catch (error) {
    if (error.message.includes("modo offline")) {
      const tempSale = applyOptimisticSale(payload);
      registerPendingOfflineSale(payload, {
        tempSale,
        queueOperationId: error.queuedOperationId || "",
      });
      if (typeof refreshOfflineSalesUi === "function") {
        refreshOfflineSalesUi();
      }
      if (typeof refreshReceivablesUi === "function" && isCreditPaymentMethod(payload.paymentMethod)) {
        void refreshReceivablesUi({ silent: true });
      }
      state.cart = [];
      saveCart();
      renderCart();
      void loadRegisterSummary({ silent: true });
      closePaymentModal();
      showToast(error.message, "info");
    } else {
      showToast(error.message, "error");
    }
  } finally {
    refs.confirmSaleButton.disabled = false;
    refs.confirmSaleButton.textContent = "Completar venta";
    updatePaymentView();
  }
}

async function loadRegisterSummary(options = {}) {
  if (!state.cashier.authenticated) {
    state.register.summary = getEmptyRegisterSummary();
    clearCashierBlindAuditPrompt();
    renderRegisterSummaryPill();
    renderCashierSession();
    return state.register.summary;
  }

  if (!refs.shiftSelect) {
    return null;
  }

  const shift = options.shift || refs.shiftSelect.value;
  if (!options.silent) {
    state.register.loading = true;
    renderRegisterModal();
  }

  try {
    const response = await requestCashierJson(
      `/api/register/summary?shift=${encodeURIComponent(shift)}&branch=${encodeURIComponent(getActiveCashierBranch())}&cashier=${encodeURIComponent(state.cashier.name || "Mostrador")}`,
    );
    const serverSummary = response?.summary
      ? response.summary
      : response?.shift
        ? response
        : getEmptyRegisterSummary();
    
    // Combinar con eventos offline
    const offlineEvents = getRegisterEventsForCurrentShift();
    const combinedSummary = calculateRegisterSummaryWithOffline(serverSummary, offlineEvents);
    
    state.register.summary = combinedSummary;
    setCashierBlindAuditPrompt(response?.blindAuditPrompt || null, {
      open: options.openBlindAudit !== false,
    });
    renderRegisterSummaryPill();
    renderCashierSession();
    return state.register.summary;
  } catch (error) {
    // Si hay error, usar solo eventos offline
    const offlineEvents = getRegisterEventsForCurrentShift();
    if (offlineEvents.length > 0) {
      const emptySummary = getEmptyRegisterSummary();
      state.register.summary = calculateRegisterSummaryWithOffline(emptySummary, offlineEvents);
      renderRegisterSummaryPill();
      renderCashierSession();
      return state.register.summary;
    }
    
    if (!options.silent) {
      showToast(error.message, "error");
    }
    return null;
  } finally {
    state.register.loading = false;
    renderRegisterModal();
  }
}

function clearCashierBlindAuditPrompt() {
  if (cashierBlindAuditPreviewTimerId) {
    window.clearTimeout(cashierBlindAuditPreviewTimerId);
    cashierBlindAuditPreviewTimerId = null;
  }
  cashierBlindAuditPreviewRequestId += 1;
  state.cashierBlindAudit.prompt = null;
  state.cashierBlindAudit.draftItems = {};
  state.cashierBlindAudit.previewByItemId = {};
  state.cashierBlindAudit.loading = false;
  state.cashierBlindAudit.saving = false;
  state.cashierBlindAudit.previewing = false;
  if (refs.cashierBlindAuditModal) {
    setModalOpen(refs.cashierBlindAuditModal, false);
  }
  if (typeof renderCashierBlindAuditModal === "function") {
    renderCashierBlindAuditModal();
  }
}

function setCashierBlindAuditPrompt(prompt, options = {}) {
  const items = Array.isArray(prompt?.items) ? prompt.items : [];
  const needsCapture = items.length > 0 && items.some((item) => item.countedStock == null);
  if (!prompt || items.length === 0 || !needsCapture) {
    clearCashierBlindAuditPrompt();
    return null;
  }

  const sameSession = Number(state.cashierBlindAudit.prompt?.sessionId || 0) === Number(prompt.sessionId || 0);
  const nextDrafts = sameSession
    ? { ...(state.cashierBlindAudit.draftItems || {}) }
    : {};
  const nextPreviews = sameSession
    ? { ...(state.cashierBlindAudit.previewByItemId || {}) }
    : {};

  items.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(nextDrafts, item.itemId)) {
      nextDrafts[item.itemId] = item.countedStock == null ? "" : String(item.countedStock);
    }
    if (item.difference != null) {
      nextPreviews[item.itemId] = {
        difference: item.difference,
        status: item.difference === 0 ? "match" : item.difference < 0 ? "shortage" : "surplus",
      };
    } else if (!sameSession) {
      delete nextPreviews[item.itemId];
    }
  });

  state.cashierBlindAudit.prompt = prompt;
  state.cashierBlindAudit.draftItems = nextDrafts;
  state.cashierBlindAudit.previewByItemId = nextPreviews;
  state.cashierBlindAudit.loading = false;
  state.cashierBlindAudit.saving = false;
  state.cashierBlindAudit.previewing = false;
  if (typeof renderCashierBlindAuditModal === "function") {
    renderCashierBlindAuditModal();
  }
  if (refs.cashierBlindAuditModal && options.open !== false) {
    setModalOpen(refs.cashierBlindAuditModal, true);
    window.requestAnimationFrame(() => {
      refs.cashierBlindAuditItems?.querySelector("input")?.focus();
      refs.cashierBlindAuditItems?.querySelector("input")?.select();
    });
  }
  return prompt;
}

function updateCashierBlindAuditDraft(itemId, value) {
  const safeItemId = Number(itemId);
  if (!Number.isInteger(safeItemId) || safeItemId <= 0) {
    return;
  }

  state.cashierBlindAudit.draftItems = {
    ...(state.cashierBlindAudit.draftItems || {}),
    [safeItemId]: value,
  };
  updateCashierBlindAuditSummaryDom?.();
  updateCashierBlindAuditDifferenceDom?.(safeItemId);
  scheduleCashierBlindAuditPreview();
}

let cashierBlindAuditPreviewTimerId = null;
let cashierBlindAuditPreviewRequestId = 0;

function parseCashierBlindAuditCountedStock(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function scheduleCashierBlindAuditPreview() {
  if (cashierBlindAuditPreviewTimerId) {
    window.clearTimeout(cashierBlindAuditPreviewTimerId);
    cashierBlindAuditPreviewTimerId = null;
  }

  const prompt = state.cashierBlindAudit.prompt;
  if (!prompt || !Array.isArray(prompt.items) || prompt.items.length === 0 || !state.online) {
    return;
  }

  const payloadItems = [];
  const localPreviewOverrides = {};
  let hasValue = false;

  prompt.items.forEach((item) => {
    const rawValue = String(state.cashierBlindAudit.draftItems?.[item.itemId] ?? item.countedStock ?? "").trim();
    if (rawValue === "") {
      return;
    }

    hasValue = true;
    const countedStock = parseCashierBlindAuditCountedStock(rawValue);
    if (!Number.isFinite(countedStock) || countedStock < 0) {
      localPreviewOverrides[item.itemId] = {
        difference: null,
        status: "invalid",
      };
      return;
    }

    payloadItems.push({
      itemId: item.itemId,
      countedStock: roundStock(countedStock),
    });
  });

  state.cashierBlindAudit.previewByItemId = {
    ...(state.cashierBlindAudit.previewByItemId || {}),
    ...localPreviewOverrides,
  };

  if (!hasValue) {
    state.cashierBlindAudit.previewByItemId = {};
    state.cashierBlindAudit.previewing = false;
    refreshCashierBlindAuditInlineState?.();
    return;
  }

  const requestId = cashierBlindAuditPreviewRequestId + 1;
  cashierBlindAuditPreviewRequestId = requestId;
  state.cashierBlindAudit.previewing = true;
  refreshCashierBlindAuditInlineState?.();

  cashierBlindAuditPreviewTimerId = window.setTimeout(async () => {
    cashierBlindAuditPreviewTimerId = null;
    try {
      const response = await requestCashierJson(`/api/register/weighted-audit/${prompt.sessionId}/blind/preview`, {
        method: "POST",
        body: JSON.stringify({ items: payloadItems }),
      });
      if (requestId !== cashierBlindAuditPreviewRequestId) {
        return;
      }

      state.cashierBlindAudit.previewByItemId = Object.fromEntries(
        [
          ...(Array.isArray(response?.previews) ? response.previews : []).map((entry) => [
            Number(entry.itemId),
            {
              difference: entry.difference == null ? null : roundStock(entry.difference),
              status: entry.status || "pending",
            },
          ]),
          ...Object.entries(localPreviewOverrides).map(([itemId, preview]) => [
            Number(itemId),
            preview,
          ]),
        ],
      );
    } catch (_error) {
      if (requestId !== cashierBlindAuditPreviewRequestId) {
        return;
      }
    } finally {
      if (requestId === cashierBlindAuditPreviewRequestId) {
        state.cashierBlindAudit.previewing = false;
        refreshCashierBlindAuditInlineState?.();
      }
    }
  }, 160);
}

async function saveCashierBlindAuditCapture() {
  const prompt = state.cashierBlindAudit.prompt;
  if (!prompt || !Array.isArray(prompt.items) || prompt.items.length === 0) {
    return;
  }
  if (state.cashierBlindAudit.saving) {
    return;
  }

  const payloadItems = [];
  for (const item of prompt.items) {
    const rawValue = String(state.cashierBlindAudit.draftItems?.[item.itemId] ?? item.countedStock ?? "").trim();
    if (rawValue === "") {
      showToast(`Captura el pesado de ${item.productName} antes de continuar.`, "error");
      refs.cashierBlindAuditItems?.querySelector(`[data-blind-audit-item-id="${item.itemId}"]`)?.focus();
      return;
    }

    const countedStock = parseCashierBlindAuditCountedStock(rawValue);
    if (!Number.isFinite(countedStock) || countedStock < 0) {
      showToast(`El pesado de ${item.productName} no es valido.`, "error");
      refs.cashierBlindAuditItems?.querySelector(`[data-blind-audit-item-id="${item.itemId}"]`)?.focus();
      return;
    }

    payloadItems.push({
      itemId: item.itemId,
      countedStock: roundStock(countedStock),
    });
  }

  state.cashierBlindAudit.saving = true;
  if (typeof renderCashierBlindAuditModal === "function") {
    renderCashierBlindAuditModal();
  }

  try {
    const response = await requestCashierJson(`/api/register/weighted-audit/${prompt.sessionId}/blind`, {
      method: "PATCH",
      body: JSON.stringify({ items: payloadItems }),
    });
    showToast("Pesado ciego guardado. El admin ya puede revisar diferencias.", "success");
    clearCashierBlindAuditPrompt();
    await loadRegisterSummary({ silent: true, openBlindAudit: false });
    setCashierBlindAuditPrompt(response?.prompt || null, { open: false });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.cashierBlindAudit.saving = false;
    if (typeof renderCashierBlindAuditModal === "function") {
      renderCashierBlindAuditModal();
    }
  }
}

function applyRegisterWithdraw() {
  if (state.register.mode === "start") {
    showToast("El retiro solo aplica en corte rapido o final.", "info");
    return;
  }

  const summary = state.register.summary || getEmptyRegisterSummary();
  const withdrawAmount = roundMoney(state.register.withdrawInput);
  if (!Number.isFinite(withdrawAmount) || withdrawAmount < 0) {
    showToast("El monto de retiro no es valido.", "error");
    return;
  }

  const nextCounted = Math.max(0, roundMoney((summary.expectedCash || 0) - withdrawAmount));
  state.register.amountInput = String(nextCounted);
  renderRegisterModal();
}

async function openRegisterModal(mode) {
  if (!requireCashierSession("Inicia sesion de cajero para usar la caja.")) {
    return;
  }

  state.register.mode = mode;
  state.register.note = "";
  state.register.amountInput = "";
  state.register.withdrawInput = "0";
  setModalOpen(refs.registerModal, true);
  const summary = await loadRegisterSummary();
  if (summary?.cashierLocked && mode !== "start") {
    showToast("Este cajero ya hizo corte final hoy y no puede registrar nuevos cortes.", "error");
  }
  if (mode === "start") {
    state.register.amountInput = "";
    state.register.withdrawInput = "0";
  } else {
    state.register.amountInput = String(summary?.expectedCash ?? 0);
    state.register.withdrawInput = "0";
  }
  renderRegisterModal();
  focusRegisterAmount();
}

function closeRegisterModal() {
  setModalOpen(refs.registerModal, false);
}

function focusRegisterAmount() {
  if (!refs.registerModal?.classList.contains("open")) {
    return;
  }

  window.requestAnimationFrame(() => {
    refs.registerAmountInput?.focus();
    refs.registerAmountInput?.select();
  });
}

async function saveRegisterAction() {
  if (!requireCashierSession("Inicia sesion de cajero para registrar caja.")) {
    return;
  }

  if (state.register.saving) {
    return;
  }

  const rawValue = String(state.register.amountInput || "").trim();
  if (rawValue === "") {
    showToast("Captura un monto antes de continuar.", "error");
    focusRegisterAmount();
    return;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    showToast("El monto capturado no es valido.", "error");
    focusRegisterAmount();
    return;
  }

  const payload = {
    shift: refs.shiftSelect.value,
    cashier: state.cashier.name || "Mostrador",
    branch: getActiveCashierBranch(),
    notes: state.register.note.trim(),
    clientEventId: createClientEventId("register"),
  };

  if (state.register.summary?.cashierLocked) {
    showToast("Este cajero ya hizo corte final hoy y no puede registrar nuevos cortes.", "error");
    return;
  }

  let url = "/api/register/start";
  if (state.register.mode === "start") {
    payload.openingAmount = roundMoney(numericValue);
  } else {
    const withdrawAmount = roundMoney(state.register.withdrawInput);
    if (!Number.isFinite(withdrawAmount) || withdrawAmount < 0) {
      showToast("El monto de retiro no es valido.", "error");
      return;
    }
    if (withdrawAmount > 0 && !payload.notes) {
      showToast("Agrega una nota de motivo cuando registres un retiro.", "error");
      return;
    }
    url = "/api/register/cut";
    payload.eventType = state.register.mode;
    payload.countedAmount = roundMoney(numericValue);
    payload.withdrawalsAmount = withdrawAmount;
  }

  state.register.saving = true;
  renderRegisterModal();

  try {
    // Caja se maneja con su propio log offline (state.register.events),
    // para evitar duplicados no debe entrar tambien a la cola general.
    const response = await requestCashierJson(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (response.snapshot) {
      applySnapshot(response.snapshot);
    }
    state.register.summary = response.summary || state.register.summary;
    renderRegisterSummaryPill();
    renderCashierSession();
    closeRegisterModal();

    if (
      state.register.mode === "final_cut"
      && Array.isArray(response?.blindAuditPrompt?.items)
      && response.blindAuditPrompt.items.length > 0
    ) {
      setCashierBlindAuditPrompt(response.blindAuditPrompt);
      showToast(
        `Corte final guardado. Ahora captura la bascula de ${response.blindAuditPrompt.items.length} producto(s) por kilo.`,
        "success",
      );
    } else {
      showToast(
        state.register.mode === "start"
          ? "Inicio de caja guardado."
          : response.overWithdrawalAmount > 0
            ? `Corte guardado. Diferencia ${formatCurrency(response.differenceAmount || 0)} · Retiro excedido ${formatCurrency(response.overWithdrawalAmount)}.`
            : `Corte guardado. Diferencia ${formatCurrency(response.differenceAmount || 0)}.`,
        "success",
      );
    }
  } catch (error) {
    if (isNetworkError(error)) {
      const offlineEvent = addOfflineRegisterEvent({
        clientEventId: payload.clientEventId,
        eventType: state.register.mode,
        shift: payload.shift,
        cashier: payload.cashier,
        branch: payload.branch,
        notes: payload.notes,
        openingAmount: payload.openingAmount || 0,
        countedAmount: payload.countedAmount || 0,
        expectedCash: state.register.summary?.expectedCash || 0,
        cashSales: state.register.summary?.cashSales || 0,
        withdrawalsAmount: payload.withdrawalsAmount || 0,
        differenceAmount: payload.countedAmount
          ? roundMoney(
            payload.countedAmount
              - ((state.register.summary?.expectedCash || 0) - (payload.withdrawalsAmount || 0)),
          )
          : 0,
      });

      if (state.register.mode === "start") {
        state.register.summary = {
          ...state.register.summary,
          openingAmount: (state.register.summary?.openingAmount || 0) + payload.openingAmount,
          lastStartAt: offlineEvent.createdAt,
          lastStartCashier: payload.cashier,
        };
      } else {
        const nextWithdrawals = roundMoney(
          (state.register.summary?.withdrawalsAmount || 0) + (payload.withdrawalsAmount || 0),
        );
        state.register.summary = {
          ...state.register.summary,
          withdrawalsAmount: nextWithdrawals,
          expectedCash: roundMoney(
            (state.register.summary?.expectedCash || 0) - (payload.withdrawalsAmount || 0),
          ),
          quickCuts: state.register.summary?.quickCuts + (state.register.mode === "quick_cut" ? 1 : 0),
          finalCuts: state.register.summary?.finalCuts + (state.register.mode === "final_cut" ? 1 : 0),
          cashierLocked: state.register.mode === "final_cut"
            ? true
            : Boolean(state.register.summary?.cashierLocked),
          cashierFinalCutAt: state.register.mode === "final_cut"
            ? offlineEvent.createdAt
            : state.register.summary?.cashierFinalCutAt || null,
        };
      }

      saveRegisterEvents();
      renderRegisterSummaryPill();
      renderCashierSession();
      closeRegisterModal();
      showToast(
        state.register.mode === "final_cut"
          ? "Corte final guardado offline. Al reconectar se pedira el pesado ciego de bascula si aplica."
          : "Corte guardado offline. Se sincronizara al reconectar.",
        "info",
      );
    } else {
      showToast(error.message, "error");
    }
  } finally {
    state.register.saving = false;
    renderRegisterModal();
  }
}

async function openActivityDetail(kind, id) {
  if (kind === "sale" && String(id).startsWith("offline-")) {
    state.detailViewer.loading = false;
    state.detailViewer.kind = kind;
    state.detailViewer.detail = state.recentSales.find((sale) => String(sale.id) === String(id)) || null;
    setModalOpen(refs.detailViewerModal, true);
    renderDetailViewer();
    return;
  }

  state.detailViewer.loading = true;
  state.detailViewer.kind = kind;
  state.detailViewer.detail = null;
  setModalOpen(refs.detailViewerModal, true);
  renderDetailViewer();

  try {
    const activityUrl = `/api/activity/${encodeURIComponent(kind)}/${id}`;
    const response = state.cashier.token
      ? await requestCashierJson(activityUrl)
      : state.admin.authenticated
        ? await requestAdminJson(activityUrl)
        : state.owner.authenticated
          ? await requestOwnerJson(activityUrl)
          : await performJsonRequest(activityUrl);
    state.detailViewer.kind = response.kind;
    state.detailViewer.detail = response.detail;
  } catch (error) {
    if (kind === "sale" && isNetworkError(error)) {
      state.detailViewer.kind = "sale";
      state.detailViewer.detail =
        state.recentSales.find((sale) => String(sale.id) === String(id)) || null;
      if (state.detailViewer.detail) {
        showToast("Mostrando ticket desde cache offline.", "info");
      } else {
        showToast("No se encontro el ticket en cache local.", "error");
      }
    } else {
      showToast(error.message, "error");
    }
  } finally {
    state.detailViewer.loading = false;
    renderDetailViewer();
  }
}

function closeDetailViewer() {
  setModalOpen(refs.detailViewerModal, false);
}
