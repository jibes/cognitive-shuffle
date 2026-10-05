# Einschlafwörter / Sleep Words

Einschlafhilfe nach der Cognitive-Shuffle-Methode: neutrale Wörter in wachsenden Pausen, läuft bei gesperrtem Bildschirm weiter.
**https://jibes.github.io/cognitive-shuffle/** öffnen (Brave: Hintergrundwiedergabe erlauben), Stimme (weiblich/männlich), Hintergrund (Stille, Rauschen, Regen, Wellen) und Lautstärke wählen (kurze Hörprobe), Dauer antippen, sperren. Tippen = nächstes Wort, lange drücken = beenden. Sprache folgt dem Browser, Auswahlliste oben rechts. Installierbar („Zum Startbildschirm“ / „App installieren“); nach einem Online-Besuch läuft sie offline (Service Worker `web/sw.js`; Clips der zuletzt genutzten Sprachen).

| Ordner | Inhalt |
|---|---|
| `web/` | die App (statisch, ES-Module, kein Build): `js/config.js` Stellschrauben, `js/i18n.js` Texte, `clips/<lang>-<f\|m>.json` Audio je Stimme |
| `words/` | Wortlisten je Sprache, ein Wort pro Zeile |
| `tools/` | `build_clips.py`: Wortliste → `web/clips/<lang>.json` (TTS, Trimmen, Normalisieren, MP3) |
| `tests/` | `npm test` (Logik, Node), `npm run e2e` (Browser, Playwright) |

- Lokal: `npm run serve` → http://localhost:8000
- Clips bauen: `pip install -r tools/requirements.txt` + ffmpeg, dann `python tools/build_clips.py --lang de --engine eleven --gender f --count 400` (bzw. `m`) → `web/clips/de-f.json`. ElevenLabs v3 mit `ELEVENLABS_API_KEY`: Laura/Stefan (de), Verity/Nathaniel (en), jedes Wort ein Request mit Regie `[calm, measured, slow]`, stability 1.0, speed 0.85; Cache `tools/.cache/eleven/` (nie doppelt zahlen). `--count` wählt gleichmäßig über die Kategorien und behält, was schon vorliegt – gerendert wird nur, was fehlt oder veraltet ist (rund 12 Credits je Wort). `--status` zeigt Ist/Soll je Stimme aus `tools/clips_status.json` (Soll, Ist, aktuell, veraltet = mit anderen Einstellungen gerendert, fehlt). Ausreißer: `--only Wort --seed 7` rendert neu und merkt den Seed in `tools/eleven_seeds.json`. Proben per `--only … --mp3-dir DIR`. Alternativen (schreiben `<lang>.json`, für die App umbenennen): edge-tts, `--engine google` ohne Key, `--engine piper --model …onnx` offline.
- Hintergrundklänge (`web/js/ambient.js`): Rauschen prozedural; Regen und Wellen sind Aufnahmen `web/sounds/<name>.mp3` (aus Blanket, CC BY, Nachweis in `web/sounds/CREDITS.md` und im Info-Dialog), in Schleife mit 2 s Überblendung, Start zufällig, offline gecacht. Lautstärke in dBFS RMS, je Klang Lautheitsausgleich `AMBIENT.trim` (`js/config.js`). Neue Aufnahme: Quelle in `tools/build_loops.py`, `python tools/build_loops.py --src DIR`, Eintrag in `AMBIENT.files`/`sounds`/`trim`, Text `sound_<name>` (`js/i18n.js`), Symbol `SOUND_ICONS` (`js/main.js`), Nachweis ergänzen. `node tools/ambient_loudness.mjs` misst LUFS und schlägt `trim` vor.
- Wortlisten: Kriterien stehen als Kommentar oben in `words/<lang>.txt` (bildhaft, neutral, alltagsbekannt, eindeutig).
- Neue Sprache: `words/<code>.txt`, Eintrag in `LANGS` (`tools/build_clips.py`) und `TEXT` (`web/js/i18n.js`), Clips bauen.
- Deploy: Push auf `main` → GitHub Actions testet und veröffentlicht `web/` (Pages-Quelle: „GitHub Actions“).
