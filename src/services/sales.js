const { getDb, nowIso } = require("../db");
const {
  ALL_BRANCHES,
  STORE_BRANCHES,
  STORE_SHIFTS,
  buildTicketPrefix,
  createHttpError,
  getBranchLabel,
  getSetting,
  getStoreHourLabel,
  isAllBranches,
  isSameStoreDay,
  mapProduct,
  normalizeBranch,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");

const db = getDb();

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
        total,
        subtotal,
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
        total,
        subtotal,
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
      shift,
      cashier,
      branch,
      payment_method,
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
      stock_after
    FROM sale_items
    WHERE sale_id = ?
    ORDER BY id
  `).all(saleId);

  return {
    id: sale.id,
    ticketNumber: sale.ticket_number,
    shift: sale.shift,
    cashier: sale.cashier,
    branch: sale.branch,
    paymentMethod: sale.payment_method,
    subtotal: roundMoney(sale.subtotal),
    total: roundMoney(sale.total),
    receivedAmount: roundMoney(sale.received_amount),
    changeAmount: roundMoney(sale.change_amount),
    notes: sale.notes,
    itemCount: roundStock(sale.item_count),
    createdAt: sale.created_at,
    items: items.map((item) => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: roundStock(item.quantity),
      unitPrice: roundMoney(item.unit_price),
      lineTotal: roundMoney(item.line_total),
      stockAfter: roundStock(item.stock_after),
    })),
  };
}

function createSale(payload) {
  const shift = normalizeText(payload.shift || "Tarde", 24) || "Tarde";
  const cashier = normalizeText(payload.cashier || "Mostrador", 60) || "Mostrador";
  const branch = normalizeBranch(payload.branch);
  const paymentMethod = normalizeText(payload.paymentMethod || "Efectivo", 24) || "Efectivo";
  const notes = normalizeText(payload.notes || "", 240) || null;
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];

  if (!STORE_SHIFTS.includes(shift)) {
    throw createHttpError("Selecciona un turno valido para registrar la venta.");
  }

  if (!STORE_BRANCHES.includes(branch)) {
    throw createHttpError("Selecciona una sucursal valida.");
  }

  if (incomingItems.length === 0) {
    throw createHttpError("Agrega al menos un producto al carrito.");
  }

  const saleResult = db.transaction(() => {
    const preparedItems = incomingItems.map((item) => {
      const productId = Number(item.productId);
      const quantity = roundStock(item.quantity);
      const lineTotal = roundMoney(item.lineTotal);

      if (!productId) {
        throw createHttpError("Uno de los productos no es valido.");
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw createHttpError("La cantidad de un producto no es valida.");
      }

      if (!Number.isFinite(lineTotal) || lineTotal <= 0) {
        throw createHttpError("El monto de un producto debe ser mayor a cero.");
      }

      const product = db.prepare(`
        SELECT id, name, price, stock, stock_initialized, branch
        FROM products
        WHERE id = ? AND active = 1 AND branch = ?
      `).get(productId, branch);

      if (!product) {
        throw createHttpError("Uno de los productos ya no esta disponible.");
      }

      const stockBefore = roundStock(product.stock);
      const stockAfter = roundStock(stockBefore - quantity);

      const allowNegativeStock = getSetting("sales.allow_negative_stock") === "true";
      if (product.stock_initialized && stockAfter < 0 && !allowNegativeStock) {
        throw createHttpError(`No hay inventario suficiente para ${product.name}.`);
      }

      return {
        productId,
        productName: product.name,
        quantity,
        unitPrice: roundMoney(item.unitPrice || product.price),
        lineTotal,
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

    const receivedAmount =
      paymentMethod === "Efectivo"
        ? roundMoney(payload.receivedAmount)
        : total;
    const changeAmount =
      paymentMethod === "Efectivo"
        ? roundMoney(receivedAmount - total)
        : 0;

    if (paymentMethod === "Efectivo" && receivedAmount < total) {
      throw createHttpError("El pago recibido no alcanza para completar la venta.");
    }

    const now = nowIso();
    const ticketPrefix = buildTicketPrefix(new Date());
    const ticketsToday = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sales
      WHERE ticket_number LIKE ?
    `).get(`${ticketPrefix}%`).count;
    const ticketNumber = `${ticketPrefix}-${String(Number(ticketsToday) + 1).padStart(4, "0")}`;

    const saleInsert = db.prepare(`
      INSERT INTO sales (
        ticket_number,
        shift,
        cashier,
        branch,
        payment_method,
        subtotal,
        total,
        received_amount,
        change_amount,
        notes,
        item_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketNumber,
      shift,
      cashier,
      branch,
      paymentMethod,
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
        stock_before,
        stock_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  return getSaleById(saleResult);
}

function updateSaleAdmin(saleId, payload) {
  const current = db.prepare(`
    SELECT id, shift, cashier, payment_method, total, received_amount, notes
    FROM sales
    WHERE id = ?
  `).get(saleId);

  if (!current) {
    throw createHttpError("No encontre la venta que quieres editar.", 404);
  }

  const nextShift = normalizeText(payload.shift || current.shift, 24) || current.shift;
  const nextCashier = normalizeText(payload.cashier || current.cashier, 60) || current.cashier;
  const nextPaymentMethod =
    normalizeText(payload.paymentMethod || current.payment_method, 24) || current.payment_method;
  const nextNotes = normalizeText(payload.notes ?? current.notes ?? "", 240) || null;
  const receivedAmount =
    nextPaymentMethod === "Efectivo"
      ? roundMoney(
          payload.receivedAmount === undefined ? current.received_amount : payload.receivedAmount,
        )
      : roundMoney(current.total);
  const changeAmount =
    nextPaymentMethod === "Efectivo" ? roundMoney(receivedAmount - roundMoney(current.total)) : 0;

  if (!STORE_SHIFTS.includes(nextShift)) {
    throw createHttpError("Selecciona un turno valido para la venta.");
  }

  if (nextPaymentMethod === "Efectivo" && receivedAmount < roundMoney(current.total)) {
    throw createHttpError("El efectivo recibido no alcanza para la venta.");
  }

  db.prepare(`
    UPDATE sales
    SET shift = ?, cashier = ?, payment_method = ?, received_amount = ?, change_amount = ?, notes = ?
    WHERE id = ?
  `).run(
    nextShift,
    nextCashier,
    nextPaymentMethod,
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

  return rows.map((row) => ({
    id: row.id,
    ticketNumber: row.ticket_number,
    shift: row.shift,
    cashier: row.cashier,
    branch: row.branch,
    paymentMethod: row.payment_method,
    subtotal: roundMoney(row.subtotal),
    total: roundMoney(row.total),
    itemCount: roundStock(row.item_count),
    notes: row.notes || "",
    receivedAmount: roundMoney(row.received_amount),
    changeAmount: roundMoney(row.change_amount),
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
      s.payment_method,
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