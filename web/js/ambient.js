// Hintergrundklänge. Zwei Arten:
//   SOUNDS – prozedural erzeugt (braunes Rauschen), keine Datei;
//   Aufnahmen – web/sounds/<name>.mp3 (AMBIENT.files), in Schleife mit überblendeter Naht.
// Neuer Klang: Generator in SOUNDS oder Datei in AMBIENT.files (tools/build_loops.py, Lizenz in
// web/sounds/CREDITS.md), dazu AMBIENT.sounds/trim in config.js und sound_<name> in i18n.js.
// Kein DOM, testbar in Node.
//
// Ein Generator ist (rate, rng) => fill(Float32Array): füllt den Puffer mit den nächsten
// Samples, Zustand bleibt zwischen Aufrufen erhalten. Blockweise mit lokalen Variablen,
// weil Zustand in Closures je Sample deutlich langsamer ist (25 min Audio = 36 Mio. Samples).
// bedScale() bzw. loop.scale eichen auf RMS 1, damit die Lautstärke in dBFS gilt.

const TAU = 2 * Math.PI;
const pole = (hz, rate) => Math.exp(-TAU * Math.min(hz, rate * 0.45) / rate);
const U = 2.3283064365386963e-10;  // 2^-32

// xorshift32, Startwert aus rng (Tests bleiben deterministisch); ~4× schneller als Math.random
const seedFrom = rng => ((rng() * 4294967296) >>> 0) || 1;

// Braunes Rauschen (1/f² oberhalb 40 Hz): Leaky-Integrator über Weißrauschen.
function brown(rate, rng) {
  const a = pole(40, rate);
  const st = { x: seedFrom(rng), y: 0 };
  return buf => {
    let { x, y } = st;
    for (let i = 0; i < buf.length; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      y = a * y + ((x >>> 0) * U * 2 - 1);
      buf[i] = y;
    }
    st.x = x; st.y = y;
  };
}

export const SOUNDS = { brown };

// Aufnahme als Schleife: die letzten XFADE_S Sekunden werden gleichleistungs-überblendet
// (Enden sind unkorreliert) in den Anfang gelegt; danach reiht sie sich nahtlos aneinander.
// Auch Stille vom MP3-Kodierer an den Enden fällt so in die Blende.
const XFADE_S = 2;
export function makeLoop(data, rate) {
  const f = Math.min(Math.round(XFADE_S * rate), Math.floor(data.length / 3));
  const period = data.length - f, out = new Float32Array(period);
  out.set(data.subarray(0, period));
  for (let i = 0; i < f; i++) {
    const t = (i / f) * Math.PI / 2;
    out[i] = data[i] * Math.sin(t) + data[period + i] * Math.cos(t);
  }
  let q = 0;
  for (const v of out) q += v * v;
  return { data: out, scale: 1 / Math.sqrt(q / period || 1) };
}

// Spielt eine Schleife ab zufälliger Stelle (jede Nacht anders); skip: so viele Samples überspringen.
export function loopFill(loop, rng, skip = 0) {
  const d = loop.data, n = d.length;
  let pos = (Math.floor(rng() * n) + skip) % n;
  return buf => {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = d[pos];
      if (++pos >= n) pos = 0;
    }
  };
}

// Deterministischer Zufall (mulberry32): Eichen, und Hintergrund einer Sitzung reproduzierbar
// (beim Neumischen ab Minute x klingt er nahtlos gleich weiter)
export function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Faktor auf RMS 1, gemessen über 120 s mit festem Startwert (Wellen brauchen viele Zyklen).
const scales = new Map();
export function bedScale(kind, rate) {
  const key = kind + "@" + rate;
  if (!scales.has(key)) {
    const fill = SOUNDS[kind](rate, seeded(12345)), buf = new Float32Array(rate);
    fill(buf);  // Einschwingen
    let q = 0;
    for (let s = 0; s < 120; s++) { fill(buf); for (const v of buf) q += v * v; }
    scales.set(key, 1 / Math.sqrt(q / (120 * rate)));
  }
  return scales.get(key);
}
