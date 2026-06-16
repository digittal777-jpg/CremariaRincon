const { createHttpError, getBusinessProfile, getEnabledModules, normalizeConfigCode } = require("../utils/helpers");
const { getSetting, setSetting } = require("../utils/settings");
const businessProfileService = require("./businessProfile");

const OWNER_AVAILABLE_MODULES = [
  {
    code: "merchandise_requests",
    label: "Solicitudes de mercaderia",
    description: "Permite que el negocio capture y administre solicitudes internas de compra.",
  },
  {
    code: "weighted_audit",
    label: "Auditoria de pesado",
    description: "Habilita la auditoria para productos vendidos por kilo.",
  },
];

const OWNER_ADMIN_SECTION_DEFINITIONS = [
  {
    code: "daily_flow",
    label: "Flujo diario",
    description: "Reimportar catalogo e importacion rapida.",
  },
  {
    code: "backups",
    label: "Respaldos e instalaciones",
    description: "Exportar Excel, descargar o instalar bases y workbooks.",
  },
  {
    code: "merchandise_requests",
    label: "Solicitudes de mercaderia",
    description: "Vista y aprobacion de solicitudes en admin.",
  },
  {
    code: "weighted_audit",
    label: "Auditoria de pesado",
    description: "Panel para auditar productos por kilo.",
  },
  {
    code: "inventory",
    label: "Inventario y productos",
    description: "Alta manual de productos y control editable de inventario.",
  },
  {
    code: "branches",
    label: "Sucursales",
    description: "Alta y edicion de sucursales.",
  },
  {
    code: "cashiers",
    label: "Cajeros y contrasenas",
    description: "Creacion y administracion de accesos de cajero.",
  },
  {
    code: "business_config",
    label: "Configuracion base",
    description: "Perfil del negocio, modulos, categorias, unidades y atributos.",
  },
  {
    code: "audit_log",
    label: "Bitacora admin",
    description: "Historial de cambios y acciones administrativas.",
  },
  {
    code: "support_tools",
    label: "Diagnostico y soporte",
    description: "Panel dev, metricas y herramientas de soporte.",
  },
  {
    code: "quick_edit",
    label: "Edicion rapida",
    description: "Edicion de ventas, cortes y movimientos.",
  },
];

const DEFAULT_ADMIN_CAPABILITIES = OWNER_ADMIN_SECTION_DEFINITIONS.map((item) => item.code);
const OWNER_ADMIN_CAPABILITIES_KEY = "owner.admin_capabilities";

function listOwnerAvailableModules() {
  return OWNER_AVAILABLE_MODULES.map((item) => ({ ...item }));
}

function listOwnerAdminSectionDefinitions() {
  return OWNER_ADMIN_SECTION_DEFINITIONS.map((item) => ({ ...item }));
}

function normalizeAdminCapabilities(input) {
  const allowed = new Set(OWNER_ADMIN_SECTION_DEFINITIONS.map((item) => item.code));
  const source = Array.isArray(input) ? input : [];
  const next = [...new Set(
    source
      .map((item) => normalizeConfigCode(item, 64))
      .filter((item) => item && allowed.has(item)),
  )];

  return next;
}

function getAdminCapabilities() {
  const raw = getSetting(OWNER_ADMIN_CAPABILITIES_KEY);
  if (!raw) {
    return DEFAULT_ADMIN_CAPABILITIES.slice();
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_ADMIN_CAPABILITIES.slice();
    }

    const normalized = normalizeAdminCapabilities(parsed);
    if (normalized.length === 0 && parsed.length > 0) {
      return DEFAULT_ADMIN_CAPABILITIES.slice();
    }

    return normalized;
  } catch (_error) {
    return DEFAULT_ADMIN_CAPABILITIES.slice();
  }
}

function updateAdminCapabilities(capabilities) {
  const next = normalizeAdminCapabilities(capabilities);
  setSetting(OWNER_ADMIN_CAPABILITIES_KEY, JSON.stringify(next));
  return next;
}

function hasAdminCapability(capabilityCode) {
  return getAdminCapabilities().includes(normalizeConfigCode(capabilityCode, 64));
}

function assertAdminCapability(capabilityCode, errorMessage = "Esta seccion del admin esta bloqueada por el owner.") {
  if (!hasAdminCapability(capabilityCode)) {
    throw createHttpError(errorMessage, 403);
  }
}

function getOwnerConsoleBundle() {
  return {
    businessProfile: getBusinessProfile(),
    enabledModules: getEnabledModules(),
    availableModules: listOwnerAvailableModules(),
    adminCapabilities: getAdminCapabilities(),
    adminSections: listOwnerAdminSectionDefinitions(),
  };
}

function updateOwnerConsoleAccess(payload = {}) {
  const enabledModules = Array.isArray(payload.enabledModules)
    ? businessProfileService.updateEnabledModules(payload.enabledModules)
    : getEnabledModules();
  const adminCapabilities = Array.isArray(payload.adminCapabilities)
    ? updateAdminCapabilities(payload.adminCapabilities)
    : getAdminCapabilities();

  return {
    businessProfile: getBusinessProfile(),
    enabledModules,
    availableModules: listOwnerAvailableModules(),
    adminCapabilities,
    adminSections: listOwnerAdminSectionDefinitions(),
  };
}

module.exports = {
  DEFAULT_ADMIN_CAPABILITIES,
  listOwnerAvailableModules,
  listOwnerAdminSectionDefinitions,
  getAdminCapabilities,
  updateAdminCapabilities,
  hasAdminCapability,
  assertAdminCapability,
  getOwnerConsoleBundle,
  updateOwnerConsoleAccess,
};
