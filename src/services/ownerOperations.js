const path = require("node:path");

const {
  CONTROL_API_URL,
  CONTROL_CLIENT_SECRET,
  CONTROL_CLIENT_SLUG,
  DB_PATH,
  POS_PUBLIC_ORIGIN,
  ROOT_DIR,
  STORE_TIME_ZONE,
} = require("../config");
const { nowIso } = require("../db");
const { getBusinessProfile } = require("../utils/helpers");
const {
  getRuntimeConfigEditorSnapshot,
  saveRuntimeConfigValues,
} = require("../runtimeConfig");
const { getControlPlaneStatus } = require("./controlPlaneStatus");

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function relativeToRoot(value) {
  const relativePath = path.relative(ROOT_DIR, value);
  return relativePath && !relativePath.startsWith("..")
    ? toPosix(relativePath)
    : toPosix(value);
}

function quotePowerShell(value) {
  return String(value || "").replace(/'/g, "''");
}

function buildExamplePublicUrl(slug) {
  const safeSlug = String(slug || "cliente").trim().toLowerCase() || "cliente";
  return `https://${safeSlug}.ejemplo.com`;
}

function getGuideDefaults() {
  const profile = getBusinessProfile();
  const slug = profile.slug || "nuevo-cliente";
  const businessName = profile.businessName || "Nuevo negocio";
  const templateKey = profile.templateKey || "cremeria";
  const publicUrl = POS_PUBLIC_ORIGIN || buildExamplePublicUrl(slug);
  const catalogPath = `catalogos/${templateKey}-base.xlsx`;

  return {
    businessName,
    catalogPath,
    publicUrl,
    slug,
    templateKey,
  };
}

function buildLocalRuntimeConfigExample(defaults) {
  return {
    POS_DB_PATH: "data/merxalia-pos.sqlite",
    POS_WORKBOOK_PATH: defaults.catalogPath,
    POS_TIMEZONE: STORE_TIME_ZONE || "America/Mexico_City",
    POS_PUBLIC_ORIGIN: defaults.publicUrl,
    POS_ALLOWED_ORIGINS: `${defaults.publicUrl},http://localhost:3100`,
    POS_SECURE_COOKIES: defaults.publicUrl.startsWith("https://") ? "true" : "false",
    POS_FORCE_HTTPS: defaults.publicUrl.startsWith("https://") ? "true" : "false",
    POS_HTTPS_CERT_PATH: "certs/pos-cert.pem",
    POS_HTTPS_KEY_PATH: "certs/pos-key.pem",
    POS_HTTP_REDIRECT_PORT: "80",
    POS_TRUST_PROXY: defaults.publicUrl.startsWith("https://") ? "loopback,linklocal,uniquelocal" : "",
    POS_BOOTSTRAP_TOKEN: "<token-largo-para-setup-inicial>",
    CONTROL_API_URL: CONTROL_API_URL || "https://owner-control.ejemplo.com",
    CONTROL_REQUIRE_HTTPS: "true",
    CONTROL_CLIENT_SLUG: CONTROL_CLIENT_SLUG || defaults.slug,
    CONTROL_CLIENT_SECRET: "<api-key-del-owner-control>",
  };
}

function buildOwnerOperationCommands(defaults) {
  const localDbPath = relativeToRoot(DB_PATH || path.join(ROOT_DIR, "data", "merxalia-pos.sqlite"));
  const safeName = defaults.businessName.replace(/"/g, '\\"');
  const safeSlug = defaults.slug || "nuevo-cliente";
  const safeTemplate = defaults.templateKey || "cremeria";
  const safeCatalog = defaults.catalogPath || "catalogos/cremeria-base.xlsx";
  const safePublicUrl = defaults.publicUrl || buildExamplePublicUrl(safeSlug);

  return [
    {
      id: "clone-business",
      label: "Clonar POS nuevo",
      description: "Crea una carpeta hermana con plantilla, catalogo y SQLite limpia para el cliente.",
      command: `npm.cmd run clone:business -- --slug ${safeSlug} --name "${safeName}" --template ${safeTemplate} --catalog ".\\${safeCatalog.replace(/\//g, "\\")}"`,
    },
    {
      id: "provision-client",
      label: "Provisionar cliente",
      description: "Prepara clon, copia catalogo y genera expediente privado de instalacion.",
      command: `npm.cmd run provision:client -- --slug ${safeSlug} --name "${safeName}" --template ${safeTemplate} --catalog ".\\${safeCatalog.replace(/\//g, "\\")}" --public-url ${safePublicUrl}`,
    },
    {
      id: "seed-business",
      label: "Editar plantilla local",
      description: "Reaplica plantilla y catalogo sobre la DB actual; usar solo con backup o entorno nuevo.",
      command: `npm.cmd run seed:business -- --template ${safeTemplate} --name "${safeName}" --slug ${safeSlug} --catalog ".\\${safeCatalog.replace(/\//g, "\\")}"`,
    },
    {
      id: "prepare-railway-db",
      label: "Preparar SQLite",
      description: "Genera copia lista para volumen persistente sin perder identidad ni branding.",
      command: `npm.cmd run prepare:railway-db -- --source ".\\${localDbPath.replace(/\//g, "\\")}" --railway-db-path /data/merxalia-pos.sqlite`,
    },
    {
      id: "validate-client",
      label: "Validar POS publicado",
      description: "Revisa health, bootstrap y rutas clave del cliente desplegado.",
      command: `npm.cmd run validate:client -- --slug ${safeSlug} --url ${safePublicUrl}`,
    },
    {
      id: "owner-control-start",
      label: "Abrir owner-control",
      description: "Levanta el panel central para clientes, pagos, salud y permisos.",
      command: "npm.cmd run owner-control:start",
    },
    {
      id: "runtime-config",
      label: "Usar variables locales",
      description: "Arranca el POS leyendo secretos desde archivo privado en vez de depender del servicio.",
      command: `$env:POS_CONFIG_PATH='${quotePowerShell("data/pos-runtime-config.json")}'; npm.cmd start`,
    },
  ];
}

function getOwnerOperationGuide() {
  const defaults = getGuideDefaults();
  const runtimeConfig = getRuntimeConfigEditorSnapshot();
  const controlPlane = getControlPlaneStatus();

  return {
    generatedAt: nowIso(),
    current: {
      businessName: defaults.businessName,
      slug: defaults.slug,
      templateKey: defaults.templateKey,
      dbPath: relativeToRoot(DB_PATH),
      publicOrigin: POS_PUBLIC_ORIGIN || "",
      controlPlane,
      runtimeConfig: {
        loaded: Boolean(runtimeConfig.status?.loaded),
        sourcePath: runtimeConfig.status?.sourcePathRelative || runtimeConfig.status?.sourcePath || "",
        keys: Array.isArray(runtimeConfig.status?.keys) ? runtimeConfig.status.keys : [],
        secretKeys: Array.isArray(runtimeConfig.status?.secretKeys) ? runtimeConfig.status.secretKeys : [],
        updatedAt: runtimeConfig.status?.updatedAt || null,
        restartRequired: Boolean(runtimeConfig.status?.restartRequired),
        pendingRestartKeys: Array.isArray(runtimeConfig.status?.pendingRestartKeys)
          ? runtimeConfig.status.pendingRestartKeys
          : [],
        error: runtimeConfig.status?.error || "",
      },
    },
    commands: buildOwnerOperationCommands(defaults),
    localRuntimeConfigExample: buildLocalRuntimeConfigExample(defaults),
    runtimeVariables: Array.isArray(runtimeConfig.variables) ? runtimeConfig.variables : [],
  };
}

function saveOwnerRuntimeConfig(payload = {}) {
  const result = saveRuntimeConfigValues(payload);
  return {
    ...result,
    operationGuide: getOwnerOperationGuide(),
  };
}

module.exports = {
  getOwnerOperationGuide,
  saveOwnerRuntimeConfig,
};
