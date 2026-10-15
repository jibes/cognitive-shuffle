# Einschlafwörter / Sleep Words

Einschlafhilfe nach der Cognitive-Shuffle-Methode: neutrale Wörter in wachsenden Pausen, läuft bei gesperrtem Bildschirm weiter.
**https://jibes.github.io/cognitive-shuffle/** öffnen (Brave: Hintergrundwiedergabe erlauben), Stimme (de: Laura, Stefan; en: Rainbird, Verity, Nathaniel), Hintergrund (Stille, Rauschen, Regen, Wellen) und Lautstärke wählen (kurze Hörprobe), Dauer am Rad (5–120 min), Starten, sperren. Während der Sitzung: gedrückt halten, bis der Ring voll ist → Bedienfeld (Hintergrund, Lautstärke, ±5 min, Beenden); kurzes Tippen bewirkt nichts. Sprache folgt dem Browser, Auswahlliste oben rechts. Installierbar („Zum Startbildschirm“ / „App installieren“), installiert im Vollbild ohne Status- und Navigationsleiste (Android; iPhone erlaubt das nicht), im Browser Vollbild während der Sitzung; nach einem Online-Besuch läuft sie offline (Service Worker `web/sw.js`; Clips der zuletzt genutzten Sprachen).

| Ordner | Inhalt |
|---|---|
| `web/` | die App (statisch, ES-Module, kein Build): `js/config.js` Stellschrauben, `js/i18n.js` Texte, `clips/<lang>-<stimme>.json` Audio je Stimme |
| `words/` | Wortlisten je Sprache, ein Wort pro Zeile |
| `tools/` | `build_clips.py`: Wortliste → `web/clips/<lang>.json` (TTS, Trimmen, Normalisieren, MP3) |
| `android/` | Android-App: Capacitor-Hülle um dieselben `web/`-Dateien, plus Vordergrund-Dienst für die Wiedergabe bei gesperrtem Bildschirm |
| `tests/` | `npm test` (Logik, Node), `npm run e2e` (Browser, Playwright) |

- Lokal: `npm run serve` → http://localhost:8000
- Clips bauen: `pip install -r tools/requirements.txt` + ffmpeg, dann `python tools/build_clips.py --lang de --engine eleven --speaker laura --count 400` → `web/clips/de-laura.json`. Stimmen in `LANGS` (Werkzeug) und `VOICES` (`web/js/i18n.js`); neue Stimme mit denselben Wörtern: `--speaker rainbird --same-as verity`. ElevenLabs v3 mit `ELEVENLABS_API_KEY`, jedes Wort ein Request mit Regie `[calm, measured, slow]`, stability 1.0, speed 0.85; Cache `tools/.cache/eleven/` (nie doppelt zahlen). `--count` wählt gleichmäßig über die Kategorien und behält, was schon vorliegt – gerendert wird nur, was fehlt oder veraltet ist (rund 12 Credits je Wort). `--status` zeigt Ist/Soll je Stimme aus `tools/clips_status.json` (Soll, Ist, aktuell, veraltet = mit anderen Einstellungen gerendert, fehlt). Ausreißer: `--only Wort --seed 7` rendert neu und merkt den Seed in `tools/eleven_seeds.json`. Proben per `--only … --mp3-dir DIR`. Alternativen (schreiben `<lang>.json`, für die App umbenennen): edge-tts, `--engine google` ohne Key, `--engine piper --model …onnx` offline.
- Hintergrundklänge (`web/js/ambient.js`): Rauschen prozedural; Regen und Wellen sind Aufnahmen `web/sounds/<name>.mp3` (freesound.org über Blanket, CC BY 4.0, Nachweis in `web/sounds/CREDITS.md` und im Info-Dialog), in Schleife mit 2 s Überblendung, Start zufällig, offline gecacht. Lautstärke in dBFS RMS, je Klang Lautheitsausgleich `AMBIENT.trim` (`js/config.js`). Neue Aufnahme: Quelle in `tools/build_loops.py`, `python tools/build_loops.py --src DIR`, Eintrag in `AMBIENT.files`/`sounds`/`trim`, Text `sound_<name>` (`js/i18n.js`), Symbol `SOUND_ICONS` (`js/main.js`), Nachweis ergänzen. `node tools/ambient_loudness.mjs` misst LUFS und schlägt `trim` vor.
- Sitzung: Pausen 8 → 15 s und Stimme leiser über höchstens 20 min, danach gleich (`SESSION` in `js/config.js`). Die WAV wird stückweise als Blob gemischt; Änderungen im Bedienfeld mischen den Rest ab der aktuellen Stelle neu (sample-genau gleich bis dahin) und schalten in einer Wortpause um (`stage.swap`).
- Wortlisten: Kriterien stehen als Kommentar oben in `words/<lang>.txt` (bildhaft, neutral, alltagsbekannt, eindeutig).
- Neue Sprache: `words/<code>.txt`, Eintrag in `LANGS` (`tools/build_clips.py`) und `TEXT` (`web/js/i18n.js`), Clips bauen.
- Deploy Web: Push auf `main` mit Änderungen in `web/` → `deploy.yml` testet und veröffentlicht `web/` (Pages-Quelle: „GitHub Actions“).
- Deploy Android: `android.yml` baut bei jedem PR und Push auf `main` ein APK und prüft es im Emulator (Start, Sperre, Dienst läuft). Release: `version` in `package.json` erhöhen; sobald das auf `main` ist, legt die Action den Tag `v<version>` an und veröffentlicht das signierte APK als GitHub-Release.

## Android-App

Installieren und aktualisieren mit [Obtainium](https://obtainium.imranr.dev/): App hinzufügen, Quelle `https://github.com/jibes/cognitive-shuffle`. SHA-256 des Signaturzertifikats (prüfbar mit AppVerifier): steht in jedem Release.

Unterschiede zur Web-App: keine Installation über den Browser, Wiedergabe läuft als Vordergrund-Dienst (Benachrichtigung „Läuft“) und wird von Android nicht eingefroren, Status- und Navigationsleiste immer ausgeblendet, kein Service Worker (alles liegt im Paket).

Lokal: `npm ci`, `npm run apk` (braucht Android SDK und JDK 21) → `android/app/build/outputs/apk/debug/`. `npm run android:open` öffnet Android Studio.

Einmalig für Releases (Repo-Einstellungen → Secrets and variables → Actions):

```sh
keytool -genkeypair -v -keystore release.jks -alias einschlafwoerter -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.jks   # → Secret ANDROID_KEYSTORE_BASE64
keytool -list -v -keystore release.jks | grep SHA256   # → Variable ANDROID_CERT_SHA256
```

Secrets `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`einschlafwoerter`), `ANDROID_KEY_PASSWORD`. Ohne sie baut die Action debug-signierte APKs, veröffentlicht aber nichts. Keystore sicher aufbewahren: ohne ihn lassen sich installierte Apps nicht mehr aktualisieren.

## Lizenz

Copyright © 2026 Sebastian Bruenecke.

| Teil | Lizenz |
|---|---|
| Code (`web/js`, `web/css`, `web/sw.js`, HTML, `android/`, `tools/`, `tests/`), Icons | [GPL-3.0 oder später](LICENSE): Kopien und veränderte Fassungen müssen unter derselben Lizenz offen bleiben |
| Schrift Newsreader `web/fonts/` (selbst ausgeliefert, keine Fremdanbieter) | [SIL OFL 1.1](web/fonts/OFL.txt) |
| Wortlisten `words/*.txt`, Oberflächen- und Info-Texte | [CC BY 4.0](words/LICENSE) |
| Hintergrund-Aufnahmen `web/sounds/*.mp3` | CC BY 4.0 der Urheber, [Nachweis](web/sounds/CREDITS.md) |
| Wort-Clips `web/clips/*.json` (ElevenLabs) | [alle Rechte vorbehalten](web/clips/LICENSE) |

Die Daten (Wortlisten, Aufnahmen, Clips) sind eigenständige Werke neben dem Programm, keine Teile davon; die GPL erfasst sie nicht.
