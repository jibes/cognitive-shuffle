// Alle Stellschrauben an einer Stelle. Paare [Start, Ende] werden linear über die Sitzung verlaufen.

export const SESSION = {
  lead: 2,              // s Stille vor dem ersten Wort
  tail: 30,             // s Nachlauf, Rauschen blendet aus
  gap: [8, 20],         // s zwischen Wortanfängen
  voice: [0.85, 0.35],  // Lautstärke der Stimme
  maxClip: 3,           // s Sicherheitsabstand vor Sitzungsende
  minutes: [10, 15, 25],
};

export const DISPLAY = {
  glow: [0.6, 0.1],     // Helligkeit des Wortes
  fadeIn: [1.5, 4],     // s
  hold: 5,              // s nach Wortanfang beginnt das Ausblenden
  fadeOut: 2.5,         // s
  night: 0.12,          // Helligkeit von „Gute Nacht“
  skipLead: 0.3,        // s vor dem nächsten Wortanfang landen
};

export const AMBIENT = {
  sounds: ["off", "brown", "rain", "waves"],  // Reihenfolge im Umschalter; Klänge in ambient.js
  // Lautheitsausgleich in dB: gleiche Reglerstellung klingt bei jedem Klang etwa gleich laut
  // (gemessen in LUFS gegenüber braunem Rauschen, tools/ambient_loudness.mjs)
  trim: { brown: 0, rain: -5.5, waves: -2 },
  level: { min: -55, max: -29, default: -43 },  // RMS in dBFS (Regler)
  default: "brown",
};

export const AUDIO = {
  decodeRates: [22050, 16000, 44100],  // Reihenfolge der Versuche
  maxOutRate: 24000,                    // darüber wird ganzzahlig heruntergeteilt
};

export const LONG_PRESS_MS = 900;      // beendet die Sitzung

export const lerp = (range, p) => range[0] + (range[1] - range[0]) * p;
