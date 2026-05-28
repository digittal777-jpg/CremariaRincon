const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const {
  BACKUP_ACCESS_KEY_ID,
  BACKUP_BUCKET_ENDPOINT,
  BACKUP_BUCKET_NAME,
  BACKUP_BUCKET_REGION,
  BACKUP_ENABLED,
  BACKUP_LOCAL_STAGING_KEEP,
  BACKUP_NOTIFY_TO,
  BACKUP_PREFIX,
  BACKUP_RETENTION_DAILY,
  BACKUP_RETENTION_MONTHLY,
  BACKUP_RETENTION_WEEKLY,
  BACKUP_SECRET_ACCESS_KEY,
  BACKUP_SYNC_REPORT_STALE_HOURS,
  DATA_DIR,
  RESEND_API_KEY,
  RESEND_API_URL,
} = require("../config");
const { createDatabaseBackup, getDb, nowIso } = require("../db");
const {
  createHttpError,
  getBusinessProfile,
  getStoreDateKey,
  normalizeBranch,
  normalizeText,
} = require("../utils/helpers");
const { exportWorkbookReport } = require("./export");
const { logAdminAction } = require("./audit");

const db = getDb();

const BACKUP_ROOT_DIR = path.join(DATA_DIR, "backups");
const BACKUP_STAGING_DIR = path.join(BACKUP_ROOT_DIR, "staging");
const SQL_MIME_TYPE = "application/octet-stream";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BACKUP_STATUS_VALUES = new Set(["running", "ok", "partial", "failed"]);
const BACKUP_SYNC_STATE_VALUES = new Set(["clean", "partial", "unknown"]);

function safeJsonParse(value, fallbackValue) {
  if (typeof value !== "string" || !value.trim()) {
    return fallbackValue;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallbackValue;
  }
}

function toNonNegativeInteger(value, fallbackValue = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }
  return Math.round(parsed);
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    || "retail-base-pos";
}

function getBackupStorageMode() {
  if (!BACKUP_BUCKET_ENDPOINT || !BACKUP_BUCKET_NAME) {
    return "unconfigured";
  }

  return BACKUP_BUCKET_ENDPOINT.startsWith("file://") ? "file" : "s3";
}

function buildStorageSummary() {
  return {
    configured: getBackupStorageMode() !== "unconfigured",
    mode: getBackupStorageMode(),
    bucket: BACKUP_BUCKET_NAME || "",
    endpoint: BACKUP_BUCKET_ENDPOINT || "",
    prefix: BACKUP_PREFIX || "",
  };
}

function buildRetentionSummary() {
  return {
    daily: BACKUP_RETENTION_DAILY,
    weekly: BACKUP_RETENTION_WEEKLY,
    monthly: BACKUP_RETENTION_MONTHLY,
  };
}

function getPreviousStoreDateKey(baseDate = new Date()) {
  const anchor = new Date(baseDate);
  anchor.setDate(anchor.getDate() - 1);
  return getStoreDateKey(anchor);
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function getWeekdayFromDateKey(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)).getUTCDay();
}

function isWeeklyPromotionDate(dateKey) {
  return getWeekdayFromDateKey(dateKey) === 1;
}

function isMonthlyPromotionDate(dateKey) {
  return parseDateKey(dateKey)?.day === 1;
}

function buildTierKey(slug, tier, backupDateKey, fileName) {
  const parts = [BACKUP_PREFIX, slug, tier, backupDateKey, fileName].filter(Boolean);
  return parts.join("/");
}

function createArtifactPlan(profile, backupDateKey) {
  const slug = sanitizeSlug(profile.slug);
  const sqliteFileName = `${slug}-${backupDateKey}.sqlite`;
  const workbookFileName = `${slug}-${backupDateKey}.xlsx`;
  return {
    slug,
    sqliteFileName,
    workbookFileName,
    tiers: {
      daily: {
        enabled: true,
        sqliteKey: buildTierKey(slug, "daily", backupDateKey, sqliteFileName),
        workbookKey: buildTierKey(slug, "daily", backupDateKey, workbookFileName),
      },
      weekly: {
        enabled: isWeeklyPromotionDate(backupDateKey),
        sqliteKey: buildTierKey(slug, "weekly", backupDateKey, sqliteFileName),
        workbookKey: buildTierKey(slug, "weekly", backupDateKey, workbookFileName),
      },
      monthly: {
        enabled: isMonthlyPromotionDate(backupDateKey),
        sqliteKey: buildTierKey(slug, "monthly", backupDateKey, sqliteFileName),
        workbookKey: buildTierKey(slug, "monthly", backupDateKey, workbookFileName),
      },
    },
  };
}

function ensureBackupRoot() {
  fs.mkdirSync(BACKUP_STAGING_DIR, { recursive: true });
}

function createBackupRunRecord({
  backupDateKey,
  storageMode,
  storageBucket,
  sqliteLocalPath = null,
  workbookLocalPath = null,
}) {
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO backup_runs (
      status,
      sync_state,
      backup_date_key,
      started_at,
      finished_at,
      sqlite_local_path,
      workbook_local_path,
      sqlite_bytes,
      workbook_bytes,
      sqlite_remote_key,
      workbook_remote_key,
      storage_mode,
      storage_bucket,
      error_message,
      summary_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "running",
    "unknown",
    backupDateKey,
    now,
    null,
    sqliteLocalPath,
    workbookLocalPath,
    0,
    0,
    null,
    null,
    storageMode,
    storageBucket || null,
    null,
    null,
    now,
    now,
  );

  return Number(result.lastInsertRowid);
}

function updateBackupRunRecord(runId, payload = {}) {
  const nextStatus = BACKUP_STATUS_VALUES.has(payload.status) ? payload.status : "failed";
  const nextSyncState = BACKUP_SYNC_STATE_VALUES.has(payload.syncState) ? payload.syncState : "unknown";
  const summaryJson = payload.summary === undefined ? null : JSON.stringify(payload.summary);
  const now = nowIso();

  db.prepare(`
    UPDATE backup_runs
    SET
      status = ?,
      sync_state = ?,
      finished_at = ?,
      sqlite_local_path = COALESCE(?, sqlite_local_path),
      workbook_local_path = COALESCE(?, workbook_local_path),
      sqlite_bytes = ?,
      workbook_bytes = ?,
      sqlite_remote_key = ?,
      workbook_remote_key = ?,
      storage_mode = ?,
      storage_bucket = ?,
      error_message = ?,
      summary_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    nextSyncState,
    payload.finishedAt || now,
    payload.sqliteLocalPath ?? null,
    payload.workbookLocalPath ?? null,
    toNonNegativeInteger(payload.sqliteBytes, 0),
    toNonNegativeInteger(payload.workbookBytes, 0),
    payload.sqliteRemoteKey || null,
    payload.workbookRemoteKey || null,
    payload.storageMode || getBackupStorageMode(),
    payload.storageBucket || BACKUP_BUCKET_NAME || null,
    payload.errorMessage ? String(payload.errorMessage).slice(0, 2000) : null,
    summaryJson,
    now,
    runId,
  );
}

function mapBackupRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    status: row.status,
    syncState: row.sync_state || "unknown",
    backupDateKey: row.backup_date_key,
    startedAt: row.started_at,
    finishedAt: row.finished_at || null,
    sqliteLocalPath: row.sqlite_local_path || null,
    workbookLocalPath: row.workbook_local_path || null,
    sqliteBytes: Number(row.sqlite_bytes || 0),
    workbookBytes: Number(row.workbook_bytes || 0),
    sqliteRemoteKey: row.sqlite_remote_key || null,
    workbookRemoteKey: row.workbook_remote_key || null,
    storageMode: row.storage_mode || "unconfigured",
    storageBucket: row.storage_bucket || null,
    errorMessage: row.error_message || "",
    summary: safeJsonParse(row.summary_json, null),
    createdAt: row.created_at || row.started_at,
    updatedAt: row.updated_at || row.finished_at || row.started_at,
  };
}

function getLatestBackupRun() {
  return mapBackupRunRow(
    db.prepare(`
      SELECT *
      FROM backup_runs
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `).get(),
  );
}

function listRecentBackupRuns(limit = 6) {
  return db.prepare(`
    SELECT *
    FROM backup_runs
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit || 6), 20))).map(mapBackupRunRow);
}

function recordClientSyncHealth(payload = {}, actor = {}) {
  const deviceId = normalizeText(payload.deviceId || "", 120);
  if (!deviceId) {
    throw createHttpError("El reporte de sincronizacion necesita un deviceId.", 400);
  }

  const branch = payload.branch
    ? normalizeBranch(payload.branch, { allowAll: false, fallback: null })
    : actor.branch
      ? normalizeBranch(actor.branch, { allowAll: false, fallback: null })
      : null;
  const pendingQueueCount = toNonNegativeInteger(payload.pendingQueueCount, 0);
  const blockedQueueCount = Math.min(pendingQueueCount, toNonNegativeInteger(payload.blockedQueueCount, 0));
  const registerEventsCount = toNonNegativeInteger(payload.registerEventsCount, 0);
  const reportedAt = nowIso();
  const actorType = normalizeText(actor.actorType || payload.actorType || "device", 40) || "device";
  const actorName = normalizeText(actor.actorName || payload.actorName || "", 120) || null;
  const online = payload.online === false ? 0 : 1;

  db.prepare(`
    INSERT INTO client_sync_reports (
      device_id,
      branch,
      actor_type,
      actor_name,
      pending_queue_count,
      blocked_queue_count,
      register_events_count,
      online,
      reported_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      branch = excluded.branch,
      actor_type = excluded.actor_type,
      actor_name = excluded.actor_name,
      pending_queue_count = excluded.pending_queue_count,
      blocked_queue_count = excluded.blocked_queue_count,
      register_events_count = excluded.register_events_count,
      online = excluded.online,
      reported_at = excluded.reported_at,
      updated_at = excluded.updated_at
  `).run(
    deviceId,
    branch,
    actorType,
    actorName,
    pendingQueueCount,
    blockedQueueCount,
    registerEventsCount,
    online,
    reportedAt,
    reportedAt,
  );

  return {
    deviceId,
    branch,
    actorType,
    actorName,
    pendingQueueCount,
    blockedQueueCount,
    registerEventsCount,
    online: Boolean(online),
    reportedAt,
  };
}

function listRecentClientSyncReports(staleHours = BACKUP_SYNC_REPORT_STALE_HOURS) {
  const thresholdDate = new Date(Date.now() - Math.max(1, staleHours) * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT *
    FROM client_sync_reports
    WHERE reported_at >= ?
    ORDER BY reported_at DESC, device_id ASC
  `).all(thresholdDate).map((row) => ({
    deviceId: row.device_id,
    branch: row.branch || "",
    actorType: row.actor_type || "device",
    actorName: row.actor_name || "",
    pendingQueueCount: Number(row.pending_queue_count || 0),
    blockedQueueCount: Number(row.blocked_queue_count || 0),
    registerEventsCount: Number(row.register_events_count || 0),
    online: Boolean(row.online),
    reportedAt: row.reported_at,
    updatedAt: row.updated_at,
  }));
}

function getClientSyncHealthSummary(staleHours = BACKUP_SYNC_REPORT_STALE_HOURS) {
  const reports = listRecentClientSyncReports(staleHours);
  const pendingReports = reports.filter((report) => report.pendingQueueCount > 0);
  const blockedReports = reports.filter((report) => report.blockedQueueCount > 0);
  const registerEventReports = reports.filter((report) => report.registerEventsCount > 0);

  return {
    staleAfterHours: Math.max(1, staleHours),
    reportCount: reports.length,
    latestReportedAt: reports[0]?.reportedAt || null,
    hasPending: pendingReports.length > 0 || blockedReports.length > 0 || registerEventReports.length > 0,
    pendingReportCount: pendingReports.length,
    blockedReportCount: blockedReports.length,
    registerEventReportCount: registerEventReports.length,
    reports,
  };
}

function getBackupStatusBundle() {
  return {
    enabled: BACKUP_ENABLED,
    storage: buildStorageSummary(),
    retention: buildRetentionSummary(),
    syncHealth: getClientSyncHealthSummary(),
    lastRun: getLatestBackupRun(),
    recentRuns: listRecentBackupRuns(),
  };
}

function ensureStorageConfigured() {
  const mode = getBackupStorageMode();
  if (mode === "unconfigured") {
    throw createHttpError("Falta configurar BACKUP_BUCKET_ENDPOINT o BACKUP_BUCKET_NAME para el respaldo nocturno.", 500);
  }

  if (mode === "s3" && (!BACKUP_ACCESS_KEY_ID || !BACKUP_SECRET_ACCESS_KEY)) {
    throw createHttpError("Faltan credenciales S3 para el respaldo nocturno.", 500);
  }

  return mode;
}

function walkLocalFiles(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      return walkLocalFiles(entryPath);
    }
    return [entryPath];
  });
}

function pathToStorageKey(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function removeEmptyDirectories(baseDir, currentDir) {
  let cursor = currentDir;
  while (cursor && cursor.startsWith(baseDir) && cursor !== baseDir) {
    try {
      if (fs.readdirSync(cursor).length > 0) {
        break;
      }
      fs.rmdirSync(cursor);
    } catch (_error) {
      break;
    }
    cursor = path.dirname(cursor);
  }
}

function createFileStorageAdapter() {
  let rootDir;
  try {
    rootDir = path.join(fileURLToPath(BACKUP_BUCKET_ENDPOINT), BACKUP_BUCKET_NAME);
  } catch (_error) {
    throw createHttpError("BACKUP_BUCKET_ENDPOINT no es un file:// valido para pruebas locales.", 500);
  }

  fs.mkdirSync(rootDir, { recursive: true });

  return {
    mode: "file",
    bucketName: BACKUP_BUCKET_NAME,
    async uploadFile(localPath, key) {
      const targetPath = path.join(rootDir, ...String(key).split("/"));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(localPath, targetPath);
      return {
        key,
        bytes: Number(fs.statSync(targetPath).size || 0),
      };
    },
    async listKeys(prefix = "") {
      const keys = walkLocalFiles(rootDir)
        .map((filePath) => pathToStorageKey(rootDir, filePath))
        .filter((key) => key.startsWith(prefix));
      return keys.sort();
    },
    async deleteKeys(keys = []) {
      keys.forEach((key) => {
        const targetPath = path.join(rootDir, ...String(key).split("/"));
        if (!fs.existsSync(targetPath)) {
          return;
        }
        fs.rmSync(targetPath, { force: true });
        removeEmptyDirectories(rootDir, path.dirname(targetPath));
      });
    },
  };
}

function createS3StorageAdapter() {
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
  const client = new S3Client({
    region: BACKUP_BUCKET_REGION,
    endpoint: BACKUP_BUCKET_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: BACKUP_ACCESS_KEY_ID,
      secretAccessKey: BACKUP_SECRET_ACCESS_KEY,
    },
  });

  return {
    mode: "s3",
    bucketName: BACKUP_BUCKET_NAME,
    async uploadFile(localPath, key, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: BACKUP_BUCKET_NAME,
        Key: key,
        Body: fs.createReadStream(localPath),
        ContentType: contentType,
      }));

      return {
        key,
        bytes: Number(fs.statSync(localPath).size || 0),
      };
    },
    async listKeys(prefix = "") {
      const keys = [];
      let continuationToken;
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: BACKUP_BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));

        (response.Contents || []).forEach((item) => {
          if (item?.Key) {
            keys.push(item.Key);
          }
        });

        continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
      } while (continuationToken);

      return keys.sort();
    },
    async deleteKeys(keys = []) {
      for (let index = 0; index < keys.length; index += 1000) {
        const chunk = keys.slice(index, index + 1000);
        if (chunk.length === 0) {
          continue;
        }
        await client.send(new DeleteObjectsCommand({
          Bucket: BACKUP_BUCKET_NAME,
          Delete: {
            Objects: chunk.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }));
      }
    },
  };
}

function createStorageAdapter() {
  const mode = ensureStorageConfigured();
  return mode === "file" ? createFileStorageAdapter() : createS3StorageAdapter();
}

function groupKeysByDate(keys = [], prefix = "") {
  return keys.reduce((accumulator, key) => {
    const relative = prefix ? key.slice(prefix.length) : key;
    const [dateKey] = relative.split("/");
    if (!dateKey) {
      return accumulator;
    }
    if (!accumulator[dateKey]) {
      accumulator[dateKey] = [];
    }
    accumulator[dateKey].push(key);
    return accumulator;
  }, {});
}

async function pruneTierRetention(storage, artifactSlug, tier, keepCount) {
  const prefix = [BACKUP_PREFIX, artifactSlug, tier].filter(Boolean).join("/") + "/";
  const keys = await storage.listKeys(prefix);
  const grouped = groupKeysByDate(keys, prefix);
  const orderedDateKeys = Object.keys(grouped).sort().reverse();
  const deletedDateKeys = orderedDateKeys.slice(keepCount);
  const keysToDelete = deletedDateKeys.flatMap((dateKey) => grouped[dateKey] || []);

  if (keysToDelete.length > 0) {
    await storage.deleteKeys(keysToDelete);
  }

  return {
    tier,
    keptDateKeys: orderedDateKeys.slice(0, keepCount),
    deletedDateKeys,
    deletedKeyCount: keysToDelete.length,
  };
}

async function pruneStorageRetention(storage, artifactSlug) {
  return {
    daily: await pruneTierRetention(storage, artifactSlug, "daily", BACKUP_RETENTION_DAILY),
    weekly: await pruneTierRetention(storage, artifactSlug, "weekly", BACKUP_RETENTION_WEEKLY),
    monthly: await pruneTierRetention(storage, artifactSlug, "monthly", BACKUP_RETENTION_MONTHLY),
  };
}

function cleanupOldLocalRuns() {
  if (!fs.existsSync(BACKUP_STAGING_DIR)) {
    return;
  }

  const entries = fs.readdirSync(BACKUP_STAGING_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(BACKUP_STAGING_DIR, entry.name),
      modifiedAt: Number(fs.statSync(path.join(BACKUP_STAGING_DIR, entry.name)).mtimeMs || 0),
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  entries.slice(BACKUP_LOCAL_STAGING_KEEP).forEach((entry) => {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  });
}

function buildNotificationText(profile, run) {
  const statusLabel = run.status === "ok"
    ? "OK"
    : run.status === "partial"
      ? "PARCIAL"
      : run.status === "failed"
        ? "FALLIDO"
        : "EN PROCESO";
  const lines = [
    `Respaldo ${statusLabel} para ${profile.businessName}.`,
    `Fecha operativa: ${run.backupDateKey}.`,
    `Estado sync: ${run.syncState}.`,
  ];

  if (run.sqliteRemoteKey) {
    lines.push(`SQLite: ${run.sqliteRemoteKey}`);
  }
  if (run.workbookRemoteKey) {
    lines.push(`Excel: ${run.workbookRemoteKey}`);
  }
  if (run.errorMessage) {
    lines.push(`Error: ${run.errorMessage}`);
  }

  return lines.join("\n");
}

async function sendBackupNotification(profile, run) {
  if (!RESEND_API_KEY || BACKUP_NOTIFY_TO.length === 0) {
    return { delivered: false, skipped: true };
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Axentra POS <onboarding@resend.dev>",
      to: BACKUP_NOTIFY_TO,
      subject: `[${run.status.toUpperCase()}] Backup ${profile.shortName || profile.businessName} ${run.backupDateKey}`,
      text: buildNotificationText(profile, run),
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`No pude notificar el backup por Resend (${response.status}): ${bodyText || "sin detalle"}`);
  }

  return {
    delivered: true,
    skipped: false,
  };
}

async function uploadTierArtifacts(storage, tierConfig, sqlitePath, workbookPath) {
  const uploads = [];

  uploads.push(await storage.uploadFile(sqlitePath, tierConfig.sqliteKey, SQL_MIME_TYPE));
  uploads.push(await storage.uploadFile(workbookPath, tierConfig.workbookKey, XLSX_MIME_TYPE));

  return uploads;
}

async function runNightlyBackup(options = {}) {
  if (!BACKUP_ENABLED && options.allowWhenDisabled !== true) {
    throw createHttpError("BACKUP_ENABLED=false. El job nocturno no esta habilitado en este despliegue.", 409);
  }

  ensureBackupRoot();

  const storage = options.storageAdapter || createStorageAdapter();
  const profile = getBusinessProfile();
  const backupDateKey = String(options.baseDateKey || getPreviousStoreDateKey()).trim();
  const artifactPlan = createArtifactPlan(profile, backupDateKey);
  const runFolder = path.join(BACKUP_STAGING_DIR, `${backupDateKey}-${Date.now()}-${process.pid}`);
  fs.mkdirSync(runFolder, { recursive: true });

  const sqlitePath = path.join(runFolder, artifactPlan.sqliteFileName);
  const workbookPath = path.join(runFolder, artifactPlan.workbookFileName);
  const runId = createBackupRunRecord({
    backupDateKey,
    storageMode: storage.mode,
    storageBucket: storage.bucketName,
    sqliteLocalPath: sqlitePath,
    workbookLocalPath: workbookPath,
  });

  try {
    await createDatabaseBackup(sqlitePath);
    const workbookResult = await exportWorkbookReport({
      branch: "all",
      scope: "store-day",
      baseDate: backupDateKey,
    });
    await workbookResult.workbook.xlsx.writeFile(workbookPath);

    const sqliteBytes = Number(fs.statSync(sqlitePath).size || 0);
    const workbookBytes = Number(fs.statSync(workbookPath).size || 0);

    await uploadTierArtifacts(storage, artifactPlan.tiers.daily, sqlitePath, workbookPath);
    if (artifactPlan.tiers.weekly.enabled) {
      await uploadTierArtifacts(storage, artifactPlan.tiers.weekly, sqlitePath, workbookPath);
    }
    if (artifactPlan.tiers.monthly.enabled) {
      await uploadTierArtifacts(storage, artifactPlan.tiers.monthly, sqlitePath, workbookPath);
    }

    const retention = options.skipRetention === true
      ? null
      : await pruneStorageRetention(storage, artifactPlan.slug);
    const syncHealth = getClientSyncHealthSummary();
    const syncState = syncHealth.hasPending ? "partial" : "clean";
    const status = syncHealth.hasPending ? "partial" : "ok";
    const summary = {
      storage: buildStorageSummary(),
      retention,
      syncHealth,
      uploadedTiers: Object.entries(artifactPlan.tiers)
        .filter(([, tierConfig]) => tierConfig.enabled)
        .map(([tier, tierConfig]) => ({
          tier,
          sqliteKey: tierConfig.sqliteKey,
          workbookKey: tierConfig.workbookKey,
        })),
    };

    updateBackupRunRecord(runId, {
      status,
      syncState,
      sqliteBytes,
      workbookBytes,
      sqliteRemoteKey: artifactPlan.tiers.daily.sqliteKey,
      workbookRemoteKey: artifactPlan.tiers.daily.workbookKey,
      sqliteLocalPath: sqlitePath,
      workbookLocalPath: workbookPath,
      storageMode: storage.mode,
      storageBucket: storage.bucketName,
      summary,
    });

    const completedRun = getLatestBackupRun();
    let notificationResult = null;
    try {
      notificationResult = await sendBackupNotification(profile, completedRun);
    } catch (error) {
      notificationResult = {
        delivered: false,
        skipped: false,
        errorMessage: error.message,
      };
    }

    if (notificationResult && notificationResult.skipped === false && notificationResult.delivered === false) {
      updateBackupRunRecord(runId, {
        status: completedRun.status,
        syncState: completedRun.syncState,
        sqliteBytes,
        workbookBytes,
        sqliteRemoteKey: artifactPlan.tiers.daily.sqliteKey,
        workbookRemoteKey: artifactPlan.tiers.daily.workbookKey,
        sqliteLocalPath: sqlitePath,
        workbookLocalPath: workbookPath,
        storageMode: storage.mode,
        storageBucket: storage.bucketName,
        summary: {
          ...summary,
          notification: notificationResult,
        },
      });
    }

    logAdminAction({
      actorType: "system",
      actorName: "backup:nightly",
      action: "backup_run",
      entityType: "backup_run",
      entityId: runId,
      payload: {
        status,
        syncState,
        backupDateKey,
        sqliteBytes,
        workbookBytes,
        sqliteRemoteKey: artifactPlan.tiers.daily.sqliteKey,
        workbookRemoteKey: artifactPlan.tiers.daily.workbookKey,
      },
    });

    cleanupOldLocalRuns();
    return getLatestBackupRun();
  } catch (error) {
    updateBackupRunRecord(runId, {
      status: "failed",
      syncState: "unknown",
      sqliteLocalPath: sqlitePath,
      workbookLocalPath: workbookPath,
      storageMode: storage.mode,
      storageBucket: storage.bucketName,
      errorMessage: error.message,
      summary: {
        storage: buildStorageSummary(),
      },
    });

    logAdminAction({
      actorType: "system",
      actorName: "backup:nightly",
      action: "backup_run_failed",
      entityType: "backup_run",
      entityId: runId,
      payload: {
        backupDateKey,
        message: error.message,
      },
    });

    try {
      await sendBackupNotification(profile, getLatestBackupRun());
    } catch (_notificationError) {
      // La notificacion no debe tapar el error principal del backup.
    }

    throw error;
  }
}

module.exports = {
  createStorageAdapter,
  getBackupStatusBundle,
  getClientSyncHealthSummary,
  getLatestBackupRun,
  listRecentBackupRuns,
  recordClientSyncHealth,
  runNightlyBackup,
};
