import { SESSION, lerp } from "./config.js";

// Wortanfänge einer Sitzung: { t: Sekunden ab Dateibeginn, p: Fortschritt 0..1 }.
// Hängt nur von der Dauer ab, nicht von den Clips.
export function onsets(durationS, cfg = SESSION) {
  const out = [];
  for (let t = cfg.lead; t + cfg.maxClip <= cfg.lead + durationS; ) {
    const p = (t - cfg.lead) / durationS;
    out.push({ t, p });
    t += lerp(cfg.gap, p);
  }
  return out;
}

export const maxWordsPerSession = () => onsets(Math.max(...SESSION.minutes) * 60).length;
