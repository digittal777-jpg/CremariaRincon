const STATIC_CACHE_NAME = "cremeria-rincon-static-v4";
const API_CACHE_NAME = "cremeria-rincon-api-v4";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/assets/branding/rincon-logo-gold-192.png",
  "/assets/branding/rincon-logo-gold-512.png",
  "/socket.io/socket.io.js",
  "/js/config.js",
  "/js/state.js",
  "/js/helpers.js",
  "/js/storage.js",
  "/js/network.js",
  "/js/render.js",
  "/js/render-admin.js",
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

  if (requestUrl.origin === self.location.origin && requestUrl.pathname === "/api/bootstrap") {
    event.respondWith(handleBootstrapRequest(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }

  event.respondWith(handleStaticRequest(event.request));
});

async function handleBootstrapRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(STATIC_CACHE_NAME);
    cache.put("/index.html", response.clone());
    return response;
  } catch (_error) {
    return caches.match("/index.html");
  }
}

async function handleStaticRequest(request) {
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || Response.error();
  }
}
