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

test("supplier merchandise request records real cost without changing physical quantity", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-merch-cost-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb } = require("./src/db");
    const services = require("./src/services");
    const db = getDb();

    const product = services.createProduct({
      branch: "carrizal",
      name: "Queso costo proveedor",
      price: 100,
      cost: 40,
      stock: 5,
      category: "general",
      unit: "kg",
    });
    const request = services.createMerchandiseRequest({
      requestedBy: "Caja 1",
      branch: "carrizal",
      supplierName: "Proveedor Real",
      items: [{
        productId: product.id,
        quantity: 3,
        totalValue: 90,
        mode: "receive",
      }],
    });
    const approved = services.approveMerchandiseRequest(request.id);
    const returnRequest = services.createMerchandiseRequest({
      requestedBy: "Caja 1",
      branch: "carrizal",
      supplierName: "Proveedor Real",
      items: [{
        productId: product.id,
        quantity: 1,
        totalValue: 15,
        mode: "return",
      }],
    });
    services.approveMerchandiseRequest(returnRequest.id);

    const productRow = db.prepare("SELECT stock, cost FROM products WHERE id = ?").get(product.id);
    const itemRow = db.prepare("SELECT quantity, unit_price, total_value FROM merchandise_request_items WHERE request_id = ?").get(request.id);
    console.log(JSON.stringify({
      approvedQuantity: approved.items[0].quantity,
      itemQuantity: itemRow.quantity,
      itemUnitPrice: itemRow.unit_price,
      itemTotalValue: itemRow.total_value,
      finalStock: productRow.stock,
      finalCost: productRow.cost,
    }));
  `);

  assert.equal(payload.approvedQuantity, 3);
  assert.equal(payload.itemQuantity, 3);
  assert.equal(payload.itemUnitPrice, 30);
  assert.equal(payload.itemTotalValue, 90);
  assert.equal(payload.finalStock, 7);
  assert.equal(payload.finalCost, 30);
});

test("product duplicate merge keeps history and unifies stock in the target product", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-product-merge-"));
    process.env.POS_DB_PATH = path.join(tempDir, "test.sqlite");

    const { getDb } = require("./src/db");
    const services = require("./src/services");
    const db = getDb();

    const target = services.createProduct({
      branch: "carrizal",
      name: "Leche principal",
      price: 22,
      cost: 14,
      stock: 7,
      category: "general",
      unit: "pza",
      barcode: "750000000001",
    });
    const source = services.createProduct({
      branch: "carrizal",
      name: "Leche duplicada",
      price: 22,
      cost: 13,
      stock: 4,
      category: "general",
      unit: "pza",
      barcode: "750000000001",
    });

    services.createSale({
      shift: "Tarde",
      cashier: "Ana",
      branch: "carrizal",
      paymentMethod: "Efectivo",
      receivedAmount: 22,
      items: [{
        productId: source.id,
        productName: source.name,
        quantity: 1,
        unitPrice: 22,
        lineTotal: 22,
      }],
    });

    const candidatesBefore = services.listProductDuplicateCandidates("carrizal", { search: "750000000001" });
    const merge = services.mergeProductDuplicates({
      branch: "carrizal",
      sourceProductId: source.id,
      targetProductId: target.id,
    });
    const targetRow = db.prepare("SELECT stock, active FROM products WHERE id = ?").get(target.id);
    const sourceRow = db.prepare("SELECT stock, active FROM products WHERE id = ?").get(source.id);
    const saleItem = db.prepare("SELECT product_id FROM sale_items LIMIT 1").get();
    const mergeMovement = db.prepare("SELECT quantity_delta, stock_before, stock_after FROM inventory_movements WHERE reference_type = 'product_merge'").get();

    console.log(JSON.stringify({
      candidatesBefore: candidatesBefore.length,
      targetStock: targetRow.stock,
      targetActive: targetRow.active,
      sourceStock: sourceRow.stock,
      sourceActive: sourceRow.active,
      saleProductId: saleItem.product_id,
      targetProductId: target.id,
      stockMerged: merge.stockMerged,
      mergeMovement,
    }));
  `);

  assert.equal(payload.candidatesBefore, 1);
  assert.equal(payload.targetStock, 10);
  assert.equal(payload.targetActive, 1);
  assert.equal(payload.sourceStock, 0);
  assert.equal(payload.sourceActive, 0);
  assert.equal(payload.saleProductId, payload.targetProductId);
  assert.equal(payload.stockMerged, 3);
  assert.deepEqual(payload.mergeMovement, {
    quantity_delta: 3,
    stock_before: 7,
    stock_after: 10,
  });
});

test("generic product onboarding previews duplicates and safely upserts CSV rows", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-onboarding-import-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    (async () => {
      const { getDb, nowIso } = require("./src/db");
      const helpers = require("./src/utils/helpers");
      const onboarding = require("./src/services/productOnboardingImport");

      const db = getDb();
      const now = nowIso();
      const category = helpers.getProductCategoryRecord("general", { includeInactive: true });
      const unit = helpers.getMeasurementUnitRecord("pza", { includeInactive: true });
      db.prepare(\`
        INSERT INTO products (
          name, price, cost, category, unit, category_id, unit_id, sku, stock,
          min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`).run(
        "Producto Viejo",
        10,
        4,
        category.code,
        unit.code,
        category.id,
        unit.id,
        "SKU-1",
        5,
        1,
        1,
        1,
        1,
        "carrizal",
        now,
        now,
      );

      const duplicateCsv = path.join(tempDir, "duplicados.csv");
      fs.writeFileSync(
        duplicateCsv,
        [
          "Producto,Precio,SKU,Existencia,Categoria,Unidad",
          "Producto Viejo,12.50,SKU-1,8,general,pza",
          "Producto Nuevo,20.00,SKU-2,3,general,pza",
          "Producto Nuevo,21.00,SKU-3,4,general,pza",
        ].join("\\n"),
      );
      const duplicatePreview = await onboarding.buildProductOnboardingPreview({
        filePath: duplicateCsv,
        originalName: "duplicados.csv",
        branch: "carrizal",
      });

      const cleanCsv = path.join(tempDir, "limpio.csv");
      fs.writeFileSync(
        cleanCsv,
        [
          "Producto,Precio,SKU,Existencia,Categoria,Unidad,Costo",
          "Producto Viejo Actualizado,12.50,SKU-1,8,general,pza,6.25",
          "Producto Nuevo,20.00,SKU-2,3,general,pza,9.00",
        ].join("\\n"),
      );
      const cleanPreview = await onboarding.buildProductOnboardingPreview({
        filePath: cleanCsv,
        originalName: "limpio.csv",
        branch: "carrizal",
      });
      const importResult = await onboarding.applyProductOnboardingImport({
        filePath: cleanCsv,
        originalName: "limpio.csv",
        branch: "carrizal",
      });
      const products = db.prepare(\`
        SELECT name, price, cost, sku, stock, active
        FROM products
        WHERE branch = 'carrizal'
        ORDER BY sku
      \`).all();

      console.log(JSON.stringify({
        duplicateSummary: duplicatePreview.summary,
        duplicateStatuses: duplicatePreview.rows.map((row) => ({ status: row.status, errors: row.errors })),
        cleanSummary: cleanPreview.summary,
        importSummary: importResult.summary,
        products,
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `);

  assert.equal(payload.duplicateSummary.errors, 1);
  assert.equal(payload.duplicateStatuses.at(-1).status, "error");
  assert.match(payload.duplicateStatuses.at(-1).errors.join(" "), /Duplicado en archivo/);
  assert.equal(payload.cleanSummary.update, 1);
  assert.equal(payload.cleanSummary.create, 1);
  assert.equal(payload.importSummary.imported, 2);
  assert.equal(payload.importSummary.created, 1);
  assert.equal(payload.importSummary.updated, 1);
  assert.deepEqual(
    payload.products.map((product) => ({
      name: product.name,
      price: product.price,
      cost: product.cost,
      sku: product.sku,
      stock: product.stock,
      active: product.active,
    })),
    [
      { name: "Producto Viejo Actualizado", price: 12.5, cost: 6.25, sku: "SKU-1", stock: 8, active: 1 },
      { name: "Producto Nuevo", price: 20, cost: 9, sku: "SKU-2", stock: 3, active: 1 },
    ],
  );
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

test("creating a branch copies the existing product catalog and stock", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-branch-copy-products-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    process.env.POS_DB_PATH = dbPath;

    const { getDb, nowIso } = require("./src/db");
    const branches = require("./src/services/branches");

    const db = getDb();
    const now = nowIso();
    const definition = db.prepare(\`
      INSERT INTO product_attribute_definitions (
        key,
        label,
        value_type,
        options_json,
        required,
        sort_order,
        active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?)
    \`).run("proveedor_clave", "Clave proveedor", "text", "[]", now, now);
    const product = db.prepare(\`
      INSERT INTO products (
        name,
        price,
        cost,
        category,
        unit,
        category_id,
        unit_id,
        sku,
        barcode,
        brand,
        supplier_name,
        pack_size,
        stock,
        min_stock,
        stock_initialized,
        active,
        display_order,
        branch,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'general', 'pza', 4, 2, ?, ?, ?, ?, ?, ?, ?, 1, 1, 7, ?, ?, ?)
    \`).run(
      "Queso Copia",
      42,
      20,
      "Q-COP",
      "750123",
      "Rancho",
      "Proveedor Norte",
      1,
      18,
      3,
      "carrizal",
      now,
      now,
    );
    db.prepare(\`
      INSERT INTO product_attribute_values (product_id, definition_id, value_text, updated_at)
      VALUES (?, ?, ?, ?)
    \`).run(product.lastInsertRowid, definition.lastInsertRowid, "ABC-9", now);

    const branch = branches.createBranch({
      code: "norte",
      name: "Sucursal Norte",
      sourceBranch: "carrizal",
    });

    const copied = db.prepare(\`
      SELECT name, price, cost, sku, barcode, brand, supplier_name, pack_size, stock, min_stock, stock_initialized, active, display_order, branch
      FROM products
      WHERE branch = 'norte' AND name = 'Queso Copia'
    \`).get();
    const attributeValue = db.prepare(\`
      SELECT pav.value_text
      FROM product_attribute_values pav
      JOIN products p ON p.id = pav.product_id
      WHERE p.branch = 'norte' AND p.name = 'Queso Copia'
    \`).get();
    const movement = db.prepare(\`
      SELECT movement_type, branch, quantity_delta, stock_before, stock_after, note, reference_type
      FROM inventory_movements
      WHERE branch = 'norte'
    \`).get();

    console.log(JSON.stringify({
      branch,
      copied,
      attributeValue,
      movement,
    }));
  `);

  assert.equal(payload.branch.productCopy.sourceBranch, "carrizal");
  assert.equal(payload.branch.productCopy.productsCopied, 1);
  assert.equal(payload.copied.branch, "norte");
  assert.equal(payload.copied.stock, 18);
  assert.equal(payload.copied.stock_initialized, 1);
  assert.equal(payload.copied.supplier_name, "Proveedor Norte");
  assert.equal(payload.attributeValue.value_text, "ABC-9");
  assert.equal(payload.movement.stock_after, 18);
  assert.equal(payload.movement.reference_type, "branch_create");
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

test("admin can rename and merge duplicate receivable customers without losing sales or payments", () => {
  const payload = runIsolatedProjectScript(`
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-receivable-merge-"));
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
    db.prepare(\`
      INSERT INTO products (
        name, price, cost, category, unit, category_id, unit_id, stock, min_stock, stock_initialized, active, display_order, branch, created_at, updated_at
      ) VALUES (?, ?, 0, 'general', 'pza', 4, 2, 50, 0, 1, 1, 0, ?, ?, ?)
    \`).run("Producto Miradores", 12, "miradores", now, now);

    const product = db.prepare("SELECT id, name, price FROM products WHERE branch = 'carrizal' LIMIT 1").get();
    const otherProduct = db.prepare("SELECT id, name, price FROM products WHERE branch = 'miradores' LIMIT 1").get();
    const targetKey = "cust:carrizal:ana-perez:target";
    const sourceKey = "cust:carrizal:ana-perez:source";

    const targetSale = sales.createSale({
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Ana Perez",
      customerKey: targetKey,
      receivedAmount: 2,
      receivedPaymentMethod: "Efectivo",
      items: [{
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        lineTotal: product.price,
      }],
    });
    const sourceSale = sales.createSale({
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      paymentMethod: "Fiado",
      customerName: "Ana Pérez",
      customerKey: sourceKey,
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
      branch: "miradores",
      paymentMethod: "Fiado",
      customerName: "Ana Perez",
      customerKey: "cust:miradores:ana-perez:other",
      receivedAmount: 0,
      items: [{
        productId: otherProduct.id,
        productName: otherProduct.name,
        quantity: 1,
        unitPrice: otherProduct.price,
        lineTotal: otherProduct.price,
      }],
    });

    receivables.createReceivablePayment({
      saleId: sourceSale.id,
      shift: "Tarde",
      cashier: "Luz",
      branch: "carrizal",
      amount: 5,
      paymentMethod: "Efectivo",
      notes: "Abono antes de fusion",
    });

    const candidatesBefore = receivables.listReceivableDuplicateCandidates("carrizal");
    const renameResult = receivables.renameReceivableCustomer({
      branch: "carrizal",
      customerKey: sourceKey,
      customerName: "Ana Perez Local",
    });
    const candidatesAfterRename = receivables.listReceivableDuplicateCandidates("carrizal");
    const mergeResult = receivables.mergeReceivableCustomers({
      branch: "carrizal",
      sourceCustomerKey: sourceKey,
      targetCustomerKey: targetKey,
      targetCustomerName: "Ana Perez",
    });
    const mergedDetail = receivables.getReceivableCustomerDetail(targetKey, "carrizal");
    const rows = db.prepare(\`
      SELECT 'sale' AS kind, id, customer_name, customer_key FROM sales
      UNION ALL
      SELECT 'payment' AS kind, id, customer_name, customer_key FROM credit_payments
      ORDER BY kind, id
    \`).all();
    let crossBranchMessage = "";
    try {
      receivables.mergeReceivableCustomers({
        branch: "miradores",
        sourceCustomerKey: sourceKey,
        targetCustomerKey: "cust:miradores:ana-perez:other",
      });
    } catch (error) {
      crossBranchMessage = error.message;
    }

    console.log(JSON.stringify({
      candidatesBefore,
      candidatesAfterRename,
      renameResult,
      mergeResult,
      mergedDetail,
      rows,
      targetSaleId: targetSale.id,
      sourceSaleId: sourceSale.id,
      crossBranchMessage,
    }));
  `);

  assert.equal(payload.candidatesBefore.length, 1);
  assert.equal(payload.candidatesBefore[0].customers.length, 2);
  assert.equal(payload.renameResult.salesUpdated, 1);
  assert.equal(payload.renameResult.paymentsUpdated, 1);
  assert.equal(payload.candidatesAfterRename.length, 0);
  assert.equal(payload.mergeResult.salesUpdated, 1);
  assert.equal(payload.mergeResult.sourcePaymentsUpdated, 1);
  assert.equal(payload.mergedDetail.sales.length, 2);
  assert.equal(payload.mergedDetail.pendingAmount, 17);
  assert.equal(payload.mergedDetail.paidAmount, 7);
  assert.equal(payload.rows.filter((row) => row.kind === "sale").length, 3);
  assert.equal(payload.rows.filter((row) => row.kind === "payment").length, 1);
  assert.equal(
    payload.rows.filter((row) => row.kind === "sale" && [payload.targetSaleId, payload.sourceSaleId].includes(row.id))
      .every((row) => row.customer_key === "cust:carrizal:ana-perez:target"),
    true,
  );
  assert.equal(payload.rows.find((row) => row.kind === "payment").customer_key, "cust:carrizal:ana-perez:target");
  assert.equal(payload.crossBranchMessage, "No encontre el cliente fiado origen.");
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
