"""Hero buildings of the Warsaw map (centre around the Palace of Culture), built headless in Blender.

    blender -b --factory-startup -P scripts/blender/heroes/warsaw.py -- src/assets/heroes/warsaw.glb \
        [--preview docs/heroes] [--only <osmId>,<osmId>] [--breakdown 1]

Contract: docs/KITS.md §1 and §3. Every footprint is read from src/data/maps/warsaw.world.json (`buildings[]`,
rings in decimetres, +x east, +z south) — nothing is copied by hand. A hero is modelled in map metres around the
centroid of its main part's outer ring (Blender X = x − cx, Y = −(z − cz), Z up from the ground) as one mesh
object `hero__<osmId>`, using only the contract materials. Heights follow the OSM parts (height / min_height)
and photographs on Wikimedia Commons. The manifest next to the GLB lists every OSM part a hero replaces, its
centroid and its real triangle count. `--preview DIR` renders `DIR/warsaw-<osmId>.png` per hero (Workbench,
cavity + shadows, back faces culled so an inverted face shows as a hole): a 3/4 view of the whole building on
the left, a closer view of its most characteristic part on the right.

Heroes (hero id = the main OSM part in buildings[]; outlines drawn as parts are not in the world file):
  89352683   Pałac Kultury i Nauki — all 15 parts styled `pkin`, 237 m      (≤ 15 000 triangles)
  237574573  Złote Tarasy — the parts inside the sign outline of way 30611687 (≤ 10 000)
  226156055  Warszawa Centralna — the parts inside the outline of way 367491792 (≤ 8 000)
  875519280  Varso Tower, 310 m          239175870  Złota 44, 192 m
  234881014  Rondo 1, 192 m              235880567  Warsaw Financial Center, 144 m
  234915955  InterContinental, 164 m     961565573  Skysawa, 155 m
  226315284  Centrum LIM (Marriott)      30621661   Kaskada
  140367961  Ilmet                       350962669  Wars Sawa Junior

The facades are built from a few systems that give depth for few triangles:
  facade()   recessed glazing: a glass (or wall) plane per edge, piers in front of it every bay and one
             spandrel band per floor per edge (the band ends hide behind the piers)
  curtain()  glass tower skin: glass plane, thin mullion fins, one slab band per floor
  band()     a cornice / belt course: the ring pushed outwards with its top and bottom faces
  parapet()  outer wall, coping and inner wall above a roof, the roof itself inside
Walls built against another part of the same hero are dropped (Geo.occlude), `--breakdown 1` prints the
triangles per section.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
MAP = 'warsaw'

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OPTS = {'out': os.path.join(REPO, 'src/assets/heroes/warsaw.glb'), 'preview': None, 'only': None, 'breakdown': None}
_rest = list(argv)
while _rest:
    arg = _rest.pop(0)
    if arg.startswith('--'):
        OPTS[arg[2:]] = _rest.pop(0)
    else:
        OPTS['out'] = arg

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

WORLD = json.load(open(os.path.join(REPO, 'src/data/maps/warsaw.world.json')))
RECORDS = {}  # OSM id → its records; a footprint cut by the race corridor has several
for _rec in WORLD['buildings']:
    RECORDS.setdefault(_rec[7], []).append(_rec)


# ───────────────────────── materials ─────────────────────────

def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATERIALS = {
    # name:  sRGB colour, metallic, roughness
    'wall':  ('#d9cdb4', 0.0, 0.8),
    'wall2': ('#a89d88', 0.0, 0.8),
    'trim':  ('#e9e3d6', 0.0, 0.7),
    'glass': ('#3b4a57', 0.0, 0.08),
    'frame': ('#b9bcbf', 0.3, 0.45),
    'metal': ('#4d535a', 0.7, 0.4),
    'roof':  ('#4a4c50', 0.0, 0.9),
    'dark':  ('#1c1e21', 0.0, 0.95),
    'sign':  ('#ebe7dc', 0.0, 0.5),
    'gold':  ('#d9a93c', 1.0, 0.3),
}
MAT = {}
for _name, (_hex, _metal, _rough) in MATERIALS.items():
    _m = bpy.data.materials.new(_name)
    _m.use_nodes = True
    _bsdf = _m.node_tree.nodes['Principled BSDF']
    _bsdf.inputs['Base Color'].default_value = (*srgb(_hex), 1.0)
    _bsdf.inputs['Metallic'].default_value = _metal
    _bsdf.inputs['Roughness'].default_value = _rough
    _m.diffuse_color = (*srgb(_hex), 1.0)
    MAT[_name] = _m
MAT_INDEX = {name: i for i, name in enumerate(MATERIALS)}


# ───────────────────────── footprints ─────────────────────────

def area2(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def ccw(r, want=True):
    return r if (area2(r) > 0) == want else r[::-1]


def simplify(r, tol=0.15):
    """drops ring vertices that lie within `tol` of the line through their neighbours (closed ring)"""
    pts = list(r)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            ab = math.hypot(c[0] - a[0], c[1] - a[1])
            if ab < 1e-6 or abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / ab < tol:
                del pts[i]
                changed = True
                break
    return pts


class Part:
    """one footprint piece of an OSM way in hero space: outer ring CCW, holes CW, heights in metres"""

    def __init__(self, rec, frame, tol):
        self.id, self.h, self.min_h, self.colour = rec[7], rec[0] / 10, rec[1] / 10, rec[3]
        conv = lambda flat: [(flat[i] / 10 - frame[0], -(flat[i + 1] / 10 - frame[1])) for i in range(0, len(flat), 2)]
        self.outer = ccw(simplify(conv(rec[8]), tol))
        self.holes = [ccw(simplify(conv(h), tol), False) for h in rec[9:]]


class Hero:
    def __init__(self, main, name, ids, tol=0.15):
        self.main, self.name, self.ids = main, name, sorted(set(ids), key=lambda i: (i != main, i))
        outer = RECORDS[main][0][8]
        n = len(outer) // 2
        self.cx, self.cz = sum(outer[0::2]) / n / 10, sum(outer[1::2]) / n / 10
        self.tol = tol
        self.g = Geo()
        self.note = ''
        self.tint = None           # preview only: the wall tint the game gives the building
        self.view = (35, 22)       # preview azimuth (0 = from the south, 90 = from the east) and elevation
        self.detail = None         # preview close-up box ((x, y, z), (x, y, z))
        self.detail_view = (35, 12)
        self.sections = []         # (label, triangles) recorded by mark()

    def mark(self, label):
        """records the triangles added since the previous mark (printed with --breakdown 1)"""
        self.sections.append((label, self.g.tris() - sum(n for _, n in self.sections)))

    def parts(self, osm, tol=None):
        return [Part(rec, (self.cx, self.cz), self.tol if tol is None else tol) for rec in RECORDS[osm]]

    def part(self, osm, tol=None):
        return self.parts(osm, tol)[0]


# ───────────────────────── 2D helpers ─────────────────────────

def edges(r):
    """(p0, p1, length, unit tangent, outward normal) of every edge of a CCW ring"""
    for i in range(len(r)):
        p0, p1 = r[i], r[(i + 1) % len(r)]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        if L < 1e-4:
            continue
        yield p0, p1, L, (dx / L, dy / L), (dy / L, -dx / L)


def offset(r, d, limit=3.0):
    """miter offset of a CCW ring, outwards for d > 0 (miters clamped to `limit`·|d|)"""
    out = []
    n = len(r)
    for i in range(n):
        a, b, c = r[i - 1], r[i], r[(i + 1) % n]
        e1 = (b[0] - a[0], b[1] - a[1])
        e2 = (c[0] - b[0], c[1] - b[1])
        l1, l2 = math.hypot(*e1) or 1, math.hypot(*e2) or 1
        n1 = (e1[1] / l1, -e1[0] / l1)
        n2 = (e2[1] / l2, -e2[0] / l2)
        m = (n1[0] + n2[0], n1[1] + n2[1])
        ml = math.hypot(*m)
        if ml < 1e-6:
            out.append((b[0] + n1[0] * d, b[1] + n1[1] * d))
            continue
        m = (m[0] / ml, m[1] / ml)
        k = min(limit, 1 / max(1e-6, m[0] * n1[0] + m[1] * n1[1]))
        out.append((b[0] + m[0] * d * k, b[1] + m[1] * d * k))
    return out


def scale_ring(r, s, c=None):
    c = c or centroid(r)
    return [(c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s) for p in r]


def offset_point(r, p, d):
    """the vertex p of ring r moved like offset(r, d) moves it"""
    i = min(range(len(r)), key=lambda k: math.hypot(r[k][0] - p[0], r[k][1] - p[1]))
    return offset(r, d)[i]


def centroid(r):
    return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))


def bbox(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def longest_edge(r):
    return max(edges(r), key=lambda e: e[2])


def rect(c, u, hw, hd):
    """CCW rectangle centred at c with half-extent hw along unit u and hd across it"""
    v = (-u[1], u[0])
    return [(c[0] + s * u[0] * hw + t * v[0] * hd, c[1] + s * u[1] * hw + t * v[1] * hd)
            for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


# ───────────────────────── mesh accumulator ─────────────────────────

def inside(p, r):
    ins = False
    for i in range(len(r)):
        (x0, y0), (x1, y1) = r[i - 1], r[i]
        if (y0 > p[1]) != (y1 > p[1]) and p[0] < x0 + (p[1] - y0) * (x1 - x0) / (y1 - y0):
            ins = not ins
    return ins


class Geo:
    def __init__(self):
        self.v, self.f, self.m = [], [], []
        self.occluders = []  # (ring, bbox, z0, z1): solid volumes that hide the walls built against them
        self.cull = True

    def occlude(self, r, z0, z1):
        self.occluders.append((r, bbox([r]), z0, z1))

    def hidden(self, pts):
        a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[2])
        n = (b - a).cross(c - b)
        if n.length < 1e-9 or abs(n.normalized().z) > 0.2:
            return False
        n = n.normalized()
        zs = [p[2] for p in pts]
        cx = sum(p[0] for p in pts) / len(pts) + n.x * 0.3
        cy = sum(p[1] for p in pts) / len(pts) + n.y * 0.3
        for r, (x0, y0, x1, y1), z0, z1 in self.occluders:
            if z0 <= min(zs) + 0.05 and z1 >= max(zs) - 0.05 and x0 <= cx <= x1 and y0 <= cy <= y1 \
                    and inside((cx, cy), r):
                return True
        return False

    def face(self, pts, mat):
        if self.cull and self.occluders and self.hidden(pts):
            return
        i = len(self.v)
        self.v.extend(tuple(p) for p in pts)
        self.f.append(tuple(range(i, i + len(pts))))
        self.m.append(MAT_INDEX[mat])

    def quad(self, p0, p1, z0, z1, mat, d=0.0, n=None):
        """vertical quad over the segment p0→p1 (outward = right of travel), pushed by d along n"""
        if n is not None and d:
            p0 = (p0[0] + n[0] * d, p0[1] + n[1] * d)
            p1 = (p1[0] + n[0] * d, p1[1] + n[1] * d)
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], mat)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def wall(g, r, z0, z1, mat):
    for p0, p1, L, t, n in edges(r):
        g.quad(p0, p1, z0, z1, mat)


def cap(g, rings, z, mat, down=False):
    """flat polygon (outer ring + holes) at height z, facing up (or down)"""
    flat = [p for r in rings for p in r]
    for tri in tessellate_polygon([[Vector((p[0], p[1], 0)) for p in r] for r in rings]):
        a, b, c = (flat[i] for i in tri)
        cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(cross) < 1e-9:
            continue
        if (cross < 0) != down:
            b, c = c, b
        g.face([(a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z)], mat)


def prism(g, r, z0, z1, mat, top='roof', holes=(), bottom=False):
    wall(g, r, z0, z1, mat)
    for h in holes:
        wall(g, h, z0, z1, mat)
    if top:
        cap(g, [r, *holes], z1, top)
    if bottom:
        cap(g, [r, *holes], z0, bottom if isinstance(bottom, str) else mat, down=True)


def annulus(g, inner, outer, z, mat, down=False):
    """flat ring between two rings with the same vertex count"""
    n = len(inner)
    for i in range(n):
        a, b, c, d = inner[i], inner[(i + 1) % n], outer[(i + 1) % n], outer[i]
        pts = [(a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z), (d[0], d[1], z)]
        g.face(pts if down else pts[::-1], mat)


def band(g, r, z0, z1, d, mat, top=True, bottom=True):
    """cornice / belt course: the ring pushed out by d between z0 and z1"""
    ro = offset(r, d)
    wall(g, ro, z0, z1, mat)
    if bottom:
        annulus(g, r, ro, z0, mat, down=True)
    if top:
        annulus(g, r, ro, z1, mat)


def parapet(g, r, z, h, w, mat, coping='roof', inner=None, roof='roof', holes=()):
    """wall continued h above the roof at z, coping of width w, inner face (inner=False: none), the roof inside"""
    ri = offset(r, -w)
    wall(g, r, z, z + h, mat)
    annulus(g, ri, r, z + h, coping)
    if inner is not False:
        wall(g, ri[::-1], z, z + h, inner or mat)
    if roof:
        cap(g, [ri, *holes], z, roof)


def box(g, c, u, hw, hd, z0, z1, mat, top=True, bottom=False):
    """box centred at c, half-extents hw along unit u, hd across it"""
    r = rect(c, u, hw, hd)
    wall(g, r, z0, z1, mat)
    if top:
        cap(g, [r], z1, top if isinstance(top, str) else mat)
    if bottom:
        cap(g, [r], z0, mat, down=True)


def slab_on_edge(g, p0, t, n, s0, s1, d0, d1, z0, z1, mat, top=False, bottom=False, back=False):
    """box on a wall edge: s along the tangent, d outwards from the wall, z up (front + ends, optional top)"""
    q = lambda s, d: (p0[0] + t[0] * s + n[0] * d, p0[1] + t[1] * s + n[1] * d)
    a, b, c, e = q(s0, d1), q(s1, d1), q(s1, d0), q(s0, d0)
    g.quad(a, b, z0, z1, mat)      # front
    g.quad(b, c, z0, z1, mat)      # right end
    g.quad(e, a, z0, z1, mat)      # left end
    if back:
        g.quad(c, e, z0, z1, mat)
    if top:
        g.face([(e[0], e[1], z1), (c[0], c[1], z1), (b[0], b[1], z1), (a[0], a[1], z1)],
               top if isinstance(top, str) else mat)
    if bottom:
        g.face([(a[0], a[1], z0), (b[0], b[1], z0), (c[0], c[1], z0), (e[0], e[1], z0)],
               bottom if isinstance(bottom, str) else mat)


def cone(g, c, z0, z1, r0, r1, segs, mat, top=True, bottom=False, rot=0.0):
    """frustum of a regular polygon (a cylinder when r0 == r1, a pyramid when r1 == 0)"""
    angles = [rot + 2 * math.pi * k / segs for k in range(segs)]
    a = [(c[0] + r0 * math.cos(t), c[1] + r0 * math.sin(t)) for t in angles]
    b = [(c[0] + r1 * math.cos(t), c[1] + r1 * math.sin(t)) for t in angles]
    for k in range(segs):
        k1 = (k + 1) % segs
        if r1 < 1e-4:
            g.face([(*a[k], z0), (*a[k1], z0), (c[0], c[1], z1)], mat)
        else:
            g.face([(*a[k], z0), (*a[k1], z0), (*b[k1], z1), (*b[k], z1)], mat)
    if top and r1 >= 1e-4:
        cap(g, [b], z1, top if isinstance(top, str) else mat)
    if bottom:
        cap(g, [a], z0, mat, down=True)


def attic(g, r, z, h, w=0.5, mat='wall', coping='trim', merlon=0.0, merlon_w=0.8, merlon_h=1.0, min_edge=4.0,
          roof='roof', only=None):
    """parapet crowned with a row of merlons (the Polish attic of the Palace): merlons on edges ≥ min_edge
    (and accepted by `only(p0, p1)`), spaced about `merlon` apart"""
    parapet(g, r, z, h, w, mat, coping=coping, roof=roof)
    if not merlon:
        return
    for p0, p1, L, t, n in edges(r):
        if L < min_edge or (only and not only(p0, p1)):
            continue
        k = max(1, int(L / merlon))
        for i in range(k):
            s = (i + 0.5) * L / k
            c = (p0[0] + t[0] * s - n[0] * w / 2, p0[1] + t[1] * s - n[1] * w / 2)
            box(g, c, t, merlon_w / 2, w / 2, z + h, z + h + merlon_h, mat, top=coping)


def pinnacle(g, c, u, z, w, h, mat='wall', tip='trim'):
    """square shaft with a pyramid tip"""
    box(g, c, u, w / 2, w / 2, z, z + h * 0.5, mat, top=False)
    cone(g, c, z + h * 0.5, z + h, w * 0.72, 0.0, 4, tip, rot=math.atan2(u[1], u[0]) + math.pi / 4)


def frustum_ring(g, r, z0, z1, s, mat):
    """walls tapering from ring r to r scaled by s about its centroid, with the top closed"""
    top = scale_ring(r, s)
    n = len(r)
    for i in range(n):
        a, b = r[i], r[(i + 1) % n]
        c, d = top[(i + 1) % n], top[i]
        g.face([(a[0], a[1], z0), (b[0], b[1], z0), (c[0], c[1], z1), (d[0], d[1], z1)], mat)
    cap(g, [top], z1, mat)


def near_ring(p, r, tol=0.5):
    """True when p lies on the boundary of ring r (within tol)"""
    for p0, p1, L, t, n in edges(r):
        s_ = max(0.0, min(L, (p[0] - p0[0]) * t[0] + (p[1] - p0[1]) * t[1]))
        if math.hypot(p0[0] + t[0] * s_ - p[0], p0[1] + t[1] * s_ - p[1]) < tol:
            return True
    return False


def clip(r, c, a):
    """the part of ring r on the side of the line through c where (p − c)·a ≤ 0 (Sutherland–Hodgman)"""
    side = lambda p: (p[0] - c[0]) * a[0] + (p[1] - c[1]) * a[1]
    out = []
    for i in range(len(r)):
        p, q = r[i], r[(i + 1) % len(r)]
        sp, sq = side(p), side(q)
        if sp <= 0:
            out.append(p)
        if (sp < 0 < sq) or (sq < 0 < sp):
            k = sp / (sp - sq)
            out.append((p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k))
    return ccw(simplify(out, 0.05))


def resample(r, n):
    """n points evenly spaced along the perimeter of a closed ring"""
    segs = list(edges(r))
    total = sum(e[2] for e in segs)
    out, k, acc = [], 0, 0.0
    for i in range(n):
        d = total * i / n
        while acc + segs[k][2] < d:
            acc += segs[k][2]
            k += 1
        p0, p1, L, t, _ = segs[k]
        out.append((p0[0] + t[0] * (d - acc), p0[1] + t[1] * (d - acc)))
    return out


def dome(g, r, z0, z1, mat, profile=((1.0, 0.0), (0.98, 0.28), (0.9, 0.56), (0.72, 0.8), (0.42, 0.95))):
    """glass bubble over a footprint ring: rings shrinking towards the centre, closed by a fan at the top"""
    c = centroid(r)
    rings = [(scale_ring(r, k, c), z0 + (z1 - z0) * f) for k, f in profile]
    n = len(r)
    for (ra, za), (rb, zb) in zip(rings, rings[1:]):
        for i in range(n):
            a, b, d, e = ra[i], ra[(i + 1) % n], rb[(i + 1) % n], rb[i]
            g.face([(a[0], a[1], za), (b[0], b[1], za), (d[0], d[1], zb), (e[0], e[1], zb)], mat)
    top, zt = rings[-1]
    for i in range(n):
        a, b = top[i], top[(i + 1) % n]
        g.face([(a[0], a[1], zt), (b[0], b[1], zt), (c[0], c[1], z1)], mat)


def ids_in_outline(sign_text):
    """OSM ids of the parts whose centroid lies inside the outline a map sign hangs on"""
    ring = next(sg[3] for sg in WORLD['signs'] if sg[0] == sign_text)
    ring = [(ring[i] / 10, ring[i + 1] / 10) for i in range(0, len(ring), 2)]
    out = []
    for osm, recs in RECORDS.items():
        f = recs[0][8]
        k = len(f) // 2
        if inside((sum(f[0::2]) / k / 10, sum(f[1::2]) / k / 10), ring):
            out.append(osm)
    return out


def sloped(g, r, z0, ztop, mat, top='roof', floor=0.0, band_h=0.0, band_d=0.12, band_mat='trim', first=None):
    """prism whose top follows ztop(point) (planar when ztop is linear), with optional floor bands that stop
    below the sloped top"""
    for p0, p1, L, t, n in edges(r):
        a, b = ztop(p0), ztop(p1)
        g.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], b), (p0[0], p0[1], a)], mat)
    if top:
        flat = list(r)
        for tri in tessellate_polygon([[Vector((p[0], p[1], 0)) for p in r]]):
            q = [flat[i] for i in tri]
            if (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) < 0:
                q = [q[0], q[2], q[1]]
            g.face([(x, y, ztop((x, y))) for x, y in q], top)
    if floor and band_h:
        ro = offset(r, band_d)
        z = (z0 if first is None else first) + floor
        while True:
            zb = z - band_h / 2
            done = True
            for i, (p0, p1, L, t, n) in enumerate(edges(r)):
                if zb + band_h < min(ztop(p0), ztop(p1)) - 0.3:
                    done = False
                    q0, q1 = ro[i], ro[(i + 1) % len(ro)]
                    g.quad(q0, q1, zb, zb + band_h, band_mat)
                    g.face([(q0[0], q0[1], zb), (q1[0], q1[1], zb), (p1[0], p1[1], zb), (p0[0], p0[1], zb)], band_mat)
            if done:
                break
            z += floor


def disc(g, c, n, z, radius, segs, mat, d=0.05):
    """vertical disc (clock face) centred at (c, z) facing the horizontal normal n"""
    t = (-n[1], n[0])
    pts = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        s, h = math.cos(a) * radius, math.sin(a) * radius
        pts.append((c[0] + t[0] * s + n[0] * d, c[1] + t[1] * s + n[1] * d, z + h))
    g.face(pts, mat)


# ───────────────────────── facade systems ─────────────────────────

def facade(g, r, z0, z1, *, bay, floor, win_h, sill=0.9, pier_w=1.2, pier_d=0.35, band_d=0.18, core='glass',
           pier='wall', spandrel=None, min_edge=2.5, first=None, pier_top=False, soffit=True, plinth=None):
    """recessed windows: glazing plane, piers every bay and a spandrel band per floor on every edge ≥ min_edge
    (shorter edges are plain wall); `soffit` adds the underside of the spandrels, `plinth` is the material of the
    band below the first sill"""
    spandrel = spandrel or pier
    first = z0 if first is None else first
    rows = []
    z = first
    while z + sill < z1 - 0.2:
        rows.append(z)
        z += floor
    spans = [(z0, first + sill, plinth or spandrel)] if first + sill > z0 + 0.05 else []
    for zr in rows:
        top = min(z1, zr + floor + sill)
        if zr + sill + win_h < top - 0.05 and top > z0:
            spans.append((max(z0, zr + sill + win_h), top, spandrel))
    for p0, p1, L, t, n in edges(r):
        if L < min_edge:
            g.quad(p0, p1, z0, z1, pier)
            continue
        g.quad(p0, p1, z0, z1, core)
        nb = max(1, round(L / bay))
        for i in range(nb + 1):
            s = L * i / nb
            s0, s1 = max(0.0, s - pier_w / 2), min(L, s + pier_w / 2)
            slab_on_edge(g, p0, t, n, s0, s1, 0.0, pier_d, z0, z1, pier, top=pier_top)
        q0 = (p0[0] + n[0] * band_d, p0[1] + n[1] * band_d)
        q1 = (p1[0] + n[0] * band_d, p1[1] + n[1] * band_d)
        for a, b, mat in spans:
            g.quad(q0, q1, a, b, mat)
            if soffit:
                g.face([(q0[0], q0[1], a), (q1[0], q1[1], a), (p1[0], p1[1], a), (p0[0], p0[1], a)], mat)


def curtain(g, r, z0, z1, *, floor, mull=1.5, mull_w=0.14, mull_d=0.22, band_h=0.8, band_d=0.08, glass='glass',
            mull_mat='frame', band_mat='frame', band_every=1):
    """glass curtain wall: glazing per edge, mullion fins about every `mull` metres (at the corners too; the many
    vertices of a curve share one fin per `mull`) and a slab band every `band_every` floors"""
    for p0, p1, L, t, n in edges(r):
        g.quad(p0, p1, z0, z1, glass)
    if mull:
        since = mull   # distance along the ring from the last fin to the start of the current edge
        for p0, p1, L, t, n in edges(r):
            k = max(1, round(L / mull))
            for i in range(k):
                s = L * i / k
                if since + s < mull * 0.6:
                    continue
                slab_on_edge(g, p0, t, n, max(0.0, s - mull_w / 2), min(L, s + mull_w / 2), 0.0, mull_d, z0, z1,
                             mull_mat)
                since = -s
            since += L
    if band_h:
        ro = offset(r, band_d)
        z = z0 + floor
        k = 1
        while z < z1 - 0.3:
            if k % band_every == 0:
                zb = z - band_h / 2
                wall(g, ro, zb, zb + band_h, band_mat)
                annulus(g, r, ro, zb, band_mat, down=True)
            z += floor
            k += 1


# ───────────────────────── heroes ─────────────────────────

HEROES = []


def hero(fn):
    HEROES.append(fn)
    return fn


@hero
def pkin():
    """Pałac Kultury i Nauki (Lev Rudnev, 1955): the whole complex of 15 OSM parts. The base body with its four
    diagonal wings and the Congress Hall (0–18 m) under attic storeys; the tower rises from the two 30 m body
    blocks: four 17.7 m corner towers to 67 m, the shaft with recessed face centres to 139 m (the 30th-floor
    cornice at 114 m, a pinnacle attic on top), the arcaded tier to 168 m, the clock tier with four clock faces,
    the crown, the bronze drum and the gilded lattice spire to 237 m. Sandstone ceramic cladding, vertical
    window strips between pilasters, Polish attics with merlons and pinnacles at every setback."""
    ids = [osm for osm, recs in RECORDS.items() if recs[0][6] == 'pkin']
    H = Hero(89352683, 'Pałac Kultury i Nauki', ids, tol=0.3)
    H.note = 'hero id and centroid = the main tower shaft 89352683 (67–139 m); all 15 parts styled pkin'
    H.tint = srgb('#c9b58c')
    g = H.g
    shaft = H.part(89352683)
    u = longest_edge(shaft.outer)[3]
    ang = math.degrees(math.atan2(u[1], u[0])) % 90
    u = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))

    # base body of the whole complex with the two courtyards
    base = H.part(1319250)
    BASE = 18.0
    facade(g, base.outer, 0, BASE - 1.6, bay=5.0, floor=5.2, win_h=3.2, sill=1.6, pier_w=2.0, pier_d=0.4,
           band_d=0.2, min_edge=4.5, first=0.0, soffit=False, plinth='wall2')
    for hole in base.holes:
        wall(g, hole, 0, BASE, 'wall')
    band(g, simplify(base.outer, 0.8), BASE - 1.6, BASE, 0.7, 'trim', top=False)
    cap(g, [base.outer, *base.holes], BASE, 'roof')

    H.mark('base body')
    # attic storeys of the wings, the entrance block and the Congress Hall
    for osm in (89354141, 89354142, 89354144, 89354146, 89354145, 89354149):
        for p in H.parts(osm):
            facade(g, p.outer, BASE, p.h - 1.3, bay=5.0, floor=9.0, win_h=1.6, sill=0.7, pier_w=2.4, pier_d=0.3,
                   band_d=0.15, min_edge=6.0, soffit=False)
            attic(g, p.outer, p.h - 1.3, 1.3, w=0.5)
    # main entrance portico towards Marszałkowska: columns before the base wall on the tower axis
    entrance = H.part(89354145).outer
    p0, p1, L, t, n = max(edges(entrance), key=lambda e: e[4][0])
    front = [e for e in edges(base.outer) if e[2] > 8 and e[4][0] * n[0] + e[4][1] * n[1] > 0.95
             and abs((e[0][0] - p0[0]) * n[1] - (e[0][1] - p0[1]) * n[0]) < L + 20]
    if front:
        q0, q1, QL, qt, qn = max(front, key=lambda e: (e[0][0] - p0[0]) * n[0] + (e[0][1] - p0[1]) * n[1])
        mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        sm = (mid[0] - q0[0]) * qt[0] + (mid[1] - q0[1]) * qt[1]
        # the colonnade stands in a shallow loggia so it stays within a metre of the outline
        slab_on_edge(g, q0, qt, qn, sm - 14.2, sm + 14.2, -1.6, 0.05, 0.8, 12.6, 'dark')
        for i in range(8):
            s_ = sm + (i - 3.5) * 3.4
            c = (q0[0] + qt[0] * s_ + qn[0] * 0.35, q0[1] + qt[1] * s_ + qn[1] * 0.35)
            cone(g, c, 0.8, 12.6, 0.62, 0.55, 8, 'trim', top=False)
        slab_on_edge(g, q0, qt, qn, sm - 14.6, sm + 14.6, 0.0, 1.0, 12.6, 14.6, 'trim', top='roof', bottom='wall')
        slab_on_edge(g, q0, qt, qn, sm - 15.0, sm + 15.0, 0.0, 1.0, 0.0, 0.8, 'wall2', top=True)
    H.mark('wing attic storeys, portico')
    # the two 30 m body blocks flanking the tower
    for osm in (89354143, 89354148):
        p = H.part(osm)
        facade(g, p.outer, BASE, p.h - 1.6, bay=3.8, floor=3.8, win_h=2.2, sill=0.9, pier_w=1.5, pier_d=0.35,
               band_d=0.18, min_edge=4.0, soffit=False)
        attic(g, p.outer, p.h - 1.6, 1.6, w=0.6, merlon=4.5, merlon_w=1.0, merlon_h=1.1, min_edge=8.0)

    H.mark('30 m body blocks')
    # tower: corner towers 18–67 m around the shaft footprint, then the shaft to 139 m
    lower = H.part(89352693)
    inner = shaft.outer
    on_shaft = lambda p: min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in inner) < 0.5
    tower_bay = dict(bay=3.3, floor=3.6, win_h=2.0, sill=1.0, pier_w=1.9, pier_d=0.45, band_d=0.12, min_edge=4.0,
                     soffit=False)
    facade(g, lower.outer, BASE, 62.5, first=BASE, **tower_bay)
    band(g, lower.outer, 62.5, 64.0, 0.6, 'trim')
    corner_edge = lambda p0, p1: not (on_shaft(p0) and on_shaft(p1))
    attic(g, lower.outer, 64.0, 1.8, w=0.6, merlon=3.2, merlon_w=1.0, merlon_h=1.3, min_edge=8.0, only=corner_edge)
    corners = [p for p in lower.outer if not on_shaft(p)]
    for c in corners:
        k = offset_point(lower.outer, c, -0.5)
        pinnacle(g, k, u, 65.8, 1.2, 5.5)

    H.mark('corner towers')
    facade(g, inner, 64.0, 114.0, first=BASE, **tower_bay)
    band(g, inner, 114.0, 115.4, 0.55, 'trim')
    facade(g, inner, 115.4, 133.0, first=115.4, **{**tower_bay, 'floor': 4.0, 'win_h': 2.6, 'pier_d': 0.55})
    band(g, inner, 133.0, 134.6, 0.8, 'trim')
    attic(g, inner, 134.6, 2.4, w=0.7, merlon=2.2, merlon_w=0.8, merlon_h=1.4, min_edge=3.0)
    for p in inner:
        pinnacle(g, offset_point(inner, p, -0.6), u, 137.0, 1.3, 8.0)

    H.mark('shaft')
    # arcaded tier 139–168 m
    arc = H.part(89352680).outer
    for p0, p1, L, t, n in edges(arc):
        g.quad(p0, p1, 137.0, 166.0, 'wall')
        for i in range(3):
            s = L * (i + 1) / 4
            slab_on_edge(g, p0, t, n, s - 1.5, s + 1.5, 0.02, 0.05, 150.0, 162.0, 'dark')
        for s in (0.0, L):
            slab_on_edge(g, p0, t, n, max(0, s - 1.6), min(L, s + 1.6), 0.0, 0.9, 137.0, 166.0, 'wall')
    band(g, arc, 147.0, 148.2, 0.5, 'trim')
    band(g, arc, 164.6, 166.0, 0.7, 'trim')
    attic(g, arc, 166.0, 1.6, w=0.5, merlon=2.0, merlon_w=0.7, merlon_h=1.1, min_edge=3.0)
    for p in arc:
        pinnacle(g, offset_point(arc, p, -0.3), u, 167.6, 1.1, 6.0)
    for p0, p1, L, t, n in edges(arc):
        for s in (L / 3, 2 * L / 3):
            pinnacle(g, (p0[0] + t[0] * s - n[0] * 0.3, p0[1] + t[1] * s - n[1] * 0.3), u, 167.6, 0.8, 4.0)

    H.mark('arcaded tier')
    # clock tier, crown, drum and spire
    clock = H.part(89352677).outer
    wall(g, clock, 166.0, 186.0, 'wall')
    for p0, p1, L, t, n in edges(clock):
        for s in (0.0, L):
            slab_on_edge(g, p0, t, n, max(0, s - 1.2), min(L, s + 1.2), 0.0, 0.6, 166.0, 186.0, 'wall')
        mid = (p0[0] + t[0] * L / 2, p0[1] + t[1] * L / 2)
        disc(g, mid, n, 176.5, 2.9, 16, 'trim', d=0.08)
        slab_on_edge(g, p0, t, n, L / 2 - 0.12, L / 2 + 0.12, 0.1, 0.16, 176.5, 178.9, 'dark')
        slab_on_edge(g, p0, t, n, L / 2 - 0.1, L / 2 + 1.8, 0.1, 0.16, 176.4, 176.6, 'dark')
        for s in (L * 0.3, L * 0.5, L * 0.7):
            slab_on_edge(g, p0, t, n, s - 0.5, s + 0.5, 0.02, 0.05, 181.0, 184.5, 'dark')
    band(g, clock, 170.5, 171.3, 0.4, 'trim')
    band(g, clock, 185.0, 186.2, 0.6, 'trim')
    crown = H.part(240119158).outer
    attic(g, clock, 186.2, 1.2, w=0.5, merlon=1.6, merlon_w=0.5, merlon_h=0.9, min_edge=3.0, roof=None)
    cap(g, [offset(clock, -0.5)], 186.2, 'roof')
    for p in clock:
        pinnacle(g, offset_point(clock, p, -0.25), u, 187.4, 0.8, 4.2)
    wall(g, crown, 186.2, 191.0, 'wall')
    cap(g, [crown], 191.0, 'roof')
    frustum_ring(g, crown, 191.0, 194.0, 0.62, 'trim')
    c = centroid(H.part(240119160).outer)
    cone(g, c, 194.0, 196.5, 2.0, 2.4, 8, 'metal', top=False)
    cone(g, c, 196.5, 200.5, 2.4, 1.2, 8, 'metal', top=False)
    cone(g, c, 200.5, 203.0, 1.2, 0.9, 8, 'gold', top=False)
    cone(g, c, 203.0, 237.0, 0.9, 0.0, 4, 'gold', rot=math.radians(ang) + math.pi / 4)
    for z, rr in ((210.0, 1.3), (219.0, 1.0), (227.0, 0.7)):
        cone(g, c, z, z + 0.6, rr, rr * 0.6, 4, 'gold', top=False, rot=math.radians(ang) + math.pi / 4)

    H.mark('clock tier, crown, spire')
    H.view = (60, 14)
    H.detail = ((-14, -14, 130), (14, 14, 237))
    H.detail_view = (60, 8)
    return H


@hero
def zlote_tarasy():
    """Złote Tarasy (Jerde Partnership, 2007), outline way 30611687: the atrium under eight undulating glass
    bubbles, the shopping mall ring (0–17 m) in terracotta and beige stone with shop fronts and canopies, the two
    crescents of the Lumen offices (17–55 m) with ribbon windows, the Skylight tower (105 m) with its curved glass
    face, the south-west office block with the teal roof pavilion and the glass rotunda with the white ring"""
    ids = ids_in_outline('ZŁOTE TARASY')
    H = Hero(237574573, 'Złote Tarasy', ids, tol=0.35)
    H.note = 'outline way 30611687 is not in buildings[] (drawn as parts); hero id and centroid = atrium part 237574573'
    H.tint = srgb('#e7d3a8')
    g = H.g
    P = H.part
    mall = [238317277, 983268131, 983268132, 238317273, 238317278, 239721518, 1451160863, 237566782, 239721520,
            1451160836, 1451160862, 983068954]
    offices = [983068953, 238317271, 238711087, 239721519, 239721532]
    lumen, skylight, rotunda = [89365019, 89365020], 89365021, 237541404
    for osm in mall + offices + lumen + [skylight, rotunda, 1451160844]:
        p = P(osm)
        g.occlude(p.outer, p.min_h, p.h)

    # shopping mall ring: stone piers between shop windows, a canopy, stone bands above
    for osm in mall:
        p = P(osm)
        z0 = p.min_h
        shop = min(p.h, 5.0)
        if z0 < 1.0:
            facade(g, p.outer, 0.0, shop, bay=8.0, floor=20.0, win_h=4.2, sill=0.35, pier_w=1.2, pier_d=0.3,
                   pier='wall2', min_edge=5.0, soffit=False)
            band(g, simplify(p.outer, 0.8), shop, shop + 0.5, 0.9, 'metal', top=True, bottom=True)
            z0 = shop
        wall(g, p.outer, z0, p.h, 'wall')
        if p.h - z0 > 6:
            band(g, simplify(p.outer, 0.8), z0 + 3.2, z0 + 5.4, 0.12, 'wall2', top=False)
        parapet(g, p.outer, p.h, 0.9, 0.3, 'wall', coping='metal', inner=False)
        if p.min_h > 1.0:
            cap(g, [p.outer], p.min_h, 'wall2', down=True)
    kiosk = P(1451160858)
    prism(g, kiosk.outer, 0, kiosk.h, 'sign', top='roof')
    H.mark('mall ring')

    # office floors over the mall (Lumen crescents, the south-west block, the upper wings)
    def ribbons(p, floor, top_setback=True, spandrel='wall'):
        z1 = p.h - (floor if top_setback else 0)
        r = simplify(p.outer, 0.5)
        curtain(g, r, p.min_h, z1, floor=floor, mull=0, band_h=floor * 0.42, band_d=0.22, band_mat=spandrel)
        if top_setback:
            inner = offset(r, -1.4)
            annulus(g, inner, r, z1, 'roof')
            wall(g, inner, z1, p.h - 0.4, 'glass')
            band(g, inner, p.h - 0.4, p.h, 1.6, 'metal')
            cap(g, [inner], p.h, 'roof')
        else:
            parapet(g, r, p.h, 1.0, 0.3, spandrel, coping='metal')
    for osm in lumen:
        ribbons(P(osm), 2.95)
    for osm in offices:
        ribbons(P(osm), 3.5, top_setback=P(osm).h > 30)
    pav = P(1451160844)
    wall(g, pav.outer, pav.min_h, pav.h - 0.6, 'glass')
    frustum_ring(g, offset(pav.outer, 0.6), pav.h - 0.6, pav.h + 1.5, 0.93, 'metal')
    disc_top = P(239721531)
    cone(g, centroid(disc_top.outer), disc_top.min_h, disc_top.h, 5.0, 3.5, 12, 'trim', top='glass')
    H.mark('offices')

    # Skylight: glass lobby, ribbon floors, glazed crown
    sk = P(skylight)
    r = simplify(sk.outer, 0.4)
    curtain(g, r, 0.0, 9.0, floor=4.5, mull=3.0, band_h=0.6, band_d=0.1, mull_d=0.25)
    curtain(g, r, 9.0, sk.h - 6.0, floor=3.7, mull=3.7, mull_w=0.2, mull_d=0.15, band_h=1.5, band_d=0.25,
            band_mat='wall')
    curtain(g, offset(r, 0.25), sk.h - 6.0, sk.h, floor=0, mull=2.4, band_h=0, mull_d=0.3, mull_mat='frame')
    annulus(g, offset(r, -0.2), offset(r, 0.25), sk.h, 'metal')
    wall(g, offset(r, -0.2)[::-1], sk.h - 2.5, sk.h, 'frame')
    cap(g, [offset(r, -0.2)], sk.h - 2.5, 'roof')
    H.mark('Skylight')

    # rotunda with the white ring roof around a glass eye
    ro = P(rotunda)
    rr = resample(ro.outer, 16)
    curtain(g, rr, 0.0, ro.h - 1.5, floor=4.2, mull=4.0, band_h=0.5, band_d=0.1, band_every=2)
    band(g, rr, ro.h - 1.5, ro.h, 0.8, 'trim')
    eye = scale_ring(rr, 0.55)
    annulus(g, eye, offset(rr, 0.8), ro.h, 'trim')
    wall(g, eye[::-1], ro.h - 1.2, ro.h, 'trim')
    cap(g, [eye], ro.h - 1.2, 'glass')
    H.mark('rotunda')

    # the atrium: a low glazed skirt and the bubbles above it
    skirt = P(237574573)
    curtain(g, simplify(skirt.outer, 0.6), 0.0, 14.0, floor=4.6, mull=0, band_h=0.4, band_d=0.12)
    for p in (P(osm) for osm in ids if RECORDS[osm][0][3] == '#336699' and RECORDS[osm][0][0] >= 200):
        dome(g, resample(p.outer, 20), 13.0, p.h + 2.0, 'glass')
    H.mark('bubbles')

    H.view = (312, 34)
    H.detail = ((-60, -50, 0), (60, 60, 45))
    H.detail_view = (20, 26)
    return H


@hero
def centralna():
    """Warszawa Centralna (Arseniusz Romanowicz, 1975), outline way 367491792: the glazed main hall and the two
    lower end halls under one thin roof slab that runs straight along Aleje Jerozolimskie and flares up towards
    the long edges (the short ends sag to 11.5 m in the middle); a white fascia, a ribbed soffit, slender columns,
    dark two-storey curtain walls with a mezzanine band and the name light boxes on the short ends"""
    ids = ids_in_outline('WARSZAWA CENTRALNA')
    H = Hero(226156055, 'Warszawa Centralna', ids, tol=0.4)
    H.note = 'outline way 367491792 is not in buildings[] (drawn as parts); hero id and centroid = main hall 226156055'
    H.tint = srgb('#bcbaab')
    g = H.g
    hall = H.part(226156055)
    # u across the hall (towards Aleje Jerozolimskie), v along its long axis
    e = longest_edge(hall.outer)[3]
    span = lambda osm, axis: [p[0] * axis[0] + p[1] * axis[1] for p in H.part(osm).outer]
    extent = lambda d: max(span(226156055, d)) - min(span(226156055, d))
    v = e if extent(e) > extent((-e[1], e[0])) else (-e[1], e[0])
    u = (v[1], -v[0])
    at = lambda a, b: (u[0] * a + v[0] * b, u[1] * a + v[1] * b)
    everything = [osm for osm in ids if osm != 23029808]
    U0, U1 = min(span(23029808, u)), max(span(23029808, u))     # the roof is as wide as the plinth
    V0, V1 = min(min(span(o, v)) for o in everything), max(max(span(o, v)) for o in everything)
    HU0, HU1 = min(span(226156055, u)), max(span(226156055, u))
    HV0, HV1 = min(span(226156055, v)), max(span(226156055, v))
    box_ring = lambda a0, a1, b0, b1: [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)]

    # plinth with steps, then the halls
    plinth = H.part(23029808)
    prism(g, simplify(plinth.outer, 0.8), 0.0, 1.0, 'wall2', top='wall2')
    main = box_ring(HU0 + 5.0, HU1 - 5.0, HV0 + 1.0, HV1 - 1.0)
    curtain(g, main, 1.0, 12.0, floor=5.5, mull=3.0, mull_w=0.18, mull_d=0.3, band_h=1.1, band_d=0.2,
            band_mat='trim')
    ends = [box_ring(HU0 + 3.0, HU1 - 3.0, V0 + 1.5, HV0 + 1.0), box_ring(HU0 + 3.0, HU1 - 3.0, HV1 - 1.0, V1 - 1.5)]
    g.occlude(main, 1.0, 12.0)
    for r in ends:
        wall(g, r, 1.0, 5.0, 'glass')
        wall(g, r, 5.0, 10.5, 'wall2')
    g.occluders.clear()
    for sgn, b0 in ((-1, V0 + 1.5), (1, V1 - 1.5)):
        # dark band with the name light box on the short end, entrance canopy below
        n = (v[0] * sgn, v[1] * sgn)
        base = at(0.0, b0)
        t = (-n[1], n[0])
        slab_on_edge(g, base, t, n, -17.0, 17.0, 0.0, 0.35, 6.6, 8.8, 'sign', top=True, bottom=True)
        slab_on_edge(g, base, t, n, -22.0, 22.0, 0.0, 2.5, 4.6, 5.0, 'metal', top=True, bottom=True)
    H.mark('halls')

    # the roof: a ruled surface along v, flaring up towards the long edges
    lift = lambda a: 3.0 * max(0.0, (abs(a - (U0 + U1) / 2) / ((U1 - U0) / 2) - 0.3) / 0.7) ** 2
    us = [U0 + (U1 - U0) * k / 10 for k in range(11)]
    top = [(a, 13.9 + lift(a)) for a in us]
    bot = [(a, 12.0 + lift(a)) for a in us]
    for (a0, z0), (a1, z1) in zip(top, top[1:]):
        g.face([(*at(a0, V1), z0), (*at(a0, V0), z0), (*at(a1, V0), z1), (*at(a1, V1), z1)], 'roof')
    for (a0, z0), (a1, z1) in zip(bot, bot[1:]):
        g.face([(*at(a0, V0), z0), (*at(a0, V1), z0), (*at(a1, V1), z1), (*at(a1, V0), z1)], 'wall2')
    for (a0, zt0), (a1, zt1), (_, zb0), (_, zb1) in zip(top, top[1:], bot, bot[1:]):
        g.face([(*at(a0, V0), zb0), (*at(a1, V0), zb1), (*at(a1, V0), zt1), (*at(a0, V0), zt0)], 'trim')
        g.face([(*at(a1, V1), zb1), (*at(a0, V1), zb0), (*at(a0, V1), zt0), (*at(a1, V1), zt1)], 'trim')
    for a, zt_, zb_ in ((U0, top[0][1], bot[0][1]), (U1, top[-1][1], bot[-1][1])):
        sgn = -1 if a == U0 else 1
        pa, pb = at(a, V0), at(a, V1)
        pts = [(*pa, zb_), (*pb, zb_), (*pb, zt_), (*pa, zt_)]
        g.face(pts if sgn > 0 else [pts[1], pts[0], pts[3], pts[2]], 'trim')
    # soffit ribs across the hall
    k = int((V1 - V0) / 7.0)
    for i in range(1, k):
        b = V0 + (V1 - V0) * i / k
        for (a0, z0), (a1, z1) in zip(bot, bot[1:]):
            for side, bb in ((1, b + 0.25), (-1, b - 0.25)):
                q = [(*at(a0, bb), z0), (*at(a1, bb), z1), (*at(a1, bb), z1 - 0.7), (*at(a0, bb), z0 - 0.7)]
                g.face(q if side > 0 else [q[1], q[0], q[3], q[2]], 'wall2')
    H.mark('roof')

    # columns under the flared edges
    for a in (U0 + 2.2, U1 - 2.2):
        for b in (V0 + 8.0, (V0 + V1) / 2 - 20.0, (V0 + V1) / 2 + 20.0, V1 - 8.0):
            cone(g, at(a, b), 1.0, 12.0 + lift(a), 0.8, 0.65, 8, 'trim', top=False)
    # glazed pavilions of the underground passages
    for osm in (1429115631, 1429115632):
        p = H.part(osm)
        prism(g, p.outer, 0.0, p.h, 'glass', top='metal')
        band(g, p.outer, p.h - 0.4, p.h, 0.4, 'metal')
    H.mark('columns, pavilions')

    H.view = (45, 12)
    H.detail = ((-45, -60, 0), (45, 60, 18))
    H.detail_view = (115, 6)
    return H


@hero
def varso():
    """Varso Tower (Foster + Partners, 2022), outline way 693894333: two glass slabs (north to 177 m, south to
    205 m) with a fine mullion grid and a transom every second floor, dark stone fins down the short ends, the
    glazed observation box to 230 m inside a dark louvred crown frame to 234 m, and the mast with four ring
    platforms to 310 m; a low glass lobby pavilion on the west side"""
    ids = [875519280, 875519279, 875519281, 875519277, 875519282, 912427955, 984842458, 984842460, 984842461,
           984842462, 984842463, 984842464, 984842466, 984842486, 984842487, 984842488, 984842489, 1429126526,
           1429126527, 1429126528, 1429126529, 1429126530, 1429126531]
    H = Hero(875519280, 'Varso Tower', ids, tol=0.6)
    H.note = 'outline way 693894333 is not in buildings[]; hero id and centroid = main slab part 875519280'
    g = H.g
    P = H.part
    north, south, top = P(875519279), P(875519280), P(875519281)
    for p in (north, south):
        g.occlude(p.outer, 0.0, p.h)

    lobby = H.part(984842458, tol=0.2)
    curtain(g, lobby.outer, 0.0, lobby.h - 1.0, floor=5.5, mull=2.5, band_h=0.3, band_d=0.1)
    band(g, lobby.outer, lobby.h - 1.0, lobby.h, 0.5, 'metal')
    cap(g, [lobby.outer], lobby.h, 'roof')
    H.mark('lobby')

    for p in (north, south):
        curtain(g, p.outer, 0.0, 8.0, floor=8.0, mull=3.0, mull_w=0.25, mull_d=0.35, band_h=0, glass='glass')
        curtain(g, p.outer, 8.0, p.h, floor=8.0, mull=3.0, mull_w=0.12, mull_d=0.25, band_h=0.35, band_d=0.12)
        band(g, p.outer, 7.6, 8.4, 0.5, 'metal')
    crown_n = P(1429126531)
    wall(g, crown_n.outer, north.h, crown_n.h, 'glass')
    cap(g, [north.outer], north.h, 'roof')
    for osm in (1429126528, 1429126529, 1429126530):
        p = P(osm)
        prism(g, p.outer, p.min_h, p.h, 'glass', top='metal')
    H.mark('glass slabs')

    # glazed observation box, terrace slab, crown frame and the dark fins of the short ends
    g.occluders.clear()
    cap(g, [south.outer], south.h, 'roof')
    box_ring = offset(simplify(top.outer, 1.0), -2.2)
    curtain(g, box_ring, south.h, top.h - 4.0, floor=4.2, mull=3.0, mull_w=0.12, mull_d=0.2, band_h=0.3)
    band(g, box_ring, top.h - 4.0, top.h - 3.2, 1.2, 'metal')
    wall(g, offset(box_ring, -1.0), top.h - 3.2, top.h, 'glass')
    cap(g, [offset(box_ring, -1.0)], top.h, 'roof')
    for osm in (984842460, 984842461, 984842462):
        p = P(osm)
        prism(g, p.outer, p.min_h, p.h, 'metal', top='roof')
    for osm in (984842463, 984842464, 984842466, 1429126526, 1429126527):
        p = P(osm)
        r = simplify(p.outer, 0.3)
        wall(g, r, p.min_h, p.h, 'metal')
        cap(g, [r], p.h, 'metal')
        cap(g, [r], p.min_h, 'metal', down=True)
        for p0, p1, L, t, n in edges(r):
            if L < 6.0:
                continue
            k = int(L / 1.6)
            for i in range(1, k):
                slab_on_edge(g, p0, t, n, L * i / k - 0.08, L * i / k + 0.08, 0.0, 0.45, p.min_h + 1.0, p.h - 1.0,
                             'frame')
    for osm in (984842486, 984842487, 984842488, 984842489):
        p = P(osm)
        prism(g, simplify(p.outer, 0.3), 0.0, p.h, 'metal', top='metal')
    H.mark('crown')

    # the mast: lattice shaft (a tapered square) with four ring platforms
    base, mid, tip = P(875519282), P(875519277), P(912427955)
    c = centroid(base.outer)
    u = longest_edge(south.outer)[3]
    rot = math.atan2(u[1], u[0]) + math.pi / 4
    cone(g, c, base.min_h, base.h, 2.0, 1.5, 4, 'metal', top=False, rot=rot)
    cone(g, c, mid.min_h, mid.h, 1.5, 1.0, 4, 'frame', top=False, rot=rot)
    cone(g, c, tip.min_h, tip.h - 14.0, 1.0, 0.5, 4, 'frame', top=False, rot=rot)
    cone(g, c, tip.h - 14.0, tip.h, 0.3, 0.05, 6, 'frame', top=False)
    for z, rr in ((240.0, 2.4), (262.0, 2.8), (274.0, 3.2), (287.0, 3.8)):
        cone(g, c, z, z + 1.2, rr, rr * 0.8, 10, 'frame', top=True, bottom=True)
    H.mark('mast')

    H.view = (250, 10)
    H.detail = ((-40, -30, 170), (40, 30, 240))
    H.detail_view = (215, 14)
    return H


@hero
def zlota44():
    """Złota 44 (Daniel Libeskind, 2013), outline way 33068248: the 180 m residential core wrapped on the north,
    east and south by the glass "sail" that bulges out from 36 m (8 m at the south end) and whose top edge rises
    to the sharp 192 m tip at the south, ending in an open steel frame; white slab stripes on every floor; the
    banded podium with the pool on the east"""
    ids = [239175870, 982221142, 982221143, 982221144, 982799287, 239175869, 979893146]
    H = Hero(239175870, 'Złota 44', ids, tol=0.2)
    H.note = 'outline way 33068248 is not in buildings[]; hero id and centroid = the core part 239175870'
    g = H.g
    P = H.part
    core, sail = P(239175870), P(982221142)
    # the sail's top plane: 192 m at its southern tip, falling towards the north end
    north = max(sail.outer, key=lambda p: p[1])
    south = min(sail.outer, key=lambda p: p[1])
    ztop = lambda p: sail.h - (sail.h - 164.0) * (p[1] - south[1]) / (north[1] - south[1])
    FL = 3.35

    g.occlude(core.outer, 0.0, core.h)
    for osm in (239175869, 979893146):
        p = P(osm)
        g.occlude(p.outer, 0.0, p.h)
    # the core
    curtain(g, core.outer, 0.0, core.h, floor=FL, mull=2.2, mull_w=0.1, mull_d=0.12, band_h=1.15, band_d=0.14,
            band_mat='trim')
    parapet(g, core.outer, core.h, 1.4, 0.3, 'glass', coping='metal')
    H.mark('core')

    # the lower sail strips and the sail
    g.occluders.clear()
    g.occlude(core.outer, 0.0, core.h)
    for osm in (982221143, 982221144, 982799287):
        p = P(osm)
        r = simplify(p.outer, 0.2)
        wall(g, r, p.min_h, p.h, 'glass')
        cap(g, [r], p.min_h, 'trim', down=True)
        z = p.min_h + FL
        ro = offset(r, 0.12)
        while z < p.h - 0.4:
            wall(g, ro, z - 0.45, z + 0.45, 'trim')
            annulus(g, r, ro, z - 0.45, 'trim', down=True)
            z += FL
    r = simplify(sail.outer, 0.2)
    sloped(g, r, sail.min_h, ztop, 'glass', top=None, floor=FL, band_h=0.9, band_d=0.12,
           first=sail.min_h - (sail.min_h % FL))
    cap(g, [r], sail.min_h, 'trim', down=True)
    H.mark('sail')

    # the glazing runs past the sail's roof as a screen with a steel top chord; the roof 6 m lower inside
    g.occluders.clear()
    inner = offset(r, -0.35)
    for p0, p1, L, t, n in edges(inner[::-1]):
        a, b = ztop(p0), ztop(p1)
        g.face([(p0[0], p0[1], a - 6.0), (p1[0], p1[1], b - 6.0), (p1[0], p1[1], b), (p0[0], p0[1], a)], 'glass')
    for tri in tessellate_polygon([[Vector((p[0], p[1], 0)) for p in inner]]):
        q = [inner[i] for i in tri]
        if (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) < 0:
            q = [q[0], q[2], q[1]]
        g.face([(x, y, ztop((x, y)) - 6.0) for x, y in q], 'roof')
    for i in range(len(r)):
        a0, b0, a1, b1 = inner[i], r[i], inner[(i + 1) % len(r)], r[(i + 1) % len(r)]
        g.face([(a1[0], a1[1], ztop(a1)), (b1[0], b1[1], ztop(b1)), (b0[0], b0[1], ztop(b0)), (a0[0], a0[1], ztop(a0))],
               'frame')
    H.mark('crown screen')

    # podium
    for osm in (239175869, 979893146):
        p = P(osm)
        curtain(g, p.outer, 0.0, p.h, floor=4.0, mull=3.0, mull_w=0.12, mull_d=0.15, band_h=1.1, band_d=0.2,
                band_mat='trim')
        parapet(g, p.outer, p.h, 1.0, 0.3, 'trim', coping='metal', inner=False)
    H.mark('podium')

    H.view = (70, 12)
    H.detail = ((-30, -25, 140), (30, 35, 195))
    H.detail_view = (120, 10)
    return H


@hero
def rondo1():
    """Rondo 1 (SOM with AZO, 2006), outline way 30621990: the 159 m glass slab with light spandrel lines, its
    rounded north end and a louvred crown screen; the south end steps down in glass terraces with deep vertical
    fins (146, 125, 100, 80, 30 m); the broadcast mast to 192 m; the ten-storey gallery podium to the north-east"""
    ids = [234881014, 234881016, 234881017, 234881018, 234881019, 234881020, 234881021, 234881022, 234881024,
           982243251, 982243252, 982243253, 982243254, 982243255, 982243256, 982243257, 982243258, 983017995,
           983017996]
    H = Hero(234881014, 'Rondo 1', ids, tol=0.45)
    H.note = 'outline way 30621990 is not in buildings[]; hero id and centroid = the main slab 234881014'
    g = H.g
    P = H.part
    slab = P(234881014)
    steps = [P(o) for o in (234881020, 234881021, 234881016, 234881022, 234881017, 234881024, 234881019)]
    podium = [P(o) for o in ids if o not in (234881014, 234881016, 234881017, 234881019, 234881020, 234881021,
                                             234881022, 234881024)]
    for p in [slab] + steps + podium:
        g.occlude(p.outer, p.min_h, p.h)

    curtain(g, slab.outer, 0.0, slab.h, floor=4.0, mull=1.6, mull_w=0.1, mull_d=0.15, band_h=0.8, band_d=0.12)
    screen = offset(slab.outer, 0.1)
    g.cull = False
    wall(g, screen, slab.h, slab.h + 7.0, 'glass')
    z = slab.h + 1.0
    while z < slab.h + 7.0:
        band(g, screen, z, z + 0.35, 0.25, 'frame', top=False)
        z += 1.2
    wall(g, offset(screen, -0.4)[::-1], slab.h, slab.h + 7.0, 'frame')
    cap(g, [offset(screen, -0.4)], slab.h + 1.0, 'roof')
    g.cull = True
    H.mark('slab')

    for p in steps:
        curtain(g, p.outer, 0.0, p.h, floor=4.0, mull=1.5, mull_w=0.14, mull_d=0.5, band_h=0.4, band_d=0.1)
        g.cull = False
        parapet(g, p.outer, p.h, 1.4, 0.3, 'glass', coping='metal', inner=False)
        g.cull = True
    H.mark('stepped south end')

    for p in podium:
        if p.h - p.min_h < 3.0:
            continue
        curtain(g, p.outer, p.min_h, p.h, floor=4.0, mull=3.0, mull_w=0.12, mull_d=0.15, band_h=1.3, band_d=0.2,
                band_mat='wall')
        cap(g, [p.outer], p.h, 'roof')
        if p.min_h > 0.5:
            cap(g, [p.outer], p.min_h, 'wall', down=True)
    H.mark('podium')

    g.occluders.clear()
    c = centroid(steps[0].outer)
    u = longest_edge(slab.outer)[3]
    rot = math.atan2(u[1], u[0]) + math.pi / 4
    cone(g, c, slab.h, slab.h + 20.0, 0.9, 0.55, 4, 'frame', top=False, rot=rot)
    cone(g, c, slab.h + 20.0, 192.0, 0.3, 0.05, 4, 'metal', top=False, rot=rot)
    for z in (slab.h + 8.0, slab.h + 16.0):
        cone(g, c, z, z + 0.4, 1.6, 1.6, 8, 'frame', top=True, bottom=True)
    H.mark('mast')

    H.view = (230, 12)
    H.detail = ((-40, -50, 110), (40, 50, 192))
    H.detail_view = (250, 10)
    return H


@hero
def wfc():
    """Warsaw Financial Center (Kohn Pedersen Fox, 1999), outline way 30621656: the 144 m block of white stone
    bands and dark ribbon windows whose curved south-east face rises out of the 130 m green-glass wing, a glazed
    crown, the stone and glass base (0–20 m) and the podium on Emilii Plater"""
    ids = [235880567, 235880566, 235880568, 235880569]
    H = Hero(235880567, 'Warsaw Financial Center', ids, tol=0.3)
    H.note = 'outline way 30621656 is not in buildings[] (parts start at 19.8 m); hero id and centroid = 235880567'
    H.tint = srgb('#d8d2c2')
    g = H.g
    P = H.part
    main, wing, strip, pod = P(235880567), P(235880566), P(235880568), P(235880569)
    for p in (main, wing, strip):
        g.occlude(p.outer, 0.0, p.h)
    g.occlude(pod.outer, pod.min_h, pod.h)

    # base storeys under the tower parts: stone piers and tall glazing
    for p in (main, wing):
        facade(g, p.outer, 0.0, p.min_h, bay=6.0, floor=10.0, win_h=7.5, sill=0.4, pier_w=1.4, pier_d=0.5,
               pier='wall', spandrel='wall', min_edge=3.0, soffit=False)
    H.mark('base')
    # the stone block: white spandrel bands, ribbon windows, vertical stone piers at the corners
    curtain(g, main.outer, main.min_h, main.h - 7.5, floor=3.7, mull=6.0, mull_w=0.35, mull_d=0.3, band_h=1.7,
            band_d=0.3, band_mat='wall', mull_mat='wall')
    curtain(g, strip.outer, strip.min_h, strip.h, floor=3.7, mull=0, band_h=1.7, band_d=0.3, band_mat='wall')
    g.occluders.clear()
    curtain(g, main.outer, main.h - 7.5, main.h, floor=3.7, mull=1.8, mull_w=0.12, mull_d=0.2, band_h=0.4, band_d=0.1)
    band(g, main.outer, main.h - 0.8, main.h, 0.5, 'wall')
    cap(g, [main.outer], main.h - 0.8, 'roof')
    for p in (main, wing, strip):
        g.occlude(p.outer, 0.0, p.h)
    H.mark('stone block')
    # the green glass wing with a fine white grid
    curtain(g, wing.outer, wing.min_h, wing.h, floor=3.7, mull=1.5, mull_w=0.12, mull_d=0.18, band_h=0.35,
            band_d=0.1, band_mat='trim', mull_mat='trim')
    g.occluders.clear()
    parapet(g, wing.outer, wing.h, 1.6, 0.3, 'glass', coping='trim', inner=False)
    H.mark('glass wing')
    curtain(g, pod.outer, pod.min_h, pod.h, floor=3.5, mull=3.0, mull_w=0.2, mull_d=0.2, band_h=1.2, band_d=0.15,
            band_mat='wall')
    cap(g, [pod.outer], pod.h, 'roof')
    cap(g, [pod.outer], pod.min_h, 'wall', down=True)
    H.mark('podium')

    H.view = (40, 12)
    H.detail = ((-35, -35, 90), (35, 30, 146))
    H.detail_view = (95, 10)
    return H


@hero
def intercontinental():
    """InterContinental Warszawa (Tadeusz Spychała, 2003), outline way 30611691: a 164 m tower of pale green
    glass behind a dense grid of white mullions; the glazed base storeys to 16.5 m, then only the south-west half
    of the plan rises to 70 m — the upper tower cantilevers over a diagonal void that keeps the light for the
    neighbouring houses, lined by a dark stone wall; a thin diagonal blade on the roof reaches 164 m"""
    ids = [234915955, 234915952, 239168064, 234915947, 234915949]
    H = Hero(234915955, 'InterContinental', ids, tol=0.25)
    H.note = ('outline way 30611691 is not in buildings[] (parts start at 16.5 m); '
              'hero id and centroid = upper tower 234915955')
    g = H.g
    P = H.part
    upper, lower, sliver, tiny, blade = P(234915955), P(234915952), P(239168064), P(234915947), P(234915949)
    grid = dict(mull=1.35, mull_w=0.12, mull_d=0.22, band_h=0.3, band_d=0.08, band_mat='trim', mull_mat='trim')

    # glazed base storeys over the full plan, a canopy
    curtain(g, upper.outer, 0.0, lower.min_h, floor=5.5, mull=4.0, mull_w=0.5, mull_d=0.4, band_h=0.8,
            band_d=0.25, band_mat='wall2', mull_mat='wall2')
    band(g, upper.outer, lower.min_h - 1.2, lower.min_h, 0.8, 'wall2')
    cap(g, [upper.outer], lower.min_h, 'roof')
    H.mark('base')

    # lower block on the south-west half; the faces towards the void are dark stone
    for p in (lower, sliver, tiny):
        g.occlude(p.outer, p.min_h, p.h)
    for p in (lower, sliver, tiny):
        for p0, p1, L, t, n in edges(p.outer):
            if near_ring(p0, upper.outer) and near_ring(p1, upper.outer) and \
                    near_ring(((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), upper.outer):
                g.quad(p0, p1, p.min_h, upper.min_h, 'glass')
                k = max(1, round(L / grid['mull']))
                for i in range(k + 1):
                    s_ = L * i / k
                    slab_on_edge(g, p0, t, n, max(0, s_ - 0.06), min(L, s_ + 0.06), 0.0, 0.22, p.min_h, upper.min_h,
                                 'trim')
                z = p.min_h + 3.3
                while z < upper.min_h - 0.3:
                    g.quad(p0, p1, z - 0.15, z + 0.15, 'trim', d=0.08, n=n)
                    z += 3.3
            else:
                g.quad(p0, p1, p.min_h, upper.min_h, 'wall2')
                for s_ in (L * 0.25, L * 0.5, L * 0.75):
                    slab_on_edge(g, p0, t, n, s_ - 0.3, s_ + 0.3, 0.0, 0.3, p.min_h, upper.min_h, 'wall2')
    g.occluders.clear()
    H.mark('lower block and void')

    # the upper tower, its soffit over the void, the roof and the blade
    cap(g, [upper.outer], upper.min_h, 'wall2', down=True)
    curtain(g, upper.outer, upper.min_h, upper.h, floor=3.3, **grid)
    parapet(g, upper.outer, upper.h, 2.2, 0.35, 'glass', coping='trim', inner=False)
    prism(g, blade.outer, upper.h, blade.h, 'glass', top='trim')
    H.mark('upper tower')

    H.view = (120, 10)
    H.detail = ((-30, -30, 0), (25, 25, 90))
    H.detail_view = (75, 8)
    return H


@hero
def skysawa():
    """Skysawa, Świętokrzyska 36 (PBPA, 2024): 155 m dark glass office tower of 40 floors with a 60 m and a
    30 m glass building at its feet along the street; a lighter mullion grid, a glazed plant screen on top"""
    H = Hero(961565573, 'Skysawa', [961565573, 961565574, 961565575])
    g = H.g
    tower, mid, low = H.part(961565573), H.part(961565574), H.part(961565575)
    # low building A (7 floors) and the 60 m block: glass with light slab bands
    for p in (low, mid):
        curtain(g, p.outer, 0, p.h, floor=4.0, mull=1.6, band_h=0.9, band_d=0.12, mull_d=0.18)
        parapet(g, offset(p.outer, 0.12), p.h, 1.2, 0.3, 'frame', coping='metal')
    H.mark('low buildings')
    # the tower: 4.5 m lobby, 3.75 m office floors, top plant floors behind a glass screen
    curtain(g, tower.outer, 0, tower.h - 6, floor=3.75, mull=1.5, band_h=0.6, band_d=0.1, mull_d=0.3,
            band_mat='metal')
    screen = offset(tower.outer, 0.1)
    curtain(g, screen, tower.h - 6, tower.h, floor=0, mull=3.0, band_h=0, mull_d=0.2, mull_mat='metal')
    wall(g, offset(screen, -0.3)[::-1], tower.h - 3, tower.h, 'frame')
    annulus(g, offset(screen, -0.3), screen, tower.h, 'metal')
    cap(g, [offset(tower.outer, -0.2)], tower.h - 3, 'roof')
    H.mark('tower')
    H.view = (20, 14)
    H.detail = ((-20, -20, 110), (20, 20, 160))
    return H


@hero
def lim():
    """Centrum LIM with the Marriott hotel, Al. Jerozolimskie 65/79 (1989): the 140 m slab of dark bronze-green
    reflective glass on a square plan with notched corners faced in white panels, two dark sign bands (the crown
    with the Marriott boxes, the LOT band at a third of the height), the lattice broadcast mast on the roof, and
    the three-storey gallery podium with white bands"""
    H = Hero(226315284, 'Centrum LIM (Marriott)', [226315284, 226315282])
    H.note = 'the podium is modelled at its real three storeys (OSM height 5 m)'
    H.tint = srgb('#e4e2dc')
    g = H.g
    t, pod = H.part(226315284), H.part(226315282)
    g.occlude(t.outer, 0.0, t.h)

    POD = 12.5
    curtain(g, pod.outer, 0.0, POD, floor=4.1, mull=4.0, mull_w=0.2, mull_d=0.2, band_h=1.6, band_d=0.3,
            band_mat='wall')
    parapet(g, pod.outer, POD, 1.0, 0.3, 'wall', coping='metal', inner=False)
    H.mark('podium')

    g.occluders.clear()
    for p0, p1, L, tt, n in edges(t.outer):
        if L < 6.0:   # the notched corners: white panels full height
            g.quad(p0, p1, POD, t.h, 'wall')
            for z in range(int(POD), int(t.h), 7):
                g.quad(p0, p1, z, z + 0.25, 'trim', d=0.1, n=n)
            continue
        g.quad(p0, p1, POD, t.h, 'glass')
        k = max(1, round(L / 1.8))
        for i in range(1, k):
            slab_on_edge(g, p0, tt, n, L * i / k - 0.06, L * i / k + 0.06, 0.0, 0.12, POD, t.h, 'frame')
        z = POD + 3.1
        while z < t.h - 1.0:
            g.quad(p0, p1, z - 0.18, z + 0.18, 'frame', d=0.06, n=n)
            z += 3.1
        # sign bands: dark glass, a light box on each face
        for z0, z1, w in ((t.h - 7.0, t.h - 0.5, 0.45), (44.0, 49.0, 0.25)):
            slab_on_edge(g, p0, tt, n, 0.0, L, 0.0, 0.2, z0, z1, 'dark', top=True, bottom=True)
            slab_on_edge(g, p0, tt, n, L / 2 - L * w / 2, L / 2 + L * w / 2, 0.2, 0.45, z0 + 1.2, z1 - 1.2, 'sign',
                         top=True, bottom=True)
    parapet(g, t.outer, t.h, 1.2, 0.4, 'dark', coping='metal')
    H.mark('tower')

    # lattice mast with platforms
    c = centroid(t.outer)
    u = longest_edge(t.outer)[3]
    rot = math.atan2(u[1], u[0]) + math.pi / 4
    cone(g, c, t.h, t.h + 3.0, 5.0, 5.0, 4, 'metal', top='roof', rot=rot)
    cone(g, c, t.h + 3.0, t.h + 26.0, 1.8, 0.9, 4, 'metal', top=False, rot=rot)
    cone(g, c, t.h + 26.0, t.h + 42.0, 0.6, 0.12, 4, 'frame', top=False, rot=rot)
    for z in (t.h + 12.0, t.h + 22.0):
        cone(g, c, z, z + 0.5, 2.8, 2.8, 8, 'frame', top=True, bottom=True)
    H.mark('mast')

    H.view = (20, 14)
    H.detail = ((-30, -30, 100), (30, 30, 185))
    H.detail_view = (40, 10)
    return H


@hero
def kaskada():
    """Centrum Biurowo-Bankowe Kaskada, Al. Jana Pawła II 12 (1990s): ten storeys of pinkish granite with a tight
    grid of punched green windows, two glazed top storeys set back as the "cascade", a teal plant screen, and the
    green glass corner towers with pyramid roofs towards Jana Pawła II"""
    H = Hero(30621661, 'Kaskada', [30621661], tol=0.3)
    H.tint = srgb('#b58f80')
    g = H.g
    p = H.part(30621661)
    r = p.outer
    STONE = p.h - 11.0
    facade(g, r, 0.0, STONE, bay=2.6, floor=3.6, win_h=1.9, sill=1.0, pier_w=1.1, pier_d=0.25, band_d=0.12,
           min_edge=5.0, first=0.0, soffit=False, plinth='wall2')
    band(g, r, STONE - 0.8, STONE, 0.5, 'wall2')
    top = offset(r, -1.8)
    annulus(g, top, r, STONE, 'roof')
    curtain(g, top, STONE, p.h - 3.2, floor=3.8, mull=1.6, mull_w=0.12, mull_d=0.15, band_h=0.35, band_d=0.1,
            band_mat='metal', mull_mat='metal')
    cap(g, [top], p.h - 3.2, 'roof')
    plant = scale_ring(top, 0.55)
    wall(g, plant, p.h - 3.2, p.h, 'metal')
    cap(g, [plant], p.h, 'roof')
    # sign box of the tenant on the roof edge
    e = longest_edge(top)
    slab_on_edge(g, e[0], e[3], e[4], e[2] * 0.2, e[2] * 0.45, -2.5, -2.2, p.h - 3.2, p.h - 0.6, 'sign', top=True)
    H.mark('block')

    # glazed corner bays flush in the two western corners, the north-western one crowned by a glass pyramid
    west = sorted(r, key=lambda q: q[0])[:2]
    u = longest_edge(r)[3]
    for q in west:
        c = offset_point(r, q, -3.0)
        box(g, c, u, 3.3, 3.3, 0.0, p.h - 3.2, 'glass', top=False)
        for z in range(4, int(p.h - 3.2), 4):
            box(g, c, u, 3.4, 3.4, z - 0.15, z + 0.15, 'metal', top=False)
        if q is max(west, key=lambda w: w[1]):
            cone(g, c, p.h - 3.2, p.h + 1.8, 4.6, 0.0, 4, 'glass', rot=math.atan2(u[1], u[0]) + math.pi / 4)
    H.mark('corner bays')

    H.view = (250, 18)
    H.detail = ((-30, -25, 0), (0, 15, 52))
    H.detail_view = (235, 10)
    return H


@hero
def ilmet():
    """Ilmet, Al. Jana Pawła II 15 (Dumenčić and Kartowicz, 1997; demolition started in 2026): the 83 m office
    tower clad in red-brown panels with dark ribbon windows, facing Rondo ONZ with its rounded end where a pale
    glass spine runs up the facade and past the roof to 103 m; the lower beige wing along the street"""
    H = Hero(140367961, 'Ilmet', [140367961], tol=0.3)
    H.tint = srgb('#9a5a42')
    g = H.g
    p = H.part(140367961)
    r = p.outer
    e = longest_edge(r)
    u = e[3] if e[3][0] > 0 else (-e[3][0], -e[3][1])      # along the long side, towards the round east end
    east = max(r, key=lambda q: q[0] * u[0] + q[1] * u[1])
    cut = (east[0] - u[0] * 46.0, east[1] - u[1] * 46.0)
    tower = clip(r, cut, (-u[0], -u[1]))
    wing = clip(r, cut, u)
    ROOF = 83.0
    g.occlude(tower, 0.0, ROOF)
    # tower: red-brown panels and ribbon windows
    curtain(g, tower, 0.0, 7.0, floor=7.0, mull=3.0, mull_w=0.4, mull_d=0.3, band_h=0, glass='glass')
    curtain(g, tower, 7.0, ROOF - 4.0, floor=3.6, mull=0, band_h=2.0, band_d=0.2, band_mat='wall')
    band(g, tower, 6.2, 7.4, 0.6, 'wall')
    g.occluders.clear()
    # recessed glazed top storey under a thin overhanging roof slab
    crown = offset(tower, -1.2)
    annulus(g, crown, tower, ROOF - 4.0, 'roof')
    curtain(g, crown, ROOF - 4.0, ROOF - 0.6, floor=0, mull=2.0, mull_w=0.12, mull_d=0.15, band_h=0)
    band(g, crown, ROOF - 0.6, ROOF, 1.5, 'metal')
    cap(g, [crown], ROOF, 'roof')
    H.mark('tower')
    # wing: beige stone, punched windows
    g.occlude(tower, 0.0, ROOF)
    WING = 27.0
    facade(g, wing, 0.0, WING, bay=3.0, floor=3.4, win_h=1.8, sill=1.0, pier_w=1.2, pier_d=0.25, core='glass',
           pier='trim', min_edge=4.0, first=0.0, soffit=False)
    g.occluders.clear()
    parapet(g, wing, WING, 1.0, 0.3, 'trim', coping='metal', inner=False)
    H.mark('wing')
    # the glass spine on the rounded end, rising past the roof
    bump = [q for q in r if (q[0] - east[0]) * u[0] + (q[1] - east[1]) * u[1] > -30.0 and q[1] > 8.0]
    c = centroid(bump) if bump else centroid(tower)
    tc = centroid(tower)
    k = 2.5 / max(1e-6, math.hypot(tc[0] - c[0], tc[1] - c[1]))
    c = (c[0] + (tc[0] - c[0]) * k, c[1] + (tc[1] - c[1]) * k)   # the spine stands 0.9 m proud of the facade
    cone(g, c, 0.0, ROOF + 12.0, 3.4, 3.4, 8, 'glass', top='metal')
    for z in range(8, int(ROOF + 12), 8):
        cone(g, c, z - 0.3, z + 0.3, 3.55, 3.55, 8, 'frame', top=False)
    cone(g, c, ROOF + 12.0, p.h, 1.2, 0.15, 6, 'metal', top=False)
    H.mark('spine')

    H.view = (60, 14)
    H.detail = ((-5, -20, 40), (45, 25, 103))
    H.detail_view = (35, 8)
    return H


@hero
def wars_sawa_junior():
    """Wars Sawa Junior, Marszałkowska 104–122 (1960s department stores, rebuilt 2020s): long pale green glass
    boxes of Sawa and Wars overhanging the shop arcade on Marszałkowska, the set-back glazed top floors, shop
    fronts with light boxes and big billboards on the glass"""
    ids = [350962669, 350962670, 25911169, 977991989, 977991990, 977991998, 977991999, 977992000]
    H = Hero(350962669, 'Wars Sawa Junior', ids, tol=0.35)
    H.note = 'outline way 963063721 is not in buildings[]; hero id and centroid = the Sawa part 350962669'
    g = H.g
    P = H.part
    ground = [P(o) for o in (977991998, 977991999, 977992000)]
    boxes = [P(o) for o in (350962669, 350962670, 25911169)]
    tops = [P(o) for o in (977991989, 977991990)]
    for q in ground + boxes + tops:
        g.occlude(q.outer, q.min_h, q.h)
    for q in ground:
        facade(g, q.outer, 0.0, q.h, bay=6.0, floor=20.0, win_h=4.4, sill=0.3, pier_w=0.7, pier_d=0.25,
               pier='metal', min_edge=4.0, soffit=False)
    H.mark('shop fronts')
    for q in boxes:
        curtain(g, q.outer, q.min_h, q.h, floor=4.0, mull=2.4, mull_w=0.1, mull_d=0.12, band_h=0.3, band_d=0.08)
        cap(g, [q.outer], q.min_h, 'metal', down=True)
        band(g, simplify(q.outer, 1.0), q.min_h - 0.9, q.min_h, 0.3, 'sign', top=False)
    for q in tops:
        curtain(g, q.outer, q.min_h, q.h, floor=3.0, mull=3.0, mull_w=0.12, mull_d=0.15, band_h=0.6, band_d=0.12,
                band_mat='metal')
    g.occluders.clear()
    for q in boxes:
        band(g, simplify(q.outer, 1.0), q.h - 1.1, q.h, 0.15, 'dark', top=False)
        cap(g, [q.outer], q.h, 'roof')
    parapet(g, tops[1].outer, tops[1].h, 1.1, 0.1, 'metal', coping='metal', inner=False)
    H.mark('glass boxes')
    # billboards on the street face and columns of the arcade
    for q in boxes:
        e = longest_edge(simplify(q.outer, 1.0))
        p0, p1, L, t, n = e
        for f in (0.3, 0.7):
            slab_on_edge(g, p0, t, n, L * f - 6.0, L * f + 6.0, 0.15, 0.35, q.min_h + 1.5, q.h - 1.5, 'sign',
                         top=True, bottom=True)
        k = max(2, int(L / 9.0))
        for i in range(1, k):
            c = (p0[0] + t[0] * L * i / k - n[0] * 1.2, p0[1] + t[1] * L * i / k - n[1] * 1.2)
            box(g, c, t, 0.35, 0.35, 0.0, q.min_h, 'metal', top=False)
    H.mark('billboards, arcade')

    H.view = (250, 16)
    H.detail = ((-40, -20, 0), (20, 60, 25))
    H.detail_view = (265, 8)
    return H


# ───────────────────────── build, export, manifest ─────────────────────────

def build_all():
    only = set(int(x) for x in OPTS['only'].split(',')) if OPTS['only'] else None
    built = []
    for fn in HEROES:
        h = fn()
        if only and h.main not in only:
            continue
        me = bpy.data.meshes.new(f'hero__{h.main}')
        me.from_pydata(h.g.v, [], h.g.f)
        for name in MATERIALS:
            me.materials.append(MAT[name])
        for poly, mi in zip(me.polygons, h.g.m):
            poly.material_index = mi
        # weld coincident vertices (fewer exported vertices) and drop the faces that collapse
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
        bmesh.ops.dissolve_degenerate(bm, dist=0.002, edges=bm.edges)
        bm.to_mesh(me)
        bm.free()
        me.validate(clean_customdata=False)
        me.update()
        # drop material slots the hero does not use so the GLB carries no empty primitives
        used = sorted({p.material_index for p in me.polygons})
        remap = {old: new for new, old in enumerate(used)}
        idx = [remap[p.material_index] for p in me.polygons]
        me.materials.clear()
        for old in used:
            me.materials.append(MAT[list(MATERIALS)[old]])
        for poly, mi in zip(me.polygons, idx):
            poly.material_index = mi
        obj = bpy.data.objects.new(f'hero__{h.main}', me)
        scene.collection.objects.link(obj)
        h.obj = obj
        h.tri_count = sum(len(p.vertices) - 2 for p in me.polygons)
        h.top = max(v.co.z for v in me.vertices)
        built.append(h)
        print(f'hero__{h.main:<10} {h.tri_count:>6} tris  top {h.top:6.1f} m  {h.name}')
        if OPTS.get('breakdown'):
            for label, n in getattr(h, 'sections', []):
                print(f'    {label:<28} {n:>6}')
    return built


def export(built):
    out = os.path.abspath(OPTS['out'])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_vertex_color='NONE', export_extras=False,
                              export_lights=False, export_cameras=False, use_selection=False)
    manifest = {'map': MAP, 'heroes': [
        {'id': h.main, 'ids': h.ids, 'name': h.name, 'height': round(h.top, 1), 'tris': h.tri_count,
         'centroid': [round(h.cx, 2), round(h.cz, 2)], **({'note': h.note} if h.note else {})} for h in built]}
    with open(os.path.splitext(out)[0] + '.json', 'w') as fh:
        fh.write(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n')
    print(f'{MAP}: {len(built)} heroes, {sum(h.tri_count for h in built)} triangles → {out}')


# ───────────────────────── previews ─────────────────────────

def preview(built, out_dir):
    import numpy as np
    os.makedirs(out_dir, exist_ok=True)
    tmp = '/mnt/ramdisk/kits-hero-warsaw/render'
    os.makedirs(tmp, exist_ok=True)
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.studio_light = 'outdoor.sl'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = True
    sh.shadow_intensity = 0.45
    sh.show_backface_culling = True
    scene.display.light_direction = (0.45, -0.35, 0.82)
    scene.display.render_aa = '8'
    world = bpy.data.worlds.new('preview_world')
    world.color = srgb('#9fb4c8')
    scene.world = world
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    ground_me = bpy.data.meshes.new('preview_ground')
    ground_me.from_pydata([(-4000, -4000, -0.05), (4000, -4000, -0.05), (4000, 4000, -0.05), (-4000, 4000, -0.05)],
                          [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new('preview_ground')
    gm.diffuse_color = (*srgb('#b9b8b0'), 1)
    ground_me.materials.append(gm)
    ground = bpy.data.objects.new('preview_ground', ground_me)
    scene.collection.objects.link(ground)
    cam = bpy.data.objects.new('preview_cam', bpy.data.cameras.new('preview_cam'))
    cam.data.clip_start, cam.data.clip_end = 1.0, 6000
    scene.collection.objects.link(cam)
    scene.camera = cam
    MAT['glass'].diffuse_color = (*srgb('#7d93a8'), 1)   # the game reflects the sky in the glass by day
    wall_base = MAT['wall'].diffuse_color[:]
    wall2_base = MAT['wall2'].diffuse_color[:]

    def shot(h, target_lo, target_hi, azimuth, elev, w, hgt, path, lens=50):
        lo, hi = Vector(target_lo), Vector(target_hi)
        centre = (lo + hi) / 2
        cam.data.lens = lens
        cam.data.sensor_fit = 'AUTO'
        half = math.atan(18 / lens)
        tan_h = math.tan(half) * (1 if w >= hgt else w / hgt)
        tan_v = math.tan(half) * (1 if hgt >= w else hgt / w)
        a, e = math.radians(azimuth), math.radians(elev)
        back = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        fwd = -back
        right = fwd.cross(Vector((0, 0, 1))).normalized()
        up = right.cross(fwd)
        # fit the camera to the vertices inside the target box, centred on their projected extent
        pts = [v.co for v in h.obj.data.vertices
               if lo.x - 1 <= v.co.x <= hi.x + 1 and lo.y - 1 <= v.co.y <= hi.y + 1 and lo.z - 1 <= v.co.z <= hi.z + 1]
        xs_ = [(q - centre).dot(right) for q in pts]
        ys_ = [(q - centre).dot(up) for q in pts]
        centre = centre + right * (max(xs_) + min(xs_)) / 2 + up * (max(ys_) + min(ys_)) / 2
        dist = 1.0
        for q in pts:
            q = q - centre
            along = q.dot(fwd)
            dist = max(dist, along + abs(q.dot(right)) / tan_h * 1.08, along + abs(q.dot(up)) / tan_v * 1.08)
        cam.location = centre + back * dist
        cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
        scene.render.resolution_x, scene.render.resolution_y = w, hgt
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)

    for h in built:
        for o in built:
            o.obj.hide_render = o is not h
        tint = h.tint or wall_base[:3]
        MAT['wall'].diffuse_color = (*tint, 1)
        MAT['wall2'].diffuse_color = (*(c * 0.72 for c in tint), 1)
        xs = [v.co.x for v in h.obj.data.vertices]
        ys = [v.co.y for v in h.obj.data.vertices]
        zs = [v.co.z for v in h.obj.data.vertices]
        lo, hi = (min(xs), min(ys), 0), (max(xs), max(ys), max(zs))
        az, el = h.view
        a = os.path.join(tmp, f'{h.main}_a.png')
        b = os.path.join(tmp, f'{h.main}_b.png')
        shot(h, lo, hi, az, el, 640, 720, a)
        clo, chi = h.detail if h.detail else (lo, hi)
        shot(h, clo, chi, h.detail_view[0], h.detail_view[1], 640, 720, b)
        ia, ib = bpy.data.images.load(a), bpy.data.images.load(b)
        pa = np.array(ia.pixels[:]).reshape(720, 640, 4)
        pb = np.array(ib.pixels[:]).reshape(720, 640, 4)
        sheet = bpy.data.images.new(f'sheet_{h.main}', 1280, 720, alpha=False)
        sheet.pixels[:] = np.concatenate([pa, pb], axis=1).ravel()
        sheet.filepath_raw = os.path.join(out_dir, f'{MAP}-{h.main}.png')
        sheet.file_format = 'PNG'
        sheet.save()
        for im in (ia, ib, sheet):
            bpy.data.images.remove(im)
        print('PREVIEW', os.path.join(out_dir, f'{MAP}-{h.main}.png'))
    MAT['wall'].diffuse_color = wall_base
    MAT['wall2'].diffuse_color = wall2_base
    for o in built:
        o.obj.hide_render = False


def main():
    built = build_all()
    export(built)
    if OPTS['preview']:
        preview(built, OPTS['preview'])


main()
