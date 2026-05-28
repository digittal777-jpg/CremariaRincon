const fs = require("node:fs");
const path = require("node:path");

const { parseWorkbookCatalog } = require("../catalogParser");
const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getBusinessProfile,
  getMeasurementUnitRecord,
  getProductCategoryRecord,
  listConfiguredBranches,
  normalizeText,
  roundMoney,
  roundStock,
} = require("../utils/helpers");
const businessProfileService = require("./businessProfile");

const db = getDb();

function resolveExplicitWorkbookPath(workbookPath) {
  const rawPath = String(workbookPath || "").trim();
  if (!rawPath) {
    return null;
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

async function loadCatalogForTemplateReset(workbookPath) {
  const resolvedPath = resolveExplicitWorkbookPath(workbookPath);
  if (!resolvedPath) {
    throw createHttpError("Captura una ruta valida del Excel para reconstruir el negocio.");
  }

  const catalog = await parseWorkbookCatalog(resolvedPath);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw createHttpError("El Excel no trae productos validos para reconstruir el negocio.");
  }

  return {
    catalog,
    workbookPath: resolvedPath,
  };
}

function resolveTemplateCategoryRecord(product) {
  const categoryRecord = getProductCategoryRecord(
    product.categoryId ?? product.category ?? product.categoryCode,
    { includeInactive: true },
  );
  if (!categoryRecord) {
    throw createHttpError(`La categoria del producto "${product.name}" no existe en la plantilla activa.`);
  }

  return categoryRecord;
}

function resolveTemplateUnitRecord(product) {
  const unitRecord = getMeasurementUnitRecord(
    product.unitId ?? product.unit ?? product.unitCode,
    { includeInactive: true },
  );
  if (!unitRecord) {
    throw createHttpError(`La unidad del producto "${product.name}" no existe en la plantilla activa.`);
  }

  return unitRecord;
}

function normalizeTemplateCatalogProduct(product, displayOrder, branch) {
  const name = normalizeText(product.name || "", 80);
  if (!name) {
    throw createHttpError("El Excel incluye un producto sin nombre valido.");
  }

  const price = roundMoney(product.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw createHttpError(`El producto "${name}" no tiene un precio valido.`);
  }

  const categoryRecord = resolveTemplateCategoryRecord(product);
  const unitRecord = resolveTemplateUnitRecord(product);
  const cost = product.cost == null || product.cost === ""
    ? 0
    : roundMoney(product.cost);
  const stock = roundStock(product.stock || 0);
  const minStock = Math.max(0, roundStock(product.minStock || 0));
  const packSize = product.packSize == null || product.packSize === ""
    ? null
    : roundStock(product.packSize);

  if (!Number.isFinite(cost) || cost < 0) {
    throw createHttpError(`El costo del producto "${name}" no es valido.`);
  }
  if (!Number.isFinite(stock)) {
    throw createHttpError(`La existencia del producto "${name}" no es valida.`);
  }
  if (packSize != null && (!Number.isFinite(packSize) || packSize <= 0)) {
    throw createHttpError(`El tamano de empaque del producto "${name}" no es valido.`);
  }

  return {
    name,
    price,
    cost,
    category: categoryRecord.code,
    unit: unitRecord.code,
    categoryId: categoryRecord.id,
    unitId: unitRecord.id,
    typeCode: normalizeText(product.typeCode || "", 8).toUpperCase() || null,
    sku: normalizeText(product.sku || "", 48) || null,
    barcode: normalizeText(product.barcode || "", 64) || null,
    brand: normalizeText(product.brand || "", 60) || null,
    supplierName: normalizeText(product.supplierName || product.supplier_name || "", 80) || null,
    packSize,
    stock,
    minStock,
    displayOrder,
    branch,
  };
}

function seedCatalogIntoCurrentTemplate(catalog, createdAt = nowIso()) {
  const branchCodes = listConfiguredBranches({ includeInactive: false }).map((branch) => branch.code);
  if (branchCodes.length === 0) {
    throw createHttpError("La plantilla no dejo sucursales configuradas para cargar el catalogo.");
  }

  const insertProduct = db.prepare(`
    INSERT INTO products (
      name,
      price,
      cost,
      category,
      unit,
      category_id,
      unit_id,
      type_code,
      sku,
      barcode,
      brand,
      supplier_name,
      pack_size,
      stock,
      min_stock,
      stock_initialized,
      active,
      display_order,
      branch,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `);

  branchCodes.forEach((branch) => {
    catalog.forEach((product, index) => {
      const normalizedProduct = normalizeTemplateCatalogProduct(
        product,
        Number(product.displayOrder || 0) || index + 1,
        branch,
      );
      insertProduct.run(
        normalizedProduct.name,
        normalizedProduct.price,
        normalizedProduct.cost,
        normalizedProduct.category,
        normalizedProduct.unit,
        normalizedProduct.categoryId,
        normalizedProduct.unitId,
        normalizedProduct.typeCode,
        normalizedProduct.sku,
        normalizedProduct.barcode,
        normalizedProduct.brand,
        normalizedProduct.supplierName,
        normalizedProduct.packSize,
        normalizedProduct.stock,
        normalizedProduct.minStock,
        normalizedProduct.stock > 0 ? 1 : 0,
        normalizedProduct.displayOrder,
        normalizedProduct.branch,
        createdAt,
        createdAt,
      );
    });
  });

  return {
    branchCodes,
    importedCount: catalog.length * branchCodes.length,
  };
}

function insertTemplateProvisionAuditLog({
  actorType = "owner",
  actorName = null,
  templateKey,
  workbookPath,
  branchCodes,
  importedCount,
}) {
  db.prepare(`
    INSERT INTO admin_audit_logs (
      actor_type,
      actor_name,
      action,
      entity_type,
      entity_id,
      branch,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(actorType || "owner").slice(0, 120),
    actorName ? String(actorName).slice(0, 120) : null,
    "business_template_apply_owner",
    "business_template",
    String(templateKey || "").slice(0, 120),
    null,
    JSON.stringify({
      workbookPath,
      importedCount,
      branches: branchCodes,
    }).slice(0, 12000),
    nowIso(),
  );
}

async function applyBusinessTemplateWithCatalog(template, options = {}) {
  if (!template || typeof template !== "object") {
    throw createHttpError("La plantilla de negocio no es valida.");
  }

  const currentProfile = getBusinessProfile();
  const businessName = String(options.businessName || "").trim();
  const slug = String(options.slug || "").trim();
  const confirmText = String(options.confirmText || "").trim();
  const skipConfirmGuard = options.skipConfirmGuard === true;

  if (!skipConfirmGuard && options.confirmReset !== true) {
    throw createHttpError("Confirma explicitamente que quieres reiniciar este negocio.", 409);
  }
  if (!skipConfirmGuard && (!confirmText || confirmText !== String(currentProfile.slug || ""))) {
    throw createHttpError("La confirmacion no coincide con el slug actual del negocio.", 409);
  }
  if (!businessName) {
    throw createHttpError("Captura el nombre final del negocio.");
  }
  if (!slug) {
    throw createHttpError("Captura el slug final del negocio.");
  }

  const workbook = await loadCatalogForTemplateReset(options.workbookPath);
  let seedResult = null;

  db.transaction(() => {
    businessProfileService.clearOperationalDataTables({
      keepAdminAuditLogs: false,
      preserveAdminCredentials: false,
    });
    businessProfileService.applyBusinessTemplate(template, {
      businessName,
      slug,
      clearOperationalData: false,
      templateKey: template.key,
    });
    seedResult = seedCatalogIntoCurrentTemplate(workbook.catalog, nowIso());
    insertTemplateProvisionAuditLog({
      actorType: options.actorType || "owner",
      actorName: options.actorName || null,
      templateKey: template.key,
      workbookPath: workbook.workbookPath,
      branchCodes: seedResult.branchCodes,
      importedCount: seedResult.importedCount,
    });
  })();

  const activeProductCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM products WHERE active = 1").get()?.count || 0,
  );
  if (activeProductCount <= 0) {
    throw createHttpError("El reinicio termino sin catalogo activo. No se puede dejar este negocio vacio.", 500);
  }

  return {
    ...businessProfileService.getAdminConfigBundle(),
    workbookPath: workbook.workbookPath,
    importedCount: seedResult?.importedCount || 0,
    branchCodes: seedResult?.branchCodes || [],
    requiresReauth: true,
  };
}

module.exports = {
  applyBusinessTemplateWithCatalog,
  loadCatalogForTemplateReset,
  resolveExplicitWorkbookPath,
};
