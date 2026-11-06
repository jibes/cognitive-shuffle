# Ausgemusterte Stimmen

Bezahlte Aufnahmen, die die App nicht mehr ausliefert. Liegen hier, damit nichts verloren geht;
`tools/build_clips.py` rendert diese Stimmen nicht mehr.

| Datei | Stimme (ElevenLabs) | Ausgemustert | Wörter |
|---|---|---|---|
| `en-verity.json` | Verity, `1hlpeD1ydbI2ow0Tt3EW` | 2026-11 | 399 |

Zurückholen: Datei nach `web/clips/` verschieben, Stimme in `VOICES` (`web/js/i18n.js`) und `LANGS` (`tools/build_clips.py`) eintragen.
