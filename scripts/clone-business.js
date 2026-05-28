const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT_DIR } = require("../src/config");
const services = require("../src/services");

const EXCLUDED_NAMES = new Set([
  ".git",
  "node_modules",
  "data",
  "coverage",
  ".turbo",
  ".next",
]);
const EXCLUDED_FILES = new Set([
  "gcm-diagnose.log",
]);

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }

  return String(process.argv[index + 1] || "").trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shouldExclude(sourcePath) {
  const relativePath = path.relative(ROOT_DIR, sourcePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => EXCLUDED_NAMES.has(segment))) {
    return true;
  }

  const baseName = path.basename(sourcePath);
  if (EXCLUDED_FILES.has(baseName)) {
    return true;
  }

  if (
    baseName.endsWith(".sqlite")
    || baseName.endsWith(".sqlite-wal")
    || baseName.endsWith(".sqlite-shm")
    || baseName.endsWith(".log")
    || baseName.endsWith(".tmp")
    || baseName.endsWith(".xlsx")
  ) {
    return true;
  }

  return false;
}

function assertTemplateExists(templateKey) {
  const templatePath = path.join(ROOT_DIR, "business-templates", `${templateKey}.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`No existe la plantilla "${templateKey}".`);
  }
}

function cleanupClonedTarget(parentDir, targetDir) {
  try {
    const resolvedTargetDir = path.resolve(targetDir);
    const resolvedParentDir = path.resolve(parentDir);
    if (resolvedTargetDir.startsWith(`${resolvedParentDir}${path.sep}`) && fs.existsSync(resolvedTargetDir)) {
      fs.rmSync(resolvedTargetDir, { recursive: true, force: true });
    }
  } catch (_cleanupError) {
    // Si la limpieza falla, mantenemos el error principal del clon.
  }
}

function main() {
  const businessName = getFlagValue("name");
  const slug = normalizeSlug(getFlagValue("slug"));
  const templateKey = getFlagValue("template");
  const catalogPath = getFlagValue("catalog");

  if (!businessName || !slug || !templateKey || !catalogPath) {
    throw new Error("Uso: npm run clone:business -- --slug abarrotes-la-esquina --name \"Abarrotes La Esquina\" --template abarrotes --catalog .\\catalogo.xlsx");
  }

  assertTemplateExists(templateKey);
  const resolvedCatalogPath = services.resolveExplicitWorkbookPath(catalogPath);
  if (!resolvedCatalogPath) {
    throw new Error(`No existe el Excel indicado para el clon: ${catalogPath}`);
  }

  const parentDir = path.dirname(ROOT_DIR);
  const targetDir = path.join(parentDir, slug);
  if (fs.existsSync(targetDir)) {
    throw new Error(`La carpeta destino ya existe: ${targetDir}`);
  }

  try {
    fs.cpSync(ROOT_DIR, targetDir, {
      recursive: true,
      filter: (sourcePath) => !shouldExclude(sourcePath),
    });

    fs.mkdirSync(path.join(targetDir, "data"), { recursive: true });

    const seedResult = spawnSync(
      process.execPath,
      [
        path.join(ROOT_DIR, "scripts", "seed-business-template.js"),
        "--template",
        templateKey,
        "--name",
        businessName,
        "--slug",
        slug,
        "--catalog",
        resolvedCatalogPath,
      ],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          POS_DB_PATH: path.join(targetDir, "data", "retail-base-pos.sqlite"),
        },
        stdio: "inherit",
      },
    );

    if (seedResult.status !== 0) {
      throw new Error(`No pude sembrar la plantilla ${templateKey} en ${targetDir}.`);
    }
  } catch (error) {
    cleanupClonedTarget(parentDir, targetDir);
    throw error;
  }

  console.log("");
  console.log(`Clon creado en: ${targetDir}`);
  console.log("Instala dependencias y arranca la app dentro del clon:");
  console.log("  npm install");
  console.log("  npm start");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
