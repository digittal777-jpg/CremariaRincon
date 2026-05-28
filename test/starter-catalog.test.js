const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const Database = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const SEED_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "seed-business-template.js");
const { listStarterCatalogDefinitions } = require("../src/starterCatalogs");

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 120000,
  });
}

const EXPECTATIONS = {
  abarrotes: {
    minProducts: 70,
    requiredCategories: ["dulces", "higiene", "hogar"],
    extraAssertions(db) {
      const beverages = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE category = 'bebidas'").get()?.count || 0);
      const hygiene = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE category = 'higiene'").get()?.count || 0);
      assert.ok(beverages >= 10);
      assert.ok(hygiene >= 6);
    },
  },
  cremeria: {
    minProducts: 40,
    requiredCategories: ["quesos", "carnes", "piezas", "general"],
    extraAssertions(db) {
      const kgProducts = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE unit = 'kg'").get()?.count || 0);
      const cheeseItems = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE category = 'quesos'").get()?.count || 0);
      assert.ok(kgProducts >= 18);
      assert.ok(cheeseItems >= 10);
    },
  },
  papeleria: {
    minProducts: 55,
    requiredCategories: ["cuadernos", "escritura", "oficina", "arte", "impresion"],
    extraAssertions(db) {
      const rollItems = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE unit = 'rollo'").get()?.count || 0);
      const meterItems = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE unit = 'metro'").get()?.count || 0);
      const printItems = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE category = 'impresion'").get()?.count || 0);
      assert.ok(rollItems >= 3);
      assert.ok(meterItems >= 2);
      assert.ok(printItems >= 6);
    },
  },
};

for (const definition of listStarterCatalogDefinitions()) {
  const workbookPath = path.join(ROOT_DIR, "catalogos", definition.fileName);
  const expectations = EXPECTATIONS[definition.templateKey];

  test(`starter ${definition.templateKey} workbook seeds a fresh business with a compatible catalog`, (t) => {
    assert.equal(
      fs.existsSync(workbookPath),
      true,
      `No existe catalogos/${definition.fileName}`,
    );

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `retail-base-${definition.templateKey}-`));
    const dbPath = path.join(tempDir, "starter.sqlite");

    t.after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const result = runNodeScript(
      SEED_SCRIPT_PATH,
      [
        "--template",
        definition.templateKey,
        "--name",
        `${definition.businessName} Starter`,
        "--slug",
        `${definition.templateKey}-starter`,
        "--catalog",
        workbookPath,
      ],
      {
        env: {
          ...process.env,
          POS_DB_PATH: dbPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Productos importados:\s+\d+/i);

    const db = new Database(dbPath, { readonly: true });
    try {
      const productCount = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get()?.count || 0);
      const categories = db.prepare("SELECT code FROM product_categories WHERE active = 1 ORDER BY sort_order").all().map((row) => row.code);
      const stockCount = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE stock <> 0").get()?.count || 0);

      assert.ok(
        productCount >= expectations.minProducts,
        `Esperaba al menos ${expectations.minProducts} productos y solo encontre ${productCount}.`,
      );
      expectations.requiredCategories.forEach((categoryCode) => {
        assert.ok(categories.includes(categoryCode), `Falta la categoria ${categoryCode}.`);
      });
      expectations.extraAssertions(db);
      assert.equal(stockCount, 0);
    } finally {
      db.close();
    }
  });
}
