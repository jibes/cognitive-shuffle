import { DISPLAY, SESSION, lerp } from "./config.js";
import { createWav } from "./wav.js";

// Wiedergabe-Element und Wortanzeige. Die Anzeige folgt audio.currentTime;
// bei gesperrtem Bildschirm läuft nur das <audio>-Element weiter.
// Eine Sitzung kann aus mehreren Stücken bestehen (Neumischen ab der aktuellen Stelle):
// offset = Sitzungszeit, bei der das laufende Stück beginnt.

// 0,1 s Stille – zum Freischalten unter iOS noch im Tap
const SILENT_WAV = URL.createObjectURL(new Blob([createWav(800, 8000).buffer], { type: "audio/wav" }));

// onInterrupt: Wiedergabe angehalten, ohne dass die App es wollte (Anruf, andere App übernimmt
// den Ton, Pause am Sperrbildschirm). onResume: läuft wieder.
export function createStage({ audio, word, tapHint, onInterrupt = () => {}, onResume = () => {} }) {
  let marks = null, offset = 0, idx = -1, rafId = 0, lastOpacity = "", hidden = false;
  let pendingSwap = null;
  let switching = false;  // Quelle wird gewechselt: Pausen dabei sind gewollt

  const now = () => offset + audio.currentTime;

  // Kein Wort hörbar: zwischen Ende des letzten (höchstens maxClip) und kurz vor dem nächsten
  function quiet(t) {
    return !marks.some(m => t > m.t - 0.4 && t < m.t + SESSION.maxClip);
  }

  function frame() {
    rafId = 0;
    if (!marks) return;
    const ct = now();
    if (pendingSwap && quiet(ct)) swapNow(ct);
    while (idx + 1 < marks.length && marks[idx + 1].t <= ct) idx++;
    while (idx >= 0 && marks[idx].t > ct) idx--;
    let op = 0;
    if (idx >= 0 && !hidden) {
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

  function release(url) {
    if (url && url.startsWith("blob:") && url !== SILENT_WAV) URL.revokeObjectURL(url);
  }

  function swapNow(ct) {
    const s = pendingSwap;
    pendingSwap = null;
    const old = audio.src, at = Math.max(0, ct - s.offset);
    marks = s.marks;
    offset = s.offset;
    idx = -1;
    switching = true;
    audio.src = s.url;
    const fail = () => { audio.removeEventListener("loadedmetadata", seek); switching = false; s.done(); };  // nie hängen bleiben
    const seek = () => {
      audio.removeEventListener("loadedmetadata", seek);
      audio.removeEventListener("error", fail);
      audio.currentTime = at;
      if (!s.play) { switching = false; api.frames(); s.done(); return; }
      const p = audio.play();
      api.frames();
      Promise.resolve(p).then(() => { tapHint.hidden = true; }, () => { tapHint.hidden = false; })
        .then(() => { switching = false; s.done(); });
    };
    audio.addEventListener("loadedmetadata", seek);
    audio.addEventListener("error", fail, { once: true });
    audio.load();
    release(old);
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
      offset = 0;
      idx = -1;
      switching = true;
      audio.src = url;
      if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata(meta);
      }
      api.resume();
    },

    // Neues Stück ab Sitzungszeit `from`; umgeschaltet wird, sobald gerade kein Wort klingt.
    // Ist die Wiedergabe angehalten (Unterbrechung), sofort umschalten und angehalten bleiben.
    swap(url, sessionMarks, from) {
      return new Promise(done => {
        if (pendingSwap) { release(pendingSwap.url); pendingSwap.done(); }
        pendingSwap = { url, marks: sessionMarks, offset: from, done, play: !audio.paused };
        if (marks && (!pendingSwap.play || quiet(now()))) swapNow(now());
        api.frames();
      });
    },

    resume() {
      const p = audio.play();
      Promise.resolve(p).then(() => { tapHint.hidden = true; }, () => { tapHint.hidden = false; })
        .then(() => { switching = false; });
      api.frames();
    },

    frames() { if (!rafId && marks) rafId = requestAnimationFrame(frame); },

    get paused() { return audio.paused; },
    get time() { return marks ? now() : 0; },

    // Wortanzeige aus (Bedienfeld offen); der Ton läuft weiter.
    set hideWord(v) { hidden = v; },

    stop() {
      marks = null;
      if (pendingSwap) { release(pendingSwap.url); pendingSwap.done(); pendingSwap = null; }
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      const old = audio.src;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      release(old);
      word.classList.remove("night");
      word.style.opacity = "0";
      word.textContent = "";
      lastOpacity = "";
      hidden = false;
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
  // Beim Ende feuert „pause“ kurz vor „ended“ – das ist keine Unterbrechung.
  audio.addEventListener("pause", () => { if (marks && !switching && !audio.ended) onInterrupt(); });
  audio.addEventListener("playing", () => { if (marks) onResume(); });
  return api;
}
