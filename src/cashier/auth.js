const crypto = require("node:crypto");

const { getDb, nowIso } = require("../db");
const { normalizeText } = require("../utils/helpers");

const db = getDb();

const CASHIER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function getCashierTokenFromRequest(request) {
  return normalizeText(request.headers["x-cashier-token"] || "", 160);
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

  const now = nowIso();
  if (row.expires_at <= now) {
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
    return;
  }

  db.prepare("DELETE FROM cashier_sessions WHERE token = ?").run(token);
}

module.exports = {
  createCashierSession,
  destroyCashierSession,
  getCashierSessionFromRequest,
  getCashierTokenFromRequest,
  isCashierAuthenticated,
  requireCashierAuth,
};
