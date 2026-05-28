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

test("backup-nightly writes sqlite and workbook to file-backed storage and records ok", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-ok-"));
  const dbPath = path.join(tempDir, "backup.sqlite");
  const bucketRoot = path.join(tempDir, "bucket");

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: pathToFileURL(bucketRoot).href,
    BACKUP_BUCKET_NAME: "local",
    BACKUP_PREFIX: "clientes/prueba-ok",
  };

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

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: pathToFileURL(bucketRoot).href,
    BACKUP_BUCKET_NAME: "local",
    BACKUP_PREFIX: "clientes/prueba-partial",
  };

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

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    BACKUP_ENABLED: "true",
    BACKUP_BUCKET_ENDPOINT: "http://127.0.0.1:1",
    BACKUP_BUCKET_NAME: "remote",
    BACKUP_ACCESS_KEY_ID: "test-key",
    BACKUP_SECRET_ACCESS_KEY: "test-secret",
    AWS_MAX_ATTEMPTS: "1",
  };

  const result = runBackupScript(env);
  assert.notEqual(result.status, 0);

  const latest = openLatestBackupRow(dbPath);
  assert.equal(latest.status, "failed");
  assert.equal(latest.sync_state, "unknown");
  assert.ok(String(latest.error_message || "").length > 0);
});
