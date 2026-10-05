// Offline-Betrieb. Klassisches Skript (kein Modul), damit es überall läuft.
//
// App-Hülle (HTML/JS/CSS/Icons): Netz zuerst mit Zeitlimit, sonst Cache –
//   online gibt es immer die neueste Fassung, offline die zuletzt gesehene.
// Clips (clips/*.json) und Schriften: Cache zuerst, im Hintergrund nachladen.

const CACHE = "ew-v2";  // neu bei geändertem Clip-Schema: alte Caches fliegen raus
const NETWORK_TIMEOUT_MS = 3000;

// Muss alle Dateien der App-Hülle enthalten (tests/unit.test.mjs prüft das).
const SHELL = [
  "./",
  "css/app.css",
  "js/main.js",
  "js/config.js",
  "js/i18n.js",
  "js/storage.js",
  "js/schedule.js",
  "js/deck.js",
  "js/mix.js",
  "js/wav.js",
  "js/clips.js",
  "js/stage.js",
  "js/offline.js",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "manifest.de.webmanifest",
  "manifest.en.webmanifest",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !fonts) return;

  if (fonts || url.pathname.includes("/clips/")) {
    event.respondWith(cacheFirst(event, req));
  } else {
    event.respondWith(networkFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = req.mode === "navigate" ? "./" : req;
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req, { cache: "no-cache" })  // bedingte Anfrage, meist 304
    .then(res => (res.ok || res.type === "opaque") ? cache.put(req, res.clone()).then(() => res) : res);
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
