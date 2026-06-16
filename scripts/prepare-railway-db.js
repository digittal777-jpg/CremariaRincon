#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const { DB_PATH, POS_PUBLIC_ORIGIN, ROOT_DIR } = require("../src/config");

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function normalizeOutputDir(candidateDir) {
  if (!candidateDir) {
    return path.join(ROOT_DIR, ".tmp-railway");
  }

  return path.resolve(process.cwd(), candidateDir);
}

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeJsonParse(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function resolveBrandingAsset(assetPath) {
  if (!assetPath) {
    return {
      path: "",
      exists: false,
      note: "sin valor",
      absolutePath: "",
    };
  }

  if (/^data:/i.test(assetPath)) {
    return {
      path: assetPath,
      exists: true,
      note: "data-url embebida",
      absolutePath: "",
    };
  }

  if (!assetPath.startsWith("/")) {
    return {
      path: assetPath,
      exists: false,
      note: "ruta no publica",
      absolutePath: "",
    };
  }

  const absolutePath = path.join(ROOT_DIR, "public", assetPath.replace(/^\/+/, ""));
  return {
    path: assetPath,
    exists: fs.existsSync(absolutePath),
    note: fs.existsSync(absolutePath) ? "ok" : "no existe en public/",
    absolutePath,
  };
}

function getTableCount(db, tableName, whereClause = "") {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} ${whereClause}`.trim()).get();
    return Number(row?.count || 0);
  } catch (_error) {
    return 0;
  }
}

function loadProfileSnapshot(db) {
  const row = db.prepare(`
    SELECT
      business_name,
      slug,
      short_name,
      template_key,
      branding_json,
      created_at,
      updated_at
    FROM business_profile
    ORDER BY id ASC
    LIMIT 1
  `).get();

  if (!row) {
    return {
      businessName: "",
      slug: "",
      shortName: "",
      templateKey: "",
      branding: {},
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    businessName: row.business_name || "",
    slug: row.slug || "",
    shortName: row.short_name || "",
    templateKey: row.template_key || "",
    branding: safeJsonParse(row.branding_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function collectWarnings(profile, brandingAssets) {
  const warnings = [];
  const businessName = String(profile.businessName || "").trim();
  const slug = String(profile.slug || "").trim();

  if (!businessName) {
    warnings.push("La base no trae business_profile.business_name.");
  }
  if (businessName === "Retail Base POS") {
    warnings.push("La base sigue con business_profile generico: Retail Base POS.");
  }
  if (slug === "retail-base-pos") {
    warnings.push("La base sigue con slug generico: retail-base-pos.");
  }
  if (!brandingAssets.logo.path && !brandingAssets.logo192.path && !brandingAssets.logo512.path) {
    warnings.push("La base no trae branding.logo, branding.logo192 ni branding.logo512.");
  }

  Object.entries(brandingAssets).forEach(([key, asset]) => {
    if (asset.path && !asset.exists) {
      warnings.push(`El asset ${key} apunta a ${asset.path}, pero no existe en public/.`);
    }
  });

  return warnings;
}

function buildValidationUrl(origin, route) {
  const safeOrigin = String(origin || "").trim().replace(/\/+$/g, "");
  return safeOrigin ? `${safeOrigin}${route}` : route;
}

function buildReportContent({
  sourcePath,
  outputPath,
  publicOrigin,
  railwayDbPath,
  profile,
  counts,
  brandingAssets,
  warnings,
  generatedAt,
}) {
  const logoCandidates = [
    brandingAssets.logo192,
    brandingAssets.logo512,
    brandingAssets.logo,
  ].filter((asset) => asset.path);
  const logoSummary = logoCandidates.length > 0
    ? logoCandidates.map((asset) => `- ${asset.path} (${asset.note})`).join("\n")
    : "- sin rutas de logo";
  const warningSummary = warnings.length > 0
    ? warnings.map((warning) => `- ${warning}`).join("\n")
    : "- sin alertas";

  return [
    "# Railway DB Restore Prep",
    "",
    `Generado: ${generatedAt}`,
    "",
    "## Fuente",
    "",
    `- SQLite origen: \`${toPosixPath(sourcePath)}\``,
    `- Copia lista para Railway: \`${toPosixPath(outputPath)}\``,
    `- POS_DB_PATH recomendado en Railway: \`${railwayDbPath}\``,
    "",
    "## Identidad encontrada",
    "",
    `- businessName: ${profile.businessName || "(vacio)"}`,
    `- slug: ${profile.slug || "(vacio)"}`,
    `- shortName: ${profile.shortName || "(vacio)"}`,
    `- templateKey: ${profile.templateKey || "(vacio)"}`,
    `- updatedAt: ${profile.updatedAt || "(sin fecha)"}`,
    "",
    "## Conteos rapidos",
    "",
    `- productos: ${counts.products}`,
    `- sucursales activas: ${counts.activeBranches}`,
    `- ventas: ${counts.sales}`,
    `- eventos de caja: ${counts.registerEvents}`,
    "",
    "## Branding",
    "",
    logoSummary,
    "",
    "## Validaciones sugeridas en Railway",
    "",
    `- Health: \`${buildValidationUrl(publicOrigin, "/api/health")}\``,
    `- Bootstrap: \`${buildValidationUrl(publicOrigin, "/api/bootstrap")}\``,
    `- Install DB: \`${buildValidationUrl(publicOrigin, "/api/admin/install-db")}\``,
    "",
    "## Variables minimas sugeridas",
    "",
    "```text",
    `POS_DB_PATH=${railwayDbPath}`,
    publicOrigin ? `POS_PUBLIC_ORIGIN=${publicOrigin}` : "POS_PUBLIC_ORIGIN=<tu-url-publica>",
    publicOrigin ? `POS_ALLOWED_ORIGINS=${publicOrigin}` : "POS_ALLOWED_ORIGINS=<tu-url-publica>",
    "POS_SECURE_COOKIES=true",
    "POS_BOOTSTRAP_TOKEN=<secreto-largo-y-unico>",
    "```",
    "",
    "## Alertas",
    "",
    warningSummary,
    "",
    "## Flujo recomendado",
    "",
    "1. Monta un volumen persistente en Railway.",
    "2. Configura POS_DB_PATH para que apunte al archivo del volumen.",
    "3. Despliega el servicio.",
    "4. Si arranca en blanco, entra con bootstrap y sube esta copia por /api/admin/install-db.",
    "5. Reinicia el servicio y valida /api/bootstrap, logo, favicon, productos y sucursales.",
    "",
    "## Nota importante",
    "",
    "- POS_WORKBOOK_PATH solo sirve para sembrar catalogo si la DB esta vacia; no restaura business_profile ni clona el negocio completo.",
    "",
  ].join("\n");
}

async function main() {
  const sourcePath = path.resolve(process.cwd(), getFlagValue("source") || DB_PATH);
  const outputDir = normalizeOutputDir(getFlagValue("output-dir"));
  const publicOrigin = getFlagValue("public-origin") || POS_PUBLIC_ORIGIN || "";
  const railwayDbPath = getFlagValue("railway-db-path") || "/data/cremaria-rincon.sqlite";

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No encontre la SQLite origen: ${sourcePath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const stamp = buildTimestamp();
  const sourceBaseName = path.basename(sourcePath, path.extname(sourcePath));
  const outputPath = path.join(outputDir, `${sourceBaseName}-railway-source-${stamp}.sqlite`);
  const reportPath = path.join(outputDir, `${sourceBaseName}-railway-source-${stamp}.md`);

  const sourceDb = new Database(sourcePath, { fileMustExist: true });
  let profile = null;
  let counts = null;

  try {
    sourceDb.pragma("quick_check");
    profile = loadProfileSnapshot(sourceDb);
    counts = {
      products: getTableCount(sourceDb, "products", "WHERE active = 1"),
      activeBranches: getTableCount(sourceDb, "branches", "WHERE active = 1"),
      sales: getTableCount(sourceDb, "sales"),
      registerEvents: getTableCount(sourceDb, "register_events"),
    };
    await sourceDb.backup(outputPath);
  } finally {
    sourceDb.close();
  }

  const brandingAssets = {
    logo: resolveBrandingAsset(profile.branding?.logo || ""),
    logo192: resolveBrandingAsset(profile.branding?.logo192 || ""),
    logo512: resolveBrandingAsset(profile.branding?.logo512 || ""),
  };
  const warnings = collectWarnings(profile, brandingAssets);
  const reportContent = buildReportContent({
    sourcePath,
    outputPath,
    publicOrigin,
    railwayDbPath,
    profile,
    counts,
    brandingAssets,
    warnings,
    generatedAt: new Date().toISOString(),
  });

  fs.writeFileSync(reportPath, reportContent, "utf8");

  console.log(`SQLite lista: ${outputPath}`);
  console.log(`Reporte: ${reportPath}`);
  console.log(`Negocio: ${profile.businessName || "(vacio)"}`);
  console.log(`Slug: ${profile.slug || "(vacio)"}`);
  console.log(`Productos activos: ${counts.products}`);
  console.log(`POS_DB_PATH recomendado: ${railwayDbPath}`);
  if (warnings.length > 0) {
    console.log("Alertas:");
    warnings.forEach((warning) => {
      console.log(`- ${warning}`);
    });
  }
}

main().catch((error) => {
  console.error(error.message || "No pude preparar la SQLite para Railway.");
  process.exitCode = 1;
});
