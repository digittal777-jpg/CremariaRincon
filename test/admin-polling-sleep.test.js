const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ACTIONS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "js", "actions.js"), "utf8");

test("admin metrics polling pauses on hidden documents and resumes when the modal is visible", () => {
  assert.match(ACTIONS_SOURCE, /function handleAdminMetricsVisibilityChange\(\)/);
  assert.match(ACTIONS_SOURCE, /if \(typeof document !== "undefined" && document\.hidden\) \{\s+stopAdminMetricsPolling\(\);\s+return;\s+\}/);
  assert.match(ACTIONS_SOURCE, /if \(refs\.adminModal\?\.classList\.contains\("open"\)\) \{\s+startAdminMetricsPolling\(\);\s+\}/);
  assert.match(ACTIONS_SOURCE, /typeof document\.addEventListener === "function"/);
  assert.match(ACTIONS_SOURCE, /document\.addEventListener\("visibilitychange", handleAdminMetricsVisibilityChange\)/);
  assert.match(ACTIONS_SOURCE, /if \(typeof document !== "undefined" && document\.hidden\) \{\s+return;\s+\}/);
});
