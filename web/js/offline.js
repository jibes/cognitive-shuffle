// Registriert den Service Worker und sorgt dafür, dass die Clips der gewählten
// Stimme im Offline-Cache liegen – auch beim allerersten Besuch, bei dem die
// Seite noch nicht vom Service Worker kontrolliert wurde.

const CACHE = "ew-v2";  // wie in sw.js

let ready = null;

export function registerOffline() {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;
  ready = navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready);
  ready.catch(() => {});
  // Bittet den Browser, den Cache nicht bei Platzmangel zu räumen (Safari: sonst nach 7 Tagen ohne Nutzung).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

export async function keepOffline(set) {
  if (!ready) return;
  try {
    await ready;
    const cache = await caches.open(CACHE);
    const url = `clips/${set}.json`;
    if (!(await cache.match(url))) await cache.add(url);  // meist aus dem HTTP-Cache, kein zweiter Download
  } catch (e) { /* offline nicht verfügbar – online geht es weiter */ }
}
