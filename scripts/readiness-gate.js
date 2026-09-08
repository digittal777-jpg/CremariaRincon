#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const VALID_STAGES = new Set(["pilot", "scale"]);

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

function usage() {
  return [
    "Uso:",
    "  npm.cmd run readiness:pilot -- --evidence .tmp-provisioning/cliente-readiness.json",
    "  npm.cmd run readiness:scale -- --evidence .tmp-provisioning/cliente-readiness.json",
    "",
    "El archivo de evidencia debe confirmar soporte, backup, offline, catalogo, seguimiento y los cierres externos que apliquen.",
  ].join("\n");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`No pude leer evidencia JSON en ${filePath}: ${error.message}`);
  }
}

function resolvePathFrom(baseDir, value) {
  const rawPath = String(value || "").trim();
  if (!rawPath) {
    return "";
  }
  return path.isAbsolute(rawPath) ? rawPath : path.join(baseDir || ROOT_DIR, rawPath);
}

function resolveEvidencePath(value) {
  const rawPath = String(value || "").trim();
  if (!rawPath) {
    throw new Error("Captura --evidence con un archivo JSON de evidencia del cliente.");
  }
  return path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
}

function assertRepoArtifact(relativePath, failures) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Falta artefacto local: ${relativePath}`);
  }
}

function requireEvidenceFile(baseDir, value, label, failures) {
  const rawPath = String(value || "").trim();
  if (!rawPath) {
    failures.push(`Falta documento de evidencia: ${label}.`);
    return;
  }
  const candidatePaths = path.isAbsolute(rawPath)
    ? [rawPath]
    : [path.join(baseDir || ROOT_DIR, rawPath), path.join(ROOT_DIR, rawPath)];
  if (!candidatePaths.some((candidatePath) => fs.existsSync(candidatePath))) {
    failures.push(`No existe documento de evidencia ${label}: ${rawPath}`);
  }
}

function getPackageJson() {
  return readJsonFile(path.join(ROOT_DIR, "package.json"));
}

function getRailwayBackupConfig() {
  return readJsonFile(path.join(ROOT_DIR, "railway.backup.json"));
}

function isTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function getPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseIsoTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecentTimestamp(value, maxAgeDays = 14) {
  const timestamp = parseIsoTimestamp(value);
  if (!timestamp) {
    return false;
  }
  const maxAgeMs = Math.max(1, Number(maxAgeDays || 14)) * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp <= maxAgeMs;
}

function hasReadyOfflineDevice(evidence) {
  const devices = Array.isArray(evidence.offlinePreparedDevices)
    ? evidence.offlinePreparedDevices
    : [];
  return devices.some((device) => isTruthy(device.ready) && isRecentTimestamp(device.checkedAt, 14));
}

function checkStaticArtifacts(failures) {
  assertRepoArtifact("docs/PLAYBOOK-RESTAURACION.md", failures);
  assertRepoArtifact("docs/QA-IMPRESION-HARDWARE.md", failures);
  assertRepoArtifact("docs/RAILWAY-BACKUP-CRON.md", failures);
  assertRepoArtifact("docs/READINESS-EVIDENCE.example.json", failures);
  assertRepoArtifact("scripts/verify-backup-run.js", failures);
  assertRepoArtifact("railway.backup.json", failures);

  const packageInfo = getPackageJson();
  if (packageInfo.scripts?.["backup:verify"] !== "node scripts/verify-backup-run.js") {
    failures.push("package.json no expone backup:verify.");
  }

  const backupConfig = getRailwayBackupConfig();
  if (backupConfig.deploy?.startCommand !== "npm run backup:nightly") {
    failures.push("railway.backup.json no ejecuta npm run backup:nightly.");
  }
  if (backupConfig.deploy?.cronSchedule !== "0 9 * * *") {
    failures.push("railway.backup.json no tiene cron 0 9 * * *.");
  }
}

function checkBackupEvidence(backup, failures, warnings) {
  if (backup.verifyReportError) {
    failures.push(`No pude leer reporte backup:verify: ${backup.verifyReportError}`);
  }
  if (backup.verifyReportPath && backup.verifyReportOk !== true) {
    failures.push("El reporte backup:verify no esta aprobado.");
  }
  if (Number(backup.verifyCommandExitCode) !== 0) {
    failures.push("Falta backup inicial verificado con npm run backup:verify.");
  }

  const status = String(backup.status || "").toLowerCase();
  if (!["ok", "partial"].includes(status)) {
    failures.push("El backup debe estar en estado ok o partial justificado.");
  }
  if (status === "partial") {
    warnings.push("Backup partial aceptable solo con cola offline documentada.");
    if (!String(backup.partialJustification || "").trim()) {
      failures.push("Backup partial necesita partialJustification.");
    }
  }

  if (!isRecentTimestamp(backup.verifiedAt, 2)) {
    failures.push("Falta fecha reciente de verificacion del backup.");
  }
  if (getPositiveNumber(backup.sqliteBytes) <= 0) {
    failures.push("Falta evidencia de bytes SQLite del backup.");
  }
  if (getPositiveNumber(backup.workbookBytes) <= 0) {
    failures.push("Falta evidencia de bytes Excel del backup.");
  }
  if (!String(backup.sqliteArtifact || "").trim()) {
    failures.push("Falta ruta o llave del artefacto SQLite.");
  }
  if (!String(backup.workbookArtifact || "").trim()) {
    failures.push("Falta ruta o llave del artefacto Excel.");
  }
}

function mergeBackupVerifyReport(evidence, evidencePath) {
  const backup = evidence.backup || {};
  if (!backup.verifyReportPath) {
    return evidence;
  }

  const evidenceDir = path.dirname(evidencePath);
  const reportPath = resolvePathFrom(evidenceDir, backup.verifyReportPath);
  try {
    const report = readJsonFile(reportPath);
    const lastRun = report.lastRun || {};
    return {
      ...evidence,
      backup: {
        ...backup,
        verifyReportOk: report.ok === true,
        verifyCommandExitCode: report.ok === true ? 0 : 1,
        status: lastRun.status || backup.status,
        verifiedAt: report.checkedAt || backup.verifiedAt,
        sqliteBytes: lastRun.sqliteBytes ?? backup.sqliteBytes,
        workbookBytes: lastRun.workbookBytes ?? backup.workbookBytes,
        sqliteArtifact: lastRun.sqliteRemoteKey || lastRun.sqliteLocalPath || backup.sqliteArtifact,
        workbookArtifact: lastRun.workbookRemoteKey || lastRun.workbookLocalPath || backup.workbookArtifact,
      },
    };
  } catch (error) {
    return {
      ...evidence,
      backup: {
        ...backup,
        verifyReportError: error.message,
        verifyReportOk: false,
        verifyCommandExitCode: 1,
      },
    };
  }
}

function checkPrintingEvidence(printing, failures, evidenceDir) {
  if (!isTruthy(printing.promisedTicket)) {
    return;
  }
  if (!isTruthy(printing.hardwareTestPassed)) {
    failures.push("Se prometio ticket fisico pero falta prueba real de impresora.");
  }
  if (!isRecentTimestamp(printing.hardwareTestedAt, 14)) {
    failures.push("Falta fecha reciente de prueba de impresora real.");
  }
  if (!String(printing.model || "").trim()) {
    failures.push("Falta modelo de impresora probado.");
  }
  if (!String(printing.qaDocument || "").trim()) {
    failures.push("Falta referencia al documento QA de impresion.");
  } else {
    requireEvidenceFile(evidenceDir, printing.qaDocument, "QA de impresion", failures);
  }
}

function checkPilotEvidence(evidence, failures, warnings, evidenceDir) {
  if (!isTruthy(evidence.testsPassed)) {
    failures.push("Falta evidencia de npm test pasando.");
  }
  if (!isTruthy(evidence.auditClean)) {
    failures.push("Falta evidencia de npm audit --omit=dev limpio.");
  }
  if (!isTruthy(evidence.supportConfigured)) {
    failures.push("Falta soporte WhatsApp/telefono configurado.");
  }
  if (!isTruthy(evidence.catalogLoadedWithoutCriticalDuplicates)) {
    failures.push("Falta catalogo inicial cargado sin duplicados criticos.");
  }
  if (!isTruthy(evidence.adminSimpleModeConfigured)) {
    failures.push("Falta dejar el admin reducido a secciones necesarias.");
  }
  if (!hasReadyOfflineDevice(evidence)) {
    failures.push("Falta al menos un dispositivo preparado offline.");
  }
  if (!isTruthy(evidence.followUpPlan)) {
    failures.push("Falta plan de seguimiento a 3, 7 y 15 dias.");
  }

  const backup = evidence.backup || {};
  checkBackupEvidence(backup, failures, warnings);

  const printing = evidence.printing || {};
  checkPrintingEvidence(printing, failures, evidenceDir);
}

function checkScaleEvidence(evidence, failures, evidenceDir) {
  const railway = evidence.railway || {};
  const backup = evidence.backup || {};
  if (!isTruthy(railway.backupCronServiceCreated)) {
    failures.push("Falta servicio cron real de backup en Railway.");
  }
  if (!String(railway.serviceName || "").trim()) {
    failures.push("Falta nombre del servicio cron Railway.");
  }
  if (!isRecentTimestamp(railway.backupCronVerifiedAt, 14)) {
    failures.push("Falta fecha reciente de verificacion del cron Railway.");
  }
  requireEvidenceFile(evidenceDir, railway.evidenceDocument, "cron Railway", failures);
  if (!isTruthy(backup.restorationTested)) {
    failures.push("Falta restauracion probada con el backup del cliente.");
  }
  if (!isRecentTimestamp(backup.restorationTestedAt, 14)) {
    failures.push("Falta fecha reciente de prueba de restauracion.");
  }
  requireEvidenceFile(evidenceDir, backup.restorationEvidenceDocument, "restauracion", failures);
}

function buildReadinessResult(stage, evidence, evidencePath = "") {
  const failures = [];
  const warnings = [];
  const evidenceDir = evidencePath ? path.dirname(evidencePath) : ROOT_DIR;

  checkStaticArtifacts(failures);
  checkPilotEvidence(evidence, failures, warnings, evidenceDir);
  if (stage === "scale") {
    checkScaleEvidence(evidence, failures, evidenceDir);
  }

  return {
    ok: failures.length === 0,
    stage,
    client: evidence.client || evidence.slug || "sin-cliente",
    checkedAt: new Date().toISOString(),
    failures,
    warnings,
  };
}

function printHuman(result) {
  const status = result.ok ? "APROBADO" : "BLOQUEADO";
  const writer = result.ok ? console.log : console.error;
  writer(`Readiness ${result.stage}: ${status}`);
  console.log(`Cliente: ${result.client}`);
  result.warnings.forEach((warning) => console.warn(`Aviso: ${warning}`));
  result.failures.forEach((failure) => console.error(`Falta: ${failure}`));
}

function main() {
  const stage = getFlagValue("stage") || (hasFlag("scale") ? "scale" : "pilot");
  if (!VALID_STAGES.has(stage)) {
    throw new Error("Stage invalido. Usa pilot o scale.");
  }

  const evidencePath = resolveEvidencePath(getFlagValue("evidence"));
  const evidence = mergeBackupVerifyReport(readJsonFile(evidencePath), evidencePath);
  const result = buildReadinessResult(stage, evidence, evidencePath);

  if (hasFlag("json")) {
    const writer = result.ok ? console.log : console.error;
    writer(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exitCode = result.ok ? 0 : 1;
}

main();
