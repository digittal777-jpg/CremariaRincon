const crypto = require("node:crypto");

const { ADMIN_LOGIN_LOCK_MS, ADMIN_LOGIN_WINDOW_MS, ADMIN_MAX_FAILED_LOGINS, ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_TTL_MS } = require("../config");
const { getDb, nowIso } = require("../db");
const { createHttpError } = require("../utils/helpers");
const { getSetting, setSetting } = require("../utils/settings");

const db = getDb();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const failedLoginAttempts = new Map();

function getStoredAdminUsername() {
  const raw = String(getSetting("admin.username") || "").trim();
  return raw || "admin";
}

function getStoredAdminPassword() {
  const raw = getSetting("admin.password");
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function hashAdminPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyAdminPassword(password) {
  const stored = getStoredAdminPassword();
  if (!stored) {
    return false;
  }

  const candidate = hashAdminPassword(password, stored.salt);
  return crypto.timingSafeEqual(
    Buffer.from(candidate.hash, "hex"),
    Buffer.from(stored.hash, "hex"),
  );
}

function verifyAdminCredentials(username, password) {
  const storedUsername = getStoredAdminUsername();
  if (String(username || "").trim().toLowerCase() !== storedUsername.toLowerCase()) {
    return false;
  }
  return verifyAdminPassword(password);
}

function parseCookiesFromRequest(request) {
  const rawCookies = String(request?.headers?.cookie || "");
  if (!rawCookies) {
    return {};
  }

  return rawCookies.split(";").reduce((cookies, part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      return cookies;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) {
      return cookies;
    }

    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getAdminClientAddress(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((fragment) => fragment.trim())
    .find(Boolean);

  return forwardedFor
    || request?.socket?.remoteAddress
    || request?.ip
    || "unknown";
}

function getAdminSessionIdFromRequest(request) {
  const cookies = parseCookiesFromRequest(request);
  return String(cookies[ADMIN_SESSION_COOKIE_NAME] || "").trim();
}

function getAdminSessionRow(sessionId) {
  if (!sessionId) {
    return null;
  }

  return db.prepare(`
    SELECT session_id, username, csrf_token, created_at, expires_at, last_seen_at, ip_address, user_agent
    FROM admin_sessions
    WHERE session_id = ?
  `).get(sessionId);
}

function deleteAdminSessionById(sessionId) {
  if (!sessionId) {
    return;
  }

  db.prepare("DELETE FROM admin_sessions WHERE session_id = ?").run(sessionId);
}

function pruneExpiredAdminSessions() {
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(nowIso());
}

function mapAdminSession(row) {
  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    username: row.username,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
  };
}

function getAdminSession(request, options = {}) {
  pruneExpiredAdminSessions();
  const sessionId = getAdminSessionIdFromRequest(request);
  const row = getAdminSessionRow(sessionId);
  if (!row) {
    request.adminSession = null;
    return null;
  }

  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    deleteAdminSessionById(sessionId);
    request.adminSession = null;
    return null;
  }

  let session = mapAdminSession(row);
  if (options.touch !== false) {
    const nextExpiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
    const lastSeenAt = nowIso();
    db.prepare(`
      UPDATE admin_sessions
      SET expires_at = ?, last_seen_at = ?
      WHERE session_id = ?
    `).run(nextExpiresAt, lastSeenAt, session.sessionId);
    session = {
      ...session,
      expiresAt: nextExpiresAt,
      lastSeenAt,
    };
  }

  request.adminSession = session;
  return session;
}

function isAdminAuthenticated(request) {
  return Boolean(getAdminSession(request));
}

function assertAdminMutationCsrf(request, session) {
  if (SAFE_METHODS.has(String(request.method || "GET").toUpperCase())) {
    return;
  }

  const csrfToken = String(request.headers["x-csrf-token"] || "").trim();
  if (!csrfToken || csrfToken !== session.csrfToken) {
    throw createHttpError(
      "La sesion admin requiere validacion de seguridad. Recarga e inicia sesion otra vez.",
      403,
    );
  }
}

function requireAdminAuth(request, response, next) {
  const session = getAdminSession(request);
  if (!session) {
    response.status(401).json({
      message: "Necesitas la contrasena de admin para entrar aqui.",
    });
    return;
  }

  try {
    assertAdminMutationCsrf(request, session);
  } catch (error) {
    response.status(error.statusCode || 403).json({
      message: error.message || "La sesion admin no paso la validacion de seguridad.",
    });
    return;
  }

  next();
}

function createAdminSession(request, username = getStoredAdminUsername()) {
  pruneExpiredAdminSessions();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
  const sessionId = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const ipAddress = String(getAdminClientAddress(request) || "").slice(0, 120);
  const userAgent = String(request?.headers?.["user-agent"] || "").slice(0, 255);

  db.prepare(`
    INSERT INTO admin_sessions (
      session_id,
      username,
      csrf_token,
      created_at,
      expires_at,
      last_seen_at,
      ip_address,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, String(username || getStoredAdminUsername()), csrfToken, now, expiresAt, now, ipAddress, userAgent);

  const session = {
    sessionId,
    username: String(username || getStoredAdminUsername()),
    csrfToken,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    ipAddress,
    userAgent,
  };
  request.adminSession = session;
  return session;
}

function destroyAdminSession(request) {
  const sessionId = getAdminSessionIdFromRequest(request);
  if (sessionId) {
    deleteAdminSessionById(sessionId);
  }
  request.adminSession = null;
}

function getAdminClientKey(request, username) {
  return `${String(getAdminClientAddress(request) || "unknown")}::${String(username || "").trim().toLowerCase()}`;
}

function getFailedLoginRecord(request, username) {
  const key = getAdminClientKey(request, username);
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

function assertAdminLoginAllowed(request, username) {
  const record = getFailedLoginRecord(request, username);
  if (record.lockedUntil > Date.now()) {
    const retryInMinutes = Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / 60000));
    throw createHttpError(
      `Demasiados intentos fallidos. Espera ${retryInMinutes} minuto(s) antes de volver a intentar.`,
      429,
    );
  }
}

function registerFailedAdminLogin(request, username) {
  const now = Date.now();
  const record = getFailedLoginRecord(request, username);
  record.timestamps.push(now);
  if (record.timestamps.length >= ADMIN_MAX_FAILED_LOGINS) {
    record.lockedUntil = now + ADMIN_LOGIN_LOCK_MS;
    record.timestamps = [];
  }
  failedLoginAttempts.set(record.key, record);
}

function clearAdminLoginFailures(request, username) {
  failedLoginAttempts.delete(getAdminClientKey(request, username));
}

function getAdminPasswordValidationError(password) {
  const normalized = String(password || "");
  if (normalized.length < 8) {
    return "La contrasena admin debe tener al menos 8 caracteres.";
  }

  const hasLetter = /[A-Za-z]/.test(normalized);
  const hasNumber = /\d/.test(normalized);
  if (!hasLetter || !hasNumber) {
    return "La contrasena admin debe incluir letras y numeros.";
  }

  return "";
}

module.exports = {
  ADMIN_SESSION_COOKIE_NAME,
  assertAdminLoginAllowed,
  clearAdminLoginFailures,
  createAdminSession,
  destroyAdminSession,
  getAdminPasswordValidationError,
  getAdminSession,
  getAdminSessionIdFromRequest,
  getStoredAdminPassword,
  getStoredAdminUsername,
  hashAdminPassword,
  isAdminAuthenticated,
  parseCookiesFromRequest,
  pruneExpiredAdminSessions,
  registerFailedAdminLogin,
  requireAdminAuth,
  setSetting,
  verifyAdminCredentials,
  verifyAdminPassword,
};
