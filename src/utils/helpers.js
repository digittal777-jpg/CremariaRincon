const {
  SALES_PULSE_START_HOUR,
  SALES_PULSE_END_HOUR,
  STORE_BRANCHES: STATIC_STORE_BRANCHES,
  STORE_BRANCH_LABELS: STATIC_STORE_BRANCH_LABELS,
  STORE_NAME,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
} = require("../config");
const { getDb, nowIso } = require("../db");

const db = getDb();

const ALL_BRANCHES = "all";
const LEGACY_CATEGORY_ORDER = ["quesos", "carnes", "piezas", "general"];
const LEGACY_CATEGORY_LABELS = {
  all: "Todo",
  quesos: "Quesos",
  carnes: "Carnes",
  piezas: "Piezas",
  general: "General",
};
const DEFAULT_ENABLED_MODULES = ["weighted_audit", "merchandise_requests"];
const PAYMENT_METHOD_OPTIONS = [
  { value: "Efectivo", label: "Efectivo", kind: "cash" },
  { value: "Tarjeta", label: "Tarjeta", kind: "non_cash" },
  { value: "Transferencia", label: "Transferencia", kind: "non_cash" },
  { value: "Fiado", label: "Fiado", kind: "credit", requiresCustomer: true },
];
const formattersByTimeZone = new Map();
const datePartsFormattersByTimeZone = new Map();

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function buildFallbackBranches() {
  return STATIC_STORE_BRANCHES.map((code, index) => ({
    code,
    name: STATIC_STORE_BRANCH_LABELS[code] || code,
    timezone: STORE_TIME_ZONE,
    active: true,
    sortOrder: index,
  }));
}

function listConfiguredBranches(options = {}) {
  const includeInactive = options.includeInactive === true;

  try {
    const rows = includeInactive
      ? db.prepare(`
          SELECT code, name, timezone, active, sort_order
          FROM branches
          ORDER BY active DESC, sort_order ASC, name COLLATE NOCASE
        `).all()
      : db.prepare(`
          SELECT code, name, timezone, active, sort_order
          FROM branches
          WHERE active = 1
          ORDER BY sort_order ASC, name COLLATE NOCASE
        `).all();

    if (rows.length > 0) {
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        timezone: row.timezone || STORE_TIME_ZONE,
        active: Boolean(row.active),
        sortOrder: Number(row.sort_order || 0),
      }));
    }
  } catch (_error) {
    // Si aun no existe la tabla en alguna ruta temprana, usamos los seeds.
  }

  return buildFallbackBranches().filter((branch) => includeInactive || branch.active);
}

function listBranchCodes(options = {}) {
  return listConfiguredBranches(options).map((branch) => branch.code);
}

function getDefaultBranch() {
  return listConfiguredBranches({ includeInactive: false })[0]?.code
    || listConfiguredBranches({ includeInactive: true })[0]?.code
    || STATIC_STORE_BRANCHES[0];
}

function getBranchRecord(branch, options = {}) {
  const normalizedBranch = normalizeText(branch || "", 24).toLowerCase();
  if (!normalizedBranch || (options.allowAll && normalizedBranch === ALL_BRANCHES)) {
    return null;
  }

  return listConfiguredBranches({ includeInactive: options.includeInactive !== false })
    .find((item) => item.code === normalizedBranch)
    || null;
}

function isKnownBranch(branch, options = {}) {
  if (options.allowAll && normalizeText(branch || "", 24).toLowerCase() === ALL_BRANCHES) {
    return true;
  }

  return Boolean(getBranchRecord(branch, options));
}

function normalizeBranch(branch, options = {}) {
  const normalizedBranch = normalizeText(branch || "", 24).toLowerCase();
  if (options.allowAll && normalizedBranch === ALL_BRANCHES) {
    return ALL_BRANCHES;
  }

  if (isKnownBranch(normalizedBranch, options)) {
    return normalizedBranch;
  }

  if (Object.prototype.hasOwnProperty.call(options, "fallback")) {
    return options.fallback;
  }

  return getDefaultBranch();
}

function getBranchLabel(branch) {
  if (branch === ALL_BRANCHES) {
    return "Todas las sucursales";
  }

  return getBranchRecord(branch, { includeInactive: true })?.name
    || STATIC_STORE_BRANCH_LABELS[branch]
    || branch;
}

function isBranchActive(branch) {
  return Boolean(getBranchRecord(branch, { includeInactive: true })?.active);
}

function assertBranchIsActive(branch, errorMessage = "La sucursal ya no esta disponible para operar.") {
  const record = getBranchRecord(branch, { includeInactive: true });
  if (!record) {
    throw createHttpError("Selecciona una sucursal valida.");
  }
  if (!record.active) {
    throw createHttpError(errorMessage, 409);
  }
  return record;
}

function isAllBranches(branch) {
  return normalizeBranch(branch, { allowAll: true }) === ALL_BRANCHES;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundStock(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 1000) / 1000;
}

function normalizeText(value, maxLength = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizePaymentMethod(value, fallback = "Efectivo") {
  const normalizedValue = normalizeText(value || "", 24);
  if (!normalizedValue) {
    return fallback;
  }

  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === normalizedValue)?.value || fallback;
}

function isCashPaymentMethod(value) {
  return normalizePaymentMethod(value) === "Efectivo";
}

function isCreditPaymentMethod(value) {
  return normalizePaymentMethod(value) === "Fiado";
}

function normalizeReceivedPaymentMethod(value, fallback = "") {
  const normalizedValue = normalizePaymentMethod(value || "", "");
  if (normalizedValue && !isCreditPaymentMethod(normalizedValue)) {
    return normalizedValue;
  }

  const normalizedFallback = normalizePaymentMethod(fallback || "", "");
  if (normalizedFallback && !isCreditPaymentMethod(normalizedFallback)) {
    return normalizedFallback;
  }

  return "";
}

function getSalePendingAmount(total, receivedAmount, paymentMethod) {
  if (!isCreditPaymentMethod(paymentMethod)) {
    return 0;
  }

  return roundMoney(Math.max(roundMoney(total) - Math.max(roundMoney(receivedAmount), 0), 0));
}

function getSaleReceivedPaymentMethod(paymentMethod, receivedPaymentMethod, receivedAmount = 0) {
  if (isCreditPaymentMethod(paymentMethod)) {
    return roundMoney(receivedAmount) > 0
      ? normalizeReceivedPaymentMethod(receivedPaymentMethod, "Efectivo")
      : "";
  }

  return isCashPaymentMethod(paymentMethod)
    ? "Efectivo"
    : normalizeReceivedPaymentMethod(paymentMethod, "Efectivo");
}

function normalizeConfigCode(value, maxLength = 40) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function safeJsonParse(value, fallbackValue) {
  if (typeof value !== "string" || !value.trim()) {
    return fallbackValue;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallbackValue;
  }
}

function getBusinessProfile() {
  try {
    const row = db.prepare(`
      SELECT
        id,
        business_name,
        slug,
        short_name,
        currency_code,
        locale,
        timezone,
        ticket_prefix,
        template_key,
        branding_json,
        visible_texts_json,
        modules_json,
        created_at,
        updated_at
      FROM business_profile
      ORDER BY id ASC
      LIMIT 1
    `).get();

    if (row) {
      return {
        id: Number(row.id),
        businessName: row.business_name || STORE_NAME,
        slug: row.slug || "retail-base-pos",
        shortName: row.short_name || row.business_name || STORE_NAME,
        currencyCode: row.currency_code || "MXN",
        locale: row.locale || "es-MX",
        timezone: row.timezone || STORE_TIME_ZONE,
        ticketPrefix: row.ticket_prefix || "POS",
        templateKey: row.template_key || "base",
        branding: safeJsonParse(row.branding_json, {}),
        visibleTexts: safeJsonParse(row.visible_texts_json, {}),
        modules: safeJsonParse(row.modules_json, DEFAULT_ENABLED_MODULES),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      };
    }
  } catch (_error) {
    // Si la tabla aun no existe, regresamos defaults.
  }

  return {
    id: 1,
    businessName: "Retail Base POS",
    slug: "retail-base-pos",
    shortName: "Retail POS",
    currencyCode: "MXN",
    locale: "es-MX",
    timezone: STORE_TIME_ZONE,
    ticketPrefix: "POS",
    templateKey: "base",
    branding: {
      logo192: "/assets/branding/retail-base-badge.svg",
      logo512: "/assets/branding/retail-base-badge.svg",
      logo: "/assets/branding/retail-base-badge.svg",
    },
    visibleTexts: {},
    modules: [],
    createdAt: null,
    updatedAt: null,
  };
}

function getStoreName() {
  return getBusinessProfile().businessName || STORE_NAME;
}

function getStoreTimeZone() {
  return getBusinessProfile().timezone || STORE_TIME_ZONE;
}

function getFormatterSetForTimeZone(timeZone = getStoreTimeZone()) {
  if (!formattersByTimeZone.has(timeZone)) {
    formattersByTimeZone.set(timeZone, {
      hour: new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        hour12: false,
      }),
    });
  }

  return formattersByTimeZone.get(timeZone);
}

function getDatePartsFormatterForTimeZone(timeZone = getStoreTimeZone()) {
  if (!datePartsFormattersByTimeZone.has(timeZone)) {
    datePartsFormattersByTimeZone.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }));
  }

  return datePartsFormattersByTimeZone.get(timeZone);
}

function getStoreDateParts(value = new Date()) {
  return Object.fromEntries(
    getDatePartsFormatterForTimeZone(getStoreTimeZone())
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function getStoreDateKey(value = new Date()) {
  const parts = getStoreDateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validateStoreDateKey(dateKey, errorMessage = "La fecha debe tener formato YYYY-MM-DD.") {
  const parsed = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw createHttpError(errorMessage, 400);
  }

  const [year, month, day] = parsed.split("-").map((fragment) => Number(fragment));
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (formatStoreDateKeyFromUtcDate(candidate) !== parsed) {
    throw createHttpError(errorMessage, 400);
  }

  return parsed;
}

function createStoreDateFromKey(dateKey) {
  const parsed = validateStoreDateKey(dateKey);
  const [year, month, day] = parsed.split("-").map((fragment) => Number(fragment));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatStoreDateKeyFromUtcDate(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftStoreDateKey(dateKey, daysDelta = 0) {
  const anchor = createStoreDateFromKey(dateKey);
  anchor.setUTCDate(anchor.getUTCDate() + Number(daysDelta || 0));
  return formatStoreDateKeyFromUtcDate(anchor);
}

function getStoreWeekRange(value = new Date()) {
  const anchorDateKey = typeof value === "string"
    ? validateStoreDateKey(value, "La fecha ancla de la semana debe tener formato YYYY-MM-DD.")
    : getStoreDateKey(value);
  const anchorDate = createStoreDateFromKey(anchorDateKey);
  const daysSinceMonday = (anchorDate.getUTCDay() + 6) % 7;
  const startDateKey = shiftStoreDateKey(anchorDateKey, -daysSinceMonday);
  return {
    periodType: "week",
    anchorDateKey,
    startDateKey,
    endDateKey: shiftStoreDateKey(startDateKey, 6),
  };
}

function getStoreMonthRange(value = new Date()) {
  const anchorDateKey = typeof value === "string"
    ? validateStoreDateKey(value, "La fecha ancla del mes debe tener formato YYYY-MM-DD.")
    : getStoreDateKey(value);
  const anchorDate = createStoreDateFromKey(anchorDateKey);
  const year = anchorDate.getUTCFullYear();
  const monthIndex = anchorDate.getUTCMonth();
  const startDateKey = formatStoreDateKeyFromUtcDate(new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0)));
  const endDateKey = formatStoreDateKeyFromUtcDate(new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0)));
  return {
    periodType: "month",
    anchorDateKey,
    startDateKey,
    endDateKey,
  };
}

function getStorePeriodRange(periodType, value = new Date()) {
  const safePeriodType = normalizeText(periodType || "", 24).toLowerCase();
  if (safePeriodType === "week") {
    return getStoreWeekRange(value);
  }
  if (safePeriodType === "month") {
    return getStoreMonthRange(value);
  }
  throw createHttpError("El periodo solicitado no es valido.", 400);
}

function isStoreDateKeyInRange(dateKey, startDateKey, endDateKey) {
  const safeDateKey = validateStoreDateKey(dateKey);
  const safeStartDateKey = validateStoreDateKey(startDateKey);
  const safeEndDateKey = validateStoreDateKey(endDateKey);
  return safeDateKey >= safeStartDateKey && safeDateKey <= safeEndDateKey;
}

function listStoreDateKeysInRange(startDateKey, endDateKey) {
  const safeStartDateKey = validateStoreDateKey(startDateKey);
  const safeEndDateKey = validateStoreDateKey(endDateKey);
  if (safeStartDateKey > safeEndDateKey) {
    return [];
  }

  const keys = [];
  let cursor = safeStartDateKey;
  while (cursor <= safeEndDateKey) {
    keys.push(cursor);
    cursor = shiftStoreDateKey(cursor, 1);
  }
  return keys;
}

function isSameStoreDay(value, baseDate = new Date()) {
  return getStoreDateKey(value) === getStoreDateKey(baseDate);
}

function getStoreHourLabel(value) {
  return `${getFormatterSetForTimeZone(getStoreTimeZone()).hour.format(new Date(value))}:00`;
}

function buildFallbackCategories() {
  return LEGACY_CATEGORY_ORDER.map((code, index) => ({
    id: index + 1,
    code,
    label: LEGACY_CATEGORY_LABELS[code] || code,
    sortOrder: index,
    active: true,
  }));
}

function buildFallbackUnits() {
  return [
    {
      id: 1,
      code: "kg",
      label: "kg",
      allowDecimals: true,
      step: 0.25,
      active: true,
      sortOrder: 0,
    },
    {
      id: 2,
      code: "pza",
      label: "pza",
      allowDecimals: false,
      step: 1,
      active: true,
      sortOrder: 1,
    },
  ];
}

function listProductCategories(options = {}) {
  const includeInactive = options.includeInactive === true;

  try {
    const rows = includeInactive
      ? db.prepare(`
          SELECT id, code, label, sort_order, active, created_at, updated_at
          FROM product_categories
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all()
      : db.prepare(`
          SELECT id, code, label, sort_order, active, created_at, updated_at
          FROM product_categories
          WHERE active = 1
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all();

    if (rows.length > 0) {
      return rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        label: row.label,
        sortOrder: Number(row.sort_order || 0),
        active: Boolean(row.active),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      }));
    }
  } catch (_error) {
    // fallback legacy
  }

  return buildFallbackCategories().filter((category) => includeInactive || category.active);
}

function getProductCategoryRecord(value, options = {}) {
  const includeInactive = options.includeInactive === true;
  const categories = listProductCategories({ includeInactive });
  const numericValue = Number(value);
  const normalizedText = normalizeText(value || "", 64).toLowerCase();

  if (Number.isInteger(numericValue) && numericValue > 0) {
    return categories.find((category) => category.id === numericValue) || null;
  }

  if (!normalizedText) {
    return null;
  }

  return categories.find((category) =>
    category.code === normalizedText
    || normalizeText(category.label || "", 64).toLowerCase() === normalizedText
  ) || null;
}

function listMeasurementUnits(options = {}) {
  const includeInactive = options.includeInactive === true;

  try {
    const rows = includeInactive
      ? db.prepare(`
          SELECT id, code, label, allow_decimals, step, sort_order, active, created_at, updated_at
          FROM measurement_units
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all()
      : db.prepare(`
          SELECT id, code, label, allow_decimals, step, sort_order, active, created_at, updated_at
          FROM measurement_units
          WHERE active = 1
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all();

    if (rows.length > 0) {
      return rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        label: row.label,
        allowDecimals: Boolean(row.allow_decimals),
        step: Number(row.step || (row.code === "pza" ? 1 : 0.25)),
        sortOrder: Number(row.sort_order || 0),
        active: Boolean(row.active),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      }));
    }
  } catch (_error) {
    // fallback legacy
  }

  return buildFallbackUnits().filter((unit) => includeInactive || unit.active);
}

function getMeasurementUnitRecord(value, options = {}) {
  const includeInactive = options.includeInactive === true;
  const units = listMeasurementUnits({ includeInactive });
  const numericValue = Number(value);
  const normalizedText = normalizeText(value || "", 64).toLowerCase();

  if (Number.isInteger(numericValue) && numericValue > 0) {
    return units.find((unit) => unit.id === numericValue) || null;
  }

  if (!normalizedText) {
    return null;
  }

  return units.find((unit) =>
    unit.code === normalizedText
    || normalizeText(unit.label || "", 64).toLowerCase() === normalizedText
  ) || null;
}

function listProductAttributeDefinitions(options = {}) {
  const includeInactive = options.includeInactive === true;

  try {
    const rows = includeInactive
      ? db.prepare(`
          SELECT id, key, label, value_type, options_json, required, sort_order, active, created_at, updated_at
          FROM product_attribute_definitions
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all()
      : db.prepare(`
          SELECT id, key, label, value_type, options_json, required, sort_order, active, created_at, updated_at
          FROM product_attribute_definitions
          WHERE active = 1
          ORDER BY sort_order ASC, label COLLATE NOCASE
        `).all();

    return rows.map((row) => ({
      id: Number(row.id),
      key: row.key,
      label: row.label,
      valueType: row.value_type || "text",
      options: safeJsonParse(row.options_json, []),
      required: Boolean(row.required),
      sortOrder: Number(row.sort_order || 0),
      active: Boolean(row.active),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
  } catch (_error) {
    return [];
  }
}

function getProductAttributeDefinitionRecord(value, options = {}) {
  const includeInactive = options.includeInactive === true;
  const definitions = listProductAttributeDefinitions({ includeInactive });
  const numericValue = Number(value);
  const normalizedText = normalizeText(value || "", 64).toLowerCase();

  if (Number.isInteger(numericValue) && numericValue > 0) {
    return definitions.find((definition) => definition.id === numericValue) || null;
  }

  if (!normalizedText) {
    return null;
  }

  return definitions.find((definition) => definition.key === normalizedText) || null;
}

function coerceAttributeValueByDefinition(rawValue, definition) {
  const normalizedType = definition?.valueType || "text";
  if (normalizedType === "number") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  if (normalizedType === "boolean") {
    if (rawValue === true || rawValue === "true" || rawValue === 1 || rawValue === "1") {
      return true;
    }
    if (rawValue === false || rawValue === "false" || rawValue === 0 || rawValue === "0") {
      return false;
    }
    return null;
  }

  if (rawValue == null) {
    return "";
  }

  return String(rawValue);
}

function getProductAttributesByProductId(productId) {
  const safeProductId = Number(productId);
  if (!Number.isInteger(safeProductId) || safeProductId <= 0) {
    return {};
  }

  try {
    const rows = db.prepare(`
      SELECT
        pav.value_text,
        pav.definition_id,
        pad.key,
        pad.value_type
      FROM product_attribute_values pav
      JOIN product_attribute_definitions pad ON pad.id = pav.definition_id
      WHERE pav.product_id = ?
    `).all(safeProductId);

    return rows.reduce((attributes, row) => {
      attributes[row.key] = coerceAttributeValueByDefinition(row.value_text, {
        valueType: row.value_type,
      });
      return attributes;
    }, {});
  } catch (_error) {
    return {};
  }
}

function getEnabledModules() {
  const profile = getBusinessProfile();
  const modules = Array.isArray(profile.modules) ? profile.modules : DEFAULT_ENABLED_MODULES;
  return [...new Set(
    modules
      .map((moduleCode) => normalizeConfigCode(moduleCode, 40))
      .filter(Boolean),
  )];
}

function isModuleEnabled(moduleCode) {
  return getEnabledModules().includes(normalizeConfigCode(moduleCode, 40));
}

function assertModuleEnabled(moduleCode, errorMessage = "Este modulo no esta habilitado para este negocio.") {
  if (!isModuleEnabled(moduleCode)) {
    throw createHttpError(errorMessage, 404);
  }
}

function getStockStatus(stock, minStock, stockInitialized) {
  if (!stockInitialized) {
    return "capture";
  }

  if (stock <= 0) {
    return "empty";
  }

  if (stock <= minStock) {
    return "low";
  }

  return "ok";
}

function mapProduct(row) {
  const categoryRecord = getProductCategoryRecord(row.category_id || row.category_code || row.category, {
    includeInactive: true,
  });
  const unitRecord = getMeasurementUnitRecord(row.unit_id || row.unit_code || row.unit, {
    includeInactive: true,
  });
  const stock = roundStock(row.stock);
  const minStock = roundStock(row.min_stock);
  const allowDecimals = row.unit_allow_decimals === undefined
    ? (unitRecord ? unitRecord.allowDecimals : row.unit !== "pza")
    : Boolean(row.unit_allow_decimals);
  const unitStep = row.unit_step == null
    ? (unitRecord?.step || (allowDecimals ? 0.25 : 1))
    : Number(row.unit_step);
  const attributes = row.attributes && typeof row.attributes === "object"
    ? row.attributes
    : getProductAttributesByProductId(row.id);

  return {
    id: row.id,
    name: row.name,
    price: roundMoney(row.price),
    cost: roundMoney(row.cost || 0),
    categoryId: categoryRecord?.id || row.category_id || null,
    category: categoryRecord?.code || row.category_code || row.category || "general",
    categoryLabel: categoryRecord?.label || LEGACY_CATEGORY_LABELS[row.category] || "General",
    categorySortOrder: Number(categoryRecord?.sortOrder || row.category_sort_order || 0),
    unitId: unitRecord?.id || row.unit_id || null,
    unit: unitRecord?.code || row.unit_code || row.unit || "pza",
    unitLabel: unitRecord?.label || row.unit || "pza",
    unitStep: Number.isFinite(unitStep) && unitStep > 0 ? unitStep : 0.25,
    allowDecimals,
    typeCode: row.type_code || null,
    sku: row.sku || "",
    barcode: row.barcode || "",
    brand: row.brand || "",
    supplierName: row.supplier_name || "",
    packSize: row.pack_size == null ? null : roundStock(row.pack_size),
    stock,
    minStock,
    stockInitialized: Boolean(row.stock_initialized),
    active: Boolean(row.active),
    displayOrder: row.display_order,
    branch: row.branch || getDefaultBranch(),
    attributes,
    status: getStockStatus(stock, minStock, row.stock_initialized),
  };
}

function buildTicketPrefix(date = new Date()) {
  const parts = getStoreDateParts(date);
  const rawPrefix = normalizeText(getBusinessProfile().ticketPrefix || "POS", 12)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  const prefix = rawPrefix || "POS";
  return `${prefix}-${parts.year}${parts.month}${parts.day}`;
}

function getRegisterEventTypeLabel(eventType) {
  if (eventType === "start") {
    return "Inicio de caja";
  }

  if (eventType === "quick_cut") {
    return "Corte rapido";
  }

  if (eventType === "final_cut") {
    return "Corte final";
  }

  return "Movimiento de caja";
}

function getInventoryMovementTypeLabel(movementType) {
  if (movementType === "sale") {
    return "Venta";
  }

  if (movementType === "initial") {
    return "Inventario inicial";
  }

  if (movementType === "supplier" || movementType === "inventory_in") {
    return "Entrada proveedor";
  }

  if (movementType === "supplier_out" || movementType === "inventory_out") {
    return "Salida proveedor";
  }

  if (movementType === "adjustment") {
    return "Ajuste manual";
  }

  return "Movimiento";
}

const STORE_BRANCHES = new Proxy([], {
  get(_target, property) {
    const codes = listBranchCodes({ includeInactive: true });
    if (property === Symbol.iterator) {
      return codes[Symbol.iterator].bind(codes);
    }
    const value = codes[property];
    return typeof value === "function" ? value.bind(codes) : value;
  },
  ownKeys() {
    return Reflect.ownKeys(listBranchCodes({ includeInactive: true }));
  },
  getOwnPropertyDescriptor(_target, property) {
    const codes = listBranchCodes({ includeInactive: true });
    const descriptor = Object.getOwnPropertyDescriptor(codes, property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

module.exports = {
  ALL_BRANCHES,
  CATEGORY_LABELS: LEGACY_CATEGORY_LABELS,
  CATEGORY_ORDER: ["all", ...LEGACY_CATEGORY_ORDER],
  DEFAULT_ENABLED_MODULES,
  LEGACY_CATEGORY_LABELS,
  LEGACY_CATEGORY_ORDER,
  SALES_PULSE_END_HOUR,
  SALES_PULSE_START_HOUR,
  STORE_BRANCHES,
  STORE_BRANCH_LABELS: STATIC_STORE_BRANCH_LABELS,
  STORE_NAME,
  PAYMENT_METHOD_OPTIONS,
  STORE_SHIFTS,
  STORE_TIME_ZONE,
  assertBranchIsActive,
  assertModuleEnabled,
  buildTicketPrefix,
  coerceAttributeValueByDefinition,
  createHttpError,
  getBranchLabel,
  getBranchRecord,
  getBusinessProfile,
  getDefaultBranch,
  getEnabledModules,
  getInventoryMovementTypeLabel,
  getMeasurementUnitRecord,
  getProductAttributeDefinitionRecord,
  getProductAttributesByProductId,
  getProductCategoryRecord,
  getRegisterEventTypeLabel,
  getSetting,
  getStockStatus,
  getStoreDateKey,
  getStoreMonthRange,
  getStoreDateParts,
  getStorePeriodRange,
  getStoreWeekRange,
  getStoreHourLabel,
  getStoreName,
  getStoreTimeZone,
  isStoreDateKeyInRange,
  isBranchActive,
  isKnownBranch,
  isAllBranches,
  isCashPaymentMethod,
  isCreditPaymentMethod,
  isModuleEnabled,
  isSameStoreDay,
  listBranchCodes,
  listConfiguredBranches,
  listMeasurementUnits,
  listProductAttributeDefinitions,
  listProductCategories,
  mapProduct,
  normalizeBranch,
  normalizeConfigCode,
  normalizePaymentMethod,
  normalizeReceivedPaymentMethod,
  normalizeText,
  nowIso,
  roundMoney,
  roundStock,
  safeJsonParse,
  shiftStoreDateKey,
  createStoreDateFromKey,
  listStoreDateKeysInRange,
  getSalePendingAmount,
  getSaleReceivedPaymentMethod,
  toNumber,
  validateStoreDateKey,
};
