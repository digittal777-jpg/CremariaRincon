const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const {
  SELF_SIGNED_CERT_B64,
  SELF_SIGNED_KEY_B64,
} = require("../support/self-signed-tls");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");
const WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");
const ISOLATED_SERVER_ENV_KEYS = [
  "POS_CONFIG_PATH",
  "POS_PUBLIC_ORIGIN",
  "POS_ALLOWED_ORIGINS",
  "POS_SECURE_COOKIES",
  "POS_FORCE_HTTPS",
  "POS_TRUST_PROXY",
  "POS_HSTS_MAX_AGE_SECONDS",
  "POS_HTTPS_CERT_PATH",
  "POS_HTTPS_KEY_PATH",
  "POS_HTTPS_CA_PATH",
  "POS_HTTPS_CERT_B64",
  "POS_HTTPS_KEY_B64",
  "POS_HTTPS_CA_B64",
  "POS_HTTP_REDIRECT_PORT",
  "CONTROL_API_URL",
  "CONTROL_CLIENT_SLUG",
  "CONTROL_CLIENT_SECRET",
  "CONTROL_REQUIRE_HTTPS",
  "CONTROL_CONFIG_POLL_MS",
  "CONTROL_SYNC_TIMEOUT_MS",
  "CONTROL_CONFIG_SYNC_MAX_AGE_MS",
  "RAILWAY_COST_SAVER_MODE",
  "RAILWAY_PUBLIC_DOMAIN",
  "RAILWAY_STATIC_URL",
];

function buildIsolatedServerEnv(overrides = {}) {
  const nextEnv = { ...process.env };
  ISOLATED_SERVER_ENV_KEYS.forEach((key) => {
    delete nextEnv[key];
  });
  return {
    ...nextEnv,
    ...overrides,
  };
}

async function stopServerProcess(child) {
  if (child.exitCode != null) {
    return;
  }

  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Si el proceso ya cerro, seguimos con la limpieza.
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
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
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
          ...(cookies.size > 0 ? { Cookie: [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
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
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (_error) {
        body = text;
      }

      return {
        status: response.status,
        body,
        headers: response.headers,
      };
    },
  };
}

async function startServer(testContext, { bootstrapToken = "", env = {} } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-hardening-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const runtimePath = path.join(tempDir, "runtime.json");
  const port = 33000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: buildIsolatedServerEnv({
      PORT: String(port),
      POS_DB_PATH: dbPath,
      POS_CONFIG_PATH: runtimePath,
      POS_BOOTSTRAP_TOKEN: bootstrapToken,
      ...env,
    }),
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
        return { baseUrl, dbPath, port };
      }
    } catch (_error) {
      // Seguir esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor de prueba a tiempo:\n${logs}`);
}

async function startHttpsServer(testContext, { bootstrapToken = "", env = {} } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retail-base-hardening-https-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const runtimePath = path.join(tempDir, "runtime.json");
  const port = 34000 + Math.floor(Math.random() * 1000);
  const redirectPort = 35000 + Math.floor(Math.random() * 1000);
  const publicOrigin = `https://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: buildIsolatedServerEnv({
      PORT: String(port),
      POS_DB_PATH: dbPath,
      POS_CONFIG_PATH: runtimePath,
      POS_BOOTSTRAP_TOKEN: bootstrapToken,
      POS_FORCE_HTTPS: "true",
      POS_SECURE_COOKIES: "true",
      POS_PUBLIC_ORIGIN: publicOrigin,
      POS_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      POS_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
      POS_HTTP_REDIRECT_PORT: String(redirectPort),
      ...env,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  testContext.after(async () => {
    await stopServerProcess(child);
    removeDirWithRetry(tempDir);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await rawHttpsRequest(port, "/api/health");
      if (response.status === 200) {
        return { baseUrl: publicOrigin, dbPath, port, redirectPort };
      }
    } catch (_error) {
      // Seguir esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`El servidor HTTPS termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar el servidor HTTPS de prueba a tiempo:\n${logs}`);
}

async function rawHttpRequest(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = require("node:http").request({
      host: options.host || "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let parsedBody = body;
        try {
          parsedBody = body ? JSON.parse(body) : null;
        } catch (_error) {
          parsedBody = body;
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: parsedBody,
        });
      });
    });
    request.on("error", reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

async function rawHttpsRequest(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = require("node:https").request({
      host: options.host || "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: options.headers || {},
      rejectUnauthorized: false,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let parsedBody = body;
        try {
          parsedBody = body ? JSON.parse(body) : null;
        } catch (_error) {
          parsedBody = body;
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: parsedBody,
        });
      });
    });
    request.on("error", reject);
    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function getNonLoopbackIpv4() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const addressInfo of addresses || []) {
      const family = typeof addressInfo?.family === "string"
        ? addressInfo.family
        : Number(addressInfo?.family) === 6
          ? "IPv6"
          : "IPv4";
      if (addressInfo?.address && !addressInfo.internal && family === "IPv4") {
        return addressInfo.address;
      }
    }
  }
  return "";
}

test("POS blocks non-local HTTP APIs when HTTPS is forced", async (t) => {
  const server = await startServer(t, {
    env: {
      POS_FORCE_HTTPS: "true",
      POS_PUBLIC_ORIGIN: "https://pos-secure.example",
      POS_TRUST_PROXY: "loopback,linklocal,uniquelocal",
    },
  });

  const localHealth = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(localHealth.status, 200);

  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const railwayHealthcheck = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "healthcheck.railway.app",
    },
  });
  assert.equal(railwayHealthcheck.status, 200);
  assert.equal(railwayHealthcheck.body.ok, true);

  const railwayProtectedApi = await rawHttpRequest(server.port, "/api/admin/auth/status", {
    host: remoteHost,
    headers: {
      Host: "healthcheck.railway.app",
    },
  });
  assert.equal(railwayProtectedApi.status, 426);
  assert.match(railwayProtectedApi.body.message, /HTTPS requerido/i);

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "localhost",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);

  const insecurePage = await rawHttpRequest(server.port, "/", {
    host: remoteHost,
    headers: {
      Host: "evil.example",
    },
  });
  assert.equal(insecurePage.status, 308);
  assert.equal(String(insecurePage.headers.location || ""), "https://pos-secure.example/");

  const insecureSocket = await rawHttpRequest(server.port, "/socket.io/?EIO=4&transport=polling&t=test", {
    host: remoteHost,
    headers: {
      Host: "localhost",
    },
  });
  assert.notEqual(insecureSocket.status, 200);
  assert.match(String(JSON.stringify(insecureSocket.body || "")), /https|transport error|forbidden/i);

  const forwardedHttps = await rawHttpRequest(server.port, "/api/health", {
    headers: {
      Host: "pos.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(forwardedHttps.status, 200);
  assert.match(String(forwardedHttps.headers["strict-transport-security"] || ""), /max-age=/i);
});

test("POS ignores forged forwarded proto when trust proxy is disabled", async (t) => {
  const server = await startServer(t, {
    env: {
      POS_FORCE_HTTPS: "true",
      POS_PUBLIC_ORIGIN: "https://pos-secure.example",
      POS_TRUST_PROXY: "false",
    },
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "pos.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("POS survives an invalid trust proxy setting and fails closed", async (t) => {
  const server = await startServer(t, {
    env: {
      POS_FORCE_HTTPS: "true",
      POS_PUBLIC_ORIGIN: "https://pos-secure.example",
      POS_TRUST_PROXY: "loopback,???",
    },
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "pos.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("POS rejects overbroad trust proxy settings and fails closed", async (t) => {
  const server = await startServer(t, {
    env: {
      POS_FORCE_HTTPS: "true",
      POS_PUBLIC_ORIGIN: "https://pos-secure.example",
      POS_TRUST_PROXY: "true",
    },
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "pos.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("POS emits browser hardening headers for api and shell responses", async (t) => {
  const server = await startServer(t, {
    env: {
      POS_FORCE_HTTPS: "true",
      POS_PUBLIC_ORIGIN: "https://pos-secure.example",
    },
  });

  const apiHealth = await rawHttpRequest(server.port, "/api/health");
  assert.equal(apiHealth.status, 200);
  assert.match(String(apiHealth.headers["content-security-policy"] || ""), /default-src 'self'/i);
  assert.match(String(apiHealth.headers["content-security-policy"] || ""), /upgrade-insecure-requests/i);
  assert.doesNotMatch(String(apiHealth.headers["content-security-policy"] || ""), /connect-src[^;]* ws:/i);
  assert.match(String(apiHealth.headers["content-security-policy"] || ""), /connect-src[^;]* wss:/i);
  assert.equal(String(apiHealth.headers["cross-origin-opener-policy"] || ""), "same-origin");
  assert.equal(String(apiHealth.headers["cross-origin-resource-policy"] || ""), "same-origin");
  assert.equal(String(apiHealth.headers["origin-agent-cluster"] || ""), "?1");
  assert.equal(String(apiHealth.headers["x-permitted-cross-domain-policies"] || ""), "none");

  const shell = await rawHttpRequest(server.port, "/");
  assert.equal(shell.status, 200);
  assert.equal(String(shell.headers["cache-control"] || ""), "no-store");
  assert.match(String(shell.headers["content-security-policy"] || ""), /script-src 'self'/i);
  assert.match(String(shell.headers["content-security-policy"] || ""), /style-src 'self' https:\/\/fonts\.googleapis\.com/i);
  assert.doesNotMatch(String(shell.headers["content-security-policy"] || ""), /unsafe-inline/i);
  assert.match(String(shell.headers["content-security-policy"] || ""), /font-src 'self' https:\/\/fonts\.gstatic\.com/i);
  assert.match(String(shell.headers["content-security-policy"] || ""), /upgrade-insecure-requests/i);

  const directShell = await rawHttpRequest(server.port, "/index.html");
  assert.equal(directShell.status, 200);
  assert.equal(String(directShell.headers["cache-control"] || ""), "no-store");
});

test("POS can terminate HTTPS directly from owner-managed runtime variables", async (t) => {
  const server = await startHttpsServer(t);

  const secureHealth = await rawHttpsRequest(server.port, "/api/health");
  assert.equal(secureHealth.status, 200);
  assert.match(String(secureHealth.headers["strict-transport-security"] || ""), /max-age=/i);
  assert.match(String(secureHealth.headers["content-security-policy"] || ""), /upgrade-insecure-requests/i);

  const redirectedShell = await rawHttpRequest(server.redirectPort, "/administracion", {
    headers: {
      Host: `127.0.0.1:${server.redirectPort}`,
    },
  });
  assert.equal(redirectedShell.status, 308);
  assert.equal(String(redirectedShell.headers.location || ""), `${server.baseUrl}/administracion`);
});

test("POS direct HTTPS accepts its own local secure origin even without POS_PUBLIC_ORIGIN", async (t) => {
  const server = await startHttpsServer(t, {
    env: {
      POS_PUBLIC_ORIGIN: "",
    },
  });

  const localSecureOrigin = `https://127.0.0.1:${server.port}`;
  const secureHealth = await rawHttpsRequest(server.port, "/api/health", {
    headers: {
      Origin: localSecureOrigin,
    },
  });
  assert.equal(secureHealth.status, 200);
  assert.equal(String(secureHealth.headers["access-control-allow-origin"] || ""), localSecureOrigin);
});

test("setup admin/owner stays blocked when bootstrap token is absent", async (t) => {
  const server = await startServer(t, { bootstrapToken: "" });
  const guest = createCookieClient(server.baseUrl);

  const adminStatus = await guest.json("/api/admin/auth/status");
  assert.equal(adminStatus.status, 200);
  assert.equal(adminStatus.body.configured, false);
  assert.equal(adminStatus.body.setupAllowed, false);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "adminroot", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 403);

  const ownerStatus = await guest.json("/api/owner/auth/status");
  assert.equal(ownerStatus.status, 200);
  assert.equal(ownerStatus.body.configured, false);
  assert.equal(ownerStatus.body.setupAllowed, false);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 403);
});

test("admin and owner login throttles ignore spoofed forwarded-for headers", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);

  const adminLoginOk = await guest.json("/api/admin/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLoginOk.status, 200);

  const cashierCreate = await guest.json("/api/admin/cashiers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminLoginOk.body.csrfToken,
    },
    body: JSON.stringify({
      name: "ana",
      branch: "carrizal",
      password: "1234",
    }),
  });
  assert.equal(cashierCreate.status, 201);

  const otherCashierCreate = await guest.json("/api/admin/cashiers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminLoginOk.body.csrfToken,
    },
    body: JSON.stringify({
      name: "luis",
      branch: "carrizal",
      password: "1234",
    }),
  });
  assert.equal(otherCashierCreate.status, 201);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const adminLogin = await guest.json("/api/admin/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${attempt + 10}`,
      },
      body: JSON.stringify({ username: "diana", password: "mal" }),
    });
    assert.equal(adminLogin.status, 401);
  }

  const blockedAdmin = await guest.json("/api/admin/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.99",
    },
    body: JSON.stringify({ username: "diana", password: "mal" }),
  });
  assert.equal(blockedAdmin.status, 429);
  assert.match(String(blockedAdmin.body?.message || ""), /Demasiados intentos/i);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ownerLogin = await guest.json("/api/owner/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${attempt + 30}`,
      },
      body: JSON.stringify({ username: "ownerroot", password: "mal" }),
    });
    assert.equal(ownerLogin.status, 401);
  }

  const blockedOwner = await guest.json("/api/owner/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.77",
    },
    body: JSON.stringify({ username: "ownerroot", password: "mal" }),
  });
  assert.equal(blockedOwner.status, 429);
  assert.match(String(blockedOwner.body?.message || ""), /Demasiados intentos/i);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cashierLogin = await guest.json("/api/cashier/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `198.51.100.${attempt + 50}`,
      },
      body: JSON.stringify({ name: "ana", branch: "carrizal", password: "mal" }),
    });
    assert.equal(cashierLogin.status, 401);
  }

  const blockedCashier = await guest.json("/api/cashier/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.55",
    },
    body: JSON.stringify({ name: "ana", branch: "carrizal", password: "mal" }),
  });
  assert.equal(blockedCashier.status, 429);
  assert.match(String(blockedCashier.body?.message || ""), /Demasiados intentos/i);

  const otherCashierStillAllowedToAttempt = await guest.json("/api/cashier/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.56",
    },
    body: JSON.stringify({ name: "luis", branch: "carrizal", password: "mal" }),
  });
  assert.equal(otherCashierStillAllowedToAttempt.status, 401);
});

test("auth status endpoints tolerate malformed cookies without crashing", async (t) => {
  const server = await startServer(t);

  const adminStatus = await rawHttpRequest(server.port, "/api/admin/auth/status", {
    headers: {
      Cookie: "cremeria_admin_session=%E0%A4%A",
    },
  });
  assert.equal(adminStatus.status, 200);

  const ownerStatus = await rawHttpRequest(server.port, "/api/owner/auth/status", {
    headers: {
      Cookie: "cremeria_owner_session=%E0%A4%A",
    },
  });
  assert.equal(ownerStatus.status, 200);
});

test("corrupted cashier session rows degrade into logged-out state and get deleted", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
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

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": adminLogin.body.csrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const db = new Database(server.dbPath);

  const cashierRow = db.prepare(`
    SELECT id
    FROM cashiers
    WHERE name = ? AND branch = ? AND active = 1
  `).get("Juan", "carrizal");
  assert.ok(cashierRow?.id);

  db.prepare(`
    INSERT INTO cashier_sessions (token, cashier_id, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "broken-cashier-token",
    cashierRow.id,
    new Date().toISOString(),
    "not-a-date",
    new Date().toISOString(),
  );

  const cashierStatus = await guest.json("/api/cashier/auth/status", {
    headers: {
      "X-Cashier-Token": "broken-cashier-token",
    },
  });
  assert.equal(cashierStatus.status, 200);
  assert.equal(cashierStatus.body.authenticated, false);

  const protectedEndpoint = await guest.json("/api/register/summary?shift=Tarde&branch=carrizal&cashier=Juan", {
    headers: {
      "X-Cashier-Token": "broken-cashier-token",
    },
  });
  assert.equal(protectedEndpoint.status, 401);

  const remainingSession = db.prepare("SELECT token FROM cashier_sessions WHERE token = ?").get("broken-cashier-token");
  assert.equal(remainingSession, undefined);
  db.close();
});

test("client error reports stay bounded per client window", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  let throttledCount = 0;

  for (let index = 0; index < 65; index += 1) {
    const result = await guest.json("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "frontend",
        message: `Falla frontend controlada ${index}`,
        url: "/preflight",
        context: { index },
      }),
    });

    assert.equal(result.status, 202);
    if (result.body?.throttled) {
      throttledCount += 1;
    }
  }

  const db = new Database(server.dbPath, { readonly: true });
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM app_error_reports").get();
  db.close();

  assert.equal(throttledCount, 5);
  assert.equal(count, 60);
});

test("bootstrap token gates setup and owner-only template reset rebuilds the business", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const ownerClient = createCookieClient(server.baseUrl);

  const adminSetupNoToken = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetupNoToken.status, 403);

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
  const adminCsrfToken = adminLogin.body.csrfToken;

  const adminTemplateApply = await adminClient.json("/api/admin/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({ businessName: "Debe fallar" }),
  });
  assert.equal(adminTemplateApply.status, 403);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);

  const ownerLogin = await ownerClient.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCsrfToken = ownerLogin.body.csrfToken;

  const ownerConfig = await ownerClient.json("/api/owner/config", {
    headers: { "X-CSRF-Token": ownerCsrfToken },
  });
  assert.equal(ownerConfig.status, 200);
  const currentSlug = ownerConfig.body.businessProfile.slug;

  const ownerTemplates = await ownerClient.json("/api/owner/templates", {
    headers: { "X-CSRF-Token": ownerCsrfToken },
  });
  assert.equal(ownerTemplates.status, 200);
  assert.ok(Array.isArray(ownerTemplates.body.templates));
  assert.ok(ownerTemplates.body.templates.some((template) => template.key === "cremeria"));

  const failedConfirm = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: WORKBOOK_PATH,
      confirmReset: false,
      confirmText: currentSlug,
    }),
  });
  assert.equal(failedConfirm.status, 409);

  const failedWorkbook = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: ".\\no-existe.xlsx",
      confirmReset: true,
      confirmText: currentSlug,
    }),
  });
  assert.equal(failedWorkbook.status, 400);

  const appliedTemplate = await ownerClient.json("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      businessName: "Negocio Duro",
      slug: "negocio-duro",
      workbookPath: WORKBOOK_PATH,
      confirmReset: true,
      confirmText: currentSlug,
    }),
  });
  assert.equal(appliedTemplate.status, 200);
  assert.equal(appliedTemplate.body.requiresReauth, true);
  assert.ok(appliedTemplate.body.importedCount > 0);
  assert.equal(appliedTemplate.body.businessProfile.businessName, "Negocio Duro");
  assert.equal(appliedTemplate.body.snapshot.profile.businessName, "Negocio Duro");
  assert.ok(Array.isArray(appliedTemplate.body.snapshot.products));
  assert.ok(appliedTemplate.body.snapshot.products.length > 0);
  assert.ok(
    appliedTemplate.body.snapshot.products.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );
  assert.deepEqual(appliedTemplate.body.snapshot.recentSales, []);
  assert.deepEqual(appliedTemplate.body.snapshot.recentActivity, []);

  const adminStatusAfter = await guest.json("/api/admin/auth/status");
  assert.equal(adminStatusAfter.status, 200);
  assert.equal(adminStatusAfter.body.configured, false);
  assert.equal(adminStatusAfter.body.authenticated, false);
  assert.equal(adminStatusAfter.body.setupAllowed, true);

  const ownerStatusAfter = await guest.json("/api/owner/auth/status");
  assert.equal(ownerStatusAfter.status, 200);
  assert.equal(ownerStatusAfter.body.configured, true);
  assert.equal(ownerStatusAfter.body.authenticated, false);
  assert.equal(ownerStatusAfter.body.setupAllowed, false);

  const manifestResponse = await fetch(`${server.baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "Negocio Duro");
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.length > 0);

  const homeResponse = await fetch(`${server.baseUrl}/`);
  assert.equal(homeResponse.status, 200);
  const homeHtml = await homeResponse.text();
  assert.match(homeHtml, /<title>Punto de Venta \| POS<\/title>/);
  assert.doesNotMatch(homeHtml, /Cremeria El Rincon/);
});

test("owner can persist an empty admin capability set and bootstrap preserves mixed owner/admin sessions", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const ownerClient = createCookieClient(server.baseUrl);
  const mixedClient = createCookieClient(server.baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);

  const ownerLogin = await ownerClient.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCsrfToken = ownerLogin.body.csrfToken;

  const mixedAdminLogin = await mixedClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(mixedAdminLogin.status, 200);
  const mixedOwnerLogin = await mixedClient.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(mixedOwnerLogin.status, 200);

  const ownerConfigUpdate = await ownerClient.json("/api/owner/config", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({
      adminCapabilities: [],
    }),
  });
  assert.equal(ownerConfigUpdate.status, 200);
  assert.deepEqual(ownerConfigUpdate.body.adminCapabilities, []);

  const ownerConfig = await ownerClient.json("/api/owner/config", {
    headers: { "X-CSRF-Token": ownerCsrfToken },
  });
  assert.equal(ownerConfig.status, 200);
  assert.deepEqual(ownerConfig.body.adminCapabilities, []);

  const ownerBootstrap = await ownerClient.json("/api/bootstrap?branch=carrizal");
  assert.equal(ownerBootstrap.status, 200);
  assert.equal(ownerBootstrap.body.auth.role, "owner");
  assert.equal(ownerBootstrap.body.auth.ownerAuthenticated, true);
  assert.equal(ownerBootstrap.body.auth.adminAuthenticated, false);
  assert.deepEqual(ownerBootstrap.body.adminCapabilities, []);

  const adminBootstrap = await adminClient.json("/api/bootstrap?branch=carrizal");
  assert.equal(adminBootstrap.status, 200);
  assert.equal(adminBootstrap.body.auth.role, "admin");
  assert.equal(adminBootstrap.body.auth.ownerAuthenticated, false);
  assert.equal(adminBootstrap.body.auth.adminAuthenticated, true);
  assert.equal(adminBootstrap.body.auth.permissions.canViewAdmin, false);
  assert.deepEqual(adminBootstrap.body.adminCapabilities, []);
  assert.deepEqual(adminBootstrap.body.recentSales, []);
  assert.deepEqual(adminBootstrap.body.recentActivity, []);
  assert.deepEqual(adminBootstrap.body.lowStock, []);
  assert.ok(
    adminBootstrap.body.products.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );
  assert.ok(
    adminBootstrap.body.inventoryProducts.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );

  const blockedAdminSettings = await adminClient.json("/api/admin/settings");
  assert.equal(blockedAdminSettings.status, 403);

  const blockedAdminDashboard = await adminClient.json("/api/dashboard?branch=all");
  assert.equal(blockedAdminDashboard.status, 200);
  assert.deepEqual(blockedAdminDashboard.body.recentSales, []);
  assert.ok(
    blockedAdminDashboard.body.products.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );

  const blockedAdminProduct = await adminClient.json("/api/products/1?branch=carrizal");
  assert.equal(blockedAdminProduct.status, 403);

  const mixedBootstrap = await mixedClient.json("/api/bootstrap?branch=carrizal");
  assert.equal(mixedBootstrap.status, 200);
  assert.equal(mixedBootstrap.body.auth.role, "owner");
  assert.equal(mixedBootstrap.body.auth.ownerAuthenticated, true);
  assert.equal(mixedBootstrap.body.auth.adminAuthenticated, true);
  assert.equal(mixedBootstrap.body.auth.permissions.canViewAdmin, true);
  assert.deepEqual(mixedBootstrap.body.adminCapabilities, []);
});

test("service subscription billing writes require owner even when admin can view support tools", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const ownerClient = createCookieClient(server.baseUrl);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);

  const adminLogin = await adminClient.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCsrfToken = adminLogin.body.csrfToken;

  const adminView = await adminClient.json("/api/admin/service-subscription");
  assert.equal(adminView.status, 200);

  const blockedAdminSubscriptionUpdate = await adminClient.json("/api/admin/service-subscription", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({ status: "active", monthlyAmount: 999 }),
  });
  assert.equal(blockedAdminSubscriptionUpdate.status, 401);

  const blockedAdminPayment = await adminClient.json("/api/admin/service-subscription/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({ amount: 999, periodStart: "2026-07-01", periodEnd: "2026-07-31" }),
  });
  assert.equal(blockedAdminPayment.status, 401);

  const ownerLogin = await ownerClient.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCsrfToken = ownerLogin.body.csrfToken;

  const ownerUpdate = await ownerClient.json("/api/owner/service-subscription", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({ status: "overdue", monthlyAmount: 999 }),
  });
  assert.equal(ownerUpdate.status, 200);
  assert.equal(ownerUpdate.body.subscription.status, "overdue");

  const ownerPayment = await ownerClient.json("/api/owner/service-subscription/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerCsrfToken,
    },
    body: JSON.stringify({ amount: 999, periodStart: "2026-07-01", periodEnd: "2026-07-31" }),
  });
  assert.equal(ownerPayment.status, 201);
  assert.equal(ownerPayment.body.subscription.status, "active");
  assert.equal(ownerPayment.body.subscription.monthlyAmount, 999);
});

test("corrupted owner capability settings fall back to defaults instead of blocking admin", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
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

  const db = new Database(server.dbPath);
  try {
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("owner.admin_capabilities", JSON.stringify(["legacy_unknown_capability"]), new Date().toISOString());
  } finally {
    db.close();
  }

  const adminBootstrap = await adminClient.json("/api/bootstrap?branch=carrizal");
  assert.equal(adminBootstrap.status, 200);
  assert.ok(Array.isArray(adminBootstrap.body.adminCapabilities));
  assert.ok(adminBootstrap.body.adminCapabilities.length > 0);

  const adminSettings = await adminClient.json("/api/admin/settings");
  assert.equal(adminSettings.status, 200);
});

test("corrupted owner/admin password records degrade into recoverable setup instead of crashing auth", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);

  const db = new Database(server.dbPath);
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("admin.username", "diana", now);
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("admin.password", JSON.stringify({ salt: "bad", hash: "deadbeef" }), now);
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("owner.username", "ownerroot", now);
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run("owner.password", JSON.stringify({ salt: "oops", hash: "beef" }), now);
  } finally {
    db.close();
  }

  const adminStatus = await guest.json("/api/admin/auth/status");
  assert.equal(adminStatus.status, 200);
  assert.equal(adminStatus.body.configured, false);
  assert.equal(adminStatus.body.setupAllowed, true);

  const adminLogin = await guest.json("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminLogin.status, 401);

  const adminSetup = await guest.json("/api/admin/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "diana", password: "admin1234" }),
  });
  assert.equal(adminSetup.status, 201);

  const ownerStatus = await guest.json("/api/owner/auth/status");
  assert.equal(ownerStatus.status, 200);
  assert.equal(ownerStatus.body.configured, false);
  assert.equal(ownerStatus.body.setupAllowed, true);

  const ownerLogin = await guest.json("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 401);

  const ownerSetup = await guest.json("/api/owner/auth/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Token": "bootstrap-secret-123",
    },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerSetup.status, 201);
});

test("guest bootstrap hides operational data while authenticated flows keep working", async (t) => {
  const server = await startServer(t, { bootstrapToken: "bootstrap-secret-123" });
  const guest = createCookieClient(server.baseUrl);
  const adminClient = createCookieClient(server.baseUrl);
  const cashierClient = createCookieClient(server.baseUrl);

  const guestBootstrap = await guest.json("/api/bootstrap?branch=carrizal");
  assert.equal(guestBootstrap.status, 200);
  assert.equal(guestBootstrap.body.auth.role, "guest");
  assert.deepEqual(guestBootstrap.body.recentSales, []);
  assert.deepEqual(guestBootstrap.body.recentActivity, []);
  assert.deepEqual(guestBootstrap.body.lowStock, []);
  assert.ok(Array.isArray(guestBootstrap.body.products));
  assert.ok(Array.isArray(guestBootstrap.body.inventoryProducts));
  assert.ok(
    guestBootstrap.body.products.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );
  assert.ok(
    guestBootstrap.body.inventoryProducts.every((product) =>
      Number(product.stock || 0) === 0
      && product.stockInitialized === false
    ),
  );

  const guestDashboard = await guest.json("/api/dashboard?branch=carrizal");
  assert.equal(guestDashboard.status, 401);

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
  const adminCsrfToken = adminLogin.body.csrfToken;

  const manualProduct = await adminClient.json("/api/admin/products/manual", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      name: "Producto Smoke",
      branch: "carrizal",
      price: 18.5,
      stock: 5,
      minStock: 1,
      category: "general",
      unit: "pza",
    }),
  });
  assert.equal(manualProduct.status, 201);
  assert.equal(manualProduct.body.product.name, "Producto Smoke");

  const adminProducts = await adminClient.json("/api/admin/products?branch=carrizal", {
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(adminProducts.status, 200);
  assert.ok(Array.isArray(adminProducts.body.products));
  assert.ok(adminProducts.body.products.some((product) => product.name === "Producto Smoke"));

  const initCashiers = await adminClient.json("/api/admin/cashiers/init-test", {
    method: "POST",
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(initCashiers.status, 200);

  const cashierLogin = await cashierClient.json("/api/cashier/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Juan", branch: "carrizal", password: "1234" }),
  });
  assert.equal(cashierLogin.status, 200);
  assert.equal(cashierLogin.body.authenticated, true);
  const cashierToken = cashierLogin.body.token;

  const cashierBootstrap = await cashierClient.json("/api/bootstrap?branch=miradores", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierBootstrap.status, 200);
  assert.equal(cashierBootstrap.body.auth.role, "cashier");
  assert.equal(cashierBootstrap.body.store.currentBranch, "carrizal");
  const smokeProduct = cashierBootstrap.body.products.find((product) => product.name === "Producto Smoke");
  assert.ok(smokeProduct);
  assert.ok(smokeProduct.stock >= 5);

  const saleResponse = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Efectivo",
      receivedAmount: 18.5,
      items: [
        {
          productId: smokeProduct.id,
          productName: smokeProduct.name,
          quantity: 1,
          unitPrice: smokeProduct.price,
          lineTotal: smokeProduct.price,
        },
      ],
    }),
  });
  assert.equal(saleResponse.status, 201);
  assert.equal(saleResponse.body.sale.branch, "carrizal");
  const saleId = saleResponse.body.sale.id;

  const missingCustomerCreditSale = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Fiado",
      receivedAmount: 0,
      items: [
        {
          productId: smokeProduct.id,
          productName: smokeProduct.name,
          quantity: 1,
          unitPrice: smokeProduct.price,
          lineTotal: smokeProduct.price,
        },
      ],
    }),
  });
  assert.equal(missingCustomerCreditSale.status, 400);

  const creditSaleResponse = await cashierClient.json("/api/sales", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      shift: "Tarde",
      paymentMethod: "Fiado",
      customerName: "Cliente Demo",
      notes: "Paga el viernes",
      receivedAmount: 10,
      receivedPaymentMethod: "Efectivo",
      items: [
        {
          productId: smokeProduct.id,
          productName: smokeProduct.name,
          quantity: 1,
          unitPrice: smokeProduct.price,
          lineTotal: smokeProduct.price,
        },
      ],
    }),
  });
  assert.equal(creditSaleResponse.status, 201);
  assert.equal(creditSaleResponse.body.sale.customerName, "Cliente Demo");
  assert.equal(creditSaleResponse.body.sale.receivedAmount, 10);
  assert.equal(creditSaleResponse.body.sale.receivedPaymentMethod, "Efectivo");
  assert.equal(creditSaleResponse.body.sale.pendingAmount, 8.5);
  const creditSaleId = creditSaleResponse.body.sale.id;

  const registerSummary = await cashierClient.json(
    `/api/register/summary?shift=Tarde&branch=carrizal&cashier=${encodeURIComponent("Juan")}`,
    {
      headers: { "X-Cashier-Token": cashierToken },
    },
  );
  assert.equal(registerSummary.status, 200);
  assert.equal(registerSummary.body.summary.cashSales, 28.5);
  assert.equal(registerSummary.body.summary.creditSales, 8.5);
  assert.equal(registerSummary.body.summary.expectedCash, 28.5);

  const receivables = await cashierClient.json("/api/receivables?search=Cliente", {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(receivables.status, 200);
  assert.equal(receivables.body.customers.length, 1);
  assert.equal(receivables.body.customers[0].customerName, "Cliente Demo");
  assert.equal(receivables.body.customers[0].pendingAmount, 8.5);

  const receivableDetail = await cashierClient.json(
    `/api/receivables/customer/${encodeURIComponent(receivables.body.customers[0].customerKey)}`,
    {
      headers: { "X-Cashier-Token": cashierToken },
    },
  );
  assert.equal(receivableDetail.status, 200);
  assert.equal(receivableDetail.body.customer.sales.length, 1);
  assert.equal(receivableDetail.body.customer.sales[0].pendingAmount, 8.5);

  const receivablePayment = await cashierClient.json("/api/receivables/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cashier-Token": cashierToken,
    },
    body: JSON.stringify({
      saleId: creditSaleId,
      shift: "Tarde",
      amount: 5,
      paymentMethod: "Efectivo",
      notes: "Abono de prueba",
    }),
  });
  assert.equal(receivablePayment.status, 201);
  assert.equal(receivablePayment.body.payment.amount, 5);
  assert.equal(receivablePayment.body.customer.pendingAmount, 3.5);

  const registerSummaryAfterPayment = await cashierClient.json(
    `/api/register/summary?shift=Tarde&branch=carrizal&cashier=${encodeURIComponent("Juan")}`,
    {
      headers: { "X-Cashier-Token": cashierToken },
    },
  );
  assert.equal(registerSummaryAfterPayment.status, 200);
  assert.equal(registerSummaryAfterPayment.body.summary.cashSales, 33.5);
  assert.equal(registerSummaryAfterPayment.body.summary.creditSales, 3.5);
  assert.equal(registerSummaryAfterPayment.body.summary.expectedCash, 33.5);

  const guestActivity = await guest.json(`/api/activity/sale/${saleId}`);
  assert.equal(guestActivity.status, 401);

  const cashierActivity = await cashierClient.json(`/api/activity/sale/${saleId}`, {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierActivity.status, 200);
  assert.equal(cashierActivity.body.kind, "sale");
  assert.equal(cashierActivity.body.detail.branch, "carrizal");

  const cashierCreditSaleActivity = await cashierClient.json(`/api/activity/sale/${creditSaleId}`, {
    headers: { "X-Cashier-Token": cashierToken },
  });
  assert.equal(cashierCreditSaleActivity.status, 200);
  assert.equal(cashierCreditSaleActivity.body.detail.paidAmount, 15);
  assert.equal(cashierCreditSaleActivity.body.detail.laterPaymentsTotal, 5);
  assert.equal(cashierCreditSaleActivity.body.detail.pendingAmount, 3.5);
  assert.equal(cashierCreditSaleActivity.body.detail.payments.length, 1);

  const receivablePaymentActivity = await cashierClient.json(
    `/api/activity/credit-payment/${receivablePayment.body.payment.id}`,
    {
      headers: { "X-Cashier-Token": cashierToken },
    },
  );
  assert.equal(receivablePaymentActivity.status, 200);
  assert.equal(receivablePaymentActivity.body.kind, "credit-payment");
  assert.equal(receivablePaymentActivity.body.detail.amount, 5);

  const quickImport = await adminClient.json("/api/inventory/quick-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      productId: smokeProduct.id,
      branch: "carrizal",
      mode: "receive",
      quantity: 2,
      supplierName: "Proveedor Smoke",
    }),
  });
  assert.equal(quickImport.status, 200);

  const editorData = await adminClient.json("/api/admin/editor-data?branch=carrizal", {
    headers: { "X-CSRF-Token": adminCsrfToken },
  });
  assert.equal(editorData.status, 200);
  const movement = editorData.body.inventoryMovements.find((item) =>
    item.productId === smokeProduct.id && item.movementType !== "sale");
  assert.ok(movement);

  const patchedMovement = await adminClient.json(`/api/admin/inventory-movements/${movement.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken,
    },
    body: JSON.stringify({
      quantityDelta: 3,
      note: "Ajuste smoke",
    }),
  });
  assert.equal(patchedMovement.status, 200);
  assert.equal(patchedMovement.body.movement.quantityDelta, 3);
});
