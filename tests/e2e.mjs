// Ende-zu-Ende im Browser: node tests/e2e.mjs [Basis-URL]
// Ohne URL wird web/ lokal ausgeliefert.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

async function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
      res.writeHead(200, { "content-type": TYPES[extname(path) || ".html"] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(r => server.listen(0, r));
  return { url: `http://localhost:${server.address().port}/`, close: () => server.close() };
}

const local = process.argv[2] ? null : await serve();
const base = process.argv[2] || local.url;
const proxy = process.env.HTTPS_PROXY && process.argv[2] ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy, args: proxy ? ["--ignore-certificate-errors"] : [] });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed++; };

// Routing schaltet in Chromium den Service Worker ab – für den Offline-Test daher ohne.
async function page(locale, { blockFonts = true } = {}) {
  const ctx = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => check(false, `Seitenfehler: ${e.message}`));
  if (blockFonts) await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(base);
  return p;
}

async function session(p, sound, minutes) {
  await p.click(`#sounds [data-sound=${sound}]`);
  await p.click(`#wheel [data-min="${minutes}"]`);
  await p.click("#go");
  await p.waitForFunction(() => {
    const a = document.getElementById("player");
    return a.src.startsWith("blob:") && a.duration > 100;
  }, null, { timeout: 60000 });
  return p.evaluate(async () => {
    const a = document.getElementById("player");
    const buf = await (await fetch(a.src)).arrayBuffer();
    const rate = new DataView(buf).getUint32(24, true), s = new Int16Array(buf, 44);
    let peak = 0, q = 0;
    for (const x of s) peak = Math.max(peak, Math.abs(x));
    for (let i = 4 * rate; i < 6 * rate; i++) q += s[i] * s[i];
    return {
      rate, duration: a.duration, paused: a.paused,
      peakDb: 20 * Math.log10(peak / 32768),
      noiseDb: 20 * Math.log10(Math.sqrt(q / (2 * rate)) / 32768 + 1e-9),
    };
  });
}

for (const [locale, lang, night] of [["de-DE", "de", "Gute Nacht"], ["en-GB", "en", "Good night"], ["fr-FR", "en", "Good night"]]) {
  const p = await page(locale);
  check(await p.evaluate(() => document.documentElement.lang) === lang, `${locale}: Sprache ${lang} vorgewählt`);
  const r = await session(p, "brown", 10);
  check(!r.paused && Math.abs(r.duration - 632) < 1, `${locale}: 10-min-Sitzung spielt (${r.duration.toFixed(0)} s, ${r.rate} Hz)`);
  check(r.peakDb < 0 && Math.abs(r.noiseDb + 43) < 1.5, `${locale}: Spitze ${r.peakDb.toFixed(1)} dBFS, Rauschen ${r.noiseDb.toFixed(1)} dBFS`);
  await p.waitForTimeout(3500);
  const [w, op] = await p.$eval("#word", e => [e.textContent, Number(e.style.opacity)]);
  check(w.length > 0 && op > 0.3, `${locale}: Wort sichtbar („${w}“, ${op})`);
  const before = await p.$eval("#player", a => a.currentTime);
  await p.click("#stage");
  await p.waitForTimeout(300);
  const after = await p.$eval("#player", a => a.currentTime);
  check(after - before < 1 && await p.$eval("#panel", e => e.hidden), `${locale}: kurzes Tippen bewirkt nichts`);
  await p.$eval("#player", a => { a.currentTime = a.duration - 0.5; });
  await p.waitForTimeout(3000);
  check(await p.$eval("#word", e => e.textContent) === night, `${locale}: „${night}“ am Ende`);
  await p.context().close();
}

// Titel und Info-Dialog je Sprache
for (const [locale, title, heading] of [["de-DE", "Einschlafwörter", "So geht’s"], ["en-GB", "Sleep Words", "How to use"]]) {
  const p = await page(locale);
  check(await p.textContent("h1") === title, `${locale}: Titel „${title}“`);
  await p.click("#info-open");
  const shown = await p.evaluate(() => [...document.querySelectorAll("#info article")].filter(a => a.offsetParent).map(a => a.querySelector("h3").textContent));
  check(await p.evaluate(() => document.getElementById("info").open) && shown.length === 1 && shown[0] === heading, `${locale}: Info öffnet in eigener Sprache`);
  await p.keyboard.press("Escape");
  check(!(await p.evaluate(() => document.getElementById("info").open)), `${locale}: Info schließt mit Esc`);
  await p.context().close();
}

// Umschalter: Wahl wird gemerkt und übersteuert die Browsersprache
{
  const p = await page("de-DE");
  await p.selectOption("#lang", "en");
  check(JSON.stringify(await p.$$eval("#voices button", bs => bs.map(b => b.textContent))) === '["Rainbird","Verity","Nathaniel"]',
    "Umschalter: englische Stimmen Rainbird, Verity, Nathaniel");
  check(await p.textContent("#go") === "Start"
    && await p.textContent("#sounds [data-sound=rain]") === "Rain", "Umschalter: Texte auf Englisch");
  await p.reload();
  check(await p.evaluate(() => document.documentElement.lang) === "en", "Umschalter: Wahl bleibt nach Neuladen");
  const r = await session(p, "off", 10);
  check(r.noiseDb < -100, "Umschalter: englische Sitzung ohne Rauschen");
  await p.context().close();
}

// Stimme: Stefan lädt nur die eigene Clip-Datei, Wahl bleibt nach Neuladen
{
  const p = await page("de-DE");
  const loaded = [];
  let counting = false;  // erst ab dem Neuladen: vorher Geladenes zählt nicht
  p.on("request", r => { const m = r.url().match(/clips\/([\w-]+)\.json/); if (m && counting) loaded.push(m[1]); });
  check(await p.getAttribute("[data-voice=laura]", "aria-checked") === "true" && await p.textContent("[data-voice=stefan]") === "Stefan", "Stimme: Laura vorgewählt, Namen statt Geschlecht");
  // Erst wenn de-laura offline abgelegt ist, sonst kann diese Anfrage noch ins Neuladen fallen
  for (let t = Date.now(); !(await p.evaluate(async () => !!await (await caches.open("ew-v3")).match("clips/de-laura.json")));) {
    if (Date.now() - t > 30000) break;
    await p.waitForTimeout(200);
  }
  await p.click("[data-voice=stefan]");
  counting = true;
  await p.reload();
  check(await p.getAttribute("[data-voice=stefan]", "aria-checked") === "true", "Stimme: Wahl bleibt nach Neuladen");
  const r = await session(p, "off", 10);
  check(!r.paused && Math.abs(r.duration - 632) < 1, "Stimme: Sitzung mit Stefan spielt");
  check(loaded.includes("de-stefan") && !loaded.includes("de-laura"),
    `Stimme: nach dem Umschalten nur de-stefan geladen (${[...new Set(loaded)].join(", ")})`);
  await p.context().close();
}

// Hintergrund: Klang und Lautstärke getrennt, beides gemerkt; Regen und Wellen spielen im Pegel
{
  const p = await page("de-DE");
  check(await p.getAttribute("#sounds [data-sound=brown]", "aria-checked") === "true", "Hintergrund: Rauschen vorgewählt");
  await p.click("#sounds [data-sound=rain]");
  await p.$eval("#level", e => { e.value = "-35"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.reload();
  check(await p.getAttribute("#sounds [data-sound=rain]", "aria-checked") === "true"
    && await p.$eval("#level", e => e.value) === "-35", "Hintergrund: Klang und Lautstärke bleiben nach Neuladen");
  const r = await session(p, "rain", 10);
  // Aufnahme schwankt kurzfristig, Start zufällig: Messfenster 2 s, daher grob
  check(!r.paused && Math.abs(r.noiseDb - (-35 - 6)) < 8, `Hintergrund: Regen ${r.noiseDb.toFixed(1)} dBFS`);
  await p.context().close();
  const q = await page("de-DE");
  await q.click("#sounds [data-sound=off]");
  check(await q.$eval("#level", e => e.disabled), "Hintergrund: Stille sperrt den Lautstärkeregler");
  const w = await session(q, "waves", 10);
  check(!w.paused && w.noiseDb < -35 && w.noiseDb > -75, `Hintergrund: Wellen ${w.noiseDb.toFixed(1)} dBFS`);
  await q.context().close();
}

// Dauer-Rad: Wahl bleibt; Halten öffnet das Bedienfeld, ±5 min und Klang mischen den Rest neu
{
  const p = await page("de-DE");
  await p.click('#wheel [data-min="45"]');
  await p.reload();
  check(await p.$eval("#wheel", e => e.getAttribute("aria-valuenow")) === "45", "Rad: Dauer bleibt nach Neuladen");
  await p.focus("#wheel");
  await p.keyboard.press("ArrowLeft");
  await p.keyboard.press("ArrowLeft");
  check(await p.$eval("#wheel", e => e.getAttribute("aria-valuenow")) === "35", "Rad: Pfeiltasten in 5-min-Schritten");
  await p.click('#wheel [data-min="10"]');
  await p.click("#go");
  await p.waitForFunction(() => document.getElementById("player").duration > 100, null, { timeout: 60000 });
  await p.waitForTimeout(1000);
  const hold = async ms => { await p.mouse.move(180, 300); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); };
  await hold(500);
  await p.waitForTimeout(600);
  check(await p.$eval("#panel", e => e.hidden) && await p.$eval("#hold", e => e.hidden), "Halten: zu kurz öffnet nichts, Ring verschwindet");
  await hold(1500);
  check(!(await p.$eval("#panel", e => e.hidden)) && await p.textContent("#left-n") === "10", "Halten: Bedienfeld offen, Restzeit 10");
  const swapped = () => p.waitForFunction(() => document.getElementById("panel-status").textContent === "", null, { timeout: 30000 });
  await p.click('[data-adj="5"]');
  await swapped();
  const d15 = await p.$eval("#player", a => a.currentTime + a.duration);
  check(await p.textContent("#left-n") === "15" && Math.abs(d15 - (2 + 900 + 30)) < 3,
    `+5: Restzeit 15, Sitzung endet bei ${d15.toFixed(0)} s`);
  check(await p.$eval("#panel-note", e => e.hidden), "+5: Umschalten gilt nicht als Unterbrechung");
  await p.click('[data-adj="-5"]');
  await p.click('[data-adj="-5"]');
  await swapped();
  check(await p.textContent("#left-n") === "5", "−5 zweimal: Restzeit 5");
  await p.click("#sounds-live [data-sound=rain]");
  await swapped();
  check(!(await p.$eval("#player", a => a.paused)) && await p.getAttribute("#sounds [data-sound=rain]", "aria-checked") === "true",
    "Klang im Bedienfeld: spielt weiter, Startseite übernimmt die Wahl");
  await p.click("#resume");
  check(await p.$eval("#panel", e => e.hidden), "Weiter: Bedienfeld zu");
  await hold(1500);
  check(await p.evaluate(() => !!document.fullscreenElement), "Vollbild während der Sitzung");
  await p.click("#end");
  check(!(await p.$eval("#start", e => e.hidden)) && await p.$eval("#player", a => a.paused), "Beenden: zurück zur Startseite, Ton aus");
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.fullscreenElement), "Startseite: Vollbild wieder aus");
  await p.context().close();
}

// Dauer-Rad am Desktop: Mausrad, Ziehen mit der Maus, Klick nach dem Ziehen
{
  const ctx = await browser.newContext({ locale: "de-DE", viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(base);
  await p.waitForTimeout(300);
  const v = () => p.$eval("#wheel", e => Number(e.getAttribute("aria-valuenow")));
  const c = await p.$eval("#wheel", e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const v0 = await v();
  await p.mouse.move(c.x, c.y);
  await p.mouse.wheel(0, 100);
  await p.waitForTimeout(600);
  check(await v() === v0 + 10, `Rad Desktop: Mausrad (${v0} → ${await v()})`);
  const v1 = await v();
  await p.mouse.down();
  await p.mouse.move(c.x - 200, c.y, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(800);
  check(await v() > v1, `Rad Desktop: Ziehen (${v1} → ${await v()})`);
  await p.click('#wheel [data-min="30"]');
  await p.waitForTimeout(800);
  check(await v() === 30, "Rad Desktop: Klick nach dem Ziehen");
  await ctx.close();
}

// Schrift kommt vom eigenen Server, keine Anfrage an Fremdanbieter
{
  const ctx = await browser.newContext({ locale: "de-DE" });
  const p = await ctx.newPage();
  const foreign = [];
  p.on("request", r => { if (new URL(r.url()).origin !== new URL(base).origin) foreign.push(r.url()); });
  await p.goto(base);
  await p.evaluate(() => document.fonts.ready);
  const loaded = await p.evaluate(() => document.fonts.check('italic 300 16px "Newsreader"')
    && [...document.fonts].some(f => f.family.replace(/"/g, "") === "Newsreader" && f.status === "loaded"));
  check(loaded, "Schrift Newsreader selbst ausgeliefert und geladen");
  check(foreign.length === 0, `keine Fremdanbieter-Anfragen${foreign.length ? ": " + foreign.join(", ") : ""}`);
  await ctx.close();
}

// Vorbereitung abbrechen: Esc bzw. Halten führt zurück zur Startseite, Wörter nicht verbraucht
{
  const p = await page("de-DE");
  await p.click('#wheel [data-min="120"]');
  const deck0 = await p.evaluate(() => localStorage.getItem("ew-deck"));
  await p.click("#go");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  check(!(await p.$eval("#start", e => e.hidden)) && await p.$eval("#player", a => !a.src.startsWith("blob:")),
    "Vorbereitung: Esc bricht ab, zurück zur Startseite");
  check(await p.evaluate(() => localStorage.getItem("ew-deck")) === deck0, "Vorbereitung: Abbruch verbraucht keine Wörter");
  await p.click("#go");
  await p.mouse.move(180, 300); await p.mouse.down(); await p.waitForTimeout(1500); await p.mouse.up();
  await p.waitForTimeout(500);
  check(!(await p.$eval("#start", e => e.hidden)), "Vorbereitung: Halten bricht ab");
  await p.context().close();
}

// Lange Sitzung: „Wird vorbereitet …“, bis sie spielt
{
  const p = await page("de-DE");
  await p.click('#wheel [data-min="120"]');
  const t0 = Date.now();
  await p.click("#go");
  const shown = await p.waitForSelector("#building:not([hidden])", { timeout: 5000, state: "attached" }).then(() => true, () => false);
  await p.waitForFunction(() => document.getElementById("player").duration > 7000, null, { timeout: 120000 });
  check(shown && await p.$eval("#building", e => e.hidden),
    `120 min: Hinweis beim Vorbereiten, dann weg (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await p.context().close();
}

// Unterbrechung (Anruf, andere App): Bedienfeld öffnet mit Hinweis, Weiter setzt fort
{
  const p = await page("de-DE");
  await p.click('#wheel [data-min="10"]');
  await p.click("#go");
  await p.waitForFunction(() => document.getElementById("player").duration > 100, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.$eval("#player", a => a.pause());  // wie das System bei einem Anruf
  await p.waitForTimeout(300);
  check(!(await p.$eval("#panel", e => e.hidden)) && !(await p.$eval("#panel-note", e => e.hidden)),
    "Unterbrechung: Bedienfeld mit Hinweis offen");
  await p.waitForTimeout(13000);
  check(!(await p.$eval("#panel", e => e.hidden)), "Unterbrechung: Bedienfeld sperrt sich nicht von selbst");
  const t0 = await p.$eval("#player", a => a.currentTime);
  await p.click("#resume");
  await p.waitForTimeout(1200);
  const t1 = await p.$eval("#player", a => a.currentTime);
  check(t1 > t0 + 0.5 && await p.$eval("#panel", e => e.hidden) && await p.$eval("#panel-note", e => e.hidden),
    `Unterbrechung: Weiter setzt fort (${t0.toFixed(1)} → ${t1.toFixed(1)} s)`);
  // Änderung während der Unterbrechung: bleibt angehalten, bis „Weiter“
  await p.$eval("#player", a => a.pause());
  await p.waitForTimeout(300);
  await p.click('[data-adj="5"]');
  await p.waitForFunction(() => document.getElementById("panel-status").textContent === "", null, { timeout: 30000 });
  await p.waitForTimeout(500);
  check(await p.$eval("#player", a => a.paused) && !(await p.$eval("#panel-note", e => e.hidden))
    && await p.textContent("#left-n") === "15", "Unterbrechung: +5 mischt neu, bleibt aber angehalten");
  await p.click("#resume");
  await p.waitForTimeout(800);
  check(!(await p.$eval("#player", a => a.paused)), "Unterbrechung: Weiter nach Änderung spielt");
  // Tastatur: Leertaste öffnet, Esc schließt
  await p.keyboard.press(" ");
  check(!(await p.$eval("#panel", e => e.hidden)) && await p.evaluate(() => document.activeElement.id) === "resume",
    "Tastatur: Leertaste öffnet Bedienfeld, Fokus auf Weiter");
  await p.keyboard.press("Escape");
  check(await p.$eval("#panel", e => e.hidden), "Tastatur: Esc schließt Bedienfeld");
  await p.$eval("#player", a => { a.currentTime = a.duration - 0.5; });
  await p.waitForTimeout(3000);
  check(await p.$eval("#panel", e => e.hidden) && await p.textContent("#word") === "Gute Nacht",
    "Unterbrechung: Ende der Sitzung zählt nicht als Unterbrechung");
  await p.context().close();
}

// Alte Einstellung (ein Regler „mittel“) wird übernommen: Rauschen, -35 dBFS
{
  const p = await page("de-DE");
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ew-noise", "medium"); localStorage.setItem("ew-voice", "m"); });
  await p.reload();
  check(await p.getAttribute("#sounds [data-sound=brown]", "aria-checked") === "true"
    && await p.$eval("#level", e => e.value) === "-35"
    && await p.getAttribute("[data-voice=stefan]", "aria-checked") === "true", "Alte Einstellungen „mittel“ und „männlich“ (→ Stefan) übernommen");
  await p.context().close();
}

// Startseite passt ohne Scrollen und ohne waagrechten Überlauf
for (const [w, h] of [[360, 740], [320, 568]]) {
  const ctx = await browser.newContext({ locale: "de-DE", viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(base);
  const [sh, sw] = await p.evaluate(() => [document.getElementById("start").scrollHeight, document.documentElement.scrollWidth]);
  check(sh <= h && sw <= w, `Startseite ${w}×${h}: passt (${sw}×${sh})`);
  await ctx.close();
}

// Installierbar (Chromium-Prüfung); Manifest folgt der Sprache
for (const [locale, name] of [["de-DE", "Einschlafen"], ["en-GB", "Sleep Words"]]) {
  const p = await page(locale, { blockFonts: false });
  const cdp = await p.context().newCDPSession(p);
  // Leere Fehlerliste allein heißt nichts: erst gilt, wenn das Manifest auch geladen ist.
  let errors = [], url = "";
  for (let t = Date.now(); Date.now() - t < 30000; await p.waitForTimeout(500)) {
    ({ url } = await cdp.send("Page.getAppManifest"));
    ({ installabilityErrors: errors } = await cdp.send("Page.getInstallabilityErrors"));
    if (url && !errors.length) break;
  }
  const ok = !!url && !errors.length;
  check(ok, `${locale}: installierbar${ok ? "" : " – " + (url ? errors.map(e => e.errorId).join(", ") : "kein Manifest")}`);
  const manifest = url ? await (await p.request.get(url)).json() : {};
  check(manifest.short_name === name, `${locale}: Manifest-Name „${manifest.short_name}“`);
  await p.context().close();
}

// Offline: nach einem Online-Besuch läuft die App ohne Netz
{
  const p = await page("de-DE", { blockFonts: false });
  // waitForFunction wertet ein Promise als „wahr“ – daher selbst abfragen.
  await p.click("#sounds [data-sound=waves]");  // Aufnahme wird geladen und offline abgelegt
  const cached = () => p.evaluate(async () => {
    const c = await caches.open("ew-v3");
    return !!(navigator.serviceWorker.controller && await c.match("clips/de-laura.json") && await c.match("./")
      && await c.match("sounds/waves.mp3"));
  });
  for (let t = Date.now(); !(await cached()); ) {
    if (Date.now() - t > 60000) throw new Error("Offline-Cache nicht befüllt");
    await p.waitForTimeout(500);
  }
  await p.context().setOffline(true);
  await p.reload();
  check(await p.evaluate(() => document.documentElement.lang) === "de", "Offline: App lädt aus dem Cache");
  const r = await session(p, "brown", 10);
  check(!r.paused && Math.abs(r.duration - 632) < 1, "Offline: Sitzung spielt");
  await p.context().close();
}

await browser.close();
local?.close();
console.log(failed ? `${failed} fehlgeschlagen` : "alles ok");
process.exit(failed ? 1 : 0);
