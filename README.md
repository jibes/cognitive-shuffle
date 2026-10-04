# Einschlafwörter
`einschlafwoerter.html` aufs Handy kopieren, im Browser öffnen (Brave: Hintergrundwiedergabe erlauben), Dauer antippen, sperren. Tippen = nächstes Wort, lange drücken = beenden.
Neu bauen: `pip install edge-tts numpy` + ffmpeg, dann `python build_clips.py` (Katja); offline: `--engine piper --model de_DE-thorsten-high.onnx`; Azure: `--engine azure` mit `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`.
Wörter in `woerter.txt`, Pegel/Tempo oben in `template.html` (Konstanten); das Build-Protokoll markiert Ausreißer (Dauer, Spitze, fehlende Phoneme).
Die eingecheckte HTML ist mit Piper `de_DE-thorsten-high` (length_scale 1,25) gebaut, weil edge-tts in der Build-Umgebung nicht erreichbar war.
