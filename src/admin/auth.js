const crypto = require("node:crypto");
const { getSetting, setSetting } = require("../utils/settings");

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

function getAdminTokenFromRequest(request) {
  const headerValue = request.headers.authorization || "";
  const tokenMatch = headerValue.match(/^Bearer\s+(.+)$/i);
  return tokenMatch ? tokenMatch[1] : "";
}

function isAdminAuthenticated(request, adminSessions) {
  const token = getAdminTokenFromRequest(request);
  if (!token || !adminSessions.has(token)) {
    return false;
  }

  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }

  session.expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  adminSessions.set(token, session);
  return true;
}

function requireAdminAuth(request, response, next, adminSessions) {
  if (!isAdminAuthenticated(request, adminSessions)) {
    response.status(401).json({
      message: "Necesitas la contrasena de admin para entrar aqui.",
    });
    return;
  }

  next();
}

function createAdminSession(adminSessions) {
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8,
  });
  return token;
}

function destroyAdminSession(request, adminSessions) {
  const token = getAdminTokenFromRequest(request);
  if (token) {
    adminSessions.delete(token);
  }
}

module.exports = {
  createAdminSession,
  destroyAdminSession,
  getStoredAdminUsername,
  getStoredAdminPassword,
  hashAdminPassword,
  isAdminAuthenticated,
  requireAdminAuth,
  setSetting,
  verifyAdminCredentials,
  verifyAdminPassword,
};