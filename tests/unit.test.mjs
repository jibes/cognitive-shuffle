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
