import { SESSION, NOISE, lerp } from "./config.js";
import { createWav } from "./wav.js";

// Mischt eine ganze Sitzung in eine WAV: braunes Rauschen + Wörter an ihren Anfängen.
// clips[i] gehört zu marks[i] (Float32Array, -1..1, in `rate`). Kein DOM, testbar in Node.
export function mixSession({ durationS, marks, clips, rate, noiseDb, rng = Math.random, cfg = SESSION }) {
  const total = Math.ceil((cfg.lead + durationS + cfg.tail) * rate);
  const { buffer, pcm } = createWav(total, rate);

  if (noiseDb != null) addBrownNoise(pcm, rate, noiseDb, durationS, cfg, rng);

  marks.forEach((m, i) => {
    const x = clips[i], gain = 32767 * lerp(cfg.voice, m.p), s0 = Math.round(m.t * rate);
    const n = Math.min(x.length, total - s0);
    for (let j = 0; j < n; j++) {
      const v = pcm[s0 + j] + x[j] * gain;
      pcm[s0 + j] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  });
  return buffer;
}

// Leaky-Integrator über Weißrauschen; Pegel analytisch aus der stationären Varianz,
// damit kein zweiter Durchlauf nötig ist. Einblenden im Vorlauf, quadratisch ausblenden im Nachlauf.
function addBrownNoise(pcm, rate, db, durationS, cfg, rng) {
  const a = Math.exp(-2 * Math.PI * NOISE.corner / rate);
  const sd = Math.sqrt((1 / 3) / (1 - a * a));
  const g = 32767 * Math.pow(10, db / 20) / sd;
  const inEnd = cfg.lead * rate, outStart = (cfg.lead + durationS) * rate, outLen = cfg.tail * rate;
  let y = 0;
  for (let i = 0; i < pcm.length; i++) {
    y = a * y + (rng() * 2 - 1);
    let e = 1;
    if (i < inEnd) e = i / inEnd;
    else if (i > outStart) { const r = 1 - (i - outStart) / outLen; e = r > 0 ? r * r : 0; }
    pcm[i] = y * g * e;
  }
}
