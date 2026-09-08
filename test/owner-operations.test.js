const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");

function clearSrcRequireCache() {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(SRC_DIR))
    .forEach((entry) => {
      delete require.cache[entry];
    });
}

test("owner operation guide defaults to neutral public URLs without railway fallbacks", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-operations-guide-"));
  const dbPath = path.join(tempDir, "guide.sqlite");
  const previousEnv = {
    POS_DB_PATH: process.env.POS_DB_PATH,
    POS_PUBLIC_ORIGIN: process.env.POS_PUBLIC_ORIGIN,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
  };

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    try {
      require("../src/db").closeDatabaseConnection();
    } catch (_error) {
      // Si el modulo no quedo abierto, seguimos con la limpieza.
    }
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  Object.keys(previousEnv).forEach((key) => {
    delete process.env[key];
  });
  process.env.POS_DB_PATH = dbPath;
  clearSrcRequireCache();

  const ownerOperations = require("../src/services/ownerOperations");
  const guide = ownerOperations.getOwnerOperationGuide();
  const provisionCommand = guide.commands.find((command) => command.id === "provision-client");

  assert.equal(guide.current.publicOrigin, "");
  assert.equal(guide.localRuntimeConfigExample.POS_PUBLIC_ORIGIN, "https://merxalia-pos.ejemplo.com");
  assert.equal(guide.localRuntimeConfigExample.POS_ALLOWED_ORIGINS, "https://merxalia-pos.ejemplo.com,http://localhost:3100");
  assert.ok(provisionCommand);
  assert.match(provisionCommand.command, /https:\/\/merxalia-pos\.ejemplo\.com/i);
  assert.doesNotMatch(provisionCommand.command, /\.railway\.app/i);
});
