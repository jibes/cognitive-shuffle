#!/usr/bin/env python3
"""Rendert words/<lang>.txt zu MP3-Clips -> web/clips/<lang>.json ({Wort: base64-MP3}).

Engines (Reihenfolge laut Spezifikation):
  edge   – edge-tts, Katja / Sonia (Neural), rate -20 %, pitch -5 Hz (Standard)
  piper  – Piper offline, z. B. de_DE-thorsten-high.onnx (--model)
  azure  – Azure Speech REST (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)
  google – Google-Übersetzer-Stimme (inoffiziell, ohne Key, kein Tempo-Regler)
  eleven – ElevenLabs v3 (ELEVENLABS_API_KEY), benannte Stimme je Sprache (--speaker),
           Ausgabe web/clips/<lang>-<f|m>.json. Standard: jedes Wort ein Request mit
           Regie-Tag, ganze Antwort getrimmt; --batch 40 = Sätze „A. B. C.“ mit Schnitt an
           Zeitstempeln (billiger). Rohantworten in tools/.cache/eleven/ (nie doppelt zahlen).

Braucht ffmpeg im PATH. Beispiele:
  python tools/build_clips.py --lang de
  python tools/build_clips.py --lang en --engine google
  python tools/build_clips.py --lang de --engine piper --model de_DE-thorsten-high.onnx
  python tools/build_clips.py --lang de --only Würfel,Löffel   # nur diese neu, Rest bleibt
  python tools/build_clips.py --lang de --engine eleven --speaker stefan --count 300
  python tools/build_clips.py --lang en --engine eleven --speaker rainbird --same-as verity  # neue Stimme, gleiche Wörter
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
# Nachgerenderte Ausreißer: {"<lang>-<f|m>": {Wort: seed}}; --only mit --seed trägt hier ein
SEEDS_PATH = ROOT / "tools" / "eleven_seeds.json"
# Ist/Soll je Stimme: {"settings": {Tag: Parameter}, "sets": {"<lang>-<f|m>": {"target": n,
# "words": {Wort: Tag}}}}; Tag = Hash der Render- und Schnitt-Parameter (ohne Seed)
STATUS_PATH = ROOT / "tools" / "clips_status.json"
SR = 24000  # Arbeits- und Ausgaberate der Clips
TRIM_DB = -45.0  # bezogen auf den fertigen Clip (Spitze PEAK_DBFS)
FADE_IN_S = 0.030
TAIL_S = 0.120  # Nachlauf nach dem letzten lauten Fenster: Ausklang nicht kappen
FADE_OUT_S = 0.100  # liegt im Nachlauf, nicht auf dem Wort
STRAY_GAP_S = 0.150  # Lücke, ab der ein Randgeräusch nicht mehr zum Wort gehört
STRAY_DB = 15.0  # … und mindestens so viel leiser als die Spitze ist
PEAK_DBFS = -3.0
BITRATE = "48k"
# Neue Sprache: Eintrag hier, words/<code>.txt und Texte in web/js/i18n.js
LANGS = {
    "de": {"voice": "de-DE-KatjaNeural", "tl": "de", "xml": "de-DE",
           "eleven": {"laura": "Qy4b2JlSGxY7I9M9Bqxb",
                      "stefan": "iMHt6G42evkXunaDU065"}},
    "en": {"voice": "en-GB-SoniaNeural", "tl": "en-GB", "xml": "en-GB",
           "eleven": {"verity": "1hlpeD1ydbI2ow0Tt3EW",
                      "rainbird": "bgU7lBMo69PNEOWHFqxM",
                      "nathaniel": "AeRdCCKzvd23BpJoofzx"}},
}
ELEVEN_DIRECTION = "[calm, measured, slow]"


def load_sections(path):
    """[(Kategorie, [Wörter])] in Dateireihenfolge; „# …“-Zeilen beginnen eine Kategorie."""
    secs, seen = [("", [])], set()
    for line in path.read_text(encoding="utf-8").splitlines():
        w = unicodedata.normalize("NFC", line.strip())
        if w.startswith("#"):
            secs.append((w[1:].strip(), []))
        elif w and w not in seen:
            seen.add(w)
            secs[-1][1].append(w)
    return [s for s in secs if s[1]]


def load_words(path):
    return [w for _, ws in load_sections(path) for w in ws]


def pick_spread(path, n, keep=()):
    """n Wörter gleichmäßig über die Kategorien (anteilig), je Kategorie gleichmäßig verteilt.
    Wörter aus keep bleiben drin und zählen auf die Quote ihrer Kategorie (Aufstocken ohne
    Neurendern). Deterministisch: dieselbe Liste ergibt dieselbe Auswahl."""
    secs = load_sections(path)
    total = sum(len(ws) for _, ws in secs)
    quota = [n * len(ws) / total for _, ws in secs]
    k = [int(q) for q in quota]
    for i in sorted(range(len(secs)), key=lambda i: k[i] - quota[i])[:n - sum(k)]:
        k[i] += 1  # größte Reste

    def spread(ws, m):
        return {ws[int((j + 0.5) * len(ws) / m)] for j in range(m)} if m > 0 else set()

    chosen = set()
    for (_, ws), ki in zip(secs, k):
        free = [w for w in ws if w not in keep]
        chosen |= set(ws) - set(free)
        chosen |= spread(free, min(ki - (len(ws) - len(free)), len(free)))
    # Kategorien, die schon über ihrer Quote liegen, hinterlassen eine Lücke: auffüllen
    chosen |= spread([w for _, ws in secs for w in ws if w not in chosen], n - len(chosen))
    return [w for _, ws in secs for w in ws if w in chosen]


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


def eleven_fetch(voice_id, body, key):
    """Eine Anfrage an /with-timestamps, mit Cache (nie doppelt zahlen) und Nachfassen bei 429/5xx."""
    import time

    tag = hashlib.sha256(json.dumps([voice_id, body], sort_keys=True,
                                    ensure_ascii=False).encode()).hexdigest()[:16]
    cache = CACHE_DIR / f"{tag}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    print(f"  ElevenLabs: {len(body['text'])} Zeichen: {body['text'][:40]!r}", file=sys.stderr)
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
        "?output_format=pcm_24000",
        data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or attempt == 4:
                raise RuntimeError(f"ElevenLabs {e.code}: {e.read()[:300]!r}") from None
            time.sleep(2 ** (attempt + 1))
    cache.write_text(json.dumps({"text": body["text"], **resp}), encoding="utf-8")
    return resp


def eleven_render(words, voice_id, model, lang, speed, stability, seed, batch=1,
                  direction="", conc=3):
    """Liefert {Wort: float32-Array}.

    batch=1: jedes Wort ein Request, ganze Antwort -> nur trimmen (sauberster Schnitt).
    batch>1: Sätze „A. B. C.“, Schnitt an Zeichen-Zeitstempeln (günstiger, Listenintonation).
    direction: Regie-Tag vor dem Text, z. B. „[calm, measured, slow]“ (v3/v4; wird nicht
    gesprochen, aber berechnet). v4 kennt weder speed noch style."""
    from concurrent.futures import ThreadPoolExecutor

    key = os.environ["ELEVENLABS_API_KEY"]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    settings = {"stability": stability, "similarity_boost": 0.75, "use_speaker_boost": True}
    if not model.startswith("eleven_v4"):
        settings.update(style=0.0, speed=speed)
    jobs = []
    for i in range(0, len(words), batch):
        chunk = words[i:i + batch]
        text, spans = (direction + " " if direction else ""), []
        for w in chunk:
            spans.append((len(text), len(text) + len(w)))
            text += w + ". "
        s = seed.get(chunk[0], seed[None]) if isinstance(seed, dict) else seed
        body = {"text": text.rstrip(), "model_id": model, "language_code": lang, "seed": s,
                "voice_settings": settings}
        jobs.append((chunk, spans, body))
    with ThreadPoolExecutor(conc) as pool:  # Starter-Plan: 3 gleichzeitige Anfragen
        resps = list(pool.map(lambda j: eleven_fetch(voice_id, j[2], key), jobs))

    out = {}
    for (chunk, spans, body), resp in zip(jobs, resps):
        pcm = base64.b64decode(resp["audio_base64"])
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        al = resp["alignment"]
        if "".join(al["characters"]) != body["text"]:
            raise RuntimeError(f"Zeitstempel passen nicht zum Text (Batch ab {chunk[0]!r})")
        if len(chunk) == 1:
            out[chunk[0]] = x.copy()
            continue
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
    # Hüllkurve in 10-ms-Fenstern; Schwelle so, als wäre schon auf PEAK_DBFS
    # normalisiert (sonst verlieren leise Wörter mehr Ausklang)
    win = int(SR * 0.010)
    n = len(x) // win
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms) + PEAK_DBFS - 20 * np.log10(np.max(np.abs(x)) + 1e-12)
    loud = np.nonzero(db > TRIM_DB)[0]
    if len(loud) == 0:
        return x
    # Leises, abgesetztes Geräusch am Rand (Atem, Rest des Nachbarworts) verwerfen;
    # kurze Verschlusspausen vor Plosiven (St-, K-) liegen unter STRAY_GAP_S
    runs = np.split(loud, np.nonzero(np.diff(loud) > 1)[0] + 1)
    gap = int(STRAY_GAP_S / 0.010)
    while len(runs) > 1 and runs[1][0] - runs[0][-1] > gap and db[runs[0]].max() < PEAK_DBFS - STRAY_DB:
        runs.pop(0)
    while len(runs) > 1 and runs[-1][0] - runs[-2][-1] > gap and db[runs[-1]].max() < PEAK_DBFS - STRAY_DB:
        runs.pop()
    loud = np.concatenate(runs)
    a = max(0, (loud[0] - 1) * win)  # ein Fenster Luft, Anlaute nicht kappen
    b = min(len(x), (loud[-1] + 1) * win + int(SR * TAIL_S))
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
    ap.add_argument("--eleven-model", default="eleven_v3",
                    help="eleven: z. B. eleven_multilingual_v2")
    ap.add_argument("--speed", type=float, default=0.85, help="eleven: 0.7–1.2")
    ap.add_argument("--stability", type=float, default=1.0, help="eleven: v3 1.0 = „Robust“")
    ap.add_argument("--seed", type=int, default=4242, help="eleven")
    ap.add_argument("--batch", type=int, default=1,
                    help="eleven: Wörter je Request (1 = sauberster Schnitt, >1 billiger)")
    ap.add_argument("--direction", default=ELEVEN_DIRECTION, help="eleven v3/v4: Regie-Tag")
    ap.add_argument("--same-as", help="eleven: genau die Wörter dieser Stimme derselben Sprache (neue Stimme)")
    ap.add_argument("--speaker", choices=sorted({k for c in LANGS.values() for k in c["eleven"]}),
                    help="eleven: Stimme aus LANGS (Standard: erste der Sprache), Ausgabe web/clips/<lang>-<speaker>.json")
    ap.add_argument("--count", type=int, help="nur so viele Wörter, gleichmäßig über die Kategorien")
    ap.add_argument("--only", help="kommagetrennt, nur diese Wörter neu rendern")
    ap.add_argument("--mp3-dir", help="Clips als <Wort>.mp3 hierhin statt in die JSON (Proben)")
    ap.add_argument("--status", action="store_true",
                    help="eleven: Ist/Soll je Stimme aus tools/clips_status.json, rendert nichts")
    a = ap.parse_args()

    if a.status:
        return print_status(a)
    cfg = LANGS[a.lang]
    eleven = a.engine == "eleven"
    speaker = a.speaker or next(iter(cfg["eleven"]))
    if eleven and speaker not in cfg["eleven"]:
        ap.error(f"--speaker {speaker} gibt es für {a.lang} nicht: {', '.join(cfg['eleven'])}")
    voice = a.voice or (cfg["eleven"][speaker] if eleven else cfg["voice"])
    clips_path = CLIPS_DIR / (f"{a.lang}-{speaker}.json" if eleven else f"{a.lang}.json")
    words_path = WORDS_DIR / f"{a.lang}.txt"
    set_id = f"{a.lang}-{speaker}"
    # Ist/Soll führen nur für echte Clip-Sätze (nicht Proben, nicht fremde Stimme, kein Batch)
    track = eleven and not a.mp3_dir and not a.voice and a.batch == 1
    status, old, tag, current = {"settings": {}, "sets": {}}, {}, None, set()
    if track:
        if STATUS_PATH.exists():
            status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
        tag, params = settings_tag(voice, a)
        status["settings"][tag] = params
        if clips_path.exists():
            old = json.loads(clips_path.read_text(encoding="utf-8"))
        have = status["sets"].get(set_id, {}).get("words", {})
        current = {w for w in old if have.get(w) == tag}
    if a.only:
        target = [unicodedata.normalize("NFC", w.strip()) for w in a.only.split(",")]
        words = target
    else:
        if a.same_as:  # neue Stimme: dieselben Wörter wie eine vorhandene derselben Sprache
            other = json.loads((CLIPS_DIR / f"{a.lang}-{a.same_as}.json").read_text(encoding="utf-8"))
            target = [w for w in load_words(words_path) if w in other]
        elif a.count:
            target = pick_spread(words_path, a.count, current)
        else:
            target = load_words(words_path)
        words = [w for w in target if w not in current]  # Rest liegt aktuell vor
    print(f"{len(words)} Wörter ({a.lang}) zu rendern, Engine {a.engine}", file=sys.stderr)

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
        set_id = f"{a.lang}-{speaker}"
        seeds = json.loads(SEEDS_PATH.read_text(encoding="utf-8")) if SEEDS_PATH.exists() else {}
        own = seeds.setdefault(set_id, {})
        if a.only and a.seed != ap.get_default("seed") and not a.voice and a.batch == 1:
            own.update({w: a.seed for w in words})  # Ausreißer: neuer Seed bleibt gültig
            SEEDS_PATH.write_text(json.dumps(seeds, ensure_ascii=False, indent=1, sort_keys=True)
                                  + "\n", encoding="utf-8")
        seed = {None: a.seed, **own} if a.batch == 1 and not a.voice else a.seed
        raw = eleven_render(words, voice, a.eleven_model, a.lang, a.speed,
                            a.stability, seed, a.batch, a.direction)
    else:
        raw = azure_render(words, voice, a.rate, a.pitch, cfg["xml"])

    clips, stats = {}, []
    if track:
        clips = dict(old)
    elif a.only and clips_path.exists() and not a.mp3_dir:
        clips = json.loads(clips_path.read_text(encoding="utf-8"))
    for w in words:
        x = raw[w] if isinstance(raw[w], np.ndarray) else decode(raw[w])
        mp3 = encode_mp3(process(x))
        back = decode(mp3)  # nach MP3 messen, das hört man später
        dur = len(back) / SR
        peak = 20 * np.log10(np.max(np.abs(back)) + 1e-12)
        clips[w] = base64.b64encode(mp3).decode("ascii")
        stats.append((w, dur, peak, len(mp3)))

    med = statistics.median(s[1] for s in stats) if stats else 0.0
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
        clips = {w: clips[w] for w in target}
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    clips_path.write_text(json.dumps(clips, ensure_ascii=False), encoding="utf-8")
    print(f"{clips_path.relative_to(ROOT)}: {clips_path.stat().st_size/1e6:.2f} MB, "
          f"{len(clips)} Wörter", file=sys.stderr)
    if track:
        st = status["sets"].setdefault(set_id, {"target": 0, "words": {}})
        if a.only:
            st["words"].update({w: tag for w in words})
        else:
            st["target"] = len(target)
            st["words"] = {w: tag for w in target}
        st["words"] = {w: st["words"][w] for w in clips if w in st["words"]}
        STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=1, sort_keys=True)
                               + "\n", encoding="utf-8")


def settings_tag(voice, a):
    """Kurzer Hash über alles, was den fertigen Clip bestimmt (außer dem Seed je Wort)."""
    params = {"voice": voice, "model": a.eleven_model, "direction": a.direction,
              "stability": a.stability, "similarity_boost": 0.75, "speed": a.speed,
              "trim_db": TRIM_DB, "tail_s": TAIL_S, "fade_in_s": FADE_IN_S,
              "fade_out_s": FADE_OUT_S, "stray_gap_s": STRAY_GAP_S, "stray_db": STRAY_DB,
              "peak_dbfs": PEAK_DBFS, "bitrate": BITRATE, "sr": SR}
    if a.eleven_model.startswith("eleven_v4"):
        del params["speed"]
    return hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:8], params


def print_status(a):
    """Soll = Zielzahl, Ist = Wörter in der Clip-Datei; aktuell = mit heutigen Einstellungen."""
    status = (json.loads(STATUS_PATH.read_text(encoding="utf-8")) if STATUS_PATH.exists()
              else {"sets": {}})
    print(f"{'Stimme':<12} {'Soll':>5} {'Ist':>5} {'aktuell':>8} {'veraltet':>9} {'fehlt':>6}")
    for lang, cfg in LANGS.items():
        for g, voice in cfg["eleven"].items():
            set_id, path = f"{lang}-{g}", CLIPS_DIR / f"{lang}-{g}.json"  # g = Stimmname
            ist = set(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else set()
            tag, _ = settings_tag(voice, a)
            st = status["sets"].get(set_id, {"target": 0, "words": {}})
            cur = {w for w in ist if st["words"].get(w) == tag}
            print(f"{set_id:<12} {st['target']:>5} {len(ist):>5} {len(cur):>8} "
                  f"{len(ist) - len(cur):>9} {max(0, st['target'] - len(cur)):>6}")


if __name__ == "__main__":
    main()
