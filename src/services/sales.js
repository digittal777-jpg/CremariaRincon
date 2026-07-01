const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  assertBranchIsActive,
  buildTicketPrefix,
  createHttpError,
  getBranchLabel,
  getSetting,
  getStoreHourLabel,
  isAllBranches,
  isCashPaymentMethod,
  isCreditPaymentMethod,
  isSameStoreDay,
  mapProduct,
  normalizeBranch,
  normalizePaymentMethod,
  normalizeReceivedPaymentMethod,
  normalizeText,
  roundMoney,
  roundStock,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
} = require("../utils/helpers");
const {
  decorateSalesWithCreditPayments,
  getCreditPaymentRowsBySaleIds,
  resolveReceivableCustomerKeyForSale,
} = require("./receivables");

const db = getDb();

function normalizeClientSaleId(value) {
  return normalizeText(value || "", 120) || null;
}

function listStoreDaySales(baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        shift,
        cashier,
        branch,
        payment_method,
        received_payment_method,
        total,
        subtotal,
        received_amount,
        item_count,
        created_at
      FROM sales
      ORDER BY created_at DESC
    `).all()
    : db.prepare(`
      SELECT
        id,
        shift,
        cashier,
        branch,
        payment_method,
        received_payment_method,
        total,
        subtotal,
        received_amount,
        item_count,
        created_at
      FROM sales
      WHERE branch = ?
      ORDER BY created_at DESC
    `).all(normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}

function listStoreDaySaleItems(baseDate = new Date(), branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        s.created_at,
        s.branch,
        si.product_id,
        si.product_name,
        si.quantity,
        si.line_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ORDER BY s.created_at DESC, si.id DESC
    `).all()
    : db.prepare(`
      SELECT
        s.created_at,
        s.branch,
        si.product_id,
        si.product_name,
        si.quantity,
        si.line_total
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.branch = ?
      ORDER BY s.created_at DESC, si.id DESC
    `).all(normalizedBranch);

  return rows.filter((row) => isSameStoreDay(row.created_at, baseDate));
}

function getSaleById(saleId) {
  const sale = db.prepare(`
    SELECT
      id,
      ticket_number,
      client_sale_id,
      shift,
      cashier,
      branch,
      payment_method,
      customer_name,
      customer_key,
      received_payment_method,
      subtotal,
      total,
      received_amount,
      change_amount,
      notes,
      item_count,
      created_at
    FROM sales
    WHERE id = ?
  `).get(saleId);

  if (!sale) {
    return null;
  }

  const items = db.prepare(`
    SELECT
      product_id,
      product_name,
      quantity,
      unit_price,
      line_total,
      unit_cost,
      line_cost,
      gross_profit,
      cost_status,
      stock_after
    FROM sale_items
    WHERE sale_id = ?
    ORDER BY id
  `).all(saleId);
  const [decoratedSale] = decorateSalesWithCreditPayments([sale]);

  return {
    id: decoratedSale.id,
    ticketNumber: decoratedSale.ticket_number,
    clientSaleId: decoratedSale.client_sale_id || "",
    shift: decoratedSale.shift,
    cashier: decoratedSale.cashier,
    branch: decoratedSale.branch,
    paymentMethod: decoratedSale.payment_method,
    customerName: decoratedSale.customer_name || "",
    customerKey: decoratedSale.customer_key || "",
    receivedPaymentMethod: getSaleReceivedPaymentMethod(
      decoratedSale.payment_method,
      decoratedSale.received_payment_method || "",
      decoratedSale.received_amount,
    ),
    subtotal: roundMoney(decoratedSale.subtotal),
    total: roundMoney(decoratedSale.total),
    receivedAmount: roundMoney(decoratedSale.received_amount),
    paidAmount: roundMoney(decoratedSale.paid_amount || decoratedSale.received_amount),
    laterPaymentsTotal: roundMoney(decoratedSale.credit_payments_total || 0),
    changeAmount: roundMoney(decoratedSale.change_amount),
    pendingAmount: roundMoney(decoratedSale.pending_amount || 0),
    notes: decoratedSale.notes,
    itemCount: roundStock(decoratedSale.item_count),
    createdAt: decoratedSale.created_at,
    payments: Array.isArray(decoratedSale.credit_payments) ? decoratedSale.credit_payments : [],
    items: items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: roundStock(item.quantity),
      unitPrice: roundMoney(item.unit_price),
      lineTotal: roundMoney(item.line_total),
      unitCost: roundMoney(item.unit_cost || 0),
      lineCost: item.line_cost == null ? null : roundMoney(item.line_cost),
      grossProfit: item.gross_profit == null ? null : roundMoney(item.gross_profit),
      costStatus: item.cost_status || "unknown",
      stockAfter: roundStock(item.stock_after),
    })),
  };
}

function getSaleByClientSaleId(clientSaleId) {
  const safeClientSaleId = normalizeClientSaleId(clientSaleId);
  if (!safeClientSaleId) {
    return null;
  }

  const row = db.prepare(`
    SELECT id
    FROM sales
    WHERE client_sale_id = ?
  `).get(safeClientSaleId);

  if (!row) {
    return null;
  }

  return getSaleById(row.id);
}

function createSale(payload) {
  const clientSaleId = normalizeClientSaleId(payload.clientSaleId);
  if (clientSaleId) {
    const existingSale = getSaleByClientSaleId(clientSaleId);
    if (existingSale) {
      return existingSale;
    }
  }

  const shift = normalizeText(payload.shift || "Tarde", 24) || "Tarde";
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const paymentMethod = normalizePaymentMethod(payload.paymentMethod || "Efectivo");
  const customerName = normalizeText(payload.customerName || "", 80) || null;
  const customerKey = isCreditPaymentMethod(paymentMethod)
    ? resolveReceivableCustomerKeyForSale({
        branch,
        customerName,
        requestedCustomerKey: payload.customerKey,
      }) || null
    : null;
  const notes = normalizeText(payload.notes || "", 240) || null;
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];

  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para registrar la venta.");
  }

  assertBranchIsActive(branch, "Selecciona una sucursal activa para registrar la venta.");

  const { assertCashierCanOperate } = require("./register");
  assertCashierCanOperate({
    shift,
    branch,
    cashier,
    errorMessage: "Este cajero ya hizo corte final hoy y no puede registrar mas ventas hasta el siguiente dia.",
  });

  if (incomingItems.length === 0) {
    throw createHttpError("Agrega al menos un producto al carrito.");
  }
  if (isCreditPaymentMethod(paymentMethod) && !customerName) {
    throw createHttpError("Captura el nombre del cliente antes de guardar el fiado.");
  }

  let saleResult;
  try {
    saleResult = db.transaction(() => {
      const runningStockByProductId = new Map();
      const preparedItems = incomingItems.map((item) => {
        const productId = Number(item.productId);
        const requestedQuantity = roundStock(item.quantity);
        const lineTotal = roundMoney(item.lineTotal);

        if (!productId) {
          throw createHttpError("Uno de los productos no es valido.");
        }

        if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
          throw createHttpError("La cantidad de un producto no es valida.");
        }

        if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
          throw createHttpError("El monto de un producto debe ser mayor a cero.");
        }

        const product = db.prepare(`
          SELECT id, name, price, cost, stock, stock_initialized, branch, unit
          FROM products
          WHERE id = ? AND active = 1 AND branch = ?
        `).get(productId, branch);

        if (!product) {
          throw createHttpError("Uno de los productos ya no esta disponible.");
        }

        const unitPrice = roundMoney(item.unitPrice || product.price);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          throw createHttpError(`El precio de ${product.name} no es valido.`);
        }

        // En productos por kg, el total capturado es la fuente de verdad para evitar
        // descuadres cuando quantity llegue desfasada desde cliente/offline.
        const quantity = product.unit === "pza"
          ? requestedQuantity
          : roundStock(lineTotal / unitPrice);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw createHttpError(`No pude calcular una cantidad valida para ${product.name}.`);
        }

        const stockBefore = runningStockByProductId.has(productId)
          ? roundStock(runningStockByProductId.get(productId))
          : roundStock(product.stock);
        const stockAfter = roundStock(stockBefore - quantity);
        const unitCost = roundMoney(product.cost || 0);
        const hasCost = Number.isFinite(unitCost) && unitCost > 0;
        const lineCost = hasCost ? roundMoney(quantity * unitCost) : null;
        const grossProfit = hasCost ? roundMoney(lineTotal - lineCost) : null;
        const costStatus = hasCost ? "captured" : "missing_cost";

        const allowNegativeStock = getSetting("sales.allow_negative_stock") === "true";
        if (product.stock_initialized && stockAfter < 0 && !allowNegativeStock) {
          throw createHttpError(`No hay inventario suficiente para ${product.name}.`);
        }

        runningStockByProductId.set(productId, stockAfter);

        return {
          productId,
          productName: product.name,
          quantity,
          unitPrice,
          lineTotal,
          unitCost,
          lineCost,
          grossProfit,
          costStatus,
          stockBefore,
          stockAfter,
        };
      });

      const subtotal = roundMoney(
        preparedItems.reduce((sum, item) => sum + item.lineTotal, 0),
      );
      const total = subtotal;
      const itemCount = roundStock(
        preparedItems.reduce((sum, item) => sum + item.quantity, 0),
      );

      const receivedAmount = isCashPaymentMethod(paymentMethod)
        ? roundMoney(payload.receivedAmount)
        : isCreditPaymentMethod(paymentMethod)
          ? roundMoney(payload.receivedAmount || 0)
          : total;
      const receivedPaymentMethod = isCreditPaymentMethod(paymentMethod)
        ? getSaleReceivedPaymentMethod(
            paymentMethod,
            payload.receivedPaymentMethod || "",
            receivedAmount,
          ) || null
        : getSaleReceivedPaymentMethod(paymentMethod, paymentMethod, total);
      const changeAmount = isCashPaymentMethod(paymentMethod)
        ? roundMoney(receivedAmount - total)
        : 0;
      const pendingAmount = getSalePendingAmount(total, receivedAmount, paymentMethod);

      if (isCashPaymentMethod(paymentMethod) && receivedAmount < total) {
        throw createHttpError("El pago recibido no alcanza para completar la venta.");
      }
      if (isCreditPaymentMethod(paymentMethod)) {
        if (receivedAmount < 0) {
          throw createHttpError("El abono del fiado no puede ser negativo.");
        }
        if (pendingAmount <= 0) {
          throw createHttpError(
            "Si el cliente liquida todo hoy, usa efectivo, tarjeta o transferencia en lugar de fiado.",
          );
        }
      }

      const now = nowIso();
      const ticketPrefix = buildTicketPrefix(now);
      const ticketsToday = db.prepare(`
        SELECT COUNT(*) AS count
        FROM sales
        WHERE ticket_number LIKE ?
      `).get(`${ticketPrefix}%`).count;
      const ticketNumber = `${ticketPrefix}-${String(Number(ticketsToday) + 1).padStart(4, "0")}`;

      const saleInsert = db.prepare(`
        INSERT INTO sales (
          ticket_number,
          client_sale_id,
          shift,
          cashier,
          branch,
          payment_method,
          customer_name,
          customer_key,
          received_payment_method,
          subtotal,
          total,
          received_amount,
          change_amount,
          notes,
          item_count,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticketNumber,
        clientSaleId,
        shift,
        cashier,
        branch,
        paymentMethod,
        customerName,
        customerKey,
        receivedPaymentMethod,
        subtotal,
        total,
        receivedAmount,
        changeAmount,
        notes,
        itemCount,
        now,
      );

      const saleId = Number(saleInsert.lastInsertRowid);
      const insertSaleItem = db.prepare(`
        INSERT INTO sale_items (
          sale_id,
          product_id,
          product_name,
          quantity,
          unit_price,
          line_total,
          unit_cost,
          line_cost,
          gross_profit,
          cost_status,
          stock_before,
          stock_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateProductStock = db.prepare(`
        UPDATE products
        SET stock = ?, stock_initialized = 1, updated_at = ?
        WHERE id = ? AND branch = ?
      `);
      const insertMovement = db.prepare(`
        INSERT INTO inventory_movements (
          product_id,
          movement_type,
          branch,
          quantity_delta,
          stock_before,
          stock_after,
          note,
          reference_type,
          reference_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      preparedItems.forEach((item) => {
        insertSaleItem.run(
          saleId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          item.unitCost,
          item.lineCost,
          item.grossProfit,
          item.costStatus,
          item.stockBefore,
          item.stockAfter,
        );

        updateProductStock.run(item.stockAfter, now, item.productId, branch);

        insertMovement.run(
          item.productId,
          "sale",
          branch,
          -item.quantity,
          item.stockBefore,
          item.stockAfter,
          `Venta ${ticketNumber}`,
          "sale",
          saleId,
          now,
        );
      });

      return saleId;
    })();
  } catch (error) {
    if (clientSaleId && String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
      const existingSale = getSaleByClientSaleId(clientSaleId);
      if (existingSale) {
        return existingSale;
      }
    }

    throw error;
  }

  return getSaleById(saleResult);
}

function updateSaleAdmin(saleId, payload) {
  const current = db.prepare(`
    SELECT id, shift, cashier, branch, payment_method, customer_name, customer_key, received_payment_method, total, received_amount, notes
    FROM sales
    WHERE id = ?
  `).get(saleId);

  if (!current) {
    throw createHttpError("No encontre la venta que quieres editar.", 404);
  }

  const laterPaymentsTotal = roundMoney(
    (getCreditPaymentRowsBySaleIds([saleId]).get(Number(saleId)) || [])
      .reduce((sum, payment) => sum + roundMoney(payment.amount || 0), 0),
  );

  const nextShift = normalizeText(payload.shift || current.shift, 24) || current.shift;
  const nextCashier = normalizeText(payload.cashier || current.cashier, 60) || current.cashier;
  const nextPaymentMethod = normalizePaymentMethod(payload.paymentMethod || current.payment_method);
  const nextCustomerName = normalizeText(payload.customerName ?? current.customer_name ?? "", 80) || null;
  const nextCustomerKey = isCreditPaymentMethod(nextPaymentMethod)
    ? resolveReceivableCustomerKeyForSale({
        branch: payload.branch || current.branch || STORE_BRANCHES[0],
        customerName: nextCustomerName,
        requestedCustomerKey: payload.customerKey,
        currentCustomerKey: current.customer_key,
      }) || null
    : null;
  const nextNotes = normalizeText(payload.notes ?? current.notes ?? "", 240) || null;
  const receivedAmount =
    isCashPaymentMethod(nextPaymentMethod)
      ? roundMoney(
          payload.receivedAmount === undefined ? current.received_amount : payload.receivedAmount,
        )
      : isCreditPaymentMethod(nextPaymentMethod)
        ? roundMoney(
            payload.receivedAmount === undefined ? current.received_amount : payload.receivedAmount,
          )
        : roundMoney(current.total);
  const receivedPaymentMethod = isCreditPaymentMethod(nextPaymentMethod)
    ? getSaleReceivedPaymentMethod(
        nextPaymentMethod,
        payload.receivedPaymentMethod ?? current.received_payment_method ?? "",
        receivedAmount,
      ) || null
    : getSaleReceivedPaymentMethod(nextPaymentMethod, nextPaymentMethod, current.total);
  const changeAmount =
    isCashPaymentMethod(nextPaymentMethod) ? roundMoney(receivedAmount - roundMoney(current.total)) : 0;
  const pendingAmount = getSalePendingAmount(current.total, receivedAmount, nextPaymentMethod);
  const effectivePendingAmount = getSalePendingAmount(
    current.total,
    roundMoney(receivedAmount + laterPaymentsTotal),
    nextPaymentMethod,
  );

  if (!STORE_SHIFTS.includes(nextShift)) {
    throw createHttpError("Selecciona un turno valido para la venta.");
  }

  if (isCreditPaymentMethod(nextPaymentMethod) && !nextCustomerName) {
    throw createHttpError("Captura el nombre del cliente antes de guardar el fiado.");
  }
  if (!isCreditPaymentMethod(nextPaymentMethod) && laterPaymentsTotal > 0) {
    throw createHttpError(
      "Esta venta ya tiene abonos posteriores registrados; mantenla como fiado para no perder la trazabilidad.",
    );
  }

  if (isCashPaymentMethod(nextPaymentMethod) && receivedAmount < roundMoney(current.total)) {
    throw createHttpError("El efectivo recibido no alcanza para la venta.");
  }
  if (isCreditPaymentMethod(nextPaymentMethod)) {
    if (receivedAmount < 0) {
      throw createHttpError("El abono del fiado no puede ser negativo.");
    }
    if (pendingAmount <= 0 || effectivePendingAmount <= 0) {
      throw createHttpError(
        "Con los abonos acumulados esta venta ya no puede quedar liquidada dentro de fiado.",
      );
    }
  }

  db.prepare(`
    UPDATE sales
    SET shift = ?, cashier = ?, payment_method = ?, customer_name = ?, customer_key = ?, received_payment_method = ?, received_amount = ?, change_amount = ?, notes = ?
    WHERE id = ?
  `).run(
    nextShift,
    nextCashier,
    nextPaymentMethod,
    nextCustomerName,
    nextCustomerKey,
    receivedPaymentMethod,
    receivedAmount,
    changeAmount,
    nextNotes,
    saleId,
  );

  return getSaleById(saleId);
}

function getRecentSales(limit = 8, branch = STORE_BRANCHES[0]) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        s.id,
        s.ticket_number,
        s.shift,
        s.cashier,
        s.branch,
        s.payment_method,
        s.customer_name,
        s.customer_key,
        s.received_payment_method,
        s.total,
        s.subtotal,
        s.notes,
        s.item_count,
        s.received_amount,
        s.change_amount,
        s.created_at,
        GROUP_CONCAT(
          si.product_name || ' x' || printf('%g', si.quantity) || ' @ ' || printf('%.2f', si.unit_price) || ' = ' || printf('%.2f', si.line_total),
          ' || '
        ) AS items_breakdown
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        s.id,
        s.ticket_number,
        s.shift,
        s.cashier,
        s.branch,
        s.payment_method,
        s.customer_name,
        s.customer_key,
        s.received_payment_method,
        s.total,
        s.subtotal,
        s.notes,
        s.item_count,
        s.received_amount,
        s.change_amount,
        s.created_at,
        GROUP_CONCAT(
          si.product_name || ' x' || printf('%g', si.quantity) || ' @ ' || printf('%.2f', si.unit_price) || ' = ' || printf('%.2f', si.line_total),
          ' || '
        ) AS items_breakdown
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      WHERE s.branch = ?
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return decorateSalesWithCreditPayments(rows).map((row) => ({
    id: row.id,
    ticketNumber: row.ticket_number,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    paymentMethod: row.payment_method,
    customerName: row.customer_name || "",
    customerKey: row.customer_key || "",
    receivedPaymentMethod: getSaleReceivedPaymentMethod(
      row.payment_method,
      row.received_payment_method || "",
      row.received_amount,
    ),
    subtotal: roundMoney(row.subtotal),
    total: roundMoney(row.total),
    itemCount: roundStock(row.item_count),
    notes: row.notes || "",
    receivedAmount: roundMoney(row.received_amount),
    paidAmount: roundMoney(row.paid_amount || row.received_amount),
    laterPaymentsTotal: roundMoney(row.credit_payments_total || 0),
    changeAmount: roundMoney(row.change_amount),
    pendingAmount: roundMoney(row.pending_amount || 0),
    createdAt: row.created_at,
    items: row.items_breakdown
      ? row.items_breakdown.split(" || ").map((item) => {
          const [leftPart = "", totalPart = "0"] = item.split(" = ");
          const quantityMatch = leftPart.match(/^(.*) x([0-9.]+) @ ([0-9.]+)$/);

          if (!quantityMatch) {
            return {
              productName: leftPart,
              quantity: 0,
              unitPrice: 0,
              lineTotal: roundMoney(totalPart),
            };
          }

          return {
            productName: quantityMatch[1],
            quantity: roundStock(quantityMatch[2]),
            unitPrice: roundMoney(quantityMatch[3]),
            lineTotal: roundMoney(totalPart),
          };
        })
      : [],
    itemsSummary: row.items_breakdown
      ? row.items_breakdown
          .split(" || ")
          .map((item) => String(item).split(" = ")[0]?.trim() || "")
          .filter(Boolean)
          .join(" · ")
      : `Venta de ${roundStock(row.item_count)} articulos`,
  }));
}

function listSalesForExport() {
  return db.prepare(`
    SELECT
      s.id,
      s.ticket_number,
      s.shift,
      s.cashier,
      s.branch,
      s.payment_method,
      s.customer_name,
      s.customer_key,
      s.received_payment_method,
      s.subtotal,
      s.total,
      s.received_amount,
      s.change_amount,
      s.notes,
      s.item_count,
      s.created_at,
      si.product_id,
      si.product_name,
      si.quantity,
      si.unit_price,
      si.line_total,
      si.unit_cost,
      si.line_cost,
      si.gross_profit,
      si.cost_status,
      si.stock_before,
      si.stock_after
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    ORDER BY s.created_at DESC, si.id ASC
  `).all();
}

module.exports = {
  createSale,
  getSaleById,
  getRecentSales,
  listSalesForExport,
  listStoreDaySaleItems,
  listStoreDaySales,
  updateSaleAdmin,
};
