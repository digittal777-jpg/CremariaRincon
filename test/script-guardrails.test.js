const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const Database = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const SEED_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "seed-business-template.js");
const CLONE_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "clone-business.js");
const WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 120000,
  });
}

test("seed-business-template requires an explicit catalog path", () => {
  const result = runNodeScript(SEED_SCRIPT_PATH, [
    "--template",
    "cremeria",
    "--name",
    "Negocio Test",
    "--slug",
    "negocio-test",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Uso: node scripts\/seed-business-template\.js/i);
});

test("clone-business requires an explicit catalog path", () => {
  const result = runNodeScript(CLONE_SCRIPT_PATH, [
    "--template",
    "cremeria",
    "--name",
    "Negocio Test",
    "--slug",
    "negocio-test",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Uso: npm run clone:business/i);
});

test("clone-business rejects a missing workbook before creating the target folder", () => {
  const slug = `clone-guard-${Date.now()}`;
  const targetDir = path.join(path.dirname(ROOT_DIR), slug);

  try {
    const result = runNodeScript(CLONE_SCRIPT_PATH, [
      "--template",
      "cremeria",
      "--name",
      "Negocio Test",
      "--slug",
      slug,
      "--catalog",
      ".\\no-existe.xlsx",
    ]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /No existe el Excel indicado para el clon/i);
    assert.equal(fs.existsSync(targetDir), false);
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("seed-business-template imports a non-empty catalog into a fresh database", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-seed-"));
  const dbPath = path.join(tempDir, "seed.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = runNodeScript(
    SEED_SCRIPT_PATH,
    [
      "--template",
      "cremeria",
      "--name",
      "Negocio Seed",
      "--slug",
      "negocio-seed",
      "--catalog",
      WORKBOOK_PATH,
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
  assert.equal(fs.existsSync(dbPath), true);

  const db = new Database(dbPath, { readonly: true });
  try {
    const productCount = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get()?.count || 0);
    const ownerCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'owner.%'").get()?.count || 0);
    const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'admin.%'").get()?.count || 0);
    assert.ok(productCount > 0);
    assert.equal(ownerCount, 0);
    assert.equal(adminCount, 0);
  } finally {
    db.close();
  }
});
