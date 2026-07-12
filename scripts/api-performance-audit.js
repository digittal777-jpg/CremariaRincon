const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const Database = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const OWNER_DIR = path.resolve(ROOT_DIR, "..", "owner-control");
const REPORT_PATH = path.join(ROOT_DIR, "AUDITORIA_RENDIMIENTO_APIS.md");
const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY|API_KEY|CLIENT_SECRET)/i;
const ADMIN_USER = "perfadmin";
const OWNER_USER = "perfowner";
const CASHIER_NAME = "Perf Cajero";
const TEST_PASSWORD = "PerfAudit1234";
const OWNER_CONTROL_TOKEN = "owner_perf_audit_local_only";
const CLIENT_SLUG = "cremeria-rincon";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function bytesToMb(bytes) {
  return round(Number(bytes || 0) / 1024 / 1024, 2);
}

function byteLength(value) {
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarizeTimes(times) {
  return {
    avgMs: round(times.reduce((sum, value) => sum + value, 0) / Math.max(times.length, 1), 2),
    p50Ms: round(percentile(times, 50), 2),
    p95Ms: round(percentile(times, 95), 2),
    maxMs: round(Math.max(...times, 0), 2),
  };
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex"),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true, recursive: true });
  }
}

function readRuntimeConfigSummary(runtimePath = path.join(ROOT_DIR, "data", "pos-runtime-config.json")) {
  if (!fs.existsSync(runtimePath)) {
    return {
      loaded: false,
      keys: [],
      secretKeys: [],
      nonSecretValues: {},
    };
  }

  const parsed = safeJsonParse(fs.readFileSync(runtimePath, "utf8"), {});
  const values = parsed.env && typeof parsed.env === "object" ? parsed.env : parsed;
  const keys = Object.keys(values || {}).sort();
  return {
    loaded: true,
    path: runtimePath,
    keys,
    secretKeys: keys.filter((key) => SECRET_KEY_PATTERN.test(key)),
    nonSecretValues: keys.reduce((result, key) => {
      if (!SECRET_KEY_PATTERN.test(key)) {
        result[key] = String(values[key] || "");
      }
      return result;
    }, {}),
  };
}

async function checkControlTarget(runtimeSummary) {
  const rawUrl = runtimeSummary.nonSecretValues?.CONTROL_API_URL || "";
  if (!rawUrl) {
    return {
      configured: false,
      reachable: false,
      message: "CONTROL_API_URL no esta configurado.",
    };
  }

  let targetUrl = "";
  try {
    targetUrl = new URL("/api/health", rawUrl.replace(/\/+$/g, "")).toString();
  } catch (_error) {
    return {
      configured: true,
      reachable: false,
      message: "CONTROL_API_URL no es una URL valida.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const start = performance.now();
    const response = await fetch(targetUrl, { signal: controller.signal });
    await response.arrayBuffer();
    return {
      configured: true,
      reachable: response.ok,
      status: response.status,
      latencyMs: round(performance.now() - start, 2),
      url: targetUrl,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      url: targetUrl,
      message: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function countRoutes(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const routes = [];
  const pattern = /app\.(get|post|patch|delete)\("([^"]+)"/g;
  let match = pattern.exec(source);
  while (match) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
    match = pattern.exec(source);
  }
  return routes;
}

function tableCounts(dbPath, tables) {
  const db = new Database(dbPath, { fileMustExist: true, readonly: true });
  try {
    const counts = {};
    for (const table of tables) {
      try {
        counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
      } catch (_error) {
        counts[table] = null;
      }
    }
    const indexes = db.prepare(`
      SELECT name, tbl_name
      FROM sqlite_master
      WHERE type = 'index'
      ORDER BY tbl_name, name
    `).all();
    return {
      path: dbPath,
      sizeMb: bytesToMb(fs.statSync(dbPath).size),
      walMb: fs.existsSync(`${dbPath}-wal`) ? bytesToMb(fs.statSync(`${dbPath}-wal`).size) : 0,
      counts,
      indexCount: indexes.length,
      indexes,
    };
  } finally {
    db.close();
  }
}

function copySqliteDatabase(sourcePath, targetPath) {
  removeIfExists(targetPath);
  removeIfExists(`${targetPath}-wal`);
  removeIfExists(`${targetPath}-shm`);
  fs.copyFileSync(sourcePath, targetPath);
}

function setSetting(db, key, value) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, now);
}

function preparePosDatabase(dbPath) {
  const db = new Database(dbPath);
  try {
    const now = new Date().toISOString();
    setSetting(db, "admin.username", ADMIN_USER);
    setSetting(db, "admin.password", JSON.stringify(hashPassword(TEST_PASSWORD)));
    setSetting(db, "owner.username", OWNER_USER);
    setSetting(db, "owner.password", JSON.stringify(hashPassword(TEST_PASSWORD)));
    db.prepare("DELETE FROM admin_sessions").run();
    db.prepare("DELETE FROM owner_sessions").run();
    db.prepare("DELETE FROM cashier_sessions").run();
    db.prepare(`
      INSERT INTO cashiers (name, branch, password_hash, active, created_at, updated_at)
      VALUES (?, 'carrizal', ?, 1, ?, ?)
      ON CONFLICT(name, branch) DO UPDATE SET
        password_hash = excluded.password_hash,
        active = 1,
        updated_at = excluded.updated_at
    `).run(CASHIER_NAME, JSON.stringify(hashPassword(TEST_PASSWORD)), now, now);
  } finally {
    db.close();
  }
}

function prepareOwnerDatabase(dbPath, ownerPort, posDbPath, posPollMs) {
  const { createControlStore } = require(path.join(OWNER_DIR, "src", "store"));
  const store = createControlStore({ dbPath });
  let clientSecret = "";
  try {
    try {
      store.getClientDetail(CLIENT_SLUG);
    } catch (_error) {
      store.createClient({
        slug: CLIENT_SLUG,
        businessName: "Cremeria El Rincon",
        baseUrl: "http://127.0.0.1:3100",
      });
    }
    clientSecret = store.rotateClientKey(CLIENT_SLUG).apiKey;
    store.updateClientRuntimeConfig(CLIENT_SLUG, {
      POS_DB_PATH: posDbPath,
      POS_FORCE_HTTPS: "false",
      POS_SECURE_COOKIES: "false",
      CONTROL_API_URL: `http://127.0.0.1:${ownerPort}`,
      CONTROL_CLIENT_SLUG: CLIENT_SLUG,
      CONTROL_CLIENT_SECRET: clientSecret,
      CONTROL_CONFIG_POLL_MS: String(posPollMs),
      CONTROL_SYNC_TIMEOUT_MS: "3000",
      BACKUP_ENABLED: "false",
    });
    store.updateOwnerRuntimeConfig({
      OWNER_CONTROL_TOKEN,
      OWNER_CONTROL_PORT: String(ownerPort),
      OWNER_CONTROL_FORCE_HTTPS: "false",
      OWNER_CONTROL_REQUIRE_CLIENT_SIGNATURE: "true",
      OWNER_CONTROL_CLIENT_SIGNATURE_WINDOW_MS: "300000",
      OWNER_CONTROL_RATE_LIMIT_WINDOW_MS: "60000",
      OWNER_CONTROL_RATE_LIMIT_MAX: "2000",
      OWNER_CONTROL_HEALTH_REPORT_RETENTION_LIMIT: "200",
      OWNER_CONTROL_VALIDATION_REPORT_RETENTION_LIMIT: "200",
    });
  } finally {
    store.close();
  }
  return { clientSecret };
}

function writePosRuntimeConfig(filePath, values) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      env: values,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnNode(label, scriptPath, cwd, env) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.perfLogs = {
    stdoutBytes: 0,
    stderrBytes: 0,
    warningLines: 0,
    controlPlaneLines: 0,
    samples: [],
  };
  const capture = (streamName, chunk) => {
    const text = String(chunk || "");
    child.perfLogs[`${streamName}Bytes`] += Buffer.byteLength(text, "utf8");
    child.perfLogs.warningLines += (text.match(/warn|error|no pude/gi) || []).length;
    child.perfLogs.controlPlaneLines += (text.match(/\[control-plane\]/g) || []).length;
    if (child.perfLogs.samples.length < 8) {
      child.perfLogs.samples.push(
        text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.replace(/owner_[A-Za-z0-9_-]+/g, "owner_***"))
          .slice(0, 2)
          .join(" | "),
      );
    }
  };
  child.stdout.on("data", (chunk) => capture("stdout", chunk));
  child.stderr.on("data", (chunk) => capture("stderr", chunk));
  child.once("exit", (code, signal) => {
    if (code && code !== 0 && signal !== "SIGTERM") {
      child.perfLogs.samples.push(`${label} exited code=${code} signal=${signal || ""}`);
    }
  });
  return child;
}

function getProcessSample(pid) {
  const command = [
    "Get-Process",
    "-Id",
    String(pid),
    "|",
    "Select-Object",
    "Id,WorkingSet64,PrivateMemorySize64,CPU",
    "|",
    "ConvertTo-Json",
    "-Compress",
  ].join(" ");
  try {
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function diffProcessSamples(start, end, elapsedMs) {
  if (!start || !end) {
    return {
      workingSetMb: 0,
      privateMb: 0,
      cpuPercentOneCore: 0,
      cpuPercentMachine: 0,
    };
  }
  const cpuDeltaSeconds = Math.max(0, Number(end.CPU || 0) - Number(start.CPU || 0));
  const elapsedSeconds = Math.max(0.001, elapsedMs / 1000);
  return {
    workingSetMb: bytesToMb(end.WorkingSet64),
    privateMb: bytesToMb(end.PrivateMemorySize64),
    cpuPercentOneCore: round((cpuDeltaSeconds / elapsedSeconds) * 100, 2),
    cpuPercentMachine: round((cpuDeltaSeconds / elapsedSeconds) * 100 / Math.max(os.cpus().length, 1), 2),
  };
}

async function sampleIdle(label, child, durationMs) {
  const start = getProcessSample(child.pid);
  await sleep(durationMs);
  const end = getProcessSample(child.pid);
  return {
    label,
    pid: child.pid,
    durationMs,
    ...diffProcessSamples(start, end, durationMs),
  };
}

async function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.status < 500) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await sleep(250);
  }
  throw new Error(`No arranco ${url}: ${lastError}`);
}

async function requestRaw(baseUrl, spec) {
  const method = spec.method || "GET";
  const body = spec.body === undefined
    ? undefined
    : typeof spec.body === "string"
      ? spec.body
      : JSON.stringify(spec.body);
  const headers = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(spec.headers || {}),
  };
  const response = await fetch(`${baseUrl}${spec.path}`, {
    method,
    headers,
    body,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString("utf8");
  return {
    status: response.status,
    ok: response.ok,
    bytes: buffer.length,
    text,
    json: safeJsonParse(text, null),
    headers: response.headers,
  };
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function cookieHeaderFromResponse(response) {
  return getSetCookieHeaders(response.headers)
    .map((cookie) => String(cookie).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function signedClientHeaders(method, pathWithQuery, body, secret) {
  const bodyText = body === undefined
    ? ""
    : typeof body === "string"
      ? body
      : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = [
    String(method || "GET").toUpperCase(),
    pathWithQuery,
    timestamp,
    nonce,
    bodyText,
  ].join("\n");
  return {
    "X-Client-Slug": CLIENT_SLUG,
    Authorization: `Bearer ${secret}`,
    "X-Client-Timestamp": timestamp,
    "X-Client-Nonce": nonce,
    "X-Client-Signature": crypto.createHmac("sha256", secret).update(payload).digest("hex"),
  };
}

async function benchHttp(baseUrl, spec, iterations) {
  const times = [];
  const statuses = {};
  const errors = [];
  let maxBytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const requestSpec = typeof spec === "function" ? spec(index) : spec;
    const start = performance.now();
    try {
      const result = await requestRaw(baseUrl, requestSpec);
      times.push(performance.now() - start);
      statuses[result.status] = (statuses[result.status] || 0) + 1;
      maxBytes = Math.max(maxBytes, result.bytes);
      if (!result.ok && errors.length < 3) {
        errors.push(result.json?.message || result.text.slice(0, 160));
      }
    } catch (error) {
      times.push(performance.now() - start);
      statuses.error = (statuses.error || 0) + 1;
      if (errors.length < 3) {
        errors.push(error.message || String(error));
      }
    }
  }
  return {
    label: typeof spec === "function" ? spec().label : spec.label,
    method: typeof spec === "function" ? spec().method || "GET" : spec.method || "GET",
    path: typeof spec === "function" ? spec().path : spec.path,
    iterations,
    ...summarizeTimes(times),
    payloadKbMax: round(maxBytes / 1024, 2),
    statuses,
    errors,
  };
}

async function burstHttp(baseUrl, spec, concurrency) {
  const start = performance.now();
  const statuses = {};
  const errors = [];
  let maxBytes = 0;
  await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    const requestSpec = typeof spec === "function" ? spec(index) : spec;
    try {
      const result = await requestRaw(baseUrl, requestSpec);
      statuses[result.status] = (statuses[result.status] || 0) + 1;
      maxBytes = Math.max(maxBytes, result.bytes);
      if (!result.ok && errors.length < 3) {
        errors.push(result.json?.message || result.text.slice(0, 160));
      }
    } catch (error) {
      statuses.error = (statuses.error || 0) + 1;
      if (errors.length < 3) {
        errors.push(error.message || String(error));
      }
    }
  }));
  return {
    label: typeof spec === "function" ? spec().label : spec.label,
    method: typeof spec === "function" ? spec().method || "GET" : spec.method || "GET",
    path: typeof spec === "function" ? spec().path : spec.path,
    concurrency,
    totalMs: round(performance.now() - start, 2),
    payloadKbMax: round(maxBytes / 1024, 2),
    statuses,
    errors,
  };
}

async function benchService(label, fn, iterations) {
  const times = [];
  let payloadBytes = 0;
  let heapPeakDeltaMb = 0;
  let error = "";
  try {
    await fn();
  } catch (warmupError) {
    return {
      label,
      iterations: 0,
      error: warmupError.message || String(warmupError),
    };
  }
  if (global.gc) {
    global.gc();
  }
  const baseHeap = process.memoryUsage().heapUsed;
  const cpuStart = process.cpuUsage();
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    try {
      const result = await fn();
      payloadBytes = Math.max(payloadBytes, byteLength(JSON.stringify(result ?? null)));
    } catch (runError) {
      error = runError.message || String(runError);
      break;
    }
    times.push(performance.now() - start);
    heapPeakDeltaMb = Math.max(heapPeakDeltaMb, bytesToMb(process.memoryUsage().heapUsed - baseHeap));
  }
  const cpu = process.cpuUsage(cpuStart);
  return {
    label,
    iterations: times.length,
    ...summarizeTimes(times),
    cpuMsTotal: round((cpu.user + cpu.system) / 1000, 2),
    heapPeakDeltaMb,
    payloadKbMax: round(payloadBytes / 1024, 2),
    error,
  };
}

function loginSpec(pathname, username, password) {
  return {
    method: "POST",
    path: pathname,
    body: { username, password },
  };
}

async function loginPosActors(posBaseUrl) {
  const adminResponse = await requestRaw(posBaseUrl, loginSpec("/api/admin/auth/login", ADMIN_USER, TEST_PASSWORD));
  const ownerResponse = await requestRaw(posBaseUrl, loginSpec("/api/owner/auth/login", OWNER_USER, TEST_PASSWORD));
  const cashierResponse = await requestRaw(posBaseUrl, {
    method: "POST",
    path: "/api/cashier/auth",
    body: { name: CASHIER_NAME, branch: "carrizal", password: TEST_PASSWORD },
  });

  return {
    admin: {
      cookie: cookieHeaderFromResponse(adminResponse),
      csrfToken: adminResponse.json?.csrfToken || "",
      status: adminResponse.status,
    },
    owner: {
      cookie: cookieHeaderFromResponse(ownerResponse),
      csrfToken: ownerResponse.json?.csrfToken || "",
      status: ownerResponse.status,
    },
    cashier: {
      token: cashierResponse.json?.token || "",
      status: cashierResponse.status,
    },
  };
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.title).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) =>
    `| ${columns.map((column) => String(column.value(row) ?? "").replace(/\|/g, "\\|")).join(" | ")} |`
  );
  return [header, separator, ...body].join("\n");
}

function statusSummary(statuses) {
  return Object.entries(statuses || {})
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function formatEndpointRows(rows) {
  return markdownTable(rows, [
    { title: "Ruta", value: (row) => `${row.method} ${row.path}` },
    { title: "Iter", value: (row) => row.iterations || row.concurrency || "" },
    { title: "Avg", value: (row) => row.avgMs == null ? "" : `${row.avgMs} ms` },
    { title: "P95", value: (row) => row.p95Ms == null ? "" : `${row.p95Ms} ms` },
    { title: "Max/Total", value: (row) => row.maxMs == null ? `${row.totalMs} ms` : `${row.maxMs} ms` },
    { title: "KB", value: (row) => row.payloadKbMax },
    { title: "Status", value: (row) => statusSummary(row.statuses) },
  ]);
}

function formatServiceRows(rows) {
  return markdownTable(rows, [
    { title: "Operacion", value: (row) => row.label },
    { title: "Avg", value: (row) => row.avgMs == null ? "" : `${row.avgMs} ms` },
    { title: "P95", value: (row) => row.p95Ms == null ? "" : `${row.p95Ms} ms` },
    { title: "Max", value: (row) => row.maxMs == null ? "" : `${row.maxMs} ms` },
    { title: "CPU total", value: (row) => row.cpuMsTotal == null ? "" : `${row.cpuMsTotal} ms` },
    { title: "Heap pico", value: (row) => `${row.heapPeakDeltaMb || 0} MB` },
    { title: "KB", value: (row) => row.payloadKbMax || 0 },
  ]);
}

function buildReport(result) {
  const slowPos = result.posHttp
    .filter((row) => Number(row.p95Ms || 0) >= 100)
    .sort((left, right) => Number(right.p95Ms || 0) - Number(left.p95Ms || 0));
  const slowServices = result.posServices
    .filter((row) => Number(row.p95Ms || 0) >= 100)
    .sort((left, right) => Number(right.p95Ms || 0) - Number(left.p95Ms || 0));
  const controlPollMs = result.runtimeSummary.nonSecretValues.CONTROL_CONFIG_POLL_MS || "";
  const controlUrl = result.runtimeSummary.nonSecretValues.CONTROL_API_URL || "";
  const railwaySaverMode = result.runtimeSummary.nonSecretValues.RAILWAY_COST_SAVER_MODE || "";
  const controlPollNumber = Number(controlPollMs || 0);

  return [
    "# Auditoria de rendimiento APIs POS y owner-control",
    "",
    `Generado: ${result.measuredAt}`,
    "",
    "## Resumen Rafael",
    "",
    `- POS runtime actual: CONTROL_API_URL=${controlUrl || "(vacio)"}, CONTROL_CONFIG_POLL_MS=${controlPollMs || "(vacio)"}, RAILWAY_COST_SAVER_MODE=${railwaySaverMode || "(auto)"}.`,
    `- Estado del target actual: ${result.currentControlTarget.reachable ? "alcanzable" : "no alcanzable"}${result.currentControlTarget.status ? ` (HTTP ${result.currentControlTarget.status})` : ""}.`,
    `- POS aislado en reposo sano: ${result.idleSamples.find((item) => item.label.includes("POS"))?.workingSetMb || 0} MB RSS, CPU ${result.idleSamples.find((item) => item.label.includes("POS"))?.cpuPercentOneCore || 0}% de un nucleo.`,
    `- owner-control aislado en reposo sano: ${result.idleSamples.find((item) => item.label.includes("owner-control"))?.workingSetMb || 0} MB RSS, CPU ${result.idleSamples.find((item) => item.label.includes("owner-control"))?.cpuPercentOneCore || 0}% de un nucleo.`,
    `- Rutas POS medidas: ${result.posRoutes.length}. Rutas owner-control medidas: ${result.ownerRoutes.length}.`,
    "",
    "## Datos",
    "",
    `- POS DB: ${result.posDb.sizeMb} MB, tablas ${JSON.stringify(result.posDb.counts)}.`,
    `- owner-control DB: ${result.ownerDb.sizeMb} MB + WAL ${result.ownerDb.walMb} MB, tablas ${JSON.stringify(result.ownerDb.counts)}.`,
    `- Prueba aislada uso POS_DB_PATH y OWNER_CONTROL_DB_PATH temporales en ${result.tempDir}; el auditor los elimina al terminar.`,
    "",
    "## Procesos",
    "",
    markdownTable(result.idleSamples, [
      { title: "Proceso", value: (row) => row.label },
      { title: "PID", value: (row) => row.pid },
      { title: "RSS", value: (row) => `${row.workingSetMb} MB` },
      { title: "Privada", value: (row) => `${row.privateMb} MB` },
      { title: "CPU nucleo", value: (row) => `${row.cpuPercentOneCore}%` },
      { title: "CPU maquina", value: (row) => `${row.cpuPercentMachine}%` },
    ]),
    "",
    "## POS HTTP",
    "",
    formatEndpointRows(result.posHttp),
    "",
    "## POS bursts",
    "",
    formatEndpointRows(result.posBursts),
    "",
    "## owner-control HTTP",
    "",
    formatEndpointRows(result.ownerHttp),
    "",
    "## owner-control bursts",
    "",
    formatEndpointRows(result.ownerBursts),
    "",
    "## Servicios internos POS",
    "",
    formatServiceRows(result.posServices),
    "",
    "## Servicios internos owner-control",
    "",
    formatServiceRows(result.ownerServices),
    "",
    "## Hallazgos",
    "",
    ...[
      slowServices.length
        ? `- Los servicios internos mas pesados fueron: ${slowServices.map((row) => `${row.label} p95=${row.p95Ms}ms`).join("; ")}.`
        : "- No hubo servicios internos POS por encima de 100 ms p95 en esta muestra.",
      slowPos.length
        ? `- Las rutas HTTP POS por encima de 100 ms p95 fueron: ${slowPos.map((row) => `${row.method} ${row.path} p95=${row.p95Ms}ms`).join("; ")}.`
        : "- Ninguna ruta HTTP POS medida paso de 100 ms p95 en serial; los bursts muestran la serializacion esperada por SQLite sincronico.",
      "- Ventas del dia, soporte/salud y rentabilidad ya usan rangos SQL por fecha de tienda; esto evita filtrar historico completo en JS.",
      "- Dashboard reutiliza ventas/items del dia dentro del snapshot y usa cache corto en rutas GET para absorber rafagas.",
      "- Export store-day/store-week ya pide filas filtradas por alcance en vez de cargar todos los historicos antes de filtrar.",
      "- owner-control esta razonablemente ligero por endpoint, pero health_reports crece y cada reporte ejecuta dedupe + prune; mantener retencion e indices es clave.",
      controlPollNumber === 0
        ? "- CONTROL_CONFIG_POLL_MS=0 permite que Railway serverless duerma cuando no hay usuarios ni trafico saliente."
        : controlPollNumber > 0 && controlPollNumber < 15000
        ? `- CONTROL_CONFIG_POLL_MS=${controlPollMs} es muy agresivo para produccion. Recomiendo 30000-60000 ms salvo diagnostico activo.`
        : "- CONTROL_CONFIG_POLL_MS no se ve agresivo para POS local; en Railway conviene dejarlo en 0 salvo necesidad real.",
      !result.currentControlTarget.reachable
        ? "- El CONTROL_API_URL actual no respondio healthcheck; si el POS corre asi, genera intentos fallidos de fondo."
        : "- El CONTROL_API_URL actual respondio healthcheck.",
    ],
    "",
    "## Recomendaciones",
    "",
    controlPollNumber > 0 && controlPollNumber < 30000
      ? "1. Subir CONTROL_CONFIG_POLL_MS a 30000 o 60000 para POS local; en Railway usar RAILWAY_COST_SAVER_MODE=true y CONTROL_CONFIG_POLL_MS=0."
      : "1. Para Railway usar RAILWAY_COST_SAVER_MODE=true y CONTROL_CONFIG_POLL_MS=0; para POS local mantener 30000-60000 ms si se necesita sync central.",
    "2. Mantener los rangos SQL en ventas, soporte/salud, rentabilidad y exportaciones para que el costo crezca con el periodo solicitado.",
    "3. Vigilar bootstrap/admin productos si el catalogo sube mucho; el siguiente corte natural seria paginar listas administrativas grandes.",
    "4. Separar endpoints livianos de bootstrap si el catalogo o inventario crecen por encima de miles de productos.",
    "5. Mantener owner-control con retencion efectiva de health_reports y hacer checkpoint del WAL en mantenimiento.",
    "",
    "## Logs de arranque",
    "",
    "```json",
    JSON.stringify(result.childLogs, null, 2),
    "```",
    "",
  ].join("\n");
}

async function main() {
  const measuredAt = new Date().toISOString();
  const tempDir = path.join(os.tmpdir(), `cremeria-api-perf-${Date.now()}-${process.pid}`);
  ensureDir(tempDir);

  const posPort = await getFreePort();
  const ownerPort = await getFreePort();
  const posDbSource = path.join(ROOT_DIR, "data", "cremaria-rincon.sqlite");
  const ownerDbSource = path.join(OWNER_DIR, "data", "owner-control.sqlite");
  const posDbPath = path.join(tempDir, "pos.sqlite");
  const ownerDbPath = path.join(tempDir, "owner-control.sqlite");
  const posRuntimePath = path.join(tempDir, "pos-runtime-config.json");
  const posPollMs = 2000;

  copySqliteDatabase(posDbSource, posDbPath);
  copySqliteDatabase(ownerDbSource, ownerDbPath);
  preparePosDatabase(posDbPath);
  const { clientSecret } = prepareOwnerDatabase(ownerDbPath, ownerPort, posDbPath, posPollMs);
  writePosRuntimeConfig(posRuntimePath, {
    POS_DB_PATH: posDbPath,
    POS_FORCE_HTTPS: "false",
    POS_SECURE_COOKIES: "false",
    CONTROL_API_URL: `http://127.0.0.1:${ownerPort}`,
    CONTROL_CLIENT_SLUG: CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: clientSecret,
    CONTROL_CONFIG_POLL_MS: String(posPollMs),
    CONTROL_SYNC_TIMEOUT_MS: "3000",
    BACKUP_ENABLED: "false",
  });

  const runtimeSummary = readRuntimeConfigSummary();
  const currentControlTarget = await checkControlTarget(runtimeSummary);
  const posDb = tableCounts(posDbSource, [
    "products",
    "sales",
    "sale_items",
    "inventory_movements",
    "register_events",
    "credit_payments",
    "cashier_sessions",
    "app_error_reports",
  ]);
  const ownerDb = tableCounts(ownerDbSource, [
    "clients",
    "payments",
    "health_reports",
    "validation_reports",
  ]);
  const posRoutes = countRoutes(path.join(ROOT_DIR, "src", "server.js"));
  const ownerRoutes = countRoutes(path.join(OWNER_DIR, "src", "app.js"));

  const previousEnv = { ...process.env };
  process.env.POS_CONFIG_PATH = posRuntimePath;
  process.env.PORT = String(posPort);
  process.env.POS_FORCE_HTTPS = "false";
  process.env.POS_SECURE_COOKIES = "false";

  const posServices = [];
  try {
    const services = require(path.join(ROOT_DIR, "src", "services"));
    posServices.push(await benchService("listProducts(carrizal)", () => services.listProducts("carrizal"), 25));
    posServices.push(await benchService("getDashboardSnapshot(carrizal)", () => services.getDashboardSnapshot("carrizal"), 15));
    posServices.push(await benchService("getDashboardSnapshot(all)", () => services.getDashboardSnapshot("all"), 10));
    posServices.push(await benchService("getPublicDashboardSnapshot(carrizal)", () => services.getPublicDashboardSnapshot("carrizal"), 15));
    posServices.push(await benchService("getSupportHealthReport(all)", () => services.getSupportHealthReport({ branch: "all" }), 8));
    posServices.push(await benchService("getProfitabilityReport(month/all)", () => services.getProfitabilityReport({ period: "month", branch: "all" }), 8));
    posServices.push(await benchService("listReceivableCustomers(carrizal)", () => services.listReceivableCustomers("carrizal"), 15));
    posServices.push(await benchService("exportWorkbookReport(all/store-day)", () => services.exportWorkbookReport({ branch: "all", scope: "store-day" }), 3));
    require(path.join(ROOT_DIR, "src", "db")).closeDatabaseConnection();
  } finally {
    process.env = previousEnv;
  }

  const ownerServices = [];
  const { createControlStore } = require(path.join(OWNER_DIR, "src", "store"));
  const ownerStore = createControlStore({ dbPath: ownerDbPath });
  try {
    ownerServices.push(await benchService("owner listClients()", () => ownerStore.listClients(), 25));
    ownerServices.push(await benchService("owner getClientDetail(cremeria-rincon)", () => ownerStore.getClientDetail(CLIENT_SLUG), 25));
    ownerServices.push(await benchService("owner getClientRuntimeConfig(cremeria-rincon)", () => ownerStore.getClientRuntimeConfig(CLIENT_SLUG), 25));
    ownerServices.push(await benchService("owner getOwnerRuntimeConfig()", () => ownerStore.getOwnerRuntimeConfig(), 25));
  } finally {
    ownerStore.close();
  }

  const children = [];
  let idleSamples = [];
  let posHttp = [];
  let ownerHttp = [];
  let posBursts = [];
  let ownerBursts = [];
  let childLogs = {};
  try {
    const ownerChild = spawnNode("owner-control", path.join(OWNER_DIR, "server.js"), OWNER_DIR, {
      OWNER_CONTROL_DB_PATH: ownerDbPath,
      OWNER_CONTROL_PORT: String(ownerPort),
      OWNER_CONTROL_TOKEN,
      OWNER_CONTROL_FORCE_HTTPS: "false",
      OWNER_CONTROL_REQUIRE_CLIENT_SIGNATURE: "true",
      OWNER_CONTROL_RATE_LIMIT_MAX: "2000",
    });
    children.push(ownerChild);
    await waitForHttp(`http://127.0.0.1:${ownerPort}/api/health`);

    const posChild = spawnNode("pos", path.join(ROOT_DIR, "src", "server.js"), ROOT_DIR, {
      PORT: String(posPort),
      POS_CONFIG_PATH: posRuntimePath,
      POS_FORCE_HTTPS: "false",
      POS_SECURE_COOKIES: "false",
    });
    children.push(posChild);
    await waitForHttp(`http://127.0.0.1:${posPort}/api/health`);
    await sleep(1000);

    idleSamples = await Promise.all([
      sampleIdle("POS idle healthy polling 12s", posChild, 12000),
      sampleIdle("owner-control idle healthy polling 12s", ownerChild, 12000),
    ]);

    const posBaseUrl = `http://127.0.0.1:${posPort}`;
    const ownerBaseUrl = `http://127.0.0.1:${ownerPort}`;
    const actors = await loginPosActors(posBaseUrl);
    const adminHeaders = {
      Cookie: actors.admin.cookie,
      "X-CSRF-Token": actors.admin.csrfToken,
    };
    const ownerHeaders = {
      Cookie: actors.owner.cookie,
      "X-CSRF-Token": actors.owner.csrfToken,
    };
    const cashierHeaders = {
      "X-Cashier-Token": actors.cashier.token,
    };
    const ownerTokenHeaders = {
      Authorization: `Bearer ${OWNER_CONTROL_TOKEN}`,
    };

    posHttp = [
      await benchHttp(posBaseUrl, { label: "POS health", path: "/api/health" }, 30),
      await benchHttp(posBaseUrl, { label: "POS public bootstrap", path: "/api/bootstrap?branch=carrizal" }, 20),
      await benchHttp(posBaseUrl, { label: "POS cashier auth status", path: "/api/cashier/auth/status", headers: cashierHeaders }, 20),
      await benchHttp(posBaseUrl, { label: "POS cashier dashboard", path: "/api/dashboard?branch=carrizal", headers: cashierHeaders }, 15),
      await benchHttp(posBaseUrl, { label: "POS register summary", path: "/api/register/summary?shift=Tarde", headers: cashierHeaders }, 15),
      await benchHttp(posBaseUrl, { label: "POS receivables", path: "/api/receivables", headers: cashierHeaders }, 12),
      await benchHttp(posBaseUrl, { label: "POS admin bootstrap all", path: "/api/admin/bootstrap?branch=all&includeInactiveInventory=true", headers: adminHeaders }, 10),
      await benchHttp(posBaseUrl, { label: "POS admin products", path: "/api/admin/products?branch=carrizal", headers: adminHeaders }, 15),
      await benchHttp(posBaseUrl, { label: "POS owner config", path: "/api/owner/config", headers: ownerHeaders }, 12),
      await benchHttp(posBaseUrl, { label: "POS support health", path: "/api/admin/support-health?branch=all", headers: ownerHeaders }, 6),
      await benchHttp(posBaseUrl, { label: "POS profitability", path: "/api/admin/profitability?period=month&branch=all", headers: ownerHeaders }, 6),
      await benchHttp(posBaseUrl, { label: "POS control health report", method: "POST", path: "/api/admin/control-plane/health/report", headers: ownerHeaders, body: { branch: "all" } }, 4),
      await benchHttp(posBaseUrl, { label: "POS control config sync", method: "POST", path: "/api/admin/control-plane/config/sync", headers: ownerHeaders, body: {} }, 4),
      await benchHttp(posBaseUrl, { label: "POS control runtime sync", method: "POST", path: "/api/admin/control-plane/runtime-config/sync", headers: ownerHeaders, body: {} }, 4),
      await benchHttp(posBaseUrl, { label: "POS export workbook", path: "/api/export-workbook?branch=all&scope=store-day", headers: adminHeaders }, 2),
    ];

    ownerHttp = [
      await benchHttp(ownerBaseUrl, { label: "owner health", path: "/api/health" }, 30),
      await benchHttp(ownerBaseUrl, { label: "owner clients", path: "/api/owner/clients", headers: ownerTokenHeaders }, 20),
      await benchHttp(ownerBaseUrl, { label: "owner client detail", path: `/api/owner/clients/${CLIENT_SLUG}`, headers: ownerTokenHeaders }, 20),
      await benchHttp(ownerBaseUrl, { label: "owner runtime config", path: "/api/owner/runtime-config", headers: ownerTokenHeaders }, 20),
      await benchHttp(ownerBaseUrl, { label: "owner client runtime", path: `/api/owner/clients/${CLIENT_SLUG}/runtime-config`, headers: ownerTokenHeaders }, 20),
      await benchHttp(ownerBaseUrl, () => {
        const pathWithQuery = "/api/client/subscription";
        return {
          label: "client subscription signed",
          path: pathWithQuery,
          headers: signedClientHeaders("GET", pathWithQuery, undefined, clientSecret),
        };
      }, 20),
      await benchHttp(ownerBaseUrl, () => {
        const pathWithQuery = "/api/client/config";
        return {
          label: "client config signed",
          path: pathWithQuery,
          headers: signedClientHeaders("GET", pathWithQuery, undefined, clientSecret),
        };
      }, 20),
      await benchHttp(ownerBaseUrl, () => {
        const pathWithQuery = "/api/client/runtime-config";
        return {
          label: "client runtime signed",
          path: pathWithQuery,
          headers: signedClientHeaders("GET", pathWithQuery, undefined, clientSecret),
        };
      }, 20),
      await benchHttp(ownerBaseUrl, (index = 0) => {
        const pathWithQuery = "/api/client/health";
        const body = {
          health: {
            status: "ok",
            semaphore: { status: "ok", reasons: [], actions: [] },
            metrics: { source: "perf-audit", index },
          },
          reportedAt: new Date().toISOString(),
        };
        return {
          label: "client health signed",
          method: "POST",
          path: pathWithQuery,
          headers: signedClientHeaders("POST", pathWithQuery, body, clientSecret),
          body,
        };
      }, 12),
    ];

    posBursts = [
      await burstHttp(posBaseUrl, { label: "POS public bootstrap burst", path: "/api/bootstrap?branch=carrizal" }, 40),
      await burstHttp(posBaseUrl, { label: "POS cashier dashboard burst", path: "/api/dashboard?branch=carrizal", headers: cashierHeaders }, 25),
      await burstHttp(posBaseUrl, { label: "POS support health burst", path: "/api/admin/support-health?branch=all", headers: ownerHeaders }, 8),
      await burstHttp(posBaseUrl, { label: "POS profitability burst", path: "/api/admin/profitability?period=month&branch=all", headers: ownerHeaders }, 8),
    ];

    ownerBursts = [
      await burstHttp(ownerBaseUrl, { label: "owner client detail burst", path: `/api/owner/clients/${CLIENT_SLUG}`, headers: ownerTokenHeaders }, 50),
      await burstHttp(ownerBaseUrl, (index = 0) => {
        const pathWithQuery = "/api/client/health";
        const body = {
          health: {
            status: "ok",
            semaphore: { status: "ok", reasons: [], actions: [] },
            metrics: { source: "perf-burst", index },
          },
          reportedAt: new Date().toISOString(),
        };
        return {
          label: "owner client health burst",
          method: "POST",
          path: pathWithQuery,
          headers: signedClientHeaders("POST", pathWithQuery, body, clientSecret),
          body,
        };
      }, 50),
    ];

    childLogs = {
      pos: posChild.perfLogs,
      ownerControl: ownerChild.perfLogs,
      loginStatuses: {
        admin: actors.admin.status,
        owner: actors.owner.status,
        cashier: actors.cashier.status,
      },
    };
  } finally {
    for (const child of children.reverse()) {
      if (!child.killed) {
        child.kill();
      }
    }
    await sleep(1000);
  }

  const result = {
    measuredAt,
    tempDir,
    runtimeSummary,
    currentControlTarget,
    posDb,
    ownerDb,
    posRoutes,
    ownerRoutes,
    idleSamples,
    posServices,
    ownerServices,
    posHttp,
    ownerHttp,
    posBursts,
    ownerBursts,
    childLogs,
  };

  fs.writeFileSync(REPORT_PATH, buildReport(result), "utf8");
  removeIfExists(tempDir);
  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    measuredAt,
    tempDirRemoved: true,
    currentControlTarget,
    slowPosHttp: posHttp.filter((row) => Number(row.p95Ms || 0) >= 100).map((row) => ({
      path: row.path,
      p95Ms: row.p95Ms,
      status: row.statuses,
    })),
    slowPosServices: posServices.filter((row) => Number(row.p95Ms || 0) >= 100).map((row) => ({
      label: row.label,
      p95Ms: row.p95Ms,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
