const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const Database = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "src", "server.js");
const WORKBOOK_PATH = path.join(ROOT_DIR, "Queseria El rincon V1.5.xlsx");
const BOOTSTRAP_TOKEN = "branding-bootstrap-token";
const JPEG_64 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCeiiitz4MKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=",
  "base64",
);

const CRC32_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * 4 + 1);
    scanlines[start] = 0;
    for (let pixel = 0; pixel < width; pixel += 1) {
      const offset = start + 1 + pixel * 4;
      scanlines[offset] = 41;
      scanlines[offset + 1] = 180;
      scanlines[offset + 2] = 150;
      scanlines[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill();
  await once(child, "exit").catch(() => {});
}

function removeDirWithRetry(targetPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

async function startServer(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-branding-http-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const runtimePath = path.join(tempDir, "runtime.json");
  const port = 35000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env };
  [
    "CONTROL_API_URL", "CONTROL_CLIENT_SLUG", "CONTROL_CLIENT_SECRET",
    "POS_FORCE_HTTPS", "POS_PUBLIC_ORIGIN", "POS_TRUST_PROXY",
  ].forEach((key) => delete env[key]);
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...env,
      PORT: String(port),
      POS_DB_PATH: dbPath,
      POS_CONFIG_PATH: runtimePath,
      POS_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await stopServer(child);
    removeDirWithRetry(tempDir);
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { baseUrl, dbPath };
    } catch (_error) {}
    if (child.exitCode != null) throw new Error(`Servidor termino antes de iniciar:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Servidor no inicio:\n${logs}`);
}

function createCookieClient(baseUrl) {
  const cookies = new Map();
  return {
    async request(pathname, options = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
          ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
          ...(options.headers || {}),
        },
      });
      const entries = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
      entries.forEach((entry) => {
        const [pair] = String(entry).split(";");
        const separator = pair.indexOf("=");
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      });
      const text = await response.text();
      let body = text;
      try { body = text ? JSON.parse(text) : null; } catch (_error) {}
      return { status: response.status, body, headers: response.headers };
    },
  };
}

function logoForm(content, mimeType, filename = "logo.png") {
  const form = new FormData();
  form.append("logo", new Blob([content], { type: mimeType }), filename);
  return form;
}

test("admin logo upload is authenticated, validated, persisted and served with immutable versioning", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  const admin = createCookieClient(server.baseUrl);
  const png = createPng(64, 64);
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 65);

  const guestOversized = await guest.request("/api/admin/branding/logo", {
    method: "POST",
    body: logoForm(oversized, "image/png"),
  });
  assert.equal(guestOversized.status, 401, "auth must run before multer reads an oversized body");

  const setup = await guest.request("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bootstrap-Token": BOOTSTRAP_TOKEN },
    body: JSON.stringify({ username: "branding-admin", password: "admin1234" }),
  });
  assert.equal(setup.status, 201);
  const login = await admin.request("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "branding-admin", password: "admin1234" }),
  });
  assert.equal(login.status, 200);
  const csrfToken = login.body.csrfToken;

  const missingCsrf = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    body: logoForm(oversized, "image/png"),
  });
  assert.equal(missingCsrf.status, 403, "CSRF must run before multer");

  const externalDb = new Database(server.dbPath);
  externalDb.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run("owner.admin_capabilities", "[]", new Date().toISOString());
  const blockedByCapability = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(oversized, "image/png"),
  });
  assert.equal(blockedByCapability.status, 403, "capability must run before multer");
  externalDb.prepare("DELETE FROM app_settings WHERE key = ?").run("owner.admin_capabilities");

  const svgDisguised = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png"),
  });
  assert.equal(svgDisguised.status, 415);

  const falseMime = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(png, "image/jpeg", "logo.jpg"),
  });
  assert.equal(falseMime.status, 415);

  const jpegUpload = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(JPEG_64, "image/jpeg", "logo.jpg"),
  });
  assert.equal(jpegUpload.status, 201);
  assert.equal(jpegUpload.body.businessProfile.branding.uploadedLogo.mimeType, "image/jpeg");
  assert.equal(jpegUpload.body.businessProfile.branding.uploadedLogo.width, 64);
  assert.equal(jpegUpload.body.businessProfile.branding.uploadedLogo.height, 64);
  const servedJpeg = await fetch(`${server.baseUrl}${jpegUpload.body.businessProfile.branding.uploadedLogo.url}`);
  assert.equal(servedJpeg.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await servedJpeg.arrayBuffer()), JPEG_64);

  const tooSmall = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(createPng(32, 32), "image/png"),
  });
  assert.equal(tooSmall.status, 422);

  const tooLarge = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(oversized, "image/png"),
  });
  assert.equal(tooLarge.status, 413);

  const upload = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: logoForm(png, "image/png"),
  });
  assert.equal(upload.status, 201);
  const uploadedLogo = upload.body.businessProfile.branding.uploadedLogo;
  assert.equal(uploadedLogo.mimeType, "image/png");
  assert.equal(uploadedLogo.width, 64);
  assert.equal(uploadedLogo.height, 64);
  assert.equal(uploadedLogo.byteSize, png.length);
  assert.match(uploadedLogo.version, /^[a-f0-9]{64}$/);
  assert.equal(uploadedLogo.url, `/api/branding/logo/${uploadedLogo.version}`);

  const stored = externalDb.prepare(`
    SELECT length(content) AS content_length, mime_type, width, height, version
    FROM business_branding_logo WHERE id = 1
  `).get();
  assert.deepEqual(stored, {
    content_length: png.length,
    mime_type: "image/png",
    width: 64,
    height: 64,
    version: uploadedLogo.version,
  });
  const audit = externalDb.prepare(`
    SELECT payload_json FROM admin_audit_logs WHERE action = 'business_logo_update'
    ORDER BY id DESC LIMIT 1
  `).get();
  assert.ok(audit.payload_json.length < 500);
  assert.equal(audit.payload_json.includes(png.toString("base64")), false);

  const publicLogo = await fetch(`${server.baseUrl}${uploadedLogo.url}`);
  assert.equal(publicLogo.status, 200);
  assert.equal(publicLogo.headers.get("content-type"), "image/png");
  assert.equal(publicLogo.headers.get("x-content-type-options"), "nosniff");
  assert.equal(publicLogo.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(publicLogo.headers.get("etag"), `"${uploadedLogo.version}"`);
  assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), png);
  const notModified = await fetch(`${server.baseUrl}${uploadedLogo.url}`, {
    headers: { "If-None-Match": `"${uploadedLogo.version}"` },
  });
  assert.equal(notModified.status, 304);

  const manifest = await (await fetch(`${server.baseUrl}/manifest.webmanifest`)).json();
  assert.equal(manifest.icons[0].src, uploadedLogo.url);
  assert.equal(manifest.icons[0].type, "image/png");
  assert.equal(manifest.icons[0].purpose, "any");
  const settings = await admin.request("/api/admin/settings");
  assert.equal(settings.status, 200);
  assert.equal(settings.body.businessProfile.branding.uploadedLogo.url, uploadedLogo.url);

  const deleteWithoutCsrf = await admin.request("/api/admin/branding/logo", { method: "DELETE" });
  assert.equal(deleteWithoutCsrf.status, 403);
  const remove = await admin.request("/api/admin/branding/logo", {
    method: "DELETE",
    headers: { "X-CSRF-Token": csrfToken },
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.businessProfile.branding.uploadedLogo, undefined);
  assert.equal(externalDb.prepare("SELECT COUNT(*) AS count FROM business_branding_logo").get().count, 0);
  assert.equal((await fetch(`${server.baseUrl}${uploadedLogo.url}`)).status, 404);
  externalDb.close();
});

test("applying a business template removes the prior uploaded logo and invalidates its URL", async (t) => {
  const server = await startServer(t);
  const guest = createCookieClient(server.baseUrl);
  const admin = createCookieClient(server.baseUrl);
  const owner = createCookieClient(server.baseUrl);

  assert.equal((await guest.request("/api/admin/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bootstrap-Token": BOOTSTRAP_TOKEN },
    body: JSON.stringify({ username: "branding-admin", password: "admin1234" }),
  })).status, 201);
  const adminLogin = await admin.request("/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "branding-admin", password: "admin1234" }),
  });
  const upload = await admin.request("/api/admin/branding/logo", {
    method: "POST",
    headers: { "X-CSRF-Token": adminLogin.body.csrfToken },
    body: logoForm(createPng(64, 64), "image/png"),
  });
  assert.equal(upload.status, 201);
  const oldLogoUrl = upload.body.businessProfile.branding.uploadedLogo.url;
  assert.equal((await fetch(`${server.baseUrl}${oldLogoUrl}`)).status, 200);

  assert.equal((await guest.request("/api/owner/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bootstrap-Token": BOOTSTRAP_TOKEN },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  })).status, 201);
  const ownerLogin = await owner.request("/api/owner/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "ownerroot", password: "owner1234" }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerConfig = await owner.request("/api/owner/config");
  assert.equal(ownerConfig.status, 200);

  const applied = await owner.request("/api/owner/templates/cremeria/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": ownerLogin.body.csrfToken,
    },
    body: JSON.stringify({
      businessName: "Branding reiniciado",
      slug: "branding-reiniciado",
      workbookPath: WORKBOOK_PATH,
      confirmReset: true,
      confirmText: ownerConfig.body.businessProfile.slug,
    }),
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.businessProfile.branding.uploadedLogo, undefined);
  assert.equal((await fetch(`${server.baseUrl}${oldLogoUrl}`)).status, 404);
  const db = new Database(server.dbPath, { readonly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_branding_logo").get().count, 0);
  db.close();
});
