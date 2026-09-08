const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { test } = require("node:test");
const {
  SELF_SIGNED_CERT_B64,
  SELF_SIGNED_KEY_B64,
} = require("../support/self-signed-tls");
const Database = require("better-sqlite3");

const { createApp } = require("../../owner-control/src/app");
const { createControlStore } = require("../../owner-control/src/store");
const OWNER_CONTROL_SERVER_PATH = path.resolve(__dirname, "..", "..", "owner-control", "server.js");
const OWNER_CONTROL_ROOT = path.dirname(OWNER_CONTROL_SERVER_PATH);

async function startOwnerControlServer(t, appOptions = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const app = createApp({
    dbPath,
    ownerToken: "test-owner-token",
    ...appOptions,
  });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.controlStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return { app, baseUrl, port: address.port };
}

async function stopProcess(child) {
  if (child.exitCode != null) {
    return;
  }
  child.kill();
  try {
    await once(child, "exit");
  } catch (_error) {
    // Si ya termino, seguimos.
  }
}

async function startOwnerControlHttpsProcess(t, env = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-https-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const port = 36000 + Math.floor(Math.random() * 1000);
  const redirectPort = 37000 + Math.floor(Math.random() * 1000);
  const baseUrl = `https://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [OWNER_CONTROL_SERVER_PATH], {
    cwd: OWNER_CONTROL_ROOT,
    env: {
      ...process.env,
      OWNER_CONTROL_PORT: String(port),
      OWNER_CONTROL_DB_PATH: dbPath,
      OWNER_CONTROL_TOKEN: "test-owner-token",
      OWNER_CONTROL_FORCE_HTTPS: "true",
      OWNER_CONTROL_PUBLIC_ORIGIN: baseUrl,
      OWNER_CONTROL_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      OWNER_CONTROL_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
      OWNER_CONTROL_HTTP_REDIRECT_PORT: String(redirectPort),
      ...env,
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

  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await rawHttpsRequest(port, "/api/health");
      if (response.status === 200) {
        return { baseUrl, port, redirectPort };
      }
    } catch (_error) {
      // Seguimos esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`owner-control HTTPS termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar owner-control HTTPS a tiempo:\n${logs}`);
}

async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...(options.headers || {}),
    },
    body: options.body,
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
  };
}

async function rawHttpRequest(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
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

function ownerHeaders(token = "test-owner-token") {
  return {
    "Content-Type": "application/json",
    "X-Owner-Control-Token": token,
  };
}

function clientHeaders(slug, apiKey) {
  return {
    "Content-Type": "application/json",
    "X-Client-Slug": slug,
    Authorization: `Bearer ${apiKey}`,
  };
}

function signedClientHeaders(slug, apiKey, method, pathname, body = "") {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = [
    String(method || "GET").toUpperCase(),
    pathname,
    timestamp,
    nonce,
    body,
  ].join("\n");
  return {
    ...clientHeaders(slug, apiKey),
    "X-Client-Timestamp": timestamp,
    "X-Client-Nonce": nonce,
    "X-Client-Signature": crypto.createHmac("sha256", apiKey).update(payload).digest("hex"),
  };
}

test("owner-control prunes rate limit buckets beyond the configured cap", async (t) => {
  const server = await startOwnerControlServer(t, {
    apiRateLimitBucketLimit: 2,
  });

  for (let index = 0; index < 6; index += 1) {
    const response = await json(server.baseUrl, `/api/audit-bucket/${index}`);
    assert.equal(response.status, 404);
  }

  assert.ok(server.app.locals.rateLimitBuckets.size <= 2);
});

test("owner-control prunes health and validation reports per client", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-retention-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const store = createControlStore({
    dbPath,
    healthReportRetentionLimit: 3,
    validationReportRetentionLimit: 2,
  });

  const { client } = store.createClient({
    slug: "cliente-retencion",
    businessName: "Cliente Retencion",
    baseUrl: "https://retencion.example.com",
  });

  for (let index = 0; index < 6; index += 1) {
    store.receiveHealthReport(client, {
      health: {
        status: index % 2 === 0 ? "ok" : "risk",
        semaphore: {
          status: index % 2 === 0 ? "ok" : "risk",
          reasons: [`reason-${index}`],
          actions: [],
        },
      },
      reportedAt: new Date(Date.UTC(2026, 6, 1, 12, index)).toISOString(),
    });
  }

  for (let index = 0; index < 5; index += 1) {
    store.receiveValidationReport(client, {
      status: index % 2 === 0 ? "ok" : "warning",
      url: `https://retencion.example.com/${index}`,
      checks: [{ name: `check-${index}`, ok: index % 2 === 0 }],
      reportedAt: new Date(Date.UTC(2026, 6, 1, 13, index)).toISOString(),
    });
  }

  const db = new Database(dbPath, { readonly: true });

  t.after(() => {
    db.close();
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const healthCount = db.prepare("SELECT COUNT(*) AS count FROM health_reports WHERE client_slug = ?").get(client.slug);
  const validationCount = db.prepare("SELECT COUNT(*) AS count FROM validation_reports WHERE client_slug = ?").get(client.slug);
  assert.equal(healthCount.count, 3);
  assert.equal(validationCount.count, 2);
});

test("owner-control owner API fails closed when no owner token is configured", async (t) => {
  const server = await startOwnerControlServer(t, {
    ownerToken: "",
  });

  const response = await json(server.baseUrl, "/api/owner/clients", {
    headers: ownerHeaders("dev-owner-token"),
  });
  assert.equal(response.status, 401);
  assert.match(String(response.body?.message || ""), /token owner central/i);
});

test("owner-control HTTPS process requires explicit OWNER_CONTROL_TOKEN", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-secure-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const port = 38000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [OWNER_CONTROL_SERVER_PATH], {
    cwd: OWNER_CONTROL_ROOT,
    env: {
      ...process.env,
      OWNER_CONTROL_PORT: String(port),
      OWNER_CONTROL_DB_PATH: dbPath,
      OWNER_CONTROL_TOKEN: "",
      OWNER_CONTROL_FORCE_HTTPS: "true",
      OWNER_CONTROL_PUBLIC_ORIGIN: "https://owner-control.example",
      OWNER_CONTROL_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      OWNER_CONTROL_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
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

  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const [exitCode] = await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("owner-control no cerro a tiempo sin token owner.")), 5000)),
  ]);

  assert.notEqual(exitCode, 0);
  assert.match(logs, /OWNER_CONTROL_TOKEN debe configurarse/i);
});

test("owner-control local process still generates a temporary token when trust proxy is explicitly disabled", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-local-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [OWNER_CONTROL_SERVER_PATH], {
    cwd: OWNER_CONTROL_ROOT,
    env: {
      ...process.env,
      OWNER_CONTROL_PORT: String(port),
      OWNER_CONTROL_DB_PATH: dbPath,
      OWNER_CONTROL_TOKEN: "",
      OWNER_CONTROL_TRUST_PROXY: "false",
      OWNER_CONTROL_PUBLIC_ORIGIN: "",
      OWNER_CONTROL_FORCE_HTTPS: "false",
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

  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await rawHttpRequest(port, "/api/health");
      if (response.status === 200) {
        assert.match(logs, /Token owner-control temporal solo para esta sesion: owner_/i);
        return;
      }
    } catch (_error) {
      // Seguimos esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`owner-control local termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`No pude levantar owner-control local con trust proxy desactivado:\n${logs}`);
});

test("owner-control rejects non-local HTTP when HTTPS is forced", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
    trustProxy: "loopback,linklocal,uniquelocal",
  });

  const localHealth = await json(server.baseUrl, "/api/health");
  assert.equal(localHealth.status, 200);

  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

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
  assert.equal(String(insecurePage.headers.location || ""), "https://owner-control.example/");

  const forwardedHttps = await rawHttpRequest(server.port, "/api/health", {
    headers: {
      Host: "owner.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(forwardedHttps.status, 200);
  assert.match(String(forwardedHttps.headers["strict-transport-security"] || ""), /max-age=/i);
});

test("owner-control ignores forged forwarded proto when trust proxy is disabled", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
    trustProxy: "false",
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "owner.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("owner-control survives an invalid trust proxy setting and fails closed", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
    trustProxy: "loopback,???",
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "owner.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("owner-control rejects overbroad trust proxy settings and fails closed", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
    trustProxy: "true",
  });
  const remoteHost = getNonLoopbackIpv4();
  assert.ok(remoteHost, "No encontre una IPv4 local para probar trafico HTTP no-loopback.");

  const insecureApi = await rawHttpRequest(server.port, "/api/health", {
    host: remoteHost,
    headers: {
      Host: "owner.example",
      "X-Forwarded-Proto": "https",
    },
  });
  assert.equal(insecureApi.status, 426);
  assert.match(insecureApi.body.message, /HTTPS requerido/i);
});

test("owner-control emits browser hardening headers and keeps html out of cache", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
  });

  const apiHealth = await rawHttpRequest(server.port, "/api/health");
  assert.equal(apiHealth.status, 200);
  assert.match(String(apiHealth.headers["content-security-policy"] || ""), /default-src 'self'/i);
  assert.match(String(apiHealth.headers["content-security-policy"] || ""), /upgrade-insecure-requests/i);
  assert.equal(String(apiHealth.headers["cross-origin-opener-policy"] || ""), "same-origin");
  assert.equal(String(apiHealth.headers["cross-origin-resource-policy"] || ""), "same-origin");
  assert.equal(String(apiHealth.headers["origin-agent-cluster"] || ""), "?1");
  assert.equal(String(apiHealth.headers["x-permitted-cross-domain-policies"] || ""), "none");

  const shell = await rawHttpRequest(server.port, "/");
  assert.equal(shell.status, 200);
  assert.match(String(shell.headers["content-security-policy"] || ""), /script-src 'self'/i);
  assert.match(String(shell.headers["content-security-policy"] || ""), /style-src 'self'/i);
  assert.doesNotMatch(String(shell.headers["content-security-policy"] || ""), /unsafe-inline/i);
  assert.equal(String(shell.headers["cache-control"] || ""), "no-store");

  const directShell = await rawHttpRequest(server.port, "/index.html");
  assert.equal(directShell.status, 200);
  assert.equal(String(directShell.headers["cache-control"] || ""), "no-store");
});

test("owner-control can terminate HTTPS directly with certificate runtime variables", async (t) => {
  const server = await startOwnerControlHttpsProcess(t);

  const secureHealth = await rawHttpsRequest(server.port, "/api/health");
  assert.equal(secureHealth.status, 200);
  assert.match(String(secureHealth.headers["strict-transport-security"] || ""), /max-age=/i);
  assert.match(String(secureHealth.headers["content-security-policy"] || ""), /upgrade-insecure-requests/i);

  const redirectedShell = await rawHttpRequest(server.redirectPort, "/", {
    headers: {
      Host: `127.0.0.1:${server.redirectPort}`,
    },
  });
  assert.equal(redirectedShell.status, 308);
  assert.equal(String(redirectedShell.headers.location || ""), `${server.baseUrl}/`);
});

test("owner-control enables signed client API requests by default when HTTPS is forced", async (t) => {
  const server = await startOwnerControlServer(t, {
    forceHttps: true,
    publicOrigin: "https://owner-control.example",
    trustProxy: "loopback,linklocal,uniquelocal",
  });

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cliente-https-firmado",
      businessName: "Cliente HTTPS Firmado",
      baseUrl: "http://localhost:3100",
    }),
  });
  assert.equal(createResponse.status, 201);
  const apiKey = createResponse.body.apiKey;

  const unsigned = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cliente-https-firmado", apiKey),
  });
  assert.equal(unsigned.status, 401);

  const signed = await json(server.baseUrl, "/api/client/subscription", {
    headers: signedClientHeaders("cliente-https-firmado", apiKey, "GET", "/api/client/subscription"),
  });
  assert.equal(signed.status, 200);
});

test("owner-control rejects POS pairing variables in managed runtime", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "https://rincon.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const runtimeUpdate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        CONTROL_API_URL: "http://owner-control.example",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 400);
  assert.match(runtimeUpdate.body.message, /CONTROL_API_URL forman el emparejamiento inicial/i);
});

test("owner-control stores its own runtime HTTPS config and marks restart pending", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-runtime-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const store = createControlStore({ dbPath });
  const bootValues = store.getOwnerRuntimeValues();
  const app = createApp({
    dbPath,
    store,
    ownerToken: "test-owner-token",
    ownerRuntimeBootValues: bootValues,
  });
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.controlStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const runtimeUpdate = await json(baseUrl, "/api/owner/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        OWNER_CONTROL_PUBLIC_ORIGIN: "https://owner-control.example",
        OWNER_CONTROL_FORCE_HTTPS: "true",
        OWNER_CONTROL_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
        OWNER_CONTROL_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
        OWNER_CONTROL_TOKEN: "owner_runtime_token_12345678901234567890",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 200);
  assert.equal(runtimeUpdate.body.runtimeConfig.restartRequired, true);
  assert.equal(runtimeUpdate.body.runtimeConfig.pendingKeys.includes("OWNER_CONTROL_PUBLIC_ORIGIN"), true);
  assert.equal(runtimeUpdate.body.runtimeConfig.pendingKeys.includes("OWNER_CONTROL_TOKEN"), true);
  const tokenVariable = runtimeUpdate.body.runtimeConfig.variables.find((variable) => variable.key === "OWNER_CONTROL_TOKEN");
  assert.equal(tokenVariable.hasStoredValue, true);
  assert.equal(tokenVariable.maskedValue, "********");
  assert.equal(tokenVariable.value, "");
  assert.equal(tokenVariable.pendingRestart, true);

  const runtimeRead = await json(baseUrl, "/api/owner/runtime-config", {
    headers: ownerHeaders(),
  });
  assert.equal(runtimeRead.status, 200);
  assert.equal(runtimeRead.body.runtimeConfig.restartRequired, true);
  assert.match(String(runtimeRead.body.runtimeConfig.message || ""), /Reinicia el proceso Node/i);
});

test("owner-control rejects insecure owner runtime URLs at save time", async (t) => {
  const server = await startOwnerControlServer(t);

  const runtimeUpdate = await json(server.baseUrl, "/api/owner/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        OWNER_CONTROL_PUBLIC_ORIGIN: "http://owner-control.example",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 400);
  assert.match(runtimeUpdate.body.message, /OWNER_CONTROL_PUBLIC_ORIGIN debe usar HTTPS fuera de localhost/i);
});

test("owner-control rejects invalid trust proxy runtime values at save time", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "https://rincon.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const runtimeUpdate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_TRUST_PROXY: "loopback,???",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 400);
  assert.match(runtimeUpdate.body.message, /POS_TRUST_PROXY no es una lista valida de proxies confiables/i);

  const wildcardTrustProxy = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_TRUST_PROXY: "true",
      },
    }),
  });
  assert.equal(wildcardTrustProxy.status, 400);
  assert.match(wildcardTrustProxy.body.message, /POS_TRUST_PROXY debe listar proxies confiables explicitos/i);
});

test("owner-control rejects invalid HTTPS PEM base64 at save time", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "https://rincon.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const runtimeUpdate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_HTTPS_KEY_B64: "no-es-pem",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 400);
  assert.match(String(runtimeUpdate.body?.message || ""), /POS_HTTPS_KEY_B64 debe ser base64 valido|POS_HTTPS_KEY_B64 debe contener un PEM codificado en base64/i);
});

test("owner-control can boot HTTPS from its saved runtime config", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-control-runtime-boot-"));
  const dbPath = path.join(tempDir, "owner-control.sqlite");
  const port = 38000 + Math.floor(Math.random() * 1000);
  const redirectPort = 39000 + Math.floor(Math.random() * 1000);
  const baseUrl = `https://127.0.0.1:${port}`;
  const store = createControlStore({ dbPath });
  store.updateOwnerRuntimeConfig({
    values: {
      OWNER_CONTROL_PUBLIC_ORIGIN: baseUrl,
      OWNER_CONTROL_FORCE_HTTPS: "true",
      OWNER_CONTROL_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      OWNER_CONTROL_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
      OWNER_CONTROL_HTTP_REDIRECT_PORT: String(redirectPort),
      OWNER_CONTROL_TOKEN: "owner_runtime_boot_token_1234567890",
    },
  });
  store.close();

  const child = spawn(process.execPath, [OWNER_CONTROL_SERVER_PATH], {
    cwd: OWNER_CONTROL_ROOT,
    env: {
      ...process.env,
      OWNER_CONTROL_PORT: String(port),
      OWNER_CONTROL_DB_PATH: dbPath,
      OWNER_CONTROL_TOKEN: "",
      OWNER_CONTROL_FORCE_HTTPS: "",
      OWNER_CONTROL_PUBLIC_ORIGIN: "",
      OWNER_CONTROL_HTTPS_CERT_B64: "",
      OWNER_CONTROL_HTTPS_KEY_B64: "",
      OWNER_CONTROL_HTTP_REDIRECT_PORT: "",
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

  t.after(async () => {
    await stopProcess(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await rawHttpsRequest(port, "/api/health");
      if (response.status === 200) {
        const redirect = await rawHttpRequest(redirectPort, "/");
        assert.equal(String(redirect.headers.location || ""), `${baseUrl}/`);
        const runtime = await rawHttpsRequest(port, "/api/owner/runtime-config", {
          headers: {
            "X-Owner-Control-Token": "owner_runtime_boot_token_1234567890",
          },
        });
        assert.equal(runtime.status, 200);
        assert.equal(runtime.body.runtimeConfig.restartRequired, false);
        assert.deepEqual(runtime.body.runtimeConfig.pendingKeys, []);
        return;
      }
    } catch (_error) {
      // Seguimos esperando.
    }

    if (child.exitCode != null) {
      throw new Error(`owner-control runtime HTTPS termino antes de responder:\n${logs}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No pude levantar owner-control HTTPS desde runtime guardado:\n${logs}`);
});

test("owner-control rejects broken direct HTTPS runtime combinations at save time", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "https://rincon.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const missingKey = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      },
    }),
  });
  assert.equal(missingKey.status, 400);
  assert.match(String(missingKey.body?.message || ""), /POS_HTTPS_CERT_\* y POS_HTTPS_KEY_\* deben configurarse juntos/i);

  const redirectWithoutTls = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_HTTP_REDIRECT_PORT: "80",
      },
    }),
  });
  assert.equal(redirectWithoutTls.status, 400);
  assert.match(String(redirectWithoutTls.body?.message || ""), /POS_HTTP_REDIRECT_PORT requiere configurar certificado y llave HTTPS del POS/i);

  const samePort = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        PORT: "8443",
        POS_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
        POS_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
        POS_HTTP_REDIRECT_PORT: "8443",
      },
    }),
  });
  assert.equal(samePort.status, 400);
  assert.match(String(samePort.body?.message || ""), /POS_HTTP_REDIRECT_PORT no puede usar el mismo puerto que PORT/i);
});

test("owner-control rejects insecure remote client base URLs at creation time", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "http://cliente-remoto.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 400);
  assert.match(createResponse.body.message, /URL publica del cliente debe usar HTTPS fuera de localhost/i);
});

test("owner-control hides whether a client slug exists when credentials are invalid", async (t) => {
  const server = await startOwnerControlServer(t);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "https://rincon.example",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);

  const unknownSlug = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cliente-inexistente", "pos_falsa"),
  });
  assert.equal(unknownSlug.status, 403);
  assert.match(String(unknownSlug.body?.message || ""), /Credenciales de cliente invalidas/i);
});

test("owner-control separates owner billing from client POS sync", async (t) => {
  const server = await startOwnerControlServer(t);

  const health = await json(server.baseUrl, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "owner-control");

  const blockedList = await json(server.baseUrl, "/api/owner/clients");
  assert.equal(blockedList.status, 401);

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cremeria-rincon",
      businessName: "Cremeria Rincon",
      baseUrl: "http://localhost:3100",
      planCode: "beta",
      monthlyAmount: 799,
    }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.client.slug, "cremeria-rincon");
  assert.match(createResponse.body.apiKey, /^pos_/);
  const apiKey = createResponse.body.apiKey;

  const blockedClient = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cremeria-rincon", "bad-key"),
  });
  assert.equal(blockedClient.status, 403);

  const initialSubscription = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(initialSubscription.status, 200);
  assert.equal(initialSubscription.body.subscription.status, "trial");
  assert.equal(initialSubscription.body.subscription.monthlyAmount, 799);
  assert.deepEqual(initialSubscription.body.payments, []);

  const initialConfig = await json(server.baseUrl, "/api/client/config", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(initialConfig.status, 200);
  assert.deepEqual(initialConfig.body.config.enabledModules.sort(), ["merchandise_requests", "weighted_audit"]);
  assert.ok(initialConfig.body.config.adminCapabilities.includes("support_tools"));

  const configUpdate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      enabledModules: ["weighted_audit", "modulo_falso"],
      adminCapabilities: ["daily_flow", "support_tools", "capacidad_falsa"],
    }),
  });
  assert.equal(configUpdate.status, 200);
  assert.deepEqual(configUpdate.body.config.enabledModules, ["weighted_audit"]);
  assert.deepEqual(configUpdate.body.config.adminCapabilities, ["daily_flow", "support_tools"]);
  assert.equal(configUpdate.body.config.sync.status, "pending");
  assert.equal(configUpdate.body.config.sync.inSync, false);

  const clientConfig = await json(server.baseUrl, "/api/client/config", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(clientConfig.status, 200);
  assert.deepEqual(clientConfig.body.config.enabledModules, ["weighted_audit"]);
  assert.deepEqual(clientConfig.body.config.adminCapabilities, ["daily_flow", "support_tools"]);

  const configSync = await json(server.baseUrl, "/api/client/config-sync", {
    method: "POST",
    headers: clientHeaders("cremeria-rincon", apiKey),
    body: JSON.stringify({
      status: "applied",
      enabledModules: ["weighted_audit"],
      adminCapabilities: ["daily_flow", "support_tools"],
      message: "Aplicada por prueba POS.",
    }),
  });
  assert.equal(configSync.status, 202);
  assert.equal(configSync.body.configSync.status, "applied");
  assert.equal(configSync.body.configSync.inSync, true);

  const runtimeUpdate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    method: "PATCH",
    headers: ownerHeaders(),
    body: JSON.stringify({
      values: {
        POS_PUBLIC_ORIGIN: "https://cremeria.example",
        CONTROL_CONFIG_POLL_MS: "45000",
        TELEGRAM_CHAT_IDS: "-100123,123",
        POS_BOOTSTRAP_TOKEN: "bootstrap-central",
      },
    }),
  });
  assert.equal(runtimeUpdate.status, 200);
  assert.ok(runtimeUpdate.body.runtimeConfig.keys.includes("POS_PUBLIC_ORIGIN"));
  assert.equal(runtimeUpdate.body.runtimeConfig.sync.status, "pending");

  const ownerRuntimeRead = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/runtime-config", {
    headers: ownerHeaders(),
  });
  assert.equal(ownerRuntimeRead.status, 200);
  const bootstrapVariable = ownerRuntimeRead.body.runtimeConfig.variables.find((variable) => variable.key === "POS_BOOTSTRAP_TOKEN");
  assert.equal(bootstrapVariable.hasStoredValue, true);
  assert.equal(bootstrapVariable.maskedValue, "********");
  assert.equal(bootstrapVariable.value, "");

  const clientRuntime = await json(server.baseUrl, "/api/client/runtime-config", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(clientRuntime.status, 200);
  assert.equal(clientRuntime.body.runtimeConfig.values.POS_PUBLIC_ORIGIN, "https://cremeria.example");
  assert.equal(clientRuntime.body.runtimeConfig.values.TELEGRAM_CHAT_IDS, "-100123,123");
  assert.equal(clientRuntime.body.runtimeConfig.values.POS_BOOTSTRAP_TOKEN, "bootstrap-central");
  assert.equal(clientRuntime.body.runtimeConfig.values.CONTROL_CLIENT_SECRET, undefined);
  assert.match(clientRuntime.body.runtimeConfig.runtimeHash, /^[a-f0-9]{64}$/);

  const runtimeSync = await json(server.baseUrl, "/api/client/runtime-config-sync", {
    method: "POST",
    headers: clientHeaders("cremeria-rincon", apiKey),
    body: JSON.stringify({
      status: "applied",
      keys: Object.keys(clientRuntime.body.runtimeConfig.values),
      runtimeHash: clientRuntime.body.runtimeConfig.runtimeHash,
      message: "Variables runtime aplicadas por prueba POS.",
    }),
  });
  assert.equal(runtimeSync.status, 202);
  assert.equal(runtimeSync.body.runtimeConfigSync.status, "applied");
  assert.equal(runtimeSync.body.runtimeConfigSync.inSync, true);

  const payment = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/payments", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      amount: 799,
      paymentMethod: "Transferencia",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      notes: "Beta julio",
    }),
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.body.client.subscription.status, "active");
  assert.equal(payment.body.client.subscription.currentPeriodEnd, "2026-07-31");

  const activeSubscription = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(activeSubscription.status, 200);
  assert.equal(activeSubscription.body.subscription.status, "active");
  assert.equal(activeSubscription.body.payments.length, 1);
  assert.equal(activeSubscription.body.payments[0].amount, 799);

  const healthReport = await json(server.baseUrl, "/api/client/health", {
    method: "POST",
    headers: clientHeaders("cremeria-rincon", apiKey),
    body: JSON.stringify({
      semaphore: {
        status: "risk",
        reasons: [{ title: "Backup pendiente" }],
        actions: [{ title: "Revisar respaldo" }],
      },
      metrics: {
        pendingSync: 0,
      },
    }),
  });
  assert.equal(healthReport.status, 202);
  assert.equal(healthReport.body.client.healthStatus, "risk");

  const duplicateHealthReport = await json(server.baseUrl, "/api/client/health", {
    method: "POST",
    headers: clientHeaders("cremeria-rincon", apiKey),
    body: JSON.stringify({
      semaphore: {
        status: "risk",
        reasons: [{ title: "Backup pendiente" }],
        actions: [{ title: "Revisar respaldo" }],
      },
      metrics: {
        pendingSync: 0,
        heartbeat: 2,
      },
    }),
  });
  assert.equal(duplicateHealthReport.status, 202);
  assert.equal(duplicateHealthReport.body.deduped, true);

  const validationReport = await json(server.baseUrl, "/api/client/validation-report", {
    method: "POST",
    headers: clientHeaders("cremeria-rincon", apiKey),
    body: JSON.stringify({
      url: "http://localhost:3100",
      checks: [
        { name: "/api/health", ok: true },
        { name: "/administracion", ok: true },
      ],
    }),
  });
  assert.equal(validationReport.status, 202);
  assert.equal(validationReport.body.report.status, "ok");

  const detail = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon", {
    headers: ownerHeaders(),
  });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.client.config.enabledModules, ["weighted_audit"]);
  assert.deepEqual(detail.body.client.config.adminCapabilities, ["daily_flow", "support_tools"]);
  assert.equal(detail.body.client.config.sync.status, "applied");
  assert.equal(detail.body.client.config.sync.inSync, true);
  assert.equal(detail.body.client.runtimeConfig.sync.status, "applied");
  assert.equal(detail.body.client.runtimeConfig.sync.inSync, true);
  assert.ok(detail.body.runtimeVariables.some((variable) => variable.key === "POS_PUBLIC_ORIGIN"));
  assert.ok(detail.body.availableModules.some((module) => module.code === "weighted_audit"));
  assert.ok(detail.body.adminSections.some((section) => section.code === "support_tools"));
  assert.equal(detail.body.payments.length, 1);
  assert.equal(detail.body.healthReports.length, 1);
  assert.equal(detail.body.healthReports[0].status, "risk");
  assert.equal(detail.body.validationReports[0].status, "ok");

  const rotated = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon/rotate-key", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({ graceMinutes: 0 }),
  });
  assert.equal(rotated.status, 200);
  assert.match(rotated.body.apiKey, /^pos_/);
  assert.notEqual(rotated.body.apiKey, apiKey);
  assert.equal(rotated.body.client.runtimeConfig.sync.status, "pending");
  assert.equal(rotated.body.client.runtimeConfig.sync.inSync, false);
  assert.equal(rotated.body.client.runtimeConfig.sync.pairingInSync, false);
  assert.match(String(rotated.body.client.runtimeConfig.sync.message || ""), /CONTROL_CLIENT_SECRET/i);

  const oldKeyAfterRotate = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cremeria-rincon", apiKey),
  });
  assert.equal(oldKeyAfterRotate.status, 403);

  const newKeyAfterRotate = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cremeria-rincon", rotated.body.apiKey),
  });
  assert.equal(newKeyAfterRotate.status, 200);
  assert.equal(newKeyAfterRotate.body.subscription.status, "active");

  const detailAfterRotate = await json(server.baseUrl, "/api/owner/clients/cremeria-rincon", {
    headers: ownerHeaders(),
  });
  assert.equal(detailAfterRotate.status, 200);
  assert.equal(detailAfterRotate.body.client.runtimeConfig.sync.status, "applied");
  assert.equal(detailAfterRotate.body.client.runtimeConfig.sync.inSync, true);
  assert.equal(detailAfterRotate.body.client.runtimeConfig.sync.pairingInSync, true);
});

test("owner-control can require signed client API requests", async (t) => {
  const server = await startOwnerControlServer(t, {
    requireClientSignature: true,
  });

  const createResponse = await json(server.baseUrl, "/api/owner/clients", {
    method: "POST",
    headers: ownerHeaders(),
    body: JSON.stringify({
      slug: "cliente-firmado",
      businessName: "Cliente Firmado",
      baseUrl: "http://localhost:3100",
    }),
  });
  assert.equal(createResponse.status, 201);
  const apiKey = createResponse.body.apiKey;

  const unsigned = await json(server.baseUrl, "/api/client/subscription", {
    headers: clientHeaders("cliente-firmado", apiKey),
  });
  assert.equal(unsigned.status, 401);

  const signed = await json(server.baseUrl, "/api/client/subscription", {
    headers: signedClientHeaders("cliente-firmado", apiKey, "GET", "/api/client/subscription"),
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.subscription.status, "trial");
});
