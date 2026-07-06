const crypto = require("node:crypto");

const {
  ADMIN_LOGIN_LOCK_MS,
  ADMIN_LOGIN_WINDOW_MS,
  ADMIN_MAX_FAILED_LOGINS,
} = require("../config");
const { getDb, nowIso } = require("../db");
const { createHttpError, normalizeText } = require("../utils/helpers");

const db = getDb();

const CASHIER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const failedLoginAttempts = new Map();

function getCashierTokenFromRequest(request) {
  return normalizeText(request.headers["x-cashier-token"] || "", 160);
}

function getCashierClientAddress(request) {
  return String(
    request?.ip
    || request?.socket?.remoteAddress
    || request?.connection?.remoteAddress
    || "unknown",
  ).trim() || "unknown";
}

function deleteExpiredCashierSessions() {
  db.prepare(`
    DELETE FROM cashier_sessions
    WHERE expires_at <= ?
  `).run(nowIso());
}

function getCashierSessionByToken(token) {
  const safeToken = normalizeText(token || "", 160);
  if (!safeToken) {
    return null;
  }

  const row = db.prepare(`
    SELECT
      s.token,
      s.cashier_id,
      s.created_at,
      s.expires_at,
      s.last_seen_at,
      c.name,
      c.branch
    FROM cashier_sessions s
    JOIN cashiers c ON c.id = s.cashier_id
    WHERE s.token = ? AND c.active = 1
  `).get(safeToken);

  if (!row) {
    return null;
  }

  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    db.prepare("DELETE FROM cashier_sessions WHERE token = ?").run(safeToken);
    return null;
  }

  return {
    token: row.token,
    cashierId: row.cashier_id,
    name: row.name,
    branch: row.branch,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

function touchCashierSession(token) {
  const safeToken = normalizeText(token || "", 160);
  if (!safeToken) {
    return null;
  }

  const nextSeenAt = nowIso();
  const nextExpiresAt = new Date(Date.now() + CASHIER_SESSION_TTL_MS).toISOString();
  db.prepare(`
    UPDATE cashier_sessions
    SET last_seen_at = ?, expires_at = ?
    WHERE token = ?
  `).run(nextSeenAt, nextExpiresAt, safeToken);

  return {
    lastSeenAt: nextSeenAt,
    expiresAt: nextExpiresAt,
  };
}

function getCashierSessionFromRequest(request) {
  deleteExpiredCashierSessions();

  const token = getCashierTokenFromRequest(request);
  const session = getCashierSessionByToken(token);
  if (!session) {
    request.cashierSession = null;
    return null;
  }

  const refreshed = touchCashierSession(token);
  const resolvedSession = {
    ...session,
    expiresAt: refreshed?.expiresAt || session.expiresAt,
    lastSeenAt: refreshed?.lastSeenAt || session.lastSeenAt,
  };
  request.cashierSession = resolvedSession;
  return resolvedSession;
}

function isCashierAuthenticated(request) {
  return Boolean(getCashierSessionFromRequest(request));
}

function requireCashierAuth(request, response, next) {
  if (!isCashierAuthenticated(request)) {
    response.status(401).json({
      message: "Inicia sesion de cajero para continuar.",
    });
    return;
  }

  next();
}

function getCashierClientKey(request, name, branch) {
  return [
    getCashierClientAddress(request),
    normalizeText(name || "", 60).toLowerCase(),
    normalizeText(branch || "", 24).toLowerCase(),
  ].join("::");
}

function getFailedCashierLoginRecord(request, name, branch) {
  const key = getCashierClientKey(request, name, branch);
  const now = Date.now();
  const current = failedLoginAttempts.get(key);
  if (!current) {
    return { key, timestamps: [], lockedUntil: 0 };
  }

  const nextRecord = {
    key,
    timestamps: (Array.isArray(current.timestamps) ? current.timestamps : []).filter(
      (timestamp) => now - Number(timestamp || 0) <= ADMIN_LOGIN_WINDOW_MS,
    ),
    lockedUntil: Number(current.lockedUntil || 0),
  };

  if (nextRecord.timestamps.length === 0 && nextRecord.lockedUntil <= now) {
    failedLoginAttempts.delete(key);
    return { key, timestamps: [], lockedUntil: 0 };
  }

  failedLoginAttempts.set(key, nextRecord);
  return nextRecord;
}

function assertCashierLoginAllowed(request, name, branch) {
  const record = getFailedCashierLoginRecord(request, name, branch);
  if (record.lockedUntil > Date.now()) {
    const retryInMinutes = Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / 60000));
    throw createHttpError(
      `Demasiados intentos de cajero. Espera ${retryInMinutes} minuto(s) antes de volver a intentar.`,
      429,
    );
  }
}

function recordFailedCashierLogin(request, name, branch) {
  const now = Date.now();
  const record = getFailedCashierLoginRecord(request, name, branch);
  record.timestamps.push(now);
  if (record.timestamps.length >= ADMIN_MAX_FAILED_LOGINS) {
    record.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;
    record.timestamps = [];
  }
  failedLoginAttempts.set(record.key, record);
}

function clearFailedCashierLogin(request, name, branch) {
  failedLoginAttempts.delete(getCashierClientKey(request, name, branch));
}

function createCashierSession(cashier) {
  const token = crypto.randomBytes(24).toString("hex");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + CASHIER_SESSION_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO cashier_sessions (
      token,
      cashier_id,
      created_at,
      expires_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    token,
    cashier.id,
    createdAt,
    expiresAt,
    createdAt,
  );

  return {
    token,
    cashier: {
      id: cashier.id,
      name: cashier.name,
      branch: cashier.branch,
    },
    createdAt,
    expiresAt,
  };
}

function destroyCashierSession(request) {
  const token = getCashierTokenFromRequest(request);
  if (!token) {
    request.cashierSession = null;
    return;
  }

  db.prepare("DELETE FROM cashier_sessions WHERE token = ?").run(token);
  request.cashierSession = null;
}

module.exports = {
  assertCashierLoginAllowed,
  clearFailedCashierLogin,
  createCashierSession,
  destroyCashierSession,
  getCashierClientAddress,
  getCashierSessionFromRequest,
  getCashierTokenFromRequest,
  isCashierAuthenticated,
  recordFailedCashierLogin,
  requireCashierAuth,
};
