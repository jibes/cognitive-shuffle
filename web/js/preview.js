import { AMBIENT } from "./config.js";
import { SOUNDS, bedScale, makeLoop, loopFill } from "./ambient.js";
import { bedDb } from "./mix.js";
import { loadFile } from "./clips.js";

// Hörprobe beim Wählen von Klang und Lautstärke: einige Sekunden über Web Audio,
// Lautstärke folgt dem Regler live. Gleiche Eichung wie in der Sitzung.

const LENGTH_S = 8, FADE_S = 0.4;
let ctx = null, current = null;  // { kind, src, gain }
let wanted = null;                // zuletzt gewählter Klang (Aufnahmen laden asynchron)
const loops = new Map();          // url -> Promise<Schleife in der Rate des AudioContext>

function loopFor(c, url) {
  if (!loops.has(url)) {
    const p = loadFile(url)
      .then(raw => new Promise((ok, fail) => c.decodeAudioData(raw.slice(0), ok, fail)))
      .then(ab => makeLoop(ab.getChannelData(0), ab.sampleRate));
    p.catch(() => loops.delete(url));
    loops.set(url, p);
  }
  return loops.get(url);
}

function context() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  if (!ctx) ctx = new C();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Muss im Tap bzw. beim Ziehen am Regler laufen (Autoplay-Regeln).
export async function preview(sound) {
  wanted = sound.kind;
  const url = AMBIENT.files[sound.kind];
  if (!url && !(sound.kind in SOUNDS)) { stopPreview(); return; }
  const c = context();
  if (!c) return;
  const lin = Math.pow(10, bedDb(sound) / 20);
  if (current && current.kind === sound.kind && !current.ended) {
    current.gain.gain.setTargetAtTime(lin, c.currentTime, 0.05);
    return;
  }
  fadeOut();
  let fill, scale, rate = c.sampleRate;
  if (url) {
    let loop;
    try { loop = await loopFor(c, url); } catch (e) { return; }
    if (wanted !== sound.kind) return;  // inzwischen anders gewählt
    if (current && current.kind === sound.kind) {  // ein zweiter Aufruf war schneller
      current.gain.gain.setTargetAtTime(lin, c.currentTime, 0.05);
      return;
    }
    fill = loopFill(loop, Math.random);
    scale = loop.scale;
  } else {
    fill = SOUNDS[sound.kind](rate, Math.random);
    scale = bedScale(sound.kind, rate);
    fill(new Float32Array(rate));  // Einschwingen
  }
  const n = Math.round(LENGTH_S * rate);
  const buffer = c.createBuffer(1, n, rate), data = buffer.getChannelData(0);
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
  wanted = null;
  fadeOut();
}

function fadeOut() {
  if (!current) return;
  const { src, gain } = current, t = ctx.currentTime;
  current = null;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setTargetAtTime(0, t, 0.08);
  try { src.stop(t + 0.4); } catch (e) { /* schon beendet */ }
}
