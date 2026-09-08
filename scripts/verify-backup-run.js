#!/usr/bin/env node

const services = require("../src/services");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    maxAgeHours: 36,
    allowPartial: false,
    json: false,
    outputPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--max-age-hours") {
      options.maxAgeHours = Math.max(1, Number(argv[index + 1] || options.maxAgeHours));
      index += 1;
      continue;
    }
    if (current === "--allow-partial") {
      options.allowPartial = true;
      continue;
    }
    if (current === "--json") {
      options.json = true;
      continue;
    }
    if (current === "--output") {
      options.outputPath = String(argv[index + 1] || "").trim();
      options.json = true;
      index += 1;
    }
  }

  return options;
}

function getRunAgeHours(run) {
  const reference = run?.finishedAt || run?.startedAt || run?.createdAt;
  const timestamp = Date.parse(reference || "");
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - timestamp) / (60 * 60 * 1000);
}

function checkBackupStatus(bundle, options) {
  const failures = [];
  const warnings = [];
  const lastRun = bundle.lastRun || null;
  const storageMode = bundle.storage?.mode || "unconfigured";

  if (!bundle.enabled) {
    failures.push("BACKUP_ENABLED no esta activo para este despliegue.");
  }
  if (storageMode === "unconfigured") {
    failures.push("BACKUP_BUCKET_ENDPOINT o BACKUP_BUCKET_NAME no estan configurados.");
  }
  if (!lastRun) {
    failures.push("No hay corridas registradas en backup_runs.");
  }

  if (lastRun) {
    const acceptedStatuses = options.allowPartial ? ["ok", "partial"] : ["ok"];
    if (!acceptedStatuses.includes(lastRun.status)) {
      failures.push(`El ultimo backup quedo en estado ${lastRun.status || "desconocido"}.`);
    }
    if (lastRun.status === "partial") {
      warnings.push("El ultimo backup es partial: hubo cola offline pendiente o bloqueada.");
    }
    if (Number(lastRun.sqliteBytes || 0) <= 0) {
      failures.push("El ultimo backup no registro bytes SQLite.");
    }
    if (Number(lastRun.workbookBytes || 0) <= 0) {
      failures.push("El ultimo backup no registro bytes Excel.");
    }
    if (!lastRun.sqliteRemoteKey && !lastRun.sqliteLocalPath) {
      failures.push("El ultimo backup no registro ruta/llave SQLite.");
    }
    if (!lastRun.workbookRemoteKey && !lastRun.workbookLocalPath) {
      failures.push("El ultimo backup no registro ruta/llave Excel.");
    }

    const ageHours = getRunAgeHours(lastRun);
    if (!Number.isFinite(ageHours) || ageHours > options.maxAgeHours) {
      failures.push(`El ultimo backup supera ${options.maxAgeHours} hora(s) o no tiene fecha valida.`);
    }
  }

  if (bundle.syncHealth?.hasPending && !options.allowPartial) {
    failures.push("Hay equipos con cola offline pendiente/bloqueada; repite backup cuando sync quede limpio o usa --allow-partial con justificacion.");
  }

  const restoreCheck = lastRun
    ? services.verifyBackupRunRestorable(lastRun)
    : null;
  if (restoreCheck && !restoreCheck.ok) {
    failures.push(`Restauracion no verificada: ${restoreCheck.failures.join(" | ")}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    storageMode,
    lastRun,
    restoreCheck,
    syncHealth: bundle.syncHealth || null,
  };
}

function printHumanReport(result, options) {
  if (result.ok) {
    console.log("Backup verificado: OK");
  } else {
    console.error("Backup verificado: BLOQUEADO");
  }

  console.log(`Almacenamiento: ${result.storageMode}`);
  console.log(`Edad maxima aceptada: ${options.maxAgeHours}h`);
  if (result.lastRun) {
    console.log(`Ultima corrida: ${result.lastRun.status} / ${result.lastRun.syncState} / ${result.lastRun.backupDateKey}`);
    console.log(`SQLite: ${result.lastRun.sqliteRemoteKey || result.lastRun.sqliteLocalPath || "sin ruta"} (${result.lastRun.sqliteBytes} bytes)`);
    console.log(`Excel: ${result.lastRun.workbookRemoteKey || result.lastRun.workbookLocalPath || "sin ruta"} (${result.lastRun.workbookBytes} bytes)`);
  }
  if (result.restoreCheck) {
    console.log(
      `Restauracion SQLite: ${result.restoreCheck.ok ? "OK" : "BLOQUEADA"} / ${result.restoreCheck.integrity}`,
    );
  }

  result.warnings.forEach((warning) => console.warn(`Aviso: ${warning}`));
  result.failures.forEach((failure) => console.error(`Falta: ${failure}`));
}

function main() {
  const options = parseArgs();
  const bundle = services.getBackupStatusBundle();
  const result = checkBackupStatus(bundle, options);
  const output = {
    ...result,
    checkedAt: new Date().toISOString(),
    maxAgeHours: options.maxAgeHours,
    allowPartial: options.allowPartial,
  };

  if (options.outputPath) {
    const fs = require("node:fs");
    const path = require("node:path");
    const resolvedPath = path.resolve(process.cwd(), options.outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(output, null, 2), "utf8");
  }

  if (options.json) {
    const writer = result.ok ? console.log : console.error;
    writer(JSON.stringify(output, null, 2));
  } else {
    printHumanReport(result, options);
  }

  process.exitCode = result.ok ? 0 : 1;
}

main();
