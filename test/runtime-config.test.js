const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  SELF_SIGNED_CERT_B64,
  SELF_SIGNED_KEY_B64,
} = require("../support/self-signed-tls");

const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");

function clearSrcRequireCache() {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(SRC_DIR))
    .forEach((entry) => {
      delete require.cache[entry];
    });
}

function restoreEnv(previousEnv) {
  Object.entries(previousEnv).forEach(([key, value]) => {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

test("config reads POS runtime values from a private local file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-config-"));
  const configPath = path.join(tempDir, "runtime.json");
  const dbPath = path.join(tempDir, "client.sqlite");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_DB_PATH: process.env.POS_DB_PATH,
    POS_PUBLIC_ORIGIN: process.env.POS_PUBLIC_ORIGIN,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: process.env.CONTROL_CLIENT_SECRET,
  };

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  Object.keys(previousEnv).forEach((key) => {
    delete process.env[key];
  });
  fs.writeFileSync(configPath, JSON.stringify({
    POS_DB_PATH: dbPath,
    POS_PUBLIC_ORIGIN: "http://localhost:3999",
    CONTROL_API_URL: "http://localhost:3200",
    CONTROL_CLIENT_SLUG: "cliente-prueba",
    CONTROL_CLIENT_SECRET: "pos_test_secret",
  }), "utf8");
  process.env.POS_CONFIG_PATH = configPath;
  process.env.POS_DB_PATH = path.join(tempDir, "railway-env.sqlite");
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.DB_PATH, dbPath);
  assert.equal(config.POS_PUBLIC_ORIGIN, "http://localhost:3999");
  assert.equal(config.CONTROL_API_URL, "http://localhost:3200");
  assert.equal(config.CONTROL_CLIENT_SLUG, "cliente-prueba");
  assert.equal(config.CONTROL_CLIENT_SECRET, "pos_test_secret");
  assert.equal(config.RUNTIME_CONFIG_STATUS.loaded, true);
  assert.equal(config.RUNTIME_CONFIG_STATUS.sourcePath, configPath);
  assert.ok(config.RUNTIME_CONFIG_STATUS.keys.includes("POS_DB_PATH"));
  assert.ok(config.RUNTIME_CONFIG_STATUS.secretKeys.includes("CONTROL_CLIENT_SECRET"));
});

test("Railway pairing variables override stale values in the private runtime file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-pairing-env-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
    CONTROL_CLIENT_SLUG: process.env.CONTROL_CLIENT_SLUG,
    CONTROL_CLIENT_SECRET: process.env.CONTROL_CLIENT_SECRET,
  };

  t.after(() => {
    restoreEnv(previousEnv);
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  fs.writeFileSync(configPath, JSON.stringify({
    env: {
      CONTROL_API_URL: "http://127.0.0.1:3200",
      CONTROL_CLIENT_SLUG: "cliente-antiguo",
      CONTROL_CLIENT_SECRET: "pos_old_secret",
    },
  }), "utf8");
  process.env.POS_CONFIG_PATH = configPath;
  process.env.CONTROL_API_URL = "https://owner-control.example";
  process.env.CONTROL_CLIENT_SLUG = "cremeria-rincon";
  process.env.CONTROL_CLIENT_SECRET = "pos_current_secret";
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.CONTROL_API_URL, "https://owner-control.example");
  assert.equal(config.CONTROL_CLIENT_SLUG, "cremeria-rincon");
  assert.equal(config.CONTROL_CLIENT_SECRET, "pos_current_secret");
  const runtimeConfig = require("../src/runtimeConfig");
  const urlVariable = runtimeConfig.getRuntimeConfigEditorSnapshot().variables
    .find((variable) => variable.key === "CONTROL_API_URL");
  assert.equal(urlVariable.value, "https://owner-control.example");
  assert.equal(urlVariable.source, "service");
});

test("owner runtime config save preserves stored secrets when fields stay blank", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-save-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  const firstSave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      CONTROL_CLIENT_SECRET: "pos_secret_one",
      CONTROL_CLIENT_SLUG: "cliente-uno",
      POS_PUBLIC_ORIGIN: "https://cliente-uno.example",
    },
  });
  assert.equal(firstSave.saved, true);
  assert.equal(firstSave.requiresRestart, true);

  const secondSave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      CONTROL_CLIENT_SECRET: "",
      CONTROL_CLIENT_SLUG: "cliente-dos",
      POS_PUBLIC_ORIGIN: "",
    },
  });
  assert.deepEqual(secondSave.updatedKeys, ["CONTROL_CLIENT_SLUG"]);
  assert.deepEqual(secondSave.clearedKeys, ["POS_PUBLIC_ORIGIN"]);

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(saved.env.CONTROL_CLIENT_SECRET, "pos_secret_one");
  assert.equal(saved.env.CONTROL_CLIENT_SLUG, "cliente-dos");
  assert.equal(Object.prototype.hasOwnProperty.call(saved.env, "POS_PUBLIC_ORIGIN"), false);

  const snapshot = runtimeConfig.getRuntimeConfigEditorSnapshot();
  const secretVariable = snapshot.variables.find((variable) => variable.key === "CONTROL_CLIENT_SECRET");
  assert.equal(secretVariable.hasStoredValue, true);
  assert.equal(secretVariable.value, "");
  assert.equal(secretVariable.maskedValue, "********");
});

test("runtime config save treats identical values as a no-op", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-noop-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  const firstSave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_PUBLIC_ORIGIN: "https://cliente-uno.example",
      CONTROL_CONFIG_POLL_MS: "45000",
    },
  });
  assert.equal(firstSave.changed, true);
  assert.equal(firstSave.requiresRestart, true);

  const secondSave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_PUBLIC_ORIGIN: "https://cliente-uno.example",
      CONTROL_CONFIG_POLL_MS: "45000",
    },
  });
  assert.equal(secondSave.changed, false);
  assert.equal(secondSave.requiresRestart, false);
  assert.deepEqual(secondSave.updatedKeys, []);
  assert.deepEqual(secondSave.clearedKeys, []);
});

test("bootstrap token changes apply without restart while static runtime changes still require one", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-bootstrap-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  const tokenOnlySave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_BOOTSTRAP_TOKEN: "bootstrap-runtime-one",
    },
  });
  assert.equal(tokenOnlySave.changed, true);
  assert.equal(tokenOnlySave.requiresRestart, false);
  assert.deepEqual(tokenOnlySave.restartRequiredKeys, []);

  const mixedSave = runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_BOOTSTRAP_TOKEN: "bootstrap-runtime-two",
      POS_PUBLIC_ORIGIN: "https://cliente-uno.example",
    },
  });
  assert.equal(mixedSave.changed, true);
  assert.equal(mixedSave.requiresRestart, true);
  assert.deepEqual(mixedSave.restartRequiredKeys, ["POS_PUBLIC_ORIGIN"]);
});

test("explicit POS_CONFIG_PATH does not fall back to another runtime file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-explicit-"));
  const missingConfigPath = path.join(tempDir, "missing-runtime.json");
  const dbPath = path.join(tempDir, "explicit.sqlite");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_DB_PATH: process.env.POS_DB_PATH,
    CONTROL_API_URL: process.env.CONTROL_API_URL,
  };

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = missingConfigPath;
  process.env.POS_DB_PATH = dbPath;
  process.env.CONTROL_API_URL = "http://owner-control-env.example";
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.RUNTIME_CONFIG_STATUS.loaded, false);
  assert.equal(config.RUNTIME_CONFIG_STATUS.sourcePath, missingConfigPath);
  assert.equal(config.DB_PATH, dbPath);
  assert.equal(config.CONTROL_API_URL, "http://owner-control-env.example");
});

test("config uses Railway saver defaults without explicit control polling", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-railway-saver-"));
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID,
    RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
    RAILWAY_COST_SAVER_MODE: process.env.RAILWAY_COST_SAVER_MODE,
    POS_TRUST_PROXY: process.env.POS_TRUST_PROXY,
    CONTROL_CONFIG_POLL_MS: process.env.CONTROL_CONFIG_POLL_MS,
    CONTROL_CONFIG_SYNC_MAX_AGE_MS: process.env.CONTROL_CONFIG_SYNC_MAX_AGE_MS,
  };

  t.after(() => {
    restoreEnv(previousEnv);
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = path.join(tempDir, "missing-runtime.json");
  process.env.RAILWAY_ENVIRONMENT = "production";
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  delete process.env.RAILWAY_COST_SAVER_MODE;
  delete process.env.POS_TRUST_PROXY;
  delete process.env.CONTROL_CONFIG_POLL_MS;
  delete process.env.CONTROL_CONFIG_SYNC_MAX_AGE_MS;
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.RAILWAY_COST_SAVER_MODE, true);
  assert.equal(config.CONTROL_CONFIG_POLL_MS, 0);
  assert.equal(config.CONTROL_CONFIG_SYNC_MAX_AGE_MS, 300000);
  assert.equal(config.POS_TRUST_PROXY, "100.0.0.0/8");
});

test("Railway safely merges its proxy CIDR and honors an explicit env opt-out", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-railway-proxy-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_TRUST_PROXY: process.env.POS_TRUST_PROXY,
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID,
    RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
  };

  t.after(() => {
    restoreEnv(previousEnv);
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  fs.writeFileSync(configPath, JSON.stringify({
    env: {
      POS_TRUST_PROXY: "loopback,linklocal,uniquelocal",
    },
  }), "utf8");
  process.env.POS_CONFIG_PATH = configPath;
  process.env.RAILWAY_ENVIRONMENT = "production";
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  delete process.env.POS_TRUST_PROXY;
  clearSrcRequireCache();

  let config = require("../src/config");
  assert.equal(config.POS_TRUST_PROXY, "loopback,linklocal,uniquelocal,100.0.0.0/8");

  process.env.POS_TRUST_PROXY = "false";
  clearSrcRequireCache();
  config = require("../src/config");
  assert.equal(config.POS_TRUST_PROXY, "false");
  const runtimeConfig = require("../src/runtimeConfig");
  const proxyVariable = runtimeConfig.getRuntimeConfigEditorSnapshot().variables
    .find((variable) => variable.key === "POS_TRUST_PROXY");
  assert.equal(proxyVariable.value, "false");
  assert.equal(proxyVariable.source, "service");

  process.env.POS_TRUST_PROXY = "true";
  clearSrcRequireCache();
  config = require("../src/config");
  assert.equal(config.POS_TRUST_PROXY, "true");
});

test("non-Railway runtime does not inherit Railway proxy trust", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-local-proxy-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    POS_TRUST_PROXY: process.env.POS_TRUST_PROXY,
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
    RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID,
    RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
  };

  t.after(() => {
    restoreEnv(previousEnv);
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  fs.writeFileSync(configPath, JSON.stringify({
    env: {
      POS_TRUST_PROXY: "loopback,linklocal,uniquelocal",
    },
  }), "utf8");
  process.env.POS_CONFIG_PATH = configPath;
  delete process.env.POS_TRUST_PROXY;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
  delete process.env.RAILWAY_DEPLOYMENT_ID;
  clearSrcRequireCache();

  const config = require("../src/config");
  assert.equal(config.POS_TRUST_PROXY, "loopback,linklocal,uniquelocal");
});

test("explicit control polling overrides Railway saver defaults", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-railway-explicit-"));
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
    RAILWAY_COST_SAVER_MODE: process.env.RAILWAY_COST_SAVER_MODE,
    CONTROL_CONFIG_POLL_MS: process.env.CONTROL_CONFIG_POLL_MS,
    CONTROL_CONFIG_SYNC_MAX_AGE_MS: process.env.CONTROL_CONFIG_SYNC_MAX_AGE_MS,
  };

  t.after(() => {
    restoreEnv(previousEnv);
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = path.join(tempDir, "missing-runtime.json");
  process.env.RAILWAY_ENVIRONMENT = "production";
  delete process.env.RAILWAY_COST_SAVER_MODE;
  process.env.CONTROL_CONFIG_POLL_MS = "120000";
  process.env.CONTROL_CONFIG_SYNC_MAX_AGE_MS = "600000";
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.RAILWAY_COST_SAVER_MODE, true);
  assert.equal(config.CONTROL_CONFIG_POLL_MS, 120000);
  assert.equal(config.CONTROL_CONFIG_SYNC_MAX_AGE_MS, 600000);
});

test("runtime config save rejects insecure remote control URLs", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-https-guard-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      CONTROL_API_URL: "http://owner-control.example",
    },
  }), /CONTROL_API_URL debe usar HTTPS fuera de localhost/i);
});

test("runtime config save rejects invalid trust proxy lists", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-trust-proxy-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_TRUST_PROXY: "loopback,???",
    },
  }), /POS_TRUST_PROXY no es una lista valida de proxies confiables/i);

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_TRUST_PROXY: "true",
    },
  }), /POS_TRUST_PROXY debe listar proxies confiables explicitos/i);

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_TRUST_PROXY: "1",
    },
  }), /POS_TRUST_PROXY debe listar proxies confiables explicitos/i);
});

test("runtime config save rejects invalid HTTPS PEM base64", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-https-pem-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_HTTPS_KEY_B64: "no-es-pem",
    },
  }), /POS_HTTPS_KEY_B64 debe ser base64 valido|POS_HTTPS_KEY_B64 debe contener un PEM codificado en base64/i);
});

test("config defaults secure cookies and local https origins when direct TLS is configured", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-direct-https-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    PORT: process.env.PORT,
    POS_PUBLIC_ORIGIN: process.env.POS_PUBLIC_ORIGIN,
    POS_SECURE_COOKIES: process.env.POS_SECURE_COOKIES,
    POS_HTTPS_CERT_B64: process.env.POS_HTTPS_CERT_B64,
    POS_HTTPS_KEY_B64: process.env.POS_HTTPS_KEY_B64,
  };

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  process.env.PORT = "3443";
  delete process.env.POS_PUBLIC_ORIGIN;
  delete process.env.POS_SECURE_COOKIES;
  process.env.POS_HTTPS_CERT_B64 = SELF_SIGNED_CERT_B64;
  process.env.POS_HTTPS_KEY_B64 = SELF_SIGNED_KEY_B64;
  clearSrcRequireCache();

  const config = require("../src/config");

  assert.equal(config.SESSION_COOKIE_SECURE, true);
  assert.ok(config.ALLOWED_ORIGINS.includes("https://127.0.0.1:3443"));
  assert.ok(config.ALLOWED_ORIGINS.includes("https://localhost:3443"));
});

test("runtime config save rejects incomplete direct HTTPS combinations", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-https-combo-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
    POS_CONFIG_PATH: process.env.POS_CONFIG_PATH,
    PORT: process.env.PORT,
  };

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env.POS_CONFIG_PATH = configPath;
  process.env.PORT = "3100";
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
    },
  }), /POS_HTTPS_CERT_\* y POS_HTTPS_KEY_\* deben configurarse juntos/i);

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      POS_HTTP_REDIRECT_PORT: "80",
    },
  }), /POS_HTTP_REDIRECT_PORT requiere configurar certificado y llave HTTPS del POS/i);

  assert.throws(() => runtimeConfig.saveRuntimeConfigValues({
    values: {
      PORT: "8443",
      POS_HTTPS_CERT_B64: SELF_SIGNED_CERT_B64,
      POS_HTTPS_KEY_B64: SELF_SIGNED_KEY_B64,
      POS_HTTP_REDIRECT_PORT: "8443",
    },
  }), /POS_HTTP_REDIRECT_PORT no puede usar el mismo puerto que PORT/i);
});

test("runtime config snapshot marks pending restart keys when the file changed after boot", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-runtime-restart-pending-"));
  const configPath = path.join(tempDir, "runtime.json");
  const previousEnv = {
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
    clearSrcRequireCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  fs.writeFileSync(configPath, JSON.stringify({
    env: {
      POS_PUBLIC_ORIGIN: "https://antes.example",
      POS_SECURE_COOKIES: "true",
    },
  }, null, 2), "utf8");
  process.env.POS_CONFIG_PATH = configPath;
  clearSrcRequireCache();
  const runtimeConfig = require("../src/runtimeConfig");

  fs.writeFileSync(configPath, JSON.stringify({
    env: {
      POS_PUBLIC_ORIGIN: "https://despues.example",
      POS_SECURE_COOKIES: "true",
      TELEGRAM_CHAT_IDS: "12345",
    },
  }, null, 2), "utf8");

  const snapshot = runtimeConfig.getRuntimeConfigEditorSnapshot();
  assert.equal(snapshot.status.restartRequired, true);
  assert.ok(snapshot.status.pendingRestartKeys.includes("POS_PUBLIC_ORIGIN"));
  assert.ok(snapshot.status.pendingRestartKeys.includes("TELEGRAM_CHAT_IDS"));

  const publicOriginVariable = snapshot.variables.find((variable) => variable.key === "POS_PUBLIC_ORIGIN");
  assert.equal(publicOriginVariable.pendingRestart, true);
  const secureCookiesVariable = snapshot.variables.find((variable) => variable.key === "POS_SECURE_COOKIES");
  assert.equal(secureCookiesVariable.pendingRestart, false);
});
