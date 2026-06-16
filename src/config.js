const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, "data");
const LEGACY_DB_PATH = path.join(DEFAULT_DATA_DIR, "cremaria-rincon.sqlite");
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");

function isUsableSqliteFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < SQLITE_HEADER.length) {
      return false;
    }

    const descriptor = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      fs.readSync(descriptor, header, 0, SQLITE_HEADER.length, 0);
      return header.equals(SQLITE_HEADER);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (_error) {
    return false;
  }
}

const DEFAULT_DB_PATH = isUsableSqliteFile(LEGACY_DB_PATH)
  ? LEGACY_DB_PATH
  : path.join(DEFAULT_DATA_DIR, "retail-base-pos.sqlite");
const DB_PATH = process.env.POS_DB_PATH
  ? path.resolve(ROOT_DIR, process.env.POS_DB_PATH)
  : DEFAULT_DB_PATH;
const DATA_DIR = path.dirname(DB_PATH);
const PORT = Number(process.env.PORT || 3100);
const STORE_NAME = "Cremeria El Rincon";
const STORE_TIME_ZONE = process.env.POS_TIMEZONE || "America/Mexico_City";
const STORE_SHIFTS = ["Manana", "Tarde"];
const STORE_BRANCHES = ["carrizal", "miradores"];
const EXPORT_LOOKBACK_DAYS = Math.max(0, Number(process.env.POS_EXPORT_LOOKBACK_DAYS || 14));
const ENABLE_DB_INSTALL_BACKUP = process.env.POS_DB_INSTALL_BACKUP === "true";
const STORE_BRANCH_LABELS = {
  carrizal: "Carrizal",
  miradores: "Miradores",
};
const ADMIN_SESSION_COOKIE_NAME = "cremeria_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const OWNER_SESSION_COOKIE_NAME = "cremeria_owner_session";
const OWNER_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const BOOTSTRAP_TOKEN_HEADER_NAME = "x-bootstrap-token";
const POS_BOOTSTRAP_TOKEN = String(process.env.POS_BOOTSTRAP_TOKEN || "").trim();
const ADMIN_MAX_FAILED_LOGINS = Math.max(3, Number(process.env.POS_ADMIN_MAX_FAILED_LOGINS || 5));
const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number(process.env.POS_ADMIN_LOGIN_WINDOW_MS || 1000 * 60 * 15));
const ADMIN_LOGIN_LOCK_MS = Math.max(60_000, Number(process.env.POS_ADMIN_LOGIN_LOCK_MS || 1000 * 60 * 15));
const SESSION_COOKIE_SECURE = process.env.POS_SECURE_COOKIES === "true"
  ? true
  : process.env.POS_SECURE_COOKIES === "false"
    ? false
    : process.env.NODE_ENV === "production";
const POS_PUBLIC_ORIGIN = String(process.env.POS_PUBLIC_ORIGIN || "").trim();
const POS_ALLOWED_ORIGINS = String(process.env.POS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function getLocalNetworkOrigins(port) {
  const interfaces = os.networkInterfaces();
  const origins = [];

  Object.values(interfaces).forEach((addresses) => {
    (addresses || []).forEach((addressInfo) => {
      if (!addressInfo || addressInfo.internal || !addressInfo.address) {
        return;
      }

      const family = typeof addressInfo.family === "string"
        ? addressInfo.family
        : Number(addressInfo.family) === 6
          ? "IPv6"
          : "IPv4";

      if (family === "IPv4") {
        origins.push(`http://${addressInfo.address}:${port}`);
        return;
      }

      if (family === "IPv6" && !String(addressInfo.address).startsWith("fe80:")) {
        origins.push(`http://[${addressInfo.address}]:${port}`);
      }
    });
  });

  return [...new Set(origins)];
}

const RAILWAY_DOMAIN_HINTS = [
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "",
  process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : "",
].filter(Boolean);
const LOCAL_NETWORK_ORIGINS = getLocalNetworkOrigins(PORT);
const DEFAULT_ALLOWED_ORIGINS = [
  POS_PUBLIC_ORIGIN,
  ...RAILWAY_DOMAIN_HINTS,
  ...LOCAL_NETWORK_ORIGINS,
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];
const ALLOWED_ORIGINS = [...new Set(
  [...DEFAULT_ALLOWED_ORIGINS, ...POS_ALLOWED_ORIGINS].filter(Boolean),
)];
const SALES_PULSE_START_HOUR = 8;
const SALES_PULSE_END_HOUR = 20;
const CUSTOM_WORKBOOK_PATH = process.env.POS_WORKBOOK_PATH
  ? path.resolve(ROOT_DIR, process.env.POS_WORKBOOK_PATH)
  : null;
const DEFAULT_WORKBOOK_CANDIDATES = [
  "catalogo-base.xlsx",
  "Queseria El rincon V1.5.xlsx",
];
const DEFAULT_WORKBOOK_PATHS = [
  CUSTOM_WORKBOOK_PATH,
  ...DEFAULT_WORKBOOK_CANDIDATES.map((fileName) => path.join(ROOT_DIR, fileName)),
  ...DEFAULT_WORKBOOK_CANDIDATES.map((fileName) => path.join(process.env.USERPROFILE || "", "Downloads", fileName)),
].filter(Boolean);
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === "true";
const BACKUP_BUCKET_ENDPOINT = String(process.env.BACKUP_BUCKET_ENDPOINT || "").trim();
const BACKUP_BUCKET_NAME = String(process.env.BACKUP_BUCKET_NAME || "").trim();
const BACKUP_BUCKET_REGION = String(process.env.BACKUP_BUCKET_REGION || "auto").trim() || "auto";
const BACKUP_ACCESS_KEY_ID = String(process.env.BACKUP_ACCESS_KEY_ID || "").trim();
const BACKUP_SECRET_ACCESS_KEY = String(process.env.BACKUP_SECRET_ACCESS_KEY || "").trim();
const BACKUP_PREFIX = String(process.env.BACKUP_PREFIX || "").trim().replace(/^\/+|\/+$/g, "");
const BACKUP_RETENTION_DAILY = Math.max(1, Number(process.env.BACKUP_RETENTION_DAILY || 14));
const BACKUP_RETENTION_WEEKLY = Math.max(1, Number(process.env.BACKUP_RETENTION_WEEKLY || 8));
const BACKUP_RETENTION_MONTHLY = Math.max(1, Number(process.env.BACKUP_RETENTION_MONTHLY || 12));
const BACKUP_NOTIFY_TO = String(process.env.BACKUP_NOTIFY_TO || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_API_URL = String(process.env.RESEND_API_URL || "https://api.resend.com/emails").trim();
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_IDS = String(process.env.TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TELEGRAM_API_BASE_URL = String(process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org").trim();
const BACKUP_SYNC_REPORT_STALE_HOURS = Math.max(1, Number(process.env.BACKUP_SYNC_REPORT_STALE_HOURS || 36));
const BACKUP_LOCAL_STAGING_KEEP = Math.max(1, Number(process.env.BACKUP_LOCAL_STAGING_KEEP || 2));

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DB_PATH,
  PORT,
  STORE_NAME,
  STORE_TIME_ZONE,
  STORE_SHIFTS,
  STORE_BRANCHES,
  EXPORT_LOOKBACK_DAYS,
  ENABLE_DB_INSTALL_BACKUP,
  STORE_BRANCH_LABELS,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS,
  OWNER_SESSION_COOKIE_NAME,
  OWNER_SESSION_TTL_MS,
  BOOTSTRAP_TOKEN_HEADER_NAME,
  POS_BOOTSTRAP_TOKEN,
  ADMIN_MAX_FAILED_LOGINS,
  ADMIN_LOGIN_WINDOW_MS,
  ADMIN_LOGIN_LOCK_MS,
  SESSION_COOKIE_SECURE,
  ALLOWED_ORIGINS,
  POS_PUBLIC_ORIGIN,
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
  DEFAULT_WORKBOOK_PATHS,
  BACKUP_ENABLED,
  BACKUP_BUCKET_ENDPOINT,
  BACKUP_BUCKET_NAME,
  BACKUP_BUCKET_REGION,
  BACKUP_ACCESS_KEY_ID,
  BACKUP_SECRET_ACCESS_KEY,
  BACKUP_PREFIX,
  BACKUP_RETENTION_DAILY,
  BACKUP_RETENTION_WEEKLY,
  BACKUP_RETENTION_MONTHLY,
  BACKUP_NOTIFY_TO,
  RESEND_API_KEY,
  RESEND_API_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS,
  TELEGRAM_API_BASE_URL,
  BACKUP_SYNC_REPORT_STALE_HOURS,
  BACKUP_LOCAL_STAGING_KEEP,
};
