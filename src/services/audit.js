const { getDb, nowIso } = require("../db");
const { ALL_BRANCHES, normalizeBranch } = require("../utils/helpers");

const db = getDb();

function logAdminAction({
  actorType = "admin",
  actorName = null,
  action,
  entityType,
  entityId = null,
  branch = null,
  payload = null,
}) {
  if (!action || !entityType) {
    return null;
  }

  const safeBranch = branch ? normalizeBranch(branch, { allowAll: true, fallback: null }) : null;
  const payloadJson =
    payload === undefined || payload === null ? null : JSON.stringify(payload).slice(0, 12000);

  const result = db.prepare(`
    INSERT INTO admin_audit_logs (
      actor_type,
      actor_name,
      action,
      entity_type,
      entity_id,
      branch,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(actorType || "admin"),
    actorName ? String(actorName).slice(0, 120) : null,
    String(action).slice(0, 120),
    String(entityType).slice(0, 120),
    entityId == null ? null : String(entityId).slice(0, 120),
    safeBranch === ALL_BRANCHES ? null : safeBranch,
    payloadJson,
    nowIso(),
  );

  return Number(result.lastInsertRowid);
}

function listRecentAuditLogs(limit = 120, branch = ALL_BRANCHES) {
  const normalizedBranch = normalizeBranch(branch, { allowAll: true });
  const rows = normalizedBranch === ALL_BRANCHES
    ? db.prepare(`
      SELECT
        id,
        actor_type,
        actor_name,
        action,
        entity_type,
        entity_id,
        branch,
        payload_json,
        created_at
      FROM admin_audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit)
    : db.prepare(`
      SELECT
        id,
        actor_type,
        actor_name,
        action,
        entity_type,
        entity_id,
        branch,
        payload_json,
        created_at
      FROM admin_audit_logs
      WHERE branch = ? OR branch IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizedBranch, limit);

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorName: row.actor_name || "",
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id || "",
    branch: row.branch || "",
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    createdAt: row.created_at,
  }));
}

module.exports = {
  listRecentAuditLogs,
  logAdminAction,
};

