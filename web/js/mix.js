import { SESSION, AMBIENT, lerp } from "./config.js";
import { SOUNDS, bedScale, loopFill, seeded } from "./ambient.js";
import { wavHeader } from "./wav.js";

// Mischt eine Sitzung als WAV-Blob: Hintergrundklang + Wörter an ihren Anfängen.
// Stückweise (CHUNK_S), damit nie die ganze Sitzung als Array im Speicher liegt
// (120 min bei 24 kHz wären 345 MB). Kein DOM, testbar in Node.
//
//   marks[i] = { t, p }, clips[i] = Float32Array (-1..1, in `rate`) dazu
//   sound = { kind, db, loop? } oder null; loop = makeLoop(...) in `rate` für Aufnahmen
//   seed: Hintergrund einer Sitzung ist damit reproduzierbar
//   fromS: Blob beginnt erst bei dieser Sitzungszeit (Neumischen ab der aktuellen Stelle)
const CHUNK_S = 30;

export function mixSession({ durationS, marks, clips, rate, sound, seed = 1, fromS = 0, cfg = SESSION }) {
  const total = Math.ceil((cfg.lead + durationS + cfg.tail) * rate);
  const first = Math.min(total, Math.round(fromS * rate));
  const bed = sound && (sound.loop || sound.kind in SOUNDS) ? bedSource(sound, rate, seed, first, durationS, cfg) : null;
  const words = marks.map((m, i) => ({ s0: Math.round(m.t * rate), x: clips[i], gain: 32767 * lerp(cfg.voice, m.p) }))
    .filter(w => w.s0 + w.x.length > first);

  let blob = new Blob([wavHeader(total - first, rate)]);
  const size = CHUNK_S * rate;
  for (let a = first; a < total; a += size) {
    const n = Math.min(size, total - a), pcm = new Int16Array(n);
    if (bed) bed(pcm, a);
    for (const w of words) {
      const lo = Math.max(a, w.s0), hi = Math.min(a + n, w.s0 + w.x.length);
      for (let i = lo; i < hi; i++) {
        const v = pcm[i - a] + w.x[i - w.s0] * w.gain;
        pcm[i - a] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
    blob = new Blob([blob, pcm]);  // verweist auf den bisherigen Blob, kopiert nur das Stück
  }
  return blob;
}

// Effektiver RMS-Pegel in dBFS: Reglerwert plus Lautheitsausgleich des Klangs.
export const bedDb = ({ kind, db }) => db + (AMBIENT.trim[kind] || 0);

// Liefert (pcm, a) => schreibt Hintergrund für Samples a … a+pcm.length.
// Einblenden im Vorlauf, quadratisch ausblenden im Nachlauf.
function bedSource(sound, rate, seed, first, durationS, cfg) {
  const rng = seeded(seed), { loop } = sound, buf = new Float32Array(4096);
  const fill = loop ? loopFill(loop, rng, first) : SOUNDS[sound.kind](rate, rng);
  if (!loop) {  // Einschwingen (1 s) und bis fromS vorspulen – genau so viele Samples wie beim Abspielen
    for (let left = rate + first; left > 0; left -= buf.length) fill(left >= buf.length ? buf : buf.subarray(0, left));
  }
  const g = 32767 * Math.pow(10, bedDb(sound) / 20) * (loop ? loop.scale : bedScale(sound.kind, rate));
  const inEnd = cfg.lead * rate, outStart = (cfg.lead + durationS) * rate, outLen = cfg.tail * rate;
  return (pcm, a) => {
    for (let j0 = 0; j0 < pcm.length; j0 += buf.length) {
      const n = Math.min(buf.length, pcm.length - j0);
      fill(n === buf.length ? buf : buf.subarray(0, n));
      for (let j = 0; j < n; j++) {
        const i = a + j0 + j;
        let e = 1;
        if (i < inEnd) e = i / inEnd;
        else if (i > outStart) { const r = 1 - (i - outStart) / outLen; e = r > 0 ? r * r : 0; }
        const v = buf[j] * g * e;
        pcm[j0 + j] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
  };
}
