#!/usr/bin/env bash
# CC0 surface materials from ambientCG → compact JPGs in src/assets/materials (downloads on the ramdisk).
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=/mnt/ramdisk/spg3d-mat
mkdir -p "$WORK" src/assets/materials
for id in Asphalt031; do
  [ -s "$WORK/$id.zip" ] || curl -sSfL -m 300 -o "$WORK/$id.zip" "https://ambientcg.com/get?file=${id}_1K-JPG.zip"
  unzip -o -q "$WORK/$id.zip" -d "$WORK/$id"
done
node --input-type=module -e "
import sharp from 'sharp';
const W = '$WORK', O = 'src/assets/materials';
const a = (f) => W + '/Asphalt031/Asphalt031_1K-JPG_' + f + '.jpg';
// base asphalt: albedo as luminance (the track tints it), GL normal, roughness at half size
await sharp(a('Color')).greyscale().jpeg({ quality: 84 }).toFile(O + '/asphalt_albedo.jpg');
await sharp(a('NormalGL')).jpeg({ quality: 90 }).toFile(O + '/asphalt_normal.jpg');
await sharp(a('Roughness')).greyscale().resize(512, 512).jpeg({ quality: 88 }).toFile(O + '/asphalt_rough.jpg');
// wet patches: tileable smooth blobs — seeded noise, tiled 3×3, blurred, centre tile cropped
const N = 48, T = 256;
let seed = 20260914;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const cell = Buffer.alloc(N * N);
for (let i = 0; i < cell.length; i++) cell[i] = Math.floor(rnd() * 255);
const tiled = Buffer.alloc(N * 3 * N * 3);
for (let y = 0; y < N * 3; y++) for (let x = 0; x < N * 3; x++) tiled[y * N * 3 + x] = cell[(y % N) * N + (x % N)];
await sharp(tiled, { raw: { width: N * 3, height: N * 3, channels: 1 } })
  .resize(T * 3, T * 3, { kernel: 'cubic' })
  .blur(14)
  .extract({ left: T, top: T, width: T, height: T })
  .normalise()
  .jpeg({ quality: 92 })
  .toFile(O + '/puddles.jpg');
"
ls -la src/assets/materials
