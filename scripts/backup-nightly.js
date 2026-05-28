#!/usr/bin/env node

const services = require("../src/services");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--date") {
      options.baseDateKey = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (current === "--allow-disabled") {
      options.allowWhenDisabled = true;
      continue;
    }
  }
  return options;
}

async function main() {
  const run = await services.runNightlyBackup(parseArgs());
  console.log(`Backup: ${run.status}`);
  console.log(`Fecha operativa: ${run.backupDateKey}`);
  console.log(`SQLite: ${run.sqliteRemoteKey || run.sqliteLocalPath || "sin ruta"}`);
  console.log(`Excel: ${run.workbookRemoteKey || run.workbookLocalPath || "sin ruta"}`);
  console.log(`Sync: ${run.syncState}`);
}

main().catch((error) => {
  console.error(error.message || "No pude completar el backup nocturno.");
  process.exitCode = 1;
});
