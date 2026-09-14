#!/usr/bin/env bash
# Real-device benchmark via the devbox (phone on USB of pc-00007533-1):
#   installs the APK, starts the 90 s benchmark race through an intent extra,
#   samples battery temperature + thermal status every 10 s, grabs screenshots,
#   and pulls the [SPG-PERF] lines the game writes to logcat.
# Usage: qa/device-run.sh [track=neon] [seconds=90] [serial]
set -euo pipefail
cd "$(dirname "$0")/.."
D=/home/n8n/.claude/skills/devbox/scripts/dev.sh
TRACK=${1:-neon}
DUR=${2:-90}
SERIAL=${3:-$($D adb devices | awk 'NR>1 && $2=="device"{print $1; exit}')}
[ -n "$SERIAL" ] || { echo "no phone attached to the devbox"; exit 2; }
APK=$(ls -t release/spg3d-*-release.apk | head -1)
OUT=/mnt/ramdisk/spg-device/$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
A="$D adb -s $SERIAL"
echo "device: $($A shell getprop ro.product.model) / $($A shell getprop ro.build.display.id)" | tee "$OUT/device.txt"
$D push "$APK" /tmp/spg3d.apk
$A install -r /tmp/spg3d.apk
$A logcat -c
$A shell am force-stop ru.spg3d.game
$A shell am start -n ru.spg3d.game/.MainActivity --es spg_query "?bench=$TRACK\&dur=$DUR"
for i in $(seq 0 10 $((DUR + 30))); do
  T=$($A shell dumpsys battery | awk -F': ' '/temperature/{print $2/10}')
  TH=$($A shell dumpsys thermalservice | awk -F': ' '/Thermal Status/{print $2; exit}')
  echo "$i s battery=${T}C thermal=${TH}" | tee -a "$OUT/thermal.txt"
  if [ $((i % 30)) -eq 0 ]; then
    $A shell screencap -p /sdcard/spg-$i.png && $D "adb -s $SERIAL pull /sdcard/spg-$i.png /tmp/spg-$i.png" && $D pull /tmp/spg-$i.png "$OUT/shot-$i.png" || true
  fi
  sleep 10
done
$A logcat -d -s Capacitor/Console:* chromium:* | grep -E 'SPG-PERF' > "$OUT/perf.log" || true
grep -c 'SPG-PERF\]' "$OUT/perf.log" | xargs echo "samples:"
grep 'SPG-PERF-REPORT' "$OUT/perf.log" | tail -1 | sed 's/.*SPG-PERF-REPORT\] //' > "$OUT/report.json" || true
echo "results → $OUT"
