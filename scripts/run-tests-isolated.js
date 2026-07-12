const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const explicitRuntimePath = process.env.POS_CONFIG_PATH;
let tempDir = null;

const env = {
  ...process.env,
};

if (!explicitRuntimePath) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-test-runtime-"));
  const runtimePath = path.join(tempDir, "pos-runtime-config.json");
  fs.writeFileSync(runtimePath, "{}\n", "utf8");
  env.POS_CONFIG_PATH = runtimePath;
}

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

if (tempDir) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_error) {
    // Best-effort cleanup; the temp directory is isolated under the OS temp path.
  }
}

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
