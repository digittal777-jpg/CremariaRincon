const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_TIMEOUT_MS = 8000;

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

function usage() {
  return [
    "Uso:",
    "  npm.cmd run validate:client -- --slug abarrotes-lupita --url https://abarrotes-lupita.ejemplo.com",
    "",
    "Checks:",
    "  GET /api/health",
    "  GET /api/bootstrap",
    "  GET /manifest.webmanifest",
    "  GET /administracion",
  ].join("\n");
}

function resolveBaseUrl(value) {
  const rawUrl = String(value || "").trim().replace(/\/+$/g, "");
  if (!rawUrl) {
    throw new Error("Captura --url para validar la instancia del cliente.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error("La URL debe ser absoluta, por ejemplo https://cliente.ejemplo.com.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("La URL debe iniciar con http:// o https://.");
  }

  const hostname = String(parsed.hostname || "").trim().toLowerCase();
  const isLoopback = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || hostname === "0.0.0.0"
    || hostname.startsWith("127.");
  if (parsed.protocol !== "https:" && !isLoopback) {
    throw new Error("La URL debe usar HTTPS fuera de localhost.");
  }

  return parsed.toString().replace(/\/+$/g, "");
}

async function fetchCheck(baseUrl, check) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), check.timeoutMs || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: check.accept || "application/json,text/html;q=0.8,*/*;q=0.5",
      },
    });
    const text = await response.text().catch(() => "");
    const durationMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";
    const ok = response.status >= 200 && response.status < 400 && check.validate(text, contentType);

    return {
      ...check,
      ok,
      statusCode: response.status,
      contentType,
      durationMs,
      note: ok ? "OK" : check.failureNote,
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      statusCode: 0,
      contentType: "",
      durationMs: Date.now() - startedAt,
      note: error.name === "AbortError" ? "Timeout" : error.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildChecks() {
  return [
    {
      name: "Health",
      path: "/api/health",
      failureNote: "No responde health JSON.",
      validate: (text, contentType) => contentType.includes("json") && text.includes('"ok"'),
    },
    {
      name: "Bootstrap",
      path: "/api/bootstrap",
      failureNote: "No responde bootstrap JSON.",
      validate: (_text, contentType) => contentType.includes("json"),
    },
    {
      name: "Manifest",
      path: "/manifest.webmanifest",
      failureNote: "No responde manifest PWA.",
      validate: (_text, contentType) => contentType.includes("json") || contentType.includes("manifest"),
    },
    {
      name: "Administracion",
      path: "/administracion",
      failureNote: "No abre la ruta de administracion.",
      validate: (text, contentType) => contentType.includes("html") && /admin|administracion/i.test(text),
    },
  ];
}

function writeValidationReport({ slug, baseUrl, checks }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(ROOT_DIR, ".tmp-provisioning");
  const reportPath = path.join(reportDir, `${slug}-validacion-${stamp}.private.md`);
  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;
  const status = failed === 0 ? "aprobada" : "bloqueada";
  const rows = checks.map((check) => (
    `| ${check.name} | ${check.ok ? "OK" : "Falla"} | ${check.statusCode || "-"} | ${check.durationMs} ms | ${check.note} |`
  )).join("\n");
  const pending = checks
    .filter((check) => !check.ok)
    .map((check) => `- Revisar ${check.name}: ${check.note}`)
    .join("\n") || "- Sin pendientes automaticos.";

  const content = `---
privado: true
tipo: validacion-cliente
estado: ${status}
creado: ${new Date().toISOString()}
---

# Validacion cliente: ${slug}

> Reporte privado. No subir a GitHub. Confirma que la instancia responde antes de cerrar instalacion.

## Resumen

| Campo | Valor |
|---|---|
| Cliente | ${slug} |
| URL | ${baseUrl} |
| Estado | ${status} |
| Checks OK | ${passed}/${checks.length} |

## Checks automaticos

| Check | Resultado | HTTP | Tiempo | Nota |
|---|---|---:|---:|---|
${rows}

## Pendientes

${pending}
`;

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, content, "utf8");
  return reportPath;
}

async function main() {
  const slug = normalizeSlug(getFlagValue("slug"));
  if (!slug) {
    throw new Error("Captura --slug para nombrar el reporte del cliente.");
  }

  const baseUrl = resolveBaseUrl(getFlagValue("url") || getFlagValue("public-url"));
  const checks = [];
  for (const check of buildChecks()) {
    checks.push(await fetchCheck(baseUrl, check));
  }

  const reportPath = writeValidationReport({ slug, baseUrl, checks });
  const failedChecks = checks.filter((check) => !check.ok);

  console.log(`Validacion ${failedChecks.length === 0 ? "aprobada" : "bloqueada"} para ${slug}.`);
  console.log(`Reporte: ${reportPath}`);
  checks.forEach((check) => {
    console.log(`  ${check.ok ? "OK" : "FAIL"} ${check.name} ${check.statusCode || "-"} ${check.durationMs}ms`);
  });

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
});
