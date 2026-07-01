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
const DEMO_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "seed-demo-instance.js");
const WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");
const ABARROTES_WORKBOOK_PATH = path.join(ROOT_DIR, "catalogos", "abarrotes-base.xlsx");

function runNodeScript(scriptPath, args = [], options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 120000,
  });
}

test("backend service calls reference exported service functions", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-service-guard-"));
  const dbPath = path.join(tempDir, "guard.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const source = `
    const fs = require("node:fs");
    const path = require("node:path");
    const services = require("./src/services");
    const files = [
      "src/server.js",
      ...fs.readdirSync("scripts")
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join("scripts", name)),
    ];
    const exported = new Set(Object.keys(services));
    const missing = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const re = /\\bservices\\.([A-Za-z_$][A-Za-z0-9_$]*)\\b/g;
      let match;
      while ((match = re.exec(source))) {
        const name = match[1];
        if (!exported.has(name)) {
          const line = source.slice(0, match.index).split(/\\r?\\n/).length;
          missing.push({ file, line, name });
        }
      }
    }
    console.log(JSON.stringify({ missing }));
    process.exit(missing.length > 0 ? 1 : 0);
  `;
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      POS_DB_PATH: dbPath,
    },
    encoding: "utf8",
    timeout: 120000,
  });
  const payload = JSON.parse(String(result.stdout || "{}").trim() || "{}");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(payload.missing, []);
});

test("backend destructured CommonJS imports reference exported names", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-import-guard-"));
  const dbPath = path.join(tempDir, "guard.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const source = `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    process.env.POS_DB_PATH = ${JSON.stringify(dbPath)};

    function walk(dir) {
      if (!fs.existsSync(dir)) {
        return [];
      }
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", ".git", "data", ".tmp-compat"].includes(entry.name)) {
            return [];
          }
          return walk(full);
        }
        return entry.isFile() && entry.name.endsWith(".js") ? [full] : [];
      });
    }

    function resolveModule(file, spec) {
      if (!spec.startsWith(".")) {
        return null;
      }
      const base = path.resolve(path.dirname(file), spec);
      const candidates = [base, \`\${base}.js\`, path.join(base, "index.js")];
      return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
    }

    const files = [...walk("src"), ...walk("scripts")];
    const missing = [];
    for (const file of files) {
      const fileSource = fs.readFileSync(file, "utf8");
      const re = /const\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*require\\(["']([^"']+)["']\\)/g;
      let match;
      while ((match = re.exec(fileSource))) {
        const target = resolveModule(file, match[2]);
        if (!target || target.endsWith(path.join("src", "server.js"))) {
          continue;
        }
        const importedNames = match[1]
          .split(",")
          .map((part) => part.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/\\/\\/.*$/g, "").trim())
          .filter(Boolean)
          .map((part) => part.split(":")[0].trim())
          .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
        if (importedNames.length === 0) {
          continue;
        }

        let exported;
        try {
          exported = require(path.resolve(target));
        } catch (_error) {
          continue;
        }
        const keys = new Set(Object.keys(exported || {}));
        for (const name of importedNames) {
          if (!keys.has(name)) {
            const line = fileSource.slice(0, match.index).split(/\\r?\\n/).length;
            missing.push({ file, line, module: path.relative(".", target), name });
          }
        }
      }
    }
    console.log(JSON.stringify({ missing }));
    process.exit(missing.length > 0 ? 1 : 0);
  `;
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      POS_DB_PATH: dbPath,
    },
    encoding: "utf8",
    timeout: 120000,
  });
  const payload = JSON.parse(String(result.stdout || "{}").trim() || "{}");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(payload.missing, []);
});

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

test("seed-demo-instance refuses to overwrite an existing DB outside .tmp-demo", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-demo-guard-"));
  const dbPath = path.join(tempDir, "demo.sqlite");
  fs.writeFileSync(dbPath, "exists");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = runNodeScript(DEMO_SCRIPT_PATH, [
    "--db",
    dbPath,
    "--reset",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--reset solo borra DBs dentro de \.tmp-demo/i);
});

test("seed-demo-instance creates a commercial demo with users and sample activity", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-demo-"));
  const dbPath = path.join(tempDir, "demo.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = runNodeScript(
    DEMO_SCRIPT_PATH,
    [
      "--db",
      dbPath,
      "--template",
      "abarrotes",
      "--name",
      "Demo Test",
      "--slug",
      "demo-test",
      "--catalog",
      ABARROTES_WORKBOOK_PATH,
    ],
    { timeout: 120000 },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Demo Axentra POS lista/i);
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(fs.existsSync(path.join(tempDir, "demo.private.md")), true);

  const db = new Database(dbPath, { readonly: true });
  try {
    const productCount = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get()?.count || 0);
    const cashierCount = Number(db.prepare("SELECT COUNT(*) AS count FROM cashiers WHERE active = 1").get()?.count || 0);
    const salesCount = Number(db.prepare("SELECT COUNT(*) AS count FROM sales").get()?.count || 0);
    const creditSalesCount = Number(db.prepare("SELECT COUNT(*) AS count FROM sales WHERE payment_method = 'Fiado'").get()?.count || 0);
    const creditPaymentsCount = Number(db.prepare("SELECT COUNT(*) AS count FROM credit_payments").get()?.count || 0);
    const registerEventsCount = Number(db.prepare("SELECT COUNT(*) AS count FROM register_events").get()?.count || 0);
    const ownerCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'owner.%'").get()?.count || 0);
    const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'admin.%'").get()?.count || 0);

    assert.ok(productCount > 0);
    assert.ok(cashierCount >= 1);
    assert.equal(salesCount, 3);
    assert.equal(creditSalesCount, 1);
    assert.equal(creditPaymentsCount, 1);
    assert.ok(registerEventsCount >= 2);
    assert.ok(ownerCount >= 2);
    assert.ok(adminCount >= 2);
  } finally {
    db.close();
  }
});
