const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dbRelativePath = path.join("data", `test-merchandise-${process.pid}-${Date.now()}.sqlite`);
process.env.POS_DB_PATH = dbRelativePath;

const services = require("../src/services");
const { closeDatabaseConnection, getDb, reloadDatabaseConnection } = require("../src/db");
const { buildTicketPrefix, getStoreDateKey, roundStock } = require("../src/utils/helpers");

const db = getDb();
const dbAbsolutePath = path.resolve(__dirname, "..", dbRelativePath);

function cleanupDatabaseFiles() {
  closeDatabaseConnection();
  [dbAbsolutePath, `${dbAbsolutePath}-wal`, `${dbAbsolutePath}-shm`].forEach((targetPath) => {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
  });
}

function resetDatabase() {
  db.exec(`
    DELETE FROM cashier_sessions;
    DELETE FROM weighted_audit_items;
    DELETE FROM weighted_audit_sessions;
    DELETE FROM register_events;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM inventory_movements;
    DELETE FROM merchandise_request_items;
    DELETE FROM merchandise_requests;
    DELETE FROM cashiers;
    DELETE FROM products;
    DELETE FROM sqlite_sequence
    WHERE name IN (
      'cashiers',
      'weighted_audit_items',
      'weighted_audit_sessions',
      'register_events',
      'sale_items',
      'sales',
      'inventory_movements',
      'merchandise_request_items',
      'merchandise_requests',
      'products'
    );
  `);
}

function seedProduct(name, overrides = {}) {
  return services.createProduct({
    branch: "carrizal",
    name,
    category: overrides.category || "quesos",
    unit: overrides.unit || "kg",
    price: overrides.price ?? 50,
    stock: overrides.stock ?? 10,
    minStock: overrides.minStock ?? 1,
  });
}

test.beforeEach(() => {
  resetDatabase();
});

test.after(() => {
  cleanupDatabaseFiles();
});

test("crea solicitudes de mercaderia con totales netos por linea", () => {
  const queso = seedProduct("Queso Fresco", { price: 45, stock: 8 });
  const yogurt = seedProduct("Yogurt Natural", { price: 30, stock: 6 });

  const requestRecord = services.createMerchandiseRequest({
    requestedBy: "Andrea",
    branch: "carrizal",
    supplierName: "Ruta Juan Perez",
    notes: "Dejo queso y retira yogurt",
    items: [
      { productId: queso.id, quantity: 5, mode: "receive" },
      { productId: yogurt.id, quantity: 2, mode: "return" },
    ],
  });

  assert.equal(requestRecord.status, "pending");
  assert.equal(requestRecord.totalValue, 165);
  assert.equal(requestRecord.items.length, 2);
  assert.equal(requestRecord.items[0].totalValue, 225);
  assert.equal(requestRecord.items[1].totalValue, -60);
  assert.equal(requestRecord.itemCount, 2);
});

test("aprueba solicitudes y aplica el inventario con movimientos vinculados", () => {
  const queso = seedProduct("Queso Panela", { price: 40, stock: 5 });
  const crema = seedProduct("Crema Entera", { price: 28, stock: 7 });

  const createdRequest = services.createMerchandiseRequest({
    requestedBy: "Mario",
    branch: "carrizal",
    supplierName: "Proveedor Centro",
    items: [
      { productId: queso.id, quantity: 3, mode: "receive" },
      { productId: crema.id, quantity: 2, mode: "return" },
    ],
  });

  const approvedRequest = services.approveMerchandiseRequest(createdRequest.id);
  const updatedQueso = services.getProductById(queso.id, "carrizal");
  const updatedCrema = services.getProductById(crema.id, "carrizal");
  const movementRows = db.prepare(`
    SELECT movement_type, quantity_delta, reference_type, reference_id
    FROM inventory_movements
    ORDER BY id ASC
  `).all();

  assert.equal(approvedRequest.status, "approved");
  assert.ok(approvedRequest.approvedAt);
  assert.ok(approvedRequest.appliedAt);
  assert.equal(updatedQueso.stock, 8);
  assert.equal(updatedCrema.stock, 5);
  assert.equal(movementRows.length, 4);
  assert.deepEqual(
    movementRows.slice(-2).map((row) => ({
      movementType: row.movement_type,
      quantityDelta: row.quantity_delta,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
    })),
    [
      {
        movementType: "supplier",
        quantityDelta: 3,
        referenceType: "merchandise_request",
        referenceId: createdRequest.id,
      },
      {
        movementType: "supplier_out",
        quantityDelta: -2,
        referenceType: "merchandise_request",
        referenceId: createdRequest.id,
      },
    ],
  );
});

test("rechaza solicitudes sin mover el inventario", () => {
  const queso = seedProduct("Queso Oaxaca", { price: 52, stock: 9 });

  const createdRequest = services.createMerchandiseRequest({
    requestedBy: "Sofia",
    branch: "carrizal",
    notes: "Proveedor reporta merma",
    items: [
      { productId: queso.id, quantity: 1.5, mode: "return" },
    ],
  });

  const rejectedRequest = services.rejectMerchandiseRequest(
    createdRequest.id,
    "Stock insuficiente para validar la salida",
  );
  const updatedQueso = services.getProductById(queso.id, "carrizal");

  assert.equal(rejectedRequest.status, "rejected");
  assert.equal(rejectedRequest.rejectionReason, "Stock insuficiente para validar la salida");
  assert.equal(updatedQueso.stock, 9);
});

test("bloquea salidas que dejan el inventario en negativo desde la captura", () => {
  const yogurt = seedProduct("Yogurt Griego", { price: 36, stock: 1 });

  assert.throws(
    () => {
      services.createMerchandiseRequest({
        requestedBy: "Luis",
        branch: "carrizal",
        items: [
          { productId: yogurt.id, quantity: 2, mode: "return" },
        ],
      });
    },
    /No hay stock suficiente para retirar Yogurt Griego/,
  );
});

test("migra solicitudes legacy en camelCase para que admin pueda verlas", () => {
  closeDatabaseConnection();

  const rawDb = new Database(dbAbsolutePath);
  rawDb.exec(`
    DROP TABLE IF EXISTS merchandise_request_items;
    DROP TABLE IF EXISTS merchandise_requests;

    CREATE TABLE merchandise_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'pending',
      requestedBy TEXT NOT NULL,
      branch TEXT NOT NULL,
      supplierName TEXT,
      totalValue REAL DEFAULT 0,
      notes TEXT,
      rejectionReason TEXT,
      createdAt TEXT NOT NULL,
      approvedAt TEXT,
      appliedAt TEXT
    );

    CREATE TABLE merchandise_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId INTEGER NOT NULL,
      productId INTEGER NOT NULL,
      productName TEXT NOT NULL,
      quantity REAL NOT NULL,
      unitPrice REAL NOT NULL,
      totalValue REAL NOT NULL,
      mode TEXT NOT NULL
    );

    INSERT INTO merchandise_requests (
      id, status, requestedBy, branch, supplierName, totalValue, notes, rejectionReason, createdAt
    ) VALUES (
      50, 'pending', 'Andrea', 'carrizal', 'Ruta legacy', 112.8, 'Migracion', '', '2026-05-13T17:03:14.396Z'
    );

    INSERT INTO merchandise_request_items (
      id, requestId, productId, productName, quantity, unitPrice, totalValue, mode
    ) VALUES (
      90, 50, 7, 'Queso Legacy', 2.35, 48, 112.8, 'receive'
    );
  `);
  rawDb.close();

  reloadDatabaseConnection();

  const pendingRequests = services.listPendingMerchandiseRequests("all", 10);

  assert.equal(pendingRequests.length, 1);
  assert.equal(pendingRequests[0].requestedBy, "Andrea");
  assert.equal(pendingRequests[0].supplierName, "Ruta legacy");
  assert.equal(pendingRequests[0].items[0].productName, "Queso Legacy");
  assert.equal(pendingRequests[0].items[0].quantity, 2.35);
});

test("bloquea ventas del cajero que hizo corte final y permite a otro cajero", () => {
  const producto = seedProduct("Queso Bloqueo", {
    unit: "pza",
    price: 20,
    stock: 10,
    minStock: 1,
  });

  services.startRegister({
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    openingAmount: 100,
  });

  services.createRegisterCut({
    eventType: "final_cut",
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    countedAmount: 100,
    withdrawalsAmount: 0,
  });

  assert.throws(
    () => {
      services.createSale({
        shift: "Tarde",
        cashier: "Ana",
        branch: "carrizal",
        paymentMethod: "Efectivo",
        receivedAmount: 20,
        items: [
          {
            productId: producto.id,
            quantity: 1,
            unitPrice: 20,
            lineTotal: 20,
          },
        ],
      });
    },
    /corte final/i,
  );

  const ventaOtroCajero = services.createSale({
    shift: "Tarde",
    cashier: "Beto",
    branch: "carrizal",
    paymentMethod: "Efectivo",
    receivedAmount: 20,
    items: [
      {
        productId: producto.id,
        quantity: 1,
        unitPrice: 20,
        lineTotal: 20,
      },
    ],
  });

  assert.equal(ventaOtroCajero.cashier, "Beto");
  assert.equal(ventaOtroCajero.total, 20);
});

test("levanta bloqueo del cajero al siguiente dia", () => {
  const producto = seedProduct("Queso Dia Siguiente", {
    unit: "pza",
    price: 18,
    stock: 10,
    minStock: 1,
  });

  services.startRegister({
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    openingAmount: 80,
  });

  const corte = services.createRegisterCut({
    eventType: "final_cut",
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    countedAmount: 80,
    withdrawalsAmount: 0,
  });

  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  db.prepare(`
    UPDATE register_events
    SET created_at = ?
    WHERE id = ?
  `).run(ayer.toISOString(), corte.eventId);

  const venta = services.createSale({
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    paymentMethod: "Efectivo",
    receivedAmount: 18,
    items: [
      {
        productId: producto.id,
        quantity: 1,
        unitPrice: 18,
        lineTotal: 18,
      },
    ],
  });

  assert.equal(venta.cashier, "Ana");
  assert.equal(venta.total, 18);
});

test("en retiros exige motivo y marca excedente", () => {
  services.startRegister({
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Laura",
    openingAmount: 50,
  });

  assert.throws(
    () => {
      services.createRegisterCut({
        eventType: "quick_cut",
        shift: "Tarde",
        branch: "carrizal",
        cashier: "Laura",
        countedAmount: 40,
        withdrawalsAmount: 10,
        notes: "",
      });
    },
    /motivo/i,
  );

  const corte = services.createRegisterCut({
    eventType: "quick_cut",
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Laura",
    countedAmount: 0,
    withdrawalsAmount: 60,
    notes: "Retiro extraordinario",
  });

  assert.equal(corte.overWithdrawalAmount, 10);
  assert.equal(corte.differenceAmount, 10);
});

test("idempotencia de caja evita duplicados por clientEventId", () => {
  const startPayload = {
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    openingAmount: 120,
    clientEventId: "evt-start-001",
  };
  const startA = services.startRegister(startPayload);
  const startB = services.startRegister(startPayload);
  assert.equal(startA.eventId, startB.eventId);

  const finalCutPayload = {
    eventType: "final_cut",
    shift: "Tarde",
    branch: "carrizal",
    cashier: "Ana",
    countedAmount: 120,
    withdrawalsAmount: 0,
    clientEventId: "evt-cut-001",
  };
  const cutA = services.createRegisterCut(finalCutPayload);
  const cutB = services.createRegisterCut(finalCutPayload);
  assert.equal(cutA.eventId, cutB.eventId);

  const rows = db.prepare(`
    SELECT event_type, client_event_id
    FROM register_events
    WHERE client_event_id IN ('evt-start-001', 'evt-cut-001')
    ORDER BY id
  `).all();

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.event_type),
    ["start", "final_cut"],
  );
});

test("idempotencia de venta evita duplicados y no descuenta stock dos veces", () => {
  const producto = seedProduct("Queso Venta Offline", {
    unit: "pza",
    price: 25,
    stock: 10,
    minStock: 1,
  });

  const payload = {
    clientSaleId: "sale-offline-001",
    shift: "Tarde",
    cashier: "Ana",
    branch: "carrizal",
    paymentMethod: "Efectivo",
    receivedAmount: 25,
    items: [
      {
        productId: producto.id,
        quantity: 1,
        unitPrice: 25,
        lineTotal: 25,
      },
    ],
  };

  const saleA = services.createSale(payload);
  const saleB = services.createSale(payload);
  const productoActualizado = services.getProductById(producto.id, "carrizal");
  const saleMovements = db.prepare(`
    SELECT id, reference_id
    FROM inventory_movements
    WHERE reference_type = 'sale'
    ORDER BY id ASC
  `).all();

  assert.equal(saleA.id, saleB.id);
  assert.equal(saleA.ticketNumber, saleB.ticketNumber);
  assert.equal(productoActualizado.stock, 9);
  assert.equal(saleMovements.length, 1);
  assert.equal(saleMovements[0].reference_id, saleA.id);
});

test("ticket usa el dia de tienda segun STORE_TIME_ZONE", () => {
  const nearMidnightUtc = new Date("2026-05-14T05:30:00.000Z");
  assert.equal(buildTicketPrefix(nearMidnightUtc), "RIN-20260513");
});

test("auditoria de pesado incluye todos los kg, exige motivo y no toca inventario", () => {
  const queso = seedProduct("Queso Auditoria", { unit: "kg", stock: 10, price: 80 });
  const crema = seedProduct("Crema Auditoria", { unit: "kg", stock: 6, price: 42 });
  seedProduct("Panela Pieza", { unit: "pza", stock: 8, price: 30 });

  const dateKey = getStoreDateKey(new Date());
  const session = services.createWeightedAuditSession({
    branch: "carrizal",
    shift: "Tarde",
    dateKey,
    createdBy: "admin",
  });

  assert.equal(session.items.length, 2);
  assert.ok(session.items.every((item) => item.unit === "kg"));

  const quesoRow = session.items.find((item) => item.productId === queso.id);
  const cremaRow = session.items.find((item) => item.productId === crema.id);
  assert.ok(quesoRow);
  assert.ok(cremaRow);

  assert.throws(
    () => {
      services.updateWeightedAuditItems(session.id, {
        items: [
          {
            itemId: quesoRow.id,
            countedStock: roundStock(quesoRow.posStock - 0.25),
            reason: "",
          },
        ],
      });
    },
    /motivo/i,
  );

  services.updateWeightedAuditItems(session.id, {
    items: [
      {
        itemId: quesoRow.id,
        countedStock: roundStock(quesoRow.posStock - 0.25),
        reason: "Merma detectada",
      },
      {
        itemId: cremaRow.id,
        countedStock: cremaRow.posStock,
        reason: "",
      },
    ],
  });

  const stockQuesoAntes = services.getProductById(queso.id, "carrizal").stock;
  const stockCremaAntes = services.getProductById(crema.id, "carrizal").stock;
  const closed = services.completeWeightedAuditSession(session.id, {
    completedBy: "admin",
  });
  const stockQuesoDespues = services.getProductById(queso.id, "carrizal").stock;
  const stockCremaDespues = services.getProductById(crema.id, "carrizal").stock;

  assert.equal(closed.status, "completed");
  assert.equal(closed.summary.incidentItems, 1);
  assert.equal(stockQuesoAntes, stockQuesoDespues);
  assert.equal(stockCremaAntes, stockCremaDespues);
});

test("exportacion incluye hoja de auditoria de pesado con resumen y detalle", async () => {
  const queso = seedProduct("Queso Export", { unit: "kg", stock: 4, price: 100 });
  const dateKey = getStoreDateKey(new Date());
  const session = services.createWeightedAuditSession({
    branch: "carrizal",
    shift: "Tarde",
    dateKey,
    createdBy: "admin",
  });
  const quesoRow = session.items.find((item) => item.productId === queso.id);

  services.updateWeightedAuditItems(session.id, {
    items: [
      {
        itemId: quesoRow.id,
        countedStock: roundStock(quesoRow.posStock - 1),
        reason: "Merma de cierre",
      },
    ],
  });
  services.completeWeightedAuditSession(session.id, { completedBy: "admin" });

  const report = await services.exportWorkbookReport({
    branch: "carrizal",
    scope: "store-day",
    baseDate: dateKey,
  });

  const sheet = report.workbook.getWorksheet("Auditoria Pesado");
  assert.ok(sheet);

  let foundIncidentSummary = false;
  let foundDetailRow = false;
  sheet.eachRow((row) => {
    const indicator = String(row.getCell(1).value || "");
    const valueCell = row.getCell(2).value;
    if (indicator === "Productos con diferencia" && Number(valueCell) >= 1) {
      foundIncidentSummary = true;
    }

    const productCell = String(row.getCell(5).value || "");
    const reasonCell = String(row.getCell(10).value || "");
    if (productCell === "Queso Export" && reasonCell.includes("Merma de cierre")) {
      foundDetailRow = true;
    }
  });

  assert.equal(foundIncidentSummary, true);
  assert.equal(foundDetailRow, true);
});
