const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");

async function stopServerProcess(child) {
  if (child.exitCode != null) {
    return;
  }

  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Nada extra que hacer si ya cerro.
  }
}

function removeDirWithRetry(targetPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function createCookieClient(baseUrl) {
  const cookies = new Map();

  return {
    async json(pathname, options = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || "GET",
        headers: {
          ...(cookies.size > 0
            ? { Cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") }
            : {}),
          ...(options.headers || {}),
        },
        body: options.body,
      });

      const setCookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
      setCookies.forEach((entry) => {
        const firstSegment = String(entry || "").split(";")[0] || "";
        const separatorIndex = firstSegment.indexOf("=");
        if (separatorIndex <= 0) {
          return;
        }

        const key = firstSegment.slice(0, separatorIndex).trim();
        const value = firstSegment.slice(separatorIndex + 1).trim();
        if (!key) {
          return;
        }
        if (!value) {
          cookies.delete(key);
          return;
        }
        cookies.set(key, value);
      });

      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
      };
    },
  };
}

async function startServer(testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-backup-http-"));
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      POS_DB_PATH: path.join(tempDir, "test.sqlite"),
      POS_BOOTSTRAP_TOKEN: "bootstrap-secret-123",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  testContext.after(async () => {
    await stopServerProcess(child);
    removeDirWithRetry(tempDir);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return { baseUrl };
      }
    } catch (_error) {
      // seguir esperando
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor de prueba a tiempo:\n${logs}`);
}

test("backup status endpoint exposes sync health reported by authenticated clients", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);
  const csrfToken = adminLogin.body.csrfToken;

  const reportResponse = await adminClient.json("/api/client-sync-health", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      deviceId: "tablet-carrizal",
      branch: "carrizal",
      pendingQueueCount: 3,
      blockedQueueCount: 1,
      registerEventsCount: 1,
      online: true,
    }),
  });
  assert.equal(reportResponse.status, 201);

  const backupStatus = await adminClient.json("/api/admin/backups/status", {
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(backupStatus.status, 200);
  assert.equal(backupStatus.body.syncHealth.hasPending, true);
  assert.equal(backupStatus.body.syncHealth.pendingReportCount, 1);
  assert.equal(backupStatus.body.syncHealth.blockedReportCount, 1);
  assert.equal(backupStatus.body.lastRun, null);
  assert.equal(typeof backupStatus.body.generatedAt, "string");
});
