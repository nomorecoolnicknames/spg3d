#!/usr/bin/env bash
# CC0 HDRIs from Poly Haven → downscaled Radiance .hdr in src/assets/env (reflections / IBL only;
# the visible sky stays our own dome). Downloads and Blender work happen on the ramdisk.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/home/n8n/tools/blender-4.5.13-linux-x64/blender}
WORK=/mnt/ramdisk/spg3d-env
mkdir -p "$WORK" src/assets/env
# name:polyhaven-id:width
MAPS="neon:shanghai_bund:512 canyon:spruit_sunrise:512 aurora:kloppenheim_02:512 boss:neuer_zollhof:512 garage:studio_small_09:512 day:potsdamer_platz:512"
for m in $MAPS; do
  IFS=: read -r name id width <<<"$m"
  src="$WORK/$id-1k.hdr"
  [ -s "$src" ] || curl -sSfL -m 120 -o "$src" "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr"
  "$BLENDER" -b --factory-startup --python-expr "
import bpy
img = bpy.data.images.load('$src')
img.scale($width, $width // 2)
img.filepath_raw = '$PWD/src/assets/env/$name.hdr'
img.file_format = 'HDR'
img.save()
print('ENV_OK $name', img.size[:])
" 2>&1 | grep -E "ENV_OK|Error"
done
ls -la src/assets/env
