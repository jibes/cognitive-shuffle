// Registriert den Service Worker und sorgt dafür, dass die Clips der gewählten
// Stimme und die Aufnahme des gewählten Hintergrunds im Offline-Cache liegen – auch beim allerersten Besuch, bei dem die
// Seite noch nicht vom Service Worker kontrolliert wurde.

const CACHE = "ew-v3";  // wie in sw.js

let ready = null;

export function registerOffline() {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;
  ready = navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready);
  ready.catch(() => {});
  // Bittet den Browser, den Cache nicht bei Platzmangel zu räumen (Safari: sonst nach 7 Tagen ohne Nutzung).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

// still(): gilt die Wahl noch? Die Registrierung kann dauern; inzwischen Abgewähltes nicht laden.
export async function keepOffline(url, still = () => true) {
  if (!ready) return;
  try {
    await ready;
    if (!still()) return;
    const cache = await caches.open(CACHE);
    if (!(await cache.match(url))) await cache.add(url);  // meist aus dem HTTP-Cache, kein zweiter Download
  } catch (e) { /* offline nicht verfügbar – online geht es weiter */ }
}
