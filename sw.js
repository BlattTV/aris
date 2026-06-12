/**
 * Service Worker: macht die App offline-fähig und als Android-App
 * installierbar (PWA). App-Shell wird gecacht, Kartenkacheln und
 * Overpass-Daten laufen network-first mit Cache-Fallback.
 */
const CACHE = "coburg-analyzer-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/data.js",
  "./js/store.js",
  "./js/analysis.js",
  "./js/overpass.js",
  "./js/map.js",
  "./js/ui.js",
  "./js/charts.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Kartenkacheln & API: network-first, dann Cache
  const networkFirst =
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("overpass-api.de");

  if (networkFirst) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App-Shell: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
