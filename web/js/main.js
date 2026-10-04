import { NOISE, LONG_PRESS_MS } from "./config.js";
import { TEXT, LANGS, pickLang } from "./i18n.js";
import { storage } from "./storage.js";
import { onsets, maxWordsPerSession } from "./schedule.js";
import { freshDeck, validDeck, draw } from "./deck.js";
import { mixSession } from "./mix.js";
import { loadBundle, outRate, pcm } from "./clips.js";
import { createStage } from "./stage.js";
import { registerOffline, keepOffline } from "./offline.js";

const $ = id => document.getElementById(id);
const ui = { start: $("start"), stage: $("stage"), status: $("status"), lang: $("lang") };
const stage = createStage({ audio: $("player"), word: $("word"), tapHint: $("tapplay") });

// Phasen: start -> building -> playing -> night -> done (-> start)
let phase = "start";
let lang = null;

// ---------- gespeicherte Einstellungen ----------
const KEYS = {
  lang: "ew-lang",
  noise: "ew-noise",
  deck: l => (l === "de" ? "ew-deck" : `ew-deck-${l}`),
};
const LEGACY_NOISE = { aus: "off", leise: "soft", mittel: "medium" };

let noise = storage.get(KEYS.noise);
noise = LEGACY_NOISE[noise] || noise;
if (!(noise in NOISE.levels)) noise = NOISE.default;

function loadDeck(words) {
  const d = storage.getJSON(KEYS.deck(lang));
  return validDeck(d, words) ? d : freshDeck(words);
}

// ---------- Sitzung ----------
async function buildSession(minutes) {
  const durationS = minutes * 60;
  const marks = onsets(durationS);
  const bundle = await loadBundle(lang);
  const all = Object.keys(bundle);
  const { words, deck } = draw(loadDeck(all), all, marks.length);
  marks.forEach((m, i) => { m.w = words[i]; });
  const [rate, clips] = await Promise.all([outRate(lang), Promise.all(words.map(w => pcm(lang, w)))]);
  const wav = mixSession({ durationS, marks, clips, rate, noiseDb: NOISE.levels[noise] });
  return { url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })), marks, deck };
}

// Dekodiert schon vorab die Wörter der längsten Sitzung, damit der Tap schnell ist.
async function prewarm(forLang) {
  try {
    const bundle = await loadBundle(forLang);
    if (forLang !== lang) return;
    const all = Object.keys(bundle);
    const { words } = draw(loadDeck(all), all, maxWordsPerSession());
    for (let i = 0; i < words.length && forLang === lang; i += 4) {
      await Promise.all(words.slice(i, i + 4).map(w => pcm(forLang, w)));
    }
  } catch (e) { /* beim Start erneut versucht */ }
}

async function start(minutes) {
  if (phase !== "start") return;
  phase = "building";
  stage.unlock();  // iOS: noch im Tap
  ui.start.hidden = true;
  ui.stage.hidden = false;
  const forLang = lang;
  try {
    const s = await buildSession(minutes);
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
  document.querySelectorAll("[data-t]").forEach(el => { el.textContent = t[el.dataset.t]; });
  ui.lang.querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-checked", String(b.dataset.lang === code)));
  ui.status.textContent = "";
  prewarm(code);
  loadBundle(code).then(() => keepOffline(code), () => {});
}

function renderLangSwitch() {
  ui.lang.hidden = LANGS.length < 2;
  for (const code of LANGS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.lang = code;
    b.lang = code;
    b.textContent = TEXT[code].name;
    b.addEventListener("click", () => { if (code !== lang) setLang(code, true); });
    ui.lang.appendChild(b);
  }
}

// ---------- Bedienung ----------
function renderNoise() {
  document.querySelectorAll("[data-noise]").forEach(b =>
    b.setAttribute("aria-checked", String(b.dataset.noise === noise)));
}
document.querySelectorAll("[data-noise]").forEach(b => b.addEventListener("click", () => {
  noise = b.dataset.noise;
  storage.set(KEYS.noise, noise);
  renderNoise();
}));
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
renderLangSwitch();
renderNoise();
setLang(pickLang(storage.get(KEYS.lang), navigator.languages || [navigator.language]), false);
