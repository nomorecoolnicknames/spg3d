"""Brick facade kit (docs/KITS.md §2), built headless in Blender and exported as one GLB plus its manifest.

    blender -b --factory-startup -P scripts/blender/kits/brick.py -- src/assets/kits/brick.glb [--preview docs/kits/brick.png]

Two families share the kit:
  house      brick apartment houses of 4–9 floors (khrushchyovka 1-447 and the later brick series, silicate or red
             brick): windows with concrete lintels and sills, small balconies (open railing or glazed by the
             residents), staircase windows at mid-landing height, porch with a canopy, shop cut into the ground
             floor, basement vents in the plinth, corbelled cornice with a coping, corners with quoins
  warehouse  `wh_*` — red-brick 19th-century railway depots (Ligovsky 50): segmental arched windows in brick
             arch rings between pilaster strips, a big arched gate with steel leaves and stone wheel guards,
             stepped brick cornice, corner pilasters

Every module is one mesh object `brick__<module>` at the origin, X along the facade 0…W, Z up 0…H, wall plane
Y = 0, street at −Y. Brick is suggested by depth only — floor belts, plinths, corbel steps, pilasters, arch rings
and deep reveals — never by per-brick geometry. The GLB carries a single `wall` material (silicate white); the game
tints it per building, the preview paints the depot red. The manifest records the real triangle counts.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
DEBUG_BACKFACES = '--debug-backfaces' in argv
positional = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] != '--preview')]
OUT = positional[0] if positional else '/mnt/ramdisk/kits-brick/brick.glb'
SCRATCH = '/mnt/ramdisk/kits-brick'

KIT = 'brick'
BAY, FLOOR, GROUND, CAP, CORNER = 3.2, 3.0, 3.3, 0.8, 0.45
BUDGET = {'floor': 90, 'stair': 90, 'blank': 90, 'ground': 150, 'entrance': 150, 'shop': 150, 'cap': 40, 'corner': 24}
EPS = 1e-6

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ───────────────────────── materials ─────────────────────────

def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


PALETTE = {                    # name: (albedo, roughness, metallic)
    'wall': ('#c9c2b5', 0.9, 0.0),     # silicate brick; tinted per building (the depots get red brick #8e4a38)
    'wall2': ('#a39b90', 0.9, 0.0),    # belts, plinths, quoins, arch rings — tinted darker
    'trim': ('#cdc9bf', 0.85, 0.0),    # concrete lintels, sills, slabs, porch, wheel guards
    'glass': ('#3b4a57', 0.08, 0.0),
    'frame': ('#e8e6e0', 0.5, 0.0),
    'metal': ('#4d535a', 0.45, 0.7),   # railings, posts, visors, steel doors and gates
    'roof': ('#4a4c50', 0.6, 0.3),     # copings
    'dark': ('#1b1c1e', 1.0, 0.0),     # vents, gate recess
    'sign': ('#2d5fa0', 0.4, 0.0),     # shop sign band, blade sign, house number plate
}
MAT = {}
for name, (color, rough, metal) in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(color), 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    MAT[name] = m


# ───────────────────────── module mesh builder ─────────────────────────

def solid_rects(x0, x1, z0, z1, holes):
    """Rectangles covering [x0,x1]×[z0,z1] minus the holes: cut into rows at every hole edge, identical spans of
    consecutive rows merged; the transposed cut is tried as well and the one with fewer pieces wins."""
    def cut(a0, a1, b0, b1, hs):
        bs = sorted({b0, b1} | {v for h in hs for v in (h[2], h[3]) if b0 < v < b1})
        out, live = [], {}
        for lo, hi in zip(bs, bs[1:]):
            mid = (lo + hi) / 2
            spans, a = [], a0
            for h0, h1 in sorted((h[0], h[1]) for h in hs if h[2] < mid < h[3]):
                if h0 > a + EPS:
                    spans.append((a, min(h0, a1)))
                a = max(a, h1)
            if a < a1 - EPS:
                spans.append((a, a1))
            nxt = {}
            for s in spans:
                r = live.get(s)
                if r:
                    r[3] = hi
                else:
                    r = [s[0], s[1], lo, hi]
                    out.append(r)
                nxt[s] = r
            live = nxt
        return out
    rows = cut(x0, x1, z0, z1, holes)
    cols = [[r[2], r[3], r[0], r[1]] for r in cut(z0, z1, x0, x1, [(h[2], h[3], h[0], h[1]) for h in holes])]
    return rows if len(rows) <= len(cols) else cols


class Module:
    def __init__(self, name, role, family, weight, w, h):
        self.name, self.role, self.family, self.weight, self.w, self.h = name, role, family, weight, w, h
        self.bm = bmesh.new()
        self.mats = []

    def poly(self, pts, mat, normal):
        """one flat face; the winding is flipped if needed so that its normal points along `normal`"""
        pts = [Vector(p) for p in pts]
        n = Vector((0.0, 0.0, 0.0))
        for a, b in zip(pts, pts[1:] + pts[:1]):
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        assert n.length > 1e-9, f'{self.name}: degenerate face {pts}'
        if n.dot(Vector(normal)) < 0:
            pts.reverse()
        face = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        if mat not in self.mats:
            self.mats.append(mat)
        face.material_index = self.mats.index(mat)
        face.smooth = False

    def front(self, x0, x1, z0, z1, y, mat, n=-1):
        """quad in the plane Y = y facing the street (n = −1) or the building (n = +1)"""
        self.poly([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat, (0, n, 0))

    def flat(self, x0, x1, y0, y1, z, mat, n=1):
        self.poly([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, (0, 0, n))

    def side(self, y0, y1, z0, z1, x, mat, n):
        self.poly([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat, (n, 0, 0))

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces='ftblr'):
        """f front (−Y)  k back (+Y)  t top  b bottom  l left (−X)  r right (+X)"""
        if 'f' in faces:
            self.front(x0, x1, z0, z1, y0, mat, -1)
        if 'k' in faces:
            self.front(x0, x1, z0, z1, y1, mat, 1)
        if 't' in faces:
            self.flat(x0, x1, y0, y1, z1, mat, 1)
        if 'b' in faces:
            self.flat(x0, x1, y0, y1, z0, mat, -1)
        if 'l' in faces:
            self.side(y0, y1, z0, z1, x0, mat, -1)
        if 'r' in faces:
            self.side(y0, y1, z0, z1, x1, mat, 1)

    def reveal(self, x0, x1, z0, z1, depth, mat, sides='lrtb', y0=0.0):
        """the inner faces of a rectangular opening, from the face plane y0 back to `depth`"""
        if 'l' in sides:
            self.side(y0, depth, z0, z1, x0, mat, 1)
        if 'r' in sides:
            self.side(y0, depth, z0, z1, x1, mat, -1)
        if 't' in sides:
            self.flat(x0, x1, y0, depth, z1, mat, -1)
        if 'b' in sides:
            self.flat(x0, x1, y0, depth, z0, mat, 1)

    def prism(self, section, axis, a0, a1, mat, skip=()):
        """side faces of a bar along `axis` over a convex section given in the two other axes (xyz order);
        a triangular section closes a thin bar with three faces instead of four"""
        lift = {'x': lambda u, v, a: (a, u, v), 'y': lambda u, v, a: (u, a, v), 'z': lambda u, v, a: (u, v, a)}[axis]
        cu, cv = sum(p[0] for p in section) / len(section), sum(p[1] for p in section) / len(section)
        for i, (p, q) in enumerate(zip(section, section[1:] + section[:1])):
            if i in skip:
                continue
            nrm = lift((p[0] + q[0]) / 2 - cu, (p[1] + q[1]) / 2 - cv, 0.0)
            self.poly([lift(*p, a0), lift(*q, a0), lift(*q, a1), lift(*p, a1)], mat, nrm)

    def wall(self, holes, mat='wall', x0=0.0, x1=None, z0=0.0, z1=None, y=0.0):
        for r in solid_rects(x0, self.w if x1 is None else x1, z0, self.h if z1 is None else z1, holes):
            self.front(r[0], r[1], r[2], r[3], y, mat)

    def build(self):
        me = bpy.data.meshes.new(f'{KIT}__{self.name}')
        self.bm.to_mesh(me)
        self.bm.free()
        for mat in self.mats:
            me.materials.append(MAT[mat])
        obj = bpy.data.objects.new(f'{KIT}__{self.name}', me)
        scene.collection.objects.link(obj)
        self.tris = sum(len(p.vertices) - 2 for p in me.polygons)
        assert self.tris <= BUDGET[self.role], f'{self.name}: {self.tris} triangles > {BUDGET[self.role]}'
        return obj


MODULES = []


def module(name, role, family, weight, w, h):
    def register(fn):
        MODULES.append((name, role, family, weight, w, h, fn))
        return fn
    return register


# ───────────────────────── shared parts ─────────────────────────

def sashes(x0, x1, z0, z1, kind, fw=0.06):
    """glass panes of a window opening ('three' or 'two' leaves); the frame shows between them"""
    xm = (x0 + x1) / 2
    left, right = (x0 + fw, xm - fw / 2), (xm + fw / 2, x1 - fw)
    if kind == 'three':        # a leaf and a leaf with the fortochka above it
        zt = z1 - (z1 - z0) * 0.32
        return [(*left, z0 + fw, z1 - fw), (*right, z0 + fw, zt - fw / 2), (*right, zt + fw / 2, z1 - fw)]
    return [(*left, z0 + fw, z1 - fw), (*right, z0 + fw, z1 - fw)]


REVEAL = 0.2


def house_window(m, x0, x1, z0, z1, panes):
    """brick reveal, frame with the panes 3 cm in front of it, concrete lintel and sill"""
    m.reveal(x0, x1, z0, z1, REVEAL, 'wall', 'lrb')
    m.reveal(x0, x1, z0, z1, REVEAL, 'trim', 't')
    m.front(x0, x1, z0, z1, REVEAL, 'frame')
    for p in panes:
        m.front(*p, REVEAL - 0.03, 'glass')
    m.box(x0 - 0.15, x1 + 0.15, -0.025, 0, z1, z1 + 0.22, 'trim', 'fblr')
    m.box(x0 - 0.07, x1 + 0.07, -0.07, 0, z0 - 0.06, z0, 'trim')


def belt(m):
    """floor-line brick belt standing proud of the wall, the same on every house floor module"""
    m.box(0, BAY, -0.03, 0, 0, 0.15, 'wall2', 'ftb')


def plinth(m, x0=0.0, x1=BAY, faces='ft'):
    m.box(x0, x1, -0.04, 0, 0, 0.75, 'wall2', faces)


def grille(m, x0, x1, z0, z1, verticals=3, horizontals=2):
    for k in range(verticals):
        x = x0 + (x1 - x0) * (k + 1) / (verticals + 1)
        m.front(x - 0.0125, x + 0.0125, z0, z1, 0.06, 'metal')
    for k in range(horizontals):
        z = z0 + (z1 - z0) * (k + 1) / (horizontals + 1)
        m.front(x0, x1, z - 0.0125, z + 0.0125, 0.05, 'metal')


def railing(m, x0, x1, y0, z0, z1, bars):
    """open balcony railing: handrail on three sides, corner posts, vertical bars in front; the members are
    triangular in section, closed from every side for one face less than a square bar"""
    t = 0.04
    m.prism([(y0, z1 - t / 2), (y0 + t, z1), (y0 + t, z1 - t)], 'x', x0, x1, 'metal', skip=(1,))
    for x in (x0, x1 - t):
        m.prism([(x, z1 - t), (x + t, z1 - t), (x + t / 2, z1)], 'y', y0 + t, 0, 'metal')
        m.prism([(x + t / 2, y0), (x + t, y0 + t), (x, y0 + t)], 'z', z0, z1 - t / 2, 'metal')  # ends inside the handrail
    for k in range(bars):
        x = x0 + t + (x1 - x0 - 2 * t) * (k + 1) / (bars + 1)
        m.front(x - 0.012, x + 0.012, z0, z1 - t, y0 + t / 2, 'metal')


# segmental arches: a circle segment over the chord x0…x1 at the springing line zs, `rise` high, n straight pieces;
# stretched by the game it becomes an elliptic segment, which still reads as a brick arch

def arch_pts(x0, x1, zs, rise, n=4, grow=0.0):
    c = (x1 - x0) / 2
    R = (c * c + rise * rise) / (2 * rise)
    xc, zc = x0 + c, zs + rise - R
    a = math.asin(c / R)
    pts = []
    for i in range(n + 1):
        t = -a + 2 * a * i / n
        pts.append((xc + (R + grow) * math.sin(t), zc + (R + grow) * math.cos(t), t))
    if grow == 0.0:
        pts[0], pts[-1] = (x0, zs, -a), (x1, zs, a)
    return pts, (xc, zc, R, a)


def arch_spandrel(m, x0, x1, zs, rise, ztop, mat='wall', y=0.0, n=4):
    """the wall above an arched hole (the rest of the wall is cut with the hole x0…x1 up to the top)"""
    pts, _ = arch_pts(x0, x1, zs, rise, n)
    m.poly([(x, y, z) for x, z, _t in pts] + [(x1, y, ztop), (x0, y, ztop)], mat, (0, -1, 0))


def arch_ring(m, x0, x1, zs, rise, width, proud, mat='wall2', n=4):
    """brick arch ring standing `proud` of the wall, closed along its extrados and at the skewbacks;
    returns the height of its crown"""
    inner, _ = arch_pts(x0, x1, zs, rise, n)
    outer, _ = arch_pts(x0, x1, zs, rise, n, grow=width)
    y = -proud
    for i in range(n):
        (xa, za, _), (xb, zb, _) = inner[i], inner[i + 1]
        (xd, zd, _), (xe, ze, _) = outer[i + 1], outer[i]
        m.poly([(xa, y, za), (xb, y, zb), (xd, y, zd), (xe, y, ze)], mat, (0, -1, 0))
        tm = (inner[i][2] + inner[i + 1][2]) / 2
        m.poly([(xe, y, ze), (xd, y, zd), (xd, 0, zd), (xe, 0, ze)], mat, (math.sin(tm), 0, math.cos(tm)))
    for (xi, zi, t), (xo, zo, _), s in ((inner[0], outer[0], -1), (inner[-1], outer[-1], 1)):
        m.poly([(xi, y, zi), (xo, y, zo), (xo, 0, zo), (xi, 0, zi)], mat, (s * math.cos(t), 0, -abs(math.sin(t))))
    return outer[n // 2][1]


def arch_reveal(m, x0, x1, z0, zs, rise, depth, mat='wall', bottom=True, n=4, proud=0.0):
    """jambs from the wall plane, the soffit from the face of a proud arch ring"""
    inner, _ = arch_pts(x0, x1, zs, rise, n)
    m.side(0, depth, z0, zs, x0, mat, 1)
    m.side(0, depth, z0, zs, x1, mat, -1)
    for i in range(n):
        (xa, za, ta), (xb, zb, tb) = inner[i], inner[i + 1]
        tm = (ta + tb) / 2
        m.poly([(xa, -proud, za), (xb, -proud, zb), (xb, depth, zb), (xa, depth, za)], mat, (-math.sin(tm), 0, -math.cos(tm)))
    if bottom:
        m.flat(x0, x1, 0, depth, z0, mat, 1)


def arch_back(m, x0, x1, z0, zs, rise, y, mat, n=4):
    inner, _ = arch_pts(x0, x1, zs, rise, n)
    m.poly([(x0, y, z0), (x1, y, z0)] + [(x, y, z) for x, z, _t in reversed(inner)], mat, (0, -1, 0))


def arch_panes(m, x0, x1, z0, zs, rise, y, cols, rows, fw=0.07, n=4):
    """iron window: a grid of panes below the springing line and a fan pane in the arch"""
    if cols and rows:
        w = (x1 - x0 - (cols + 1) * fw) / cols
        h = (zs - z0 - (rows + 1) * fw) / rows
        for c in range(cols):
            for r in range(rows):
                xa, za = x0 + fw + c * (w + fw), z0 + fw + r * (h + fw)
                m.front(xa, xa + w, za, za + h, y, 'glass')
    _, (xc, zc, R, _a) = arch_pts(x0, x1, zs, rise, n)
    b = math.acos((zs + fw / 2 - zc) / (R - fw))
    fan = [(xc + (R - fw) * math.sin(t), y, zc + (R - fw) * math.cos(t)) for t in (-b + 2 * b * i / n for i in range(n + 1))]
    m.poly(fan, 'glass', (0, -1, 0))


# ───────────────────────── house: typical floors ─────────────────────────

@module('win', 'floor', 'house', 3, BAY, FLOOR)
def win(m):
    hole = (0.9, 2.3, 0.9, 2.4)
    belt(m)
    m.wall([hole], z0=0.15)
    house_window(m, *hole, sashes(*hole, 'three'))


@module('win_pair', 'floor', 'house', 2, BAY, FLOOR)
def win_pair(m):
    holes = [(0.35, 1.4, 0.9, 2.4), (1.8, 2.85, 0.9, 2.4)]
    belt(m)
    m.wall(holes, z0=0.15)
    for hole in holes:
        house_window(m, *hole, sashes(*hole, 'three'))


def balcony_opening(m):
    """balcony door and window in one opening, as in the 1-447 series"""
    dx0, dx1, wx1, zd, zw, zt = 0.45, 1.2, 2.6, 0.15, 0.9, 2.4
    m.side(0, REVEAL, zd, zt, dx0, 'wall', 1)
    m.side(0, REVEAL, zw, zt, wx1, 'wall', -1)
    m.side(0, REVEAL, zd, zw, dx1, 'wall', -1)
    m.flat(dx0, wx1, 0, REVEAL, zt, 'trim', -1)
    m.flat(dx0, dx1, 0, REVEAL, zd, 'trim', 1)
    m.flat(dx1, wx1, 0, REVEAL, zw, 'wall', 1)
    m.front(dx0, dx1, zd, zt, REVEAL, 'frame')
    m.front(dx1, wx1, zw, zt, REVEAL, 'frame')
    m.front(dx0 + 0.07, dx1 - 0.06, 1.25, zt - 0.07, REVEAL - 0.03, 'glass')
    for p in sashes(dx1, wx1, zw, zt, 'two'):
        m.front(*p, REVEAL - 0.03, 'glass')
    m.box(dx0 - 0.15, wx1 + 0.15, -0.025, 0, zt, zt + 0.22, 'trim', 'fb')
    m.box(dx1, wx1 + 0.07, -0.07, 0, zw - 0.06, zw, 'trim', 'ftb')
    return [(dx0, dx1, zd, zt), (dx1, wx1, zw, zt)]


@module('balcony', 'floor', 'house', 2, BAY, FLOOR)
def balcony(m):
    belt(m)
    m.wall(balcony_opening(m), z0=0.15)
    m.box(0.2, 3.0, -0.9, 0, 0, 0.14, 'trim', 'ftblr')
    railing(m, 0.2, 3.0, -0.9, 0.14, 1.14, bars=3)


@module('balcony_glazed', 'floor', 'house', 2, BAY, FLOOR)
def balcony_glazed(m):
    x0, x1, y0, zs, zp, zg = 0.2, 3.0, -0.9, 0.14, 1.1, 2.62
    belt(m)
    m.wall([(x0, x1, 0.15, zg)], z0=0.15)             # the wall inside the glazed box is never seen
    m.box(x0, x1, y0, 0, 0, zs, 'trim', 'ftblr')
    m.box(x0, x1, y0, 0, zs, zp, 'metal', 'flr')        # sheet-metal parapet
    m.flat(x0, x1, y0, y0 + 0.04, zp, 'metal', 1)
    m.front(x0, x1, zp, zg, y0 + 0.04, 'frame')
    m.side(y0 + 0.04, 0, zp, zg, x0, 'frame', -1)
    m.side(y0 + 0.04, 0, zp, zg, x1, 'frame', 1)
    fw, n = 0.06, 4
    pw = (x1 - x0 - (n + 1) * fw) / n
    for k in range(n):
        xa = x0 + fw + k * (pw + fw)
        m.front(xa, xa + pw, zp + fw, zg - fw, y0 + 0.01, 'glass')
    m.side(y0 + 0.1, -0.08, zp + fw, zg - fw, x0 - 0.03, 'glass', -1)
    m.side(y0 + 0.1, -0.08, zp + fw, zg - fw, x1 + 0.03, 'glass', 1)
    m.box(x0 - 0.05, x1 + 0.05, y0 - 0.05, 0, zg, zg + 0.12, 'metal', 'ftblr')  # visor


def drainpipe(m, z0, z1):
    """the downpipe of the stairwell column, against the wall at the left edge of the bay"""
    m.box(0.08, 0.2, -0.13, 0, z0, z1, 'metal', 'flr')


@module('stair', 'stair', 'house', 1, BAY, FLOOR)
def stair(m):
    hole = (1.15, 2.05, 1.4, 2.75)                     # narrow, at the landing between floors
    belt(m)
    m.wall([hole], z0=0.15)
    house_window(m, *hole, sashes(*hole, 'three'))
    drainpipe(m, 0, FLOOR)


@module('blank', 'blank', 'house', 1, BAY, FLOOR)
def blank(m):
    belt(m)
    m.wall([], z0=0.15)


# ───────────────────────── house: ground floor, cap, corner ─────────────────────────

def ground_window(m, hole, kind, bars):
    m.wall([hole], z0=0.75)
    house_window(m, *hole, sashes(*hole, kind))
    if bars:
        grille(m, *hole)


@module('g_win', 'ground', 'house', 3, BAY, GROUND)
def g_win(m):
    plinth(m)
    ground_window(m, (0.9, 2.3, 1.2, 2.7), 'three', bars=True)


@module('g_basement', 'ground', 'house', 2, BAY, GROUND)
def g_basement(m):
    vents = [(0.45, 0.85, 0.25, 0.5), (2.35, 2.75, 0.25, 0.5)]
    m.wall(vents, 'wall2', z1=0.75, y=-0.04)
    m.flat(0, BAY, -0.04, 0, 0.75, 'wall2', 1)
    for v in vents:
        m.reveal(*v, 0.2, 'wall2', y0=-0.04)
        m.front(*v, 0.2, 'dark')
        for x in (v[0] + 0.13, v[1] - 0.13):
            m.front(x - 0.015, x + 0.015, v[2], v[3], -0.01, 'metal')
    ground_window(m, (0.9, 2.3, 1.2, 2.7), 'three', bars=False)


@module('g_door', 'entrance', 'house', 1, BAY, GROUND)
def g_door(m):
    d0, d1, dz, dt, rec = 1.0, 2.2, 0.3, 2.45, 0.3
    stairwin = (1.15, 2.05, 2.88, 3.2)                 # first staircase window, above the canopy
    plinth(m, 0, d0, 'ftr')
    plinth(m, d1, BAY, 'ftl')
    m.wall([(d0, d1, 0.75, dt), stairwin], z0=0.75)
    m.box(0.6, 2.6, -1.3, 0, 0, dz, 'trim', 'ftlr')    # porch landing
    m.box(0.85, 2.35, -1.6, -1.3, 0, 0.15, 'trim', 'ftlr')
    m.reveal(d0, d1, dz, dt, rec, 'wall', 'lrt')
    m.flat(d0, d1, 0, rec, dz, 'trim', 1)
    m.front(d0, d1, dz, dt, rec, 'dark')
    m.front(d0 + 0.03, 1.585, dz, 2.1, rec - 0.02, 'metal')
    m.front(1.615, d1 - 0.03, dz, 2.1, rec - 0.02, 'metal')
    m.front(d0 + 0.05, d1 - 0.05, 2.15, dt - 0.05, rec - 0.02, 'glass')
    m.box(0.7, 2.5, -1.35, 0, 2.6, 2.75, 'trim')       # canopy slab
    for x in (0.78, 2.36):
        m.box(x, x + 0.06, -1.3, -1.24, dz, 2.6, 'metal', 'flr')
    m.reveal(*stairwin, REVEAL, 'wall')
    m.front(*stairwin, REVEAL, 'frame')
    for p in sashes(*stairwin, 'two', fw=0.05):
        m.front(*p, REVEAL - 0.03, 'glass')
    m.box(0.3, 0.62, -0.02, 0, 1.95, 2.15, 'sign', 'f')  # house number plate
    drainpipe(m, 0.36, GROUND)
    m.box(0.06, 0.22, -0.42, 0, 0.22, 0.36, 'metal', 'ftblr')  # outlet


@module('g_shop', 'shop', 'house', 1, BAY, GROUND)
def g_shop(m):
    door, shop = (0.3, 1.2, 0.4, 2.4), (1.45, 2.95, 0.75, 2.4)
    rec = 0.15
    plinth(m, 0, 0.15, 'ftr')
    plinth(m, 1.35, BAY, 'ftl')
    m.wall([door, shop, (0, 0.15, 0.4, 0.75), (1.35, BAY, 0.4, 0.75)], z0=0.4)
    m.box(0.15, 1.35, -0.6, 0, 0, 0.2, 'trim', 'ftlr')
    m.box(0.15, 1.35, -0.3, 0, 0.2, 0.4, 'trim', 'ftlr')
    m.reveal(*door, rec, 'wall')
    m.front(*door, rec, 'frame')
    m.front(door[0] + 0.07, door[1] - 0.07, door[2] + 0.1, door[3] - 0.07, rec - 0.03, 'glass')
    m.reveal(*shop, rec, 'wall')
    m.front(*shop, rec, 'frame')
    for p in [(1.51, 2.17, 0.81, 1.95), (2.23, 2.89, 0.81, 1.95), (1.51, 2.89, 2.01, 2.34)]:
        m.front(*p, rec - 0.03, 'glass')
    m.box(1.4, 3.0, -0.05, 0, 0.71, 0.75, 'metal', 'ft')
    m.box(0.1, 3.1, -0.14, 0, 2.55, 3.1, 'sign')       # sign band
    m.box(0.1, 1.45, -0.8, 0, 2.43, 2.51, 'metal')  # visor over the door
    m.box(2.98, 3.06, -0.85, 0, 1.8, 2.4, 'sign')  # blade sign


@module('cap', 'cap', 'house', 1, BAY, CAP)
def cap(m):
    courses = ((-0.08, 0.18, 0.3), (-0.16, 0.3, 0.42), (-0.25, 0.42, 0.7))
    m.front(0, BAY, 0, courses[0][1], 0, 'wall')
    y_prev = 0.0
    for y, z0, z1 in courses:
        m.front(0, BAY, z0, z1, y, 'wall')
        m.flat(0, BAY, y, y_prev, z0, 'wall', -1)
        y_prev = y
    yc, zc = -0.33, 0.7                                   # metal coping over the parapet
    m.box(0, BAY, yc, 0.45, zc, CAP, 'roof', 'ft')
    m.flat(0, BAY, yc, y_prev, zc, 'roof', -1)
    steps = [(0, courses[0][1])]
    for y, z0, z1 in courses:
        steps += [(y, z0), (y, z1)]
    steps.append((0, zc))
    for x, s in ((0, -1), (BAY, 1)):                      # closed ends: the cornice turns the building corner
        m.poly([(x, y, z) for y, z in steps], 'wall', (s, 0, 0))
        m.side(yc, 0, zc, CAP, x, 'roof', s)


@module('corner', 'corner', 'house', 1, CORNER, FLOOR)
def corner(m):
    m.front(0, CORNER, 0, FLOOR, 0, 'wall')
    for z0, z1 in ((0.0, 0.75), (1.5, 2.25)):           # quoins, the lower one closes the belt and the plinth
        m.box(0, CORNER, -0.05, 0, z0, z1, 'wall2')


# ───────────────────────── warehouse ─────────────────────────

PIL, PIL_OUT = 0.25, 0.13
WH_REVEAL = 0.25


def wh_pilasters(m, h):
    m.box(0, PIL, -PIL_OUT, 0, 0, h, 'wall', 'fr')
    m.box(BAY - PIL, BAY, -PIL_OUT, 0, 0, h, 'wall', 'fl')


def wh_window(m, wall_z0, x0, x1, z0, zs, rise, ztop, bars, keystone):
    m.wall([(x0, x1, z0, ztop)], x0=PIL, x1=BAY - PIL, z0=wall_z0)
    arch_spandrel(m, x0, x1, zs, rise, ztop)
    top = arch_ring(m, x0, x1, zs, rise, 0.14, 0.04)
    if keystone:
        xc = (x0 + x1) / 2
        m.box(xc - 0.1, xc + 0.1, -0.07, 0, zs + rise - 0.03, top + 0.05, 'trim', 'fblr')
    arch_reveal(m, x0, x1, z0, zs, rise, WH_REVEAL, proud=0.04)
    arch_back(m, x0, x1, z0, zs, rise, WH_REVEAL, 'frame')
    arch_panes(m, x0, x1, z0, zs, rise, WH_REVEAL - 0.03, cols=2, rows=3)
    m.box(x0 - 0.08, x1 + 0.08, -0.08, 0, z0 - 0.08, z0, 'trim', 'ftblr')
    if bars:
        grille(m, x0, x1, z0, zs, verticals=3, horizontals=0)


@module('wh_arch', 'floor', 'warehouse', 3, BAY, FLOOR)
def wh_arch(m):
    wh_pilasters(m, FLOOR)
    m.box(PIL, BAY - PIL, -0.05, 0, 0, 0.2, 'wall2', 'ftb')   # floor belt
    wh_window(m, 0.2, 0.85, 2.35, 0.7, 2.3, 0.35, FLOOR, bars=False, keystone=False)


@module('wh_pilaster', 'floor', 'warehouse', 1, BAY, FLOOR)
def wh_pilaster(m):
    """blank bay between the pilaster strips: a bricked-up arch (blind niche) keeps the rhythm of the windows"""
    x0, x1, z0, zs, rise, d = 0.85, 2.35, 0.7, 2.3, 0.35, 0.08
    wh_pilasters(m, FLOOR)
    m.box(PIL, BAY - PIL, -0.05, 0, 0, 0.2, 'wall2', 'ftb')
    m.wall([(x0, x1, z0, FLOOR)], x0=PIL, x1=BAY - PIL, z0=0.2)
    arch_spandrel(m, x0, x1, zs, rise, FLOOR)
    arch_ring(m, x0, x1, zs, rise, 0.14, 0.04)
    arch_reveal(m, x0, x1, z0, zs, rise, d, proud=0.04)
    arch_back(m, x0, x1, z0, zs, rise, d, 'wall')


@module('wh_g_arch', 'ground', 'warehouse', 3, BAY, GROUND)
def wh_g_arch(m):
    wh_pilasters(m, GROUND)
    m.box(PIL, BAY - PIL, -0.07, 0, 0, 0.6, 'wall2', 'ft')   # plinth
    wh_window(m, 0.6, 0.85, 2.35, 1.0, 2.6, 0.35, GROUND, bars=True, keystone=True)


@module('wh_g_door', 'entrance', 'warehouse', 1, BAY, GROUND)
def wh_g_door(m):
    x0, x1, zs, rise, d = 0.5, 2.7, 2.5, 0.4, 0.35
    xc = (x0 + x1) / 2
    wh_pilasters(m, GROUND)
    m.box(PIL, x0, -0.07, 0, 0, 0.6, 'wall2', 'ftr')
    m.box(x1, BAY - PIL, -0.07, 0, 0, 0.6, 'wall2', 'ftl')
    m.wall([(x0, x1, 0, GROUND)], x0=PIL, x1=BAY - PIL, z0=0.6)
    arch_spandrel(m, x0, x1, zs, rise, GROUND)
    top = arch_ring(m, x0, x1, zs, rise, 0.16, 0.04)
    m.box(xc - 0.11, xc + 0.11, -0.07, 0, zs + rise - 0.03, top + 0.06, 'trim', 'fblr')
    arch_reveal(m, x0, x1, 0, zs, rise, d, 'wall', proud=0.04)
    arch_back(m, x0, x1, 0, zs, rise, d, 'dark')
    for a, b in ((x0 + 0.06, xc - 0.02), (xc + 0.02, x1 - 0.06)):   # steel leaves with two ribs each
        m.front(a, b, 0, zs - 0.06, d - 0.02, 'metal')
        for z in (0.75, 1.65):
            m.box(a + 0.05, b - 0.05, d - 0.05, d - 0.02, z, z + 0.08, 'metal', 'ftblr')
    arch_panes(m, x0, x1, zs - 0.06, zs, rise, d - 0.02, cols=0, rows=0, fw=0.06)
    for a in (PIL + 0.03, x1):                                        # stone wheel guards at the jambs
        m.box(a, a + 0.19, -0.3, 0, 0, 0.5, 'trim', 'ftlr')


@module('wh_cap', 'cap', 'warehouse', 1, BAY, CAP)
def wh_cap(m):
    steps = ((-0.07, 0.0, 0.2), (-0.15, 0.2, 0.32), (-0.23, 0.32, 0.44), (-0.34, 0.44, 0.8))
    y_prev = 0.0
    for k, (y, z0, z1) in enumerate(steps):
        mat = 'wall2' if k == 2 else 'wall'
        if k == len(steps) - 1:
            m.front(0, BAY, z0, 0.72, y, mat)
            m.front(0, BAY, 0.72, z1, y, 'roof')
        else:
            m.front(0, BAY, z0, z1, y, mat)
        m.flat(0, BAY, y, y_prev, z0, mat, -1)
        y_prev = y
    m.flat(0, BAY, steps[-1][0], 0.45, CAP, 'roof', 1)
    prof = [(0, 0)]
    for y, z0, z1 in steps:
        prof += [(y, z0), (y, z1)]
    prof.append((0, CAP))
    for x, s in ((0, -1), (BAY, 1)):
        m.poly([(x, y, z) for y, z in prof], 'wall', (s, 0, 0))


@module('wh_corner', 'corner', 'warehouse', 1, CORNER, FLOOR)
def wh_corner(m):
    m.box(0, CORNER, -0.16, 0, 0, FLOOR, 'wall', 'flr')
    m.box(0, CORNER, -0.21, -0.16, 0, 0.2, 'wall2', 'ftblr')


# ───────────────────────── build, export, manifest ─────────────────────────

built = []
for name, role, family, weight, w, h, fn in MODULES:
    m = Module(name, role, family, weight, w, h)
    fn(m)
    m.build()
    built.append(m)

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_materials='EXPORT', use_selection=False)

manifest_path = os.path.splitext(OUT)[0] + '.json'
lines = ['{', f'  "kit": "{KIT}",',
         f'  "bay": {BAY}, "floor": {FLOOR}, "ground": {GROUND}, "cap": {CAP}, "corner": {CORNER},',
         '  "families": {']
fams = [(f, [m.name for m in built if m.family == f]) for f in ('house', 'warehouse')]
lines += [f'    "{f}": {json.dumps(names)}' + (',' if i < len(fams) - 1 else '') for i, (f, names) in enumerate(fams)]
lines += ['  },', '  "modules": {']
pad = max(len(m.name) for m in built) + 3
for i, m in enumerate(built):
    key = f'"{m.name}":'.ljust(pad)
    role = f'"{m.role}",'.ljust(11)
    lines.append(f'    {key} {{ "w": {m.w}, "h": {m.h}, "role": {role} "weight": {m.weight}, "tris": {m.tris:>3} }}'
                 + (',' if i < len(built) - 1 else ''))
lines += ['  }', '}']
with open(manifest_path, 'w') as f:
    f.write('\n'.join(lines) + '\n')
with open(manifest_path) as f:
    json.load(f)

for m in built:
    print(f'  {m.name:<16} {m.role:<9} {m.family:<10} {m.w}×{m.h}  {m.tris:>3} / {BUDGET[m.role]}')
print(f'{KIT}: {len(built)} modules, {sum(m.tris for m in built)} triangles, {os.path.getsize(OUT)} bytes → {OUT}')


# ───────────────────────── preview ─────────────────────────

def preview(path):
    os.makedirs(SCRATCH, exist_ok=True)
    red = {'wall': '#8e4a38', 'wall2': '#6f3a2d'}
    wh_mats = {}
    for name, color in red.items():
        pm = MAT[name].copy()
        pm.name = f'preview_{name}_depot'
        pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb(color), 1.0)
        wh_mats[name] = pm
    for m in built:
        if m.family == 'warehouse':
            me = bpy.data.objects[f'{KIT}__{m.name}'].data
            for i, slot in enumerate(me.materials):
                if slot.name in wh_mats:
                    me.materials[i] = wh_mats[slot.name]
    for m in built:
        bpy.data.objects[f'{KIT}__{m.name}'].hide_render = True
    for mat in bpy.data.materials:              # the game culls back faces: render them see-through
        nt = mat.node_tree
        out = nt.nodes['Material Output']
        bsdf = nt.nodes['Principled BSDF']
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
        nt.links.new(bsdf.outputs['BSDF'], mix.inputs[1])
        nt.links.new(nt.nodes.new('ShaderNodeBsdfTransparent').outputs[0], mix.inputs[2])
        shader = mix
        if DEBUG_BACKFACES:                     # …and paint the ones the camera sees directly magenta
            ray = nt.nodes.new('ShaderNodeLightPath')
            both = nt.nodes.new('ShaderNodeMath')
            both.operation = 'MULTIPLY'
            nt.links.new(geo.outputs['Backfacing'], both.inputs[0])
            nt.links.new(ray.outputs['Is Camera Ray'], both.inputs[1])
            flag = nt.nodes.new('ShaderNodeEmission')
            flag.inputs['Color'].default_value = (1, 0, 1, 1)
            shader = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(both.outputs[0], shader.inputs['Fac'])
            nt.links.new(mix.outputs['Shader'], shader.inputs[1])
            nt.links.new(flag.outputs[0], shader.inputs[2])
        nt.links.new(shader.outputs['Shader'], out.inputs['Surface'])

    groups = {'house': [], 'depot': []}

    def place(name, loc, rot, sx=1.0, sz=1.0):
        o = bpy.data.objects.new(f'pv_{name}', bpy.data.objects[f'{KIT}__{name}'].data)
        o.location, o.rotation_euler, o.scale = loc, (0, 0, rot), (sx, 1, sz)
        scene.collection.objects.link(o)
        groups['depot' if name.startswith('wh_') else 'house'].append(o)

    def facade(origin, direction, columns, corner_name, cap_name, heights):
        """columns: module names bottom→top per bay; corners at both ends, one cap row stretched over the corners"""
        ox, oy = origin
        dx, dy = direction
        rot = math.atan2(dy, dx)
        length = 2 * CORNER + BAY * len(columns)
        at = lambda s, z: (ox + dx * s, oy + dy * s, z)
        z = 0.0
        for f, h in enumerate(heights):
            place(corner_name, at(0, z), rot, sz=h / FLOOR)
            place(corner_name, at(length - CORNER, z), rot, sz=h / FLOOR)
            for c, col in enumerate(columns):
                place(col[f], at(CORNER + BAY * c, z), rot, sz=h / (GROUND if f == 0 else FLOOR))
            z += h
        sx = length / (BAY * len(columns))
        for c in range(len(columns)):
            place(cap_name, at(BAY * sx * c, z), rot, sx=sx)
        return length, z

    house_cols = [
        ['g_basement', 'win_pair', 'win_pair', 'win_pair', 'win_pair'],
        ['g_door', 'stair', 'stair', 'stair', 'stair'],
        ['g_win', 'balcony', 'balcony_glazed', 'balcony', 'balcony'],
        ['g_shop', 'win', 'win', 'win', 'win'],
        ['g_win', 'balcony_glazed', 'balcony', 'balcony_glazed', 'balcony'],
        ['g_door', 'stair', 'stair', 'stair', 'stair'],
        ['g_basement', 'win_pair', 'win_pair', 'win_pair', 'win_pair'],
    ]
    heights = [GROUND] + [FLOOR] * 4
    hl, hh = facade((0, 0), (1, 0), house_cols, 'corner', 'cap', heights)
    facade((0, 2 * CORNER + 2 * BAY), (0, -1), [['g_win', 'win', 'blank', 'win', 'blank'], ['g_basement'] + ['blank'] * 4],
           'corner', 'cap', heights)
    wx = hl + 8.0
    wh_cols = [['wh_g_arch', 'wh_arch'], ['wh_g_door', 'wh_pilaster'], ['wh_g_arch', 'wh_arch'],
               ['wh_g_arch', 'wh_arch'], ['wh_g_door', 'wh_pilaster'], ['wh_g_arch', 'wh_arch']]
    wl, whh = facade((wx, 0), (1, 0), wh_cols, 'wh_corner', 'wh_cap', [GROUND, FLOOR])
    facade((wx, 2 * CORNER + 2 * BAY), (0, -1), [['wh_g_arch', 'wh_arch'], ['wh_g_arch', 'wh_pilaster']],
           'wh_corner', 'wh_cap', [GROUND, FLOOR])
    for group, x0, x1, h in (('house', 0, hl, hh), ('depot', wx, wx + wl, whh)):  # flat roofs
        depth = 2 * CORNER + 2 * BAY
        me = bpy.data.meshes.new('pv_roof')
        z = h + 0.76
        me.from_pydata([(x0, 0, z), (x1, 0, z), (x1, depth, z), (x0, depth, z)], [], [(0, 1, 2, 3)])
        me.materials.append(MAT['roof'])
        roof = bpy.data.objects.new('pv_roof', me)
        scene.collection.objects.link(roof)
        groups[group].append(roof)

    me = bpy.data.meshes.new('pv_ground')
    me.from_pydata([(-80, -80, 0), (140, -80, 0), (140, 80, 0), (-80, 80, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new('pv_asphalt')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb('#55575a'), 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    me.materials.append(gm)
    scene.collection.objects.link(bpy.data.objects.new('pv_ground', me))

    sun_data = bpy.data.lights.new('pv_sun', 'SUN')
    sun_data.energy = 4.2
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new('pv_sun', sun_data)
    sun.rotation_euler = Vector((0.75, 0.9, -0.85)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('pv_world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*srgb('#9fb6cf'), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world

    cam_data = bpy.data.cameras.new('pv_cam')
    cam = bpy.data.objects.new('pv_cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    shots = [  # (name, resolution, camera, target, lens, position on the sheet)
        ('house', (600, 400), (-3.5, -29.0, 4.2), (11.3, 0, 7.9), 35, (0, 0)),
        ('depot', (680, 400), (wx - 7.5, -19.0, 2.6), (wx + 8.9, 0, 3.3), 35, (600, 0)),
        ('house_2x2', (640, 320), (1.2, -10.4, 1.7), (7.2, 0, 3.0), 30, (0, 400)),
        ('depot_2x2', (640, 320), (wx - 3.0, -10.0, 1.7), (wx + 3.7, 0, 3.4), 30, (640, 400)),
    ]
    tiles = {}
    for name, (rx, ry), loc, target, lens, _at in shots:
        for group, objs in groups.items():
            for o in objs:
                o.hide_render = not name.startswith(group)
        scene.render.resolution_x, scene.render.resolution_y = rx, ry
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        cam_data.lens = lens
        scene.render.filepath = os.path.join(SCRATCH, f'preview_{name}.png')
        bpy.ops.render.render(write_still=True)
        tiles[name] = bpy.data.images.load(scene.render.filepath)

    import numpy as np
    W, H = 1280, 720
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    def paste(img, x, y_top):
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        canvas[H - y_top - h:H - y_top, x:x + w] = px
    for name, _r, _c, _t, _l, (x, y) in shots:
        paste(tiles[name], x, y)
    canvas[:, :, 3] = 1.0
    out = bpy.data.images.new('pv_sheet', W, H, alpha=False)
    out.pixels[:] = canvas.ravel()
    out.filepath_raw = os.path.abspath(path)
    out.file_format = 'PNG'
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    out.save()
    print('PREVIEW_OK', path)


if PREVIEW:
    preview(PREVIEW)
