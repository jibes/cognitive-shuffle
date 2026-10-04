import { DISPLAY, lerp } from "./config.js";
import { createWav } from "./wav.js";

// Wiedergabe-Element und Wortanzeige. Die Anzeige folgt audio.currentTime;
// bei gesperrtem Bildschirm läuft nur das <audio>-Element weiter.

// 0,1 s Stille – zum Freischalten unter iOS noch im Tap
const SILENT_WAV = URL.createObjectURL(new Blob([createWav(800, 8000).buffer], { type: "audio/wav" }));

export function createStage({ audio, word, tapHint }) {
  let marks = null, idx = -1, rafId = 0, lastOpacity = "";

  function frame() {
    rafId = 0;
    if (!marks) return;
    const ct = audio.currentTime;
    while (idx + 1 < marks.length && marks[idx + 1].t <= ct) idx++;
    while (idx >= 0 && marks[idx].t > ct) idx--;
    let op = 0;
    if (idx >= 0) {
      const m = marks[idx], el = ct - m.t;
      const fi = Math.min(1, el / lerp(DISPLAY.fadeIn, m.p));
      const fo = Math.max(0, 1 - Math.max(0, el - DISPLAY.hold) / DISPLAY.fadeOut);
      op = lerp(DISPLAY.glow, m.p) * fi * fi * (3 - 2 * fi) * fo;  // smoothstep
      if (word.textContent !== m.w) word.textContent = m.w;
    }
    const s = op.toFixed(3);
    if (s !== lastOpacity) { word.style.opacity = s; lastOpacity = s; }
    rafId = requestAnimationFrame(frame);
  }

  const api = {
    // Muss synchron im Tap-Handler laufen.
    unlock() {
      audio.src = SILENT_WAV;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    },

    play(url, sessionMarks, meta) {
      marks = sessionMarks;
      idx = -1;
      audio.src = url;
      if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata(meta);
        try { navigator.mediaSession.setActionHandler("nexttrack", api.skip); } catch (e) { /* egal */ }
      }
      api.resume();
    },

    resume() {
      const p = audio.play();
      if (p && p.then) p.then(() => { tapHint.hidden = true; }, () => { tapHint.hidden = false; });
      api.frames();
    },

    frames() { if (!rafId && marks) rafId = requestAnimationFrame(frame); },

    get paused() { return audio.paused; },

    skip() {
      if (!marks) return;
      const ct = audio.currentTime;
      const next = marks.find(m => m.t - DISPLAY.skipLead > ct + 0.05);
      if (next) audio.currentTime = next.t - DISPLAY.skipLead;
    },

    stop() {
      marks = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      const old = audio.src;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (old && old.startsWith("blob:") && old !== SILENT_WAV) URL.revokeObjectURL(old);
      word.classList.remove("night");
      word.style.opacity = "0";
      word.textContent = "";
      lastOpacity = "";
      tapHint.hidden = true;
    },

    goodNight(text, onDone) {
      api.stop();
      word.textContent = text;
      word.classList.add("night");
      requestAnimationFrame(() => requestAnimationFrame(() => { word.style.opacity = String(DISPLAY.night); }));
      setTimeout(() => { word.style.opacity = "0"; }, 6000);
      setTimeout(onDone, 9000);
    },
  };

  audio.addEventListener("play", api.frames);
  return api;
}
