const { getDb, nowIso } = require("../db");
const { normalizeBranch, normalizeText } = require("../utils/helpers");

const db = getDb();

function sanitizeText(value, maxLength = 500) {
  return normalizeText(String(value || ""), maxLength);
}

function sanitizeContext(context) {
  if (!context || typeof context !== "object") {
    return null;
  }

  const safe = {};
  Object.entries(context).forEach(([key, value]) => {
    const safeKey = sanitizeText(key, 64);
    if (!safeKey) {
      return;
    }
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[safeKey] = sanitizeText(value, 240);
    }
  });

  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : null;
}

function mapErrorReport(row) {
  let context = null;
  try {
    context = row.context_json ? JSON.parse(row.context_json) : null;
  } catch (_error) {
    context = null;
  }

  return {
    id: row.id,
    source: row.source,
    level: row.level,
    message: row.message,
    stack: row.stack || "",
    url: row.url || "",
    method: row.method || "",
    statusCode: row.status_code == null ? null : Number(row.status_code),
    role: row.role || "guest",
    branch: row.branch || "",
    userAgent: row.user_agent || "",
    context,
    createdAt: row.created_at,
  };
}

function recordAppErrorReport(payload = {}, actorContext = {}) {
  const message = sanitizeText(payload.message || payload.error || "Error sin mensaje", 600);
  if (!message) {
    return null;
  }

  const source = sanitizeText(payload.source || actorContext.source || "frontend", 32).toLowerCase() || "frontend";
  const level = sanitizeText(payload.level || "error", 24).toLowerCase() || "error";
  const method = sanitizeText(payload.method || actorContext.method || "", 12).toUpperCase();
  const statusCode = payload.statusCode ?? payload.status_code ?? actorContext.statusCode ?? null;
  const branch = payload.branch || actorContext.branch
    ? normalizeBranch(payload.branch || actorContext.branch, { allowAll: true })
    : null;
  const result = db.prepare(`
    INSERT INTO app_error_reports (
      source,
      level,
      message,
      stack,
      url,
      method,
      status_code,
      role,
      branch,
      user_agent,
      context_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source,
    level,
    message,
    sanitizeText(payload.stack || "", 2000) || null,
    sanitizeText(payload.url || actorContext.url || "", 500) || null,
    method || null,
    Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    sanitizeText(payload.role || actorContext.role || "guest", 32) || "guest",
    branch,
    sanitizeText(payload.userAgent || actorContext.userAgent || "", 500) || null,
    sanitizeContext(payload.context || actorContext.context),
    nowIso(),
  );

  return mapErrorReport(db.prepare("SELECT * FROM app_error_reports WHERE id = ?").get(result.lastInsertRowid));
}

function listAppErrorReports(options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const source = sanitizeText(options.source || "", 32).toLowerCase();
  const rows = source
    ? db.prepare(`
      SELECT *
      FROM app_error_reports
      WHERE source = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(source, limit)
    : db.prepare(`
      SELECT *
      FROM app_error_reports
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit);

  return rows.map(mapErrorReport);
}

module.exports = {
  listAppErrorReports,
  recordAppErrorReport,
};
