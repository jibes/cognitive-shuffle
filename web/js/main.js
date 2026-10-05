import { AMBIENT, SESSION, CONTROLS } from "./config.js";
import { TEXT, LANGS, pickLang } from "./i18n.js";
import { storage } from "./storage.js";
import { onsets, replan } from "./schedule.js";
import { freshDeck, validDeck, draw } from "./deck.js";
import { mixSessionAsync } from "./mix.js";
import { loadBundle, outRate, pcm, loadFile, filePcmFor } from "./clips.js";
import { makeLoop } from "./ambient.js";
import { createStage } from "./stage.js";
import { createWheel } from "./wheel.js";
import { registerOffline, keepOffline } from "./offline.js";
import { preview, stopPreview } from "./preview.js";

const $ = id => document.getElementById(id);
const ui = {
  start: $("start"), stage: $("stage"), status: $("status"), lang: $("lang"),
  hold: $("hold"), holdRing: $("hold-ring"), holdHint: $("hold-hint"), panel: $("panel"),
  left: $("left-n"), panelStatus: $("panel-status"), panelNote: $("panel-note"), building: $("building"),
};
const stage = createStage({
  audio: $("player"), word: $("word"), tapHint: $("tapplay"),
  onInterrupt: () => interrupt(), onResume: () => uninterrupt(),
});

// Phasen: start -> building -> playing -> night -> done (-> start)
// Während „playing“ ist das Bedienfeld gesperrt, bis man gedrückt hält.
let phase = "start";
let lang = null;
const clipSet = () => `${lang}-${voice}`;  // web/clips/<set>.json, nur die gewählte Stimme wird geladen

// ---------- gespeicherte Einstellungen ----------
const KEYS = {
  lang: "ew-lang",
  voice: "ew-voice",
  sound: "ew-sound",
  level: "ew-level",
  minutes: "ew-minutes",
  legacyNoise: "ew-noise",
  deck: l => (l === "de" ? "ew-deck" : `ew-deck-${l}`),
};
// Früher ein Regler für beides: aus/leise/mittel (braunes Rauschen bei -43/-35 dBFS)
const LEGACY_NOISE = {
  off: ["off", null], aus: ["off", null], soft: ["brown", -43], leise: ["brown", -43],
  medium: ["brown", -35], mittel: ["brown", -35],
};

const { min: LEVEL_MIN, max: LEVEL_MAX } = AMBIENT.level;
let sound = storage.get(KEYS.sound);
let level = Number(storage.get(KEYS.level));
const legacy = LEGACY_NOISE[storage.get(KEYS.legacyNoise)];
if (!sound && legacy) [sound, level] = [legacy[0], legacy[1] ?? AMBIENT.level.default];
if (!AMBIENT.sounds.includes(sound)) sound = AMBIENT.default;
if (!(level >= LEVEL_MIN && level <= LEVEL_MAX)) level = AMBIENT.level.default;
const VOICES = ["f", "m"];
let voice = storage.get(KEYS.voice);
if (!VOICES.includes(voice)) voice = VOICES[0];
const soundSetting = () => (sound === "off" ? null : { kind: sound, db: level });
const M = SESSION.minutes;
let minutes = Number(storage.get(KEYS.minutes));
if (!(minutes >= M.min && minutes <= M.max && minutes % M.step === 0)) minutes = M.default;

function loadDeck(words) {
  const d = storage.getJSON(KEYS.deck(lang));
  return validDeck(d, words) ? d : freshDeck(words);
}

// ---------- Sitzung ----------
// Eine Sitzung: Plan (Wortanfänge mit Wort), Dauer, Hintergrund und ein fester Zufallswert für
// den Hintergrund. Änderungen mischen den Rest ab der aktuellen Stelle neu (stage.swap).
let session = null;  // { set, lang, durationS, marks, deck, seed, sound }

// Aufnahme als Schleife in der Rate der Clips (null für prozedurale Klänge).
const loops = new Map();
async function bedLoop(set, kind) {
  const url = AMBIENT.files[kind];
  if (!url) return null;
  const rate = await outRate(set), key = url + "@" + rate;
  if (!loops.has(key)) loops.set(key, makeLoop(await filePcmFor(set, url), rate));
  return loops.get(key);
}

// Fehlende Wörter für neue Wortanfänge ziehen (Stapel bleibt über Nächte erhalten).
async function fillWords(s) {
  const need = s.marks.filter(m => !m.w);
  if (!need.length) return;
  const all = Object.keys(await loadBundle(s.set));
  const { words, deck } = draw(s.deck, all, need.length);
  need.forEach((m, i) => { m.w = words[i]; });
  s.deck = deck;
  storage.setJSON(KEYS.deck(s.lang), deck);
}

// WAV-URL der Sitzung ab Sitzungszeit fromS; progress(0..1) über Dekodieren und Mischen
async function mix(s, fromS, progress = () => {}) {
  const [rate, loop] = await Promise.all([outRate(s.set), s.sound && bedLoop(s.set, s.sound.kind)]);
  const marks = s.marks.filter(m => m.t + SESSION.maxClip > fromS);
  let decoded = 0;
  const clips = await Promise.all(marks.map(m => pcm(s.set, m.w).then(x => {
    progress(0.5 * ++decoded / marks.length);
    return x;
  })));
  const blob = await mixSessionAsync({ durationS: s.durationS, marks, clips, rate, seed: s.seed, fromS,
    sound: s.sound && { ...s.sound, loop } }, f => progress(0.5 + 0.5 * f));
  return URL.createObjectURL(blob.slice(0, blob.size, "audio/wav"));
}

async function start() {
  if (phase !== "start") return;
  phase = "building";
  stopPreview();
  stage.unlock();  // iOS: noch im Tap
  enterFullscreen();  // ebenfalls nur im Tap erlaubt
  ui.start.hidden = true;
  ui.stage.hidden = false;
  showHoldHint();
  // Hinweis mit Fortschritt; sichtbar erst nach 0,4 s (CSS), kurze Vorbereitung bleibt ruhig
  ui.building.textContent = TEXT[lang].preparing;
  ui.building.hidden = false;
  const set = clipSet();
  try {
    const all = Object.keys(await loadBundle(set));
    const s = { set, lang, durationS: minutes * 60, marks: onsets(minutes * 60),
      deck: loadDeck(all), seed: (Math.random() * 2 ** 31) | 0, sound: soundSetting() };
    await fillWords(s);
    const url = await mix(s, 0, f => {
      ui.building.textContent = `${TEXT[s.lang].preparing} ${Math.round(100 * f)} %`;
    });
    ui.building.hidden = true;
    if (phase !== "building") { URL.revokeObjectURL(url); return; }
    session = s;
    phase = "playing";
    stage.play(url, s.marks, { title: TEXT[s.lang].title, artist: TEXT[s.lang].artist });
  } catch (e) {
    ui.building.hidden = true;
    stage.stop();
    showStart(TEXT[lang].fail);
  }
}

// Änderungen während der Sitzung sammeln und den Rest neu mischen (nie zwei Mischungen zugleich).
let remixing = null, remixAgain = false;
async function remix() {
  if (remixing) { remixAgain = true; return remixing; }
  const s = session;
  ui.panelStatus.textContent = TEXT[lang].adjusting;
  remixing = (async () => {
    try {
      const from = Math.max(0, Math.floor(stage.time));
      await fillWords(s);
      const url = await mix(s, from);
      if (session !== s || phase !== "playing") { URL.revokeObjectURL(url); return; }
      await stage.swap(url, s.marks, from);
    } catch (e) { /* alte Mischung läuft weiter */ }
  })();
  await remixing;
  remixing = null;
  if (remixAgain && session === s) { remixAgain = false; return remix(); }
  ui.panelStatus.textContent = "";
}

function changeDuration(deltaMin) {
  const s = session;
  if (!s) return;
  const now = stage.time - SESSION.lead;
  const minS = Math.min(s.durationS, Math.ceil((now + CONTROLS.minLeftS) / 60) * 60);
  const next = Math.min(M.max * 60, Math.max(minS, s.durationS + deltaMin * 60));
  if (next === s.durationS) return;
  // Schon gezogene, noch nicht gesprochene Wörter wandern auf die neuen Wortanfänge
  const keep = stage.time + CONTROLS.keepS;
  const spare = s.marks.filter(m => m.t >= keep).map(m => m.w);
  s.durationS = next;
  s.marks = replan(s.marks, next, keep);
  s.marks.filter(m => !m.w).forEach((m, i) => { if (i < spare.length) m.w = spare[i]; });
  renderLeft();
  remix();
}

let soundTimer = 0;
function changeSound(immediate) {
  if (!session) return;
  session.sound = soundSetting();
  clearTimeout(soundTimer);
  if (immediate) remix(); else soundTimer = setTimeout(remix, CONTROLS.remixDelayMs);
}

function renderLeft() {
  if (!session) return;
  const left = Math.min(session.durationS, SESSION.lead + session.durationS - stage.time);  // Vorlauf zählt nicht
  ui.left.textContent = String(Math.max(0, Math.ceil(left / 60)));
}

// Dekodiert vorab die Wörter der ersten Minuten, damit der Start schnell ist.
async function prewarm(set) {
  try {
    const bundle = await loadBundle(set);
    if (set !== clipSet()) return;
    const all = Object.keys(bundle);
    const { words } = draw(loadDeck(all), all, onsets(10 * 60).length);
    for (let i = 0; i < words.length && set === clipSet(); i += 4) {
      await Promise.all(words.slice(i, i + 4).map(w => pcm(set, w)));
    }
  } catch (e) { /* beim Start erneut versucht */ }
}

// Lädt die Clips der aktuellen Sprache und Stimme vor und legt sie offline ab.
function prepare() {
  const set = clipSet();
  prewarm(set);
  loadBundle(set).then(() => keepOffline(`clips/${set}.json`, () => set === clipSet()), () => {});
  prepareSound();
}

// Lädt die Aufnahme des gewählten Hintergrunds vor und legt sie offline ab.
function prepareSound() {
  const url = AMBIENT.files[sound];
  if (url) loadFile(url).then(() => keepOffline(url, () => AMBIENT.files[sound] === url), () => {});
}

function endSession() {
  uninterrupt();
  lockPanel();
  session = null;
  stage.stop();
  showStart();
}

// Vollbild während der Sitzung: blendet Status- und Navigationsleiste aus (Android, Desktop).
// iPhone erlaubt das Webseiten nicht. Installiert läuft die App ohnehin im Vollbild (Manifest).
let ownFullscreen = false;
function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: "hide" });
    ownFullscreen = true;
    if (p && p.catch) p.catch(() => { ownFullscreen = false; });
  } catch (e) { /* nicht erlaubt */ }
}
function exitFullscreen() {
  if (!ownFullscreen) return;
  ownFullscreen = false;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
    try { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* egal */ }
  }
}

function showStart(message = "") {
  exitFullscreen();
  phase = "start";
  ui.stage.hidden = true;
  ui.start.hidden = false;
  ui.status.textContent = message;
  wheel.recenter();
}

// ---------- Sprache ----------
function setLang(code, remember) {
  lang = code;
  if (remember) storage.set(KEYS.lang, code);
  const t = TEXT[code];
  document.documentElement.lang = code;
  document.title = t.title;
  // Installieren übernimmt Name und Sprache aus dem gerade verlinkten Manifest
  $("manifest").setAttribute("href", `manifest.${code}.webmanifest`);
  $("app-title").setAttribute("content", t.appName);
  document.querySelectorAll("[data-t]").forEach(el => { el.textContent = t[el.dataset.t]; });
  document.querySelectorAll("[data-t-label]").forEach(el => { el.setAttribute("aria-label", t[el.dataset.tLabel]); });
  document.querySelectorAll("[data-lang-block]").forEach(el => { el.hidden = el.dataset.langBlock !== code; });
  ui.lang.value = code;
  renderSounds();
  wheel.setUnit(t.minutes);
  ui.status.textContent = "";
  prepare();
}

function renderLangSwitch() {
  ui.lang.closest(".lang").hidden = LANGS.length < 2;
  for (const code of LANGS) {
    const o = document.createElement("option");
    o.value = code;
    o.lang = code;
    o.textContent = TEXT[code].name;
    ui.lang.appendChild(o);
  }
  ui.lang.addEventListener("change", () => { if (ui.lang.value !== lang) setLang(ui.lang.value, true); });
}

// ---------- Bedienung Startseite ----------
function renderVoice() {
  document.querySelectorAll("[data-voice]").forEach(b =>
    b.setAttribute("aria-checked", String(b.dataset.voice === voice)));
}
document.querySelectorAll("[data-voice]").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.voice === voice) return;
  voice = b.dataset.voice;
  storage.set(KEYS.voice, voice);
  renderVoice();
  prepare();
}));

// Hintergrund: Klang und Lautstärke getrennt; Knöpfe aus AMBIENT.sounds, Texte sound_<name>.
// Zwei Sätze Bedienelemente (Startseite, Bedienfeld) mit demselben Zustand.
const SOUND_ICONS = {
  off: '<path d="M5 12h14" stroke-linecap="round"/>',
  brown: '<path d="M3 12h2l1.5-4 2 9 2-11 2 12 2-9 1.5 5 1-2h3" stroke-linecap="round" stroke-linejoin="round"/>',
  rain: '<path d="M7 4l-2 5M13 4l-2 5M19 4l-2 5M10 12l-2 5M16 12l-2 5M7 17l-1 3M13 17l-1 3" stroke-linecap="round"/>',
  waves: '<path d="M2 10c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 16c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" stroke-linecap="round"/>',
};
const live = el => !!el.closest("#panel");  // im Bedienfeld: neu mischen statt Hörprobe
function renderSounds() {
  for (const box of document.querySelectorAll(".sounds")) {
    if (!box.children.length) {
      for (const kind of AMBIENT.sounds) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset.sound = kind;
        b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">${SOUND_ICONS[kind] || ""}</svg><span></span>`;
        b.addEventListener("click", () => {
          if (kind === sound) return;
          sound = kind;
          storage.set(KEYS.sound, sound);
          renderSounds();
          prepareSound();
          if (live(b)) changeSound(true); else preview({ kind: sound, db: level });
        });
        box.appendChild(b);
      }
    }
    for (const b of box.children) {
      b.setAttribute("aria-checked", String(b.dataset.sound === sound));
      if (lang) b.querySelector("span").textContent = TEXT[lang][`sound_${b.dataset.sound}`];
    }
  }
  for (const input of document.querySelectorAll("input.level")) {
    input.closest(".level-field").classList.toggle("off", sound === "off");
    input.disabled = sound === "off";
    input.value = String(level);
    input.style.setProperty("--fill", `${(100 * (level - LEVEL_MIN)) / (LEVEL_MAX - LEVEL_MIN)}%`);
  }
}
for (const input of document.querySelectorAll("input.level")) {
  Object.assign(input, { min: LEVEL_MIN, max: LEVEL_MAX, step: 1 });
  input.addEventListener("input", () => {
    level = Number(input.value);
    storage.set(KEYS.level, String(level));
    renderSounds();
    if (live(input)) changeSound(false); else preview({ kind: sound, db: level });
  });
}

const wheel = createWheel($("wheel"), {
  min: M.min, max: M.max, step: M.step, value: minutes,
  onChange: v => { minutes = v; storage.set(KEYS.minutes, String(v)); if (lang) wheel.setUnit(TEXT[lang].minutes); },
});
$("go").addEventListener("click", start);

// ---------- Bedienung während der Sitzung ----------
// Kurzes Tippen bewirkt nichts (außer Abspielen, falls der Browser es blockiert hat).
// Gedrückt halten: Ring füllt sich, dann öffnet das Bedienfeld; es sperrt sich nach Ruhe wieder.
let holdStart = 0, holdRaf = 0, holdProgress = 0, relockTimer = 0;

function setRing(p) {
  holdProgress = p;
  ui.holdRing.style.strokeDashoffset = String(100 - 100 * p);
}
function holdFrame() {
  holdRaf = 0;
  if (holdStart) {
    const p = Math.min(1, (performance.now() - holdStart) / CONTROLS.holdMs);
    setRing(p);
    if (p >= 1) { holdStart = 0; ui.hold.hidden = true; openPanel(); return; }
  } else {
    setRing(Math.max(0, holdProgress - 0.06));  // loslassen: Ring läuft zurück
    if (holdProgress <= 0) { ui.hold.hidden = true; if (ui.panel.hidden) stage.hideWord = false; return; }
  }
  holdRaf = requestAnimationFrame(holdFrame);
}
function holdDown() {
  if (phase !== "playing" || !ui.panel.hidden) return;
  holdStart = performance.now();
  ui.hold.hidden = false;
  stage.hideWord = true;
  if (!holdRaf) holdRaf = requestAnimationFrame(holdFrame);
}
function holdUp() {
  if (!holdStart) return;
  holdStart = 0;
  if (stage.paused && phase === "playing") stage.resume();  // Wiedergabe war blockiert
}

// Unterbrochen (Anruf, andere App, Pause am Sperrbildschirm): Bedienfeld offen und
// ohne Zeitsperre, Hinweis oben; „Weiter“ setzt fort (im Tap – iOS verlangt das).
let interrupted = false;
function interrupt() {
  if (phase !== "playing" || interrupted) return;
  interrupted = true;
  holdStart = 0;
  ui.hold.hidden = true;
  if (ui.panel.hidden) openPanel();
  clearTimeout(relockTimer);
  ui.panelNote.textContent = TEXT[lang].interrupted;
  ui.panelNote.hidden = false;
}
function uninterrupt() {
  if (!interrupted) return;
  interrupted = false;
  ui.panelNote.hidden = true;
  if (!ui.panel.hidden) touchPanel();
}

let leftTimer = 0;
function openPanel(focus = false) {
  if (navigator.vibrate) navigator.vibrate(15);
  stage.hideWord = true;
  ui.panel.hidden = false;
  ui.stage.classList.add("unlocked");
  ui.holdHint.hidden = true;
  renderLeft();
  leftTimer = setInterval(renderLeft, 5000);
  touchPanel();
  if (focus) $("resume").focus();
}
function lockPanel() {
  const hadFocus = ui.panel.contains(document.activeElement);
  if (hadFocus) ui.stage.focus();
  clearTimeout(relockTimer);
  clearInterval(leftTimer);
  ui.panel.hidden = true;
  ui.stage.classList.remove("unlocked");
  stage.hideWord = false;
}
function touchPanel() {
  clearTimeout(relockTimer);
  if (!interrupted) relockTimer = setTimeout(lockPanel, CONTROLS.relockMs);
}

function showHoldHint() {
  ui.holdHint.hidden = false;
  ui.holdHint.classList.remove("fade");
  setTimeout(() => ui.holdHint.classList.add("fade"), 5000);
}

ui.stage.addEventListener("pointerdown", e => {
  if (ui.panel.contains(e.target)) { touchPanel(); return; }
  holdDown();
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) ui.stage.addEventListener(ev, holdUp);
ui.panel.addEventListener("input", touchPanel);
ui.panel.addEventListener("keydown", e => { touchPanel(); if (e.key === "Escape") lockPanel(); });
ui.stage.addEventListener("click", e => {
  if (phase === "done" && !ui.panel.contains(e.target)) showStart();
});
ui.stage.addEventListener("contextmenu", e => e.preventDefault());
// Tastatur: Leertaste oder Enter öffnet das Bedienfeld (Esc schließt es)
document.addEventListener("keydown", e => {
  if (phase !== "playing" || !ui.panel.hidden || e.repeat) return;
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); openPanel(true); }
});
document.querySelectorAll("[data-adj]").forEach(b =>
  b.addEventListener("click", () => changeDuration(Number(b.dataset.adj))));
$("resume").addEventListener("click", () => {
  if (interrupted || stage.paused) stage.resume();
  lockPanel();
});
$("end").addEventListener("click", endSession);

$("player").addEventListener("ended", () => {
  if (phase !== "playing") return;
  uninterrupt();
  lockPanel();
  session = null;
  phase = "night";
  stage.goodNight(TEXT[lang].night, () => { if (phase === "night") phase = "done"; });
});

registerOffline();
// ---------- Info ----------
const info = $("info");
function openInfo() {
  if (info.showModal) info.showModal(); else info.setAttribute("open", "");
  info.querySelector(".sheet").scrollTop = 0;
}
function closeInfo() {
  if (info.close) info.close(); else info.removeAttribute("open");
}
$("info-open").addEventListener("click", openInfo);
$("info-close").addEventListener("click", closeInfo);
$("info-done").addEventListener("click", closeInfo);
info.addEventListener("click", e => { if (e.target === info) closeInfo(); });  // Tipp neben das Blatt

renderLangSwitch();
renderVoice();
renderSounds();
setLang(pickLang(storage.get(KEYS.lang), navigator.languages || [navigator.language]), false);
