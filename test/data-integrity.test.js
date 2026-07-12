const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ExcelJS = require("exceljs");

const ROOT_DIR = path.resolve(__dirname, "..");

function runIsolatedProjectScript(source) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: ROOT_DIR,
    env: process.env,
    encoding: "utf8",
    timeout: 120000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(String(result.stdout || "{}").trim() || "{}");
}

test("export workbook roundtrip keeps customer identity and installs without ReferenceError", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-workbook-roundtrip-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    (async () => {
      const { getDb, nowIso } = require("./src/db");
      const sales = require("./src/services/sales");
      const receivables = require("./src/services/receivables");
      const { exportWorkbookReport } = require("./src/services/export");
      const workbookImport = require("./src/services/workbookImport");

      const db = getDb();
      const now = nowIso();
      db.prepare(\`
        INSERT INTO products (
          name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
        ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 20, 0, 1, 1, 0, ?, ?, ?)
      \`).run("Producto Excel", 9.5, "carrizal", now, now);

      const product = db.prepare("SELECT id, name, price FROM products WHERE branch = 'carrizal' LIMIT 1").get();
      const sale = sales.createSale({
        shift: "Tarde",
        cashier: "Ana",
        branch: "carrizal",
        paymentMethod: "Fiado",
        customerName: "Cliente Excel",
        receivedAmount: 3,
        receivedPaymentMethod: "Efectivo",
        items: [{
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          lineTotal: product.price,
        }],
      });
      const payment = receivables.createReceivablePayment({
        saleId: sale.id,
        shift: "Tarde",
        cashier: "Ana",
        branch: "carrizal",
        amount: 2,
        paymentMethod: "Efectivo",
      });

      const report = await exportWorkbookReport({ branch: "carrizal", scope: "all-time" });
      const buffer = Buffer.from(await report.workbook.xlsx.writeBuffer());
      const installResult = await workbookImport.installOperationalDataFromWorkbookBuffer(buffer);

      const restoredSale = db.prepare("SELECT ticket_number, customer_name, customer_key FROM sales ORDER BY id DESC LIMIT 1").get();
      const restoredPayment = db.prepare("SELECT amount, customer_name, customer_key FROM credit_payments ORDER BY id DESC LIMIT 1").get();

      console.log(JSON.stringify({
        installResult,
        restoredSale,
        restoredPayment,
        saleCustomerKey: sale.customerKey,
        paymentCustomerKey: payment.customerKey,
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `);

  assert.equal(payload.installResult.counts.sales, 1);
  assert.equal(payload.installResult.counts.creditPayments, 1);
  assert.equal(payload.restoredSale.customer_name, "Cliente Excel");
  assert.equal(payload.restoredSale.customer_key, payload.saleCustomerKey);
  assert.equal(payload.restoredPayment.customer_key, payload.paymentCustomerKey);
});

test("renaming a branch keeps credit payments aligned with register summary", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-branch-rename-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const receivables = require("./src/services/receivables");
    const register = require("./src/services/register");
    const branches = require("./src/services/branches");

    const db = getDb();
    const now = nowIso();
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 30, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Producto Ruta", 18.5, "carrizal", now, now);

    const product = db.prepare("SELECT id, name, price FROM products WHERE branch = 'carrizal' LIMIT 1").get();
    const sale = sales.createSale({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Cliente Demo",
      receivedAmount: 10,
      receivedPaymentMethod: "Efectivo",
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });
    receivables.createReceivablePayment({
      saleId: sale.id,
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      amount: 5,
      paymentMethod: "Efectivo",
    });

    const before = register.getRegisterSummary("Tarde", "carrizal", { cashier: "Juan" });
    branches.updateBranch("carrizal", { code: "sur", name: "Sucursal Sur" });
    const after = register.getRegisterSummary("Tarde", "sur", { cashier: "Juan" });
    const paymentRow = db.prepare("SELECT branch FROM credit_payments WHERE sale_id = ?").get(sale.id);
    const syncReports = db.prepare("SELECT COUNT(*) AS count FROM client_sync_reports WHERE branch = 'sur'").get();

    console.log(JSON.stringify({
      before,
      after,
      paymentRow,
      syncReports,
    }));
  `);

  assert.equal(payload.paymentRow.branch, "sur");
  assert.equal(payload.before.cashSales, payload.after.cashSales);
  assert.equal(payload.before.expectedCash, payload.after.expectedCash);
  assert.equal(payload.after.creditSales, 3.5);
  assert.equal(payload.syncReports.count, 0);
});

test("renaming a branch also moves stored period closures", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-period-rename-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const branches = require("./src/services/branches");

    const db = getDb();
    const now = nowIso();
    db.prepare(\`
      INSERT INTO period_closures (
        branch,
        period_type,
        period_start_date_key,
        period_end_date_key,
        notes,
        snapshot_json,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run("carrizal", "week", "2026-07-06", "2026-07-12", "audit", "{}", "audit", now, now);

    branches.updateBranch("carrizal", { code: "sur", name: "Sucursal Sur" });
    const rows = db.prepare("SELECT branch, COUNT(*) AS count FROM period_closures GROUP BY branch ORDER BY branch").all();
    console.log(JSON.stringify({ rows }));
  `);

  assert.deepEqual(payload.rows, [{ branch: "sur", count: 1 }]);
});

test("sale ticket generation skips gaps instead of reusing existing ticket numbers", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-ticket-gap-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const { buildTicketPrefix } = require("./src/utils/helpers");

    const db = getDb();
    const now = nowIso();
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 30, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Producto Folio", 10, "carrizal", now, now);

    const product = db.prepare("SELECT id, name, price FROM products WHERE branch = 'carrizal' LIMIT 1").get();
    const ticketPrefix = buildTicketPrefix(new Date());
    db.prepare(\`
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
        item_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(\`\${ticketPrefix}-0002\`, "Tarde", "Ana", "carrizal", "Efectivo", 10, 10, 10, 0, 1, now);

    const sale = sales.createSale({
      shift: "Tarde",
      cashier: "Ana",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 10,
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });

    const tickets = db.prepare("SELECT ticket_number FROM sales ORDER BY ticket_number").all();
    console.log(JSON.stringify({ ticketNumber: sale.ticketNumber, tickets }));
  `);

  assert.match(payload.ticketNumber, /-0003$/);
  assert.deepEqual(payload.tickets.map((row) => row.ticket_number), [
    payload.ticketNumber.replace(/-0003$/, "-0002"),
    payload.ticketNumber,
  ]);
});

test("quick inventory import refuses ambiguous name-only writes", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-quick-import-id-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const inventory = require("./src/services/inventory");

    const db = getDb();
    const now = nowIso();
    const insertProduct = db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, ?, 0, 1, 1, 0, ?, ?, ?)
    \`);
    insertProduct.run("Queso Oaxaca", 10, 10, "carrizal", now, now);
    insertProduct.run("Queso Oaxaca Grande", 20, 20, "carrizal", now, now);

    let message = "";
    try {
      inventory.applyQuickInventoryEntry({
        productName: "Oaxaca",
        branch: "carrizal",
        mode: "receive",
        quantity: 1,
      });
    } catch (error) {
      message = error.message;
    }

    const rows = db.prepare("SELECT name, stock FROM products ORDER BY id").all();
    console.log(JSON.stringify({ message, rows }));
  `);

  assert.equal(payload.message, "Selecciona un producto valido para la captura rapida.");
  assert.deepEqual(payload.rows, [
    { name: "Queso Oaxaca", stock: 10 },
    { name: "Queso Oaxaca Grande", stock: 20 },
  ]);
});

test("receivables separate duplicate names unless the same customer key is reused intentionally", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-customer-keys-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const receivables = require("./src/services/receivables");

    const db = getDb();
    const now = nowIso();
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 50, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Producto Cliente", 12, "carrizal", now, now);

    const product = db.prepare("SELECT id, name, price FROM products WHERE branch = 'carrizal' LIMIT 1").get();

    const sharedKey = "cust:carrizal:cliente-demo:shared";
    sales.createSale({
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Cliente Demo",
      customerKey: sharedKey,
      receivedAmount: 0,
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });
    sales.createSale({
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Cliente Demo",
      customerKey: sharedKey,
      receivedAmount: 0,
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });
    sales.createSale({
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Cliente Demo",
      receivedAmount: 0,
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });

    const customers = receivables.listReceivableCustomers("carrizal");
    console.log(JSON.stringify({
      customers,
      customerKeys: db.prepare("SELECT customer_key FROM sales ORDER BY id ASC").all(),
    }));
  `);

  assert.equal(payload.customers.length, 2);
  assert.ok(payload.customers.some((customer) => customer.openSalesCount === 2));
  assert.ok(payload.customers.some((customer) => customer.openSalesCount === 1));
  assert.equal(payload.customerKeys[0].customer_key, payload.customerKeys[1].customer_key);
  assert.notEqual(payload.customerKeys[1].customer_key, payload.customerKeys[2].customer_key);
});

test("workbook install rejects contradictory duplicate tickets without mutating existing sales", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-workbook-conflict-"));
  const workbookPath = path.join(tempDir, "conflict.xlsx");

  const workbook = new ExcelJS.Workbook();
  const inventorySheet = workbook.addWorksheet("Inventario");
  inventorySheet.addRow(["ID", "Producto", "Categoria", "Unidad", "Precio", "Existencia", "Minimo", "Importe", "Activo", "Stock bajo"]);
  inventorySheet.addRow([1, "Producto Conflicto", "general", "pza", 11.5, 20, 0, 230, "Si", ""]);

  const salesSheet = workbook.addWorksheet("Ventas Detalle");
  salesSheet.addRow([
    "Ticket",
    "Fecha",
    "Sucursal",
    "Turno",
    "Cajero",
    "Cliente",
    "Cliente Key",
    "Metodo",
    "Cobrado hoy",
    "Cobrado por",
    "Producto",
    "Cantidad",
    "Precio Unit",
    "Total Linea",
    "Stock Antes",
    "Stock Despues",
  ]);
  salesSheet.addRow(["RIN-100", "2026-06-01T10:00:00.000Z", "Carrizal", "Tarde", "Ana", "", "", "Efectivo", 11.5, "Efectivo", "Producto Conflicto", 1, 11.5, 11.5, 20, 19]);
  salesSheet.addRow(["RIN-100", "2026-06-01T10:00:00.000Z", "Carrizal", "Tarde", "Luis", "", "", "Efectivo", 11.5, "Efectivo", "Producto Conflicto", 1, 11.5, 11.5, 19, 18]);
  fs.mkdirSync(tempDir, { recursive: true });

  return workbook.xlsx.writeFile(workbookPath).then(() => {
    const payload = runIsolatedProjectScript(`
      const fs = require("node:fs");
      const os = require("node:os");
      const path = require("node:path");

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-workbook-conflict-db-"));
      const dbPath = path.join(tempDir, "test.sqlite");
      process.env.POS_DB_PATH = dbPath;

      const { getDb, nowIso } = require("./src/db");
      const sales = require("./src/services/sales");
      const workbookImport = require("./src/services/workbookImport");

      (async () => {
        const db = getDb();
        const now = nowIso();
        db.prepare(\`
          INSERT INTO products (
            name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
          ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 20, 0, 1, 1, 0, ?, ?, ?)
        \`).run("Producto Conflicto", 11.5, "carrizal", now, now);

        sales.createSale({
          shift: "Tarde",
          cashier: "Inicial",
          branch: "carrizal",
          paymentMethod: "Efectivo",
          receivedAmount: 11.5,
          items: [{
            productId: 1,
            productName: "Producto Conflicto",
            quantity: 1,
            unitPrice: 11.5,
            lineTotal: 11.5,
          }],
        });

        const salesCountBefore = Number(db.prepare("SELECT COUNT(*) AS count FROM sales").get().count || 0);
        let errorMessage = "";
        try {
          const buffer = fs.readFileSync(${JSON.stringify(workbookPath)});
          await workbookImport.installOperationalDataFromWorkbookBuffer(buffer);
        } catch (error) {
          errorMessage = error.message || "";
        }
        const salesCountAfter = Number(db.prepare("SELECT COUNT(*) AS count FROM sales").get().count || 0);
        console.log(JSON.stringify({ errorMessage, salesCountBefore, salesCountAfter }));
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `);

    assert.match(payload.errorMessage, /datos contradictorios/i);
    assert.equal(payload.salesCountAfter, payload.salesCountBefore);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

test("final cut weighted audit stays frozen and follows the edited source event", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-weighted-audit-link-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const sales = require("./src/services/sales");
    const register = require("./src/services/register");
    const weightedAudit = require("./src/services/weightedAudit");

    const db = getDb();
    const now = nowIso();
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'quesos', 'kg', 1, 1, 15, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Queso Uno", 80, "carrizal", now, now);

    const product = db.prepare("SELECT id, name, price FROM products WHERE name = 'Queso Uno' LIMIT 1").get();
    sales.createSale({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 120,
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1.5,
        unitPrice: product.price,
        lineTotal: 120,
      }],
    });

    const finalCut = register.createRegisterCut({
      shift: "Tarde",
      cashier: "Juan",
      branch: "carrizal",
      eventType: "final_cut",
      countedAmount: 120,
      withdrawalsAmount: 0,
      notes: "",
    });

    const sessionBefore = weightedAudit.getWeightedAuditSessionBySourceRegisterEventId(finalCut.eventId);
    const promptBeforeEdit = weightedAudit.findCashierBlindAuditPrompt({
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      dateKey: sessionBefore.auditedDateKey,
    });

    const later = nowIso();
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'quesos', 'kg', 1, 1, 9, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Queso Tardio", 65, "carrizal", later, later);

    const sessionAfterCatalogChange = weightedAudit.getWeightedAuditSessionById(sessionBefore.id);

    register.updateRegisterEventAdmin(finalCut.eventId, {
      shift: "Manana",
      cashier: "Pedro",
    });

    const sessionAfterEdit = weightedAudit.getWeightedAuditSessionBySourceRegisterEventId(finalCut.eventId);
    const promptOld = weightedAudit.findCashierBlindAuditPrompt({
      branch: "carrizal",
      shift: "Tarde",
      cashier: "Juan",
      dateKey: sessionBefore.auditedDateKey,
    });
    const promptNew = weightedAudit.findCashierBlindAuditPrompt({
      branch: "carrizal",
      shift: "Manana",
      cashier: "Pedro",
      dateKey: sessionBefore.auditedDateKey,
    });

    console.log(JSON.stringify({
      sessionBefore: {
        id: sessionBefore.id,
        shift: sessionBefore.shift,
        sourceCashier: sessionBefore.sourceCashier,
        sourceRegisterEventId: sessionBefore.sourceRegisterEventId,
        itemNames: sessionBefore.items.map((item) => item.productName),
      },
      sessionAfterCatalogChange: {
        itemNames: sessionAfterCatalogChange.items.map((item) => item.productName),
      },
      sessionAfterEdit: {
        shift: sessionAfterEdit.shift,
        sourceCashier: sessionAfterEdit.sourceCashier,
        sourceRegisterEventId: sessionAfterEdit.sourceRegisterEventId,
      },
      promptBeforeEdit: promptBeforeEdit
        ? {
            sessionId: promptBeforeEdit.sessionId,
            cashier: promptBeforeEdit.cashier,
            items: promptBeforeEdit.items.map((item) => item.productName),
          }
        : null,
      promptOld,
      promptNew: promptNew
        ? {
            sessionId: promptNew.sessionId,
            cashier: promptNew.cashier,
            items: promptNew.items.map((item) => item.productName),
          }
        : null,
    }));
  `);

  assert.deepEqual(payload.sessionBefore.itemNames, ["Queso Uno"]);
  assert.deepEqual(payload.sessionAfterCatalogChange.itemNames, ["Queso Uno"]);
  assert.equal(payload.sessionAfterEdit.shift, "Manana");
  assert.equal(payload.sessionAfterEdit.sourceCashier, "Pedro");
  assert.equal(payload.sessionAfterEdit.sourceRegisterEventId, payload.sessionBefore.sourceRegisterEventId);
  assert.equal(payload.promptBeforeEdit.sessionId, payload.sessionBefore.id);
  assert.equal(payload.promptBeforeEdit.cashier, "Juan");
  assert.equal(payload.promptOld, null);
  assert.equal(payload.promptNew.sessionId, payload.sessionBefore.id);
  assert.equal(payload.promptNew.cashier, "Pedro");
  assert.deepEqual(payload.promptNew.items, ["Queso Uno"]);
});
