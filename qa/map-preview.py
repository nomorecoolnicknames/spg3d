#!/usr/bin/env python3
"""Top-down render of a generated real-place map (src/data/maps/<id>.{route,world}.json).

    python3 qa/map-preview.py <mapId> [out.png] [--zoom cx cz radius]

Draws ground/water sectors, parks, streets, buildings (brightness = height), the race corridor with
distance marks every 200 m, and the waypoints from scripts/osm-maps.config.mjs (numbered).
"""
import json, math, os, re, sys
from PIL import Image, ImageDraw, ImageFont

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mid = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else f'/mnt/ramdisk/spg3d-osm/{mid}-map.png'
route = json.load(open(f'{root}/src/data/maps/{mid}.route.json'))
world = json.load(open(f'{root}/src/data/maps/{mid}.world.json'))
b = world['bounds']
if '--zoom' in sys.argv:
    i = sys.argv.index('--zoom')
    cx, cz, r = (float(v) for v in sys.argv[i + 1:i + 4])
    x0, z0, x1, z1 = cx - r, cz - r, cx + r, cz + r
else:
    x0, z0, x1, z1 = b
S = 1800
sc = S / max(x1 - x0, z1 - z0)
I = lambda x, z: ((x - x0) * sc, (z - z0) * sc)
D = lambda v: v / 10
img = Image.new('RGB', (S, S), (58, 56, 52))
dr = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except OSError:
    font = ImageFont.load_default()


def ring(flat):
    return [I(D(flat[k]), D(flat[k + 1])) for k in range(0, len(flat), 2)]


SEC = world['sector']
for sx, sz, polys in world['water']:
    for poly in polys:
        dr.polygon(ring(poly[0]), fill=(30, 60, 105))
for sx, sz, polys in world['ground']:
    dr.rectangle([I(sx * SEC, sz * SEC), I((sx + 1) * SEC, (sz + 1) * SEC)], fill=(30, 60, 105))
    for poly in polys:
        dr.polygon(ring(poly[0]), fill=(58, 56, 52))
        for h in poly[1:]:
            dr.polygon(ring(h), fill=(30, 60, 105))
AREA_COL = {1: (44, 74, 44), 2: (90, 88, 82), 3: (70, 62, 55)}
for a in world['areas']:
    dr.polygon(ring(a[1]), fill=AREA_COL.get(a[0], (80, 80, 80)))
for kind, w, flags, pts in world['roads']:
    col = (205, 90, 200) if flags & 1 else (32, 32, 36) if kind <= 4 else (120, 118, 110)
    dr.line(ring(pts), fill=col, width=max(1, int(D(w) * sc)))
for kind, bridge, pts in world['rails']:
    dr.line(ring(pts), fill=(230, 70, 70) if kind == 0 else (200, 120, 255), width=2)
for bl in world['buildings']:
    h = D(bl[0])
    v = int(min(235, 110 + h * 2.2))
    col = (255, 120, 60) if bl[6] else (v, v - 12, v - 28)
    dr.polygon(ring(bl[8]), fill=col, outline=(30, 30, 30))
pts = route['points']
W = world['roadWidth']
dr.line([I(p[0], p[1]) for p in pts] + [I(pts[0][0], pts[0][1])], fill=(255, 210, 40), width=max(2, int((W + 3.6) * sc)))
dr.line([I(p[0], p[1]) for p in pts] + [I(pts[0][0], pts[0][1])], fill=(255, 40, 40), width=2)
acc = 0
mark = 0
for i in range(len(pts)):
    if acc >= mark:
        x, y = I(pts[i][0], pts[i][1])
        dr.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(255, 255, 255))
        dr.text((x + 7, y - 8), f'{mark}' + (f' y{pts[i][2]}' if pts[i][2] else ''), fill=(255, 255, 255), font=font)
        mark += 200
    j = (i + 1) % len(pts)
    acc += math.dist(pts[i][:2], pts[j][:2])
x, y = I(pts[0][0], pts[0][1])
dr.rectangle((x - 9, y - 9, x + 9, y + 9), outline=(0, 255, 120), width=3)
cfg = open(f'{root}/scripts/osm-maps.config.mjs').read()
block = cfg[cfg.index(f'  {mid}: {{'):]
block = block[:block.index('\n  },')]
for k, m in enumerate(re.finditer(r'near: \[(-?[\d.]+), (-?[\d.]+)\]', block)):
    x, y = I(float(m.group(1)), float(m.group(2)))
    dr.ellipse((x - 7, y - 7, x + 7, y + 7), outline=(0, 255, 255), width=3)
    dr.text((x + 9, y + 2), str(k), fill=(0, 255, 255), font=font)
img.save(out)
print(out, f'lap {route["length"]} m, {len(world["buildings"])} buildings')
