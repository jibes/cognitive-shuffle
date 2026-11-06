# Ausgemusterte Stimmen

Bezahlte Aufnahmen, die die App nicht mehr ausliefert. Liegen hier, damit nichts verloren geht;
`tools/build_clips.py` rendert diese Stimmen nicht mehr.

| Datei | Stimme (ElevenLabs) | Ausgemustert | Wörter |
|---|---|---|---|
| `en-verity.json` | Verity, `1hlpeD1ydbI2ow0Tt3EW` | 2026-11 | 399 |

Zurückholen: Datei nach `web/clips/` verschieben, Stimme in `VOICES` (`web/js/i18n.js`) und `LANGS` (`tools/build_clips.py`) eintragen.

## Mehrteilige Wörter, lange Pause (2026-11)

Englische Wörter wie „tree root“ hatten teils lange Pausen zwischen den Teilen (bis 0,8 s). Bindestrich im Text
(„tree-root“) half im Mittel nicht: die Pause schwankt von Take zu Take mehr als mit der Schreibweise. Lösung:
dieselben Wörter mit anderem Seed neu aufnehmen, den Take mit der kürzeren Pause behalten (Seeds in
`tools/eleven_seeds.json`), ohne Schnitt im Wort.

| Datei | Inhalt |
|---|---|
| `en-rainbird-spaced.json` | Rainbirds 183 mehrteilige Wörter, erste Aufnahmen |
| `en-rainbird-hyphen.json` | Dieselben 183 mit Bindestrich aufgenommen, nicht verwendet |
| `en-nathaniel-replaced.json` | Nathaniels 16 ersetzte erste Aufnahmen |
