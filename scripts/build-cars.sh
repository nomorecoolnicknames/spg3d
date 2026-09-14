#!/usr/bin/env bash
# Full car pipeline: cars-src → intermediate (wheel-tagged) → Blender (rig, masks, AO, LODs) → atlas packer.
# Outputs src/assets/cars/<model>.glb (LOD1-3: 40k/12k/3k, 1024 atlas) and <model>-hd.glb (LOD0-1: 60k/40k, 2048 atlas).
# Work files live on the ramdisk.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/home/n8n/tools/blender-4.5.13-linux-x64/blender}
WORK=/mnt/ramdisk/spg3d-cars-work
mkdir -p "$WORK/mid" "$WORK/rig" src/assets/cars
node scripts/optimize-glb.mjs --intermediate "$WORK/mid" | grep -E "wheel nodes|MB ->"
cat > "$WORK/specs.ts" <<'TS'
import { CARS } from '../../../home/n8n/gamers/spg3d/src/data/cars';
console.log(JSON.stringify(CARS.map((c) => ({ model: c.model, paint: c.paintMaterials, length: c.length }))));
TS
npx esbuild "$WORK/specs.ts" --bundle --platform=node --format=esm --log-level=warning --alias:@=./src --outfile="$WORK/specs.mjs"
node "$WORK/specs.mjs" > "$WORK/specs.json"
N=$(node -e "console.log(require('$WORK/specs.json').length)")
for i in $(seq ${FROM:-0} $((N - 1))); do
  SPEC=$(node -e "const s=require('$WORK/specs.json')[$i]; console.log(JSON.stringify({...s, aoSamples: 32}))")
  MODEL=$(node -e "console.log(require('$WORK/specs.json')[$i].model)")
  echo "── $MODEL"
  nice -n 5 "$BLENDER" -b --factory-startup -P scripts/bake-cars.py -- "$WORK/mid/$MODEL.glb" "$WORK/rig" "$SPEC" > "$WORK/rig/$MODEL.log" 2>&1
  grep -E "BAKE_OK|Traceback|Error" "$WORK/rig/$MODEL.log" | cut -c1-200
  node scripts/atlas-cars.mjs "$WORK/rig/$MODEL.rig.glb" "src/assets/cars/$MODEL.glb" "$(node -e "console.log(JSON.stringify({...JSON.parse(process.argv[1]), atlas: 1024, lods: [1,2,3], debugDir: '$WORK/rig'}))" "$SPEC")" | grep ATLAS_OK
  node scripts/atlas-cars.mjs "$WORK/rig/$MODEL.rig.glb" "src/assets/cars/$MODEL-hd.glb" "$(node -e "console.log(JSON.stringify({...JSON.parse(process.argv[1]), atlas: 2048, lods: [0,1]}))" "$SPEC")" | grep ATLAS_OK
done
ls -la src/assets/cars | awk '{print $5, $9}'
