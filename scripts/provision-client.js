const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePublicUrl(value) {
  const rawUrl = String(value || "").trim().replace(/\/+$/g, "");
  if (!rawUrl) {
    return "";
  }

  let parsed = null;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error("La URL publica debe ser absoluta, por ejemplo https://cliente.ejemplo.com.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("La URL publica debe iniciar con http:// o https://.");
  }

  const hostname = String(parsed.hostname || "").trim().toLowerCase();
  const isLoopback = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || hostname === "0.0.0.0"
    || hostname.startsWith("127.");
  if (parsed.protocol !== "https:" && !isLoopback) {
    throw new Error("La URL publica debe usar HTTPS fuera de localhost.");
  }

  return parsed.toString().replace(/\/+$/g, "");
}

function resolveExistingFile(filePath) {
  const rawPath = String(filePath || "").trim();
  if (!rawPath) {
    return "";
  }

  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return "";
  }

  return resolvedPath;
}

function assertTemplateExists(templateKey) {
  const templatePath = path.join(ROOT_DIR, "business-templates", `${templateKey}.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`No existe la plantilla "${templateKey}".`);
  }
}

function usage() {
  return [
    "Uso:",
    "  npm.cmd run provision:client -- --slug abarrotes-lupita --name \"Abarrotes Lupita\" --template abarrotes --catalog .\\catalogos\\abarrotes-base.xlsx --public-url https://abarrotes-lupita.ejemplo.com",
    "",
    "Flags:",
    "  --plan-only       Solo genera expediente privado; no crea clon.",
    "  --skip-clone      Usa un clon existente y solo copia catalogo/genera expediente.",
    "  --install-deps    Ejecuta npm install dentro del clon despues de crearlo.",
  ].join("\n");
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runCloneBusiness({ slug, businessName, templateKey, catalogPath }) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "clone-business.js"),
      "--slug",
      slug,
      "--name",
      businessName,
      "--template",
      templateKey,
      "--catalog",
      catalogPath,
    ],
    {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`No pude crear el clon para ${slug}.`);
  }
}

function copyCatalogIntoClone({ catalogPath, slug, targetDir }) {
  const extension = path.extname(catalogPath) || ".xlsx";
  const catalogDir = path.join(targetDir, "catalogos");
  const targetCatalogName = `${slug}${extension}`;
  const targetCatalogPath = path.join(catalogDir, targetCatalogName);

  fs.mkdirSync(catalogDir, { recursive: true });
  fs.copyFileSync(catalogPath, targetCatalogPath);

  return {
    targetCatalogPath,
    posWorkbookPath: path.relative(targetDir, targetCatalogPath).replace(/\\/g, "/"),
  };
}

function maybeInstallDependencies(targetDir) {
  if (!hasFlag("install-deps")) {
    return false;
  }

  const result = spawnSync(getNpmCommand(), ["install"], {
    cwd: targetDir,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("El clon se creo, pero npm install fallo.");
  }

  return true;
}

function buildInstallReport({
  businessName,
  slug,
  templateKey,
  catalogPath,
  copiedCatalogPath,
  posWorkbookPath,
  publicUrl,
  targetDir,
  bootstrapToken,
  mode,
  installedDependencies,
}) {
  const safePublicUrl = publicUrl || "https://pendiente";
  const createdAt = new Date().toISOString();
  const localDbPath = "data/retail-base-pos.sqlite";
  const railwayDbPath = "/data/retail-base-pos.sqlite";

  return `---
privado: true
tipo: instalacion-cliente
estado: pendiente-validacion
creado: ${createdAt}
---

# Instalacion cliente: ${businessName}

> Expediente privado. No subir a GitHub. Contiene token de bootstrap y datos operativos.

## Resumen

| Campo | Valor |
|---|---|
| Negocio | ${businessName} |
| Slug | ${slug} |
| Plantilla | ${templateKey} |
| Modo | ${mode} |
| Clon local | ${targetDir || "(no creado)"} |
| Catalogo fuente | ${catalogPath} |
| Catalogo dentro del clon | ${copiedCatalogPath || "(pendiente)"} |
| Dependencias instaladas | ${installedDependencies ? "si" : "no"} |
| URL publica | ${safePublicUrl} |

## Secretos

Guardar en gestor privado antes de entregar accesos.

\`\`\`text
POS_BOOTSTRAP_TOKEN=${bootstrapToken}
\`\`\`

## Variables locales recomendadas

\`\`\`powershell
$env:POS_DB_PATH='${localDbPath}'
$env:POS_WORKBOOK_PATH='${posWorkbookPath || "catalogos/<catalogo>.xlsx"}'
$env:POS_TIMEZONE='America/Mexico_City'
$env:POS_PUBLIC_ORIGIN='http://localhost:3100'
$env:POS_ALLOWED_ORIGINS='http://localhost:3100'
$env:POS_SECURE_COOKIES='false'
$env:POS_FORCE_HTTPS='false'
$env:POS_TRUST_PROXY=''
$env:POS_BOOTSTRAP_TOKEN='${bootstrapToken}'
$env:CONTROL_REQUIRE_HTTPS='true'
npm.cmd start
\`\`\`

## Variables Railway recomendadas

\`\`\`text
NODE_ENV=production
POS_DB_PATH=${railwayDbPath}
POS_WORKBOOK_PATH=${posWorkbookPath || "catalogos/<catalogo>.xlsx"}
POS_TIMEZONE=America/Mexico_City
POS_PUBLIC_ORIGIN=${safePublicUrl}
POS_ALLOWED_ORIGINS=${safePublicUrl}
POS_SECURE_COOKIES=true
POS_FORCE_HTTPS=true
POS_TRUST_PROXY=loopback,linklocal,uniquelocal
POS_BOOTSTRAP_TOKEN=${bootstrapToken}
CONTROL_REQUIRE_HTTPS=true
\`\`\`

## Checklist de entrega

- [ ] Crear proyecto/servicio Railway exclusivo para este cliente.
- [ ] Crear volumen persistente exclusivo.
- [ ] Configurar variables de entorno.
- [ ] Desplegar repo del clon.
- [ ] Crear owner con bootstrap token.
- [ ] Crear admin con bootstrap token.
- [ ] Crear cajeros iniciales.
- [ ] Validar \`GET /api/health\`.
- [ ] Validar \`GET /api/bootstrap\`.
- [ ] Hacer venta de prueba.
- [ ] Hacer corte de prueba.
- [ ] Descargar Excel de prueba.
- [ ] Descargar SQLite de prueba.
- [ ] Activar y probar backup si aplica.
- [ ] Preparar dispositivo principal online y confirmar modo offline.
- [ ] Registrar plan, fecha de corte y responsable del negocio.

## Evidencia final

| Prueba | Resultado | Fecha | Nota |
|---|---|---|---|
| Health | pendiente |  |  |
| Bootstrap | pendiente |  |  |
| Owner login | pendiente |  |  |
| Admin login | pendiente |  |  |
| Venta prueba | pendiente |  |  |
| Corte prueba | pendiente |  |  |
| Export Excel | pendiente |  |  |
| Backup | pendiente |  |  |

## Entrega al cliente

- URL:
- Usuario admin:
- Cajeros:
- Sucursales:
- Horario/limite de soporte:
- Fecha de proximo pago:
- Notas de capacitacion:
`;
}

function writeInstallReport(report) {
  const provisionDir = path.join(ROOT_DIR, ".tmp-provisioning");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(provisionDir, `${report.slug}-instalacion-${stamp}.private.md`);

  fs.mkdirSync(provisionDir, { recursive: true });
  fs.writeFileSync(reportPath, report.content, "utf8");

  return reportPath;
}

function main() {
  const businessName = getFlagValue("name");
  const slug = normalizeSlug(getFlagValue("slug"));
  const templateKey = getFlagValue("template");
  const catalogPath = resolveExistingFile(getFlagValue("catalog"));
  const publicUrl = normalizePublicUrl(getFlagValue("public-url"));
  const planOnly = hasFlag("plan-only");
  const skipClone = hasFlag("skip-clone");

  if (!businessName || !slug || !templateKey || !catalogPath) {
    throw new Error(usage());
  }
  if (planOnly && skipClone) {
    throw new Error("Usa solo una opcion: --plan-only o --skip-clone.");
  }

  assertTemplateExists(templateKey);

  const parentDir = path.dirname(ROOT_DIR);
  const targetDir = path.join(parentDir, slug);
  const bootstrapToken = crypto.randomBytes(32).toString("hex");
  let copiedCatalog = {
    targetCatalogPath: "",
    posWorkbookPath: "",
  };
  let installedDependencies = false;

  if (!planOnly) {
    if (skipClone) {
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        throw new Error(`No existe el clon para --skip-clone: ${targetDir}`);
      }
    } else {
      runCloneBusiness({ slug, businessName, templateKey, catalogPath });
    }

    copiedCatalog = copyCatalogIntoClone({ catalogPath, slug, targetDir });
    installedDependencies = maybeInstallDependencies(targetDir);
  }

  const mode = planOnly ? "plan-only" : skipClone ? "skip-clone" : "clone";
  const content = buildInstallReport({
    businessName,
    slug,
    templateKey,
    catalogPath,
    copiedCatalogPath: copiedCatalog.targetCatalogPath,
    posWorkbookPath: copiedCatalog.posWorkbookPath,
    publicUrl,
    targetDir: planOnly ? "" : targetDir,
    bootstrapToken,
    mode,
    installedDependencies,
  });
  const reportPath = writeInstallReport({ slug, content });

  console.log("");
  console.log("Provisionamiento preparado.");
  if (!planOnly) {
    console.log(`Clon: ${targetDir}`);
    console.log(`Catalogo copiado: ${copiedCatalog.targetCatalogPath}`);
  }
  console.log(`Expediente privado: ${reportPath}`);
  console.log("Siguiente paso: validar localmente, crear owner/admin y completar evidencia de entrega.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
