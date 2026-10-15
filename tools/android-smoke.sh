#!/usr/bin/env bash
# Rauchtest der Android-App im Emulator (CI: .github/workflows/android.yml, Job smoke).
# Startet die App, tippt „Start“, sperrt den Bildschirm und prüft danach:
#   - der Vordergrund-Dienst läuft (Wiedergabe überlebt die Sperre),
#   - der Prozess lebt noch,
#   - die Web-App hat keinen Fehler in die Konsole geschrieben (logcat-Tag Capacitor/Console).
# Aufruf: tools/android-smoke.sh <apk> ; erwartet ein laufendes Gerät (adb).
set -euo pipefail

APK=$1
PKG=ch.brunodev.sleepwords
OUT=${SMOKE_OUT:-smoke-out}
mkdir -p "$OUT"

fail() {
  echo "::error::$*"
  adb exec-out screencap -p > "$OUT/screen.png" || true
  adb logcat -d > "$OUT/logcat.txt" || true
  # Auch ins Log, falls das Artefakt nicht erreichbar ist
  echo "--- Texte im Bedienungshilfen-Baum"
  grep -o -E '(text|content-desc|class)="[^"]+"' "$OUT/ui.xml" 2>/dev/null | sort | uniq -c | head -40 || true
  echo "--- logcat (App)"
  grep -E "Capacitor|chromium|einschlaf|FATAL" "$OUT/logcat.txt" | tail -40 || true
  exit 1
}

# Knopf mit genau diesem Text aus dem Bedienungshilfen-Baum; gibt die Mitte als "x y" aus
center_of() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null
  adb exec-out cat /sdcard/ui.xml > "$OUT/ui.xml"
  python3 - "$OUT/ui.xml" "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
for n in ET.parse(sys.argv[1]).iter("node"):
    if sys.argv[2].lower() in ((n.get("text") or "").strip().lower(), (n.get("content-desc") or "").strip().lower()):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
}

adb logcat -c
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
# Einmaliger System-Hinweis „Viewing full screen“ (wegen der ausgeblendeten Leisten) würde die App verdecken
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell am start -W -n "$PKG/.MainActivity"

xy=""
for _ in $(seq 30); do
  xy=$(center_of Start || true)
  [ -n "$xy" ] && break
  sleep 2
done
[ -n "$xy" ] || fail "Start-Knopf nicht gefunden"
pid=$(adb shell pidof "$PKG")
adb shell input tap $xy

# Vorbereitung (Mischen) braucht im Emulator etwas; Dienst muss sofort laufen
sleep 5
adb shell dumpsys activity services "$PKG" | grep -q "PlaybackService" || fail "PlaybackService läuft nicht"
adb shell dumpsys activity services "$PKG" | grep -q "isForeground=true" || fail "PlaybackService nicht im Vordergrund"

adb shell input keyevent KEYCODE_SLEEP
sleep 30
[ "$(adb shell pidof "$PKG")" = "$pid" ] || fail "Prozess nach Bildschirmsperre beendet"
adb shell dumpsys activity services "$PKG" | grep -q "isForeground=true" || fail "Dienst nach Bildschirmsperre weg"

adb logcat -d > "$OUT/logcat.txt"
if grep -E "Capacitor/Console.*(Uncaught|Error|error)" "$OUT/logcat.txt"; then
  fail "Fehler der Web-App in logcat"
fi
adb shell input keyevent KEYCODE_WAKEUP
echo "Rauchtest ok"
