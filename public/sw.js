const CACHE_NAME = "petri-collider-v3";
const PRECACHE_URLS = [
  "/manifest.json",
  "/fonts/DOTMATRI.TTF",
  "/fonts/DOTMBold.TTF",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Admin pages and APIs always need live server data. */
function isLivePath(pathname) {
  return pathname.startsWith("/api/") || pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Navigations render scores and stats into HTML, so they cannot be cache-first. */
function isDocumentRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function networkOnly(request, fallback) {
  return fetch(request, { cache: "no-store" }).catch(() =>
    typeof fallback === "function" ? fallback() : fallback,
  );
}

function networkFirst(request) {
  return fetch(request, { cache: "no-store" })
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || Response.error()));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/sw.js" || isLivePath(url.pathname)) {
    event.respondWith(
      networkOnly(request, () => {
        if (url.pathname.startsWith("/api/")) {
          return new Response(JSON.stringify({ success: false, offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.error();
      }),
    );
    return;
  }

  if (isDocumentRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
