// Misst die Hintergrundklänge (prozedural und Aufnahmen): Lautheit (LUFS, ITU-R BS.1770 K-Gewichtung) bei gleichem RMS,
// Pegelschwankung (1-s-Fenster) und Rechenzeit. Ergebnis: Vorschlag für AMBIENT.trim.
//   node tools/ambient_loudness.mjs [--wav DIR]   (WAV-Proben zum Anhören, 60 s)
import { SOUNDS, bedScale, makeLoop, loopFill } from "../web/js/ambient.js";
import { AMBIENT } from "../web/js/config.js";
import { execFileSync } from "node:child_process";
import { createWav } from "../web/js/wav.js";
import { writeFileSync, mkdirSync } from "node:fs";

const RATE = 48000, SECONDS = 120;
const wavDir = process.argv.includes("--wav") ? process.argv[process.argv.indexOf("--wav") + 1] : null;

// K-Gewichtung bei 48 kHz (BS.1770-4): Hochton-Shelf + Hochpass
const BIQUADS = [
  [[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]],
  [[1, -2, 1], [1, -1.99004745483398, 0.99007225036621]],
];
function kWeight(x) {
  let y = x;
  for (const [b, a] of BIQUADS) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return y;
}
const lufs = x => { const k = kWeight(x); let q = 0; for (const v of k) q += v * v; return -0.691 + 10 * Math.log10(q / k.length); };

// Aufnahmen per ffmpeg dekodieren (wie im Browser: mono, dann Schleife mit Überblendung)
function loopOf(url) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", new URL(`../web/${url}`, import.meta.url).pathname,
    "-ac", "1", "-ar", String(RATE), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30 });
  return makeLoop(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), RATE);
}

const res = {};
for (const kind of AMBIENT.sounds.filter(k => k !== "off")) {
  const t0 = performance.now();
  const url = AMBIENT.files[kind], loop = url && loopOf(url);
  const sc = loop ? loop.scale : bedScale(kind, RATE);
  const fill = loop ? loopFill(loop, Math.random) : SOUNDS[kind](RATE, Math.random), buf = new Float32Array(RATE);
  const n = SECONDS * RATE, x = new Float64Array(n), g = Math.pow(10, -30 / 20) * sc;
  fill(buf);
  for (let s = 0; s < SECONDS; s++) { fill(buf); for (let j = 0; j < RATE; j++) x[s * RATE + j] = buf[j] * g; }
  const ms = (performance.now() - t0) / SECONDS * 60 * 25;  // hochgerechnet auf 25 min
  const sec = [];
  for (let s = 0; s < SECONDS; s++) {
    let q = 0;
    for (let i = s * RATE; i < (s + 1) * RATE; i++) q += x[i] * x[i];
    sec.push(10 * Math.log10(q / RATE));
  }
  let q = 0, peak = 0;
  for (const v of x) { q += v * v; peak = Math.max(peak, Math.abs(v)); }
  res[kind] = { rms: 10 * Math.log10(q / n), lufs: lufs(x), swing: Math.max(...sec) - Math.min(...sec),
    crest: 20 * Math.log10(peak) - 10 * Math.log10(q / n), ms };
  if (wavDir) {
    mkdirSync(wavDir, { recursive: true });
    const m = 60 * RATE, { buffer, pcm } = createWav(m, RATE);
    for (let i = 0; i < m; i++) pcm[i] = Math.round(x[i] * 32767 * 2);  // -24 dBFS RMS
    writeFileSync(`${wavDir}/${kind}.wav`, Buffer.from(buffer));
  }
}
const ref = res.brown.lufs;
for (const [k, r] of Object.entries(res)) {
  console.log(`${k.padEnd(6)} RMS ${r.rms.toFixed(1)} dBFS  ${r.lufs.toFixed(1)} LUFS  Schwankung ${r.swing.toFixed(1)} dB  Crest ${r.crest.toFixed(1)} dB  ~${(r.ms / 1000).toFixed(1)} s/25 min @48k  trim ${(ref - r.lufs).toFixed(1)}`);
}
