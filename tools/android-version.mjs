// Version der Android-App für .github/workflows/android.yml (Schema: apps-data STANDARD.md §8).
// Einzige Quelle ist "version" in package.json. Fehlt dazu der Tag v<version> und ist ein Release
// erlaubt (--release, nur auf main), wird veröffentlicht. Sonst Entwicklungsstand: letzter Tag plus
// Zahl der Commits seither.
// Ausgabe: Zeilen KEY=WERT für $GITHUB_OUTPUT.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// versionCode = major·10⁷ + minor·10⁵ + patch·10³; die letzten drei Stellen gehören Entwicklungsständen.
export function versionCode(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Version „${v}“ ist nicht X.Y.Z`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`Version „${v}“: minor und patch höchstens 99`);
  return major * 1e7 + minor * 1e5 + patch * 1e3;
}

export function devCode(lastTagVersion, commitsSince) {
  return (lastTagVersion ? versionCode(lastTagVersion) : 0) + Math.min(commitsSince, 999);
}

function main() {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const tryGit = (...args) => { try { return git(...args); } catch { return ""; } };
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const tag = `v${version}`;
  const code = versionCode(version);
  const tagged = tryGit("tag", "--list", tag) === tag;
  const release = process.argv.includes("--release") && !tagged;

  const out = { version, tag, release };
  if (release) {
    Object.assign(out, { code, name: version });
  } else {
    const last = tryGit("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0");
    const n = Number(git("rev-list", "--count", last ? `${last}..HEAD` : "HEAD"));
    const sha = git("rev-parse", "--short", "HEAD");
    const base = last ? last.slice(1) : "0.0.0";
    Object.assign(out, { code: devCode(last && base, n), name: `${base}-dev.${n}+${sha}` });
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
