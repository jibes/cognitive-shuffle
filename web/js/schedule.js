import { SESSION, lerp } from "./config.js";

// Wortanfänge einer Sitzung: { t: Sekunden ab Dateibeginn, p: Fortschritt 0..1 }.
// p steigt über die Sitzung, höchstens über SESSION.ramp Sekunden, und bleibt dann bei 1:
// Pausen werden länger, Stimme und Anzeige leiser, danach gleichbleibend.
// from = { t, p }: neu planen ab t (Dauer geändert); p läuft vom erreichten Stand weiter.
export function onsets(durationS, cfg = SESSION, from = null) {
  const end = cfg.lead + durationS;
  const t0 = from ? from.t : cfg.lead, p0 = from ? from.p : 0;
  const span = cfg.lead + Math.min(cfg.ramp, durationS) - t0;
  const out = [];
  for (let t = t0; t + cfg.maxClip <= end; ) {
    const p = span > 0 ? Math.min(1, p0 + (1 - p0) * (t - t0) / span) : 1;
    out.push({ t, p });
    t += lerp(cfg.gap, p);
  }
  return out;
}

// Neue Dauer: Wörter vor keepUntil bleiben (Zeit, Fortschritt, Wort), danach neu verteilt.
export function replan(marks, durationS, keepUntil, cfg = SESSION) {
  const kept = marks.filter(m => m.t < keepUntil);
  const last = kept[kept.length - 1];
  const from = last ? { t: last.t + lerp(cfg.gap, last.p), p: last.p } : null;
  return [...kept, ...onsets(durationS, cfg, from)];
}
