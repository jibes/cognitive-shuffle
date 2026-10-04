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

async function page(locale) {
  const ctx = await browser.newContext({ locale, viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => check(false, `Seitenfehler: ${e.message}`));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await p.goto(base);
  return p;
}

async function session(p, noise, minutes) {
  await p.click(`[data-noise=${noise}]`);
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
  const r = await session(p, "soft", 10);
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

// Umschalter: Wahl wird gemerkt und übersteuert die Browsersprache
{
  const p = await page("de-DE");
  await p.click("[data-lang=en]");
  check(await p.textContent("[data-min='10']") === "10 minutes", "Umschalter: Texte auf Englisch");
  await p.reload();
  check(await p.evaluate(() => document.documentElement.lang) === "en", "Umschalter: Wahl bleibt nach Neuladen");
  const r = await session(p, "off", 10);
  check(r.noiseDb < -100, "Umschalter: englische Sitzung ohne Rauschen");
  await p.context().close();
}

await browser.close();
local?.close();
console.log(failed ? `${failed} fehlgeschlagen` : "alles ok");
process.exit(failed ? 1 : 0);
