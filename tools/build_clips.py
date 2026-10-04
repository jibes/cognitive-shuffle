#!/usr/bin/env python3
"""Rendert words/<lang>.txt zu MP3-Clips -> web/clips/<lang>.json ({Wort: base64-MP3}).

Engines (Reihenfolge laut Spezifikation):
  edge   – edge-tts, Katja / Sonia (Neural), rate -20 %, pitch -5 Hz (Standard)
  piper  – Piper offline, z. B. de_DE-thorsten-high.onnx (--model)
  azure  – Azure Speech REST (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)
  google – Google-Übersetzer-Stimme (inoffiziell, ohne Key, kein Tempo-Regler)
  eleven – ElevenLabs (ELEVENLABS_API_KEY): ~40 Wörter je Request als „A. B. C.“,
           Schnitt an Zeichen-Zeitstempeln -> natürliche fallende Intonation.
           Rohantworten in tools/.cache/eleven/ (nie doppelt zahlen).

Braucht ffmpeg im PATH. Beispiele:
  python tools/build_clips.py --lang de
  python tools/build_clips.py --lang en --engine google
  python tools/build_clips.py --lang de --engine piper --model de_DE-thorsten-high.onnx
  python tools/build_clips.py --lang de --only Würfel,Löffel   # nur diese neu, Rest bleibt
  python tools/build_clips.py --lang de --engine eleven --voice <voice_id> \
      --only Würfel,Löffel --mp3-dir /tmp/probe   # Stimmprobe, Clips-Datei bleibt
"""

import argparse
import asyncio
import base64
import hashlib
import json
import os
import statistics
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORDS_DIR = ROOT / "words"
CLIPS_DIR = ROOT / "web" / "clips"
CACHE_DIR = ROOT / "tools" / ".cache" / "eleven"
SR = 24000  # Arbeits- und Ausgaberate der Clips
TRIM_DB = -45.0
FADE_IN_S = 0.030
FADE_OUT_S = 0.040  # gegen Knacken am Clipende
PEAK_DBFS = -3.0
BITRATE = "48k"
# Neue Sprache: Eintrag hier, words/<code>.txt und Texte in web/js/i18n.js
LANGS = {
    "de": {"voice": "de-DE-KatjaNeural", "tl": "de", "xml": "de-DE", "eleven": None},
    "en": {"voice": "en-GB-SoniaNeural", "tl": "en-GB", "xml": "en-GB", "eleven": None},
}


def load_words(path):
    words = []
    for line in path.read_text(encoding="utf-8").splitlines():
        w = unicodedata.normalize("NFC", line.strip())
        if w and not w.startswith("#") and w not in words:
            words.append(w)
    return words


# ---------- Engines: liefern rohe Audiobytes (beliebiges Format, ffmpeg dekodiert) ----------

async def edge_render(words, voice, rate, pitch, conc=4):
    import edge_tts

    sem = asyncio.Semaphore(conc)
    out = {}

    async def one(w):
        async with sem:
            err = "leere Antwort"
            for attempt in range(4):
                try:
                    buf = bytearray()
                    comm = edge_tts.Communicate(w, voice, rate=rate, pitch=pitch)
                    async for chunk in comm.stream():
                        if chunk["type"] == "audio":
                            buf += chunk["data"]
                    if buf:
                        out[w] = bytes(buf)
                        return
                except Exception as e:  # inoffizieller Dienst: nachfassen
                    err = e
                await asyncio.sleep(2 ** attempt)
            raise RuntimeError(f"edge-tts scheitert bei {w!r}: {err}")

    await asyncio.gather(*(one(w) for w in words))
    return out


def piper_render(words, model, length_scale, speaker=None):
    import io
    import wave

    from piper import PiperVoice, SynthesisConfig

    voice = PiperVoice.load(model)
    id_map = voice.config.phoneme_id_map
    orig = voice.phonemize

    # Piper >= 1.8 zerlegt Phoneme per NFD ("ç" -> "c" + U+0327). Alte Modelle
    # kennen nur das zusammengesetzte Zeichen -> wieder zusammenfügen.
    def phonemize_nfc(text):
        fixed = []
        for sent in orig(text):
            s = []
            for ph in sent:
                if s and unicodedata.combining(ph):
                    comp = unicodedata.normalize("NFC", s[-1] + ph)
                    if len(comp) == 1 and comp in id_map:
                        s[-1] = comp
                        continue
                s.append(ph)
            fixed.append(s)
        return fixed

    voice.phonemize = phonemize_nfc
    cfg = SynthesisConfig(speaker_id=speaker, length_scale=length_scale)
    out, missing = {}, {}
    for w in words:
        miss = {p for s in voice.phonemize(w) for p in s if p not in id_map}
        if miss:
            missing[w] = "".join(sorted(miss))
        bio = io.BytesIO()
        with wave.open(bio, "wb") as f:
            voice.synthesize_wav(w, f, syn_config=cfg)
        out[w] = bio.getvalue()
    return out, missing


def google_render(words, tl):
    import time
    import urllib.parse

    out = {}
    for w in words:
        url = ("https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx"
               "&tl=" + tl + "&q=" + urllib.parse.quote(w))
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    out[w] = r.read()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
        time.sleep(0.2)  # inoffizieller Dienst: nicht drängeln
    return out


def azure_render(words, voice, rate, pitch, xml_lang):
    key = os.environ["AZURE_SPEECH_KEY"]
    region = os.environ["AZURE_SPEECH_REGION"]
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    out = {}
    for w in words:
        ssml = (
            '<speak version="1.0" xml:lang="%s"><voice name="%s">'
            '<prosody rate="%s" pitch="%s">%s</prosody></voice></speak>'
            % (xml_lang, voice, rate, pitch, w.replace("&", "&amp;").replace("<", "&lt;"))
        )
        req = urllib.request.Request(url, data=ssml.encode(), headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "einschlafwoerter",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            out[w] = r.read()
    return out


def eleven_render(words, voice_id, model, lang, speed, stability, seed, batch=40):
    """Liefert {Wort: float32-Array}; schneidet Sätze „A. B. C.“ an Zeitstempeln."""
    key = os.environ["ELEVENLABS_API_KEY"]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = {}
    for i in range(0, len(words), batch):
        chunk = words[i:i + batch]
        text, spans = "", []
        for w in chunk:
            spans.append((len(text), len(text) + len(w)))
            text += w + ". "
        text = text.rstrip()
        body = {"text": text, "model_id": model, "language_code": lang, "seed": seed,
                "voice_settings": {"stability": stability, "similarity_boost": 0.75,
                                   "style": 0.0, "use_speaker_boost": True,
                                   "speed": speed}}
        tag = hashlib.sha256(json.dumps([voice_id, body], sort_keys=True,
                                        ensure_ascii=False).encode()).hexdigest()[:16]
        cache = CACHE_DIR / f"{tag}.json"
        if cache.exists():
            resp = json.loads(cache.read_text(encoding="utf-8"))
        else:
            print(f"  ElevenLabs: {len(chunk)} Wörter, {len(text)} Zeichen", file=sys.stderr)
            req = urllib.request.Request(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
                "?output_format=pcm_24000",
                data=json.dumps(body).encode(), method="POST",
                headers={"xi-api-key": key, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    resp = json.loads(r.read())
            except urllib.error.HTTPError as e:
                raise RuntimeError(f"ElevenLabs {e.code}: {e.read()[:300]!r}") from None
            cache.write_text(json.dumps({"text": text, **resp}), encoding="utf-8")
        pcm = base64.b64decode(resp["audio_base64"])
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        al = resp["alignment"]
        if "".join(al["characters"]) != text:
            raise RuntimeError(f"Zeitstempel passen nicht zum Text (Batch ab {chunk[0]!r})")
        t0, t1 = al["character_start_times_seconds"], al["character_end_times_seconds"]
        bounds = [(t0[a], t1[b - 1]) for a, b in spans]
        end_all = len(x) / SR
        for j, (w, (s, e)) in enumerate(zip(chunk, bounds)):
            # Rand vorn/hinten, aber höchstens bis zur Mitte der Lücke zum Nachbarwort
            prev_e = bounds[j - 1][1] if j else 0.0
            next_s = bounds[j + 1][0] if j + 1 < len(bounds) else end_all
            lo = max(s - 0.10, (prev_e + s) / 2)
            hi = min(e + 0.35, (e + next_s) / 2)
            out[w] = x[int(lo * SR):int(hi * SR)].copy()
    return out


# ---------- Signalverarbeitung ----------

def decode(raw):
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "pipe:1"],
        input=raw, capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def encode_mp3(x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1",
         "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", BITRATE, "-ar", str(SR),
         "-ac", "1", "-f", "mp3", "pipe:1"],
        input=pcm, capture_output=True, check=True)
    return p.stdout


def trim(x):
    # Hüllkurve in 10-ms-Fenstern; Schwelle relativ zu 0 dBFS
    win = int(SR * 0.010)
    n = len(x) // win
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    loud = np.nonzero(20 * np.log10(rms) > TRIM_DB)[0]
    if len(loud) == 0:
        return x
    a = max(0, (loud[0] - 1) * win)  # ein Fenster Luft, Anlaute nicht kappen
    b = min(len(x), (loud[-1] + 2) * win)
    return x[a:b]


def process(x):
    x = trim(x - np.mean(x))
    fi, fo = int(SR * FADE_IN_S), int(SR * FADE_OUT_S)
    x[:fi] *= np.linspace(0, 1, fi, endpoint=False)
    x[-fo:] *= np.linspace(1, 0, fo)
    peak = np.max(np.abs(x)) or 1.0
    return x * (10 ** (PEAK_DBFS / 20) / peak)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lang", choices=list(LANGS), default="de")
    ap.add_argument("--engine", choices=["edge", "piper", "azure", "google", "eleven"],
                    default="edge")
    ap.add_argument("--voice", help="Standard je Sprache, siehe LANGS")
    ap.add_argument("--rate", default="-20%", help="edge/azure")
    ap.add_argument("--pitch", default="-5Hz", help="edge/azure")
    ap.add_argument("--model", help="piper: Pfad zur .onnx")
    ap.add_argument("--length-scale", type=float, default=1.25,
                    help="piper: >1 = langsamer")
    ap.add_argument("--eleven-model", default="eleven_multilingual_v2",
                    help="eleven: z. B. eleven_v3")
    ap.add_argument("--speed", type=float, default=0.85, help="eleven: 0.7–1.2")
    ap.add_argument("--stability", type=float, default=0.75, help="eleven")
    ap.add_argument("--seed", type=int, default=4242, help="eleven")
    ap.add_argument("--batch", type=int, default=40, help="eleven: Wörter je Request")
    ap.add_argument("--only", help="kommagetrennt, nur diese Wörter neu rendern")
    ap.add_argument("--mp3-dir", help="Clips als <Wort>.mp3 hierhin statt in die JSON (Proben)")
    a = ap.parse_args()

    cfg = LANGS[a.lang]
    voice = a.voice or cfg["eleven" if a.engine == "eleven" else "voice"]
    if not voice:
        ap.error("--voice fehlt (ElevenLabs-voice_id)")
    clips_path = CLIPS_DIR / f"{a.lang}.json"
    words = load_words(WORDS_DIR / f"{a.lang}.txt")
    if a.only:
        words = [unicodedata.normalize("NFC", w.strip()) for w in a.only.split(",")]
    print(f"{len(words)} Wörter ({a.lang}), Engine {a.engine}", file=sys.stderr)

    missing = {}
    if a.engine == "edge":
        raw = asyncio.run(edge_render(words, voice, a.rate, a.pitch))
    elif a.engine == "piper":
        if not a.model:
            ap.error("--model fehlt")
        raw, missing = piper_render(words, a.model, a.length_scale)
    elif a.engine == "google":
        raw = google_render(words, cfg["tl"])
    elif a.engine == "eleven":
        raw = eleven_render(words, voice, a.eleven_model, a.lang, a.speed,
                            a.stability, a.seed, a.batch)
    else:
        raw = azure_render(words, voice, a.rate, a.pitch, cfg["xml"])

    clips, stats = {}, []
    if a.only and clips_path.exists() and not a.mp3_dir:
        clips = json.loads(clips_path.read_text(encoding="utf-8"))
    for w in words:
        x = raw[w] if isinstance(raw[w], np.ndarray) else decode(raw[w])
        mp3 = encode_mp3(process(x))
        back = decode(mp3)  # nach MP3 messen, das hört man später
        dur = len(back) / SR
        peak = 20 * np.log10(np.max(np.abs(back)) + 1e-12)
        clips[w] = base64.b64encode(mp3).decode("ascii")
        stats.append((w, dur, peak, len(mp3)))

    med = statistics.median(s[1] for s in stats)
    flagged = 0
    for w, dur, peak, size in stats:
        why = []
        if dur > 2 * med or dur > 3.0:
            why.append("lang")
        if dur < 0.4 * med:
            why.append("kurz")
        if peak > -0.5:
            why.append("Spitze")
        if w in missing:
            why.append(f"Phonem fehlt: {missing[w]}")
        flagged += bool(why)
        print(f"{w:<22} {dur:5.2f} s {peak:6.1f} dBFS {size/1024:5.1f} KB"
              + (f"   <-- {', '.join(why)}" if why else ""))
    total = sum(s[3] for s in stats)
    print(f"\nMedian {med:.2f} s, {total/1e6:.2f} MB MP3, {flagged} markiert",
          file=sys.stderr)

    if a.mp3_dir:
        d = Path(a.mp3_dir)
        d.mkdir(parents=True, exist_ok=True)
        for w in words:
            (d / f"{w}.mp3").write_bytes(base64.b64decode(clips[w]))
        print(f"{len(words)} MP3 in {d}", file=sys.stderr)
        return
    if not a.only:  # Reihenfolge der Liste, entfernte Wörter fallen weg
        clips = {w: clips[w] for w in words}
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    clips_path.write_text(json.dumps(clips, ensure_ascii=False), encoding="utf-8")
    print(f"{clips_path.relative_to(ROOT)}: {clips_path.stat().st_size/1e6:.2f} MB, "
          f"{len(clips)} Wörter", file=sys.stderr)


if __name__ == "__main__":
    main()
