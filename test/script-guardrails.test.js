const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const Database = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const SEED_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "seed-business-template.js");
const CLONE_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "clone-business.js");
const DEMO_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "seed-demo-instance.js");
const PROVISION_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "provision-client.js");
const VALIDATE_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "validate-client.js");
const READINESS_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "readiness-gate.js");
const PRINT_QA_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "generate-print-qa-ticket.js");
const RUN_TESTS_ISOLATED_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "run-tests-isolated.js");
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

function runNodeScriptAsync(scriptPath, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, options.timeout || 120000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
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

test("run-tests-isolated creates an empty POS_CONFIG_PATH when none is provided", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-test-wrapper-"));
  const childTestPath = path.join(tempDir, "runtime-env-check.test.js");
  fs.writeFileSync(childTestPath, `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const test = require("node:test");

    test("isolated runtime path exists", () => {
      assert.ok(process.env.POS_CONFIG_PATH);
      assert.equal(fs.existsSync(process.env.POS_CONFIG_PATH), true);
      assert.equal(fs.readFileSync(process.env.POS_CONFIG_PATH, "utf8").trim(), "{}");
      const relative = path.relative(os.tmpdir(), process.env.POS_CONFIG_PATH);
      assert.equal(relative.startsWith(".."), false);
    });
  `, "utf8");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = { ...process.env };
  delete env.POS_CONFIG_PATH;
  const result = runNodeScript(RUN_TESTS_ISOLATED_SCRIPT_PATH, [childTestPath], {
    env,
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("run-tests-isolated respects an explicit POS_CONFIG_PATH", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-test-wrapper-explicit-"));
  const runtimePath = path.join(tempDir, "runtime.json");
  const childTestPath = path.join(tempDir, "runtime-explicit-check.test.js");
  fs.writeFileSync(runtimePath, JSON.stringify({ env: { POS_PUBLIC_ORIGIN: "https://explicit.example" } }), "utf8");
  fs.writeFileSync(childTestPath, `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const test = require("node:test");

    test("explicit runtime path is preserved", () => {
      assert.equal(process.env.POS_CONFIG_PATH, ${JSON.stringify(runtimePath)});
      const parsed = JSON.parse(fs.readFileSync(process.env.POS_CONFIG_PATH, "utf8"));
      assert.equal(parsed.env.POS_PUBLIC_ORIGIN, "https://explicit.example");
    });
  `, "utf8");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = runNodeScript(RUN_TESTS_ISOLATED_SCRIPT_PATH, [childTestPath], {
    env: {
      ...process.env,
      POS_CONFIG_PATH: runtimePath,
    },
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
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

test("validate-client rejects invalid public URLs", () => {
  const result = runNodeScript(VALIDATE_SCRIPT_PATH, [
    "--slug",
    "cliente-demo",
    "--url",
    "no-es-url",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /URL debe ser absoluta/i);
});

test("validate-client rejects insecure remote HTTP URLs", () => {
  const result = runNodeScript(VALIDATE_SCRIPT_PATH, [
    "--slug",
    "cliente-demo",
    "--url",
    "http://cliente-remoto.example",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /HTTPS fuera de localhost/i);
});

test("provision-client rejects insecure remote public URLs", () => {
  const result = runNodeScript(PROVISION_SCRIPT_PATH, [
    "--slug",
    "cliente-demo",
    "--name",
    "Cliente Demo",
    "--template",
    "abarrotes",
    "--catalog",
    ABARROTES_WORKBOOK_PATH,
    "--public-url",
    "http://cliente-remoto.example",
    "--plan-only",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /HTTPS fuera de localhost/i);
});

test("validate-client writes a private validation report for healthy endpoints", async (t) => {
  let reportPath = "";
  const server = http.createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/api/bootstrap") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ configured: true }));
      return;
    }
    if (request.url === "/manifest.webmanifest") {
      response.writeHead(200, { "Content-Type": "application/manifest+json" });
      response.end(JSON.stringify({ name: "Demo" }));
      return;
    }
    if (request.url === "/administracion") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<html><body>Administracion admin</body></html>");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });

  t.after(() => {
    server.close();
    if (reportPath) {
      fs.rmSync(reportPath, { force: true });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const result = await runNodeScriptAsync(VALIDATE_SCRIPT_PATH, [
    "--slug",
    "cliente-demo",
    "--url",
    `http://127.0.0.1:${port}`,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validacion aprobada/i);
  const reportLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("Reporte:"));
  assert.ok(reportLine);
  reportPath = reportLine.replace("Reporte:", "").trim();
  assert.equal(fs.existsSync(reportPath), true);
  const report = fs.readFileSync(reportPath, "utf8");
  assert.match(report, /estado: aprobada/i);
  assert.match(report, /\| Health \| OK \| 200 \|/i);
  assert.match(report, /\| Administracion \| OK \| 200 \|/i);
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
  assert.match(result.stdout, /Demo Merxalia POS lista/i);
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(fs.existsSync(path.join(tempDir, "demo.private.md")), true);

  const db = new Database(dbPath, { readonly: true });
  try {
    const productCount = Number(db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get()?.count || 0);
    const cashierCount = Number(db.prepare("SELECT COUNT(*) AS count FROM cashiers WHERE active = 1").get()?.count || 0);
    const salesCount = Number(db.prepare("SELECT COUNT(*) AS count FROM sales").get()?.count || 0);
    const creditSalesCount = Number(db.prepare("SELECT COUNT(*) AS count FROM sales WHERE payment_method = 'Fiado'").get()?.count || 0);
    const creditPaymentsCount = Number(db.prepare("SELECT COUNT(*) AS count FROM credit_payments").get()?.count || 0);
    const lowStockCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE active = 1 AND stock_initialized = 1 AND stock <= min_stock
    `).get()?.count || 0);
    const registerEventsCount = Number(db.prepare("SELECT COUNT(*) AS count FROM register_events").get()?.count || 0);
    const servicePaymentCount = Number(db.prepare("SELECT COUNT(*) AS count FROM service_subscription_payments").get()?.count || 0);
    const ownerCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'owner.%'").get()?.count || 0);
    const adminCount = Number(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'admin.%'").get()?.count || 0);

    assert.ok(productCount > 0);
    assert.ok(cashierCount >= 1);
    assert.equal(salesCount, 3);
    assert.equal(creditSalesCount, 1);
    assert.equal(creditPaymentsCount, 1);
    assert.ok(lowStockCount >= 1);
    assert.ok(registerEventsCount >= 2);
    assert.equal(servicePaymentCount, 1);
    assert.ok(ownerCount >= 2);
    assert.ok(adminCount >= 2);
  } finally {
    db.close();
  }
});

function writeReadinessEvidence(tempDir, overrides = {}) {
  const checkedAt = new Date().toISOString();
  const evidence = {
    client: "cliente-prueba",
    testsPassed: true,
    auditClean: true,
    supportConfigured: true,
    catalogLoadedWithoutCriticalDuplicates: true,
    adminSimpleModeConfigured: true,
    followUpPlan: true,
    offlinePreparedDevices: [
      { name: "Caja", branch: "carrizal", ready: true, checkedAt },
    ],
    backup: {
      verifyCommandExitCode: 0,
      status: "ok",
      verifiedAt: checkedAt,
      sqliteBytes: 4096,
      workbookBytes: 2048,
      sqliteArtifact: "clientes/cliente-prueba/daily/2026-08-15/cliente.sqlite",
      workbookArtifact: "clientes/cliente-prueba/daily/2026-08-15/cliente.xlsx",
      restorationTested: false,
      restorationTestedAt: "",
    },
    railway: {
      backupCronServiceCreated: false,
      serviceName: "",
      backupCronVerifiedAt: "",
    },
    printing: {
      promisedTicket: false,
      hardwareTestPassed: false,
      hardwareTestedAt: "",
      model: "",
      qaDocument: "docs/QA-IMPRESION-HARDWARE.md",
    },
    ...overrides,
  };
  const evidencePath = path.join(tempDir, "readiness.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  return evidencePath;
}

test("readiness gate approves pilot only with required evidence", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-ok-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const evidencePath = writeReadinessEvidence(tempDir);
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "pilot", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Readiness pilot: APROBADO/);
});

test("readiness gate blocks promised physical ticket without hardware evidence", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-print-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const evidencePath = writeReadinessEvidence(tempDir, {
    printing: {
      promisedTicket: true,
      hardwareTestPassed: false,
    },
  });
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "pilot", "--evidence", evidencePath]);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /falta prueba real de impresora/i);
});

test("readiness gate approves promised physical ticket with QA document", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-print-ok-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const evidencePath = writeReadinessEvidence(tempDir, {
    printing: {
      promisedTicket: true,
      hardwareTestPassed: true,
      hardwareTestedAt: new Date().toISOString(),
      model: "Impresora termica prueba",
      qaDocument: "docs/QA-IMPRESION-HARDWARE.md",
    },
  });
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "pilot", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("readiness gate blocks backup evidence without artifacts and bytes", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-backup-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const evidencePath = writeReadinessEvidence(tempDir, {
    backup: {
      verifyCommandExitCode: 0,
      status: "ok",
      verifiedAt: new Date().toISOString(),
      sqliteBytes: 0,
      workbookBytes: 0,
      sqliteArtifact: "",
      workbookArtifact: "",
    },
  });
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "pilot", "--evidence", evidencePath]);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /bytes SQLite/i);
  assert.match(`${result.stdout}\n${result.stderr}`, /artefacto Excel/i);
});

test("readiness gate can consume backup verify JSON report", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-report-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const reportPath = path.join(tempDir, "backup-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    lastRun: {
      status: "ok",
      sqliteBytes: 2048,
      workbookBytes: 1024,
      sqliteRemoteKey: "clientes/cliente-prueba/daily/2026-08-15/cliente.sqlite",
      workbookRemoteKey: "clientes/cliente-prueba/daily/2026-08-15/cliente.xlsx",
    },
  }, null, 2));

  const evidencePath = writeReadinessEvidence(tempDir, {
    backup: {
      verifyReportPath: "backup-report.json",
      verifyCommandExitCode: 1,
      status: "pending",
      verifiedAt: "",
      sqliteBytes: 0,
      workbookBytes: 0,
      sqliteArtifact: "",
      workbookArtifact: "",
    },
  });
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "pilot", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Readiness pilot: APROBADO/);
});

test("readiness gate blocks scale without Railway cron and restoration evidence", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-scale-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const evidencePath = writeReadinessEvidence(tempDir);
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "scale", "--evidence", evidencePath]);
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /servicio cron real/i);
  assert.match(`${result.stdout}\n${result.stderr}`, /restauracion probada/i);
});

test("readiness gate approves scale with cron and restoration documents", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-readiness-scale-ok-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const checkedAt = new Date().toISOString();

  const evidencePath = writeReadinessEvidence(tempDir, {
    backup: {
      verifyCommandExitCode: 0,
      status: "ok",
      verifiedAt: checkedAt,
      sqliteBytes: 4096,
      workbookBytes: 2048,
      sqliteArtifact: "clientes/cliente-prueba/daily/2026-08-15/cliente.sqlite",
      workbookArtifact: "clientes/cliente-prueba/daily/2026-08-15/cliente.xlsx",
      restorationTested: true,
      restorationTestedAt: checkedAt,
      restorationEvidenceDocument: "docs/PLAYBOOK-RESTAURACION.md",
    },
    railway: {
      backupCronServiceCreated: true,
      serviceName: "cliente-prueba-backup",
      backupCronVerifiedAt: checkedAt,
      evidenceDocument: "docs/RAILWAY-BACKUP-CRON.md",
    },
  });
  const result = runNodeScript(READINESS_SCRIPT_PATH, ["--stage", "scale", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Readiness scale: APROBADO/);
});

test("print QA ticket script writes reproducible html text and metadata", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-print-qa-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = runNodeScript(PRINT_QA_SCRIPT_PATH, [
    "--out",
    tempDir,
    "--ticket",
    "QA-TEST-001",
    "--store",
    "Merxalia QA",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const htmlPath = path.join(tempDir, "qa-test-001.html");
  const textPath = path.join(tempDir, "qa-test-001.txt");
  const metaPath = path.join(tempDir, "qa-test-001.json");
  assert.equal(fs.existsSync(htmlPath), true);
  assert.equal(fs.existsSync(textPath), true);
  assert.equal(fs.existsSync(metaPath), true);

  const html = fs.readFileSync(htmlPath, "utf8");
  const text = fs.readFileSync(textPath, "utf8");
  const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  assert.match(html, /@page \{ size: 80mm auto/);
  assert.match(html, /Merxalia QA/);
  assert.match(text, /TOTAL:/);
  assert.equal(metadata.ticketNumber, "QA-TEST-001");
  assert.equal(metadata.expectedTotal, 356.75);
});
