# Einschlafwörter / Sleep Words

Einschlafhilfe nach der Cognitive-Shuffle-Methode: neutrale Wörter in wachsenden Pausen, läuft bei gesperrtem Bildschirm weiter.
**https://jibes.github.io/cognitive-shuffle/** öffnen (Brave: Hintergrundwiedergabe erlauben), Dauer antippen, sperren. Tippen = nächstes Wort, lange drücken = beenden. Sprache folgt dem Browser, umschaltbar oben rechts. Installierbar („Zum Startbildschirm“ / „App installieren“); nach einem Online-Besuch läuft sie offline (Service Worker `web/sw.js`; Clips der zuletzt genutzten Sprachen).

| Ordner | Inhalt |
|---|---|
| `web/` | die App (statisch, ES-Module, kein Build): `js/config.js` Stellschrauben, `js/i18n.js` Texte, `clips/<lang>.json` Audio |
| `words/` | Wortlisten je Sprache, ein Wort pro Zeile |
| `tools/` | `build_clips.py`: Wortliste → `web/clips/<lang>.json` (TTS, Trimmen, Normalisieren, MP3) |
| `tests/` | `npm test` (Logik, Node), `npm run e2e` (Browser, Playwright) |

- Lokal: `npm run serve` → http://localhost:8000
- Clips bauen: `pip install -r tools/requirements.txt` + ffmpeg, dann `python tools/build_clips.py --lang de` (edge-tts Katja/Sonia; ohne Key: `--engine google`; offline: `--engine piper --model …onnx`; ElevenLabs: `--engine eleven --voice <voice_id>` mit `ELEVENLABS_API_KEY`, ~40 Wörter je Request, Schnitt an Zeitstempeln, Cache `tools/.cache/eleven/`, Proben per `--only … --mp3-dir DIR`). Eingecheckt sind Google-Stimmen (edge-tts war in der Build-Umgebung nicht erreichbar).
- Neue Sprache: `words/<code>.txt`, Eintrag in `LANGS` (`tools/build_clips.py`) und `TEXT` (`web/js/i18n.js`), Clips bauen.
- Deploy: Push auf `main` → GitHub Actions testet und veröffentlicht `web/` (Pages-Quelle: „GitHub Actions“).
