import { SOUNDS, bedScale } from "./ambient.js";
import { bedDb } from "./mix.js";

// Hörprobe beim Wählen von Klang und Lautstärke: einige Sekunden über Web Audio,
// Lautstärke folgt dem Regler live. Gleiche Eichung wie in der Sitzung.

const LENGTH_S = 8, FADE_S = 0.4;
let ctx = null, current = null;  // { kind, src, gain }

function context() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  if (!ctx) ctx = new C();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Muss im Tap bzw. beim Ziehen am Regler laufen (Autoplay-Regeln).
export function preview(sound) {
  if (!(sound.kind in SOUNDS)) { stopPreview(); return; }
  const c = context();
  if (!c) return;
  const lin = Math.pow(10, bedDb(sound) / 20);
  if (current && current.kind === sound.kind && !current.ended) {
    current.gain.gain.setTargetAtTime(lin, c.currentTime, 0.05);
    return;
  }
  stopPreview();
  const rate = c.sampleRate, n = Math.round(LENGTH_S * rate);
  const buffer = c.createBuffer(1, n, rate), data = buffer.getChannelData(0);
  const fill = SOUNDS[sound.kind](rate, Math.random), scale = bedScale(sound.kind, rate);
  fill(new Float32Array(rate));  // Einschwingen
  fill(data);
  const fi = FADE_S * rate, fo = 2 * FADE_S * rate;
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / fi, (n - i) / fo);
    data[i] *= scale * e * e;
  }
  const src = c.createBufferSource(), gain = c.createGain();
  src.buffer = buffer;
  gain.gain.value = lin;
  src.connect(gain).connect(c.destination);
  const me = { kind: sound.kind, src, gain, ended: false };
  src.onended = () => { me.ended = true; if (current === me) current = null; };
  src.start();
  current = me;
}

export function stopPreview() {
  if (!current) return;
  const { src, gain } = current, t = ctx.currentTime;
  current = null;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setTargetAtTime(0, t, 0.08);
  try { src.stop(t + 0.4); } catch (e) { /* schon beendet */ }
}
