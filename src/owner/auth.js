const crypto = require("node:crypto");

const {
  ADMIN_LOGIN_LOCK_MS,
  ADMIN_LOGIN_WINDOW_MS,
  ADMIN_MAX_FAILED_LOGINS,
  OWNER_SESSION_COOKIE_NAME,
  OWNER_SESSION_TTL_MS,
  SESSION_COOKIE_SECURE,
} = require("../config");
const { getDb, nowIso } = require("../db");
const { createHttpError } = require("../utils/helpers");
const { getSetting, setSetting } = require("../utils/settings");

const db = getDb();
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const failedLoginAttempts = new Map();

function getStoredOwnerUsername() {
  const raw = String(getSetting("owner.username") || "").trim();
  return raw || "owner";
}

function getStoredOwnerPassword() {
  const raw = getSetting("owner.password");
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const salt = String(parsed?.salt || "").trim();
    const hash = String(parsed?.hash || "").trim();
    if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) {
      return null;
    }
    return { salt: salt.toLowerCase(), hash: hash.toLowerCase() };
  } catch (_error) {
    return null;
  }
}

function hashOwnerPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyOwnerPassword(password) {
  const stored = getStoredOwnerPassword();
  if (!stored) {
    return false;
  }

  try {
    const candidate = hashOwnerPassword(password, stored.salt);
    const candidateBuffer = Buffer.from(candidate.hash, "hex");
    const storedBuffer = Buffer.from(stored.hash, "hex");
    if (candidateBuffer.length !== storedBuffer.length || candidateBuffer.length === 0) {
      return false;
    }
    return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
  } catch (_error) {
    return false;
  }
}

function verifyOwnerCredentials(username, password) {
  const storedUsername = getStoredOwnerUsername();
  if (String(username || "").trim().toLowerCase() !== storedUsername.toLowerCase()) {
    return false;
  }
  return verifyOwnerPassword(password);
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

function getOwnerClientAddress(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((fragment) => fragment.trim())
    .find(Boolean);

  return forwardedFor
    || request?.socket?.remoteAddress
    || request?.ip
    || "unknown";
}

function getOwnerSessionIdFromRequest(request) {
  const cookies = parseCookiesFromRequest(request);
  return String(cookies[OWNER_SESSION_COOKIE_NAME] || "").trim();
}

function getOwnerSessionRow(sessionId) {
  if (!sessionId) {
    return null;
  }

  return db.prepare(`
    SELECT session_id, username, csrf_token, created_at, expires_at, last_seen_at, ip_address, user_agent
    FROM owner_sessions
    WHERE session_id = ?
  `).get(sessionId);
}

function destroyOwnerSession(sessionId) {
  if (!sessionId) {
    return;
  }

  db.prepare("DELETE FROM owner_sessions WHERE session_id = ?").run(sessionId);
}

function pruneExpiredOwnerSessions() {
  db.prepare("DELETE FROM owner_sessions WHERE expires_at <= ?").run(nowIso());
}

function mapOwnerSessionRow(row) {
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

function touchOwnerSession(sessionId) {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + OWNER_SESSION_TTL_MS).toISOString();
  db.prepare(`
    UPDATE owner_sessions
    SET expires_at = ?,
        last_seen_at = ?
    WHERE session_id = ?
  `).run(expiresAt, now, sessionId);

  return mapOwnerSessionRow(getOwnerSessionRow(sessionId));
}

function getOwnerSession(request, options = {}) {
  pruneExpiredOwnerSessions();
  const sessionId = getOwnerSessionIdFromRequest(request);
  if (!sessionId) {
    request.ownerSession = null;
    return null;
  }

  const row = getOwnerSessionRow(sessionId);
  if (!row) {
    destroyOwnerSession(sessionId);
    request.ownerSession = null;
    return null;
  }

  const session = options.touch === false
    ? mapOwnerSessionRow(row)
    : touchOwnerSession(sessionId);
  request.ownerSession = session;
  return session;
}

function assertOwnerCsrfToken(request, session) {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }

  const csrfToken = String(request.headers["x-csrf-token"] || "").trim();
  if (!csrfToken || csrfToken !== session.csrfToken) {
    throw createHttpError(
      "La sesion owner no coincide con el token CSRF. Cierra y vuelve a entrar.",
      403,
    );
  }
}

function requireOwnerAuth(request, response, next) {
  try {
    const session = getOwnerSession(request);
    if (!session) {
      throw createHttpError("Necesitas iniciar sesion como owner.", 401);
    }
    assertOwnerCsrfToken(request, session);
    next();
  } catch (error) {
    response.clearCookie(OWNER_SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: SESSION_COOKIE_SECURE,
      path: "/",
    });
    next(error);
  }
}

function getOwnerRateLimitState(key) {
  const now = Date.now();
  const state = failedLoginAttempts.get(key);
  if (!state) {
    return {
      count: 0,
      firstAttemptAt: now,
      lockedUntil: 0,
    };
  }

  if (state.lockedUntil && state.lockedUntil > now) {
    return state;
  }

  if (now - state.firstAttemptAt > ADMIN_LOGIN_WINDOW_MS) {
    return {
      count: 0,
      firstAttemptAt: now,
      lockedUntil: 0,
    };
  }

  return state;
}

function recordFailedOwnerLogin(request) {
  const key = getOwnerClientAddress(request);
  const state = getOwnerRateLimitState(key);
  const nextCount = state.count + 1;
  const nextState = {
    count: nextCount,
    firstAttemptAt: state.count === 0 ? Date.now() : state.firstAttemptAt,
    lockedUntil: 0,
  };

  if (nextCount >= ADMIN_MAX_FAILED_LOGINS) {
    nextState.lockedUntil = Date.now() + ADMIN_LOGIN_LOCK_MS;
  }

  failedLoginAttempts.set(key, nextState);
  return nextState;
}

function clearFailedOwnerLogin(request) {
  failedLoginAttempts.delete(getOwnerClientAddress(request));
}

function assertOwnerLoginAllowed(request) {
  const key = getOwnerClientAddress(request);
  const state = getOwnerRateLimitState(key);
  if (state.lockedUntil && state.lockedUntil > Date.now()) {
    throw createHttpError("Demasiados intentos owner. Espera unos minutos.", 429);
  }
}

function createOwnerSession(request, username = getStoredOwnerUsername()) {
  pruneExpiredOwnerSessions();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + OWNER_SESSION_TTL_MS).toISOString();
  const sessionId = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const ipAddress = String(getOwnerClientAddress(request) || "").slice(0, 120);
  const userAgent = String(request?.headers?.["user-agent"] || "").slice(0, 255);

  db.prepare(`
    INSERT INTO owner_sessions (
      session_id,
      username,
      csrf_token,
      created_at,
      expires_at,
      last_seen_at,
      ip_address,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, String(username || getStoredOwnerUsername()), csrfToken, now, expiresAt, now, ipAddress, userAgent);

  const session = {
    sessionId,
    username: String(username || getStoredOwnerUsername()),
    csrfToken,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    ipAddress,
    userAgent,
  };
  request.ownerSession = session;
  return session;
}

function destroyOwnerSessionFromRequest(request) {
  const sessionId = getOwnerSessionIdFromRequest(request);
  if (!sessionId) {
    request.ownerSession = null;
    return;
  }

  destroyOwnerSession(sessionId);
  request.ownerSession = null;
}

function setStoredOwnerCredentials(username, password) {
  const safeUsername = String(username || "").trim().toLowerCase();
  if (safeUsername.length < 3) {
    throw createHttpError("El usuario owner debe tener al menos 3 caracteres.", 400);
  }

  const safePassword = String(password || "");
  if (safePassword.length < 8 || !/[A-Za-z]/.test(safePassword) || !/\d/.test(safePassword)) {
    throw createHttpError("La contrasena owner debe tener 8+ caracteres, letras y numeros.", 400);
  }

  setSetting("owner.username", safeUsername);
  setSetting("owner.password", JSON.stringify(hashOwnerPassword(safePassword)));
  return { username: safeUsername };
}

module.exports = {
  getStoredOwnerUsername,
  getStoredOwnerPassword,
  verifyOwnerCredentials,
  requireOwnerAuth,
  createOwnerSession,
  destroyOwnerSessionFromRequest,
  getOwnerSession,
  setStoredOwnerCredentials,
  assertOwnerLoginAllowed,
  recordFailedOwnerLogin,
  clearFailedOwnerLogin,
};
