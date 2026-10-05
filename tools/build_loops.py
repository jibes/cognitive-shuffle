#!/usr/bin/env python3
"""Hintergrund-Aufnahmen -> web/sounds/<name>.mp3 (mono, 24 kHz, 64 kbit/s).

Die App spielt sie in Schleife und überblendet die Nahtstelle selbst (web/js/ambient.js);
Pegel eicht sie zur Laufzeit. Hier nur Format, kein Filter, keine Pegeländerung.
Quellen und Lizenzen: web/sounds/CREDITS.md (bei neuen Klängen dort ergänzen).

  python tools/build_loops.py --src ../blanket/data/resources/sounds
"""

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "sounds"
LOOPS = {"rain": "rain.ogg", "waves": "waves.ogg"}  # Blanket, data/resources/sounds
BITRATE = "64k"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="Ordner mit den Ausgangsdateien")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, file in LOOPS.items():
        dst = OUT / f"{name}.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(Path(a.src) / file),
                        "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", BITRATE,
                        "-map_metadata", "-1", str(dst)], check=True)
        print(f"{dst.relative_to(ROOT)}: {dst.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
