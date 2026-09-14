#!/usr/bin/env bash
# Landmark models (scripts/blender/landmarks.py) → src/assets/landmarks/landmarks.glb (meshopt-compressed).
# Build output goes to the ramdisk; only the final GLB lands in the source tree.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/home/n8n/tools/blender-4.5.13-linux-x64/blender}
OUT=${OUT_DIR:-/mnt/ramdisk/out-spg3d-landmarks}
mkdir -p "$OUT" src/assets/landmarks
"$BLENDER" -b --factory-startup -P scripts/blender/landmarks.py -- "$OUT/landmarks.raw.glb" 2>&1 | grep -E '^landmarks:|Error' || true
npx gltf-transform dedup "$OUT/landmarks.raw.glb" "$OUT/landmarks.dedup.glb" >/dev/null
npx gltf-transform meshopt "$OUT/landmarks.dedup.glb" src/assets/landmarks/landmarks.glb >/dev/null
ls -l "$OUT/landmarks.raw.glb" src/assets/landmarks/landmarks.glb
