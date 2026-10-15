// Android-App (Capacitor-Hülle um genau diese Dateien, siehe android/).
// Die native Brücke legt window.Capacitor an; im Browser fehlt es und alles hier tut nichts.
// Ein Vordergrund-Dienst hält die Wiedergabe bei gesperrtem Bildschirm am Leben –
// ohne ihn friert Android die App im Hintergrund nach einiger Zeit ein.

const cap = globalThis.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

function call(method, options = {}) {
  if (!isNative) return;
  Promise.resolve(cap.nativePromise("Playback", method, options)).catch(() => {});
}

// Muss im Tap starten: Android erlaubt den Dienst nur aus dem Vordergrund.
export const keepAlive = title => call("start", { title });
export const release = () => call("stop");
