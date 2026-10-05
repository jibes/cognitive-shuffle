import { SESSION, AMBIENT, lerp } from "./config.js";
import { SOUNDS, bedScale, loopFill } from "./ambient.js";
import { createWav } from "./wav.js";

// Mischt eine ganze Sitzung in eine WAV: Hintergrundklang + Wörter an ihren Anfängen.
// clips[i] gehört zu marks[i] (Float32Array, -1..1, in `rate`).
// sound = { kind, db, loop? } oder null; loop = makeLoop(...) in `rate` für Aufnahmen.
// Kein DOM, testbar in Node.
export function mixSession({ durationS, marks, clips, rate, sound, rng = Math.random, cfg = SESSION }) {
  const total = Math.ceil((cfg.lead + durationS + cfg.tail) * rate);
  const { buffer, pcm } = createWav(total, rate);

  if (sound && (sound.loop || sound.kind in SOUNDS)) addBed(pcm, rate, sound, durationS, cfg, rng);

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

// Effektiver RMS-Pegel in dBFS: Reglerwert plus Lautheitsausgleich des Klangs.
export const bedDb = ({ kind, db }) => db + (AMBIENT.trim[kind] || 0);

// Einblenden im Vorlauf, quadratisch ausblenden im Nachlauf.
function addBed(pcm, rate, sound, durationS, cfg, rng) {
  const { loop } = sound, buf = new Float32Array(4096);
  const fill = loop ? loopFill(loop, rng) : SOUNDS[sound.kind](rate, rng);
  const g = 32767 * Math.pow(10, bedDb(sound) / 20) * (loop ? loop.scale : bedScale(sound.kind, rate));
  const inEnd = cfg.lead * rate, outStart = (cfg.lead + durationS) * rate, outLen = cfg.tail * rate;
  for (let i = 0; i < rate; i += buf.length) fill(buf);  // Einschwingen
  for (let i0 = 0; i0 < pcm.length; i0 += buf.length) {
    fill(buf);
    const n = Math.min(buf.length, pcm.length - i0);
    for (let j = 0; j < n; j++) {
      const i = i0 + j;
      let e = 1;
      if (i < inEnd) e = i / inEnd;
      else if (i > outStart) { const r = 1 - (i - outStart) / outLen; e = r > 0 ? r * r : 0; }
      const v = buf[j] * g * e;
      pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
}
