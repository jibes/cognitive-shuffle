// Alle Stellschrauben an einer Stelle. Paare [Start, Ende] werden linear über die Sitzung verlaufen.

export const SESSION = {
  lead: 2,              // s Stille vor dem ersten Wort
  tail: 30,             // s Nachlauf, Hintergrund blendet aus
  gap: [8, 15],         // s zwischen Wortanfängen (Studie: 8 s)
  voice: [0.85, 0.35],  // Lautstärke der Stimme
  ramp: 20 * 60,        // s: so lange werden Pausen länger und Stimme leiser, danach gleichbleibend
  maxClip: 3,           // s Sicherheitsabstand vor Sitzungsende
  minutes: { min: 5, max: 120, step: 5, default: 15 },
};

export const DISPLAY = {
  glow: [0.6, 0.1],     // Helligkeit des Wortes
  fadeIn: [1.5, 4],     // s
  hold: 5,              // s nach Wortanfang beginnt das Ausblenden
  fadeOut: 2.5,         // s
  night: 0.12,          // Helligkeit von „Gute Nacht“
};

export const AMBIENT = {
  sounds: ["off", "brown", "rain", "waves"],  // Reihenfolge im Umschalter; Klänge in ambient.js
  files: { rain: "sounds/rain.mp3", waves: "sounds/waves.mp3" },  // Aufnahmen, in Schleife
  // Lautheitsausgleich in dB: gleiche Reglerstellung klingt bei jedem Klang etwa gleich laut
  // (gemessen in LUFS gegenüber braunem Rauschen, tools/ambient_loudness.mjs)
  trim: { brown: 0, rain: -6, waves: -5.5 },
  level: { min: -55, max: -29, default: -43 },  // RMS in dBFS (Regler)
  default: "brown",
};

export const AUDIO = {
  decodeRates: [22050, 16000, 44100],  // Reihenfolge der Versuche
  maxOutRate: 24000,                    // darüber wird ganzzahlig heruntergeteilt
};

export const CONTROLS = {
  holdMs: 1200,         // Halten, bis das Bedienfeld entsperrt
  relockMs: 12000,      // ohne Berührung sperrt es sich wieder
  minLeftS: 120,        // −5 kürzt höchstens bis so viel Restzeit
  keepS: 20,            // beim Neumischen bleiben Wörter der nächsten Sekunden unverändert
  remixDelayMs: 500,    // Regler: erst nach kurzer Ruhe neu mischen
};

export const lerp = (range, p) => range[0] + (range[1] - range[0]) * p;
