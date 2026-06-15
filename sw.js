/* Service worker — offline-first.
   - App shell + Leaflet + dados: cache-first (pré-cacheados na instalação).
   - Tiles OSM: stale-while-revalidate (cache de runtime separado, limitado). */
const VERSAO = "ubs-toledo-20260615-090238";
const CACHE_SHELL = `${VERSAO}-shell`;
const CACHE_TILES = `${VERSAO}-tiles`;
const MAX_TILES = 400;

const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/sw-register.js",
  "manifest.webmanifest",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "vendor/images/marker-icon.png",
  "vendor/images/marker-icon-2x.png",
  "vendor/images/marker-shadow.png",
  "data/bairros.geojson",
  "data/ubs.json",
  "data/cobertura.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_SHELL).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

const isTile = (url) => /tile\.openstreetmap\.org/.test(url);

async function limitarCache(nome, max) {
  const cache = await caches.open(nome);
  const chaves = await cache.keys();
  if (chaves.length > max) await cache.delete(chaves[0]);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = request.url;

  // Tiles OSM: stale-while-revalidate.
  if (isTile(url)) {
    e.respondWith(
      caches.open(CACHE_TILES).then(async (cache) => {
        const cached = await cache.match(request);
        const rede = fetch(request)
          .then((res) => {
            cache.put(request, res.clone());
            limitarCache(CACHE_TILES, MAX_TILES);
            return res;
          })
          .catch(() => cached);
        return cached || rede;
      })
    );
    return;
  }

  // Shell e dados: cache-first com fallback de rede.
  e.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).catch(() => {
          // Navegações sem rede caem no app shell.
          if (request.mode === "navigate") return caches.match("index.html");
        })
    )
  );
});
