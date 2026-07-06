const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKUP_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "backup-nightly.js");

function runNodeProcess(args = [], options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 40000,
  });
}

function runBackupScript(env) {
  return runNodeProcess([BACKUP_SCRIPT_PATH], { env });
}

function runInlineScript(source, env) {
  return runNodeProcess(["-e", source], { env });
}

function buildRuntimeEnv(tempDir, values = {}) {
  const runtimePath = path.join(tempDir, "pos-runtime-config.json");
  fs.writeFileSync(
    runtimePath,
    JSON.stringify({
      env: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value)]),
      ),
      updatedAt: new Date(0).toISOString(),
    }, null, 2),
  );
  return {
    ...process.env,
    ...values,
    POS_CONFIG_PATH: runtimePath,
  };
}

function openLatestBackupRow(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`
      SELECT status, sync_state, backup_date_key, sqlite_remote_key, workbook_remote_key, sqlite_bytes, workbook_bytes, error_message
      FROM backup_runs
      ORDER BY id DESC
      LIMIT 1
    `).get();
  } finally {
    db.close();
  }
}

function openLatestBackupRunWithSummary(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT status, sync_state, backup_date_key, sqlite_remote_key, workbook_remote_key, sqlite_bytes, workbook_bytes, error_message, summary_json
      FROM backup_runs
      ORDER BY id DESC
      LIMIT 1
    `).get();
    return {
      ...row,
      summary: row?.summary_json ? JSON.parse(row.summary_json) : null,
    };
  } finally {
    db.close();
  }
}

test("backup-nightly writes sqlite and workbook to file-backed storage and records ok", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-ok-"));
  const dbPath = path.join(tempDir, "backup.sqlite");
  const bucketRoot = path.join(tempDir, "bucket");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: pathToFileURL(bucketRoot).href,
    BACKUP_BUCKET_NAME: "local",
    BACKUP_PREFIX: "clientes/prueba-ok",
  });

  const result = runBackupScript(env);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const latest = openLatestBackupRow(dbPath);
  assert.equal(latest.status, "ok");
  assert.equal(latest.sync_state, "clean");
  assert.ok(latest.sqlite_bytes > 0);
  assert.ok(latest.workbook_bytes > 0);
  assert.match(latest.sqlite_remote_key, new RegExp(`${latest.backup_date_key}`));
  assert.match(latest.workbook_remote_key, new RegExp(`${latest.backup_date_key}`));

  const sqliteTarget = path.join(bucketRoot, "local", ...String(latest.sqlite_remote_key).split("/"));
  const workbookTarget = path.join(bucketRoot, "local", ...String(latest.workbook_remote_key).split("/"));
  assert.equal(fs.existsSync(sqliteTarget), true);
  assert.equal(fs.existsSync(workbookTarget), true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookTarget);
  assert.ok(workbook.worksheets.length > 0);
});

test("backup-nightly records partial when a device reports pending offline work", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-partial-"));
  const dbPath = path.join(tempDir, "backup.sqlite");
  const bucketRoot = path.join(tempDir, "bucket");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: pathToFileURL(bucketRoot).href,
    BACKUP_BUCKET_NAME: "local",
    BACKUP_PREFIX: "clientes/prueba-partial",
  });

  const seedReport = runInlineScript(`
    const services = require("./src/services");
    services.recordClientSyncHealth(
      {
        deviceId: "tablet-carrizal",
        branch: "carrizal",
        pendingQueueCount: 2,
        blockedQueueCount: 1,
        registerEventsCount: 1,
        online: true,
      },
      {
        actorType: "cashier",
        actorName: "Caja 1",
        branch: "carrizal",
      },
    );
  `, env);
  assert.equal(seedReport.status, 0, seedReport.stderr || seedReport.stdout);

  const result = runBackupScript(env);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const latest = openLatestBackupRow(dbPath);
  assert.equal(latest.status, "partial");
  assert.equal(latest.sync_state, "partial");
  assert.ok(latest.sqlite_bytes > 0);
});

test("backup-nightly records failed when external storage upload breaks", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-failed-"));
  const dbPath = path.join(tempDir, "backup.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: "http://127.0.0.1:1",
    BACKUP_BUCKET_NAME: "remote",
    BACKUP_ACCESS_KEY_ID: "test-key",
    BACKUP_SECRET_ACCESS_KEY: "test-secret",
    AWS_MAX_ATTEMPTS: "1",
  });

  const result = runBackupScript(env);
  assert.notEqual(result.status, 0);

  const latest = openLatestBackupRow(dbPath);
  assert.equal(latest.status, "failed");
  assert.equal(latest.sync_state, "unknown");
  assert.ok(String(latest.error_message || "").length > 0);
});

test("runNightlyBackup honors BACKUP_ENABLED runtime changes without restart", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-runtime-off-"));
  const dbPath = path.join(tempDir, "backup.sqlite");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
  });

  const result = runInlineScript(`
    const fs = require("node:fs");
    const services = require("./src/services");

    fs.writeFileSync(process.env.POS_CONFIG_PATH, JSON.stringify({
      env: {
        POS_DB_PATH: process.env.POS_DB_PATH,
        BACKUP_ENABLED: "false"
      }
    }), "utf8");

    (async () => {
      let message = "";
      let statusCode = 0;
      try {
        await services.runNightlyBackup();
      } catch (error) {
        message = error.message || "";
        statusCode = error.statusCode || 0;
      }
      console.log(JSON.stringify({ message, statusCode }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout.trim());
  assert.match(payload.message, /BACKUP_ENABLED=false/);
  assert.equal(payload.statusCode, 409);
});

test("runNightlyBackup cleans remote artifacts when an upload fails mid-flight", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-cleanup-"));
  const dbPath = path.join(tempDir, "backup.sqlite");
  const bucketRoot = path.join(tempDir, "bucket");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
  });

  const result = runInlineScript(`
    const fs = require("node:fs");
    const path = require("node:path");
    const services = require("./src/services");

    const bucketRoot = ${JSON.stringify(bucketRoot)};
    let uploadAttempt = 0;

    function walk(targetDir) {
      if (!fs.existsSync(targetDir)) {
        return [];
      }
      return fs.readdirSync(targetDir, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(targetDir, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
      });
    }

    const storageAdapter = {
      mode: "file",
      bucketName: "local",
      async uploadFile(localPath, key) {
        uploadAttempt += 1;
        if (uploadAttempt === 2) {
          throw new Error("Falla simulada subiendo workbook.");
        }
        const targetPath = path.join(bucketRoot, ...String(key).split("/"));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(localPath, targetPath);
        return {
          key,
          bytes: Number(fs.statSync(targetPath).size || 0),
        };
      },
      async listKeys(prefix = "") {
        return walk(bucketRoot)
          .map((filePath) => path.relative(bucketRoot, filePath).split(path.sep).join("/"))
          .filter((key) => key.startsWith(prefix))
          .sort();
      },
      async deleteKeys(keys = []) {
        keys.forEach((key) => {
          const targetPath = path.join(bucketRoot, ...String(key).split("/"));
          if (fs.existsSync(targetPath)) {
            fs.rmSync(targetPath, { force: true });
          }
        });
      },
    };

    (async () => {
      let errorMessage = "";
      try {
        await services.runNightlyBackup({
          allowWhenDisabled: true,
          storageAdapter,
        });
      } catch (error) {
        errorMessage = error.message || "";
      }

      console.log(JSON.stringify({
        errorMessage,
        uploadedFiles: walk(bucketRoot).map((filePath) => path.relative(bucketRoot, filePath).split(path.sep).join("/")).sort(),
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout.trim());
  const latest = openLatestBackupRunWithSummary(dbPath);
  assert.match(payload.errorMessage, /Falla simulada subiendo workbook/i);
  assert.equal(latest.status, "failed");
  assert.equal(Array.isArray(payload.uploadedFiles), true);
  assert.equal(payload.uploadedFiles.length, 0);
  assert.equal(latest.summary.artifactCleanup.ok, true);
  assert.equal(latest.summary.artifactCleanup.deletedKeyCount, 1);
});

test("runNightlyBackup keeps successful backups as ok when retention pruning fails", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-retention-warning-"));
  const dbPath = path.join(tempDir, "backup.sqlite");
  const bucketRoot = path.join(tempDir, "bucket");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = buildRuntimeEnv(tempDir, {
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_RETENTION_DAILY: "1",
  });

  const result = runInlineScript(`
    const fs = require("node:fs");
    const path = require("node:path");
    const services = require("./src/services");

    const bucketRoot = ${JSON.stringify(bucketRoot)};

    function walk(targetDir) {
      if (!fs.existsSync(targetDir)) {
        return [];
      }
      return fs.readdirSync(targetDir, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(targetDir, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
      });
    }

    const storageAdapter = {
      mode: "file",
      bucketName: "local",
      async uploadFile(localPath, key) {
        const targetPath = path.join(bucketRoot, ...String(key).split("/"));
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(localPath, targetPath);
        return {
          key,
          bytes: Number(fs.statSync(targetPath).size || 0),
        };
      },
      async listKeys(prefix = "") {
        const actualKeys = walk(bucketRoot)
          .map((filePath) => path.relative(bucketRoot, filePath).split(path.sep).join("/"))
          .filter((key) => key.startsWith(prefix));
        return [...actualKeys, prefix + "2000-01-01/legacy.sqlite", prefix + "2000-01-01/legacy.xlsx"].sort();
      },
      async deleteKeys() {
        throw new Error("No pude borrar el respaldo viejo.");
      },
    };

    (async () => {
      const run = await services.runNightlyBackup({
        allowWhenDisabled: true,
        storageAdapter,
      });

      console.log(JSON.stringify({
        status: run.status,
        uploadedFiles: walk(bucketRoot).map((filePath) => path.relative(bucketRoot, filePath).split(path.sep).join("/")).sort(),
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const payload = JSON.parse(result.stdout.trim());
  const latest = openLatestBackupRunWithSummary(dbPath);
  assert.equal(payload.status, "ok");
  assert.equal(latest.status, "ok");
  assert.ok(Array.isArray(payload.uploadedFiles));
  assert.ok(payload.uploadedFiles.length >= 2);
  assert.ok(Array.isArray(latest.summary.warnings));
  assert.ok(latest.summary.warnings.some((warning) => /retention:/i.test(warning)));
});
