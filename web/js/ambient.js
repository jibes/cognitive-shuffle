// Hintergrundklänge, prozedural erzeugt: keine Dateien, offline, beliebig lang, keine Schleifen.
// Neuer Klang: Generator in SOUNDS, Eintrag in config.js (AMBIENT) und Text in i18n.js
// (sound_<name>). Kein DOM, testbar in Node.
//
// Ein Generator ist (rate, rng) => fill(Float32Array): füllt den Puffer mit den nächsten
// Samples, Zustand bleibt zwischen Aufrufen erhalten. Blockweise mit lokalen Variablen,
// weil Zustand in Closures je Sample deutlich langsamer ist (25 min Audio = 36 Mio. Samples).
// bedScale() eicht auf RMS 1, damit die Lautstärke in dBFS gilt.

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

// Sanfter Regen: Rauschband 400 Hz–4,5 kHz, darin Tropfen als kurze Pegelspitzen
// (selten laut, meist leise), langsam schwankende Dichte, etwas Brummen als Körper.
function rain(rate, rng) {
  const hp = pole(400, rate), lp = pole(4500, rate), bp = pole(40, rate), BODY = 0.06;
  const DROPS = 90, GUSTS = 0.4;                 // je Sekunde im Mittel
  const gp = pole(0.15, rate);                   // Dichte gleitet über einige Sekunden
  const wait = perSecond => Math.ceil(-Math.log(1 - rng()) * rate / perSecond);
  const st = { x: seedFrom(rng), env: 0, dec: 0, h: 0, x1: 0, l: 0, b: 0, gust: 0, gustTarget: 0,
    toDrop: wait(DROPS), toGust: wait(GUSTS) };
  return buf => {
    let { x, env, dec, h, x1, l, b, gust, gustTarget, toDrop, toGust } = st;
    for (let i = 0; i < buf.length; i++) {
      if (--toDrop <= 0) {
        const a = rng();
        env += a * a * a * 2.5;
        dec = Math.exp(-1 / ((0.002 + rng() * 0.008) * rate));
        toDrop = wait(DROPS);
      }
      if (--toGust <= 0) { gustTarget = rng() * 2 - 1; toGust = wait(GUSTS); }
      env *= dec;
      gust = gp * gust + (1 - gp) * gustTarget;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      const w = (x >>> 0) * U * 2 - 1;
      b = bp * b + w;                            // Körper: braun
      const v = w * (1 + env) * (1 + 0.2 * gust);
      h = hp * (h + v - x1);                     // Hochpass
      x1 = v;
      l = lp * l + (1 - lp) * h;                 // Tiefpass
      buf[i] = l + b * BODY;
    }
    Object.assign(st, { x, env, dec, h, x1, l, b, gust, gustTarget, toDrop, toGust });
  };
}

// Sanfte Wellen: tiefes Rauschen, dessen Pegel und Helligkeit mit jeder Welle
// anschwillt und abebbt (7–12 s, unregelmäßig), über einem leisen, fernen Brandungsteppich.
function waves(rate, rng) {
  const sp = pole(40, rate), SURF = 0.012, BLOCK = 32;  // Hüllkurve und Filter je 32 Samples
  const st = { x: seedFrom(rng), t: 0, len: 1, peak: 0, env: 0, a: 0, l1: 0, l2: 0, s: 0, k: 0 };
  const wave = () => { st.t = 0; st.len = (7 + rng() * 5) * rate; st.peak = 0.45 + rng() * 0.35; };
  wave();
  st.t = Math.floor(0.15 * st.len);              // beginnt im Anschwellen
  return buf => {
    let { x, env, a, l1, l2, s, k } = st;
    for (let i = 0; i < buf.length; i++) {
      if (--k <= 0) {
        k = BLOCK;
        if ((st.t += BLOCK) >= st.len) wave();
        const ph = st.t / st.len, r = ph / 0.4;
        const shape = ph < 0.4 ? r * r * (3 - 2 * r) : Math.exp(-(ph - 0.4) * 5);
        env = 0.3 + st.peak * shape;
        a = pole(180 + 1400 * env * env, rate);
      }
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      const w = (x >>> 0) * U * 2 - 1;
      l1 = a * l1 + (1 - a) * w;
      l2 = a * l2 + (1 - a) * l1;
      s = sp * s + w;
      buf[i] = l2 * env + s * SURF;
    }
    Object.assign(st, { x, env, a, l1, l2, s, k });
  };
}

export const SOUNDS = { brown, rain, waves };

// Deterministischer Zufall nur fürs Eichen (mulberry32)
function seeded(seed) {
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
