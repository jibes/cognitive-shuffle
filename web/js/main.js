import { AMBIENT, LONG_PRESS_MS } from "./config.js";
import { TEXT, LANGS, pickLang } from "./i18n.js";
import { storage } from "./storage.js";
import { onsets, maxWordsPerSession } from "./schedule.js";
import { freshDeck, validDeck, draw } from "./deck.js";
import { mixSession } from "./mix.js";
import { loadBundle, outRate, pcm, loadFile, filePcmFor } from "./clips.js";
import { makeLoop } from "./ambient.js";
import { createStage } from "./stage.js";
import { registerOffline, keepOffline } from "./offline.js";
import { preview, stopPreview } from "./preview.js";

const $ = id => document.getElementById(id);
const ui = {
  start: $("start"), stage: $("stage"), status: $("status"), lang: $("lang"),
  sounds: $("sounds"), level: $("level"), levelField: $("level-field"),
};
const stage = createStage({ audio: $("player"), word: $("word"), tapHint: $("tapplay") });

// Phasen: start -> building -> playing -> night -> done (-> start)
let phase = "start";
let lang = null;
const clipSet = () => `${lang}-${voice}`;  // web/clips/<set>.json, nur die gewählte Stimme wird geladen

// ---------- gespeicherte Einstellungen ----------
const KEYS = {
  lang: "ew-lang",
  voice: "ew-voice",
  sound: "ew-sound",
  level: "ew-level",
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

function loadDeck(words) {
  const d = storage.getJSON(KEYS.deck(lang));
  return validDeck(d, words) ? d : freshDeck(words);
}

// ---------- Sitzung ----------
async function buildSession(minutes, set) {
  const durationS = minutes * 60;
  const marks = onsets(durationS);
  const bundle = await loadBundle(set);
  const all = Object.keys(bundle);
  const { words, deck } = draw(loadDeck(all), all, marks.length);
  marks.forEach((m, i) => { m.w = words[i]; });
  const bed = soundSetting();
  const [rate, clips, loop] = await Promise.all([
    outRate(set), Promise.all(words.map(w => pcm(set, w))), bed && bedLoop(set, bed.kind)]);
  const wav = mixSession({ durationS, marks, clips, rate, sound: bed && { ...bed, loop } });
  return { url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })), marks, deck };
}

// Aufnahme als Schleife in der Rate der Clips (null für prozedurale Klänge).
const loops = new Map();
async function bedLoop(set, kind) {
  const url = AMBIENT.files[kind];
  if (!url) return null;
  const rate = await outRate(set), key = url + "@" + rate;
  if (!loops.has(key)) loops.set(key, makeLoop(await filePcmFor(set, url), rate));
  return loops.get(key);
}

// Dekodiert schon vorab die Wörter der längsten Sitzung, damit der Tap schnell ist.
async function prewarm(set) {
  try {
    const bundle = await loadBundle(set);
    if (set !== clipSet()) return;
    const all = Object.keys(bundle);
    const { words } = draw(loadDeck(all), all, maxWordsPerSession());
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

async function start(minutes) {
  if (phase !== "start") return;
  phase = "building";
  stopPreview();
  stage.unlock();  // iOS: noch im Tap
  ui.start.hidden = true;
  ui.stage.hidden = false;
  const forLang = lang;
  try {
    const s = await buildSession(minutes, clipSet());
    if (phase !== "building") { URL.revokeObjectURL(s.url); return; }
    storage.setJSON(KEYS.deck(forLang), s.deck);
    phase = "playing";
    stage.play(s.url, s.marks, { title: TEXT[forLang].title, artist: TEXT[forLang].artist });
  } catch (e) {
    stage.stop();
    showStart(TEXT[lang].fail);
  }
}

function showStart(message = "") {
  phase = "start";
  ui.stage.hidden = true;
  ui.start.hidden = false;
  ui.status.textContent = message;
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

// ---------- Bedienung ----------
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
// Hintergrund: Klang und Lautstärke getrennt; Knöpfe aus AMBIENT.sounds, Texte sound_<name>
const SOUND_ICONS = {
  off: '<path d="M5 12h14" stroke-linecap="round"/>',
  brown: '<path d="M3 12h2l1.5-4 2 9 2-11 2 12 2-9 1.5 5 1-2h3" stroke-linecap="round" stroke-linejoin="round"/>',
  rain: '<path d="M7 4l-2 5M13 4l-2 5M19 4l-2 5M10 12l-2 5M16 12l-2 5M7 17l-1 3M13 17l-1 3" stroke-linecap="round"/>',
  waves: '<path d="M2 10c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 16c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" stroke-linecap="round"/>',
};
function renderSounds() {
  if (!ui.sounds.children.length) {
    for (const kind of AMBIENT.sounds) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.sound = kind;
      b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">${SOUND_ICONS[kind] || ""}</svg><span></span>`;
      b.addEventListener("click", () => {
        sound = kind;
        storage.set(KEYS.sound, sound);
        renderSounds();
        prepareSound();
        preview({ kind: sound, db: level });
      });
      ui.sounds.appendChild(b);
    }
  }
  for (const b of ui.sounds.children) {
    b.setAttribute("aria-checked", String(b.dataset.sound === sound));
    if (lang) b.querySelector("span").textContent = TEXT[lang][`sound_${b.dataset.sound}`];
  }
  ui.levelField.classList.toggle("off", sound === "off");
  ui.level.disabled = sound === "off";
  ui.level.value = String(level);
  ui.level.style.setProperty("--fill", `${(100 * (level - LEVEL_MIN)) / (LEVEL_MAX - LEVEL_MIN)}%`);
}
Object.assign(ui.level, { min: LEVEL_MIN, max: LEVEL_MAX, step: 1 });
ui.level.addEventListener("input", () => {
  level = Number(ui.level.value);
  storage.set(KEYS.level, String(level));
  renderSounds();
  preview({ kind: sound, db: level });
});
document.querySelectorAll("[data-min]").forEach(b =>
  b.addEventListener("click", () => start(Number(b.dataset.min))));

// Tippen: nächstes Wort (oder abspielen, falls blockiert). Lange drücken: beenden.
let pressTimer = 0, longPress = false;
ui.stage.addEventListener("pointerdown", () => {
  longPress = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPress = true;
    if (phase === "playing" || phase === "building") { stage.stop(); showStart(); }
  }, LONG_PRESS_MS);
});
ui.stage.addEventListener("pointerup", () => clearTimeout(pressTimer));
ui.stage.addEventListener("pointercancel", () => clearTimeout(pressTimer));
ui.stage.addEventListener("click", () => {
  if (longPress) return;
  if (phase === "playing") {
    if (stage.paused) stage.resume(); else stage.skip();
  } else if (phase === "done") {
    showStart();
  }
});
ui.stage.addEventListener("contextmenu", e => e.preventDefault());

$("player").addEventListener("ended", () => {
  if (phase !== "playing") return;
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
