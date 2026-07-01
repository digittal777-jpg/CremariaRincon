const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_TEMPLATE = "cremeria";
const DEFAULT_DEMO_DB_PATH = path.join(ROOT_DIR, ".tmp-demo", "axentra-demo.sqlite");
const DEMO_OWNER = { username: "demo_owner", password: "DemoOwner123" };
const DEMO_ADMIN = { username: "demo_admin", password: "DemoAdmin123" };
const DEMO_CASHIER = { name: "Ana Demo", password: "1234" };

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolvePath(value, fallbackPath) {
  const rawPath = String(value || "").trim();
  const selectedPath = rawPath || fallbackPath;
  return path.isAbsolute(selectedPath)
    ? selectedPath
    : path.resolve(process.cwd(), selectedPath);
}

function resolveCatalogPath(templateKey, explicitCatalogPath) {
  const fallbackPath = path.join(ROOT_DIR, "catalogos", `${templateKey}-base.xlsx`);
  const catalogPath = resolvePath(explicitCatalogPath, fallbackPath);
  if (!fs.existsSync(catalogPath) || !fs.statSync(catalogPath).isFile()) {
    throw new Error(`No existe el catalogo demo: ${catalogPath}`);
  }
  return catalogPath;
}

function removeSqliteFiles(dbPath) {
  [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  });
}

function prepareDemoDbPath(dbPath, reset) {
  const resolvedDbPath = path.resolve(dbPath);
  const safeDefaultDir = path.resolve(ROOT_DIR, ".tmp-demo");

  if (fs.existsSync(resolvedDbPath)) {
    if (!reset) {
      throw new Error(`La DB demo ya existe. Usa --reset para regenerar: ${resolvedDbPath}`);
    }
    if (!resolvedDbPath.startsWith(`${safeDefaultDir}${path.sep}`)) {
      throw new Error("Por seguridad, --reset solo borra DBs dentro de .tmp-demo/.");
    }
    removeSqliteFiles(resolvedDbPath);
  }

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  return resolvedDbPath;
}

function roundMoney(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 100) / 100;
}

function pickDemoProducts(db, branch) {
  const rows = db.prepare(`
    SELECT id, name, price, unit, stock
    FROM products
    WHERE active = 1 AND branch = ?
    ORDER BY CASE WHEN unit = 'pza' THEN 0 ELSE 1 END, display_order, id
    LIMIT 12
  `).all(branch);

  if (rows.length < 4) {
    throw new Error("La demo necesita al menos 4 productos activos para sembrar ventas.");
  }

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    price: roundMoney(row.price),
    unit: row.unit,
    stock: Number(row.stock || 0),
  }));
}

function buildLine(product, requestedQuantity) {
  const quantity = product.unit === "pza"
    ? Math.max(1, Math.round(Number(requestedQuantity || 1)))
    : Math.max(0.25, Number(requestedQuantity || 0.5));
  const lineTotal = roundMoney(quantity * product.price);

  return {
    productId: product.id,
    quantity,
    unitPrice: product.price,
    lineTotal,
  };
}

function getLineTotal(items) {
  return roundMoney(items.reduce((sum, item) => sum + roundMoney(item.lineTotal), 0));
}

function buildCashReceived(total) {
  return Math.ceil(roundMoney(total) / 50) * 50 || total;
}

function setDemoCredentials({ ownerAuth, adminAuth, services, branch }) {
  ownerAuth.setStoredOwnerCredentials(DEMO_OWNER.username, DEMO_OWNER.password);
  adminAuth.setSetting("admin.username", DEMO_ADMIN.username);
  adminAuth.setSetting("admin.password", JSON.stringify(adminAuth.hashAdminPassword(DEMO_ADMIN.password)));
  services.updateAdminCapabilities([
    "daily_flow",
    "backups",
    "merchandise_requests",
    "inventory",
    "branches",
    "cashiers",
    "business_config",
    "audit_log",
    "support_tools",
    "quick_edit",
  ]);

  services.createCashier({
    name: DEMO_CASHIER.name,
    branch,
    password: DEMO_CASHIER.password,
  });
}

function seedDemoActivity({ db, services, branch }) {
  db.prepare(`
    UPDATE products
    SET stock = CASE WHEN stock < 25 THEN 25 ELSE stock END,
        stock_initialized = 1,
        updated_at = ?
    WHERE active = 1 AND branch = ?
  `).run(new Date().toISOString(), branch);

  const products = pickDemoProducts(db, branch);
  const shift = "Tarde";
  const cashier = DEMO_CASHIER.name;

  services.startRegister({
    shift,
    branch,
    cashier,
    openingAmount: 500,
    notes: "Demo: inicio de caja con fondo inicial.",
    clientEventId: "demo-register-start",
  });

  const saleOneItems = [
    buildLine(products[0], 2),
    buildLine(products[1], 1),
  ];
  const saleOneTotal = getLineTotal(saleOneItems);
  const cashSale = services.createSale({
    clientSaleId: "demo-sale-cash",
    shift,
    cashier,
    branch,
    paymentMethod: "Efectivo",
    receivedAmount: buildCashReceived(saleOneTotal),
    notes: "Demo: venta rapida de mostrador.",
    items: saleOneItems,
  });

  const saleTwoItems = [
    buildLine(products[2], 1),
    buildLine(products[3], 3),
  ];
  const cardSale = services.createSale({
    clientSaleId: "demo-sale-card",
    shift,
    cashier,
    branch,
    paymentMethod: "Tarjeta",
    notes: "Demo: venta con pago por tarjeta.",
    items: saleTwoItems,
  });

  const creditItems = [
    buildLine(products[4] || products[0], 2),
    buildLine(products[5] || products[1], 1),
  ];
  const creditTotal = getLineTotal(creditItems);
  const initialCreditPayment = Math.min(20, Math.max(5, roundMoney(creditTotal / 3)));
  const creditSale = services.createSale({
    clientSaleId: "demo-sale-credit",
    shift,
    cashier,
    branch,
    paymentMethod: "Fiado",
    customerName: "Cliente Demo",
    receivedPaymentMethod: "Efectivo",
    receivedAmount: initialCreditPayment,
    notes: "Demo: fiado con abono inicial.",
    items: creditItems,
  });

  const pendingAfterInitialPayment = roundMoney(creditSale.pendingAmount || creditTotal - initialCreditPayment);
  const laterPaymentAmount = Math.min(15, Math.max(1, roundMoney(pendingAfterInitialPayment / 2)));
  const creditPayment = services.createReceivablePayment({
    clientPaymentId: "demo-credit-payment",
    saleId: creditSale.id,
    shift,
    cashier,
    branch,
    paymentMethod: "Efectivo",
    amount: laterPaymentAmount,
    notes: "Demo: abono posterior al fiado.",
  });

  const summary = services.getRegisterSummary(shift, branch, { cashier });
  const withdrawal = summary.expectedCash >= 100 ? 50 : 0;
  const quickCut = services.createRegisterCut({
    eventType: "quick_cut",
    shift,
    branch,
    cashier,
    withdrawalsAmount: withdrawal,
    countedAmount: roundMoney(summary.expectedCash - withdrawal),
    notes: withdrawal > 0
      ? "Demo: corte parcial con retiro de efectivo."
      : "Demo: corte parcial sin retiro.",
    clientEventId: "demo-register-quick-cut",
  });

  return {
    productsCount: products.length,
    sales: [cashSale, cardSale, creditSale],
    creditPayment,
    quickCut,
  };
}

function writeDemoReport({ dbPath, reportPath, businessName, slug, branch, activity }) {
  const content = `# Axentra POS Demo

Demo generada para mostrar caja, inventario, fiado, cortes y administracion sin datos reales.

## Arranque local

\`\`\`powershell
$env:POS_DB_PATH='${path.relative(ROOT_DIR, dbPath).replace(/\\/g, "/")}'
$env:POS_PUBLIC_ORIGIN='http://localhost:3100'
$env:POS_ALLOWED_ORIGINS='http://localhost:3100'
$env:POS_SECURE_COOKIES='false'
npm.cmd start
\`\`\`

URL: http://localhost:3100

## Accesos demo

| Rol | Usuario/nombre | Sucursal | Contrasena |
|---|---|---|---|
| Owner | ${DEMO_OWNER.username} | - | ${DEMO_OWNER.password} |
| Admin | ${DEMO_ADMIN.username} | - | ${DEMO_ADMIN.password} |
| Cajero | ${DEMO_CASHIER.name} | ${branch} | ${DEMO_CASHIER.password} |

## Datos sembrados

- Negocio: ${businessName}
- Slug: ${slug}
- Sucursal: ${branch}
- Productos disponibles: ${activity.productsCount}
- Ventas demo: ${activity.sales.length}
- Fiado demo: ticket ${activity.sales[2]?.ticketNumber || ""}
- Abono demo: ${activity.creditPayment?.amount || 0}
- Corte demo: evento ${activity.quickCut?.eventId || ""}

## Uso recomendado

1. Entrar como cajero y hacer una venta rapida.
2. Entrar a admin y mostrar ventas, inventario y fiado.
3. Mostrar el corte parcial ya sembrado.
4. Reiniciar la demo con \`npm.cmd run seed:demo -- --reset\` cuando quieras limpiarla.
`;

  fs.writeFileSync(reportPath, content, "utf8");
}

async function main() {
  const templateKey = getFlagValue("template") || DEFAULT_TEMPLATE;
  const businessName = getFlagValue("name") || "Axentra POS Demo";
  const slug = normalizeSlug(getFlagValue("slug") || "axentra-demo");
  const dbPath = prepareDemoDbPath(
    resolvePath(getFlagValue("db"), DEFAULT_DEMO_DB_PATH),
    hasFlag("reset"),
  );
  const catalogPath = resolveCatalogPath(templateKey, getFlagValue("catalog"));
  const reportPath = path.join(path.dirname(dbPath), `${path.basename(dbPath, path.extname(dbPath))}.private.md`);

  process.env.POS_DB_PATH = dbPath;

  const services = require("../src/services");
  const adminAuth = require("../src/admin/auth");
  const ownerAuth = require("../src/owner/auth");
  const { getDb } = require("../src/db");
  const db = getDb();

  const template = services.loadBusinessTemplate(templateKey);
  await services.applyBusinessTemplateWithCatalog(template, {
    businessName,
    slug,
    workbookPath: catalogPath,
    confirmReset: true,
    skipConfirmGuard: true,
    actorType: "script",
    actorName: "seed-demo-instance",
  });

  const branchRows = db.prepare(`
    SELECT code
    FROM branches
    WHERE active = 1
    ORDER BY sort_order, code
  `).all();
  const branch = branchRows[0]?.code;
  if (!branch) {
    throw new Error("La plantilla demo no dejo una sucursal activa.");
  }

  setDemoCredentials({ ownerAuth, adminAuth, services, branch });
  const activity = seedDemoActivity({ db, services, branch });
  writeDemoReport({ dbPath, reportPath, businessName, slug, branch, activity });

  console.log("Demo Axentra POS lista.");
  console.log(`DB: ${dbPath}`);
  console.log(`Reporte: ${reportPath}`);
  console.log("");
  console.log("Accesos:");
  console.log(`  Owner: ${DEMO_OWNER.username} / ${DEMO_OWNER.password}`);
  console.log(`  Admin: ${DEMO_ADMIN.username} / ${DEMO_ADMIN.password}`);
  console.log(`  Cajero: ${DEMO_CASHIER.name} (${branch}) / ${DEMO_CASHIER.password}`);
  console.log("");
  console.log("Arranque:");
  console.log(`  $env:POS_DB_PATH='${path.relative(ROOT_DIR, dbPath).replace(/\\/g, "/")}'`);
  console.log("  npm.cmd start");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
