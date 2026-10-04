import { AUDIO } from "./config.js";

// Lädt web/clips/<lang>.json ({ Wort: base64-MP3 }) und dekodiert Clips bei Bedarf.

const bundles = new Map();   // lang -> Promise<{ Wort: base64 }>
const decoded = new Map();   // lang\nWort -> Promise<Float32Array>
let decoderP = null;

export function loadBundle(lang) {
  if (!bundles.has(lang)) {
    const p = fetch(`clips/${lang}.json`).then(r => {
      if (!r.ok) throw new Error(`clips/${lang}.json: ${r.status}`);
      return r.json();
    });
    p.catch(() => bundles.delete(lang));  // später erneut versuchen
    bundles.set(lang, p);
  }
  return bundles.get(lang);
}

function b64ToBuffer(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}

// Promise- und Callback-Variante (ältere Safari)
function decodeWith(ctx, buf) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = ctx.decodeAudioData(buf, resolve, reject); } catch (e) { reject(e); return; }
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

// Erste Abtastrate, mit der dieser Browser dekodieren kann; Ausgaberate ≤ maxOutRate.
function decoder(sampleB64) {
  if (!decoderP) {
    decoderP = (async () => {
      const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!C) throw new Error("kein OfflineAudioContext");
      for (const rate of AUDIO.decodeRates) {
        try {
          const ctx = new C(1, rate, rate);
          const ab = await decodeWith(ctx, b64ToBuffer(sampleB64));
          const factor = Math.ceil(ab.sampleRate / AUDIO.maxOutRate);
          return { ctx, factor, outRate: Math.round(ab.sampleRate / factor) };
        } catch (e) { /* nächste Rate */ }
      }
      throw new Error("Dekodieren nicht möglich");
    })();
    decoderP.catch(() => { decoderP = null; });
  }
  return decoderP;
}

export async function outRate(lang) {
  const bundle = await loadBundle(lang);
  return (await decoder(Object.values(bundle)[0])).outRate;
}

export function pcm(lang, word) {
  const key = lang + "\n" + word;
  if (!decoded.has(key)) {
    const p = loadBundle(lang).then(async bundle => {
      const d = await decoder(bundle[word]);
      const x = (await decodeWith(d.ctx, b64ToBuffer(bundle[word]))).getChannelData(0);
      return d.factor === 1 ? x : downsample(x, d.factor);
    });
    p.catch(() => decoded.delete(key));
    decoded.set(key, p);
  }
  return decoded.get(key);
}

function downsample(x, f) {
  const n = Math.floor(x.length / f), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += x[i * f + k];
    y[i] = s / f;
  }
  return y;
}
