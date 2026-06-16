const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createCacheStorage() {
  const stores = new Map();

  return {
    stores,
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      const store = stores.get(name);
      return {
        async put(key, value) {
          store.set(String(typeof key === "string" ? key : key.url), value);
        },
        async match(key) {
          return store.get(String(typeof key === "string" ? key : key.url)) || null;
        },
        async delete(key) {
          return store.delete(String(typeof key === "string" ? key : key.url));
        },
      };
    },
    async match(key) {
      const normalizedKey = String(typeof key === "string" ? key : key.url);
      for (const store of stores.values()) {
        if (store.has(normalizedKey)) {
          return store.get(normalizedKey);
        }
      }
      return null;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
}

function loadServiceWorkerContext(fetchImpl) {
  const rootDir = path.resolve(__dirname, "..");
  const listeners = new Map();
  const caches = createCacheStorage();
  const context = {
    URL,
    Request,
    Response,
    Headers,
    Promise,
    console,
    caches,
    fetch: fetchImpl,
    self: {
      location: { origin: "https://pos.test" },
      skipWaiting() {},
      clients: { claim() {} },
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
    },
  };
  context.globalThis = context;

  const vmContext = vm.createContext(context);
  const source = fs.readFileSync(path.join(rootDir, "public/sw.js"), "utf8");
  new vm.Script(source, { filename: "public/sw.js" }).runInContext(vmContext);

  return {
    context,
    listeners,
    caches,
  };
}

test("service worker bypasses cache for non-bootstrap API GET requests", async () => {
  const { listeners, caches } = loadServiceWorkerContext(async (request) =>
    new Response(JSON.stringify({ ok: true, url: request.url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

  const fetchHandler = listeners.get("fetch");
  let responsePromise = null;
  fetchHandler({
    request: new Request("https://pos.test/api/admin/settings"),
    respondWith(promise) {
      responsePromise = promise;
    },
  });

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(caches.stores.size, 0);
});

test("navigation caching only stores successful html responses", async () => {
  let fetchMode = "error-html";
  const { context, caches } = loadServiceWorkerContext(async () => {
    if (fetchMode === "error-html") {
      return new Response("<html>Error</html>", {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("<html>OK</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  await context.handleNavigationRequest(new Request("https://pos.test/"));
  assert.equal(Boolean(caches.stores.get("retail-base-static-v14")?.has("/index.html")), false);

  fetchMode = "ok-html";
  await context.handleNavigationRequest(new Request("https://pos.test/"));
  assert.equal(Boolean(caches.stores.get("retail-base-static-v14")?.has("/index.html")), true);
});
