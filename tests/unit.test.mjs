import { test } from "node:test";
import assert from "node:assert/strict";
import { onsets, replan } from "../web/js/schedule.js";
import { shuffle, freshDeck, validDeck, draw } from "../web/js/deck.js";
import { mixSession } from "../web/js/mix.js";
import { createWav } from "../web/js/wav.js";
import { pickLang, LANGS, TEXT, VOICES } from "../web/js/i18n.js";
import { SESSION, AMBIENT } from "../web/js/config.js";
import { SOUNDS, makeLoop } from "../web/js/ambient.js";

// deterministischer Zufall (mulberry32)
const seeded = (seed = 1) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("onsets: Abstand wächst in höchstens 20 min von 8 auf 15 s, dann gleich; endet vor Sitzungsende", () => {
  for (const min of [10, 25, 120]) {
    const d = min * 60, on = onsets(d);
    assert.equal(on[0].t, SESSION.lead);
    const gaps = on.slice(1).map((o, i) => o.t - on[i].t);
    assert.equal(gaps[0], SESSION.gap[0]);
    assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 1e-9), `${min}: monoton`);
    assert.ok(Math.max(...gaps) <= SESSION.gap[1] + 1e-9, `${min}: höchstens 15 s`);
    assert.ok(on.at(-1).t + SESSION.maxClip <= SESSION.lead + d);
    const atRamp = on.find(o => o.t >= SESSION.lead + Math.min(SESSION.ramp, d) - 1e-9);
    if (atRamp) assert.equal(atRamp.p, 1, `${min}: nach der Steigerung p = 1`);
  }
  const long = onsets(120 * 60);
  assert.ok(long.length > 450 && long.length < 520, `120 min: ${long.length} Wörter`);
});

test("replan: Wörter vor keepUntil bleiben, danach stetig weiter bis zur neuen Dauer", () => {
  const marks = onsets(10 * 60).map((m, i) => ({ ...m, w: `w${i}` }));
  const keep = 200, next = replan(marks, 15 * 60, keep);
  const kept = marks.filter(m => m.t < keep);
  assert.deepEqual(next.slice(0, kept.length), kept);
  const rest = next.slice(kept.length);
  assert.ok(rest.every(m => !m.w));
  const gaps = next.slice(1).map((o, i) => o.t - next[i].t);
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 1e-9), "Abstände wachsen stetig weiter");
  assert.ok(next.at(-1).t > marks.at(-1).t + 200, "reicht bis zur neuen Dauer");
  assert.ok(next.at(-1).t + SESSION.maxClip <= SESSION.lead + 15 * 60);
  const shorter = replan(marks, 5 * 60, keep);
  assert.ok(shorter.at(-1).t + SESSION.maxClip <= SESSION.lead + 5 * 60, "kürzer: endet rechtzeitig");
});

test("deck: keine Wiederholung bis Liste durch, kein Doppel an der Nahtstelle", () => {
  const words = ["a", "b", "c", "d", "e"], rng = seeded(3);
  let deck = freshDeck(words, rng);
  const seen = [];
  for (let k = 0; k < 7; k++) {
    const r = draw(deck, words, 3, rng);
    seen.push(...r.words);
    deck = r.deck;
  }
  for (let i = 0; i + 5 <= 20; i += 5) assert.equal(new Set(seen.slice(i, i + 5)).size, 5);
  seen.forEach((w, i) => i && assert.notEqual(w, seen[i - 1]));
});

test("deck: draw verändert den Eingabestand nicht; validDeck prüft Wortmenge", () => {
  const words = ["a", "b", "c"], deck = { order: ["c", "a", "b"], pos: 1 };
  draw(deck, words, 5, seeded());
  assert.deepEqual(deck, { order: ["c", "a", "b"], pos: 1 });
  assert.ok(validDeck(deck, words));
  assert.ok(!validDeck(deck, ["a", "b", "x"]));
  assert.ok(!validDeck({ order: ["a"], pos: 0 }, words));
  assert.ok(!validDeck(null, words));
  assert.deepEqual(shuffle(words, seeded()).sort(), words);
});

test("wav: gültiger Kopf", () => {
  const { buffer, pcm } = createWav(100, 22050);
  const v = new DataView(buffer);
  assert.equal(buffer.byteLength, 244);
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint32(40, true), 200);
  assert.equal(pcm.length, 100);
});

async function analyse(durationS, sound, rate = 16000) {
  const marks = onsets(durationS);
  const clip = new Float32Array(rate).map((_, i) => 0.708 * Math.sin(i / 3));  // −3 dBFS
  const blob = mixSession({ durationS, marks, clips: marks.map(() => clip), rate, sound, seed: 7 });
  const s = new Int16Array(await blob.arrayBuffer(), 44);
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  const rms = (a, b) => {
    let q = 0;
    for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) q += s[i] * s[i];
    return 20 * Math.log10(Math.sqrt(q / ((b - a) * rate)) / 32768);
  };
  return { s, rate, marks, peakDb: 20 * Math.log10(peak / 32768), rms };
}

test("mix: Länge, Spitze < 0 dBFS, Hintergrund im Pegel wie eingestellt (je Klang)", async () => {
  for (const kind of Object.keys(SOUNDS)) {
    for (const db of [AMBIENT.level.default, -35]) {
      const r = await analyse(300, { kind, db });
      const want = db + AMBIENT.trim[kind], end = SESSION.lead + 300 + SESSION.tail;
      assert.equal(r.s.length, Math.ceil(end * r.rate));
      assert.ok(r.peakDb < -1, `${kind} ${db}: Spitze ${r.peakDb}`);
      // zwischen erstem (2–3 s) und zweitem Wort (10 s); Wellen schwanken kurzfristig stärker
      const level = r.rms(4, 9);
      assert.ok(Math.abs(level - want) < (kind === "waves" ? 5 : 1.5), `${kind} ${db}: ${level} statt ${want}`);
      assert.ok(r.rms(end - 1, end) < want - 30, `${kind}: Ende leise`);
    }
  }
  const silent = await analyse(60, null);
  assert.equal(silent.rms(4, 9), -Infinity);
});

test("mix: Hintergrund über lange Strecke im Pegel", async () => {
  for (const kind of Object.keys(SOUNDS)) {
    const durationS = 400, rate = 8000;
    const blob = mixSession({ durationS, marks: [], clips: [], rate, sound: { kind, db: -40 }, seed: 11 });
    const s = new Int16Array(await blob.arrayBuffer(), 44);
    let q = 0;
    for (let i = 10 * rate; i < 390 * rate; i++) q += s[i] * s[i];
    const level = 20 * Math.log10(Math.sqrt(q / (380 * rate)) / 32768), want = -40 + AMBIENT.trim[kind];
    assert.ok(Math.abs(level - want) < 1, `${kind}: ${level.toFixed(2)} statt ${want}`);
  }
});

// Aufnahme-Ersatz: Rauschen mit leiser Stille an den Enden (wie MP3-Kodierer)
function fakeRecording(seconds, rate, rng = seeded(5)) {
  const x = new Float32Array(seconds * rate);
  for (let i = 1000; i < x.length - 1000; i++) x[i] = (rng() * 2 - 1) * 0.3;
  return x;
}

test("Schleife: Naht ohne Pegelsprung, Pegel wie eingestellt, Start zufällig", async () => {
  const rate = 8000, loop = makeLoop(fakeRecording(30, rate), rate);
  const d = loop.data, win = rate / 4;
  const rms = (a, n) => { let q = 0; for (let i = 0; i < n; i++) { const v = d[(a + i) % d.length]; q += v * v; } return Math.sqrt(q / n); };
  const ref = rms(5 * rate, 5 * rate);
  for (let a = d.length - 2 * rate; a < d.length + 2 * rate; a += win / 2) {
    const r = 20 * Math.log10(rms(a, win) / ref);
    assert.ok(Math.abs(r) < 1.5, `Naht: ${r.toFixed(1)} dB bei ${a}`);
  }
  const mix = async seed => new Int16Array(await mixSession({ durationS: 120, marks: [], clips: [], rate,
    sound: { kind: "rain", db: -40, loop }, seed }).arrayBuffer(), 44);
  const s = await mix(2);
  let q = 0;
  for (let i = 10 * rate; i < 110 * rate; i++) q += s[i] * s[i];
  const level = 20 * Math.log10(Math.sqrt(q / (100 * rate)) / 32768), want = -40 + AMBIENT.trim.rain;
  assert.ok(Math.abs(level - want) < 0.5, `Pegel ${level.toFixed(2)} statt ${want}`);
  assert.notDeepEqual(s.subarray(5 * rate, 5 * rate + 100), (await mix(3)).subarray(5 * rate, 5 * rate + 100), "Start zufällig");
});

test("ambient: jeder Klang hat Generator oder Aufnahme, Ausgleich und Text; Aufnahmen ≥ 48 kbit/s", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const kind of AMBIENT.sounds) {
    if (kind !== "off") {
      assert.ok(kind in SOUNDS !== kind in AMBIENT.files, `${kind}: genau eins von Generator oder Aufnahme`);
      assert.equal(typeof AMBIENT.trim[kind], "number", `${kind}: trim fehlt`);
    }
    for (const l of LANGS) assert.ok(TEXT[l][`sound_${kind}`], `${l}: sound_${kind} fehlt`);
  }
  assert.ok(AMBIENT.sounds.includes(AMBIENT.default));
  const KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];  // MPEG-2 Layer III
  for (const [kind, url] of Object.entries(AMBIENT.files)) {
    const b = await readFile(new URL(`../web/${url}`, import.meta.url));
    let i = b.subarray(0, 3).toString("latin1") === "ID3" ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) : 0;
    while (!(b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0)) i++;
    const mpeg1 = (b[i + 1] & 0x18) === 0x18, idx = b[i + 2] >> 4;
    const kbps = mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][idx] : KBPS[idx];
    assert.ok(kbps >= 48, `${kind}: ${kbps} kbit/s`);
    assert.ok(b.length > 200e3, `${kind}: ${b.length} Bytes`);
  }
});

test("mix: ab Minute x neu gemischt = sample-genau gleich (nahtloses Umschalten)", async () => {
  const rate = 8000, durationS = 300, marks = onsets(durationS);
  const clips = marks.map(() => new Float32Array(rate).map((_, i) => 0.5 * Math.sin(i / 3)));
  const rateLoop = makeLoop(fakeRecording(20, rate), rate);
  for (const sound of [{ kind: "brown", db: -40 }, { kind: "rain", db: -40, loop: rateLoop }]) {
    const full = new Int16Array(await mixSession({ durationS, marks, clips, rate, sound, seed: 4 }).arrayBuffer(), 44);
    const fromS = 101.25, part = mixSession({ durationS, marks: marks.filter(m => m.t + 3 > fromS),
      clips: clips.slice(marks.findIndex(m => m.t + 3 > fromS)), rate, sound, seed: 4, fromS });
    const tail = new Int16Array(await part.arrayBuffer(), 44), o = fromS * rate;
    assert.equal(tail.length, full.length - o);
    let diff = 0;
    for (let i = 0; i < tail.length; i++) diff = Math.max(diff, Math.abs(full[o + i] - tail[i]));
    assert.equal(diff, 0, `${sound.kind}: Abweichung ${diff}`);
  }
});

test("mix: Stimme wird leiser", async () => {
  const r = await analyse(600, null);
  const level = m => r.rms(m.t, m.t + 1);
  assert.ok(level(r.marks[0]) - level(r.marks.at(-1)) > 6);
});

test("i18n: gespeicherte Wahl > Browser > Englisch; alle Texte vollständig", () => {
  assert.equal(pickLang("de", ["en-US"]), "de");
  assert.equal(pickLang(null, ["fr-FR", "de-AT", "en"]), "de");
  assert.equal(pickLang("xx", ["en-GB"]), "en");
  assert.equal(pickLang(null, ["fr"]), "en");
  assert.equal(pickLang(null, []), "en");
  const keys = Object.keys(TEXT.de).sort();
  for (const l of LANGS) assert.deepEqual(Object.keys(TEXT[l]).sort(), keys, l);
});

test("sw.js: App-Hülle vollständig und vorhanden", async () => {
  const { readFile, readdir, access } = await import("node:fs/promises");
  const web = new URL("../web/", import.meta.url);
  const src = await readFile(new URL("sw.js", web), "utf8");
  const shell = JSON.parse(src.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  for (const f of shell.filter(f => f !== "./")) await access(new URL(f, web));
  const js = (await readdir(new URL("js/", web))).map(f => `js/${f}`);
  for (const f of [...js, "css/app.css"]) assert.ok(shell.includes(f), `${f} fehlt in SHELL`);
  const offline = await readFile(new URL("js/offline.js", web), "utf8");
  assert.equal(offline.match(/CACHE = "([^"]+)"/)[1], src.match(/CACHE = "([^"]+)"/)[1], "Cache-Name gleich");
});

test("Clips: jede Stimme je Sprache hat eine Datei, alle mit denselben Wörtern", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = async set => JSON.parse(await readFile(new URL(`../web/clips/${set}.json`, import.meta.url), "utf8"));
  for (const l of LANGS) {
    assert.ok(VOICES[l] && VOICES[l].length >= 1, `${l}: Stimmen fehlen`);
    const [first, ...rest] = VOICES[l].map(([k]) => k);
    const words = Object.keys(await load(`${l}-${first}`)).sort();
    assert.ok(words.length >= 100, `${l}: ${words.length} Wörter`);
    for (const k of rest) assert.deepEqual(Object.keys(await load(`${l}-${k}`)).sort(), words, `${l}-${k}: gleiche Wörter`);
  }
});

test("Manifeste: je Sprache vorhanden, gleich aufgebaut, Icons existieren", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const web = new URL("../web/", import.meta.url);
  const load = async l => JSON.parse(await readFile(new URL(`manifest.${l}.webmanifest`, web), "utf8"));
  const base = await load(LANGS[0]);
  for (const l of LANGS) {
    const m = await load(l);
    assert.equal(m.lang, l);
    assert.equal(m.short_name, TEXT[l].appName);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(base).sort());
    assert.equal(m.display, "fullscreen");  // ohne Status- und Navigationsleiste (Android); sonst standalone
    assert.deepEqual(m.display_override, ["fullscreen", "standalone"]);
    for (const i of m.icons) await access(new URL(i.src, web));
    for (const size of ["192x192", "512x512"]) assert.ok(m.icons.some(i => i.sizes === size), size);
    assert.ok(m.icons.some(i => i.purpose === "maskable"));
  }
});

test("Info-Dialog: ein Abschnitt je Sprache mit Quellen", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  for (const l of LANGS) {
    const m = html.match(new RegExp(`<article lang="${l}" data-lang-block="${l}">([\\s\\S]*?)</article>`));
    assert.ok(m, `Info-Abschnitt ${l} fehlt`);
    assert.equal((m[1].match(/<h3>/g) || []).length, 5, `${l}: fünf Unterabschnitte`);
    assert.equal((m[1].match(/href="https:\/\//g) || []).length, 3 + 3 * Object.keys(AMBIENT.files).length + 1,
      `${l}: drei Quellen, je Aufnahme Original, Urheber und Lizenz, Blanket`);
  }
});
