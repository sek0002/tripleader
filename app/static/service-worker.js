const CACHE_NAME = "muuc-tripleader-cache-v1";
const APP_SHELL = [
  "/",
  "/static/styles.css",
  "/static/app.js",
  "/static/theme.js",
  "/static/manifest.webmanifest",
  "/static/icons/muuc-icon-192.svg",
  "/static/icons/muuc-icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.url.startsWith("chrome-extension://")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match("/");
        }
        return new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        });
      })
  );
});
