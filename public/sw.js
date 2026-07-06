const STATIC_CACHE_NAME = "retail-base-static-v15";
const API_CACHE_NAME = "retail-base-api-v15";
const APP_SHELL = [
  "/",
  "/administracion",
  "/index.html",
  "/styles.css",
  "/assets/branding/retail-base-badge.svg",
  "/socket.io/socket.io.js",
  "/js/config.js",
  "/js/state.js",
  "/js/helpers.js",
  "/js/storage.js",
  "/js/network.js",
  "/js/render.js",
  "/js/render-admin.js",
  "/js/quick-import-state.js",
  "/js/quick-import.js",
  "/js/merchandise-requests.js",
  "/js/actions.js",
  "/js/sales.js",
  "/js/auth.js",
  "/js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE_NAME, API_CACHE_NAME].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.pathname.startsWith("/socket.io/") && !requestUrl.pathname.endsWith(".js")) {
    return;
  }

  if (isBootstrapApiRequest(requestUrl)) {
    event.respondWith(handleBootstrapRequest(event.request));
    return;
  }

  if (isNetworkOnlyApiRequest(requestUrl)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }

  event.respondWith(handleStaticRequest(event.request));
});

async function handleBootstrapRequest(request) {
  const authenticatedBootstrapRequest = hasBootstrapAuthHeaders(request);
  const cache = await caches.open(API_CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      if (await shouldCacheGuestBootstrapResponse(request, response)) {
        cache.put(request, response.clone());
      } else {
        await cache.delete(request);
      }
    }
    return response;
  } catch (error) {
    if (authenticatedBootstrapRequest) {
      throw error;
    }

    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

function hasBootstrapAuthHeaders(request) {
  return Boolean(
    request.headers.get("x-cashier-token")
    || request.headers.get("x-csrf-token")
    || request.headers.get("x-admin-user"),
  );
}

async function shouldCacheGuestBootstrapResponse(request, response) {
  if (hasBootstrapAuthHeaders(request)) {
    return false;
  }

  try {
    const payload = await response.clone().json();
    return payload?.auth?.role === "guest";
  } catch (_error) {
    return false;
  }
}

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    if (isCacheableNavigationResponse(response) && !isNoStoreResponse(response)) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put("/index.html", response.clone());
    }
    return response;
  } catch (_error) {
    return caches.match("/index.html");
  }
}

function isBootstrapApiRequest(requestUrl) {
  return requestUrl.origin === self.location.origin && requestUrl.pathname === "/api/bootstrap";
}

function isNetworkOnlyApiRequest(requestUrl) {
  return requestUrl.origin === self.location.origin
    && requestUrl.pathname.startsWith("/api/")
    && requestUrl.pathname !== "/api/bootstrap";
}

function isCacheableNavigationResponse(response) {
  if (!response?.ok) {
    return false;
  }

  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  return contentType.includes("text/html");
}

function isNoStoreResponse(response) {
  const cacheControl = String(response?.headers?.get?.("cache-control") || "").toLowerCase();
  const pragma = String(response?.headers?.get?.("pragma") || "").toLowerCase();
  return cacheControl.includes("no-store") || pragma.includes("no-cache");
}

async function handleStaticRequest(request) {
  try {
    const response = await fetch(request);
    if ((response.ok || response.type === "opaque") && !isNoStoreResponse(response)) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || Response.error();
  }
}
