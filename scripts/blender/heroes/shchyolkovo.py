"""Hero buildings of the Shchyolkovo map (the town centre on the Klyazma), built headless in Blender.

    blender -b --factory-startup -P scripts/blender/heroes/shchyolkovo.py -- src/assets/heroes/shchyolkovo.glb \
        [--preview docs/heroes] [--only <osmId>,<osmId>]

Contract: docs/KITS.md §1 and §3. Every footprint is read from src/data/maps/shchyolkovo.world.json — nothing is
copied by hand. A hero is modelled in map metres around the average of its main part's outer-ring vertices
(Blender X = x − cx, Y = −(z − cz), Z up from the ground) under one root `hero__<osmId>`, with the contract
materials only. The manifest next to the GLB lists the OSM ids each hero replaces and its triangle count.

Colour: the materials carry neutral light albedos and every face carries a vertex colour that multiplies it
(COLOR_0), so one `wall` material paints the terracotta brick of the Astrum tower and the cream tiles of River House.

What the buildings are (OSM tags, Wikimedia Commons photographs, developer descriptions):
  144710719  Astrum tower, naberezhnaya Serafima Sarovskogo 2: hotel tower over the Astrum mall — parts 144710720
             (levels 6–7), 144710719 (7–26), 144710718 (26–30). Terracotta brick slab with small windows, a blue
             glass bay bulging round its south-east corner, a glass strip in the brick front, a grey top with a
             glass front, a round crown under a ring canopy; podium of orange brick and blue glass. Commons:
             «Astrum hotel», «Hotel ASTRUM», «Щёлково. Набережная реки Клязьма(ы)», 20180525.
  87408632   chapel of St Seraphim of Sarov on the embankment (2006–2009): red brick, white pilasters, a pediment
             with a round window over an arched door on each side, a dark slate dome, a small gilded onion.
  3491716    River House, Sovetskaya 60 (2023, 20 storeys): a crescent of cream ceramic tiles and dark window
             bands facing the river, two wings joined high up over a 13-storey arch, two-storey shop base.
  93524631   Shmidta 1 (2011, 15 storeys, brick-monolith): red brick C-block with cream glazed loggia bays.
  60606775   Shmidta 6 (2009, 15 storeys): cream brick C-block with red brick loggia bays.
  1763313    cinema «Пять Звёзд» in the old «Аврора», Lenina square 2A: white panelled front cut by full-height glass
             slots under the АВРОРА letters, a round tiered plaster rotunda with a glass lantern, the beige
             «Пять Звёзд» half on Sovetskaya (Commons «Cinema Aurora», «Tulips», kenuat (10)).
  51976788   Lenina square 1 (1985, 9 storeys, brick): a 140 m sand-brick slab with loggias, shops on Sovetskaya.
  45557269   business centre, Lenina square 8: beige tiles, arched top-floor windows, a glass wall, granite base.
  47710002   Пассаж «Клязьма», Proletarsky 9B: two-storey mall with shop fronts to the prospekt.
  51975813   services centre «Эрион», 1st Sovetsky lane 7: three storeys of brick over shop windows.
  5675518    Proletarsky 9 k1 (2002, 10 storeys, brick): red brick with cream loggia bays and stepped gables.
  156871327  the round «Premium» apart-hotel pavilion, Talsinskaya 9/2 (OSM has only its 19 m circle).
Wave 2 (the next buildings by facade length along the route × height):
  53356631   1st Sovetsky 5 and 1958049  1st Sovetsky 3 (1930, 4 storeys): silk-mill workers' houses of red brick with
             yellow brick pilasters and belt courses, hipped iron roofs (as 1st Sovetsky 19 on Commons).
  59625754   1st Sovetsky 4 (1965, 5 storeys, large panels) · 40760773  1st Sovetsky 6 (1971, 5 storeys, silicate brick).
  131974558  1st Sovetsky 7A: a two-storey brick shop (look not confirmed).
  1958050    the town museum, Sovetskaya 54: white rounded corner with shop glazing, yellow wing, green roof.
  653362077  Lenina square 5, the commercial range (parts 653362077, 653362075 of 653362080): sand brick with red bands,
             a middle block on columns over a passage, green pharmacy and optics light boxes (Commons «panoramio (54)»).
  63161145   Lenina square 7 (2008): sand brick over a red brick ground storey (Commons «panoramio (81)»).
  45557012   Lenina square 5, the nine-storey office tower (Commons «panoramio (49)»).
  93524634   Shmidta 5A and 156871484  Talsinskaya 9A: low brick buildings (looks not confirmed).
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
MAP = 'shchyolkovo'

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OPTS = {'out': os.path.join(REPO, 'src/assets/heroes/shchyolkovo.glb'), 'preview': None, 'only': None}
_rest = list(argv)
while _rest:
    _arg = _rest.pop(0)
    if _arg.startswith('--'):
        OPTS[_arg[2:]] = _rest.pop(0)
    else:
        OPTS['out'] = _arg
ONLY = {int(x) for x in OPTS['only'].split(',')} if OPTS['only'] else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

WORLD = json.load(open(os.path.join(REPO, 'src/data/maps', MAP + '.world.json')))
RECORDS = {}
for _rec in WORLD['buildings']:
    RECORDS.setdefault(_rec[7], []).append(_rec)


# ───────────────────────── materials and colours ─────────────────────────

def lin(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATERIALS = {
    # name:  base albedo (sRGB), metallic, roughness — vertex colours only darken it
    'wall':  ('#f3eee6', 0.0, 0.85),
    'wall2': ('#d8cfc0', 0.0, 0.85),
    'trim':  ('#eeeae2', 0.0, 0.7),
    'glass': ('#56779a', 0.0, 0.08),
    'frame': ('#e8e6e0', 0.2, 0.5),
    'metal': ('#8a9098', 0.7, 0.4),
    'roof':  ('#6a6c70', 0.0, 0.9),
    'dark':  ('#1d1f22', 0.0, 0.95),
    'sign':  ('#f0ece2', 0.0, 0.5),
    'gold':  ('#e8b64c', 1.0, 0.28),
    'glass2': ('#26303a', 0.0, 0.1),
}
MAT_NAMES = list(MATERIALS)
MAT = {}
for _name, (_hex, _metal, _rough) in MATERIALS.items():
    _m = bpy.data.materials.new(_name)
    _m.use_nodes = True
    _bsdf = _m.node_tree.nodes['Principled BSDF']
    _bsdf.inputs['Base Color'].default_value = (*lin(_hex), 1.0)
    _bsdf.inputs['Metallic'].default_value = _metal
    _bsdf.inputs['Roughness'].default_value = _rough
    _m.diffuse_color = (*lin(_hex), 1.0)
    MAT[_name] = _m

# the colours of the town (sRGB); a face without a colour keeps its material's albedo
C = {
    'terracotta': '#d27a48', 'orange': '#d98a4e', 'redbrick': '#9c4c37', 'darkbrick': '#6e3a2e', 'brown': '#5e4034',
    'cream': '#e3d3b5', 'beige': '#d6c29c', 'sand': '#cdb58c', 'silicate': '#c9c2b5', 'greige': '#a9a296',
    'grey': '#8d8f91', 'lightgrey': '#c4c6c6', 'graphite': '#4a4d52', 'white': '#ece9e2', 'granite': '#6b4a44',
    'glass': '#3b4a57', 'blueglass': '#4679ae', 'darkglass': '#2a3440', 'slate': '#3e4247', 'pvc': '#e8e6e0',
    'metal': '#4d535a', 'roof': '#4a4c50', 'gravel': '#6c6a66', 'green': '#4f6f5a', 'signred': '#c8322a',
    'signblue': '#2b56b8', 'signyellow': '#e0b22c', 'dark': '#1d1f22',
}
_BASE = {name: lin(hexstr) for name, (hexstr, _, _) in MATERIALS.items()}


def mult(mat, col):
    """vertex colour that turns the material's albedo into `col` (sRGB hex or a C key)"""
    if col is None:
        return (1.0, 1.0, 1.0)
    target = lin(C.get(col, col))
    return tuple(min(1.0, t / max(b, 1e-4)) for t, b in zip(target, _BASE[mat]))


# ───────────────────────── geometry accumulator ─────────────────────────

class Geo:
    """faces of one hero: every face has a material, a colour and a shading flag"""

    def __init__(self):
        self.verts, self.faces, self.fmat, self.fcol, self.fsmooth = [], [], [], [], []

    def face(self, pts, mat, col=None, smooth=False):
        i0 = len(self.verts)
        self.verts.extend(tuple(p) for p in pts)
        self.faces.append(tuple(range(i0, i0 + len(pts))))
        self.fmat.append(mat)
        self.fcol.append(col)
        self.fsmooth.append(smooth)

    def indexed(self, verts, faces, mat, col=None, smooth=True):
        i0 = len(self.verts)
        self.verts.extend(tuple(v) for v in verts)
        for f in faces:
            self.faces.append(tuple(i0 + i for i in f))
            self.fmat.append(mat)
            self.fcol.append(col)
            self.fsmooth.append(smooth)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def to_object(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        used = sorted(set(self.fmat), key=MAT_NAMES.index)
        for m in used:
            mesh.materials.append(MAT[m])
        slot = {m: i for i, m in enumerate(used)}
        mesh.polygons.foreach_set('material_index', [slot[m] for m in self.fmat])
        sharp = mesh.attributes.new('sharp_face', 'BOOLEAN', 'FACE')
        sharp.data.foreach_set('value', [not s for s in self.fsmooth])
        col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        flat = []
        for f, m, c in zip(self.faces, self.fmat, self.fcol):
            rgb = mult(m, c)
            flat.extend([*rgb, 1.0] * len(f))
        col.data.foreach_set('color', flat)
        mesh.color_attributes.active_color = col
        # weld coincident corners so the exporter can share vertices along flat walls
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        mesh.validate()
        return bpy.data.objects.new(name, mesh)


# ───────────────────────── footprints ─────────────────────────

def area2(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def ccw(r):
    return r if area2(r) > 0 else r[::-1]


def simplify(r, tol=0.12, min_edge=0.4):
    pts = list(r)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            ac = math.hypot(c[0] - a[0], c[1] - a[1])
            ab = math.hypot(b[0] - a[0], b[1] - a[1])
            if ac < 1e-6 or ab < min_edge or abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / ac < tol:
                del pts[i]
                changed = True
                break
    return pts


def ring_of(rec):
    flat = rec[8]
    return [(flat[i] / 10, flat[i + 1] / 10) for i in range(0, len(flat), 2)]


def centroid_of(osm_id):
    ring = ring_of(RECORDS[osm_id][0])
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def local_ring(osm_id, frame, tol=0.12):
    """outer ring of an OSM way in hero space, counter-clockwise (Blender X east, Y north)"""
    ring = [(x - frame[0], -(z - frame[1])) for x, z in ring_of(RECORDS[osm_id][0])]
    return ccw(simplify(ring, tol))


def offset(ring, d, miter=2.5):
    """ring pushed outwards by d (inwards for d < 0), mitred corners"""
    n = len(ring)
    out = []
    for i in range(n):
        a, b, c = ring[i - 1], ring[i], ring[(i + 1) % n]
        e1 = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        e2 = Vector((c[0] - b[0], c[1] - b[1])).normalized()
        n1 = Vector((e1.y, -e1.x))
        n2 = Vector((e2.y, -e2.x))
        m = n1 + n2
        if m.length < 1e-6:
            m = n1
        m.normalize()
        k = d / max(m.dot(n1), 1.0 / miter)
        out.append((b[0] + m.x * k, b[1] + m.y * k))
    return out


def rect_frame(ring):
    """minimum-area rectangle of a ring: (angle, u0, u1, v0, v1) with u along the angle"""
    best = None
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        ca, sa = math.cos(ang), math.sin(ang)
        us = [p[0] * ca + p[1] * sa for p in ring]
        vs = [-p[0] * sa + p[1] * ca for p in ring]
        ar = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or ar < best[0]:
            best = (ar, ang, min(us), max(us), min(vs), max(vs))
    return best[1:]


def oriented(ring):
    """rect_frame turned so that u points closest to east: (angle, u0, u1, v0, v1)"""
    ang = rect_frame(ring)[0]
    ang = min((ang + k * math.pi / 2 for k in range(-4, 5)), key=lambda a: abs(math.atan2(math.sin(a), math.cos(a))))
    ca, sa = math.cos(ang), math.sin(ang)
    us = [p[0] * ca + p[1] * sa for p in ring]
    vs = [-p[0] * sa + p[1] * ca for p in ring]
    return ang, min(us), max(us), min(vs), max(vs)


# ───────────────────────── building systems ─────────────────────────

class Edge:
    """a straight wall from p to q of a counter-clockwise ring; the outside is on its right"""

    def __init__(self, p, q):
        self.p = Vector((p[0], p[1]))
        d = Vector((q[0] - p[0], q[1] - p[1]))
        self.L = d.length
        self.u = d / self.L if self.L > 1e-9 else Vector((1, 0))
        self.n = Vector((self.u.y, -self.u.x))

    def at(self, t, z, d=0.0):
        """t metres along the wall, z up, d metres into the building (negative: out in front of the wall)"""
        x = self.p + self.u * t - self.n * d
        return (x.x, x.y, z)

    def front(self, g, t0, t1, z0, z1, d, mat, col=None):
        g.face([self.at(t0, z0, d), self.at(t1, z0, d), self.at(t1, z1, d), self.at(t0, z1, d)], mat, col)

    def back(self, g, t0, t1, z0, z1, d, mat, col=None):
        g.face([self.at(t0, z1, d), self.at(t1, z1, d), self.at(t1, z0, d), self.at(t0, z0, d)], mat, col)

    def side(self, g, t, z0, z1, d0, d1, facing, mat, col=None):
        """a vertical face across the wall at t, from depth d0 to d1 (d1 > d0), facing +u (1) or −u (−1)"""
        pts = [self.at(t, z0, d0), self.at(t, z0, d1), self.at(t, z1, d1), self.at(t, z1, d0)]
        g.face(pts if facing > 0 else pts[::-1], mat, col)

    def flat(self, g, t0, t1, z, d0, d1, up, mat, col=None):
        """a horizontal face from t0 to t1 between depths d0 < d1, facing up or down"""
        pts = [self.at(t0, z, d0), self.at(t1, z, d0), self.at(t1, z, d1), self.at(t0, z, d1)]
        g.face(pts if up else pts[::-1], mat, col)

    def box(self, g, t0, t1, z0, z1, d0, d1, mat, col=None, top=True, bottom=False, ends=True, back=False):
        """a block sticking out of (d < 0) or sunk into the wall"""
        self.front(g, t0, t1, z0, z1, d0, mat, col)
        if top:
            self.flat(g, t0, t1, z1, d0, d1, True, mat, col)
        if bottom:
            self.flat(g, t0, t1, z0, d0, d1, False, mat, col)
        if ends:
            self.side(g, t0, z0, z1, d0, d1, -1, mat, col)
            self.side(g, t1, z0, z1, d0, d1, 1, mat, col)
        if back:
            self.back(g, t0, t1, z0, z1, d1, mat, col)


def edges(ring):
    return [Edge(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]


def bays(L, bay, margin=0.0, width=None, min_len=1.6):
    """evenly spaced openings along a wall: [(t0, t1), …]"""
    usable = L - 2 * margin
    if usable < min_len:
        return []
    n = max(1, round(usable / bay))
    step = usable / n
    w = min(width if width is not None else step * 0.5, step * 0.86)
    return [(margin + step * (i + 0.5) - w / 2, margin + step * (i + 0.5) + w / 2) for i in range(n)]


def openings(g, e, z0, z1, cols, rows, wall='wall', col=None, depth=0.25, glass='glass', gcol='glass',
             spandrel=None, frame=None, fcol='pvc', mullions=1, soffit=False, sill=None, scol='white', holes=()):
    """a wall from t=0..L, z0..z1, pierced by columns of openings: cols = [(t0, t1)], rows = [(sill z, head z)].
    Behind each column one glass pane at `depth`, one reveal each side, the wall in front between the rows
    (`spandrel` = (material, colour) overrides it per column). `holes` = [(t0, t1)] spans left without a wall."""
    t = 0.0
    zs0, zs1 = rows[0][0], rows[-1][1]
    for c0, c1, hole in sorted([(a, b, False) for a, b in cols] + [(a, b, True) for a, b in holes]):
        if c0 > t + 1e-4:
            e.front(g, t, c0, z0, z1, 0, wall, col)
        if hole:
            t = c1
            continue
        smat, scol_ = spandrel if spandrel else (wall, col)
        if zs0 > z0 + 1e-4:
            e.front(g, c0, c1, z0, zs0, 0, wall, col)
        if z1 > zs1 + 1e-4:
            e.front(g, c0, c1, zs1, z1, 0, wall, col)
        for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
            e.front(g, c0, c1, a1, b0, 0, smat, scol_)
        e.front(g, c0, c1, zs0, zs1, depth, glass, gcol)
        e.side(g, c0, zs0, zs1, 0, depth, 1, wall, col)
        e.side(g, c1, zs0, zs1, 0, depth, -1, wall, col)
        if frame:
            for k in range(1, mullions + 1):
                m = c0 + (c1 - c0) * k / (mullions + 1)
                e.front(g, m - 0.04, m + 0.04, zs0, zs1, depth - 0.03, frame, fcol)
        for a0, a1 in rows:
            if soffit:
                e.flat(g, c0, c1, a1, 0, depth, False, wall, col)
                e.flat(g, c0, c1, a0, 0, depth, True, wall, col)
            if sill:
                e.box(g, c0 - 0.06, c1 + 0.06, a0 - 0.08, a0, -0.1, 0, sill, scol, ends=False)
        t = c1
    if e.L > t + 1e-4:
        e.front(g, t, e.L, z0, z1, 0, wall, col)


def floors(z0, n, h, sill=0.9, head=2.4):
    return [(z0 + i * h + sill, z0 + i * h + head) for i in range(n)]


def prism(g, ring, z0, z1, mat, col=None):
    for e in edges(ring):
        e.front(g, 0, e.L, z0, z1, 0, mat, col)


def cap(g, ring, z, mat, col=None, up=True):
    tris = tessellate_polygon([[Vector((p[0], p[1], z)) for p in ring]])
    for a, b, c in tris:
        pts = [(ring[a][0], ring[a][1], z), (ring[b][0], ring[b][1], z), (ring[c][0], ring[c][1], z)]
        n = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
        if (n.z > 0) != up:
            pts.reverse()
        g.face(pts, mat, col)


def band(g, ring, z0, z1, out, mat, col=None, top=True, bottom=True):
    """a cornice or belt course: the ring pushed out by `out` from z0 to z1"""
    big = offset(ring, out)
    n = len(ring)
    for i in range(n):
        a, b = big[i], big[(i + 1) % n]
        e = Edge(a, b)
        e.front(g, 0, e.L, z0, z1, 0, mat, col)
        ia, ib = ring[i], ring[(i + 1) % n]
        if top:
            g.face([(a[0], a[1], z1), (b[0], b[1], z1), (ib[0], ib[1], z1), (ia[0], ia[1], z1)], mat, col)
        if bottom:
            g.face([(ia[0], ia[1], z0), (ib[0], ib[1], z0), (b[0], b[1], z0), (a[0], a[1], z0)], mat, col)


def parapet(g, ring, z, h, t, wall, col, coping='roof', ccol=None, roof='roof', rcol=None):
    """the walls go on up to z + h; a coping of width t; the inner face; the roof at z"""
    inner = offset(ring, -t)
    prism(g, ring, z, z + h, wall, col)
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        ia, ib = inner[i], inner[(i + 1) % n]
        g.face([(a[0], a[1], z + h), (b[0], b[1], z + h), (ib[0], ib[1], z + h), (ia[0], ia[1], z + h)], coping, ccol)
        g.face([(ia[0], ia[1], z + h), (ib[0], ib[1], z + h), (ib[0], ib[1], z), (ia[0], ia[1], z)], wall, col)
    cap(g, inner, z, roof, rcol)


def box(g, cx, cy, sx, sy, z0, z1, mat, col=None, ang=0.0, bottom=False):
    ca, sa = math.cos(ang), math.sin(ang)
    ring = [(cx + ca * u - sa * v, cy + sa * u + ca * v) for u, v in ((-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2))]
    prism(g, ring, z0, z1, mat, col)
    cap(g, ring, z1, mat, col)
    if bottom:
        cap(g, ring, z0, mat, col, up=False)


def circle(cx, cy, r, n, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * i / n), cy + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def lathe(g, profile, n, mat, col=None, cx=0.0, cy=0.0, smooth=True, close_top=True):
    """surface of revolution through (radius, z) pairs from the bottom up; a pole where the radius is 0"""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r < 1e-4:
            rings.append([len(verts)])
            verts.append((cx, cy, z))
        else:
            rings.append([len(verts) + i for i in range(n)])
            verts.extend((cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z) for i in range(n))
    for lo, hi in zip(rings, rings[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        for i in range(n):
            j = (i + 1) % n
            if len(hi) == 1:
                faces.append((lo[i], lo[j], hi[0]))
            elif len(lo) == 1:
                faces.append((lo[0], hi[j], hi[i]))
            else:
                faces.append((lo[i], lo[j], hi[j], hi[i]))
    g.indexed(verts, faces, mat, col, smooth)


def gable(g, e, t0, t1, z, rise, d0, d1, mat, col=None):
    """a triangular pediment standing on the wall top from t0 to t1, from depth d0 to d1"""
    tm = (t0 + t1) / 2
    front = [e.at(t0, z, d0), e.at(t1, z, d0), e.at(tm, z + rise, d0)]
    back = [e.at(t1, z, d1), e.at(t0, z, d1), e.at(tm, z + rise, d1)]
    g.face(front, mat, col)
    g.face(back, mat, col)


FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
_GLYPHS = {}


def glyph(ch):
    """flat triangles of one letter 1 m tall (x right, y up from the baseline) and its advance"""
    if ch not in _GLYPHS:
        font = bpy.data.fonts.get('hero_font') or bpy.data.fonts.load(FONT)
        font.name = 'hero_font'
        cu = bpy.data.curves.new('glyph', 'FONT')
        cu.body = ch if ch != ' ' else '.'
        cu.font = font
        cu.size = 1.37
        cu.resolution_u = 2
        ob = bpy.data.objects.new('glyph', cu)
        scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        tris = [[(v.co.x, v.co.y) for v in f.verts] for f in bm.faces] if ch != ' ' else []
        xs = [v.co.x for v in bm.verts] or [0.0]
        bm.free()
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)
        _GLYPHS[ch] = (tris, max(xs) + 0.12 if ch != ' ' else 0.45)
    return _GLYPHS[ch]


def text_width(text, h):
    return sum(glyph(ch)[1] for ch in text) * h


def lettering(g, place, text, h, mat='sign', col='white'):
    """letters h metres tall; place(x, y) maps the text plane (x from 0 to the width, y up) to a world point"""
    x0 = 0.0
    for ch in text:
        tris, adv = glyph(ch)
        for tri in tris:
            g.face([place(x0 + x * h, y * h) for x, y in tri], mat, col)
        x0 += adv * h


def wall_text(g, e, text, t_mid, z, h, d=-0.08, mat='sign', col='white'):
    """a line of letters standing on a wall, centred at t_mid, base at z, d in front of the wall"""
    t0 = t_mid - text_width(text, h) / 2
    lettering(g, lambda x, y: e.at(t0 + x, z + y, d), text, h, mat, col)


def circle_fit(pts):
    """least-squares circle through points: (cx, cy, r)"""
    n = len(pts)
    mx, my = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    u = [(p[0] - mx, p[1] - my) for p in pts]
    suu = sum(a * a for a, _ in u)
    svv = sum(b * b for _, b in u)
    suv = sum(a * b for a, b in u)
    suuu = sum(a ** 3 for a, _ in u) + sum(a * b * b for a, b in u)
    svvv = sum(b ** 3 for _, b in u) + sum(a * a * b for a, b in u)
    det = suu * svv - suv * suv
    uc = (svv * suuu - suv * svvv) / (2 * det)
    vc = (suu * svvv - suv * suuu) / (2 * det)
    r = math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
    return mx + uc, my + vc, r


def clip(ring, a, b, c):
    """the part of a ring where a·x + b·y + c ≥ 0 (Sutherland–Hodgman; fine for one crossing each way)"""
    out = []
    n = len(ring)
    for i in range(n):
        p, q = ring[i], ring[(i + 1) % n]
        fp, fq = a * p[0] + b * p[1] + c, a * q[0] + b * q[1] + c
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return simplify(out, 0.02, 0.05)


def point_in(ring, x, y):
    inside = False
    n = len(ring)
    for i in range(n):
        (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def yard_side(ring, e, reach=14.0):
    """True when the wall looks into the building's own yard (its outside meets the building again)"""
    for t in (0.3, 0.5, 0.7):
        x, y, _ = e.at(e.L * t, 0, 0)
        for k in range(1, 15):
            px, py = x + e.n.x * reach * k / 14, y + e.n.y * reach * k / 14
            if point_in(ring, px, py):
                return True
    return False


def route_dir(frame):
    """unit direction (Blender X, Y) of the race route where it passes closest to the hero"""
    pts = json.load(open(os.path.join(REPO, 'src/data/maps', MAP + '.route.json')))['points']
    best = None
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = math.hypot((a[0] + b[0]) / 2 - frame[0], (a[1] + b[1]) / 2 - frame[1])
        if best is None or d < best[0]:
            best = (d, b[0] - a[0], b[1] - a[1])
    return Vector((best[1], -best[2])).normalized()


def to_route(frame, x, y):
    """vector (Blender X, Y) from a local point to the nearest route centreline point"""
    pts = json.load(open(os.path.join(REPO, 'src/data/maps', MAP + '.route.json')))['points']
    best = None
    for p in pts:
        v = Vector((p[0] - frame[0] - x, -(p[1] - frame[1]) - y))
        if best is None or v.length < best.length:
            best = v
    return best


def faces_route(frame, e, reach=45.0):
    """True when the wall looks towards the race route within `reach` metres"""
    x, y, _ = e.at(e.L / 2, 0)
    v = to_route(frame, x, y)
    return v.length < reach and v.normalized().dot(e.n) > 0.35


def hip_roof(g, ring, z, rise, inset, mat='roof', col=None, overhang=0.35, tol=0.8):
    """a hipped roof: eaves pushed out by `overhang`, slopes up to the ring pulled in by `inset`, a flat top"""
    r = ccw(simplify(ring, tol, 1.5))
    outer, inner = offset(r, overhang), offset(r, -inset)
    n = len(r)
    for i in range(n):
        a, b = outer[i], outer[(i + 1) % n]
        ia, ib = inner[i], inner[(i + 1) % n]
        g.face([(a[0], a[1], z), (b[0], b[1], z), (ib[0], ib[1], z + rise), (ia[0], ia[1], z + rise)], mat, col)
        wa, wb = r[i], r[(i + 1) % n]
        g.face([(wa[0], wa[1], z), (wb[0], wb[1], z), (b[0], b[1], z), (a[0], a[1], z)][::-1], mat, col)
    cap(g, inner, z + rise, mat, col)


def short_run(es, max_len):
    """indices of the longest run of consecutive edges shorter than max_len (a curved corner)"""
    best, run = [], []
    for i in range(2 * len(es)):
        k = i % len(es)
        if es[k].L < max_len and len(run) < len(es):
            run.append(k)
        else:
            best, run = max(best, run, key=len), []
    return max(best, run, key=len)


def door(g, e, t, z0, w, h, mat='dark', col=None, canopy=True, depth=1.2):
    """an entrance: a dark recess with a metal canopy"""
    e.front(g, t - w / 2, t + w / 2, z0, z0 + h, -0.02, mat, col)
    if canopy:
        e.box(g, t - w / 2 - 0.5, t + w / 2 + 0.5, z0 + h + 0.25, z0 + h + 0.45, -depth, 0, 'metal', 'metal', bottom=True)


def tower_block(g, ring, n, fh=3.0, ground=3.2, wall='redbrick', low='darkbrick', bay_col='cream', bay=3.1,
                bay_every=4, bay_depth=0.8, win=1.5, parapet_h=1.3, shops=False, door_every=26.0, crown_col=None,
                gables=True, gcol='glass', min_bay_edge=9.0, roof_rooms=2):
    """a 2000s brick-monolith block: brick walls with window columns, stacked glazed loggia bays, a plinth storey,
    a cornice, a parapet raised into gables over the bays, lift rooms on the roof"""
    top = ground + n * fh
    rows = floors(ground, n, fh, 0.9, 2.35)
    crown_col = crown_col or bay_col
    for e in edges(ring):
        yard = yard_side(ring, e)
        if e.L < 2.4:
            e.front(g, 0, e.L, 0, ground, 0, 'wall2', low)
            e.front(g, 0, e.L, ground, top, 0, 'wall', wall)
            continue
        cols = bays(e.L, bay, 0.9, width=win)
        # stacked loggia bays two window columns wide, sticking out of the brick
        pairs = []
        if bay_every and e.L >= min_bay_edge and len(cols) >= 2:
            k0 = max(0, (len(cols) - 2) // 2) % bay_every if len(cols) <= bay_every + 1 else bay_every // 2
            i = k0
            while i + 1 < len(cols):
                pairs.append(i)
                i += bay_every + 1
        in_bay = {j for i in pairs for j in (i, i + 1)}
        wins = [c for i, c in enumerate(cols) if i not in in_bay]
        openings(g, e, ground, top, wins, rows, 'wall', wall, depth=0.22, gcol=gcol, frame='frame', fcol='pvc')
        for i in pairs:
            t0, t1 = max(0.2, cols[i][0] - 0.55), min(e.L - 0.2, cols[i + 1][1] + 0.55)
            fe = Edge(e.at(t0, 0, -bay_depth)[:2], e.at(t1, 0, -bay_depth)[:2])
            ops = [(max(0.3, cols[j][0] - t0 - 0.35), min(fe.L - 0.3, cols[j][1] - t0 + 0.35)) for j in (i, i + 1)]
            openings(g, fe, ground, top, ops, floors(ground, n, fh, 1.0, fh - 0.3), 'wall', bay_col, depth=0.12,
                     gcol=gcol, frame='frame', fcol='pvc', mullions=1)
            e.side(g, t0, ground, top + parapet_h, -bay_depth, 0, -1, 'wall', bay_col)
            e.side(g, t1, ground, top + parapet_h, -bay_depth, 0, 1, 'wall', bay_col)
            e.flat(g, t0, t1, ground, -bay_depth, 0, False, 'wall', bay_col)
            if gables:
                # a stepped brick gable over the bay
                z1, z2 = top + parapet_h + 1.4, top + parapet_h + 2.3
                e.box(g, t0, t1, top, z1, -bay_depth, 0.35, 'wall', crown_col, top=True, back=True)
                w = (t1 - t0) * 0.28
                e.box(g, t0 + w, t1 - w, z1, z2, -bay_depth, 0.35, 'wall', crown_col, top=False, back=True)
                e.box(g, t0 + w - 0.08, t1 - w + 0.08, z2, z2 + 0.15, -bay_depth - 0.1, 0.45, 'roof', 'roof', bottom=True, back=True)
                e.box(g, t0 - 0.06, t0 + w, z1, z1 + 0.12, -bay_depth - 0.1, 0.45, 'roof', 'roof', back=True)
                e.box(g, t1 - w, t1 + 0.06, z1, z1 + 0.12, -bay_depth - 0.1, 0.45, 'roof', 'roof', back=True)
            else:
                e.box(g, t0, t1, top, top + parapet_h, -bay_depth, 0, 'wall', crown_col, ends=False)
        # the plinth storey: shop windows to the street, entrances to the yard
        if shops and not yard and e.L > 8:
            gc = bays(e.L, 4.5, 0.8, width=3.6)
            openings(g, e, 0, ground, gc, [(0.35, ground - 0.45)], 'wall2', low, depth=0.3, gcol='glass', frame='frame',
                     fcol='graphite', soffit=True)
            e.box(g, 0.4, e.L - 0.4, ground - 0.42, ground - 0.02, -0.25, 0, 'sign', 'white', bottom=True)
        else:
            doors = []
            if yard and e.L > 10:
                nd = max(1, round(e.L / door_every))
                doors = [e.L * (k + 0.5) / nd for k in range(nd)]
            gc = [c for c in bays(e.L, bay, 0.9, width=win) if all(abs((c[0] + c[1]) / 2 - d) > 2.2 for d in doors)]
            openings(g, e, 0, ground, gc, [(0.9, 2.45)], 'wall2', low, depth=0.22, gcol=gcol, frame='frame', fcol='pvc')
            for d in doors:
                door(g, e, d, 0.0, 1.8, 2.3)
    band(g, ring, ground - 0.25, ground, 0.12, 'wall2', low)
    band(g, ring, top - 0.35, top, 0.3, 'wall', crown_col)
    parapet(g, ring, top, parapet_h, 0.4, 'wall', wall, coping='roof', ccol='roof', roof='roof', rcol='gravel')
    # lift and machine rooms
    ang, u0, u1, v0, v1 = oriented(ring)
    ca, sa = math.cos(ang), math.sin(ang)
    for k in range(roof_rooms):
        u = u0 + (u1 - u0) * (k + 0.5) / roof_rooms
        v = (v0 + v1) / 2
        x, y = u * ca - v * sa, u * sa + v * ca
        if point_in(ring, x, y):
            box(g, x, y, 5.0, 3.2, top, top + 2.6, 'wall', wall, ang=ang)
            box(g, x, y, 5.4, 3.6, top + 2.6, top + 2.8, 'roof', 'roof', ang=ang)
    return top + parapet_h + (2.45 if gables else 0)


HEROES = []


def hero(osm_id, ids=None, name=''):
    def register(fn):
        HEROES.append((osm_id, ids or [osm_id], name, fn))
        return fn
    return register


# ───────────────────────── Astrum tower ─────────────────────────

@hero(144710719, [144710719, 144710718, 144710720, 51975033], 'Башня «Аструм» и «Аструм Молл»')
def astrum(g, frame):
    main = local_ring(144710719, frame)
    top_part = local_ring(144710718, frame)
    podium = local_ring(144710720, frame, tol=0.5)
    ang, u0, u1, v0, v1 = oriented(main)
    ca, sa = math.cos(ang), math.sin(ang)
    P = lambda u, v: (u * ca - v * sa, u * sa + v * ca)

    Z_POD, Z_SLAB, Z_CAP, Z_TOP, Z_CROWN = 14.5, 74.0, 77.5, 86.0, 93.0
    FLOOR = 3.0

    # ── podium (the mall top storeys under the tower): orange brick bands and blue glass walls
    prism_edges = edges(podium)
    for i, e in enumerate(prism_edges):
        if e.L < 1.0:
            e.front(g, 0, e.L, 0, Z_POD, 0, 'wall', 'orange')
            continue
        # ground floor: shop glass behind square brick piers
        cols = bays(e.L, 6.0, 0.6, width=5.0)
        openings(g, e, 0, 5.4, cols, [(0.35, 4.6)], wall='wall', col='orange', depth=0.5, gcol='blueglass',
                 frame='frame', fcol='graphite', mullions=2, soffit=True)
        # blue glass curtain on the long walls, orange brick bands on the short ones
        if e.L > 12:
            cols = bays(e.L, 3.4, 1.2, width=3.0)
            openings(g, e, 5.4, Z_POD - 1.2, cols, floors(5.4, 2, (Z_POD - 1.2 - 5.4) / 2, 0.5, 3.6), wall='wall',
                     col='orange', depth=0.18, gcol='blueglass', spandrel=('glass', 'darkglass'))
        else:
            cols = bays(e.L, 3.0, 0.8, width=1.4)
            openings(g, e, 5.4, Z_POD - 1.2, cols, floors(5.4, 2, (Z_POD - 1.2 - 5.4) / 2, 1.0, 2.9), wall='wall',
                     col='orange', depth=0.2, gcol='glass')
        e.front(g, 0, e.L, Z_POD - 1.2, Z_POD, 0, 'wall', 'terracotta')
    band(g, podium, 5.2, 5.6, 0.35, 'metal', 'metal')
    parapet(g, podium, Z_POD, 0.9, 0.3, 'wall', 'terracotta', coping='metal', ccol='metal', roof='roof', rcol='gravel')

    # ── the slab: terracotta brick with small windows; the glass bay rounds its south-east corner
    # tower box in (u, v): the brick is set back from the footprint where the glass bay stands
    bu0, bu1, bv0, bv1 = u0 + 0.6, u1 - 1.6, v0 + 1.6, v1 - 0.6
    # bay: a flattened quarter ellipse from the south face (u = uc) round to the east face (v = vc)
    uc, vc = bu0 + (bu1 - bu0) * 0.6, bv0 + (bv1 - bv0) * 0.47
    ea, eb = u1 - 0.2 - uc, vc - (v0 + 0.2)
    bay_pts = []
    N = 12
    for k in range(N + 1):
        t = (math.pi / 2) * k / N
        bay_pts.append((uc + ea * math.sin(t) ** 0.75, vc - eb * math.cos(t) ** 0.75))
    # brick ring (counter-clockwise) with the bay's corner cut out
    brick = [P(bu0, bv0), P(uc, bv0), P(uc, vc), P(bu1, vc), P(bu1, bv1), P(bu0, bv1)]
    Zs0 = Z_POD + 0.9
    nfl = int((Z_SLAB - Zs0) // FLOOR)
    rows = floors(Zs0, nfl, FLOOR, 0.95, 2.35)
    br = edges(brick)
    # south face west part: small windows with a recessed glass strip between
    e = br[0]
    strip = (e.L - 6.2, e.L - 3.4)
    cols = [c for c in bays(strip[0], 2.9, 0.9, width=1.2)]
    openings(g, Edge(e.at(0, 0)[:2], e.at(strip[0], 0)[:2]), Zs0, Z_SLAB, cols, rows, 'wall', 'terracotta', depth=0.3,
             gcol='darkglass', soffit=False)
    se = Edge(e.at(strip[0], 0)[:2], e.at(strip[1], 0)[:2])
    se.side(g, 0, Zs0, Z_CAP, -0.0, 0.8, 1, 'wall', 'terracotta')
    se.side(g, se.L, Zs0, Z_CAP, 0.0, 0.8, -1, 'wall', 'terracotta')
    se.front(g, 0, se.L, Zs0, Z_CAP, 0.8, 'glass', 'blueglass')
    for r0, r1 in rows:
        se.box(g, 0, se.L, r0 - 0.9, r0 - 0.75, 0.55, 0.8, 'frame', 'graphite', ends=False)
    tail = Edge(e.at(strip[1], 0)[:2], e.at(e.L, 0)[:2])
    openings(g, tail, Zs0, Z_SLAB, bays(tail.L, 2.9, 0.4, width=1.2), rows, 'wall', 'terracotta', depth=0.3, gcol='darkglass')
    # inner corner walls where the bay meets the brick (hidden mostly), then the other faces
    for e in br[1:3]:
        e.front(g, 0, e.L, Zs0, Z_CAP, 0, 'wall', 'terracotta')
    for e in br[3:]:
        openings(g, e, Zs0, Z_SLAB, bays(e.L, 2.9, 0.9, width=1.2), rows, 'wall', 'terracotta', depth=0.3, gcol='darkglass')
    # glass cap band over the brick and the roof of the slab
    for e in [br[0], br[3], br[4], br[5]]:
        e.front(g, 0, e.L, Z_SLAB, Z_CAP, 0, 'glass', 'blueglass')
        e.box(g, 0, e.L, Z_CAP - 0.3, Z_CAP, -0.25, 0, 'metal', 'metal', ends=False)
    cap(g, brick, Z_CAP, 'roof', 'roof')

    # the glass bay: curved blue glass with a slab band per floor, up to the top of the grey block
    bay_ring = [P(uc, vc)] + [P(*p) for p in bay_pts]  # closed back to the corner inside the brick
    for k in range(1, len(bay_ring) - 1):
        e = Edge(bay_ring[k], bay_ring[k + 1])
        if e.L < 1e-3:
            continue
        e.front(g, 0, e.L, Z_POD, Z_TOP, 0, 'glass', 'blueglass')
        for z in [Zs0 + i * FLOOR for i in range(int((Z_TOP - Zs0) // FLOOR) + 1)]:
            e.box(g, 0, e.L, z - 0.12, z + 0.12, -0.12, 0, 'glass', 'darkglass', ends=False, bottom=True)
    cap(g, bay_ring, Z_TOP, 'roof', 'roof')
    cap(g, bay_ring, Z_TOP + 0.6, 'metal', 'metal')
    prism(g, bay_ring[1:], Z_TOP, Z_TOP + 0.6, 'metal', 'metal')

    # ── grey top block with vertical slits, its glass front over the bay
    tp = [P(u, v) for u, v in ((bu0 + 2.5, bv0 + 1.4), (uc, bv0 + 1.4), (uc, vc), (bu1 - 1.5, vc), (bu1 - 1.5, bv1 - 1.6), (bu0 + 2.5, bv1 - 1.6))]
    rows_t = floors(Z_CAP, 3, (Z_TOP - Z_CAP) / 3, 0.5, 2.9)
    for e in edges(tp):
        if e.L < 2.5:
            e.front(g, 0, e.L, Z_CAP, Z_TOP, 0, 'wall2', 'lightgrey')
            continue
        openings(g, e, Z_CAP, Z_TOP, bays(e.L, 3.6, 1.2, width=0.9), rows_t, 'wall2', 'lightgrey', depth=0.2, gcol='darkglass')
    cap(g, tp, Z_TOP, 'roof', 'roof')

    # ── crown: a round drum of dark glass under a dark frieze with the name, a ring canopy on radial fins
    cc = P((bu0 + bu1) / 2 + 1.0, (bv0 + bv1) / 2 - 0.5)
    R = 8.0
    drum = circle(cc[0], cc[1], R, 24)
    for e in edges(drum):
        e.front(g, 0, e.L, Z_TOP, Z_TOP + 3.6, 0, 'glass', 'blueglass')
        e.box(g, 0, e.L, Z_TOP + 1.7, Z_TOP + 1.9, -0.1, 0, 'frame', 'graphite', ends=False)
        e.front(g, 0, e.L, Z_TOP + 3.6, Z_CROWN, 0, 'wall2', '#5a4a40')
    cap(g, drum, Z_CROWN, 'roof', 'roof')
    # ASTRUM round the dark frieze, facing the river (south)
    word, lh, rr_ = 'ASTRUM', 1.9, R + 0.12
    span_a = text_width(word, lh) / rr_
    a_mid = -math.pi / 2
    lettering(g, lambda x, y: (cc[0] + rr_ * math.cos(a_mid - span_a / 2 + x / rr_),
                                 cc[1] + rr_ * math.sin(a_mid - span_a / 2 + x / rr_), Z_TOP + 4.0 + y), word, lh)
    zr = Z_CROWN + 0.6
    n_r = 32
    ring_out = circle(cc[0], cc[1], R + 3.2, n_r)
    ring_in = circle(cc[0], cc[1], R + 2.2, n_r)
    for i in range(n_r):
        a, b = ring_out[i], ring_out[(i + 1) % n_r]
        ia, ib = ring_in[i], ring_in[(i + 1) % n_r]
        g.face([(a[0], a[1], zr + 0.5), (b[0], b[1], zr + 0.5), (ib[0], ib[1], zr + 0.5), (ia[0], ia[1], zr + 0.5)], 'metal', 'metal')
        g.face([(ia[0], ia[1], zr), (ib[0], ib[1], zr), (b[0], b[1], zr), (a[0], a[1], zr)], 'metal', 'metal')
        Edge(a, b).front(g, 0, Edge(a, b).L, zr, zr + 0.5, 0, 'metal', 'metal')
        Edge(ib, ia).front(g, 0, Edge(ib, ia).L, zr, zr + 0.5, 0, 'metal', 'metal')
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        d = Vector((math.cos(a), math.sin(a)))
        p0 = (cc[0] + d.x * R, cc[1] + d.y * R)
        p1 = (cc[0] + d.x * (R + 2.4), cc[1] + d.y * (R + 2.4))
        fin = Edge(p0, p1)
        fin.side(g, 0, Z_CROWN - 2.2, zr + 0.5, -0.12, 0.12, -1, 'metal', 'metal')
        fin.box(g, 0, fin.L, zr - 0.2, zr + 0.5, -0.12, 0.12, 'metal', 'metal', ends=True, bottom=True)
        for sd in (-1, 1):
            q = [fin.at(0, Z_CROWN - 2.2, 0.08 * sd), fin.at(fin.L, zr - 0.2, 0.08 * sd), fin.at(fin.L, zr, 0.08 * sd), fin.at(0, Z_CROWN - 1.9, 0.08 * sd)]
            g.face(q if sd < 0 else q[::-1], 'metal', 'metal')
    # entrance of the mall under a canopy, on the podium wall that faces the river
    front = min(edges(podium), key=lambda e: e.n.y - e.L * 0.01)
    t = front.L / 2
    front.box(g, t - 7, t + 7, 5.0, 5.5, -0.9, 0, 'metal', 'metal', bottom=True)
    front.box(g, t - 6, t + 6, 5.6, 7.2, -0.35, 0, 'sign', 'white', bottom=True)
    return zr + 0.5


# ───────────────────────── chapel of St Seraphim ─────────────────────────

@hero(87408632, name='Часовня Серафима Саровского')
def chapel(g, frame):
    ring = local_ring(87408632, frame, tol=0.05)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rad = min(max(xs) - min(xs), max(ys) - min(ys)) / 2
    d = route_dir(frame)
    ang = math.atan2(d.y, d.x)
    ca, sa = math.cos(ang), math.sin(ang)
    P = lambda u, v: (cx + u * ca - v * sa, cy + u * sa + v * ca)
    rot = lambda p, k: [(p[0], p[1]), (-p[1], p[0]), (-p[0], -p[1]), (p[1], -p[0])][k]
    s, arm, reach = 3.35, 2.15, rad - 0.05
    Z0, ZC = 0.55, 5.5
    quad = [(s, -arm), (reach, -arm), (reach, arm), (s, arm)]
    plan = [P(*rot(p, k)) for k in range(4) for p in quad]
    # plinth, brick walls, white cornice
    prism(g, offset(plan, 0.08), 0, Z0, 'wall2', 'granite')
    cap(g, offset(plan, 0.08), Z0, 'wall2', 'granite')
    prism(g, plan, Z0, ZC, 'wall', '#a8543d')
    band(g, plan, ZC, ZC + 0.4, 0.2, 'trim', 'white')
    band(g, plan, ZC - 0.35, ZC, 0.08, 'trim', 'white', top=False)
    es = edges(plan)
    for k in range(4):
        side_a, front, side_b, chamfer = es[4 * k], es[4 * k + 1], es[4 * k + 2], es[4 * k + 3]
        # white pilasters at the corners of the arm
        for e in (side_a, front, side_b):
            e.box(g, 0, 0.38, Z0, ZC - 0.35, -0.1, 0, 'trim', 'white')
            e.box(g, e.L - 0.38, e.L, Z0, ZC - 0.35, -0.1, 0, 'trim', 'white')
        tm = front.L / 2
        # arched door along the embankment, a tall arched window across it
        if k % 2 == 0:
            w, z_spring = 1.5, 2.45
            poly = [(tm - w / 2, Z0), (tm + w / 2, Z0)] + [(tm + w / 2 * math.cos(math.pi * i / 6), z_spring + w / 2 * math.sin(math.pi * i / 6)) for i in range(7)]
            mat, col = 'dark', 'brown'
        else:
            w, z_spring = 1.0, 3.2
            poly = [(tm - w / 2, 1.7), (tm + w / 2, 1.7)] + [(tm + w / 2 * math.cos(math.pi * i / 6), z_spring + w / 2 * math.sin(math.pi * i / 6)) for i in range(7)]
            mat, col = 'glass', 'darkglass'
        pts = [front.at(t, z, -0.03) for t, z in poly]
        g.face(pts[:2] + pts[2:], mat, col)
        for i in range(len(poly)):
            (t0, z0_), (t1, z1_) = poly[i], poly[(i + 1) % len(poly)]
            if i == 0:
                continue
            ln = math.hypot(t1 - t0, z1_ - z0_)
            nt, nz = (z1_ - z0_) / ln, -(t1 - t0) / ln
            q = [front.at(t0, z0_, -0.08), front.at(t1, z1_, -0.08), front.at(t1 + nt * 0.22, z1_ + nz * 0.22, -0.08), front.at(t0 + nt * 0.22, z0_ + nz * 0.22, -0.08)]
            g.face(q[::-1], 'trim', 'white')
        # round window over it
        zc = ZC - 0.95
        n = 12
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            o0 = front.at(tm + 0.62 * math.cos(a0), zc + 0.62 * math.sin(a0), -0.07)
            o1 = front.at(tm + 0.62 * math.cos(a1), zc + 0.62 * math.sin(a1), -0.07)
            i0 = front.at(tm + 0.4 * math.cos(a0), zc + 0.4 * math.sin(a0), -0.07)
            i1 = front.at(tm + 0.4 * math.cos(a1), zc + 0.4 * math.sin(a1), -0.07)
            g.face([i0, i1, o1, o0][::-1], 'trim', 'white')
        g.face([front.at(tm + 0.4 * math.cos(2 * math.pi * i / n), zc + 0.4 * math.sin(2 * math.pi * i / n), -0.04) for i in range(n)], 'glass', 'darkglass')
        # pediment: brick tympanum, white raking cornices, slate gable roof back to the dome
        zp, rise, t0, t1 = ZC + 0.4, 1.75, -0.2, front.L + 0.2
        back = reach - 3.18
        gable(g, front, t0, t1, zp, rise, -0.05, back, 'wall', '#a8543d')
        for sgn in (-1, 1):
            a = (t0, zp) if sgn < 0 else (t1, zp)
            b = ((t0 + t1) / 2, zp + rise)
            q = [front.at(a[0], a[1], -0.2), front.at(b[0], b[1], -0.2), front.at(b[0], b[1] + 0.28, -0.2), front.at(a[0], a[1] + 0.28, -0.2)]
            g.face(q if sgn < 0 else q[::-1], 'trim', 'white')
            r1 = [front.at(a[0], a[1] + 0.28, -0.2), front.at(b[0], b[1] + 0.28, -0.2), front.at(b[0], b[1] + 0.28, back), front.at(a[0], a[1] + 0.28, back)]
            g.face(r1[::-1] if sgn < 0 else r1, 'roof', '#5b5f64')
        # a narrow arched window on the chamfer between the arms
        tc = chamfer.L / 2
        wpoly = [(tc - 0.35, 2.0), (tc + 0.35, 2.0)] + [(tc + 0.35 * math.cos(math.pi * i / 4), 3.6 + 0.35 * math.sin(math.pi * i / 4)) for i in range(5)]
        g.face([chamfer.at(t, z, -0.03) for t, z in wpoly], 'glass', 'darkglass')
        chamfer.box(g, tc - 0.5, tc + 0.5, 1.85, 2.0, -0.12, 0, 'trim', 'white', bottom=True)
    # the sundial on the wall that faces south
    best = max(es, key=lambda e: -e.n.y if e.L > 2 else -9)
    best_t = best.L / 2
    # octagonal attic, the slate dome, the neck and the gilded onion with its cross
    att = [P(3.55 * math.cos(math.pi / 8 + math.pi * i / 4), 3.55 * math.sin(math.pi / 8 + math.pi * i / 4)) for i in range(8)]
    prism(g, att, ZC + 0.4, ZC + 1.9, 'wall', '#a8543d')
    band(g, att, ZC + 1.9, ZC + 2.2, 0.15, 'trim', 'white')
    zd = ZC + 2.2
    lathe(g, [(3.75, zd), (3.7, zd + 0.7), (3.45, zd + 1.5), (2.95, zd + 2.3), (2.2, zd + 2.95), (1.3, zd + 3.4), (0.6, zd + 3.58), (0.0, zd + 3.62)],
          16, 'roof', 'slate', cx=cx, cy=cy)
    zn = zd + 3.5
    neck = circle(cx, cy, 0.62, 12)
    prism(g, neck, zn, zn + 0.95, 'wall', '#a8543d')
    band(g, neck, zn + 0.95, zn + 1.1, 0.08, 'trim', 'white')
    zo = zn + 1.1
    lathe(g, [(0.66, zo), (0.92, zo + 0.25), (1.05, zo + 0.65), (0.98, zo + 1.05), (0.72, zo + 1.45), (0.4, zo + 1.8), (0.16, zo + 2.1), (0.07, zo + 2.35), (0.0, zo + 2.45)],
          16, 'gold', None, cx=cx, cy=cy)
    zx = zo + 2.4
    ex = Edge(P(-0.06, 0), P(0.06, 0))
    box(g, cx, cy, 0.12, 0.12, zx, zx + 1.9, 'gold', ang=ang)
    for zb, wb, tilt in ((zx + 1.55, 0.5, 0.0), (zx + 1.2, 1.05, 0.0), (zx + 0.55, 0.62, 0.35)):
        c0 = Vector(P(-wb / 2, 0)) - Vector((cx, cy))
        box(g, cx, cy, wb, 0.1, zb, zb + 0.1, 'gold', ang=ang + math.pi / 2 + tilt)
    del ex, best_t
    return zx + 1.9


# ───────────────────────── River House ─────────────────────────

@hero(3491716, name='ЖК «River House»')
def river_house(g, frame):
    ring = local_ring(3491716, frame, tol=0.25)
    xs = [p[0] for p in ring]
    mid = (min(xs) + max(xs)) / 2
    cut_l, cut_r = mid - 5.0, mid + 5.0
    west = clip(ring, -1, 0, cut_l)
    east = clip(ring, 1, 0, -cut_r)
    span = clip(clip(ring, 1, 0, -cut_l), -1, 0, cut_r)
    ZB, FH, NF, NLOW = 7.2, 3.15, 18, 11
    Z_GAP = ZB + NLOW * FH
    Z_TOP = ZB + NF * FH
    parents = edges(ring)

    def columns(e):
        """window columns in the rhythm of the full edge this wall lies on: (t0, t1, dark band?)"""
        for pe in parents:
            a = Vector(e.at(0, 0)[:2]) - pe.p
            if abs(a.dot(pe.n)) < 0.05 and abs(e.u.dot(pe.u) - 1) < 1e-3 and -0.05 <= a.dot(pe.u) <= pe.L + 0.05:
                off = a.dot(pe.u)
                cols = bays(pe.L, 3.5, 0.8, width=1.7)
                out = []
                for i, (t0, t1) in enumerate(cols):
                    dark = len(cols) >= 3 and i % 3 == 1
                    if dark:
                        c = (t0 + t1) / 2
                        t0, t1 = c - 1.35, c + 1.35
                    t0, t1 = t0 - off, t1 - off
                    if t0 > 0.3 and t1 < e.L - 0.3:
                        out.append((t0, t1, dark))
                return out
        return [(t0, t1, False) for t0, t1 in bays(e.L, 3.5, 0.8, width=1.7)]

    def grid(e, z0, z1, n):
        cols = columns(e)
        rows = floors(z0, n, FH, 0.85, 2.55)
        light = [(t0, t1) for t0, t1, dk in cols if not dk]
        dark = [(t0, t1) for t0, t1, dk in cols if dk]
        openings(g, e, z0, z1, light, rows, 'wall', 'cream', depth=0.2, gcol='glass', frame='frame', fcol='graphite')
        for t0, t1 in dark:
            e.box(g, t0, t1, z0, z1, -0.12, 0, 'wall2', 'graphite', top=False)
            for r0, r1 in rows:
                e.front(g, t0 + 0.2, t1 - 0.2, r0 - 0.35, r1, -0.13, 'glass', 'darkglass')

    # the wings stand on a two-storey shop base; the arch between them is open from the ground
    for part in (west, east):
        for e in edges(part):
            cut = any(all(abs(e.at(t, 0)[0] - c) < 1e-3 for t in (0, e.L)) for c in (cut_l, cut_r))
            cols = bays(e.L, 4.2, 0.6, width=3.4)
            openings(g, e, 0, ZB, cols, [(0.3, 3.2), (3.9, 6.6)], 'wall2', 'greige', depth=0.3, gcol='glass',
                     frame='frame', fcol='graphite')
            if cut:
                openings(g, e, ZB, Z_GAP, bays(e.L, 3.5, 1.0, width=1.7), floors(ZB, NLOW, FH, 0.85, 2.55), 'wall', 'cream',
                         depth=0.2, frame='frame', fcol='graphite')
            else:
                grid(e, ZB, Z_GAP, NLOW)
        band(g, part, ZB - 0.45, ZB, 0.35, 'trim', 'cream')
    for e in edges(ring):
        grid(e, Z_GAP, Z_TOP, NF - NLOW)
    cap(g, span, Z_GAP, 'wall', 'cream', up=False)
    # cornices: under the top two floors and at the top, then a set-back crown
    band(g, ring, ZB + (NF - 2) * FH - 0.35, ZB + (NF - 2) * FH, 0.35, 'trim', 'cream')
    band(g, ring, Z_TOP, Z_TOP + 0.5, 0.45, 'trim', 'cream')
    parapet(g, ring, Z_TOP + 0.5, 1.0, 0.35, 'wall', 'cream', coping='trim', ccol='cream', roof='roof', rcol='gravel')
    # lit vertical glass strips on the river side of each wing (the evening lighting of the facade)
    for part in (west, east):
        cands = [e for e in edges(part) if e.n.y > 0.3 and e.L > 8]
        for e in sorted(cands, key=lambda e: -e.L)[:2]:
            cols = columns(e)
            if len(cols) >= 2:
                t = (cols[0][1] + cols[1][0]) / 2
                e.front(g, t - 0.35, t + 0.35, ZB + 0.6, Z_TOP - 0.3, -0.04, 'sign', 'white')
    # stair and lift rooms on the roof of each wing
    for part in (west, east):
        pts = part
        cxp = sum(p[0] for p in pts) / len(pts)
        cyp = sum(p[1] for p in pts) / len(pts)
        ang, *_ = oriented(pts)
        if point_in(ring, cxp, cyp):
            box(g, cxp, cyp, 7.0, 4.0, Z_TOP + 0.5, Z_TOP + 3.6, 'wall', 'cream', ang=ang)
    return Z_TOP + 3.6


# ───────────────────────── brick blocks of the 2000s ─────────────────────────

@hero(93524631, name='Жилой дом, ул. Шмидта, 1')
def shmidta_1(g, frame):
    ring = local_ring(93524631, frame, tol=0.3)
    return tower_block(g, ring, 14, fh=2.95, ground=3.0, wall='redbrick', low='darkbrick', bay_col='cream', bay=3.1,
                       bay_every=4, shops=True)


@hero(60606775, name='Жилой дом, ул. Шмидта, 6')
def shmidta_6(g, frame):
    ring = local_ring(60606775, frame, tol=0.3)
    return tower_block(g, ring, 14, fh=2.95, ground=3.0, wall='beige', low='#8a4a36', bay_col='#a4553d', bay=3.2,
                       bay_every=3, crown_col='#a4553d', shops=False)


# ───────────────────────── Lenina square 8 and the «Premium» pavilion ─────────────────────────

@hero(45557269, name='Бизнес-центр, пл. Ленина, 8')
def lenina_8(g, frame):
    ring = local_ring(45557269, frame, tol=0.3)
    G, FH = 4.2, 3.2
    top = G + 3 * FH
    es = edges(ring)
    longest = max(es, key=lambda e: e.L)
    for e in es:
        if e.L < 2.0:
            e.front(g, 0, e.L, 0, top, 0, 'wall', 'cream')
            continue
        if e is longest:
            # the glass wall
            cols = bays(e.L, 2.0, 0.6, width=1.8)
            openings(g, e, G, top, cols, floors(G, 3, FH, 0.25, 3.0), 'wall', 'cream', depth=0.2, gcol='blueglass',
                     spandrel=('glass', 'darkglass'))
        else:
            cols = bays(e.L, 3.4, 0.9, width=1.8)
            openings(g, e, G, G + 2 * FH, cols, floors(G, 2, FH, 0.9, 2.6), 'wall', 'cream', depth=0.2, frame='frame', fcol='pvc')
            # top floor: tall arched windows with white arches
            z0 = G + 2 * FH
            openings(g, e, z0, top, cols, [(z0 + 0.5, z0 + 2.3)], 'wall', 'cream', depth=0.2, frame='frame', fcol='pvc')
            for t0, t1 in cols:
                tm, r = (t0 + t1) / 2, (t1 - t0) / 2
                arc = [(tm + r * math.cos(math.pi * i / 5), z0 + 2.3 + r * 0.8 * math.sin(math.pi * i / 5)) for i in range(6)]
                g.face([e.at(t, z, -0.02) for t, z in [(t0, z0 + 2.3)] + arc[::-1][1:-1] + [(t1, z0 + 2.3)]][::-1], 'glass', 'glass')
                for i in range(5):
                    (a0, b0), (a1, b1) = arc[i], arc[i + 1]
                    q = [e.at(a0, b0, -0.08), e.at(a1, b1, -0.08), e.at(tm + (a1 - tm) * 1.3, z0 + 2.3 + (b1 - z0 - 2.3) * 1.3, -0.08), e.at(tm + (a0 - tm) * 1.3, z0 + 2.3 + (b0 - z0 - 2.3) * 1.3, -0.08)]
                    g.face(q, 'trim', 'white')
        gc = bays(e.L, 4.2, 0.8, width=3.2)
        openings(g, e, 0, G, gc, [(0.35, 3.2)], 'wall2', 'granite', depth=0.3, frame='frame', fcol='graphite', soffit=True)
    band(g, ring, G - 0.3, G, 0.2, 'wall2', 'granite')
    band(g, ring, top, top + 0.45, 0.4, 'trim', 'white')
    parapet(g, ring, top + 0.45, 0.7, 0.3, 'wall', 'cream', coping='metal', ccol='metal', roof='roof', rcol='gravel')
    return top + 1.15


@hero(156871327, name='Апарт-отель «Premium»')
def premium(g, frame):
    ring = local_ring(156871327, frame, tol=0.05)
    G, FH = 4.0, 3.3
    top = G + 2 * FH
    for e in edges(ring):
        e.front(g, 0, e.L, 0, 0.4, 0, 'wall2', 'granite')
        openings(g, e, 0.4, G, [(0.35, e.L - 0.35)], [(0.5, G - 0.9)], 'wall2', 'terracotta', depth=0.25, gcol='glass',
                 frame='frame', fcol='graphite')
        openings(g, e, G, top, [(e.L / 2 - 0.7, e.L / 2 + 0.7)], floors(G, 2, FH, 0.9, 2.6), 'wall', 'terracotta', depth=0.22,
                 frame='frame', fcol='pvc')
    band(g, ring, G - 0.35, G, 0.25, 'trim', 'white')
    band(g, ring, top, top + 0.45, 0.35, 'trim', 'white')
    south = sorted(edges(ring), key=lambda e: e.n.y)[:3]
    for e in south:
        e.box(g, 0.1, e.L - 0.1, G - 0.9, G - 0.4, -0.3, 0, 'sign', 'signblue', bottom=True)
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    r = (max(xs) - min(xs)) / 2 + 0.3
    lathe(g, [(r, top + 0.45), (r * 0.8, top + 1.4), (r * 0.35, top + 2.3), (0.0, top + 2.6)], 16, 'metal', 'green', cx=cx, cy=cy, smooth=False)
    return top + 2.6


# ───────────────────────── Lenina square and Sovetskaya street ─────────────────────────

@hero(1763313, name='Кинотеатр «Пять Звёзд» («Аврора»)')
def cinema(g, frame):
    ring = local_ring(1763313, frame, tol=0.15)
    es = edges(ring)
    # the rotunda stands in the corner where the footprint turns in a run of short edges bending left
    best, run = [], []
    for i in range(len(es)):
        a, b = es[i], es[(i + 1) % len(es)]
        if a.L < 7.5 and b.L < 7.5 and a.u.x * b.u.y - a.u.y * b.u.x > 0.05:
            run.append(i)
        else:
            best, run = max(best, run, key=len), []
    best = max(best, run, key=len)
    arc_pts = [ring[i % len(ring)] for i in range(best[0], best[-1] + 3)]
    rcx, rcy, rr = circle_fit(arc_pts)
    # «Аврора» is the taller white half west of the rotunda, «Пять Звёзд» the beige half east of it
    H_W, H_E = 12.5, 10.5
    halves = ((clip(ring, -1, 0, rcx), H_W), (clip(ring, 1, 0, -rcx), H_E))
    for part, H in halves:
        pes = edges(part)
        front = min(pes, key=lambda e: e.n.y - e.L * 0.001)
        street = max(pes, key=lambda e: e.L if e.n.x > 0.85 else -1)
        for e in pes:
            mid = Vector(e.at(e.L / 2, 0)[:2])
            if e.L < 0.3 or abs((mid - Vector((rcx, rcy))).length - rr) < 1.2:
                continue
            if all(abs(e.at(t, 0)[0] - rcx) < 1e-3 for t in (0, e.L)):
                if H == H_W:
                    e.front(g, 0, e.L, H_E, H_W, 0, 'wall', 'lightgrey')
                continue
            if H == H_W and e.n.y < -0.9:
                cols = bays(e.L, 4.6, 1.2, width=2.2)
                openings(g, e, 0, H, cols, [(0.6, H - 1.3)], 'wall', 'lightgrey', depth=0.35, gcol='glass', frame='frame',
                         fcol='lightgrey', mullions=1, soffit=True)
                for k in range(1, int(e.L / 1.15)):
                    e.front(g, k * 1.15 - 0.015, k * 1.15 + 0.015, 0.3, H - 0.3, -0.01, 'frame', 'greige')
            elif H == H_E and e is street:
                openings(g, e, 0, H, [(e.L * 0.2, e.L * 0.8)], [(0.2, 3.6)], 'wall', '#d7c2a6', depth=0.4, frame='frame',
                         fcol='graphite', mullions=4, soffit=True)
                e.box(g, e.L * 0.15, e.L * 0.85, 3.8, 4.2, -2.0, 0, 'metal', 'metal', bottom=True)
                e.box(g, e.L * 0.08, e.L * 0.92, 5.4, 9.4, -0.2, 0, 'wall2', 'graphite', bottom=True)
                wall_text(g, e, 'КИНОТЕАТР', e.L / 2, 7.9, 1.0, d=-0.24)
                wall_text(g, e, 'ПЯТЬ ЗВЁЗД', e.L / 2, 5.9, 1.4, d=-0.24, col='signred')
            else:
                wall = ('lightgrey' if H == H_W else '#d7c2a6')
                cols = bays(e.L, 6.0, 2.0, width=1.6) if e.L > 8 else []
                openings(g, e, 0, H, cols, [(1.0, 3.0), (6.0, 8.2)], 'wall', wall, depth=0.2, frame='frame', fcol='pvc')
        band(g, part, H - 0.6, H, 0.25, 'trim', 'white')
        parapet(g, part, H, 0.7, 0.3, 'wall', 'lightgrey' if H == H_W else '#d7c2a6', coping='metal', ccol='metal',
                roof='roof', rcol='gravel')
        if H == H_W:
            # АВРОРА on a frame over the white front
            st = front.L / 2
            w = text_width('АВРОРА', 2.2)
            wall_text(g, front, 'АВРОРА', st, H + 1.4, 2.2, d=0.9, col='signyellow')
            front.box(g, st - w / 2, st + w / 2, H + 0.7, H + 1.4, 0.95, 1.2, 'metal', 'metal')
    # the rotunda: a glass ground ring, stacked plaster rings with cornices, a glass lantern on top
    tiers = [(0.0, 4.4, rr - 0.3, 'glass', 'glass'), (4.4, 7.8, rr, 'wall', '#d9b8a8'), (7.8, 11.2, rr + 0.35, 'wall', '#d9b8a8'),
             (11.2, 13.8, rr - 2.2, 'glass', 'blueglass')]
    for z0, z1, r_, mat, col in tiers:
        cir = circle(rcx, rcy, r_, 28)
        for e in edges(cir):
            e.front(g, 0, e.L, z0, z1, 0, mat, col)
        if mat == 'wall':
            band(g, cir, z1 - 0.35, z1, 0.3, 'trim', 'white')
            cap(g, offset(cir, 0.3), z1, 'roof', 'roof')
    lathe(g, [(rr - 2.0, 13.8), (rr - 2.6, 14.4), (0.0, 14.9)], 28, 'metal', 'metal', cx=rcx, cy=rcy, smooth=False)
    return 14.9


@hero(51976788, name='Жилой дом, пл. Ленина, 1')
def lenina_1(g, frame):
    ring = local_ring(51976788, frame, tol=0.3)
    G, FH, NF = 3.4, 2.8, 8
    top = G + NF * FH
    rows = floors(G, NF, FH, 0.85, 2.3)
    for e in edges(ring):
        if e.L < 4:
            e.front(g, 0, e.L, 0, top, 0, 'wall', 'sand')
            continue
        cols = bays(e.L, 3.2, 0.8, width=1.5)
        street = e.n.x < -0.5
        # every third bay a recessed loggia with a white parapet
        win = [c for i, c in enumerate(cols) if i % 3 != 1 or e.L < 20]
        log = [((c[0] + c[1]) / 2 - 1.35, (c[0] + c[1]) / 2 + 1.35) for i, c in enumerate(cols) if i % 3 == 1 and e.L >= 20]
        openings(g, e, G, top, win, rows, 'wall', 'sand', depth=0.22, frame='frame', fcol='pvc', holes=log)
        for t0, t1 in log:
            sub = Edge(e.at(t0, 0)[:2], e.at(t1, 0)[:2])
            openings(g, sub, G, top, [(0.0, sub.L)], floors(G, NF, FH, 1.05, FH - 0.2), 'wall', 'sand', depth=1.1,
                     gcol='glass', spandrel=('trim', 'white'), frame='frame', fcol='pvc', mullions=2)
        if street:
            gc = bays(e.L, 4.8, 0.8, width=3.8)
            openings(g, e, 0, G, gc, [(0.3, G - 0.5)], 'wall2', 'granite', depth=0.3, frame='frame', fcol='graphite', soffit=True)
            e.box(g, 0.5, e.L - 0.5, G - 0.45, G - 0.05, -0.9, 0, 'sign', 'orange', bottom=True)
        else:
            nd = max(1, round(e.L / 28))
            doors = [e.L * (k + 0.5) / nd for k in range(nd)]
            gc = [c for c in bays(e.L, 3.2, 0.8, width=1.5) if all(abs((c[0] + c[1]) / 2 - d) > 2 for d in doors)]
            openings(g, e, 0, G, gc, [(0.9, 2.5)], 'wall2', '#a38f72', depth=0.22, frame='frame', fcol='pvc')
            for d in doors:
                door(g, e, d, 0.0, 1.8, 2.3)
    band(g, ring, G - 0.3, G, 0.12, 'wall2', '#a38f72')
    parapet(g, ring, top, 1.0, 0.4, 'wall', 'sand', coping='roof', ccol='roof', roof='roof', rcol='gravel')
    ang, u0, u1, v0, v1 = oriented(ring)
    ca, sa = math.cos(ang), math.sin(ang)
    for k in range(4):
        u, v = u0 + (u1 - u0) * (k + 0.5) / 4, (v0 + v1) / 2
        box(g, u * ca - v * sa, u * sa + v * ca, 4.5, 3.0, top, top + 2.4, 'wall', 'sand', ang=ang)
    return top + 2.4


# ───────────────────────── Proletarsky prospekt and 1st Sovetsky lane ─────────────────────────

@hero(47710002, name='Пассаж «Клязьма»')
def passazh(g, frame):
    ring = local_ring(47710002, frame, tol=0.2)
    G, H = 3.9, 7.4
    es = edges(ring)
    street = max((e for e in es if e.L > 10), key=lambda e: e.n.x)
    for e in es:
        if e.L < 0.5:
            continue
        curved = e.L < 15 and e.n.x > 0.4 and e.n.y > 0.3
        if curved or e is street:
            # glass shopfronts under a sign band, a glazed upper floor
            openings(g, e, 0, G, bays(e.L, 4.0, 0.4, width=3.4), [(0.25, G - 0.55)], 'wall2', 'graphite', depth=0.3,
                     frame='frame', fcol='graphite', soffit=True)
            openings(g, e, G, H, bays(e.L, 2.2, 0.4, width=1.9), [(G + 0.8, H - 0.9)], 'wall', '#e2ddd3', depth=0.15,
                     gcol='blueglass', frame='frame', fcol='lightgrey')
            e.box(g, 0.2, e.L - 0.2, G - 0.5, G + 0.3, -0.35, 0, 'sign', 'signblue', bottom=True)
        else:
            cols = bays(e.L, 8.0, 2.0, width=2.4) if e.L > 12 else []
            openings(g, e, 0, H, cols, [(0.3, 2.8)], 'wall', '#e2ddd3', depth=0.25, frame='frame', fcol='graphite')
            e.front(g, 0, e.L, 0, 0.5, -0.02, 'wall2', 'graphite')
    wall_text(g, street, 'ПАССАЖ «КЛЯЗЬМА»', street.L / 2, H + 0.35, 1.2, d=-0.1, col='signred')
    street.box(g, street.L / 2 - 11, street.L / 2 + 11, H, H + 0.3, -0.15, 0.3, 'metal', 'metal')
    band(g, ring, H - 0.4, H, 0.3, 'trim', 'white')
    parapet(g, ring, H, 0.8, 0.3, 'wall', '#e2ddd3', coping='metal', ccol='metal', roof='roof', rcol='gravel')
    cx, cy = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    box(g, cx, cy, 6, 3, H, H + 1.8, 'metal', 'metal', ang=oriented(ring)[0])
    return H + 1.8


@hero(51975813, name='Центр услуг «Эрион»')
def erion(g, frame):
    ring = local_ring(51975813, frame, tol=0.2)
    G, FH = 3.8, 3.1
    top = G + 2 * FH
    rd = route_dir(frame)
    es = edges(ring)
    front = max(es, key=lambda e: abs(e.n.x * rd.y - e.n.y * rd.x) * (1 if e.n.y < 0 else 0.5))
    for e in es:
        cols = bays(e.L, 3.0, 1.0, width=1.6)
        openings(g, e, G, top, cols, floors(G, 2, FH, 0.85, 2.5), 'wall', '#9c5a42', depth=0.25, frame='frame', fcol='pvc',
                 sill='trim', scol='white')
        if e is front:
            openings(g, e, 0, G, bays(e.L, 4.2, 0.8, width=3.4), [(0.3, G - 0.5)], 'wall2', 'granite', depth=0.3,
                     frame='frame', fcol='graphite', soffit=True)
            e.box(g, e.L / 2 - 2.5, e.L / 2 + 2.5, G - 0.45, G - 0.05, -1.6, 0, 'metal', 'metal', bottom=True)
            e.box(g, e.L / 2 - 5.2, e.L / 2 + 5.2, top - 0.05, top + 1.9, -0.25, 0, 'wall2', 'graphite', bottom=True)
            wall_text(g, e, 'ЭРИОН', e.L / 2, top + 0.35, 1.3, d=-0.33, col='signyellow')
        else:
            openings(g, e, 0, G, bays(e.L, 3.0, 1.0, width=1.6), [(0.9, 2.7)], 'wall2', '#7e4634', depth=0.25, frame='frame', fcol='pvc')
    band(g, ring, G - 0.3, G, 0.15, 'trim', 'white')
    band(g, ring, top - 0.45, top, 0.35, 'trim', 'white')
    parapet(g, ring, top, 0.8, 0.35, 'wall', '#9c5a42', coping='roof', ccol='roof', roof='roof', rcol='gravel')
    return top + 1.9


@hero(5675518, name='Жилой дом, Пролетарский пр., 9 к1')
def proletarsky_9k1(g, frame):
    ring = local_ring(5675518, frame, tol=0.35)
    return tower_block(g, ring, 9, fh=2.95, ground=3.0, wall='#b8573a', low='darkbrick', bay_col='cream', bay=3.0,
                       bay_every=3, min_bay_edge=7.0, shops=False)


# ───────────────────────── wave 2: 1st Sovetsky lane ─────────────────────────

def house_1930(g, ring, n=4, fh=3.2, wall='#a14f38', dec='#caa465', roof_col='#5e6a66'):
    """a 1930 workers' house of the silk mill (as 1st Sovetsky 19 on Commons): red brick with yellow brick
    pilasters, belt courses and sills, a white-painted plinth line, a hipped iron roof with chimneys"""
    z0 = 0.7
    top = z0 + n * fh
    rows = floors(z0, n, fh, 1.0, 2.75)
    for e in edges(ring):
        e.box(g, 0, e.L, 0, z0, -0.06, 0, 'wall2', '#7a5646', ends=False)
        if e.L < 2.2:
            e.front(g, 0, e.L, z0, top, 0, 'wall', wall)
            continue
        cols = bays(e.L, 3.0, 0.9, width=1.25)
        openings(g, e, z0, top, cols, rows, 'wall', wall, depth=0.3, frame='frame', fcol='pvc', sill='wall', scol=dec)
        # yellow brick pilasters between every second pair of windows and at the corners
        step = (e.L - 1.8) / max(1, len(cols))
        for k in range(0, len(cols) + 1, 2):
            t = min(max(0.9 + step * k, 0.35), e.L - 0.35)
            e.box(g, t - 0.35, t + 0.35, z0, top - 0.6, -0.1, 0, 'wall', dec, top=False)
    for k in range(1, n):
        band(g, ring, z0 + k * fh - 0.3, z0 + k * fh - 0.05, 0.12, 'wall', dec)
    band(g, ring, top - 0.6, top, 0.35, 'wall', dec)
    ang, u0, u1, v0, v1 = oriented(ring)
    rise = min(3.0, (v1 - v0) * 0.28)
    hip_roof(g, ring, top, rise, (v1 - v0) / 2 - 0.6, 'roof', roof_col)
    ca, sa = math.cos(ang), math.sin(ang)
    vm = (v0 + v1) / 2
    for k in range(max(2, int((u1 - u0) / 12))):
        u = u0 + (u1 - u0) * (k + 0.5) / max(2, int((u1 - u0) / 12))
        box(g, u * ca - vm * sa, u * sa + vm * ca, 0.9, 0.7, top + rise - 0.3, top + rise + 1.3, 'wall', wall, ang=ang)
    return top + rise + 1.3


@hero(53356631, name='Жилой дом, 1-й Советский пер., 5')
def sovetsky_5(g, frame):
    return house_1930(g, local_ring(53356631, frame, tol=0.6))


@hero(1958049, name='Жилой дом, 1-й Советский пер., 3')
def sovetsky_3(g, frame):
    return house_1930(g, local_ring(1958049, frame, tol=0.6), wall='#9a4a35')


@hero(59625754, name='Жилой дом, 1-й Советский пер., 4')
def sovetsky_4(g, frame):
    """a 1965 five-storey large-panel block: pale panels with dark joints, balconies to the lane, porches behind"""
    ring = local_ring(59625754, frame, tol=0.5)
    z0, fh, n = 0.9, 2.8, 5
    top = z0 + n * fh
    rows = floors(z0, n, fh, 0.85, 2.3)
    for e in edges(ring):
        e.box(g, 0, e.L, 0, z0, -0.08, 0, 'wall2', '#8e8a82', ends=False)
        if e.L < 4:
            e.front(g, 0, e.L, z0, top, 0, 'wall', 'silicate')
            continue
        cols = bays(e.L, 3.2, 0.4, width=1.45)
        openings(g, e, z0, top, cols, rows, 'wall', '#cdc9bf', depth=0.15, frame='frame', fcol='pvc')
        step = (e.L - 0.8) / max(1, len(cols))
        for k in range(1, len(cols)):
            e.front(g, 0.4 + step * k - 0.03, 0.4 + step * k + 0.03, z0, top, -0.01, 'dark', '#6e6b66')
        for k in range(1, n):
            e.front(g, 0, e.L, z0 + k * fh - 0.03, z0 + k * fh + 0.03, -0.01, 'dark', '#6e6b66')
        if e.L > 20 and faces_route(frame, e, 60):
            for i, (t0, t1) in enumerate(cols):
                if i % 2:
                    continue
                for k in range(1, n):
                    z = z0 + k * fh
                    e.box(g, t0 - 0.5, t1 + 0.5, z - 0.12, z + 0.04, -1.0, 0, 'wall2', '#a7a298', bottom=True)
                    e.box(g, t0 - 0.5, t1 + 0.5, z + 0.04, z + 1.0, -1.0, -0.94, 'metal', '#77776f', top=True)
        elif e.L > 20:
            nd = max(1, round(e.L / 15))
            for k in range(nd):
                door(g, e, e.L * (k + 0.5) / nd, 0.3, 1.4, 2.1, depth=1.0)
    parapet(g, ring, top, 0.5, 0.3, 'wall', '#cdc9bf', coping='roof', ccol='roof', roof='roof', rcol='roof')
    return top + 0.5


@hero(40760773, name='Жилой дом, 1-й Советский пер., 6')
def sovetsky_6(g, frame):
    """a 1971 five-storey brick block: silicate brick long walls, red brick gable ends, balconies, porches"""
    ring = local_ring(40760773, frame, tol=0.5)
    z0, fh, n = 0.8, 2.85, 5
    top = z0 + n * fh
    rows = floors(z0, n, fh, 0.85, 2.3)
    for e in edges(ring):
        e.box(g, 0, e.L, 0, z0, -0.06, 0, 'wall2', '#8a8378', ends=False)
        if e.L < 20:
            e.front(g, 0, e.L, z0, top, 0, 'wall', '#9c5139')
            continue
        cols = bays(e.L, 3.3, 0.8, width=1.5)
        openings(g, e, z0, top, cols, rows, 'wall', 'silicate', depth=0.22, frame='frame', fcol='pvc')
        if faces_route(frame, e, 60):
            for i, (t0, t1) in enumerate(cols):
                if i % 3 != 1:
                    continue
                for k in range(1, n):
                    z = z0 + k * fh
                    e.box(g, t0 - 0.6, t1 + 0.6, z - 0.12, z + 0.02, -1.1, 0, 'wall2', '#9b968c', bottom=True)
                    e.box(g, t0 - 0.6, t1 + 0.6, z + 0.02, z + 1.0, -1.1, -1.06, 'metal', 'metal', top=False)
        else:
            nd = max(1, round(e.L / 18))
            for k in range(nd):
                t = e.L * (k + 0.5) / nd
                door(g, e, t, 0.3, 1.5, 2.1, depth=1.1)
                e.front(g, t - 0.6, t + 0.6, z0 + 3.2, top - 1.0, 0.1, 'glass', 'glass')
    band(g, ring, top - 0.25, top, 0.15, 'wall', 'silicate')
    parapet(g, ring, top, 0.6, 0.35, 'wall', 'silicate', coping='roof', ccol='roof', roof='roof', rcol='roof')
    return top + 0.6


@hero(131974558, name='Магазин-ателье, 1-й Советский пер., 7А')
def sovetsky_7a(g, frame):
    """a two-storey brick shop with a hipped roof (look not confirmed by a photo)"""
    ring = local_ring(131974558, frame, tol=0.3)
    G, top = 3.6, 6.8
    for e in edges(ring):
        if e.L < 2.5:
            e.front(g, 0, e.L, 0, top, 0, 'wall', '#a8674c')
            continue
        shop = faces_route(frame, e)
        if shop:
            openings(g, e, 0, G, bays(e.L, 3.6, 0.6, width=2.8), [(0.3, G - 0.6)], 'wall2', '#6f4a3b', depth=0.3,
                     frame='frame', fcol='graphite', soffit=True)
            e.box(g, 0.4, e.L - 0.4, G - 0.55, G - 0.1, -0.3, 0, 'sign', 'signblue', bottom=True)
        else:
            openings(g, e, 0, G, bays(e.L, 3.0, 0.8, width=1.3), [(0.9, 2.6)], 'wall', '#a8674c', depth=0.25, frame='frame', fcol='pvc')
        openings(g, e, G, top, bays(e.L, 3.0, 0.8, width=1.3), [(G + 0.8, top - 0.6)], 'wall', '#a8674c', depth=0.25,
                 frame='frame', fcol='pvc', sill='trim', scol='white')
    band(g, ring, top - 0.4, top, 0.25, 'trim', 'white')
    hip_roof(g, ring, top, 2.2, 3.5, 'roof', '#5b5f63', tol=0.6)
    return top + 2.2


# ───────────────────────── wave 2: Lenina square and Sovetskaya street ─────────────────────────

@hero(1958050, name='Историко-художественный музей, Советская ул., 54')
def sovetskaya_54(g, frame):
    """the town museum, Sovetskaya 54 (opened 1999), by the stela roundabout (Commons «Въездной знак на фоне
    Историко-краеведческого музея», «Краеведческий Щелково»): a white
    corner rounded towards the roundabout with two storeys of shop glazing, a yellow wing with a balcony, a green
    iron roof and a semicircular gable over the rounded corner"""
    ring = local_ring(1958050, frame, tol=0.03)
    es = edges(ring)
    run = short_run(es, 2.0)
    curve = set(run)
    cpts = [es[i].at(0, 0)[:2] for i in run] + [es[run[-1]].at(es[run[-1]].L, 0)[:2]]
    ccx, ccy, cr = circle_fit(cpts)
    Z1, top = 7.2, 10.2

    def white(e):
        x, y, _ = e.at(e.L / 2, 0)
        return (Vector((x, y)) - Vector((ccx, ccy))).length < cr + 2.5

    for i, e in enumerate(es):
        if e.L < 0.05:
            continue
        wall, col = ('wall', '#efeadf') if white(e) or i in curve else ('wall', '#e3c56c')
        e.box(g, 0, e.L, 0, 0.5, -0.05, 0, 'wall2', '#cf9b93', ends=False)
        if i in curve:
            e.front(g, 0, e.L, 0.5, 3.4, 0.25, 'glass', 'glass')
            e.front(g, 0, e.L, 3.4, 4.0, 0.0, 'glass2', None)
            e.front(g, 0, e.L, 4.0, Z1 - 0.2, 0.25, 'glass', 'glass')
            e.front(g, 0, e.L, Z1 - 0.2, top, 0, wall, col)
            e.front(g, e.L / 2 - 0.35, e.L / 2 + 0.35, Z1 + 0.8, top - 0.9, -0.02, 'glass', 'glass')
            continue
        if e.L < 2.0:
            e.front(g, 0, e.L, 0.5, top, 0, wall, col)
            continue
        cols = bays(e.L, 3.1, 0.5, width=2.5)
        openings(g, e, 0.5, Z1, cols, [(0.6, 2.9), (3.5, Z1 - 0.9)], wall, col, depth=0.25, gcol='glass',
                 spandrel=('glass2', None), frame='frame', fcol='pvc', mullions=1)
        wcols = bays(e.L, 3.1, 0.5, width=1.4)
        openings(g, e, Z1, top, wcols, [(Z1 + 0.8, top - 0.9)], wall, col, depth=0.22, frame='frame', fcol='pvc')
    band(g, ring, Z1 - 0.3, Z1, 0.12, 'trim', 'white')
    band(g, ring, top - 0.45, top, 0.35, 'trim', 'white')
    hip_roof(g, ring, top, 1.8, 3.0, 'roof', '#4f7a63', overhang=0.4, tol=0.9)
    # the semicircular gable over the rounded corner, with its arched window
    mid = run[len(run) // 2]
    em = es[mid]
    tm = em.L / 2
    R = 2.8
    arc = [(tm + R * math.cos(math.pi * k / 10), top + R * math.sin(math.pi * k / 10)) for k in range(11)]
    for dsg in (-0.4, 0.3):
        pts = [em.at(t, z, dsg) for t, z in arc]
        g.face(pts if dsg < 0 else pts[::-1], 'wall', '#efeadf')
    for (t0, z0), (t1, z1) in zip(arc, arc[1:]):
        g.face([em.at(t0, z0, -0.4), em.at(t1, z1, -0.4), em.at(t1, z1, 0.3), em.at(t0, z0, 0.3)][::-1], 'trim', 'white')
    win = [(tm + 1.2 * math.cos(math.pi * k / 8), top + 0.4 + 1.2 * math.sin(math.pi * k / 8)) for k in range(9)]
    g.face([em.at(t, z, -0.43) for t, z in win][::-1], 'glass', 'glass')
    # balcony on the yellow wing's longest wall towards the square
    ew = max((e for e in es if not white(e)), key=lambda e: e.L)
    ew.box(g, ew.L * 0.3, ew.L * 0.7, Z1 - 0.15, Z1 + 0.05, -1.0, 0, 'trim', 'white', bottom=True)
    ew.box(g, ew.L * 0.3, ew.L * 0.7, Z1 + 0.05, Z1 + 1.0, -1.0, -0.95, 'metal', 'metal', top=False)
    return top + R


@hero(653362077, [653362077, 653362075, 653362080], name='Торгово-офисное здание, пл. Ленина, 5')
def lenina_5_shops(g, frame):
    """the four-storey commercial range of Lenina square 5 (Commons «panoramio (54)»): sand-yellow brick with red
    brick bands, shops with green light boxes, a middle block standing on columns over a passage"""
    north = local_ring(653362077, frame, tol=0.4)
    south = local_ring(653362075, frame, tol=0.4)
    top_n = max(north, key=lambda p: p[1])
    s_edge = sorted(north, key=lambda p: p[1])[:2]
    n_edge = sorted(south, key=lambda p: -p[1])[:3]
    # the middle block spans between the facing walls of the two parts
    xs_s = [p[0] for p in s_edge]
    xs_n = [p[0] for p in n_edge]
    ys_s = sum(p[1] for p in s_edge) / 2
    ys_n = sum(p[1] for p in n_edge) / 3
    middle = ccw([(min(xs_n), ys_n), (max(xs_n), ys_n), (max(xs_s), ys_s), (min(xs_s), ys_s)])
    del top_n
    G, FH, n = 3.8, 3.1, 3
    top = G + n * FH
    rows = floors(G, n, FH, 0.9, 2.45)
    wall, red = '#d4bd92', '#a25a44'
    for part in (north, middle, south):
        others = [r for r in (north, middle, south) if r is not part]
        for e in edges(part):
            x, y, _ = e.at(e.L / 2, 0)
            if any(point_in(o, x + e.n.x * 0.8, y + e.n.y * 0.8) for o in others):
                continue
            if e.L < 1.5:
                e.front(g, 0, e.L, 0, top, 0, 'wall', wall)
                continue
            cols = bays(e.L, 3.0, 0.7, width=1.7)
            openings(g, e, G, top, cols, rows, 'wall', wall, depth=0.22, frame='frame', fcol='pvc')
            for r0, r1 in rows:
                e.box(g, 0, e.L, r1 + 0.1, r1 + 0.45, -0.04, 0, 'wall2', red, ends=False)
            if part is middle:
                # the passage: the ground storey set back behind square columns
                e.flat(g, 0, e.L, G, 0, 3.0, False, 'wall', wall)
                e.front(g, 0, e.L, 0, G, 3.0, 'dark', '#3a3530')
                for t in [0.3 + (e.L - 0.6) * k / 3 for k in range(4)]:
                    e.box(g, t - 0.3, t + 0.3, 0, G, -0.0, 0.6, 'wall2', red, top=False)
                continue
            if faces_route(frame, e, 60) or e.n.x > 0.7:
                gc = bays(e.L, 3.8, 0.6, width=3.0)
                openings(g, e, 0, G, gc, [(0.3, G - 0.8)], 'wall', wall, depth=0.3, frame='frame', fcol='graphite', soffit=True)
                e.box(g, 0.5, e.L - 0.5, G - 0.75, G - 0.2, -0.3, 0, 'sign', '#2e8b4a', bottom=True)
            else:
                openings(g, e, 0, G, bays(e.L, 3.0, 0.7, width=1.5), [(0.9, 2.7)], 'wall', wall, depth=0.22, frame='frame', fcol='pvc')
        band(g, part, top - 0.35, top, 0.2, 'wall2', red)
        parapet(g, part, top, 0.7, 0.3, 'wall', wall, coping='roof', ccol='roof', roof='roof', rcol='gravel')
    # the green shop boxes with their names on the wall facing the route (or east)
    names = ['ОРТОПЕДИЯ', 'ОПТИКА', 'АПТЕКА']
    eb = max(edges(north), key=lambda e: (e.n.x > 0.7) * e.L)
    k0 = eb.L / 6
    for k, word in enumerate(names):
        wall_text(g, eb, word, k0 * (2 * k + 1), G - 0.7, 0.42, d=-0.33)
    # a stepped brick attic over the middle block
    for e in edges(middle):
        x, y, _ = e.at(e.L / 2, 0)
        if e.n.x > 0.7 and not any(point_in(o, x + e.n.x * 0.8, y + e.n.y * 0.8) for o in (north, south)):
            e.box(g, e.L * 0.2, e.L * 0.8, top, top + 1.4, -0.05, 0.4, 'wall', wall, back=True)
            e.box(g, e.L * 0.35, e.L * 0.65, top + 1.4, top + 2.4, -0.05, 0.4, 'wall', wall, back=True)
    return top + 2.4


@hero(63161145, name='Административное здание, пл. Ленина, 7')
def lenina_7(g, frame):
    """Lenina square 7 (built 2008, the district prosecutor's office per local directories; Commons «panoramio (81)»):
    sand-yellow brick over a red brick ground storey, red brick corner pilasters, white cornice, a porch"""
    ring = local_ring(63161145, frame, tol=0.5)
    G, FH, n = 3.6, 3.1, 3
    top = G + n * FH
    rows = floors(G, n, FH, 0.9, 2.5)
    es = edges(ring)
    porch = max(es, key=lambda e: e.L * (1.5 if faces_route(frame, e) else 1.0))
    for e in es:
        if e.L < 1.6:
            e.front(g, 0, e.L, 0, G, 0, 'wall2', '#9d5a46')
            e.front(g, 0, e.L, G, top, 0, 'wall', '#dcc89e')
            continue
        cols = bays(e.L, 3.2, 1.0, width=1.5)
        openings(g, e, G, top, cols, rows, 'wall', '#dcc89e', depth=0.24, frame='frame', fcol='pvc', sill='trim', scol='white')
        gcols = bays(e.L, 3.2, 1.0, width=1.5)
        if e is porch:
            gcols = [c for c in gcols if abs((c[0] + c[1]) / 2 - e.L / 2) > 2.2]
        openings(g, e, 0, G, gcols, [(0.9, 2.8)], 'wall2', '#9d5a46', depth=0.24, frame='frame', fcol='pvc')
        if e.L > 6:
            for t in (0.0, e.L - 0.7):
                e.box(g, t, t + 0.7, G, top, -0.12, 0, 'wall2', '#9d5a46', top=False)
    band(g, ring, G - 0.2, G, 0.1, 'trim', 'white')
    band(g, ring, top - 0.45, top, 0.35, 'trim', 'white')
    parapet(g, ring, top, 0.7, 0.3, 'wall', '#dcc89e', coping='metal', ccol='metal', roof='roof', rcol='gravel')
    t = porch.L / 2
    porch.box(g, t - 2.0, t + 2.0, 0, G + 0.6, -0.5, 0, 'wall2', '#9d5a46', top=True)
    porch.front(g, t - 0.9, t + 0.9, 0.3, 2.6, -0.52, 'dark', '#2b2522')
    porch.box(g, t - 2.4, t + 2.4, 2.9, 3.2, -1.6, -0.5, 'metal', 'metal', bottom=True)
    porch.box(g, t - 2.4, t + 2.4, 0, 0.3, -2.2, -0.5, 'wall2', 'granite', top=True)
    return top + 0.7


@hero(45557012, name='Административное здание, пл. Ленина, 5')
def lenina_5(g, frame):
    """the nine-storey office tower of Lenina square 5 (Commons «panoramio (49)»): beige brick, vertical piers,
    shops under a yellow sign band"""
    ring = local_ring(45557012, frame, tol=0.3)
    G, FH, NF = 4.0, 3.1, 8
    top = G + NF * FH
    for e in edges(ring):
        cols = bays(e.L, 3.3, 1.2, width=2.2)
        openings(g, e, G, top, cols, floors(G, NF, FH, 0.9, 2.5), 'wall', 'sand', depth=0.25, frame='frame', fcol='pvc')
        step = (e.L - 2.4) / max(1, len(cols))
        for k in range(len(cols) + 1):
            t = 1.2 + step * k
            e.box(g, t - 0.28, t + 0.28, G, top, -0.18, 0, 'wall', 'beige', top=False)
        gc = bays(e.L, 4.4, 1.0, width=3.4)
        openings(g, e, 0, G, gc, [(0.4, 3.0)], 'wall2', 'granite', depth=0.3, frame='frame', fcol='graphite', soffit=True)
        e.box(g, 0.6, e.L - 0.6, 3.15, 3.75, -0.3, 0, 'sign', 'signyellow', bottom=True)
    band(g, ring, G - 0.25, G, 0.3, 'wall2', 'granite')
    band(g, ring, top - 0.3, top, 0.25, 'wall', 'beige')
    parapet(g, ring, top, 0.8, 0.35, 'wall', 'sand', coping='roof', ccol='roof', roof='roof', rcol='gravel')
    cxr = sum(p[0] for p in ring) / len(ring)
    cyr = sum(p[1] for p in ring) / len(ring)
    box(g, cxr, cyr, 9, 5, top, top + 3.0, 'wall', 'sand', ang=oriented(ring)[0])
    return top + 3.0


# ───────────────────────── wave 2: Shmidta street and the Talsinskaya embankment ─────────────────────────

def small_block(g, frame, ring, wall, low, n=2, fh=3.2, roof_col='#5b5f63', rise=2.0, shops=False, flat=False):
    """a two- or three-storey brick building with a hipped roof (looks not confirmed by photographs)"""
    z0 = 0.6
    top = z0 + n * fh
    rows = floors(z0, n, fh, 0.9, 2.5)
    for e in edges(ring):
        e.box(g, 0, e.L, 0, z0, -0.06, 0, 'wall2', low, ends=False)
        if e.L < 2.4:
            e.front(g, 0, e.L, z0, top, 0, 'wall', wall)
            continue
        cols = bays(e.L, 3.1, 0.8, width=1.4)
        openings(g, e, z0, top, cols, rows, 'wall', wall, depth=0.24, frame='frame', fcol='pvc', sill='trim', scol='white')
        if shops and faces_route(frame, e) and e.L > 8:
            door(g, e, e.L / 2, z0 - 0.3, 1.8, 2.3, depth=1.4)
    band(g, ring, top - 0.4, top, 0.25, 'trim', 'white')
    if flat:
        parapet(g, ring, top, 0.7, 0.3, 'wall', wall, coping='roof', ccol='roof', roof='roof', rcol=roof_col)
        return top + 0.7
    ang, u0, u1, v0, v1 = oriented(ring)
    hip_roof(g, ring, top, rise, (v1 - v0) / 2 - 1.0, 'roof', roof_col, tol=0.9)
    return top + rise


@hero(93524634, name='Здание на ул. Шмидта, 5А')
def shmidta_5a(g, frame):
    return small_block(g, frame, local_ring(93524634, frame, tol=0.6), 'silicate', '#8a8378', n=3, fh=3.0, shops=True, flat=True)


@hero(156871484, name='Здание на Талсинской ул., 9А')
def talsinskaya_9a(g, frame):
    return small_block(g, frame, local_ring(156871484, frame, tol=0.6), '#e2cf98', '#9a8a6c', n=2, fh=3.3, roof_col='#6b5e55', rise=2.2)


# ───────────────────────── build, export, manifest ─────────────────────────

def build():
    roots = []
    manifest = []
    for osm_id, ids, name, fn in HEROES:
        if ONLY and osm_id not in ONLY:
            continue
        frame = centroid_of(osm_id)
        g = Geo()
        height = fn(g, frame)
        root = bpy.data.objects.new(f'hero__{osm_id}', None)
        scene.collection.objects.link(root)
        obj = g.to_object(f'hero__{osm_id}_mesh')
        scene.collection.objects.link(obj)
        obj.parent = root
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris != g.tris():
            print(f'WARN {osm_id}: welding changed the triangle count {g.tris()} -> {tris}')
        zmax = max(v[2] for v in g.verts)
        print(f'HERO {osm_id} {name}: {tris} tris, top {zmax:.1f} m, centroid {frame[0]:.2f},{frame[1]:.2f}')
        roots.append((osm_id, ids, root, obj, frame))
        manifest.append({'id': osm_id, 'ids': [i for i in ids], 'name': name, 'height': round(max(height or 0, zmax), 1), 'tris': tris})
    return roots, manifest


ROOTS, MANIFEST = build()
out = os.path.abspath(OPTS['out'])
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, export_normals=True,
                          export_texcoords=False, export_tangents=False, export_vertex_color='ACTIVE',
                          export_all_vertex_colors=False, export_materials='EXPORT', export_cameras=False,
                          export_lights=False, export_extras=False, export_animations=False)
if not ONLY:
    with open(os.path.splitext(out)[0] + '.json', 'w') as f:
        json.dump({'map': MAP, 'heroes': MANIFEST}, f, ensure_ascii=False, indent=1)
        f.write('\n')
print('EXPORTED', out, os.path.getsize(out), 'bytes')


# ───────────────────────── previews ─────────────────────────

def preview(dir_):
    os.makedirs(dir_, exist_ok=True)
    sc = scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.render_aa = '8'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.cavity_ridge_factor = 0.6
    sh.cavity_valley_factor = 1.0
    sh.show_shadows = True
    sh.shadow_intensity = 0.55
    sh.show_backface_culling = True
    sc.display.light_direction = (0.45, -0.55, 0.7)
    world = bpy.data.worlds.new('sky')
    world.color = (0.55, 0.68, 0.85)
    sc.world = world
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'

    # final albedo for Workbench: material albedo × vertex colour
    for _, _, _, obj, _ in ROOTS:
        me = obj.data
        src = me.color_attributes['Col']
        pv = me.color_attributes.new('Preview', 'FLOAT_COLOR', 'CORNER')
        cols = [0.0] * (len(me.loops) * 4)
        src.data.foreach_get('color', cols)
        mats = [p.material_index for p in me.polygons]
        for p in me.polygons:
            base = me.materials[p.material_index].diffuse_color
            for li in p.loop_indices:
                for k in range(3):
                    cols[li * 4 + k] *= base[k]
        pv.data.foreach_set('color', cols)
        me.color_attributes.active_color = pv
        me.color_attributes.render_color_index = me.color_attributes.find('Preview')

    ground = bpy.data.meshes.new('preview_ground')
    ground.from_pydata([(-600, -600, -0.02), (600, -600, -0.02), (600, 600, -0.02), (-600, 600, -0.02)], [], [(0, 1, 2, 3)])
    gcol = ground.color_attributes.new('Preview', 'FLOAT_COLOR', 'CORNER')
    gcol.data.foreach_set('color', [0.32, 0.34, 0.3, 1.0] * 4)
    gobj = bpy.data.objects.new('preview_ground', ground)
    sc.collection.objects.link(gobj)

    cam = bpy.data.objects.new('preview_cam', bpy.data.cameras.new('preview_cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 35
    cam.data.clip_end = 3000

    for osm_id, ids, root, obj, frame in ROOTS:
        for _, _, r2, o2, _ in ROOTS:
            o2.hide_render = o2 is not obj
        # footprint outlines of every OSM part on the ground (red), as the world file has them
        outl = []
        for pid in ids:
            if pid not in RECORDS:
                continue
            ring = [(x - frame[0], -(z - frame[1])) for x, z in ring_of(RECORDS[pid][0])]
            for i in range(len(ring)):
                a, b = Vector(ring[i]), Vector(ring[(i + 1) % len(ring)])
                d = b - a
                if d.length < 1e-6:
                    continue
                n = Vector((-d.y, d.x)).normalized() * 0.18
                outl.append([(a.x - n.x, a.y - n.y, 0.02), (b.x - n.x, b.y - n.y, 0.02), (b.x + n.x, b.y + n.y, 0.02), (a.x + n.x, a.y + n.y, 0.02)])
        om = bpy.data.meshes.new('preview_outline')
        verts = [v for q in outl for v in q]
        om.from_pydata(verts, [], [tuple(range(4 * i, 4 * i + 4)) for i in range(len(outl))])
        ocol = om.color_attributes.new('Preview', 'FLOAT_COLOR', 'CORNER')
        ocol.data.foreach_set('color', [0.9, 0.08, 0.05, 1.0] * len(verts))
        oobj = bpy.data.objects.new('preview_outline', om)
        sc.collection.objects.link(oobj)

        vs = [obj.matrix_world @ Vector(v.co) for v in obj.data.vertices]
        view = VIEWS.get(osm_id) or auto_view(osm_id, frame, vs)
        shots = []
        for k, spec in enumerate([view.get('whole', {}), view.get('close', {})]):
            path = os.path.join(dir_, f'_{MAP}-{osm_id}-{k}.png')
            shoot(cam, vs, spec, path, whole=(k == 0))
            shots.append(path)
        path = os.path.join(dir_, f'{MAP}-{osm_id}.png')
        side_by_side(shots, path)
        for s_ in shots:
            os.remove(s_)
        print('PREVIEW', path)
        bpy.data.objects.remove(oobj, do_unlink=True)


def auto_view(osm_id, frame, vs):
    """a 3/4 view from the route side, and a close look at the wall nearest to the route"""
    cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
    cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
    to = to_route(frame, cx, cy)
    az = math.degrees(math.atan2(to.y, to.x))
    near = min(vs, key=lambda v: (Vector((v.x, v.y)) - Vector((cx, cy)) - to).length)
    zmax = max(v.z for v in vs)
    return {'whole': {'az': az + 35, 'el': 16}, 'close': {'az': az - 20, 'el': 8, 'at': (near.x, near.y, min(6.0, zmax / 2), 26)}}


def shoot(cam, vs, spec, path, whole):
    """a 480×540 view: the whole building fitted into the frame, or a closer look at spec['at'] (x, y, z, size)"""
    import bpy_extras
    sc = scene
    sc.render.resolution_x, sc.render.resolution_y = 480, 540
    az = math.radians(spec.get('az', -135))
    el = math.radians(spec.get('el', 14))
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    if whole:
        lo = Vector((min(v.x for v in vs), min(v.y for v in vs), 0))
        hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        target = (lo + hi) / 2
        pts = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (0, hi.z)]
    else:
        x, y, z, size = spec['at']
        target = Vector((x, y, z))
        pts = [target + Vector((a, b, c)) * size / 2 for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    lo_d, hi_d = 1.0, 4000.0
    for _ in range(40):
        mid = (lo_d + hi_d) / 2
        cam.location = target + d * mid
        bpy.context.view_layer.update()
        ok = True
        for p in pts:
            c = bpy_extras.object_utils.world_to_camera_view(sc, cam, p)
            if c.z <= 0 or not (0.04 < c.x < 0.96 and 0.04 < c.y < 0.96):
                ok = False
                break
        if ok:
            hi_d = mid
        else:
            lo_d = mid
    cam.location = target + d * hi_d
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def side_by_side(paths, out):
    import numpy as np
    ims = [bpy.data.images.load(p) for p in paths]
    arrs = [np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4) for im in ims]
    both = np.concatenate(arrs, axis=1)
    img = bpy.data.images.new('preview_join', both.shape[1], both.shape[0], alpha=True)
    img.pixels.foreach_set(both.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    for im in ims + [img]:
        bpy.data.images.remove(im)
    # docs/KITS.md wants palette PNGs: Blender has no PIL, the system Python does
    import subprocess
    subprocess.run(['python3', '-c', 'import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert("RGB"); '
                    'im.quantize(256, method=Image.Quantize.MEDIANCUT).save(sys.argv[1], optimize=True)', out], check=True)


# per hero: 'whole' = azimuth (degrees, 0 = camera east of the building, −90 = south) and elevation of the full
# view; 'close' = the same plus 'at' = (x, y, z, size) of the detail to frame
VIEWS = {
    144710719: {'whole': {'az': -62, 'el': 6}, 'close': {'az': -100, 'el': 8, 'at': (4, -4, 82, 30)}},
    87408632: {'whole': {'az': -120, 'el': 12}, 'close': {'az': -100, 'el': 8, 'at': (0, -4, 5, 10)}},
    3491716: {'whole': {'az': 100, 'el': 12}, 'close': {'az': 95, 'el': 10, 'at': (-6, 0, 30, 45)}},
    93524631: {'whole': {'az': -140, 'el': 16}, 'close': {'az': -150, 'el': 10, 'at': (-20, -25, 12, 28)}},
    60606775: {'whole': {'az': -60, 'el': 16}, 'close': {'az': -70, 'el': 10, 'at': (-10, -30, 40, 20)}},
    45557269: {'whole': {'az': -160, 'el': 14}, 'close': {'az': -150, 'el': 8, 'at': (-12, 5, 11, 14)}},
    156871327: {'whole': {'az': -90, 'el': 14}, 'close': {'az': -100, 'el': 8, 'at': (0, -9, 5, 10)}},
    1763313: {'whole': {'az': -100, 'el': 22}, 'close': {'az': 10, 'el': 10, 'at': (18, 5, 6, 26)}},
    51976788: {'whole': {'az': 200, 'el': 14}, 'close': {'az': 190, 'el': 8, 'at': (-10, -30, 8, 22)}},
    47710002: {'whole': {'az': 15, 'el': 16}, 'close': {'az': 30, 'el': 8, 'at': (8, 20, 5, 18)}},
    51975813: {'whole': {'az': -100, 'el': 14}, 'close': {'az': -100, 'el': 8, 'at': (0, -10, 8, 16)}},
    5675518: {'whole': {'az': 10, 'el': 14}, 'close': {'az': 20, 'el': 8, 'at': (12, 0, 25, 20)}},
    653362077: {'whole': {'az': 25, 'el': 14}, 'close': {'az': 5, 'el': 6, 'at': (10, -6, 4, 24)}},
}

if OPTS['preview']:
    preview(os.path.abspath(OPTS['preview']))
