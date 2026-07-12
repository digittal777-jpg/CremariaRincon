const fs = require("node:fs");
const path = require("node:path");
const proxyaddr = require("proxy-addr");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_CONFIG_CANDIDATES = [
  path.join(ROOT_DIR, "data", "pos-runtime-config.json"),
  path.join(ROOT_DIR, ".pos-runtime.json"),
  path.join(ROOT_DIR, ".pos-runtime.env"),
];
const VALID_RUNTIME_KEY = /^[A-Z][A-Z0-9_]*$/;
const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY|API_KEY|CLIENT_SECRET)/i;
const PAIRING_RUNTIME_KEYS = new Set(["CONTROL_API_URL", "CONTROL_CLIENT_SLUG", "CONTROL_CLIENT_SECRET"]);
const HTTPS_RUNTIME_URL_KEYS = new Set([
  "CONTROL_API_URL",
  "POS_PUBLIC_ORIGIN",
  "RESEND_API_URL",
  "TELEGRAM_API_BASE_URL",
]);
const HTTPS_RUNTIME_URL_LIST_KEYS = new Set([
  "POS_ALLOWED_ORIGINS",
]);
const HTTPS_OR_FILE_RUNTIME_URL_KEYS = new Set([
  "BACKUP_BUCKET_ENDPOINT",
]);
const PEM_BASE64_RUNTIME_KEYS = new Set([
  "POS_HTTPS_CERT_B64",
  "POS_HTTPS_KEY_B64",
  "POS_HTTPS_CA_B64",
]);
const PREFER_ENV_RUNTIME_KEYS = new Set([
  "NODE_ENV",
  "PORT",
  "POS_HTTP_REDIRECT_PORT",
  "RAILWAY_COST_SAVER_MODE",
]);
const TRUST_PROXY_RUNTIME_KEYS = new Set([
  "POS_TRUST_PROXY",
]);
const RUNTIME_VARIABLE_DEFINITIONS = [
  {
    key: "PORT",
    group: "Host",
    label: "Puerto POS",
    description: "Puerto HTTP local. En hosts administrados el servicio puede tener prioridad.",
    placeholder: "3100",
    restartRequired: true,
  },
  {
    key: "NODE_ENV",
    group: "Host",
    label: "Modo Node",
    description: "production, development o test. En despliegues administrados el servicio tiene prioridad.",
    placeholder: "production",
    type: "select",
    options: ["", "production", "development", "test"],
    restartRequired: true,
  },
  {
    key: "POS_DB_PATH",
    group: "POS",
    label: "Base SQLite",
    description: "Ruta de la base del cliente. Cambiarla requiere reiniciar.",
    placeholder: "data/retail-base-pos.sqlite",
    restartRequired: true,
  },
  {
    key: "POS_WORKBOOK_PATH",
    group: "POS",
    label: "Excel base",
    description: "Catalogo usado al sembrar o reimportar si aplica.",
    placeholder: "catalogos/cremeria-base.xlsx",
    restartRequired: true,
  },
  {
    key: "POS_TIMEZONE",
    group: "POS",
    label: "Zona horaria",
    description: "Zona operativa para cortes, fechas y reportes.",
    placeholder: "America/Mexico_City",
    restartRequired: true,
  },
  {
    key: "POS_EXPORT_LOOKBACK_DAYS",
    group: "POS",
    label: "Dias exportables",
    description: "Ventana maxima para exportaciones de Excel.",
    placeholder: "14",
    restartRequired: true,
  },
  {
    key: "POS_DB_INSTALL_BACKUP",
    group: "POS",
    label: "Backup antes de instalar DB",
    description: "Crea respaldo local antes de instalar una base nueva.",
    placeholder: "false",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "POS_PUBLIC_ORIGIN",
    group: "Red",
    label: "URL publica",
    description: "Origen publico esperado del POS.",
    placeholder: "https://cliente.ejemplo.com",
    restartRequired: true,
  },
  {
    key: "POS_ALLOWED_ORIGINS",
    group: "Red",
    label: "Origenes permitidos",
    description: "Lista separada por comas para CORS y cookies.",
    placeholder: "https://cliente.ejemplo.com,http://localhost:3100",
    restartRequired: true,
  },
  {
    key: "POS_SECURE_COOKIES",
    group: "Seguridad",
    label: "Cookies seguras",
    description: "Usa true en HTTPS y false en pruebas locales.",
    placeholder: "true",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "POS_FORCE_HTTPS",
    group: "Seguridad",
    label: "Forzar HTTPS POS",
    description: "Redirige o bloquea HTTP fuera de localhost para no exponer sesiones.",
    placeholder: "true",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_CERT_PATH",
    group: "Seguridad",
    label: "Certificado HTTPS",
    description: "Ruta local al certificado PEM si el mismo proceso Node va a terminar TLS.",
    placeholder: "certs/pos-cert.pem",
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_KEY_PATH",
    group: "Seguridad",
    label: "Llave HTTPS",
    description: "Ruta local a la llave privada PEM del certificado HTTPS.",
    placeholder: "certs/pos-key.pem",
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_CA_PATH",
    group: "Seguridad",
    label: "CA HTTPS",
    description: "Ruta opcional a la cadena PEM intermedia o CA.",
    placeholder: "certs/pos-ca.pem",
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_CERT_B64",
    group: "Seguridad",
    label: "Certificado HTTPS b64",
    description: "Certificado PEM codificado en base64 para administrarlo desde owner-control sin depender del host.",
    placeholder: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...",
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_KEY_B64",
    group: "Seguridad",
    label: "Llave HTTPS b64",
    description: "Llave privada PEM codificada en base64. Guardala como secreto.",
    placeholder: "LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t...",
    secret: true,
    restartRequired: true,
  },
  {
    key: "POS_HTTPS_CA_B64",
    group: "Seguridad",
    label: "CA HTTPS b64",
    description: "Cadena PEM intermedia o CA codificada en base64.",
    placeholder: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...",
    restartRequired: true,
  },
  {
    key: "POS_HTTP_REDIRECT_PORT",
    group: "Seguridad",
    label: "Puerto HTTP redirect",
    description: "Puerto opcional para redirigir trafico plano a HTTPS cuando el POS termina TLS directo.",
    placeholder: "80",
    restartRequired: true,
  },
  {
    key: "POS_TRUST_PROXY",
    group: "Seguridad",
    label: "Proxy confiable",
    description: "Subred o aliases confiables para aceptar X-Forwarded-Proto detras de TLS. Usa lista explicita, no true. Ejemplo: loopback,linklocal,uniquelocal",
    placeholder: "loopback,linklocal,uniquelocal",
    restartRequired: true,
  },
  {
    key: "POS_HSTS_MAX_AGE_SECONDS",
    group: "Seguridad",
    label: "HSTS segundos",
    description: "Tiempo para que navegadores recuerden usar HTTPS en el POS.",
    placeholder: "31536000",
    restartRequired: true,
  },
  {
    key: "POS_BOOTSTRAP_TOKEN",
    group: "Seguridad",
    label: "Token bootstrap",
    description: "Token para crear owner/admin iniciales.",
    placeholder: "token-largo-privado",
    secret: true,
    restartRequired: true,
  },
  {
    key: "POS_ADMIN_MAX_FAILED_LOGINS",
    group: "Seguridad",
    label: "Intentos admin",
    description: "Intentos fallidos antes de bloquear login admin.",
    placeholder: "5",
    restartRequired: true,
  },
  {
    key: "POS_CASHIER_SESSION_TTL_MS",
    group: "Seguridad",
    label: "TTL sesion cajero",
    description: "Milisegundos que dura una sesion de cajero antes de requerir nuevo login.",
    placeholder: "604800000",
    restartRequired: true,
  },
  {
    key: "POS_ADMIN_LOGIN_WINDOW_MS",
    group: "Seguridad",
    label: "Ventana login admin",
    description: "Milisegundos de ventana para contar intentos fallidos.",
    placeholder: "900000",
    restartRequired: true,
  },
  {
    key: "POS_ADMIN_LOGIN_LOCK_MS",
    group: "Seguridad",
    label: "Bloqueo login admin",
    description: "Milisegundos de bloqueo despues de demasiados intentos.",
    placeholder: "900000",
    restartRequired: true,
  },
  {
    key: "CONTROL_API_URL",
    group: "Owner-control",
    label: "URL owner-control",
    description: "API central para permisos, salud y suscripcion. Usa HTTPS fuera de localhost.",
    placeholder: "https://owner-control.ejemplo.com",
    restartRequired: true,
  },
  {
    key: "CONTROL_REQUIRE_HTTPS",
    group: "Owner-control",
    label: "Compatibilidad HTTPS central",
    description: "Compatibilidad legacy. El POS sigue exigiendo HTTPS fuera de localhost aunque este valor se ponga en false.",
    placeholder: "true",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "CONTROL_CLIENT_SLUG",
    group: "Owner-control",
    label: "Slug cliente",
    description: "Identificador del cliente en owner-control.",
    placeholder: "cremeria-rincon",
    restartRequired: true,
  },
  {
    key: "CONTROL_CLIENT_SECRET",
    group: "Owner-control",
    label: "API key cliente",
    description: "Secreto que autoriza a este POS contra owner-control.",
    placeholder: "pos_...",
    secret: true,
    restartRequired: true,
  },
  {
    key: "CONTROL_CONFIG_POLL_MS",
    group: "Owner-control",
    label: "Polling config",
    description: "Milisegundos entre consultas automaticas de config central. En Railway ahorro usa 0 para permitir sleep.",
    placeholder: "0 en Railway, 30000 local",
    restartRequired: true,
  },
  {
    key: "CONTROL_SYNC_TIMEOUT_MS",
    group: "Owner-control",
    label: "Timeout sync",
    description: "Milisegundos maximos para llamadas al owner-control.",
    placeholder: "8000",
    restartRequired: true,
  },
  {
    key: "CONTROL_CONFIG_SYNC_MAX_AGE_MS",
    group: "Owner-control",
    label: "Edad cache config",
    description: "Tiempo maximo para considerar fresca la configuracion central; en Railway conviene una ventana mas amplia.",
    placeholder: "300000 en Railway, 15000 local",
    restartRequired: true,
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    group: "Telegram",
    label: "Bot token",
    description: "Token privado del bot para avisos.",
    placeholder: "123456:ABC...",
    secret: true,
    restartRequired: true,
  },
  {
    key: "TELEGRAM_CHAT_IDS",
    group: "Telegram",
    label: "Chats destino",
    description: "IDs separados por comas.",
    placeholder: "-1001234567890,123456",
    restartRequired: true,
  },
  {
    key: "TELEGRAM_API_BASE_URL",
    group: "Telegram",
    label: "API Telegram",
    description: "Base URL de Telegram o proxy compatible.",
    placeholder: "https://api.telegram.org",
    restartRequired: true,
  },
  {
    key: "BACKUP_ENABLED",
    group: "Backups",
    label: "Backups activos",
    description: "Activa respaldo externo programado.",
    placeholder: "false",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "BACKUP_BUCKET_ENDPOINT",
    group: "Backups",
    label: "Endpoint bucket",
    description: "Endpoint compatible S3.",
    placeholder: "https://...",
    restartRequired: true,
  },
  {
    key: "BACKUP_BUCKET_NAME",
    group: "Backups",
    label: "Bucket",
    description: "Nombre del bucket de respaldos.",
    placeholder: "pos-backups",
    restartRequired: true,
  },
  {
    key: "BACKUP_BUCKET_REGION",
    group: "Backups",
    label: "Region bucket",
    description: "Region S3 o auto para proveedores compatibles.",
    placeholder: "auto",
    restartRequired: true,
  },
  {
    key: "BACKUP_ACCESS_KEY_ID",
    group: "Backups",
    label: "Access key",
    description: "Llave de acceso al bucket.",
    placeholder: "access-key",
    secret: true,
    restartRequired: true,
  },
  {
    key: "BACKUP_SECRET_ACCESS_KEY",
    group: "Backups",
    label: "Secret key",
    description: "Secreto de acceso al bucket.",
    placeholder: "secret-key",
    secret: true,
    restartRequired: true,
  },
  {
    key: "BACKUP_PREFIX",
    group: "Backups",
    label: "Prefijo",
    description: "Carpeta/prefijo remoto para este cliente.",
    placeholder: "clientes/cremeria-rincon",
    restartRequired: true,
  },
  {
    key: "BACKUP_RETENTION_DAILY",
    group: "Backups",
    label: "Retencion diaria",
    description: "Cantidad de respaldos diarios a conservar.",
    placeholder: "14",
    restartRequired: true,
  },
  {
    key: "BACKUP_RETENTION_WEEKLY",
    group: "Backups",
    label: "Retencion semanal",
    description: "Cantidad de respaldos semanales a conservar.",
    placeholder: "8",
    restartRequired: true,
  },
  {
    key: "BACKUP_RETENTION_MONTHLY",
    group: "Backups",
    label: "Retencion mensual",
    description: "Cantidad de respaldos mensuales a conservar.",
    placeholder: "12",
    restartRequired: true,
  },
  {
    key: "BACKUP_NOTIFY_TO",
    group: "Backups",
    label: "Avisos backup",
    description: "Correos separados por comas para avisos de respaldo.",
    placeholder: "owner@cliente.com",
    restartRequired: true,
  },
  {
    key: "BACKUP_SYNC_REPORT_STALE_HOURS",
    group: "Backups",
    label: "Horas stale backup",
    description: "Horas sin reporte antes de marcar respaldo atrasado.",
    placeholder: "36",
    restartRequired: true,
  },
  {
    key: "BACKUP_LOCAL_STAGING_KEEP",
    group: "Backups",
    label: "Staging local",
    description: "Cantidad de archivos temporales locales a conservar.",
    placeholder: "2",
    restartRequired: true,
  },
  {
    key: "RESEND_API_KEY",
    group: "Correo",
    label: "Resend API key",
    description: "Llave privada para envio de correos.",
    placeholder: "re_...",
    secret: true,
    restartRequired: true,
  },
  {
    key: "RESEND_API_URL",
    group: "Correo",
    label: "Resend API URL",
    description: "Endpoint de envio de correos.",
    placeholder: "https://api.resend.com/emails",
    restartRequired: true,
  },
  {
    key: "RAILWAY_COST_SAVER_MODE",
    group: "Compatibilidad",
    label: "Ahorro Railway",
    description: "Activa defaults de bajo consumo: sin polling saliente automatico hacia owner-control salvo configuracion explicita.",
    placeholder: "true",
    type: "select",
    options: ["", "true", "false"],
    restartRequired: true,
  },
  {
    key: "RAILWAY_PUBLIC_DOMAIN",
    group: "Compatibilidad",
    label: "Dominio Railway",
    description: "Compatibilidad con despliegues Railway; ya no debe ser la unica fuente.",
    placeholder: "cliente.up.railway.app",
    restartRequired: true,
  },
  {
    key: "RAILWAY_STATIC_URL",
    group: "Compatibilidad",
    label: "URL estatica Railway",
    description: "Compatibilidad con URL estatica Railway; ya no debe ser la unica fuente.",
    placeholder: "cliente.up.railway.app",
    restartRequired: true,
  },
];
const EDITABLE_RUNTIME_KEYS = new Set(RUNTIME_VARIABLE_DEFINITIONS.map((item) => item.key));

function resolveRuntimeConfigPath(rawPath) {
  const text = String(rawPath || "").trim();
  if (!text) {
    return "";
  }
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(ROOT_DIR, text);
}

function trimRuntimeValue(value) {
  const text = String(value ?? "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseEnvContent(content) {
  return String(content || "")
    .split(/\r?\n/)
    .reduce((result, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return result;
      }
      const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
      const separatorIndex = normalized.indexOf("=");
      if (separatorIndex <= 0) {
        return result;
      }
      const key = normalized.slice(0, separatorIndex).trim();
      if (!VALID_RUNTIME_KEY.test(key)) {
        return result;
      }
      result[key] = trimRuntimeValue(normalized.slice(separatorIndex + 1));
      return result;
    }, {});
}

function normalizeRuntimeValues(input) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input.env && typeof input.env === "object" && !Array.isArray(input.env)
      ? input.env
      : input
    : {};

  return Object.entries(source).reduce((result, [key, value]) => {
    const safeKey = String(key || "").trim();
    if (!VALID_RUNTIME_KEY.test(safeKey) || value == null) {
      return result;
    }
    result[safeKey] = Array.isArray(value) ? value.join(",") : String(value);
    return result;
  }, {});
}

function createRuntimeConfigError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRuntimeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function isLoopbackRuntimeHost(hostname) {
  const host = normalizeRuntimeHostname(hostname);
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "::1"
    || host === "0.0.0.0"
    || host.startsWith("127.");
}

function validateRuntimeUrlValue(key, rawValue, options = {}) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return;
  }

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw createRuntimeConfigError(`${key} no es una URL valida.`);
  }

  const allowedProtocols = new Set(options.allowFileProtocol ? ["https:", "http:", "file:"] : ["https:", "http:"]);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw createRuntimeConfigError(`${key} usa un protocolo no soportado.`);
  }

  if (parsed.protocol === "file:") {
    return;
  }

  if (parsed.protocol !== "https:" && !isLoopbackRuntimeHost(parsed.hostname)) {
    throw createRuntimeConfigError(`${key} debe usar HTTPS fuera de localhost para no exponer secretos o sesiones.`);
  }
}

function parseTrustProxySetting(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) {
    return false;
  }

  const lowerText = text.toLowerCase();
  if (["false", "no", "off"].includes(lowerText)) {
    return false;
  }
  if (lowerText === "true") {
    return true;
  }
  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateTrustProxyValue(key, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return;
  }

  const setting = parseTrustProxySetting(value);
  if (setting === false) {
    return;
  }
  if (setting === true || typeof setting === "number") {
    throw createRuntimeConfigError(`${key} debe listar proxies confiables explicitos; no uses true ni numero de hops.`);
  }

  try {
    proxyaddr.compile(setting);
  } catch (_error) {
    throw createRuntimeConfigError(`${key} no es una lista valida de proxies confiables.`);
  }
}

function validatePemBase64Value(key, rawValue) {
  const compactValue = String(rawValue ?? "").trim().replace(/\s+/g, "");
  if (!compactValue) {
    return;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(compactValue) || compactValue.length % 4 === 1) {
    throw createRuntimeConfigError(`${key} debe ser base64 valido.`);
  }

  const decodedValue = Buffer.from(compactValue, "base64").toString("utf8").trim();
  if (!decodedValue.includes("-----BEGIN")) {
    throw createRuntimeConfigError(`${key} debe contener un PEM codificado en base64.`);
  }
}

function hasConfiguredRuntimeValue(values, key) {
  return Object.prototype.hasOwnProperty.call(values, key)
    && String(values[key] ?? "").trim() !== "";
}

function validateRuntimeConfigCombination(values) {
  const hasHttpsCert = hasConfiguredRuntimeValue(values, "POS_HTTPS_CERT_PATH")
    || hasConfiguredRuntimeValue(values, "POS_HTTPS_CERT_B64");
  const hasHttpsKey = hasConfiguredRuntimeValue(values, "POS_HTTPS_KEY_PATH")
    || hasConfiguredRuntimeValue(values, "POS_HTTPS_KEY_B64");
  const hasHttpsCa = hasConfiguredRuntimeValue(values, "POS_HTTPS_CA_PATH")
    || hasConfiguredRuntimeValue(values, "POS_HTTPS_CA_B64");
  const redirectPortText = String(values.POS_HTTP_REDIRECT_PORT ?? "").trim();
  const redirectPort = redirectPortText ? Number(redirectPortText) : 0;
  const portText = String(values.PORT ?? process.env.PORT ?? "3100").trim();
  const port = portText ? Number(portText) : 3100;

  if ((hasHttpsCert || hasHttpsKey || hasHttpsCa) && !(hasHttpsCert && hasHttpsKey)) {
    throw createRuntimeConfigError("POS_HTTPS_CERT_* y POS_HTTPS_KEY_* deben configurarse juntos para habilitar HTTPS directo.");
  }
  if (redirectPortText) {
    if (!Number.isInteger(redirectPort) || redirectPort < 0) {
      throw createRuntimeConfigError("POS_HTTP_REDIRECT_PORT debe ser un entero igual o mayor a 0.");
    }
    if (redirectPort > 0 && !(hasHttpsCert && hasHttpsKey)) {
      throw createRuntimeConfigError("POS_HTTP_REDIRECT_PORT requiere configurar certificado y llave HTTPS del POS.");
    }
    if (redirectPort > 0 && Number.isInteger(port) && port > 0 && redirectPort === port) {
      throw createRuntimeConfigError("POS_HTTP_REDIRECT_PORT no puede usar el mismo puerto que PORT.");
    }
  }
}

function validateRuntimeValue(key, rawValue) {
  if (PEM_BASE64_RUNTIME_KEYS.has(key)) {
    validatePemBase64Value(key, rawValue);
    return;
  }
  if (TRUST_PROXY_RUNTIME_KEYS.has(key)) {
    validateTrustProxyValue(key, rawValue);
    return;
  }
  if (HTTPS_RUNTIME_URL_KEYS.has(key)) {
    validateRuntimeUrlValue(key, rawValue);
    return;
  }
  if (HTTPS_OR_FILE_RUNTIME_URL_KEYS.has(key)) {
    validateRuntimeUrlValue(key, rawValue, { allowFileProtocol: true });
    return;
  }
  if (HTTPS_RUNTIME_URL_LIST_KEYS.has(key)) {
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => {
        validateRuntimeUrlValue(key, value);
      });
  }
}

function parseRuntimeConfigFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".json") {
    return normalizeRuntimeValues(JSON.parse(content));
  }
  return normalizeRuntimeValues(parseEnvContent(content));
}

function resolveRuntimeConfigWritePath() {
  const explicitPath = resolveRuntimeConfigPath(process.env.POS_CONFIG_PATH);
  if (explicitPath) {
    return explicitPath;
  }

  const existingPath = DEFAULT_RUNTIME_CONFIG_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath || DEFAULT_RUNTIME_CONFIG_CANDIDATES[0];
}

function readRuntimeValuesFromPath(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {};
    }
    return parseRuntimeConfigFile(filePath);
  } catch (_error) {
    return {};
  }
}

function getFreshRuntimeConfigStatus(filePath = "") {
  const targetPath = filePath || resolveRuntimeConfigWritePath();
  const values = readRuntimeValuesFromPath(targetPath);
  const keys = Object.keys(values).sort();
  let stats = null;
  try {
    stats = fs.statSync(targetPath);
  } catch (_error) {
    stats = null;
  }

  return {
    loaded: Boolean(targetPath && fs.existsSync(targetPath)),
    sourcePath: targetPath,
    sourcePathRelative: path.relative(ROOT_DIR, targetPath) || path.basename(targetPath),
    keys,
    secretKeys: keys.filter((key) => SECRET_KEY_PATTERN.test(key)),
    updatedAt: stats ? stats.mtime.toISOString() : null,
    values,
    error: "",
  };
}

function loadRuntimeConfig() {
  const explicitPath = resolveRuntimeConfigPath(process.env.POS_CONFIG_PATH);
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      return {
        loaded: false,
        sourcePath: explicitPath,
        sourcePathRelative: path.relative(ROOT_DIR, explicitPath) || path.basename(explicitPath),
        keys: [],
        secretKeys: [],
        values: {},
        error: "",
      };
    }

    try {
      const values = parseRuntimeConfigFile(explicitPath);
      const keys = Object.keys(values).sort();
      return {
        loaded: true,
        sourcePath: explicitPath,
        sourcePathRelative: path.relative(ROOT_DIR, explicitPath) || path.basename(explicitPath),
        keys,
        secretKeys: keys.filter((key) => SECRET_KEY_PATTERN.test(key)),
        values,
        error: "",
      };
    } catch (error) {
      return {
        loaded: false,
        sourcePath: explicitPath,
        sourcePathRelative: path.relative(ROOT_DIR, explicitPath) || path.basename(explicitPath),
        keys: [],
        secretKeys: [],
        values: {},
        error: error.message || "No pude leer la configuracion local del POS.",
      };
    }
  }

  for (const candidate of DEFAULT_RUNTIME_CONFIG_CANDIDATES) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const values = parseRuntimeConfigFile(candidate);
      const keys = Object.keys(values).sort();
      return {
        loaded: true,
        sourcePath: candidate,
        sourcePathRelative: path.relative(ROOT_DIR, candidate) || path.basename(candidate),
        keys,
        secretKeys: keys.filter((key) => SECRET_KEY_PATTERN.test(key)),
        values,
        error: "",
      };
    } catch (error) {
      return {
        loaded: false,
        sourcePath: candidate,
        sourcePathRelative: path.relative(ROOT_DIR, candidate) || path.basename(candidate),
        keys: [],
        secretKeys: [],
        values: {},
        error: error.message || "No pude leer la configuracion local del POS.",
      };
    }
  }

  return {
    loaded: false,
    sourcePath: "",
    sourcePathRelative: "",
    keys: [],
    secretKeys: [],
    values: {},
    error: "",
  };
}

const runtimeConfig = loadRuntimeConfig();

function readRuntimeConfigValue(key, fallback = "", options = {}) {
  const fileValue = runtimeConfig.values[key];
  const envValue = process.env[key];
  if (options.preferEnv && envValue != null && String(envValue).trim() !== "") {
    return String(envValue);
  }

  if (fileValue != null && String(fileValue).trim() !== "") {
    return String(fileValue);
  }

  if (envValue != null && String(envValue).trim() !== "") {
    return String(envValue);
  }

  return fallback;
}

function readFreshRuntimeConfigValue(key, fallback = "", options = {}) {
  const targetPath = resolveRuntimeConfigWritePath();
  const values = readRuntimeValuesFromPath(targetPath);
  const fileValue = values[key];
  const envValue = process.env[key];
  if (options.preferEnv && envValue != null && String(envValue).trim() !== "") {
    return String(envValue);
  }

  if (fileValue != null && String(fileValue).trim() !== "") {
    return String(fileValue);
  }

  if (envValue != null && String(envValue).trim() !== "") {
    return String(envValue);
  }

  return fallback;
}

function getRuntimeVariableDefinitions() {
  return RUNTIME_VARIABLE_DEFINITIONS.map((definition) => ({
    ...definition,
    secret: Boolean(definition.secret || SECRET_KEY_PATTERN.test(definition.key)),
    options: Array.isArray(definition.options) ? definition.options.slice() : [],
  }));
}

function readCurrentEffectiveRuntimeValue(key) {
  return readRuntimeConfigValue(key, "", {
    preferEnv: PREFER_ENV_RUNTIME_KEYS.has(key),
  });
}

function readFreshEffectiveRuntimeValue(key) {
  return readFreshRuntimeConfigValue(key, "", {
    preferEnv: PREFER_ENV_RUNTIME_KEYS.has(key),
  });
}

function getRuntimeConfigEditorSnapshot() {
  const targetPath = resolveRuntimeConfigWritePath();
  const status = getFreshRuntimeConfigStatus(targetPath);
  const definitions = getRuntimeVariableDefinitions();
  const pendingRestartKeys = definitions
    .filter((definition) => definition.restartRequired)
    .map((definition) => definition.key)
    .filter((key) => readCurrentEffectiveRuntimeValue(key) !== readFreshEffectiveRuntimeValue(key))
    .sort();

  return {
    status: {
      loaded: status.loaded,
      sourcePath: status.sourcePath,
      sourcePathRelative: status.sourcePathRelative,
      keys: status.keys,
      secretKeys: status.secretKeys,
      updatedAt: status.updatedAt,
      restartRequired: pendingRestartKeys.length > 0,
      pendingRestartKeys,
      error: status.error,
    },
    variables: definitions.map((definition) => {
      const fileValue = status.values[definition.key];
      const envValue = process.env[definition.key];
      const hasFileValue = fileValue != null && String(fileValue).trim() !== "";
      const hasEnvValue = envValue != null && String(envValue).trim() !== "";
      const isSecret = Boolean(definition.secret);
      const pendingRestart = definition.restartRequired
        && readCurrentEffectiveRuntimeValue(definition.key) !== readFreshEffectiveRuntimeValue(definition.key);
      return {
        ...definition,
        value: isSecret ? "" : String(hasFileValue ? fileValue : hasEnvValue ? envValue : ""),
        hasStoredValue: hasFileValue,
        hasEnvValue,
        pendingRestart,
        source: hasFileValue ? "owner" : hasEnvValue ? "service" : "empty",
        maskedValue: isSecret && (hasFileValue || hasEnvValue) ? "********" : "",
      };
    }),
  };
}

function serializeEnvValue(value) {
  const text = String(value ?? "");
  if (!text || /[\s#"'=]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function writeRuntimeConfigFile(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sortedValues = Object.keys(values)
    .sort()
    .reduce((result, key) => {
      result[key] = values[key];
      return result;
    }, {});

  if (path.extname(filePath).toLowerCase() === ".json") {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        updatedAt: new Date().toISOString(),
        env: sortedValues,
      }, null, 2)}\n`,
      "utf8",
    );
    return;
  }

  const lines = [
    `# POS runtime config updated at ${new Date().toISOString()}`,
    ...Object.entries(sortedValues).map(([key, value]) => `${key}=${serializeEnvValue(value)}`),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function saveRuntimeConfigValues(payload = {}) {
  const targetPath = resolveRuntimeConfigWritePath();
  const existingValues = readRuntimeValuesFromPath(targetPath);
  const values = payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)
    ? payload.values
    : {};
  const clearKeys = new Set(
    (Array.isArray(payload.clearKeys) ? payload.clearKeys : [])
      .map((key) => String(key || "").trim())
      .filter((key) => EDITABLE_RUNTIME_KEYS.has(key)),
  );
  const incomingKeys = new Set(
    Object.keys(values)
      .map((key) => String(key || "").trim())
      .filter((key) => EDITABLE_RUNTIME_KEYS.has(key)),
  );
  const replaceManagedValues = payload.replaceManagedValues === true;
  const preservePairingKeys = payload.preservePairingKeys !== false;
  const preserveBlankSecrets = payload.preserveBlankSecrets !== false;
  const nextValues = { ...existingValues };
  const updatedKeys = [];
  const clearedKeys = [];

  if (replaceManagedValues) {
    Object.keys(existingValues).forEach((key) => {
      if (!EDITABLE_RUNTIME_KEYS.has(key) || incomingKeys.has(key) || clearKeys.has(key)) {
        return;
      }
      if (preservePairingKeys && PAIRING_RUNTIME_KEYS.has(key)) {
        return;
      }
      delete nextValues[key];
      clearedKeys.push(key);
    });
  }

  Object.entries(values).forEach(([key, value]) => {
    const safeKey = String(key || "").trim();
    if (!EDITABLE_RUNTIME_KEYS.has(safeKey)) {
      return;
    }

    const normalizedValue = String(value ?? "").trim();
    const isSecret = SECRET_KEY_PATTERN.test(safeKey);
    if (!normalizedValue && isSecret && existingValues[safeKey] && preserveBlankSecrets) {
      return;
    }
    if (!normalizedValue) {
      if (Object.prototype.hasOwnProperty.call(nextValues, safeKey)) {
        delete nextValues[safeKey];
        clearedKeys.push(safeKey);
      }
      return;
    }

    validateRuntimeValue(safeKey, normalizedValue);
    if (nextValues[safeKey] === normalizedValue) {
      return;
    }

    nextValues[safeKey] = normalizedValue;
    updatedKeys.push(safeKey);
  });

  clearKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(nextValues, key)) {
      delete nextValues[key];
      clearedKeys.push(key);
    }
  });

  validateRuntimeConfigCombination(nextValues);
  const uniqueUpdatedKeys = [...new Set(updatedKeys)].sort();
  const uniqueClearedKeys = [...new Set(clearedKeys)].sort();
  const changed = uniqueUpdatedKeys.length > 0 || uniqueClearedKeys.length > 0;
  if (changed) {
    writeRuntimeConfigFile(targetPath, nextValues);
  }

  return {
    saved: true,
    changed,
    sourcePath: targetPath,
    sourcePathRelative: path.relative(ROOT_DIR, targetPath) || path.basename(targetPath),
    updatedKeys: uniqueUpdatedKeys,
    clearedKeys: uniqueClearedKeys,
    requiresRestart: changed,
    snapshot: getRuntimeConfigEditorSnapshot(),
    keys: Object.keys(nextValues).sort(),
  };
}

function getRuntimeConfigStatus() {
  return {
    loaded: runtimeConfig.loaded,
    sourcePath: runtimeConfig.sourcePath,
    sourcePathRelative: runtimeConfig.sourcePathRelative,
    keys: runtimeConfig.keys.slice(),
    secretKeys: runtimeConfig.secretKeys.slice(),
    error: runtimeConfig.error,
  };
}

module.exports = {
  getRuntimeConfigEditorSnapshot,
  getRuntimeConfigStatus,
  getRuntimeVariableDefinitions,
  readFreshRuntimeConfigValue,
  readRuntimeConfigValue,
  saveRuntimeConfigValues,
};
