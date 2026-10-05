// Oberflächentexte je Sprache; sound_<name> für jeden Klang in AMBIENT.sounds. Eine neue Sprache braucht hier einen Eintrag
// und web/clips/<code>-f.json, <code>-m.json (tools/build_clips.py --lang <code> --gender f|m).

export const TEXT = {
  de: {
    name: "Deutsch",
    title: "Einschlafwörter",
    appName: "Einschlafen",
    artist: "Wörter zum Einschlafen",
    hint: "Handy weglegen und den Wörtern zuhören, bis sie von selbst verklingen.",
    voice: "Stimme",
    voiceF: "weiblich",
    voiceM: "männlich",
    sound: "Hintergrund",
    sound_off: "Stille",
    sound_brown: "Rauschen",
    sound_rain: "Regen",
    sound_waves: "Wellen",
    volume: "Lautstärke",
    length: "Dauer",
    start: "Starten",
    remaining: "Restzeit",
    less5: "5 Minuten weniger",
    more5: "5 Minuten mehr",
    end: "Beenden",
    resume: "Weiter",
    holdHint: "Gedrückt halten für Einstellungen",
    adjusting: "Wird angepasst …",
    preparing: "Wird vorbereitet …",
    interrupted: "Unterbrochen – durch einen Anruf, eine andere App oder Pause. Weiter setzt fort.",
    minutes: "Minuten",
    tap: "Tippen zum Abspielen",
    night: "Gute Nacht",
    fail: "Der Ton ließ sich nicht vorbereiten.",
    infoOpen: "Info: was es ist und wie es geht",
    infoClose: "Schließen",
    language: "Sprache",
  },
  en: {
    name: "English",
    title: "Sleep Words",
    appName: "Sleep Words",
    artist: "Words to fall asleep to",
    hint: "Put the phone down and listen to the words until they fade away on their own.",
    voice: "Voice",
    voiceF: "female",
    voiceM: "male",
    sound: "Background",
    sound_off: "Silence",
    sound_brown: "Noise",
    sound_rain: "Rain",
    sound_waves: "Waves",
    volume: "Volume",
    length: "Length",
    start: "Start",
    remaining: "Time left",
    less5: "5 minutes less",
    more5: "5 minutes more",
    end: "Stop",
    resume: "Continue",
    holdHint: "Press and hold for settings",
    adjusting: "Adjusting …",
    preparing: "Preparing …",
    interrupted: "Interrupted – by a call, another app or pause. Continue resumes.",
    minutes: "minutes",
    tap: "Tap to play",
    night: "Good night",
    fail: "The sound could not be prepared.",
    infoOpen: "Info: what it is and how to use it",
    infoClose: "Close",
    language: "Language",
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
