"""Pack the Cycles bakes into two atlases; runtime uploads each tile as an array layer.
Usage: python3 scripts/assemble-surfaces.py <bake-dir> [output-dir]
No mip can cross from one material to another in the GPU texture array.
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

src = Path(sys.argv[1])
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'src/assets/materials')
out.mkdir(parents=True, exist_ok=True)
meta = json.loads((src / 'tiles.json').read_text())
size = meta['size']

def periodic(a, width=16):
    a = a.astype(np.float32).copy()
    for axis in (0, 1):
        b = np.moveaxis(a, axis, 0)
        for i in range(width):
            t = (1 - i / width) ** 2 * .5
            lo, hi = b[i].copy(), b[-1-i].copy()
            b[i] = lo * (1-t) + hi * t
            b[-1-i] = hi * (1-t) + lo * t
    return np.clip(a, 0, 255).astype(np.uint8)

albedo = Image.new('RGB', (size*4, size*4))
nr = Image.new('RGBA', albedo.size)
for tile in meta['tiles']:
    name, idx = tile['name'], tile['index']
    seam = np.asarray if tile.get('seamless') else periodic
    alb = seam(np.asarray(Image.open(src / f'{name}_albedo.png').convert('RGB')))
    n = seam(np.asarray(Image.open(src / f'{name}_normal.png').convert('RGB')))
    rough = seam(np.asarray(Image.open(src / f'{name}_rough.png').convert('RGB')))[..., 0]
    ao_path = src / f'{name}_ao.png'
    ao = np.asarray(Image.open(ao_path).convert('L')) if ao_path.exists() else np.full((size, size), 255, np.uint8)
    # A normal is a vector, not colour. Renormalize after seam blending.
    v = n.astype(np.float32) / 127.5 - 1
    v /= np.maximum(np.linalg.norm(v, axis=2, keepdims=True), 1e-6)
    packed = np.dstack(((v[..., :2]*.5+.5)*255, rough, np.maximum(ao, 64))).astype(np.uint8)
    xy = (idx % 4 * size, idx // 4 * size)
    albedo.paste(Image.fromarray(alb), xy)
    nr.paste(Image.fromarray(packed), xy)
    s = alb.astype(np.float32)/255
    linear = np.where(s <= .04045, s/12.92, ((s+.055)/1.055)**2.4)
    tile['meanLinear'] = np.round(linear.mean(axis=(0, 1)), 6).tolist()
albedo.save(out / 'surfaces_albedo.webp', quality=94)
nr.save(out / 'surfaces_nr.png', optimize=True)
(out / 'surfaces.json').write_text(json.dumps(meta, indent=2)+'\n')
print(f'{len(meta["tiles"])} surfaces -> {out}')
