const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getRuntimeConfigStatus, readRuntimeConfigValue } = require("./runtimeConfig");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, "data");
const LEGACY_DB_PATH = path.join(DEFAULT_DATA_DIR, "cremaria-rincon.sqlite");
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");

function readBooleanRuntimeFlag(key, defaultValue = false, options = {}) {
  const rawValue = String(readRuntimeConfigValue(key, defaultValue ? "true" : "false", options) || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }
  return Boolean(defaultValue);
}

function readMillisecondsRuntimeValue(key, defaultValue, minValue = 0) {
  const numericValue = Number(readRuntimeConfigValue(key, String(defaultValue)));
  return Number.isFinite(numericValue) ? Math.max(minValue, numericValue) : defaultValue;
}

function isRailwayRuntime() {
  return [
    process.env.RAILWAY_ENVIRONMENT,
    process.env.RAILWAY_PROJECT_ID,
    process.env.RAILWAY_SERVICE_ID,
    process.env.RAILWAY_DEPLOYMENT_ID,
  ].some((value) => String(value || "").trim() !== "");
}

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
const CONFIGURED_DB_PATH = readRuntimeConfigValue("POS_DB_PATH");
const DB_PATH = CONFIGURED_DB_PATH
  ? path.resolve(ROOT_DIR, CONFIGURED_DB_PATH)
  : DEFAULT_DB_PATH;
const DATA_DIR = path.dirname(DB_PATH);
const PORT = Number(readRuntimeConfigValue("PORT", "3100", { preferEnv: true }) || 3100);
const STORE_NAME = "Cremeria El Rincon";
const STORE_TIME_ZONE = readRuntimeConfigValue("POS_TIMEZONE", "America/Mexico_City");
const STORE_SHIFTS = ["Manana", "Tarde"];
const STORE_BRANCHES = ["carrizal", "miradores"];
const EXPORT_LOOKBACK_DAYS = Math.max(0, Number(readRuntimeConfigValue("POS_EXPORT_LOOKBACK_DAYS", "14") || 14));
const ENABLE_DB_INSTALL_BACKUP = readRuntimeConfigValue("POS_DB_INSTALL_BACKUP") === "true";
const STORE_BRANCH_LABELS = {
  carrizal: "Carrizal",
  miradores: "Miradores",
};
const ADMIN_SESSION_COOKIE_NAME = "cremeria_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const OWNER_SESSION_COOKIE_NAME = "cremeria_owner_session";
const OWNER_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const BOOTSTRAP_TOKEN_HEADER_NAME = "x-bootstrap-token";
const POS_BOOTSTRAP_TOKEN = String(readRuntimeConfigValue("POS_BOOTSTRAP_TOKEN") || "").trim();
const CASHIER_SESSION_TTL_MS = Math.max(
  60_000,
  Number(readRuntimeConfigValue("POS_CASHIER_SESSION_TTL_MS", String(1000 * 60 * 60 * 24 * 7)) || 1000 * 60 * 60 * 24 * 7),
);
const ADMIN_MAX_FAILED_LOGINS = Math.max(3, Number(readRuntimeConfigValue("POS_ADMIN_MAX_FAILED_LOGINS", "5") || 5));
const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number(readRuntimeConfigValue("POS_ADMIN_LOGIN_WINDOW_MS", String(1000 * 60 * 15)) || 1000 * 60 * 15));
const ADMIN_LOGIN_LOCK_MS = Math.max(60_000, Number(readRuntimeConfigValue("POS_ADMIN_LOGIN_LOCK_MS", String(1000 * 60 * 15)) || 1000 * 60 * 15));
const RUNTIME_NODE_ENV = String(readRuntimeConfigValue("NODE_ENV", process.env.NODE_ENV || "", { preferEnv: true }) || "").trim();
const POS_SECURE_COOKIES = readRuntimeConfigValue("POS_SECURE_COOKIES");
const POS_PUBLIC_ORIGIN = String(readRuntimeConfigValue("POS_PUBLIC_ORIGIN") || "").trim();
const POS_HTTPS_CERT_PATH = String(readRuntimeConfigValue("POS_HTTPS_CERT_PATH") || "").trim();
const POS_HTTPS_KEY_PATH = String(readRuntimeConfigValue("POS_HTTPS_KEY_PATH") || "").trim();
const POS_HTTPS_CA_PATH = String(readRuntimeConfigValue("POS_HTTPS_CA_PATH") || "").trim();
const POS_HTTPS_CERT_B64 = String(readRuntimeConfigValue("POS_HTTPS_CERT_B64") || "").trim();
const POS_HTTPS_KEY_B64 = String(readRuntimeConfigValue("POS_HTTPS_KEY_B64") || "").trim();
const POS_HTTPS_CA_B64 = String(readRuntimeConfigValue("POS_HTTPS_CA_B64") || "").trim();
const HAS_POS_DIRECT_HTTPS_CREDENTIALS = (
  Boolean(POS_HTTPS_CERT_PATH || POS_HTTPS_CERT_B64)
  && Boolean(POS_HTTPS_KEY_PATH || POS_HTTPS_KEY_B64)
);
const SESSION_COOKIE_SECURE = POS_SECURE_COOKIES === "true"
  ? true
  : POS_SECURE_COOKIES === "false"
    ? false
    : RUNTIME_NODE_ENV === "production"
      || POS_PUBLIC_ORIGIN.toLowerCase().startsWith("https://")
      || HAS_POS_DIRECT_HTTPS_CREDENTIALS;
const POS_FORCE_HTTPS_SETTING = String(readRuntimeConfigValue("POS_FORCE_HTTPS") || "").trim().toLowerCase();
const POS_FORCE_HTTPS = POS_FORCE_HTTPS_SETTING === "true"
  ? true
  : POS_FORCE_HTTPS_SETTING === "false"
    ? false
    : SESSION_COOKIE_SECURE || RUNTIME_NODE_ENV === "production" || POS_PUBLIC_ORIGIN.toLowerCase().startsWith("https://");
const POS_HTTP_REDIRECT_PORT = Math.max(0, Number(readRuntimeConfigValue("POS_HTTP_REDIRECT_PORT", "0", { preferEnv: true }) || 0));
const POS_TRUST_PROXY = String(readRuntimeConfigValue("POS_TRUST_PROXY") || "").trim();
const POS_HSTS_MAX_AGE_SECONDS = Math.max(0, Number(readRuntimeConfigValue("POS_HSTS_MAX_AGE_SECONDS", "31536000") || 31536000));
const POS_ALLOWED_ORIGINS = String(readRuntimeConfigValue("POS_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function getLocalNetworkOrigins(port, options = {}) {
  const interfaces = os.networkInterfaces();
  const origins = [];
  const protocols = options.includeHttps ? ["http", "https"] : ["http"];

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
        protocols.forEach((protocol) => {
          origins.push(`${protocol}://${addressInfo.address}:${port}`);
        });
        return;
      }

      if (family === "IPv6" && !String(addressInfo.address).startsWith("fe80:")) {
        protocols.forEach((protocol) => {
          origins.push(`${protocol}://[${addressInfo.address}]:${port}`);
        });
      }
    });
  });

  return [...new Set(origins)];
}

const RAILWAY_DOMAIN_HINTS = [
  readRuntimeConfigValue("RAILWAY_PUBLIC_DOMAIN") ? `https://${readRuntimeConfigValue("RAILWAY_PUBLIC_DOMAIN")}` : "",
  readRuntimeConfigValue("RAILWAY_STATIC_URL") ? `https://${readRuntimeConfigValue("RAILWAY_STATIC_URL")}` : "",
].filter(Boolean);
const INCLUDE_LOCAL_HTTPS_ORIGINS = HAS_POS_DIRECT_HTTPS_CREDENTIALS || POS_PUBLIC_ORIGIN.toLowerCase().startsWith("https://");
const LOCAL_NETWORK_ORIGINS = getLocalNetworkOrigins(PORT, { includeHttps: INCLUDE_LOCAL_HTTPS_ORIGINS });
const DEFAULT_ALLOWED_ORIGINS = [
  POS_PUBLIC_ORIGIN,
  ...RAILWAY_DOMAIN_HINTS,
  ...LOCAL_NETWORK_ORIGINS,
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(INCLUDE_LOCAL_HTTPS_ORIGINS ? [
    `https://localhost:${PORT}`,
    `https://127.0.0.1:${PORT}`,
  ] : []),
];
const ALLOWED_ORIGINS = [...new Set(
  [...DEFAULT_ALLOWED_ORIGINS, ...POS_ALLOWED_ORIGINS].filter(Boolean),
)];
const SALES_PULSE_START_HOUR = 8;
const SALES_PULSE_END_HOUR = 20;
const CONFIGURED_WORKBOOK_PATH = readRuntimeConfigValue("POS_WORKBOOK_PATH");
const CUSTOM_WORKBOOK_PATH = CONFIGURED_WORKBOOK_PATH
  ? path.resolve(ROOT_DIR, CONFIGURED_WORKBOOK_PATH)
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
const BACKUP_ENABLED = readRuntimeConfigValue("BACKUP_ENABLED") === "true";
const BACKUP_BUCKET_ENDPOINT = String(readRuntimeConfigValue("BACKUP_BUCKET_ENDPOINT") || "").trim();
const BACKUP_BUCKET_NAME = String(readRuntimeConfigValue("BACKUP_BUCKET_NAME") || "").trim();
const BACKUP_BUCKET_REGION = String(readRuntimeConfigValue("BACKUP_BUCKET_REGION", "auto") || "auto").trim() || "auto";
const BACKUP_ACCESS_KEY_ID = String(readRuntimeConfigValue("BACKUP_ACCESS_KEY_ID") || "").trim();
const BACKUP_SECRET_ACCESS_KEY = String(readRuntimeConfigValue("BACKUP_SECRET_ACCESS_KEY") || "").trim();
const BACKUP_PREFIX = String(readRuntimeConfigValue("BACKUP_PREFIX") || "").trim().replace(/^\/+|\/+$/g, "");
const BACKUP_RETENTION_DAILY = Math.max(1, Number(readRuntimeConfigValue("BACKUP_RETENTION_DAILY", "14") || 14));
const BACKUP_RETENTION_WEEKLY = Math.max(1, Number(readRuntimeConfigValue("BACKUP_RETENTION_WEEKLY", "8") || 8));
const BACKUP_RETENTION_MONTHLY = Math.max(1, Number(readRuntimeConfigValue("BACKUP_RETENTION_MONTHLY", "12") || 12));
const BACKUP_NOTIFY_TO = String(readRuntimeConfigValue("BACKUP_NOTIFY_TO") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RESEND_API_KEY = String(readRuntimeConfigValue("RESEND_API_KEY") || "").trim();
const RESEND_API_URL = String(readRuntimeConfigValue("RESEND_API_URL", "https://api.resend.com/emails") || "https://api.resend.com/emails").trim();
const TELEGRAM_BOT_TOKEN = String(readRuntimeConfigValue("TELEGRAM_BOT_TOKEN") || "").trim();
const TELEGRAM_CHAT_IDS = String(readRuntimeConfigValue("TELEGRAM_CHAT_IDS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const TELEGRAM_API_BASE_URL = String(readRuntimeConfigValue("TELEGRAM_API_BASE_URL", "https://api.telegram.org") || "https://api.telegram.org").trim();
const BACKUP_SYNC_REPORT_STALE_HOURS = Math.max(1, Number(readRuntimeConfigValue("BACKUP_SYNC_REPORT_STALE_HOURS", "36") || 36));
const BACKUP_LOCAL_STAGING_KEEP = Math.max(1, Number(readRuntimeConfigValue("BACKUP_LOCAL_STAGING_KEEP", "2") || 2));
const CONTROL_REQUIRE_HTTPS_SETTING = String(readRuntimeConfigValue("CONTROL_REQUIRE_HTTPS") || "").trim().toLowerCase();
const CONTROL_REQUIRE_HTTPS = CONTROL_REQUIRE_HTTPS_SETTING === "false"
  ? false
  : CONTROL_REQUIRE_HTTPS_SETTING === "true"
    ? true
    : POS_FORCE_HTTPS || RUNTIME_NODE_ENV === "production";
const CONTROL_API_URL = String(readRuntimeConfigValue("CONTROL_API_URL", "", { preferEnv: true }) || "").trim().replace(/\/+$/g, "");
const CONTROL_CLIENT_SLUG = String(readRuntimeConfigValue("CONTROL_CLIENT_SLUG", "", { preferEnv: true }) || "").trim();
const CONTROL_CLIENT_SECRET = String(readRuntimeConfigValue("CONTROL_CLIENT_SECRET", "", { preferEnv: true }) || "").trim();
const RAILWAY_COST_SAVER_MODE = readBooleanRuntimeFlag("RAILWAY_COST_SAVER_MODE", isRailwayRuntime(), { preferEnv: true });
const CONTROL_CONFIG_POLL_DEFAULT_MS = RAILWAY_COST_SAVER_MODE ? 0 : 30000;
const CONTROL_CONFIG_SYNC_MAX_AGE_DEFAULT_MS = RAILWAY_COST_SAVER_MODE ? 300000 : 15000;
const CONTROL_SYNC_TIMEOUT_MS = readMillisecondsRuntimeValue("CONTROL_SYNC_TIMEOUT_MS", 8000, 1000);
const CONTROL_CONFIG_POLL_MS = readMillisecondsRuntimeValue("CONTROL_CONFIG_POLL_MS", CONTROL_CONFIG_POLL_DEFAULT_MS, 0);
const CONTROL_CONFIG_SYNC_MAX_AGE_MS = readMillisecondsRuntimeValue("CONTROL_CONFIG_SYNC_MAX_AGE_MS", CONTROL_CONFIG_SYNC_MAX_AGE_DEFAULT_MS, 1000);

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
  CASHIER_SESSION_TTL_MS,
  ADMIN_MAX_FAILED_LOGINS,
  ADMIN_LOGIN_WINDOW_MS,
  ADMIN_LOGIN_LOCK_MS,
  SESSION_COOKIE_SECURE,
  POS_FORCE_HTTPS,
  POS_HTTPS_CA_B64,
  POS_HTTPS_CA_PATH,
  POS_HTTPS_CERT_B64,
  POS_HTTPS_CERT_PATH,
  POS_HTTPS_KEY_B64,
  POS_HTTPS_KEY_PATH,
  POS_TRUST_PROXY,
  POS_HSTS_MAX_AGE_SECONDS,
  POS_HTTP_REDIRECT_PORT,
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
  CONTROL_API_URL,
  CONTROL_REQUIRE_HTTPS,
  CONTROL_CLIENT_SLUG,
  CONTROL_CLIENT_SECRET,
  RAILWAY_COST_SAVER_MODE,
  CONTROL_CONFIG_POLL_MS,
  CONTROL_CONFIG_SYNC_MAX_AGE_MS,
  CONTROL_SYNC_TIMEOUT_MS,
  RUNTIME_CONFIG_STATUS: getRuntimeConfigStatus(),
};
