// Oberflächentexte je Sprache. Eine neue Sprache braucht hier einen Eintrag
// und web/clips/<code>.json (tools/build_clips.py --lang <code>).

export const TEXT = {
  de: {
    name: "Deutsch",
    title: "Einschlafwörter",
    appName: "Einschlafen",
    artist: "Wörter zum Einschlafen",
    hint: "Dauer antippen, Handy weglegen und den Wörtern zuhören, bis sie von selbst verklingen.",
    noise: "Rauschen",
    noiseOff: "aus",
    noiseSoft: "leise",
    noiseMedium: "mittel",
    min10: "10 Minuten",
    min15: "15 Minuten",
    min25: "25 Minuten",
    tap: "Tippen zum Abspielen",
    night: "Gute Nacht",
    fail: "Der Ton ließ sich nicht vorbereiten.",
    infoOpen: "Info: was es ist und wie es geht",
    infoClose: "Schließen",
  },
  en: {
    name: "English",
    title: "Sleep Words",
    appName: "Sleep Words",
    artist: "Words to fall asleep to",
    hint: "Tap a length, put the phone down and listen to the words until they fade away on their own.",
    noise: "Noise",
    noiseOff: "off",
    noiseSoft: "soft",
    noiseMedium: "medium",
    min10: "10 minutes",
    min15: "15 minutes",
    min25: "25 minutes",
    tap: "Tap to play",
    night: "Good night",
    fail: "The sound could not be prepared.",
    infoOpen: "Info: what it is and how to use it",
    infoClose: "Close",
  },
};

export const LANGS = Object.keys(TEXT);
export const FALLBACK = "en";

// Gespeicherte Wahl, sonst erste passende Browser-/Systemsprache, sonst Englisch.
export function pickLang(saved, preferred, available = LANGS) {
  if (available.includes(saved)) return saved;
  for (const tag of preferred || []) {
    const code = String(tag).toLowerCase().split("-")[0];
    if (available.includes(code)) return code;
  }
  return available.includes(FALLBACK) ? FALLBACK : available[0];
}
