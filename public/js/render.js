function showToast(message, type = "info") {
  if (!refs.toastRegion) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  refs.toastRegion.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

let filteredProductsCache = {
  source: null,
  category: "",
  search: "",
  result: [],
};
let productsRenderQueued = false;

function renderRouteMode() {
  const enabled = isRouteModeEnabled();
  const mobileUi = shouldUseRouteMobileUi();
  if (typeof document !== "undefined") {
    document.body.classList.toggle("route-mode", enabled);
    document.body.classList.toggle("route-mobile-mode", mobileUi);
  }
  if (refs.toggleRouteModeButton) {
    refs.toggleRouteModeButton.classList.toggle("is-active", enabled);
    refs.toggleRouteModeButton.setAttribute("aria-pressed", enabled ? "true" : "false");
    refs.toggleRouteModeButton.textContent = enabled ? "Modo ruta activo" : "Modo ruta";
  }
  if (refs.routeModePill) {
    refs.routeModePill.textContent = enabled ? "Ruta agilizada" : "Vista completa";
  }
}

function renderCashierSession() {
  const branchLabel = getBranchLabel(getActiveCashierBranch());
  const cashierLabel = state.cashier.name || "Sin sesion";
  const sessionText = state.cashier.authenticated
    ? `${cashierLabel} en ${branchLabel}`
    : "Sin iniciar sesion";
  const offlineSalesSummary = typeof getOfflineSalesStatusSummary === "function"
    ? getOfflineSalesStatusSummary()
    : {
        pending: 0,
        requiresReview: 0,
        synced: 0,
        rejected: 0,
        outstanding: 0,
      };
  const pendingOfflineSalesCount = typeof getPendingOfflineSalesCount === "function"
    ? getPendingOfflineSalesCount()
    : 0;

  if (refs.branchDisplay) {
    refs.branchDisplay.value = branchLabel;
  }

  if (refs.cashierInput) {
    refs.cashierInput.value = cashierLabel;
  }

  if (refs.cashierSessionLabel) {
    refs.cashierSessionLabel.textContent = sessionText;
  }

  if (refs.cashierSessionHelper) {
    refs.cashierSessionHelper.textContent = state.cashier.authenticated
      ? pendingOfflineSalesCount > 0
        ? offlineSalesSummary.requiresReview > 0
          ? `Este dispositivo tiene ${pendingOfflineSalesCount} venta(s) offline pendientes; ${offlineSalesSummary.requiresReview} requiere(n) revision antes de cerrar la cola.`
          : `Este dispositivo tiene ${pendingOfflineSalesCount} venta(s) offline pendientes por sincronizar.`
        : "Puedes cambiar de sucursal o cerrar la sesion del cajero cuando lo necesites."
      : state.online
        ? pendingOfflineSalesCount > 0
          ? offlineSalesSummary.requiresReview > 0
            ? `Tienes ${pendingOfflineSalesCount} venta(s) offline pendientes. Inicia sesion del mismo cajero y revisa las que quedaron en conflicto.`
            : `Tienes ${pendingOfflineSalesCount} venta(s) offline pendientes. Inicia sesion del mismo cajero para sincronizarlas.`
          : "Selecciona sucursal y entra con la clave del cajero para empezar a vender."
        : "Sin internet: si este cajero ya entro antes en este dispositivo y sucursal, puedes iniciar con su clave para seguir vendiendo offline.";
  }

  if (refs.logoutCashierButton) {
    refs.logoutCashierButton.disabled = !state.cashier.authenticated;
  }

  const isLocked = Boolean(state.register.summary?.cashierLocked);
  if (refs.openPaymentButton) {
    refs.openPaymentButton.disabled = isLocked;
  }
  if (refs.openStartRegisterButton) {
    refs.openStartRegisterButton.disabled = isLocked;
  }
  if (refs.openQuickCutButton) {
    refs.openQuickCutButton.disabled = isLocked;
  }
  if (refs.openFinalCutButton) {
    refs.openFinalCutButton.disabled = isLocked;
  }

  renderRouteMode();
}

function renderSummary() {
  const topProductText = state.summary.topProduct
    ? `${state.summary.topProduct.name} lidera con ${formatCurrency(state.summary.topProduct.total)}`
    : "Sin ventas registradas hoy";

  refs.summaryCards.innerHTML = `
    <article class="stat-card">
      <h3>Ventas de hoy</h3>
      <div class="stat-value">${formatCurrency(state.summary.revenueToday)}</div>
      <div class="stat-foot">${state.summary.ticketsToday} tickets emitidos</div>
    </article>
    <article class="stat-card">
      <h3>Ticket promedio</h3>
      <div class="stat-value">${formatCurrency(state.summary.averageTicket)}</div>
      <div class="stat-foot">${formatQuantity(state.summary.unitsSoldToday)} unidades vendidas</div>
    </article>
    <article class="stat-card">
      <h3>Inventario valorizado</h3>
      <div class="stat-value">${formatCurrency(state.summary.inventoryValue)}</div>
      <div class="stat-foot">${state.summary.catalogSize} productos activos</div>
    </article>
    <article class="stat-card">
      <h3>Alertas de stock</h3>
      <div class="stat-value">${state.summary.lowStockCount}</div>
      <div class="stat-foot">${escapeHtml(topProductText)}</div>
    </article>
  `;
}

function renderCategoryFilters() {
  const products = Array.isArray(state.products) ? state.products : [];
  const categoriesInProducts = new Set(products.map((product) => product.category).filter(Boolean));
  const categories = getCategoryCatalog(true).filter((category) =>
    category.code === "all" || categoriesInProducts.has(category.code)
  );

  refs.categoryFilters.innerHTML = categories
    .map(
      (category) => `
        <button
          class="category-chip ${state.selectedCategory === category.code ? "active" : ""}"
          data-category="${category.code}"
          type="button"
        >
          ${escapeHtml(category.label || category.code)}
        </button>
      `,
    )
    .join("");
}

function getFilteredProducts() {
  const search = refs.searchInput.value.trim().toLowerCase();
  if (
    filteredProductsCache.source === state.products
    && filteredProductsCache.category === state.selectedCategory
    && filteredProductsCache.search === search
  ) {
    return filteredProductsCache.result;
  }

  const result = state.products.filter((product) => {
    const matchesCategory =
      state.selectedCategory === "all" || product.category === state.selectedCategory;
    const matchesSearch = product.name.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });

  filteredProductsCache = {
    source: state.products,
    category: state.selectedCategory,
    search,
    result,
  };

  return result;
}

function resetVisibleProducts() {
  state.visibleProductLimit = PRODUCT_RENDER_BATCH;
  if (refs.productsGrid) {
    refs.productsGrid.scrollTop = 0;
  }
}

function loadMoreProducts() {
  const totalProducts = getFilteredProducts().length;
  if (state.visibleProductLimit >= totalProducts) {
    return;
  }

  state.visibleProductLimit = Math.min(
    totalProducts,
    state.visibleProductLimit + PRODUCT_RENDER_BATCH,
  );
  renderProducts();
}

function requestProductsRender(reset = false) {
  if (reset) {
    resetVisibleProducts();
  }

  if (typeof window === "undefined") {
    renderProducts();
    return;
  }

  if (productsRenderQueued) {
    return;
  }

  productsRenderQueued = true;
  window.requestAnimationFrame(() => {
    productsRenderQueued = false;
    renderProducts();
  });
}

function renderProducts() {
  const renderStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const products = getFilteredProducts();
  const visibleProducts = products.slice(0, state.visibleProductLimit);

  if (products.length === 0) {
    refs.productsGrid.innerHTML = `
      <div class="empty-state">
        No hay productos que coincidan con tu busqueda actual.
      </div>
    `;
    state.performance.productsRenderMs = roundMetric(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
    );
    state.performance.renderedProductCount = 0;
    renderAdminModal();
    return;
  }

  refs.productsGrid.innerHTML = visibleProducts
    .map(
      (product) => `
        <button
          class="product-card ${product.status}"
          data-action="open-product"
          data-product-id="${product.id}"
          type="button"
        >
          <div class="product-top">
            <span class="product-chip">${escapeHtml(product.categoryLabel)}</span>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </div>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="product-bottom">
            <div class="product-stock">
              ${product.status === "capture"
                ? "Captura inicial pendiente"
                : `Quedan ${escapeHtml(formatProductStock(product))}`}
            </div>
            <div class="product-price">${formatCurrency(product.price)}</div>
          </div>
        </button>
      `,
    )
    .join("");

  state.performance.productsRenderMs = roundMetric(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - renderStartedAt,
  );
  state.performance.renderedProductCount = visibleProducts.length;
}

function getCartTotal() {
  return roundMoney(
    state.cart.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0),
  );
}

function getCartCount() {
  return state.cart.length;
}

function renderCart() {
  if (state.cart.length === 0) {
    refs.cartItems.innerHTML = `
      <div class="empty-state">
        El carrito esta vacio. Agrega productos para iniciar una venta.
      </div>
    `;
  } else {
    refs.cartItems.innerHTML = state.cart
      .map(
        (item, index) => `
          <article class="cart-item">
            <div class="cart-item-row">
              <div>
                <div class="cart-item-title">${escapeHtml(item.name)}</div>
                <p class="cart-item-subtitle">
                  ${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)} · ${formatCurrency(item.unitPrice)}
                </p>
              </div>
              <button class="icon-button" data-action="remove-cart-item" data-index="${index}" type="button">×</button>
            </div>
            <div class="cart-item-row">
              <span class="cart-item-subtitle">${escapeHtml(item.categoryLabel)}</span>
              <span class="cart-item-price">${formatCurrency(item.lineTotal)}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  refs.cartCount.textContent = `${getCartCount()} lineas`;
  refs.cartTotal.textContent = formatCurrency(getCartTotal());
}

function renderRecentSales() {
  if (state.recentSales.length === 0) {
    refs.recentSales.innerHTML = `
      <div class="empty-state">
        Cuando registres ventas apareceran aqui en tiempo real.
      </div>
    `;
    return;
  }

  refs.recentSales.innerHTML = state.recentSales
    .map(
      (sale) => {
        const itemsSummary = sale.itemsSummary
          || (Array.isArray(sale.items) && sale.items.length
            ? sale.items
                .map((item) => `${item.productName || item.name || "Producto"} x${formatQuantity(item.quantity || 0)}`)
                .join(" · ")
            : `Venta de ${formatQuantity(sale.itemCount || 0)} articulos`);
        const offlineState =
          String(sale.id || "").startsWith("offline-")
            ? getOfflineSaleDisplayState(
                getOfflineSaleRecordByClientSaleId(sale.clientSaleId)
                || {
                  status: "pending",
                  clientSaleId: sale.clientSaleId || "",
                  branch: sale.branch,
                  cashier: sale.cashier,
                  items: sale.items,
                },
              )
            : null;
        return `
        <button
          class="feed-item"
          data-action="open-activity-detail"
          data-kind="sale"
          data-id="${escapeHtml(String(sale.id))}"
          type="button"
        >
          <div class="feed-meta">
            <strong>${escapeHtml(sale.ticketNumber)}</strong>
            <div class="feed-meta-side">
              ${offlineState ? `<span class="offline-sale-status-pill ${offlineState.status}">${escapeHtml(offlineState.label)}</span>` : ""}
              <span class="feed-total">${formatCurrency(sale.total)}</span>
            </div>
          </div>
          <p>${escapeHtml(itemsSummary)}</p>
          <p>${escapeHtml(sale.cashier)} · ${escapeHtml(sale.shift)} · ${escapeHtml(dateTimeFormatter.format(new Date(sale.createdAt)))}</p>
          ${offlineState ? `<p>${escapeHtml(offlineState.note)}</p>` : ""}
        </button>
      `;
      },
    )
    .join("");
}

function renderLowStock() {
  if (state.lowStock.length === 0) {
    refs.lowStockList.innerHTML = `
      <div class="empty-state">
        Sin alertas. El inventario se ve estable por ahora.
      </div>
    `;
    return;
  }

  refs.lowStockList.innerHTML = state.lowStock
    .map(
      (product) => `
        <article class="alert-item">
          <div class="inventory-meta">
            <strong>${escapeHtml(product.name)}</strong>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </div>
          <p>
            Actual: ${escapeHtml(formatProductStock(product))} · Minimo: ${escapeHtml(formatQuantity(product.minStock))} ${escapeHtml(product.unit)}
          </p>
        </article>
      `,
    )
    .join("");
}

function renderTrendChart() {
  const bars = state.salesByHour;
  const maxValue = Math.max(...bars.map((bar) => bar.total), 1);

  refs.trendChart.innerHTML = bars
    .map((bar) => {
      const height = Math.max(12, Math.round((bar.total / maxValue) * 140));
      return `
        <div class="trend-bar">
          <div class="trend-bar-fill" style="height:${height}px"></div>
          <div class="trend-bar-value">${formatCurrency(bar.total)}</div>
          <div class="trend-bar-label">${escapeHtml(bar.label)}</div>
        </div>
      `;
    })
    .join("");
}

function renderRecentActivity() {
  if (!refs.activityList) {
    return;
  }

  if (state.recentActivity.length === 0) {
    refs.activityList.innerHTML = `
      <div class="empty-state">
        Cuando registres ventas, cortes o ajustes apareceran aqui.
      </div>
    `;
    return;
  }

  refs.activityList.innerHTML = state.recentActivity
    .map(
      (activity) => `
        <button
          class="activity-item"
          data-action="open-activity-detail"
          data-kind="${activity.kind}"
          data-id="${activity.id}"
          type="button"
        >
          <div class="activity-item-head">
            <span class="small-pill">${escapeHtml(activity.tag)}</span>
            <strong>${escapeHtml(formatActivityAmount(activity))}</strong>
          </div>
          <div class="activity-item-body">
            <strong>${escapeHtml(activity.title)}</strong>
            <p>${escapeHtml(activity.subtitle)} · ${escapeHtml(dateTimeFormatter.format(new Date(activity.createdAt)))}</p>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderShiftSummary() {
  if (state.shiftSummary.length === 0) {
    refs.shiftSummary.innerHTML = `
      <div class="shift-chip">Sin tickets registrados hoy</div>
    `;
    return;
  }

  refs.shiftSummary.innerHTML = state.shiftSummary
    .map(
      (item) => `
        <div class="shift-chip">
          ${escapeHtml(item.shift)} · ${item.tickets} tickets · ${formatCurrency(item.total)}
        </div>
      `,
    )
    .join("");
}

function renderInventory() {
  const isComparison = state.admin.branch === "all" && state.admin.inventoryComparison;
  
  if (isComparison) {
    renderInventoryComparison();
  } else {
    renderInventorySingle();
  }
}

function renderInventorySingle() {
  const singleWrapper = document.getElementById("inventory-single-table");
  const comparisonWrapper = document.getElementById("inventory-comparison-wrapper");
  
  if (singleWrapper) singleWrapper.style.display = "";
  if (comparisonWrapper) comparisonWrapper.hidden = true;

  refs.inventoryBody.innerHTML = state.products
    .map(
      (product) => `
        <tr data-product-id="${product.id}">
          <td>
            <div class="inventory-name">
              <strong>${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(product.categoryLabel)} · ${escapeHtml(product.unit)}</small>
            </div>
          </td>
          <td>
            <input class="inventory-input" data-field="price" type="number" min="0" step="0.01" value="${product.price}" />
          </td>
          <td>
            <input class="inventory-input" data-field="stock" type="number" step="${getProductStep(product)}" value="${product.stock}" />
          </td>
          <td>
            <input class="inventory-input" data-field="minStock" type="number" min="0" step="${getProductStep(product)}" value="${product.minStock}" />
          </td>
          <td>
            <label class="inventory-toggle">
              <input data-field="active" type="checkbox" ${product.active ? "checked" : ""} />
              <span>${product.active ? "Activo" : "Inactivo"}</span>
            </label>
          </td>
          <td>
            <input class="inventory-input" data-field="note" type="text" maxlength="120" placeholder="Nota del ajuste" />
          </td>
          <td>
            <span class="status-chip ${product.status}">
              ${getStatusLabel(product.status)}
            </span>
          </td>
          <td>
            <button class="secondary-button" data-action="save-product" type="button">
              Guardar
            </button>
          </td>
          <td>
            <button class="ghost-button danger-button" data-action="remove-product" type="button">
              Quitar
            </button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderInventoryComparison() {
  const singleWrapper = document.getElementById("inventory-single-table");
  const comparisonWrapper = document.getElementById("inventory-comparison-wrapper");
  
  if (singleWrapper) singleWrapper.style.display = "none";
  if (comparisonWrapper) comparisonWrapper.hidden = false;

  const comparison = state.admin.inventoryComparison;
  if (!comparison || !comparison.branches || comparison.branches.length < 2) {
    return;
  }

  const [branch1, branch2] = comparison.branches;

  // Actualizar etiquetas de sucursales
  const label1 = document.getElementById("comparison-branch-1-label");
  const label2 = document.getElementById("comparison-branch-2-label");
  if (label1) label1.textContent = branch1.label;
  if (label2) label2.textContent = branch2.label;

  // Renderizar tabla 1
  const body1 = document.getElementById("inventory-body-branch-1");
  if (body1) {
    body1.innerHTML = branch1.products
      .map(
        (product) => `
          <tr data-product-id="${product.id}" data-branch="${branch1.value}">
            <td>
              <div class="inventory-name">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.categoryLabel)} · ${escapeHtml(product.unit)}</small>
              </div>
            </td>
            <td>
              <input class="inventory-input" data-field="price" type="number" min="0" step="0.01" value="${product.price}" />
            </td>
            <td>
              <input class="inventory-input" data-field="stock" type="number" step="${getProductStep(product)}" value="${product.stock}" />
            </td>
            <td>
              <input class="inventory-input" data-field="minStock" type="number" min="0" step="${getProductStep(product)}" value="${product.minStock}" />
            </td>
            <td>
              <label class="inventory-toggle">
                <input data-field="active" type="checkbox" ${product.active ? "checked" : ""} />
                <span>${product.active ? "Activo" : "Inactivo"}</span>
              </label>
            </td>
            <td>
              <input class="inventory-input" data-field="note" type="text" maxlength="120" placeholder="Nota del ajuste" />
            </td>
            <td>
              <span class="status-chip ${product.status}">
                ${getStatusLabel(product.status)}
              </span>
            </td>
            <td>
              <button class="secondary-button" data-action="save-product" type="button">
                Guardar
              </button>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  // Renderizar tabla 2
  const body2 = document.getElementById("inventory-body-branch-2");
  if (body2) {
    body2.innerHTML = branch2.products
      .map(
        (product) => `
          <tr data-product-id="${product.id}" data-branch="${branch2.value}">
            <td>
              <div class="inventory-name">
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.categoryLabel)} · ${escapeHtml(product.unit)}</small>
              </div>
            </td>
            <td>
              <input class="inventory-input" data-field="price" type="number" min="0" step="0.01" value="${product.price}" />
            </td>
            <td>
              <input class="inventory-input" data-field="stock" type="number" step="${getProductStep(product)}" value="${product.stock}" />
            </td>
            <td>
              <input class="inventory-input" data-field="minStock" type="number" min="0" step="${getProductStep(product)}" value="${product.minStock}" />
            </td>
            <td>
              <label class="inventory-toggle">
                <input data-field="active" type="checkbox" ${product.active ? "checked" : ""} />
                <span>${product.active ? "Activo" : "Inactivo"}</span>
              </label>
            </td>
            <td>
              <input class="inventory-input" data-field="note" type="text" maxlength="120" placeholder="Nota del ajuste" />
            </td>
            <td>
              <span class="status-chip ${product.status}">
                ${getStatusLabel(product.status)}
              </span>
            </td>
            <td>
              <button class="secondary-button" data-action="save-product" type="button">
                Guardar
              </button>
            </td>
          </tr>
        `,
      )
      .join("");
  }
}

function renderRegisterSummaryPill() {
  if (!refs.registerSummaryPill) {
    return;
  }

  const summary = state.register.summary;
  const cashierName = state.cashier.name || "este cajero";
  if (summary?.cashierLocked) {
    refs.registerSummaryPill.textContent = `${cashierName} bloqueado por corte final de hoy.`;
    return;
  }

  if (!summary || !summary.lastStartAt) {
    refs.registerSummaryPill.textContent = `Caja sin iniciar para ${refs.shiftSelect?.value || "este turno"}`;
    return;
  }

  refs.registerSummaryPill.textContent =
    `${summary.shift} · Inicial ${formatCurrency(summary.openingAmount)} · Retira ${formatCurrency(summary.withdrawalsAmount || 0)} · Esperado ${formatCurrency(summary.expectedCash)}`;
}

function renderRegisterModal() {
  if (!refs.registerModal) {
    return;
  }

  const summary = state.register.summary || getEmptyRegisterSummary();
  const isStartMode = state.register.mode === "start";
  const isQuickCutMode = state.register.mode === "quick_cut";
  const isLocked = Boolean(summary.cashierLocked);

  refs.registerModalEyebrow.textContent = isStartMode ? "Inicio de caja" : "Corte de caja";
  refs.registerModalTitle.textContent = isStartMode
    ? "Inicio de dia"
    : isQuickCutMode
      ? "Corte rapido"
      : "Corte final";
  refs.registerModalDescription.textContent = isStartMode
    ? "Registra con cuanto arranca la caja del turno actual."
    : isLocked
      ? "Este cajero ya hizo corte final hoy y no puede registrar nuevos cortes."
      : "Revisa el resumen del turno y guarda el corte con el efectivo contado.";
  refs.registerAmountLabel.textContent = isStartMode
    ? "Monto inicial de caja"
    : "Efectivo contado";
  refs.registerHelperText.textContent = isStartMode
    ? `Se guardara para el turno ${summary.shift}.`
    : `Turno ${summary.shift} · ${summary.tickets} tickets · ${summary.quickCuts} cortes rapidos hoy.`;
  refs.saveRegisterButton.textContent = state.register.saving
    ? "Guardando..."
    : isStartMode
      ? "Guardar inicio"
      : isQuickCutMode
        ? "Guardar corte rapido"
        : "Guardar corte final";
  refs.saveRegisterButton.disabled = state.register.loading || state.register.saving || isLocked;
  refs.registerAmountInput.disabled = state.register.loading || state.register.saving;
  refs.registerWithdrawInput.disabled = state.register.loading || state.register.saving || isStartMode;
  refs.registerApplyWithdrawButton.disabled =
    state.register.loading || state.register.saving || isStartMode;
  refs.registerNoteInput.disabled = state.register.loading || state.register.saving;

  refs.registerOpeningAmount.textContent = formatCurrency(summary.openingAmount);
  refs.registerCashSales.textContent = formatCurrency(summary.cashSales);
  refs.registerExpectedCash.textContent = formatCurrency(summary.expectedCash);
  refs.registerWithdrawalsAmount.textContent = formatCurrency(summary.withdrawalsAmount || 0);
  refs.registerTotalSales.textContent = formatCurrency(summary.totalSales);
  refs.registerAmountInput.value = state.register.amountInput;
  refs.registerWithdrawInput.value = state.register.withdrawInput;
  refs.registerNoteInput.value = state.register.note;
}

function renderDetailViewer() {
  if (!refs.detailViewerModal) {
    return;
  }

  if (state.detailViewer.loading) {
    refs.detailViewerTitle.textContent = "Cargando detalle";
    refs.detailViewerMeta.textContent = "Preparando informacion...";
    refs.detailViewerBody.innerHTML = `
      <div class="empty-state">
        Cargando detalle completo...
      </div>
    `;
    return;
  }

  const { kind, detail } = state.detailViewer;
  if (!detail) {
    refs.detailViewerTitle.textContent = "Sin detalle";
    refs.detailViewerMeta.textContent = "";
    refs.detailViewerBody.innerHTML = `
      <div class="empty-state">
        Selecciona un ticket o movimiento para ver su informacion completa.
      </div>
    `;
    return;
  }

  if (kind === "sale") {
    refs.detailViewerTitle.textContent = detail.ticketNumber;
    refs.detailViewerMeta.textContent =
      `${detail.cashier} · ${detail.shift} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Total</span>
          <strong>${formatCurrency(detail.total)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Metodo</span>
          <strong>${escapeHtml(detail.paymentMethod)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Recibido</span>
          <strong>${formatCurrency(detail.receivedAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Cambio</span>
          <strong>${formatCurrency(detail.changeAmount)}</strong>
        </article>
      </div>
      <div class="detail-lines">
        ${detail.items
          .map(
            (item) => `
              <div class="detail-line">
                <div>
                  <strong>${escapeHtml(item.productName)}</strong>
                  <p>${escapeHtml(formatQuantity(item.quantity))} x ${formatCurrency(item.unitPrice)}</p>
                </div>
                <span>${formatCurrency(item.lineTotal)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      ${detail.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.notes)}</p>` : ""}
    `;
    return;
  }

  if (kind === "register") {
    refs.detailViewerTitle.textContent = getRegisterEventLabel(detail.eventType);
    refs.detailViewerMeta.textContent =
      `${detail.shift} · ${detail.cashier} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Caja inicial</span>
          <strong>${formatCurrency(detail.openingAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Efectivo esperado</span>
          <strong>${formatCurrency(detail.expectedCash)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Se retira</span>
          <strong>${formatCurrency(detail.withdrawalsAmount || 0)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Efectivo contado</span>
          <strong>${formatCurrency(detail.countedAmount)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Diferencia</span>
          <strong>${formatCurrency(detail.differenceAmount)}</strong>
        </article>
      </div>
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Ventas efectivo</span>
          <strong>${formatCurrency(detail.cashSales)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Ventas no efectivo</span>
          <strong>${formatCurrency(detail.nonCashSales)}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Total vendido</span>
          <strong>${formatCurrency(detail.totalSales)}</strong>
        </article>
      </div>
      ${detail.notes ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.notes)}</p>` : ""}
    `;
    return;
  }

  if (kind === "inventory") {
    refs.detailViewerTitle.textContent = detail.productName;
    refs.detailViewerMeta.textContent =
      `${getInventoryMovementLabel(detail.movementType)} · ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Movimiento</span>
          <strong>${escapeHtml(getInventoryMovementLabel(detail.movementType))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Cantidad</span>
          <strong>${detail.quantityDelta >= 0 ? "+" : ""}${escapeHtml(formatQuantity(detail.quantityDelta))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Antes</span>
          <strong>${escapeHtml(formatQuantity(detail.stockBefore))}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Despues</span>
          <strong>${escapeHtml(formatQuantity(detail.stockAfter))}</strong>
        </article>
      </div>
      <div class="detail-lines">
        <div class="detail-line">
          <div>
            <strong>Referencia</strong>
            <p>${escapeHtml(detail.referenceType || "Sin referencia")}${detail.referenceId ? ` #${escapeHtml(String(detail.referenceId))}` : ""}</p>
          </div>
        </div>
      </div>
      ${detail.note ? `<p class="sale-notes"><strong>Nota:</strong> ${escapeHtml(detail.note)}</p>` : ""}
    `;
    return;
  }

  if (kind === "audit") {
    refs.detailViewerTitle.textContent = detail.action || "Bitacora admin";
    refs.detailViewerMeta.textContent =
      `${detail.actorName || "admin"} Â· ${getBranchLabel(detail.branch || "all")} Â· ${dateTimeFormatter.format(new Date(detail.createdAt))}`;
    refs.detailViewerBody.innerHTML = `
      <div class="detail-stat-grid">
        <article class="detail-stat-card">
          <span>Entidad</span>
          <strong>${escapeHtml(detail.entityType || "Sin tipo")}</strong>
        </article>
        <article class="detail-stat-card">
          <span>ID entidad</span>
          <strong>${escapeHtml(detail.entityId || "Sin ID")}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Actor</span>
          <strong>${escapeHtml(detail.actorType || "admin")}</strong>
        </article>
        <article class="detail-stat-card">
          <span>Fecha</span>
          <strong>${escapeHtml(dateTimeFormatter.format(new Date(detail.createdAt)))}</strong>
        </article>
      </div>
      <div class="detail-lines">
        <div class="detail-line">
          <div>
            <strong>Resumen</strong>
            <p>${escapeHtml(detail.action || "Sin accion")} Â· ${escapeHtml(detail.entityType || "sin entidad")} Â· ${escapeHtml(getBranchLabel(detail.branch || "all"))}</p>
          </div>
        </div>
      </div>
      <div class="detail-json-block">
        <strong>Payload</strong>
        <pre class="detail-json">${escapeHtml(JSON.stringify(detail.payload || {}, null, 2))}</pre>
      </div>
    `;
  }
}
