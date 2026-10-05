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
  await p.click(`[data-sound=${sound}]`);
  await p.click(`[data-min="${minutes}"]`);
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
  const after = await p.$eval("#player", a => a.currentTime);
  check(after > before + 4, `${locale}: Tippen springt (${before.toFixed(1)} → ${after.toFixed(1)} s)`);
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
  check(await p.getAttribute("[data-min='10']", "aria-label") === "10 minutes"
    && await p.textContent("[data-sound=rain]") === "Rain", "Umschalter: Texte auf Englisch");
  await p.reload();
  check(await p.evaluate(() => document.documentElement.lang) === "en", "Umschalter: Wahl bleibt nach Neuladen");
  const r = await session(p, "off", 10);
  check(r.noiseDb < -100, "Umschalter: englische Sitzung ohne Rauschen");
  await p.context().close();
}

// Stimme: männlich lädt nur die eigene Clip-Datei, Wahl bleibt nach Neuladen
{
  const p = await page("de-DE");
  const loaded = [];
  p.on("request", r => { const m = r.url().match(/clips\/([\w-]+)\.json/); if (m) loaded.push(m[1]); });
  check(await p.getAttribute("[data-voice=f]", "aria-checked") === "true", "Stimme: weiblich vorgewählt");
  await p.click("[data-voice=m]");
  await p.reload();
  check(await p.getAttribute("[data-voice=m]", "aria-checked") === "true", "Stimme: Wahl bleibt nach Neuladen");
  const r = await session(p, "off", 10);
  check(!r.paused && Math.abs(r.duration - 632) < 1, "Stimme: männliche Sitzung spielt");
  check(loaded.includes("de-m") && loaded.lastIndexOf("de-f") < loaded.indexOf("de-m"),
    `Stimme: nach dem Umschalten nur de-m geladen (${[...new Set(loaded)].join(", ")})`);
  await p.context().close();
}

// Hintergrund: Klang und Lautstärke getrennt, beides gemerkt; Regen und Wellen spielen im Pegel
{
  const p = await page("de-DE");
  check(await p.getAttribute("[data-sound=brown]", "aria-checked") === "true", "Hintergrund: Rauschen vorgewählt");
  await p.click("[data-sound=rain]");
  await p.$eval("#level", e => { e.value = "-35"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.reload();
  check(await p.getAttribute("[data-sound=rain]", "aria-checked") === "true"
    && await p.$eval("#level", e => e.value) === "-35", "Hintergrund: Klang und Lautstärke bleiben nach Neuladen");
  const r = await session(p, "rain", 10);
  // Aufnahme schwankt kurzfristig, Start zufällig: Messfenster 2 s, daher grob
  check(!r.paused && Math.abs(r.noiseDb - (-35 - 6)) < 8, `Hintergrund: Regen ${r.noiseDb.toFixed(1)} dBFS`);
  await p.context().close();
  const q = await page("de-DE");
  await q.click("[data-sound=off]");
  check(await q.$eval("#level", e => e.disabled), "Hintergrund: Stille sperrt den Lautstärkeregler");
  const w = await session(q, "waves", 10);
  check(!w.paused && w.noiseDb < -35 && w.noiseDb > -75, `Hintergrund: Wellen ${w.noiseDb.toFixed(1)} dBFS`);
  await q.context().close();
}

// Alte Einstellung (ein Regler „mittel“) wird übernommen: Rauschen, -35 dBFS
{
  const p = await page("de-DE");
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("ew-noise", "medium"); });
  await p.reload();
  check(await p.getAttribute("[data-sound=brown]", "aria-checked") === "true"
    && await p.$eval("#level", e => e.value) === "-35", "Alte Einstellung „mittel“ übernommen");
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
  await p.click("[data-sound=waves]");  // Aufnahme wird geladen und offline abgelegt
  const cached = () => p.evaluate(async () => {
    const c = await caches.open("ew-v2");
    return !!(navigator.serviceWorker.controller && await c.match("clips/de-f.json") && await c.match("./")
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
