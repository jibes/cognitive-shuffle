import { test } from "node:test";
import assert from "node:assert/strict";
import { onsets, maxWordsPerSession } from "../web/js/schedule.js";
import { shuffle, freshDeck, validDeck, draw } from "../web/js/deck.js";
import { mixSession } from "../web/js/mix.js";
import { createWav } from "../web/js/wav.js";
import { pickLang, LANGS, TEXT } from "../web/js/i18n.js";
import { SESSION } from "../web/js/config.js";

// deterministischer Zufall (mulberry32)
const seeded = (seed = 1) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("onsets: Abstand wächst von 8 auf ~20 s und endet vor Sitzungsende", () => {
  const d = 25 * 60, on = onsets(d);
  assert.equal(on[0].t, SESSION.lead);
  const gaps = on.slice(1).map((o, i) => o.t - on[i].t);
  assert.equal(gaps[0], SESSION.gap[0]);
  assert.ok(gaps.at(-1) > 19 && gaps.at(-1) <= SESSION.gap[1]);
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]));
  assert.ok(on.at(-1).t + SESSION.maxClip <= SESSION.lead + d);
  assert.equal(maxWordsPerSession(), on.length);
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

function analyse(durationS, noiseDb, rate = 16000) {
  const marks = onsets(durationS);
  const clip = new Float32Array(rate).map((_, i) => 0.708 * Math.sin(i / 3));  // −3 dBFS
  const buf = mixSession({ durationS, marks, clips: marks.map(() => clip), rate, noiseDb, rng: seeded(7) });
  const s = new Int16Array(buf, 44);
  let peak = 0;
  for (const x of s) peak = Math.max(peak, Math.abs(x));
  const rms = (a, b) => {
    let q = 0;
    for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) q += s[i] * s[i];
    return 20 * Math.log10(Math.sqrt(q / ((b - a) * rate)) / 32768);
  };
  return { s, rate, marks, peakDb: 20 * Math.log10(peak / 32768), rms };
}

test("mix: Länge, Spitze < 0 dBFS, Rauschpegel wie eingestellt", () => {
  for (const [db, tol] of [[-43, 1], [-35, 1]]) {
    const r = analyse(120, db);
    assert.equal(r.s.length, Math.ceil((SESSION.lead + 120 + SESSION.tail) * r.rate));
    assert.ok(r.peakDb < -1, `Spitze ${r.peakDb}`);
    assert.ok(Math.abs(r.rms(4, 9) - db) < tol, `Rauschen ${r.rms(4, 9)} statt ${db}`);
    assert.ok(r.rms(SESSION.lead + 120 + SESSION.tail - 1, SESSION.lead + 120 + SESSION.tail) < db - 30, "Ende leise");
  }
  const silent = analyse(60, null);
  assert.equal(silent.rms(4, 9), -Infinity);
});

test("mix: Stimme wird leiser", () => {
  const r = analyse(600, null);
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

test("Clips: je Sprache weiblich und männlich, gleiche Wörter", async () => {
  const { readFile } = await import("node:fs/promises");
  const load = async set => JSON.parse(await readFile(new URL(`../web/clips/${set}.json`, import.meta.url), "utf8"));
  for (const l of LANGS) {
    const [f, m] = [Object.keys(await load(`${l}-f`)).sort(), Object.keys(await load(`${l}-m`)).sort()];
    assert.ok(f.length >= 100, `${l}: ${f.length} Wörter`);
    assert.deepEqual(m, f, `${l}: gleiche Wörter für beide Stimmen`);
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
    assert.equal(m.display, "standalone");
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
    assert.equal((m[1].match(/<h3>/g) || []).length, 4, `${l}: vier Unterabschnitte`);
    assert.equal((m[1].match(/href="https:\/\//g) || []).length, 3, `${l}: drei Quellen`);
  }
});
