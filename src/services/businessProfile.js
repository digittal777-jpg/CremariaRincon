const fs = require("node:fs");
const path = require("node:path");

const { ROOT_DIR } = require("../config");
const { getDb, nowIso } = require("../db");
const {
  DEFAULT_ENABLED_MODULES,
  assertBranchIsActive,
  coerceAttributeValueByDefinition,
  createHttpError,
  getBusinessProfile,
  getEnabledModules,
  getMeasurementUnitRecord,
  getProductAttributeDefinitionRecord,
  getProductCategoryRecord,
  listConfiguredBranches,
  listMeasurementUnits,
  listProductAttributeDefinitions,
  listProductCategories,
  normalizeConfigCode,
  normalizeText,
  roundMoney,
  roundStock,
  safeJsonParse,
} = require("../utils/helpers");

const db = getDb();
const TEMPLATE_DIR = path.join(ROOT_DIR, "business-templates");

function getAdminConfigBundle() {
  return {
    settings: require("./settings").listSettings(),
    businessProfile: getBusinessProfile(),
    categories: listProductCategories({ includeInactive: true }),
    units: listMeasurementUnits({ includeInactive: true }),
    productAttributeDefinitions: listProductAttributeDefinitions({ includeInactive: true }),
    enabledModules: getEnabledModules(),
    adminCapabilities: require("./ownerConsole").getAdminCapabilities(),
  };
}

function updateBusinessProfile(payload = {}) {
  const current = getBusinessProfile();
  const nextProfile = {
    businessName: normalizeText(payload.businessName ?? payload.name ?? current.businessName, 120) || current.businessName,
    slug: normalizeConfigCode(payload.slug ?? current.slug, 64) || current.slug,
    shortName: normalizeText(payload.shortName ?? current.shortName ?? current.businessName, 60) || current.shortName,
    currencyCode: normalizeText(payload.currencyCode ?? current.currencyCode, 16).toUpperCase() || current.currencyCode,
    locale: normalizeText(payload.locale ?? current.locale, 16) || current.locale,
    timezone: normalizeText(payload.timezone ?? current.timezone, 64) || current.timezone,
    ticketPrefix: normalizeText(payload.ticketPrefix ?? current.ticketPrefix, 12).toUpperCase() || current.ticketPrefix,
    templateKey: normalizeConfigCode(payload.templateKey ?? current.templateKey, 40) || current.templateKey,
    branding: payload.branding && typeof payload.branding === "object" ? payload.branding : current.branding,
    visibleTexts: payload.visibleTexts && typeof payload.visibleTexts === "object" ? payload.visibleTexts : current.visibleTexts,
    modules: Array.isArray(payload.modules)
      ? [...new Set(payload.modules.map((item) => normalizeConfigCode(item, 40)).filter(Boolean))]
      : getEnabledModules(),
  };

  const now = nowIso();
  db.prepare(`
    INSERT INTO business_profile (
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
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      business_name = excluded.business_name,
      slug = excluded.slug,
      short_name = excluded.short_name,
      currency_code = excluded.currency_code,
      locale = excluded.locale,
      timezone = excluded.timezone,
      ticket_prefix = excluded.ticket_prefix,
      template_key = excluded.template_key,
      branding_json = excluded.branding_json,
      visible_texts_json = excluded.visible_texts_json,
      modules_json = excluded.modules_json,
      updated_at = excluded.updated_at
  `).run(
    nextProfile.businessName,
    nextProfile.slug,
    nextProfile.shortName,
    nextProfile.currencyCode,
    nextProfile.locale,
    nextProfile.timezone,
    nextProfile.ticketPrefix,
    nextProfile.templateKey,
    JSON.stringify(nextProfile.branding || {}),
    JSON.stringify(nextProfile.visibleTexts || {}),
    JSON.stringify(nextProfile.modules || DEFAULT_ENABLED_MODULES),
    current.createdAt || now,
    now,
  );

  return getBusinessProfile();
}

function normalizeSortOrder(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function createProductCategory(payload = {}) {
  const code = normalizeConfigCode(payload.code || payload.label, 40);
  const label = normalizeText(payload.label || payload.code, 80);
  const sortOrder = normalizeSortOrder(payload.sortOrder, listProductCategories({ includeInactive: true }).length);
  const active = payload.active === undefined ? true : Boolean(payload.active);

  if (!code || !label) {
    throw createHttpError("Captura codigo y etiqueta de la categoria.");
  }
  if (getPersistedCategorySeedRecord(code)) {
    throw createHttpError("Ya existe una categoria con ese codigo.", 409);
  }

  const now = nowIso();
  db.prepare(`
    INSERT INTO product_categories (code, label, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, label, sortOrder, active ? 1 : 0, now, now);

  return getProductCategoryRecord(code, { includeInactive: true });
}

function updateProductCategory(categoryId, payload = {}) {
  const current = getPersistedCategorySeedRecord(categoryId);
  if (!current) {
    throw createHttpError("La categoria no existe.", 404);
  }

  const nextCode = normalizeConfigCode(payload.code ?? current.code, 40) || current.code;
  const nextLabel = normalizeText(payload.label ?? current.label, 80) || current.label;
  const nextSortOrder = payload.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(payload.sortOrder, current.sortOrder);
  const nextActive = payload.active === undefined ? current.active : Boolean(payload.active);

  const duplicate = getPersistedCategorySeedRecord(nextCode);
  if (duplicate && duplicate.id !== current.id) {
    throw createHttpError("Ya existe otra categoria con ese codigo.", 409);
  }

  db.prepare(`
    UPDATE product_categories
    SET code = ?, label = ?, sort_order = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(nextCode, nextLabel, nextSortOrder, nextActive ? 1 : 0, nowIso(), current.id);

  db.prepare(`
    UPDATE products
    SET category = ?, updated_at = ?
    WHERE category_id = ?
  `).run(nextCode, nowIso(), current.id);

  return getProductCategoryRecord(current.id, { includeInactive: true });
}

function deactivateProductCategory(categoryId) {
  const current = getPersistedCategorySeedRecord(categoryId);
  if (!current) {
    throw createHttpError("La categoria no existe.", 404);
  }
  db.prepare(`
    UPDATE product_categories
    SET active = 0, updated_at = ?
    WHERE id = ?
  `).run(nowIso(), current.id);
  return getProductCategoryRecord(current.id, { includeInactive: true });
}

function createMeasurementUnit(payload = {}) {
  const code = normalizeConfigCode(payload.code || payload.label, 32);
  const label = normalizeText(payload.label || payload.code, 32);
  const allowDecimals = payload.allowDecimals === undefined ? code !== "pza" : Boolean(payload.allowDecimals);
  const step = Number(payload.step ?? (allowDecimals ? 0.25 : 1));
  const sortOrder = normalizeSortOrder(payload.sortOrder, listMeasurementUnits({ includeInactive: true }).length);
  const active = payload.active === undefined ? true : Boolean(payload.active);

  if (!code || !label) {
    throw createHttpError("Captura codigo y etiqueta de la unidad.");
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw createHttpError("El paso de captura de la unidad no es valido.");
  }
  if (getPersistedUnitSeedRecord(code)) {
    throw createHttpError("Ya existe una unidad con ese codigo.", 409);
  }

  const now = nowIso();
  db.prepare(`
    INSERT INTO measurement_units (code, label, allow_decimals, step, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, label, allowDecimals ? 1 : 0, step, sortOrder, active ? 1 : 0, now, now);

  return getMeasurementUnitRecord(code, { includeInactive: true });
}

function updateMeasurementUnit(unitId, payload = {}) {
  const current = getPersistedUnitSeedRecord(unitId);
  if (!current) {
    throw createHttpError("La unidad no existe.", 404);
  }

  const nextCode = normalizeConfigCode(payload.code ?? current.code, 32) || current.code;
  const nextLabel = normalizeText(payload.label ?? current.label, 32) || current.label;
  const nextAllowDecimals = payload.allowDecimals === undefined ? current.allowDecimals : Boolean(payload.allowDecimals);
  const nextStep = payload.step === undefined ? current.step : Number(payload.step);
  const nextSortOrder = payload.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(payload.sortOrder, current.sortOrder);
  const nextActive = payload.active === undefined ? current.active : Boolean(payload.active);

  if (!Number.isFinite(nextStep) || nextStep <= 0) {
    throw createHttpError("El paso de captura de la unidad no es valido.");
  }

  const duplicate = getPersistedUnitSeedRecord(nextCode);
  if (duplicate && duplicate.id !== current.id) {
    throw createHttpError("Ya existe otra unidad con ese codigo.", 409);
  }

  const now = nowIso();
  db.prepare(`
    UPDATE measurement_units
    SET code = ?, label = ?, allow_decimals = ?, step = ?, sort_order = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(nextCode, nextLabel, nextAllowDecimals ? 1 : 0, nextStep, nextSortOrder, nextActive ? 1 : 0, now, current.id);

  db.prepare(`
    UPDATE products
    SET unit = ?, updated_at = ?
    WHERE unit_id = ?
  `).run(nextCode, now, current.id);

  return getMeasurementUnitRecord(current.id, { includeInactive: true });
}

function deactivateMeasurementUnit(unitId) {
  const current = getPersistedUnitSeedRecord(unitId);
  if (!current) {
    throw createHttpError("La unidad no existe.", 404);
  }
  db.prepare(`
    UPDATE measurement_units
    SET active = 0, updated_at = ?
    WHERE id = ?
  `).run(nowIso(), current.id);
  return getMeasurementUnitRecord(current.id, { includeInactive: true });
}

function normalizeDefinitionType(value) {
  const normalizedType = normalizeText(value || "text", 16).toLowerCase();
  return ["text", "number", "boolean", "select"].includes(normalizedType)
    ? normalizedType
    : "text";
}

function createProductAttributeDefinition(payload = {}) {
  const key = normalizeConfigCode(payload.key || payload.label, 48);
  const label = normalizeText(payload.label || payload.key, 80);
  const valueType = normalizeDefinitionType(payload.valueType);
  const options = Array.isArray(payload.options)
    ? payload.options.map((option) => normalizeText(option, 80)).filter(Boolean)
    : [];
  const required = Boolean(payload.required);
  const sortOrder = normalizeSortOrder(payload.sortOrder, listProductAttributeDefinitions({ includeInactive: true }).length);
  const active = payload.active === undefined ? true : Boolean(payload.active);

  if (!key || !label) {
    throw createHttpError("Captura clave y etiqueta del atributo.");
  }
  if (valueType === "select" && options.length === 0) {
    throw createHttpError("Los atributos tipo select requieren opciones.", 400);
  }
  if (getProductAttributeDefinitionRecord(key, { includeInactive: true })) {
    throw createHttpError("Ya existe un atributo con esa clave.", 409);
  }

  const now = nowIso();
  db.prepare(`
    INSERT INTO product_attribute_definitions (
      key,
      label,
      value_type,
      options_json,
      required,
      sort_order,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, label, valueType, JSON.stringify(options), required ? 1 : 0, sortOrder, active ? 1 : 0, now, now);

  return getProductAttributeDefinitionRecord(key, { includeInactive: true });
}

function updateProductAttributeDefinition(definitionId, payload = {}) {
  const current = getProductAttributeDefinitionRecord(definitionId, { includeInactive: true });
  if (!current) {
    throw createHttpError("El atributo no existe.", 404);
  }

  const nextKey = normalizeConfigCode(payload.key ?? current.key, 48) || current.key;
  const nextLabel = normalizeText(payload.label ?? current.label, 80) || current.label;
  const nextType = payload.valueType === undefined ? current.valueType : normalizeDefinitionType(payload.valueType);
  const nextOptions = payload.options === undefined
    ? current.options
    : Array.isArray(payload.options)
      ? payload.options.map((option) => normalizeText(option, 80)).filter(Boolean)
      : [];
  const nextRequired = payload.required === undefined ? current.required : Boolean(payload.required);
  const nextSortOrder = payload.sortOrder === undefined ? current.sortOrder : normalizeSortOrder(payload.sortOrder, current.sortOrder);
  const nextActive = payload.active === undefined ? current.active : Boolean(payload.active);

  const duplicate = getProductAttributeDefinitionRecord(nextKey, { includeInactive: true });
  if (duplicate && duplicate.id !== current.id) {
    throw createHttpError("Ya existe otro atributo con esa clave.", 409);
  }
  if (nextType === "select" && nextOptions.length === 0) {
    throw createHttpError("Los atributos tipo select requieren opciones.", 400);
  }

  db.prepare(`
    UPDATE product_attribute_definitions
    SET key = ?, label = ?, value_type = ?, options_json = ?, required = ?, sort_order = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextKey,
    nextLabel,
    nextType,
    JSON.stringify(nextOptions),
    nextRequired ? 1 : 0,
    nextSortOrder,
    nextActive ? 1 : 0,
    nowIso(),
    current.id,
  );

  return getProductAttributeDefinitionRecord(current.id, { includeInactive: true });
}

function deactivateProductAttributeDefinition(definitionId) {
  const current = getProductAttributeDefinitionRecord(definitionId, { includeInactive: true });
  if (!current) {
    throw createHttpError("El atributo no existe.", 404);
  }
  db.prepare(`
    UPDATE product_attribute_definitions
    SET active = 0, updated_at = ?
    WHERE id = ?
  `).run(nowIso(), current.id);
  return getProductAttributeDefinitionRecord(current.id, { includeInactive: true });
}

function updateEnabledModules(moduleCodes = []) {
  const nextModules = [...new Set(
    (Array.isArray(moduleCodes) ? moduleCodes : [])
      .map((moduleCode) => normalizeConfigCode(moduleCode, 40))
      .filter(Boolean),
  )];

  return updateBusinessProfile({ modules: nextModules }).modules;
}

function clearOperationalDataTables(options = {}) {
  const keepAdminAuditLogs = options.keepAdminAuditLogs === true;
  const preserveAdminCredentials = options.preserveAdminCredentials === true;
  db.prepare("DELETE FROM sale_items").run();
  db.prepare("DELETE FROM sales").run();
  db.prepare("DELETE FROM inventory_movements").run();
  db.prepare("DELETE FROM register_events").run();
  db.prepare("DELETE FROM weighted_audit_items").run();
  db.prepare("DELETE FROM weighted_audit_sessions").run();
  db.prepare("DELETE FROM merchandise_request_items").run();
  db.prepare("DELETE FROM merchandise_requests").run();
  db.prepare("DELETE FROM cashier_sessions").run();
  db.prepare("DELETE FROM cashiers").run();
  db.prepare("DELETE FROM admin_sessions").run();
  db.prepare("DELETE FROM owner_sessions").run();
  if (!keepAdminAuditLogs) {
    db.prepare("DELETE FROM admin_audit_logs").run();
  }
  db.prepare("DELETE FROM branches").run();
  db.prepare("DELETE FROM product_attribute_values").run();
  db.prepare("DELETE FROM products").run();
  if (!preserveAdminCredentials) {
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'admin.%'").run();
  }
}

function resetOperationalData(options = {}) {
  const transaction = db.transaction(() => {
    clearOperationalDataTables(options);
  });
  transaction();
}

function getPersistedCategorySeedRecord(value) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return db.prepare(`
      SELECT id, code, label, sort_order, active
      FROM product_categories
      WHERE id = ?
    `).get(numericValue) || null;
  }

  const normalizedValue = normalizeConfigCode(value, 40) || normalizeText(value || "", 80).toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  return db.prepare(`
    SELECT id, code, label, sort_order, active
    FROM product_categories
    WHERE code = ?
       OR lower(label) = ?
    LIMIT 1
  `).get(normalizedValue, normalizedValue) || null;
}

function upsertCategorySeed(category, sortOrderFallback = 0) {
  const existing = getPersistedCategorySeedRecord(category.id || category.code || category.label);
  if (existing) {
    updateProductCategory(existing.id, {
      code: category.code || existing.code,
      label: category.label || existing.label,
      sortOrder: category.sortOrder ?? sortOrderFallback,
      active: category.active !== false,
    });
    return getProductCategoryRecord(existing.id, { includeInactive: true });
  }
  return createProductCategory({
    code: category.code || category.label,
    label: category.label || category.code,
    sortOrder: category.sortOrder ?? sortOrderFallback,
    active: category.active !== false,
  });
}

function getPersistedUnitSeedRecord(value) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return db.prepare(`
      SELECT id, code, label, allow_decimals, step, sort_order, active
      FROM measurement_units
      WHERE id = ?
    `).get(numericValue) || null;
  }

  const normalizedValue = normalizeConfigCode(value, 32) || normalizeText(value || "", 32).toLowerCase();
  if (!normalizedValue) {
    return null;
  }

  return db.prepare(`
    SELECT id, code, label, allow_decimals, step, sort_order, active
    FROM measurement_units
    WHERE code = ?
       OR lower(label) = ?
    LIMIT 1
  `).get(normalizedValue, normalizedValue) || null;
}

function upsertUnitSeed(unit, sortOrderFallback = 0) {
  const existing = getPersistedUnitSeedRecord(unit.id || unit.code || unit.label);
  if (existing) {
    updateMeasurementUnit(existing.id, {
      code: unit.code || existing.code,
      label: unit.label || existing.label,
      allowDecimals: unit.allowDecimals ?? existing.allowDecimals,
      step: unit.step ?? existing.step,
      sortOrder: unit.sortOrder ?? sortOrderFallback,
      active: unit.active !== false,
    });
    return getMeasurementUnitRecord(existing.id, { includeInactive: true });
  }
  return createMeasurementUnit({
    code: unit.code || unit.label,
    label: unit.label || unit.code,
    allowDecimals: unit.allowDecimals,
    step: unit.step,
    sortOrder: unit.sortOrder ?? sortOrderFallback,
    active: unit.active !== false,
  });
}

function upsertAttributeSeed(definition, sortOrderFallback = 0) {
  const existing = getProductAttributeDefinitionRecord(definition.id || definition.key || definition.label, {
    includeInactive: true,
  });
  if (existing) {
    updateProductAttributeDefinition(existing.id, {
      key: definition.key || existing.key,
      label: definition.label || existing.label,
      valueType: definition.valueType || existing.valueType,
      options: definition.options || existing.options,
      required: definition.required,
      sortOrder: definition.sortOrder ?? sortOrderFallback,
      active: definition.active !== false,
    });
    return getProductAttributeDefinitionRecord(existing.id, { includeInactive: true });
  }

  return createProductAttributeDefinition({
    key: definition.key || definition.label,
    label: definition.label || definition.key,
    valueType: definition.valueType || "text",
    options: definition.options || [],
    required: definition.required === true,
    sortOrder: definition.sortOrder ?? sortOrderFallback,
    active: definition.active !== false,
  });
}

function seedBranchesFromTemplate(branches = []) {
  const { createBranch, getBranchByCode, updateBranch } = require("./branches");
  const expectedBranchCodes = new Set();

  branches.forEach((branch, index) => {
    const code = normalizeConfigCode(branch.code || branch.name, 24);
    if (!code) {
      return;
    }

    expectedBranchCodes.add(code);
    const existing = getBranchByCode(code, { includeInactive: true });
    const payload = {
      code,
      name: normalizeText(branch.name || code, 80),
      timezone: normalizeText(branch.timezone || getBusinessProfile().timezone, 64),
      active: branch.active !== false,
      sortOrder: branch.sortOrder ?? index,
      copyProducts: false,
    };

    if (existing) {
      updateBranch(code, payload);
    } else {
      createBranch(payload);
    }
  });

  db.prepare(`
    SELECT code, active
    FROM branches
    ORDER BY sort_order ASC, name COLLATE NOCASE
  `).all().forEach((branch) => {
    if (branches.length > 0 && !expectedBranchCodes.has(branch.code) && branch.active) {
      updateBranch(branch.code, { active: false });
    }
  });
}

function applyBusinessTemplate(template, options = {}) {
  if (!template || typeof template !== "object") {
    throw createHttpError("La plantilla de negocio no es valida.", 400);
  }

  if (options.clearOperationalData !== false) {
    resetOperationalData({ keepAdminAuditLogs: false });
  }

  const profilePayload = {
    businessName: options.businessName || template.businessName || "Nuevo negocio",
    slug: options.slug || template.slug || normalizeConfigCode(options.businessName || template.businessName || "nuevo-negocio", 64),
    shortName: template.shortName || options.businessName || template.businessName || "POS",
    currencyCode: template.currencyCode || "MXN",
    locale: template.locale || "es-MX",
    timezone: template.timezone || "America/Mexico_City",
    ticketPrefix: template.ticketPrefix || "POS",
    templateKey: normalizeConfigCode(template.key || options.templateKey || "custom", 40),
    branding: template.branding || {},
    visibleTexts: template.visibleTexts || {},
    modules: Array.isArray(template.modules) ? template.modules : [],
  };
  db.transaction(() => {
    db.prepare("DELETE FROM business_branding_logo WHERE id = 1").run();
    updateBusinessProfile(profilePayload);
  })();

  if (Array.isArray(template.categories)) {
    db.prepare("DELETE FROM product_categories").run();
    template.categories.forEach((category, index) => {
      upsertCategorySeed(category, index);
    });
  }

  if (Array.isArray(template.units)) {
    db.prepare("DELETE FROM measurement_units").run();
    template.units.forEach((unit, index) => {
      upsertUnitSeed(unit, index);
    });
  }

  if (Array.isArray(template.productAttributes)) {
    db.prepare("DELETE FROM product_attribute_values").run();
    db.prepare("DELETE FROM product_attribute_definitions").run();
    template.productAttributes.forEach((definition, index) => {
      upsertAttributeSeed(definition, index);
    });
  }

  if (Array.isArray(template.branches) && template.branches.length > 0) {
    seedBranchesFromTemplate(template.branches);
  }

  return getAdminConfigBundle();
}

function listBusinessTemplates() {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    return [];
  }

  return fs.readdirSync(TEMPLATE_DIR)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .map((entry) => ({
      key: entry.replace(/\.json$/i, ""),
      path: path.join(TEMPLATE_DIR, entry),
    }));
}

function loadBusinessTemplate(templateKey) {
  const safeKey = normalizeConfigCode(templateKey, 40);
  if (!safeKey) {
    throw createHttpError("La plantilla solicitada no es valida.", 400);
  }

  const templatePath = path.join(TEMPLATE_DIR, `${safeKey}.json`);
  if (!fs.existsSync(templatePath)) {
    throw createHttpError(`No existe la plantilla "${safeKey}".`, 404);
  }

  const rawContents = fs.readFileSync(templatePath, "utf8");
  return {
    key: safeKey,
    ...safeJsonParse(rawContents, {}),
  };
}

function setProductAttributes(productId, attributes = {}) {
  const safeProductId = Number(productId);
  if (!Number.isInteger(safeProductId) || safeProductId <= 0) {
    return;
  }

  const definitions = listProductAttributeDefinitions({ includeInactive: false });
  const definitionMap = new Map(definitions.map((definition) => [definition.key, definition]));
  const entries = Object.entries(attributes || {})
    .filter(([attributeKey]) => definitionMap.has(attributeKey));

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM product_attribute_values WHERE product_id = ?").run(safeProductId);
    const insertValue = db.prepare(`
      INSERT INTO product_attribute_values (product_id, definition_id, value_text, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    entries.forEach(([attributeKey, rawValue]) => {
      const definition = definitionMap.get(attributeKey);
      const coercedValue = coerceAttributeValueByDefinition(rawValue, definition);
      if (definition.required && (coercedValue === null || coercedValue === "")) {
        throw createHttpError(`El atributo ${definition.label} es obligatorio.`, 400);
      }
      if (coercedValue === null || coercedValue === "") {
        return;
      }

      insertValue.run(
        safeProductId,
        definition.id,
        String(coercedValue),
        nowIso(),
      );
    });
  });

  transaction();
}

module.exports = {
  applyBusinessTemplate,
  clearOperationalDataTables,
  createMeasurementUnit,
  createProductAttributeDefinition,
  createProductCategory,
  deactivateMeasurementUnit,
  deactivateProductAttributeDefinition,
  deactivateProductCategory,
  getAdminConfigBundle,
  listBusinessTemplates,
  loadBusinessTemplate,
  resetOperationalData,
  setProductAttributes,
  updateBusinessProfile,
  updateEnabledModules,
  updateMeasurementUnit,
  updateProductAttributeDefinition,
  updateProductCategory,
};
