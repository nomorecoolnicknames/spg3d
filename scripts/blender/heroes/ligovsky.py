"""Hero buildings of the Ligovsky map (Saint Petersburg: Nevsky → Vosstaniya Square → Ligovsky → Marata), docs/KITS.md §3.

    blender -b --factory-startup -P scripts/blender/heroes/ligovsky.py -- src/assets/heroes/ligovsky.glb

Every hero is built on its OpenStreetMap footprint read from src/data/maps/ligovsky.world.json: walls follow the outer
ring (and the courtyard rings) exactly, in map metres relative to the average of the outer-ring vertices
(Blender X = map x − cx, Y = −(map z − cz), Z up). Walls that touch a neighbouring footprint are party walls and stay
blank; the street walls get the real architecture — window openings with reveals, surrounds, sills, pilasters,
cornices, roofs, towers and lettering — after photographs on Wikimedia Commons (see the notes on each builder).

Materials follow the contract names only. Colours that differ per building (plaster, stone, roof paint, letters) are
per-face vertex colours that multiply the material base colour, so the albedo stays realistic without extra
materials. The manifest src/assets/heroes/ligovsky.json is written next to the GLB.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector, geometry

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else os.path.join(REPO, 'src', 'assets', 'heroes', 'ligovsky.glb')
ONLY = {int(v) for v in os.environ.get('HERO_ONLY', '').split(',') if v}
WORLD = json.load(open(os.path.join(REPO, 'src', 'data', 'maps', 'ligovsky.world.json'), encoding='utf-8'))
ROUTE = json.load(open(os.path.join(REPO, 'src', 'data', 'maps', 'ligovsky.route.json'), encoding='utf-8'))['points']  # [x, z, y]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ───────────────────────── colours and materials ─────────────────────────

def lin(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# name → (base colour, metallic, roughness); wall/wall2/roof/sign are light so vertex colours can tint them down
MATERIALS = {
    'wall': ('#f4efe6', 0.0, 0.85),
    'wall2': ('#e6ded2', 0.0, 0.9),
    'trim': ('#f3efe6', 0.0, 0.75),
    'glass': ('#3b4a57', 0.0, 0.08),
    'frame': ('#e8e6e0', 0.0, 0.5),
    'metal': ('#4d535a', 0.85, 0.4),
    'roof': ('#8c8c8c', 0.1, 0.7),
    'dark': ('#1d1b19', 0.0, 0.95),
    'sign': ('#ffffff', 0.0, 0.4),
    'gold': ('#f2c14e', 1.0, 0.25),
    'glass2': ('#1f272e', 0.0, 0.1),
}
MAT_NAMES = list(MATERIALS)
MAT = {}
for name, (col, metal, rough) in MATERIALS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*lin(col), 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*lin(col), 1.0)
    MAT[name] = m


def tint(mat, hexstr):
    """vertex colour that turns the base colour of `mat` into `hexstr`"""
    if not hexstr:
        return (1.0, 1.0, 1.0)
    base = lin(MATERIALS[mat][0])
    want = lin(hexstr)
    return tuple(max(0.0, min(1.0, w / b if b > 1e-4 else 1.0)) for w, b in zip(want, base))


# ───────────────────────── footprints ─────────────────────────

BUILDINGS = {b[7]: b for b in WORLD['buildings']}


def area2(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def clean_ring(r, eps=0.05):
    out = []
    for p in r:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def straighten(r, tol=0.15):
    """drop vertices that lie on the line through their neighbours (OSM entrance nodes split long walls)"""
    r = r[:]
    changed = True
    while changed and len(r) > 3:
        changed = False
        for i in range(len(r)):
            a, b, c = r[i - 1], r[i], r[(i + 1) % len(r)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L < 1e-6:
                continue
            dev = abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / L
            t = ((b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1])) / (L * L)
            if dev < tol and 0 < t < 1:
                del r[i]
                changed = True
                break
    return r


def inside(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


class Footprint:
    """outer ring CCW and courtyard rings CW in Blender XY around the centroid of the outer-ring vertices"""

    def __init__(self, osm_id, parts=(), tol=0.15):
        b = BUILDINGS[osm_id]
        self.id = osm_id
        self.h = b[0] / 10
        flat = b[8]
        self.cx = sum(flat[0::2]) / (len(flat) // 2) / 10
        self.cz = sum(flat[1::2]) / (len(flat) // 2) / 10
        self.outer = straighten(clean_ring(self.ring(flat)), tol)
        if area2(self.outer) < 0:
            self.outer.reverse()
        self.holes = []
        for hf in b[9:]:
            h = straighten(clean_ring(self.ring(hf)))
            if len(h) >= 3:
                if area2(h) > 0:
                    h.reverse()
                self.holes.append(h)
        self.skip = {osm_id, *parts}
        xs = [p[0] for p in self.outer]
        ys = [p[1] for p in self.outer]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        r = max(self.bbox[2] - self.bbox[0], self.bbox[3] - self.bbox[1]) + 30
        self.neighbours = []
        for ob in WORLD['buildings']:
            if ob[7] in self.skip:
                continue
            ring = self.ring(ob[8])
            if any(abs(x) < r and abs(y) < r for x, y in ring[::3] + ring[-1:]):
                self.neighbours.append(ring)

    def ring(self, flat):
        return [(flat[i] / 10 - self.cx, -(flat[i + 1] / 10 - self.cz)) for i in range(0, len(flat) - 1, 2)]

    def edges(self, ring=None):
        ring = ring or self.outer
        return [Edge(ring[i], ring[(i + 1) % len(ring)], i) for i in range(len(ring))]

    def model(self, name):
        """position of a world model (e.g. the obelisk) in this footprint's frame"""
        m = next(m for m in WORLD['models'] if m[0] == name)
        return (m[1] / 10 - self.cx, -(m[2] / 10 - self.cz))

    def faces(self, e, pt):
        """cosine between the wall's outward normal and the direction from its middle to a point"""
        mx, my, _ = e.at(e.L / 2, 0, 0)
        dx, dy = pt[0] - mx, pt[1] - my
        dl = math.hypot(dx, dy) or 1
        return (dx * e.n[0] + dy * e.n[1]) / dl

    def route_near(self, e):
        """distance from the middle of a wall to the race route and how squarely the wall faces it"""
        mx, my, _ = e.at(e.L / 2, 0, 0)
        px, pz = mx + self.cx, -my + self.cz
        best = (1e9, 0.0)
        for a, b in zip(ROUTE, ROUTE[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]
            L2 = dx * dx + dz * dz or 1e-9
            t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2))
            qx, qz = a[0] + t * dx, a[1] + t * dz
            d = math.hypot(qx - px, qz - pz)
            if d < best[0]:
                best = (d, (qx - px) / (d or 1) * e.n[0] + -(qz - pz) / (d or 1) * e.n[1])
        return best

    def route_point(self):
        """the nearest point of the race route in this footprint's frame"""
        p = min(ROUTE, key=lambda p: (p[0] - self.cx) ** 2 + (p[1] - self.cz) ** 2)
        return (p[0] - self.cx, -(p[1] - self.cz))

    def part(self, osm_id):
        return clean_ring(self.ring(BUILDINGS[osm_id][8]))

    def party(self, e, out=1.2):
        """a wall is a party wall when the ground just outside it belongs to another building"""
        if e.L < 0.5:
            return True
        hits = 0
        ts = (0.2, 0.5, 0.8)
        for t in ts:
            p = e.at(e.L * t, out, 0)
            if any(inside((p[0], p[1]), r) for r in self.neighbours):
                hits += 1
        return hits >= 2


class Edge:
    """a wall segment p→q; s along it, d outward (the right-hand side of a CCW ring), z up"""

    def __init__(self, p, q, i=0):
        self.p, self.q, self.i = p, q, i
        dx, dy = q[0] - p[0], q[1] - p[1]
        self.L = math.hypot(dx, dy) or 1e-6
        self.u = (dx / self.L, dy / self.L)
        self.n = (dy / self.L, -dx / self.L)

    def key(self):
        return (round(self.p[0], 3), round(self.p[1], 3), round(self.q[0], 3), round(self.q[1], 3))

    def __eq__(self, other):
        return isinstance(other, Edge) and self.key() == other.key()

    def __hash__(self):
        return hash(self.key())

    def at(self, s, d, z):
        return (self.p[0] + self.u[0] * s + self.n[0] * d, self.p[1] + self.u[1] * s + self.n[1] * d, z)

    def nvec(self, dn=1.0, zn=0.0):
        return (self.n[0] * dn, self.n[1] * dn, zn)


# ───────────────────────── mesh builder ─────────────────────────

class Geo:
    def __init__(self, name, palette):
        self.name = name
        self.pal = palette
        self.v, self.vi, self.f, self.m, self.c = [], {}, [], [], []
        self.view = None

    def vert(self, p):
        k = (round(p[0], 3), round(p[1], 3), round(p[2], 3))
        i = self.vi.get(k)
        if i is None:
            i = len(self.v)
            self.v.append(k)
            self.vi[k] = i
        return i

    def poly(self, pts, mat, hint=None, col=None):
        """add a polygon; with `hint` its winding is flipped so its normal points along the hint"""
        if hint is not None:
            nx = ny = nz = 0.0
            for a, b in zip(pts, pts[1:] + pts[:1]):
                nx += (a[1] - b[1]) * (a[2] + b[2])
                ny += (a[2] - b[2]) * (a[0] + b[0])
                nz += (a[0] - b[0]) * (a[1] + b[1])
            if nx * hint[0] + ny * hint[1] + nz * hint[2] < 0:
                pts = pts[::-1]
        idx = []
        for p in pts:
            i = self.vert(p)
            if not idx or idx[-1] != i:
                idx.append(i)
        if len(idx) > 2 and idx[0] == idx[-1]:
            idx.pop()
        if len(idx) < 3 or len(set(idx)) < len(idx):
            return
        self.f.append(idx)
        self.m.append(MAT_NAMES.index(mat))
        self.c.append(tint(mat, col if col is not None else self.pal.get(mat)))

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    # ── primitives in an edge frame ──

    def quad(self, e, s0, s1, z0, z1, d, mat, col=None):
        self.poly([e.at(s0, d, z0), e.at(s1, d, z0), e.at(s1, d, z1), e.at(s0, d, z1)], mat, e.nvec(), col)

    def box(self, e, s0, s1, z0, z1, d0, d1, mat, top=True, bottom=False, sides=True, col=None):
        """a block standing out of the wall from depth d0 to d1 (front face at d1)"""
        self.quad(e, s0, s1, z0, z1, d1, mat, col)
        if top:
            self.poly([e.at(s0, d0, z1), e.at(s1, d0, z1), e.at(s1, d1, z1), e.at(s0, d1, z1)], mat, (0, 0, 1), col)
        if bottom:
            self.poly([e.at(s0, d0, z0), e.at(s1, d0, z0), e.at(s1, d1, z0), e.at(s0, d1, z0)], mat, (0, 0, -1), col)
        if sides:
            self.poly([e.at(s0, d0, z0), e.at(s0, d1, z0), e.at(s0, d1, z1), e.at(s0, d0, z1)], mat, (-e.u[0], -e.u[1], 0), col)
            self.poly([e.at(s1, d0, z0), e.at(s1, d1, z0), e.at(s1, d1, z1), e.at(s1, d0, z1)], mat, (e.u[0], e.u[1], 0), col)

    def wall(self, e, s0, s1, z0, z1, holes=(), mat='wall', d=0.0, col=None):
        """a wall rectangle with openings (outlines in (s, z), strictly inside the rectangle)"""
        if not holes:
            self.quad(e, s0, s1, z0, z1, d, mat, col)
            return
        loops = [[Vector((s0, z0, 0)), Vector((s1, z0, 0)), Vector((s1, z1, 0)), Vector((s0, z1, 0))]]
        loops += [[Vector((s, z, 0)) for s, z in h] for h in holes]
        flat = [p for loop in loops for p in loop]
        for t in geometry.tessellate_polygon(loops):
            self.poly([e.at(flat[i].x, d, flat[i].y) for i in t], mat, e.nvec(), col)

    def opening(self, e, outline, depth, glass='glass', reveal='wall', bottom=False, col=None, d=0.0):
        """reveals from the wall plane into the wall and the glass (or void) at the back"""
        n = len(outline)
        cs = sum(p[0] for p in outline) / n
        cz = sum(p[1] for p in outline) / n
        for k in range(n):
            a, b = outline[k], outline[(k + 1) % n]
            if not bottom and abs(a[1] - b[1]) < 1e-6 and a[1] <= cz and abs(a[0] - b[0]) > 1e-6:
                continue
            ms, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            hn = (cs - ms, cz - mz)
            hint = (e.u[0] * hn[0], e.u[1] * hn[0], hn[1])
            self.poly([e.at(a[0], d, a[1]), e.at(b[0], d, b[1]), e.at(b[0], d - depth, b[1]), e.at(a[0], d - depth, a[1])], reveal, hint, col)
        self.poly([e.at(s, d - depth, z) for s, z in outline], glass, e.nvec())

    def band(self, chain, profile, mat, closed=False, col=None, ends=True):
        """a moulding along a polyline of wall points (cornice, string course, parapet): profile = [(d, z), …]"""
        rings = [offset(chain, d, closed) for d, _ in profile]
        ne = len(chain) if closed else len(chain) - 1
        for k in range(len(profile) - 1):
            (d0, z0), (d1, z1) = profile[k], profile[k + 1]
            for i in range(ne):
                j = (i + 1) % len(chain)
                e = Edge(chain[i], chain[j])
                dd, dz = d1 - d0, z1 - z0
                ln = math.hypot(dd, dz) or 1
                hint = e.nvec(dz / ln, -dd / ln)
                a0, b0 = rings[k][i], rings[k][j]
                a1, b1 = rings[k + 1][i], rings[k + 1][j]
                self.poly([(a0[0], a0[1], z0), (b0[0], b0[1], z0), (b1[0], b1[1], z1), (a1[0], a1[1], z1)], mat, hint, col)
        if ends and not closed and len(profile) > 2:
            for idx, sgn in ((0, -1), (len(chain) - 1, 1)):
                e = Edge(chain[0], chain[1]) if idx == 0 else Edge(chain[-2], chain[-1])
                pts = [(rings[k][idx][0], rings[k][idx][1], profile[k][1]) for k in range(len(profile))]
                base = rings[0][idx]
                pts.append((base[0], base[1], profile[-1][1]))
                self.poly(pts, mat, (e.u[0] * sgn, e.u[1] * sgn, 0), col)

    def cap(self, outer, holes, z, mat, up=True, col=None):
        loops = [[Vector((x, y, 0)) for x, y in r] for r in [outer] + list(holes)]
        flat = [p for loop in loops for p in loop]
        for t in geometry.tessellate_polygon(loops):
            self.poly([(flat[i].x, flat[i].y, z) for i in t], mat, (0, 0, 1 if up else -1), col)

    def prism(self, base, z0, z1, mat, top=True, col=None, top_mat=None):
        """vertical walls on a CCW plan polygon, optional flat top"""
        for e in [Edge(base[i], base[(i + 1) % len(base)]) for i in range(len(base))]:
            self.quad(e, 0, e.L, z0, z1, 0, mat, col)
        if top:
            self.cap(base, [], z1, top_mat or mat, col=col if not top_mat else None)

    def lathe(self, cx, cy, profile, segs, mat, col=None, a0=0.0, a1=2 * math.pi, closed_top=True):
        """surface of revolution: profile [(r, z), …] from bottom to top"""
        full = abs(a1 - a0 - 2 * math.pi) < 1e-6
        steps = segs
        angs = [a0 + (a1 - a0) * k / segs for k in range(segs + (0 if full else 1))]
        for k in range(len(profile) - 1):
            (r0, z0), (r1, z1) = profile[k], profile[k + 1]
            for i in range(steps):
                ta, tb = angs[i], angs[(i + 1) % len(angs)]
                if not full and i + 1 >= len(angs):
                    break
                pa0 = (cx + r0 * math.cos(ta), cy + r0 * math.sin(ta), z0)
                pb0 = (cx + r0 * math.cos(tb), cy + r0 * math.sin(tb), z0)
                pb1 = (cx + r1 * math.cos(tb), cy + r1 * math.sin(tb), z1)
                pa1 = (cx + r1 * math.cos(ta), cy + r1 * math.sin(ta), z1)
                tm = (ta + tb) / 2
                dr, dz = r1 - r0, z1 - z0
                ln = math.hypot(dr, dz) or 1
                hint = (math.cos(tm) * dz / ln, math.sin(tm) * dz / ln, -dr / ln)
                self.poly([pa0, pb0, pb1, pa1], mat, hint, col)
        if closed_top and full and profile[-1][0] > 1e-3:
            r, z = profile[-1]
            self.poly([(cx + r * math.cos(a), cy + r * math.sin(a), z) for a in angs], mat, (0, 0, 1), col)

    def letters(self, e, text, s_mid, z0, height, d, mat='sign', col=None, spacing=0.0, back=True):
        """flat lettering standing on a roof or fixed to a wall, facing out of the edge"""
        cu = bpy.data.curves.new('txt', 'FONT')
        cu.body = text
        cu.font = FONT_DATA
        cu.size = 1.0
        cu.space_character = 1.0 + spacing
        cu.align_x = 'CENTER'
        cu.resolution_u = 2
        cu.fill_mode = 'FRONT'
        ob = bpy.data.objects.new('txt', cu)
        scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ys = [v.co.y for v in me.vertices]
        y0, y1 = min(ys), max(ys)
        k = height / max(1e-3, y1 - y0)
        for poly in me.polygons:
            pts = [me.vertices[i].co for i in poly.vertices]
            self.poly([e.at(s_mid + p.x * k, d, z0 + (p.y - y0) * k) for p in pts], mat, e.nvec(), col)
            if back:
                self.poly([e.at(s_mid + p.x * k, d - 0.02, z0 + (p.y - y0) * k) for p in pts], 'metal', e.nvec(-1))
        width = (max(v.co.x for v in me.vertices) - min(v.co.x for v in me.vertices)) * k
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)
        return width

    def build(self, parent):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([Vector(v) for v in self.v], [], self.f)
        for name in MAT_NAMES:
            me.materials.append(MAT[name])
        for poly, mi in zip(me.polygons, self.m):
            poly.material_index = mi
        attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        for poly, col in zip(me.polygons, self.c):
            for li in poly.loop_indices:
                attr.data[li].color = (*col, 1.0)
        me.color_attributes.active_color = attr
        me.validate(clean_customdata=False)
        ob = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(ob)
        ob.parent = parent
        return ob


FONT_DATA = bpy.data.fonts.load(FONT)


def offset(chain, d, closed):
    """polyline moved by d to the right-hand side (outward for CCW rings) with mitred corners"""
    n = len(chain)
    out = []
    for i in range(n):
        normals = []
        if closed or i > 0:
            a, b = chain[i - 1], chain[i]
            normals.append(Edge(a, b).n)
        if closed or i < n - 1:
            a, b = chain[i], chain[(i + 1) % n]
            normals.append(Edge(a, b).n)
        mx = sum(v[0] for v in normals)
        my = sum(v[1] for v in normals)
        ml = math.hypot(mx, my)
        if ml < 1e-6:
            mx, my, ml = normals[0][0], normals[0][1], 1.0
        mx, my = mx / ml, my / ml
        c = max(0.6, mx * normals[0][0] + my * normals[0][1])
        out.append((chain[i][0] + mx * d / c, chain[i][1] + my * d / c))
    return out


def arch(s0, s1, z0, zs, segs=6):
    r = (s1 - s0) / 2
    m = (s0 + s1) / 2
    pts = [(s0, z0), (s1, z0), (s1, zs)]
    for k in range(1, segs):
        a = math.pi * k / segs
        pts.append((m + r * math.cos(a), zs + r * math.sin(a)))
    pts.append((s0, zs))
    return pts


def rect(s0, s1, z0, z1):
    return [(s0, z0), (s1, z0), (s1, z1), (s0, z1)]


def chains(fp, ring, keep):
    """runs of consecutive edges of a ring for which keep(edge) holds (whole ring when all do)"""
    es = fp.edges(ring)
    flags = [keep(e) for e in es]
    if all(flags):
        return [(ring[:], True)]
    out = []
    n = len(es)
    start = next(i for i in range(n) if not flags[i])
    run = []
    for k in range(1, n + 1):
        i = (start + k) % n
        if flags[i]:
            if not run:
                run = [ring[i]]
            run.append(ring[(i + 1) % n])
        elif run:
            out.append((run, False))
            run = []
    if run:
        out.append((run, False))
    return out


def root(osm_id):
    r = bpy.data.objects.new(f'hero__{osm_id}', None)
    r.empty_display_size = 5
    scene.collection.objects.link(r)
    return r


# ───────────────────────── shared facade vocabulary ─────────────────────────

def bays(L, bay, margin):
    """window axes fitted into a wall: centres along s"""
    n = int((L - 2 * margin) / bay + 0.35)
    if n <= 0:
        return []
    step = (L - 2 * margin) / n
    return [margin + step * (k + 0.5) for k in range(n)]


def window(g, e, s, z0, z1, w, depth=0.25, kind='rect', sill=True, surround=None, hood=None, mullion=True, trim='trim',
           holes=None, arch_segs=4, flush=False):
    """one window axis: the opening goes into `holes` (to be cut by g.wall); a flush window is glass laid on the
    wall (for walls far from the route) and keeps its surround, sill and hood"""
    s0, s1 = s - w / 2, s + w / 2
    outline = arch(s0, s1, z0, z1 - w / 2, arch_segs) if kind == 'arch' else rect(s0, s1, z0, z1)
    if flush:
        g.poly([e.at(ps, 0.03, pz) for ps, pz in outline], 'glass', e.nvec())
        depth = -0.03
    else:
        holes.append(outline)
        g.opening(e, outline, depth)
    if mullion and not flush:
        zt = z1 - w / 2 if kind == 'arch' else z1
        g.quad(e, s - 0.04, s + 0.04, z0, zt, -depth + 0.02, 'frame')
        if z1 - z0 > 1.7:
            g.quad(e, s0, s1, z0 + (z1 - z0) * 0.68, z0 + (z1 - z0) * 0.68 + 0.08, -depth + 0.03, 'frame')
    if sill:
        g.box(e, s0 - 0.12, s1 + 0.12, z0 - 0.12, z0, 0, 0.14, trim, sides=False)
    if surround:
        sw = surround
        if kind == 'arch':
            zs = z1 - w / 2
            g.quad(e, s0 - sw, s0, z0, zs, 0.06, trim)
            g.quad(e, s1, s1 + sw, z0, zs, 0.06, trim)
            segs = arch_segs
            r0, r1 = w / 2, w / 2 + sw
            for k in range(segs):
                a, b = math.pi * k / segs, math.pi * (k + 1) / segs
                pts = [(s + r0 * math.cos(a), zs + r0 * math.sin(a)), (s + r1 * math.cos(a), zs + r1 * math.sin(a)),
                       (s + r1 * math.cos(b), zs + r1 * math.sin(b)), (s + r0 * math.cos(b), zs + r0 * math.sin(b))]
                g.poly([e.at(p[0], 0.06, p[1]) for p in pts], trim, e.nvec())
        else:
            g.quad(e, s0 - sw, s0, z0, z1, 0.06, trim)
            g.quad(e, s1, s1 + sw, z0, z1, 0.06, trim)
            g.quad(e, s0 - sw, s1 + sw, z1, z1 + sw, 0.06, trim)
    if hood == 'cornice':
        g.box(e, s0 - 0.3, s1 + 0.3, z1 + 0.25, z1 + 0.45, 0, 0.28, trim, bottom=True)
    elif hood == 'pediment':
        zb = z1 + 0.25
        g.box(e, s0 - 0.3, s1 + 0.3, zb, zb + 0.14, 0, 0.26, trim, bottom=True)
        g.poly([e.at(s0 - 0.3, 0.2, zb + 0.14), e.at(s1 + 0.3, 0.2, zb + 0.14), e.at(s, 0.2, zb + 0.14 + w * 0.32)], trim, e.nvec())
        g.poly([e.at(s1 + 0.3, 0.0, zb + 0.14), e.at(s, 0.0, zb + 0.14 + w * 0.32), e.at(s, 0.2, zb + 0.14 + w * 0.32), e.at(s1 + 0.3, 0.2, zb + 0.14)], trim, (0, 0, 1))
        g.poly([e.at(s0 - 0.3, 0.0, zb + 0.14), e.at(s0 - 0.3, 0.2, zb + 0.14), e.at(s, 0.2, zb + 0.14 + w * 0.32), e.at(s, 0.0, zb + 0.14 + w * 0.32)], trim, (0, 0, 1))
    elif hood == 'key':
        g.box(e, s - 0.18, s + 0.18, z1 - 0.1, z1 + 0.35, 0, 0.12, trim)


def hip_roof(g, fp, z, inset, rise, mat='roof', holes=True, col=None):
    """low pitched roof all round the footprint (and around the courtyards) with a flat top"""
    rings = [fp.outer] + (fp.holes if holes else [])
    tops = []
    for ring in rings:
        top = offset(ring, -inset, True)
        tops.append(top)
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            e = Edge(ring[i], ring[j])
            hint = e.nvec(rise, inset)
            g.poly([(ring[i][0], ring[i][1], z), (ring[j][0], ring[j][1], z), (top[j][0], top[j][1], z + rise), (top[i][0], top[i][1], z + rise)], mat, hint, col)
    g.cap(tops[0], tops[1:], z + rise, mat, col=col)


def gable_dormer(g, e, s, z, w, h, depth, mat='roof', wall='wall'):
    """small dormer standing on a roof slope that starts at the wall line (d = -depth … 0)"""
    d0 = -depth
    g.quad(e, s - w / 2, s + w / 2, z, z + h, -0.35, wall)
    g.quad(e, s - w / 2 + 0.2, s + w / 2 - 0.2, z + 0.15, z + h - 0.1, -0.33, 'glass')
    for sgn in (-1, 1):
        ss = s + sgn * w / 2
        g.poly([e.at(ss, -0.35, z), e.at(ss, d0, z), e.at(ss, d0, z + h), e.at(ss, -0.35, z + h)], wall, (e.u[0] * sgn, e.u[1] * sgn, 0))
    ridge = z + h + w * 0.35
    g.poly([e.at(s - w / 2 - 0.1, -0.25, z + h), e.at(s, -0.25, ridge), e.at(s, d0, ridge), e.at(s - w / 2 - 0.1, d0, z + h)], mat, e.nvec(0.5, 1))
    g.poly([e.at(s + w / 2 + 0.1, -0.25, z + h), e.at(s + w / 2 + 0.1, d0, z + h), e.at(s, d0, ridge), e.at(s, -0.25, ridge)], mat, e.nvec(0.5, 1))
    g.poly([e.at(s - w / 2, -0.35, z + h), e.at(s + w / 2, -0.35, z + h), e.at(s, -0.35, ridge)], wall, e.nvec())


def chimney(g, x, y, z, w, h, col=None):
    base = [(x - w / 2, y - w / 3), (x + w / 2, y - w / 3), (x + w / 2, y + w / 3), (x - w / 2, y + w / 3)]
    g.prism(base, z, z + h, 'wall', col=col, top_mat='dark')


def erker(g, e, s, w, z0, z1, depth, floor_h, win_w, rounded=True, cap='roof'):
    """a bay window standing out of the wall over several floors; the wall windows must leave its width free"""
    if rounded:
        plan = [(s - w / 2, 0), (s - w * 0.42, depth * 0.62), (s - w * 0.2, depth), (s + w * 0.2, depth), (s + w * 0.42, depth * 0.62), (s + w / 2, 0)]
    else:
        plan = [(s - w / 2, 0), (s - w / 2 + depth * 0.6, depth), (s + w / 2 - depth * 0.6, depth), (s + w / 2, 0)]
    nf = max(1, int((z1 - z0) / floor_h + 0.2))
    for (a_s, a_d), (b_s, b_d) in zip(plan, plan[1:]):
        pa, pb = e.at(a_s, a_d, 0), e.at(b_s, b_d, 0)
        fe = Edge((pa[0], pa[1]), (pb[0], pb[1]))
        g.quad(fe, 0, fe.L, z0, z1, 0, 'wall')
        if fe.L > win_w * 0.8:
            ww = min(win_w, fe.L - 0.3)
            for k in range(nf):
                zb = z0 + k * floor_h + 0.8
                g.quad(fe, fe.L / 2 - ww / 2, fe.L / 2 + ww / 2, zb, min(zb + floor_h * 0.6, z1 - 0.2), 0.02, 'glass')
                g.quad(fe, fe.L / 2 - ww / 2 - 0.08, fe.L / 2 + ww / 2 + 0.08, zb - 0.12, zb, 0.06, 'trim')
    outline = [e.at(ps, pd, 0) for ps, pd in plan]
    g.poly([(x, y, z0) for x, y, _ in outline], 'wall', (0, 0, -1))
    g.poly([(x, y, z1) for x, y, _ in outline], cap, (0, 0, 1))


def tenement(g, fp, *, ground=4.6, floor=3.6, floors=5, bay=3.4, margin=1.3, win=1.35, win_h=2.2, ground_kind='arch',
             ground_w=2.0, hoods=None, surround=0.14, rust=True, attic=0.9, depth=0.28, skip=None, lesenes=0,
             street=None, cornice_d=0.75, roof=(3.5, 1.8), court_windows=False, near=40.0, arch_floors=(), shops=None,
             rust_floors=1, keep=(), surround_floors=99, away_flat=False):
    """a Petersburg tenement or classical block on the whole footprint: rusticated ground floor, windows in axes
    with surrounds and hoods, string course, full cornice, attic, pitched roof; returns the street walls and their
    window axes and the cornice height"""
    hoods = hoods or {}
    H = ground + floor * (floors - 1)
    rust_to = ground + floor * (rust_floors - 1)
    arched = arch_floors if callable(arch_floors) else (lambda e, s, k: k in arch_floors)
    is_street = street or (lambda e: not fp.party(e))
    walls = {}
    for e in fp.edges():
        if not is_street(e):
            g.quad(e, 0, e.L, 0, H + max(attic, 0.45), 0, 'wall')
            continue
        dist, facing = fp.route_near(e)
        # with away_flat, walls turned away from the route get flush windows even when they are near it
        flat = (dist > near or (away_flat and facing < -0.3)) and e not in keep
        bare = flat and (facing < 0.2 or dist > near * 3)
        # walls the route never sees keep a sparser rhythm of plain glass
        centres = bays(e.L, bay * (1.25 if bare else 1.0), margin)
        walls[e] = centres
        g.box(e, 0, e.L, 0, 0.6, 0, 0.1, 'wall2')
        gh, rh, uh = [], [], []
        for s in centres:
            if skip and skip(e, s, 0):
                pass
            elif ground_kind == 'arch' and not (shops and shops(e, s)):
                window(g, e, s, 0.9, ground - 0.55, ground_w, depth=depth + 0.1, kind='arch', hood='key', holes=gh, surround=None, flush=flat)
            elif ground_kind == 'shop' or (shops and shops(e, s)):
                sw = min(bay - 0.9, 2.8)
                if flat:
                    g.quad(e, s - sw / 2, s + sw / 2, 0.7, ground - 0.8, 0.03, 'glass')
                else:
                    gh.append(rect(s - sw / 2, s + sw / 2, 0.7, ground - 0.8))
                    g.opening(e, gh[-1], 0.45)
                    g.quad(e, s - sw / 2, s + sw / 2, ground - 1.55, ground - 1.47, -0.42, 'frame')
            elif ground_kind == 'rect':
                window(g, e, s, 1.3, ground - 0.9, win, depth=depth, holes=gh, flush=flat)
            for k in range(1, floors):
                if skip and skip(e, s, k):
                    continue
                z0 = ground + floor * (k - 1) + 0.95
                if bare:
                    g.quad(e, s - win / 2, s + win / 2, z0, z0 + win_h, 0.03, 'glass')
                    continue
                arc = arched(e, s, k)
                window(g, e, s, z0, z0 + win_h + (win / 2 if arc else 0), win, depth=depth,
                       surround=surround if (not flat or k <= 2) and k <= surround_floors else None, hood=hoods.get(k),
                       holes=rh if k < rust_floors else uh,
                       flush=flat, kind='arch' if arc else 'rect')
        g.wall(e, 0, e.L, 0.6, ground, gh, mat='wall2' if rust else 'wall')
        if rust_floors > 1:
            g.wall(e, 0, e.L, ground, rust_to, rh, mat='wall2')
        g.wall(e, 0, e.L, rust_to, H, uh)
        if lesenes and len(centres) > 1:
            step = (e.L - 2 * margin) / len(centres)
            for k in range(0, len(centres) + 1, lesenes):
                ps = margin + k * step
                ps = min(max(ps, 0.35), e.L - 0.35)
                g.box(e, ps - 0.35, ps + 0.35, ground + 0.4, H - 0.5, 0, 0.12, 'trim')
    top = H + 0.45
    for chain, closed in chains(fp, fp.outer, is_street):
        g.band(chain, [(0, ground - 0.1), (0.2, ground), (0.2, ground + 0.3), (0, ground + 0.42)], 'trim', closed)
        if rust_floors > 1:
            g.band(chain, [(0, rust_to - 0.1), (0.22, rust_to), (0.22, rust_to + 0.35), (0, rust_to + 0.45)], 'trim', closed)
        g.band(chain, [(0, H - 0.55), (0.14, H - 0.45), (0.2, H - 0.15), (cornice_d, H + 0.2), (cornice_d, top), (0, top)], 'trim', closed)
        if attic > 0.45:
            g.band(chain, [(0, top), (0, H + attic), (0.08, H + attic), (0.08, H + attic + 0.12), (-0.35, H + attic + 0.12)], 'wall', closed)
    for hole in fp.holes:
        for e in fp.edges(hole):
            g.quad(e, 0, e.L, 0, top, 0, 'wall2')
            if court_windows and e.L > 3:
                for s in bays(e.L, 3.6, 1.0):
                    for k in range(1, floors):
                        z0 = ground + floor * (k - 1) + 1.0
                        g.quad(e, s - 0.6, s + 0.6, z0, z0 + 1.9, 0.02, 'glass')
    if roof:
        hip_roof(g, fp, top if attic <= 0.45 else H + attic - 0.3, roof[0], roof[1])
    return walls, H


def balcony(g, e, s0, s1, z, depth=0.8, rail=1.0):
    """a stone slab on the wall with a wrought-iron railing"""
    g.box(e, s0, s1, z - 0.18, z, 0, depth, 'trim', bottom=True)
    g.box(e, s0 + 0.05, s1 - 0.05, z, z + rail, depth - 0.07, depth, 'metal', top=False)


def gable(g, e, sc, z, w, h, kind='curved', window=True, back=0.6):
    """an attic gable standing on the cornice: 'curved' (Art Nouveau), 'triangle' (pediment), 'step'"""
    if kind == 'curved':
        pts = [(sc - w / 2, z), (sc + w / 2, z)] + [(sc + w / 2 * math.cos(math.pi * k / 6), z + h * 0.35 + h * 0.65 * math.sin(math.pi * k / 6)) for k in range(7)]
    elif kind == 'triangle':
        pts = [(sc - w / 2, z), (sc + w / 2, z), (sc, z + h)]
    else:
        pts = [(sc - w / 2, z), (sc + w / 2, z), (sc + w / 2, z + h * 0.5), (sc + w * 0.3, z + h * 0.5), (sc + w * 0.3, z + h),
               (sc - w * 0.3, z + h), (sc - w * 0.3, z + h * 0.5), (sc - w / 2, z + h * 0.5)]
    loops = [[Vector((a, b, 0)) for a, b in pts]]
    for t in geometry.tessellate_polygon(loops):
        g.poly([e.at(pts[i][0], 0.05, pts[i][1]) for i in t], 'wall', e.nvec())
        g.poly([e.at(pts[i][0], -back, pts[i][1]) for i in t], 'wall', e.nvec(-1))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        if abs(a[1] - z) < 1e-6 and abs(b[1] - z) < 1e-6:
            continue
        # the outline runs counter-clockwise in (s, z): its outward side is (dz, -ds)
        g.poly([e.at(a[0], 0.12, a[1]), e.at(b[0], 0.12, b[1]), e.at(b[0], -back, b[1]), e.at(a[0], -back, a[1])], 'trim',
               (e.u[0] * (b[1] - a[1]), e.u[1] * (b[1] - a[1]), -(b[0] - a[0])))
    if window == 'half':
        # a big half-round window standing on the cornice, with its glazing bars
        r = min(w * 0.3, h * 0.55)
        zb = z + 0.35
        g.poly([e.at(sc + r * math.cos(math.pi * k / 8), 0.08, zb + r * math.sin(math.pi * k / 8)) for k in range(9)], 'glass', e.nvec())
        for k in (-1, 0, 1):
            g.quad(e, sc + k * r * 0.45 - 0.05, sc + k * r * 0.45 + 0.05, zb, zb + r * math.sqrt(max(0.0, 1 - (k * 0.45) ** 2)), 0.1, 'frame')
    elif window:
        r = min(w * 0.16, h * 0.3)
        cz = z + h * 0.42
        g.poly([e.at(sc + r * math.cos(2 * math.pi * k / 10), 0.08, cz + r * math.sin(2 * math.pi * k / 10)) for k in range(10)], 'glass', e.nvec())


def corner_edge(e1, e2, cut):
    """a virtual wall across the corner where e1 ends and e2 starts (for a bay or a turret on the corner)"""
    a = e1.at(max(0.0, e1.L - cut), 0, 0)
    b = e2.at(min(e2.L, cut), 0, 0)
    return Edge((a[0], a[1]), (b[0], b[1]))


def dome(g, x, y, z, r, drum, cap, spire=0.0, cap_mat='roof', segs=12, cap_col=None):
    """drum with windows, cornice, dome and an optional spire (corner turrets of tenements)"""
    g.lathe(x, y, [(r, z), (r, z + drum)], segs, 'wall', closed_top=False)
    for k in range(0, segs, 2):
        a = 2 * math.pi * (k + 0.5) / segs
        e = Edge((x + math.cos(a - 0.2) * r * 1.01, y + math.sin(a - 0.2) * r * 1.01), (x + math.cos(a + 0.2) * r * 1.01, y + math.sin(a + 0.2) * r * 1.01))
        g.quad(e, 0.05, e.L - 0.05, z + drum * 0.25, z + drum * 0.8, 0.02, 'glass')
    g.lathe(x, y, [(r, z + drum), (r + 0.3, z + drum + 0.15), (r + 0.3, z + drum + 0.4), (r, z + drum + 0.4)], segs, 'trim', closed_top=False)
    g.lathe(x, y, [(r, z + drum + 0.4), (r * 0.82, z + drum + 0.4 + cap * 0.5), (r * 0.45, z + drum + 0.4 + cap * 0.88), (0.15, z + drum + 0.4 + cap)], segs, cap_mat, col=cap_col)
    if spire:
        top = z + drum + 0.4 + cap
        g.lathe(x, y, [(0.28, top - 0.1), (0.28, top + 0.5), (0.05, top + spire)], 6, 'gold')


def fronts(fp, dist=30.0, facing=0.5, min_len=8.0):
    """street walls that face the race route squarely and close by"""
    out = []
    for e in fp.edges():
        if e.L < min_len or fp.party(e):
            continue
        d, f = fp.route_near(e)
        if d < dist and f > facing:
            out.append(e)
    return out


def ring_walk(fp, e, dist):
    """the point `dist` metres along the outer ring after the end of wall e"""
    es = fp.edges()
    i = es.index(e)
    left = dist
    for k in range(1, len(es)):
        n = es[(i + k) % len(es)]
        if n.L >= left:
            return n.at(left, 0, 0)[:2]
        left -= n.L
    return e.q


def corner_tower(g, e1, e2, r, z0, z1, floor_h, win_w=1.2, segs=12):
    """a rounded bay wrapped round the corner where wall e1 ends and e2 starts; returns its centre"""
    bx, by = e1.n[0] + e2.n[0], e1.n[1] + e2.n[1]
    bl = math.hypot(bx, by) or 1
    bx, by = bx / bl, by / bl
    cx, cy = e1.q[0] - bx * r * 0.78, e1.q[1] - by * r * 0.78
    g.lathe(cx, cy, [(r, z0), (r, z1)], segs, 'wall', closed_top=False)
    g.lathe(cx, cy, [(r - 0.3, z0 - 0.3), (r, z0)], segs, 'trim', closed_top=False)
    g.lathe(cx, cy, [(r + 0.1, z1), (r + 0.1, z1 + 0.3), (0.3, z1 + 1.0)], segs, 'roof')
    nf = max(1, int((z1 - z0) / floor_h + 0.2))
    for k in range(segs):
        a0, a1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        am = (a0 + a1) / 2
        if math.cos(am) * bx + math.sin(am) * by < 0.25:
            continue
        seg = Edge((cx + math.cos(a0) * r, cy + math.sin(a0) * r), (cx + math.cos(a1) * r, cy + math.sin(a1) * r))
        ww = min(win_w, seg.L - 0.3)
        for f in range(nf):
            zb = z0 + f * floor_h + 0.9
            g.quad(seg, seg.L / 2 - ww / 2, seg.L / 2 + ww / 2, zb, min(zb + floor_h * 0.6, z1 - 0.2), 0.03, 'glass')
            g.quad(seg, seg.L / 2 - ww / 2 - 0.1, seg.L / 2 + ww / 2 + 0.1, zb - 0.14, zb, 0.07, 'trim')
    return cx, cy


HEROES = []


def hero(osm_id, name, parts=(), tol=0.15):
    """register a builder; `tol` straightens gently curved walls mapped as many short OSM segments"""
    def deco(fn):
        HEROES.append((osm_id, name, tuple(parts), fn, tol))
        return fn
    return deco


# ───────────────────────── the heroes ─────────────────────────

@hero(2404499, 'Московский вокзал')
def moskovsky_vokzal(fp, g):
    """Moskovsky rail terminal (K. Thon, 1844–51) after Commons «Moskovsky vokzal.JPG» and «Saint-Pétersbourg - Gare de
    Moscou - 2015-12-11 - IMG 2694»: two storeys of sand-yellow plaster, a round-arched ground-floor arcade between
    white pilasters, paired upper windows under hoods, full cornice and attic, МОСКОВСКИЙ ВОКЗАЛ letters on the roof
    and the two-stage clock tower over the middle of the Vosstaniya Square front. The T-shaped footprint's stem is
    the wing along the platforms."""
    g.pal = {'wall': '#dfc28c', 'wall2': '#b3a690', 'trim': '#f2ede2', 'roof': '#596064'}
    PLINTH, GF, CORNICE, ATTIC = 0.9, 8.3, 16.35, 17.2
    edges = fp.edges()
    ox, oy = fp.model('spb_obelisk')
    # the square front: walls that look towards the obelisk; the tower stands in the middle of its long central wall
    front = [e for e in edges if not fp.party(e) and fp.faces(e, (ox, oy)) > -0.2 and (e.p[1] + e.q[1]) / 2 > fp.bbox[3] - 30]
    tower_e = max(front, key=lambda e: e.L)
    ts = tower_e.L / 2
    for e in edges:
        if fp.party(e):
            g.quad(e, 0, e.L, 0, ATTIC, 0, 'wall')
            continue
        is_front = e in front
        g.box(e, 0, e.L, 0, PLINTH, 0, 0.16, 'wall2')
        holes = []
        if is_front and e.L > 6:
            n = max(1, round((e.L - 1.2) / 7.4))
            if e is tower_e:
                # the tower stands over the middle arch: whole bays counted out from it
                step_of = 7.4
                centres = [ts + k * step_of for k in range(-20, 21)
                           if ts + k * step_of - step_of / 2 >= 0.8 and ts + k * step_of + step_of / 2 <= e.L - 0.8]
            else:
                step_of = (e.L - 1.2) / n
                centres = [0.6 + step_of * (k + 0.5) for k in range(n)]
            for s in centres:
                door = e is tower_e and abs(s - ts) < 1
                window(g, e, s, PLINTH + (0.05 if door else 0.45), 7.5, 4.3, depth=0.45, kind='arch', sill=not door,
                       surround=0.22, hood='key', holes=holes, arch_segs=6)
                g.quad(e, s - 0.05, s + 0.05, PLINTH + 0.5, 5.35, -0.42, 'frame')
                for off in (-0.95, 0.95):
                    window(g, e, s + off, 10.0, 12.9, 1.3, depth=0.3, surround=0.16, holes=holes, mullion=True)
                g.box(e, s - 2.05, s + 2.05, 13.25, 13.55, 0, 0.3, 'trim', bottom=True)
                for side in (-1, 1):
                    ps = s + side * step_of / 2
                    if 0.4 < ps < e.L - 0.4:
                        g.box(e, ps - 0.45, ps + 0.45, PLINTH, GF - 0.45, 0, 0.3, 'trim')
                        g.box(e, ps - 0.6, ps + 0.6, GF - 0.45, GF, 0, 0.42, 'trim', bottom=True)
                        g.box(e, ps - 0.7, ps + 0.7, 9.1, 14.2, 0, 0.26, 'trim')
                        g.box(e, ps - 0.85, ps + 0.85, 14.2, 14.6, 0, 0.36, 'trim', bottom=True)
        elif e.L > 4:
            for s in bays(e.L, 6.2, 1.0):
                window(g, e, s, PLINTH + 0.6, 6.0, 2.2, depth=0.35, kind='arch', hood='key', holes=holes, arch_segs=3)
                window(g, e, s, 10.0, 12.9, 1.5, depth=0.3, hood='cornice', holes=holes, mullion=False)
        g.wall(e, 0, e.L, PLINTH, CORNICE, holes)
    for chain, closed in chains(fp, fp.outer, lambda e: not fp.party(e)):
        g.band(chain, [(0, GF), (0.38, GF + 0.05), (0.38, GF + 0.55), (0.18, GF + 0.8), (0, GF + 0.8)], 'trim', closed)
        g.band(chain, [(0, 15.3), (0.2, 15.4), (0.3, 15.75), (0.75, 16.05), (0.75, CORNICE), (0, CORNICE)], 'trim', closed)
        g.band(chain, [(0, CORNICE), (0, ATTIC), (0.12, ATTIC), (0.12, ATTIC + 0.18), (-0.45, ATTIC + 0.18)], 'wall', closed)
    hip_roof(g, fp, ATTIC, 4.0, 2.2, holes=False)
    # chimney stacks along the roof behind the attic (Commons photo: a row of them over the side wings)
    for e in front:
        if e is tower_e or e.L < 10:
            continue
        for s in bays(e.L, 9.0, 3.0):
            x, y, _ = e.at(s, -6.5, 0)
            chimney(g, x, y, ATTIC + 1.2, 1.4, 2.4)
    # the letters on the roof, one word each side of the tower
    w1 = g.letters(tower_e, 'МОСКОВСКИЙ', ts - 18.5, ATTIC + 0.25, 1.9, -0.6, col='#fbfbf4', back=False)
    g.letters(tower_e, 'ВОКЗАЛ', ts + 16.5, ATTIC + 0.25, 1.9, -0.6, col='#fbfbf4', back=False)
    g.box(tower_e, ts - 18.5 - w1 / 2, ts - 18.5 + w1 / 2, ATTIC + 0.18, ATTIC + 0.3, -0.9, -0.5, 'metal')
    g.box(tower_e, ts + 16.5 - 5.2, ts + 16.5 + 5.2, ATTIC + 0.18, ATTIC + 0.3, -0.9, -0.5, 'metal')
    station_tower(g, tower_e, ts)


def station_tower(g, e, ts):
    """square shaft with a balcony and arched windows, cornice, clock stage with four dials, attic, low roof, mast"""
    def ring(w, d_front):
        c = e.at(ts, d_front - w / 2, 0)
        u, n = e.u, e.n
        return [(c[0] - u[0] * w / 2 + n[0] * w / 2, c[1] - u[1] * w / 2 + n[1] * w / 2),
                (c[0] + u[0] * w / 2 + n[0] * w / 2, c[1] + u[1] * w / 2 + n[1] * w / 2),
                (c[0] + u[0] * w / 2 - n[0] * w / 2, c[1] + u[1] * w / 2 - n[1] * w / 2),
                (c[0] - u[0] * w / 2 - n[0] * w / 2, c[1] - u[1] * w / 2 - n[1] * w / 2)]

    W1, W2 = 9.2, 8.0
    r1 = ring(W1, 0.2)
    r1 = [r1[1], r1[0], r1[3], r1[2]] if area2(r1) < 0 else r1
    for te in [Edge(r1[i], r1[(i + 1) % 4]) for i in range(4)]:
        holes = []
        window(g, te, te.L / 2, 19.2, 24.8, 2.4, depth=0.4, kind='arch', surround=0.2, hood='key', holes=holes, arch_segs=6)
        g.wall(te, 0, te.L, 14.0, 26.6, holes)
        for s in (0.55, te.L - 0.55):
            g.box(te, s - 0.55, s + 0.55, 17.2, 26.6, 0, 0.22, 'trim', sides=False)
    front = Edge(r1[0], r1[1])
    if abs(front.n[0] * e.n[0] + front.n[1] * e.n[1]) < 0.9 or front.n[0] * e.n[0] + front.n[1] * e.n[1] < 0:
        front = next(Edge(r1[i], r1[(i + 1) % 4]) for i in range(4) if Edge(r1[i], r1[(i + 1) % 4]).n[0] * e.n[0] + Edge(r1[i], r1[(i + 1) % 4]).n[1] * e.n[1] > 0.9)
    g.box(front, -0.6, front.L + 0.6, 17.2, 17.5, 0, 0.75, 'trim', bottom=True)
    g.box(front, -0.5, front.L + 0.5, 17.5, 18.5, 0.6, 0.72, 'trim')
    g.band(r1, [(0, 26.6), (0.3, 26.75), (0.62, 27.2), (0.62, 27.45), (0, 27.45)], 'trim', True)
    r2 = ring(W2, 0.2 - (W1 - W2) / 2)
    r2 = [r2[1], r2[0], r2[3], r2[2]] if area2(r2) < 0 else r2
    for te in [Edge(r2[i], r2[(i + 1) % 4]) for i in range(4)]:
        g.quad(te, 0, te.L, 27.45, 33.0, 0, 'wall')
        for s in (0.5, te.L - 0.5):
            g.box(te, s - 0.5, s + 0.5, 27.45, 33.0, 0, 0.2, 'trim', sides=False)
        cs, cz, R = te.L / 2, 30.2, 1.65
        dial = [(cs + R * math.cos(2 * math.pi * k / 20), cz + R * math.sin(2 * math.pi * k / 20)) for k in range(20)]
        rim = [(cs + (R + 0.18) * math.cos(2 * math.pi * k / 20), cz + (R + 0.18) * math.sin(2 * math.pi * k / 20)) for k in range(20)]
        g.poly([te.at(s, 0.12, z) for s, z in dial], 'trim', te.nvec(), col='#fbfaf2')
        for k in range(20):
            a, b = rim[k], rim[(k + 1) % 20]
            c, d = dial[(k + 1) % 20], dial[k]
            g.poly([te.at(p[0], 0.1, p[1]) for p in (a, b, c, d)], 'gold', te.nvec())
        g.poly([te.at(cs - 0.07, 0.15, cz), te.at(cs + 0.07, 0.15, cz), te.at(cs + 0.07, 0.15, cz + 1.2), te.at(cs - 0.07, 0.15, cz + 1.2)], 'dark', te.nvec())
        g.poly([te.at(cs, 0.16, cz - 0.07), te.at(cs + 0.85, 0.16, cz - 0.4), te.at(cs + 0.85, 0.16, cz - 0.26), te.at(cs, 0.16, cz + 0.07)], 'dark', te.nvec())
    g.band(r2, [(0, 33.0), (0.25, 33.15), (0.5, 33.55), (0.5, 33.75), (0, 33.75)], 'trim', True)
    g.band(r2, [(0.1, 33.75), (0.1, 34.5), (0.2, 34.5), (0.2, 34.65), (-0.3, 34.65)], 'wall', True)
    for x, y in r2:
        cxy = sum(p[0] for p in r2) / 4, sum(p[1] for p in r2) / 4
        px, py = cxy[0] + (x - cxy[0]) * 0.97, cxy[1] + (y - cxy[1]) * 0.97
        g.prism([(px - 0.35, py - 0.35), (px + 0.35, py - 0.35), (px + 0.35, py + 0.35), (px - 0.35, py + 0.35)], 34.65, 35.6, 'trim')
    cx = sum(p[0] for p in r2) / 4
    cy = sum(p[1] for p in r2) / 4
    rr = offset(r2, -0.4, True)
    for i in range(4):
        a, b = rr[i], rr[(i + 1) % 4]
        te = Edge(a, b)
        g.poly([(a[0], a[1], 34.6), (b[0], b[1], 34.6), (cx, cy, 37.4)], 'roof', te.nvec(1, 1), col='#5f6b66')
    g.prism([(cx - 0.08, cy - 0.08), (cx + 0.08, cy - 0.08), (cx + 0.08, cy + 0.08), (cx - 0.08, cy + 0.08)], 37.2, 42.5, 'metal')


GALERIA_PARTS = (434622477, 434622479, 434622481, 434622482, 434622484)


@hero(8522850, 'ТРЦ «Галерея»', parts=GALERIA_PARTS)
def galeria(fp, g):
    """Galeria mall, Ligovsky 30A (2010) after Commons «Galeria shopping mall 01/02» and «ТРЦ Галерея (Galeria),
    Лиговский пр., д.30а»: a very long stripped-classical front of beige stone along the curve of Ligovsky — ground-
    floor arcade of stone piers with dark shopfronts, entablature, giant flat pilasters through three storeys with
    recessed blind panels and tall slot windows, attic storey of small windows under the cornice — and on the north
    end the glazed entrance pavilion with GALERIA over it. The roof parts (OSM building:part) are the glass rotunda
    and the ridge skylights over the galleries."""
    g.pal = {'wall': '#d6ccb9', 'wall2': '#c6baa3', 'trim': '#e9e2d3', 'roof': '#6b6e72'}
    G, E1, P1, A0, A1, H, TOP = 5.4, 6.9, 15.4, 16.2, 18.5, 19.3, 20.2
    edges = fp.edges()
    # the entrance pavilion: the longest wall on the north end, towards Vosstaniya Square
    north = [e for e in edges if e.n[1] > 0.75 and not fp.party(e) and e.L > 18]
    entrance = max(north, key=lambda e: e.at(e.L / 2, 0, 0)[1]) if north else None
    for e in edges:
        if fp.party(e):
            g.quad(e, 0, e.L, 0, TOP, 0, 'wall')
            continue
        g.box(e, 0, e.L, 0, 0.35, 0, 0.12, 'wall2')
        n = max(1, round(e.L / 6.6))
        step = e.L / n
        gh, uh = [], []
        big = e == entrance and n >= 3
        for k in range(n):
            s = step * (k + 0.5)
            if big and 0 < k < n - 1:
                continue
            sw = step - 2.0
            if sw > 1.2:
                o = rect(s - sw / 2, s + sw / 2, 0.45, G - 0.5)
                gh.append(o)
                g.opening(e, o, 0.7)
                g.quad(e, s - sw / 2, s + sw / 2, G - 1.5, G - 1.42, -0.67, 'frame')
                g.quad(e, s - 0.04, s + 0.04, 0.45, G - 1.5, -0.67, 'frame')
            if step > 3.5:
                if k % 3 == 1:
                    window(g, e, s, E1 + 1.0, P1 - 0.6, 1.7, depth=0.35, sill=False, holes=uh)
                else:
                    o = rect(s - (step - 2.6) / 2, s + (step - 2.6) / 2, E1 + 0.8, P1 - 0.5)
                    uh.append(o)
                    g.opening(e, o, 0.14, glass='wall', bottom=True)
                ww = min(2.6, step - 2.4)
                window(g, e, s, A0 + 0.35, A1 - 0.25, ww, depth=0.25, sill=False, holes=uh, mullion=ww > 1.6)
        if big:
            s0, s1 = step + 0.6, step * (n - 1) - 0.6
            o = rect(s0, s1, 0.45, P1 - 0.4)
            uh.append(o)
            g.opening(e, o, 0.9)
            for k in range(1, 6):
                ms = s0 + (s1 - s0) * k / 6
                g.quad(e, ms - 0.05, ms + 0.05, 0.45, P1 - 0.4, -0.86, 'frame')
            for z in (G, 10.2):
                g.quad(e, s0, s1, z, z + 0.14, -0.85, 'frame')
            for k in range(4):
                cs = s0 + (s1 - s0) * k / 3
                g.box(e, cs - 0.4, cs + 0.4, 0.3, P1 - 0.3, 0, 0.85, 'trim')
            g.letters(e, 'GALERIA', (s0 + s1) / 2, A0 + 0.2, 1.9, 0.2, col='#fffaf0', back=False)
        if big:
            g.wall(e, 0, e.L, 0.35, H, gh + uh)
        else:
            g.wall(e, 0, e.L, 0.35, G + 0.1, gh, mat='wall2')
            g.wall(e, 0, e.L, G + 0.1, H, uh)
        if e.L > 3:
            for k in range(n + 1):
                if big and 0 < k < n:
                    continue
                ps = min(max(step * k, 0.6), e.L - 0.6)
                g.box(e, ps - 0.6, ps + 0.6, E1, P1, 0, 0.32, 'wall')
                g.box(e, ps - 0.75, ps + 0.75, P1 - 0.55, P1, 0, 0.45, 'trim', bottom=True)
                g.box(e, ps - 0.45, ps + 0.45, A0, A1, 0, 0.18, 'wall')
    for chain, closed in chains(fp, fp.outer, lambda e: not fp.party(e)):
        g.band(chain, [(0, G), (0.3, G + 0.1), (0.3, E1 - 0.35), (0.55, E1 - 0.15), (0.55, E1), (0, E1)], 'trim', closed)
        g.band(chain, [(0, P1), (0.25, P1 + 0.05), (0.25, A0 - 0.1), (0.35, A0), (0, A0)], 'trim', closed)
        g.band(chain, [(0, A1), (0.25, A1 + 0.1), (0.8, H - 0.1), (0.8, H + 0.15), (0, H + 0.15)], 'trim', closed)
        g.band(chain, [(0, H + 0.15), (0, TOP), (0.1, TOP), (0.1, TOP + 0.12), (-0.4, TOP + 0.12)], 'wall', closed)
    roof_z = H + 0.4
    g.cap(fp.outer, [], roof_z, 'roof')
    # roof parts: the glazed rotunda dome and the ridge skylights
    for pid in GALERIA_PARTS:
        ring = fp.part(pid)
        if area2(ring) < 0:
            ring.reverse()
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        if len(ring) > 6:
            r = sum(math.hypot(p[0] - cx, p[1] - cy) for p in ring) / len(ring)
            g.lathe(cx, cy, [(r, roof_z), (r, roof_z + 1.4)], 16, 'metal', closed_top=False)
            g.lathe(cx, cy, [(r, roof_z + 1.4), (r * 0.8, roof_z + 3.6), (r * 0.45, roof_z + 5.0), (0.8, roof_z + 5.5)], 16, 'glass')
            g.lathe(cx, cy, [(0.8, roof_z + 5.5), (0.8, roof_z + 6.2)], 8, 'metal')
        else:
            es = [Edge(ring[i], ring[(i + 1) % 4]) for i in range(4)]
            long_i = max(range(4), key=lambda i: es[i].L)
            a, b = es[long_i], es[(long_i + 2) % 4]
            h0, h1 = roof_z + 0.6, roof_z + 0.6 + min(2.2, min(a.L, es[(long_i + 1) % 4].L) * 0.3)
            for e in es:
                g.quad(e, 0, e.L, roof_z, h0, 0, 'metal')
            ra = ((a.p[0] + b.q[0]) / 2, (a.p[1] + b.q[1]) / 2)
            rb = ((a.q[0] + b.p[0]) / 2, (a.q[1] + b.p[1]) / 2)
            g.poly([(a.p[0], a.p[1], h0), (a.q[0], a.q[1], h0), (rb[0], rb[1], h1), (ra[0], ra[1], h1)], 'glass', a.nvec(1, 1))
            g.poly([(b.p[0], b.p[1], h0), (b.q[0], b.q[1], h0), (ra[0], ra[1], h1), (rb[0], rb[1], h1)], 'glass', b.nvec(1, 1))
            for e, apex in ((es[(long_i + 1) % 4], rb), (es[(long_i + 3) % 4], ra)):
                g.poly([(e.p[0], e.p[1], h0), (e.q[0], e.q[1], h0), (apex[0], apex[1], h1)], 'glass', e.nvec(1, 0.3))


@hero(1598177, 'Гостиница «Октябрьская»')
def oktyabrskaya(fp, g):
    """Oktyabrskaya hotel, Ligovsky 10 / Nevsky 118 on Vosstaniya Square (former Znamenskaya / Bolshaya Severnaya
    hotel, 1847–51) after Commons «Корпус гостиницы Октябрьская лето 2024», «Saint-Pétersbourg - 2015-12-11 -
    IMG 2693» and «Ligovsky prospect and Oktyabrskaya hotel»: a long light classical block of five storeys — arched
    ground-floor windows, pediments over the second-floor windows, pilaster strips — with the lettering ГОРОД-ГЕРОЙ
    ЛЕНИНГРАД on a lattice above the square front and the ГОСТИНИЦА · ОКТЯБРЬСКАЯ boards on its attic."""
    g.pal = {'wall': '#ddd7c9', 'wall2': '#cfc8b8', 'trim': '#f6f3ec', 'roof': '#5b6066'}
    walls, H = tenement(g, fp, ground=5.0, floor=3.85, floors=5, bay=3.8, win=1.45, win_h=2.35, ground_w=1.9,
                        hoods={1: 'pediment', 2: 'cornice'}, lesenes=3, attic=1.1, roof=(4.0, 2.2))
    ob = fp.model('spb_obelisk')
    square = max(walls, key=lambda e: e.L * max(0.0, fp.faces(e, ob)) / (1 + math.hypot(*[a - b for a, b in zip(e.at(e.L / 2, 0, 0)[:2], ob)]) / 150))
    g.view = square
    # the square front's centre: giant pilasters between five window axes and a pediment over the cornice
    cs = walls[square]
    if len(cs) >= 7:
        mid = len(cs) // 2
        step = cs[1] - cs[0]
        for k in range(-3, 3):
            ps = cs[mid] + (k + 0.5) * step
            g.box(square, ps - 0.45, ps + 0.45, 5.4, H - 0.55, 0, 0.3, 'trim')
            g.box(square, ps - 0.6, ps + 0.6, H - 1.0, H - 0.55, 0, 0.42, 'trim', bottom=True)
        s0, s1 = cs[mid] - 2.5 * step - 0.6, cs[mid] + 2.5 * step + 0.6
        zb = H + 0.45
        g.poly([square.at(s0, 0.05, zb), square.at(s1, 0.05, zb), square.at((s0 + s1) / 2, 0.05, zb + 2.6)], 'wall', square.nvec())
        for a, b in ((s0, (s0 + s1) / 2), ((s0 + s1) / 2, s1)):
            za = zb if a == s0 else zb + 2.6
            zc = zb + 2.6 if a == s0 else zb
            g.poly([square.at(a - (0.3 if a == s0 else 0), 0.5, za), square.at(b + (0.3 if b == s1 else 0), 0.5, zc),
                    square.at(b + (0.3 if b == s1 else 0), -0.6, zc + 0.25), square.at(a - (0.3 if a == s0 else 0), -0.6, za + 0.25)], 'trim', (0, 0, 1))
    z = H + 3.4
    w = g.letters(square, 'ГОРОД-ГЕРОЙ ЛЕНИНГРАД', square.L / 2, z, 2.5, -1.2, col='#fff6e0')
    for k in range(7):
        s = square.L / 2 - w / 2 + w * k / 6
        g.box(square, s - 0.08, s + 0.08, H + 1.2, z + 2.5, -1.5, -1.3, 'metal', top=False)
    g.box(square, square.L / 2 - w / 2, square.L / 2 + w / 2, z - 0.2, z, -1.5, -1.25, 'metal')
    for word, off in (('ГОСТИНИЦА', -0.25), ('ОКТЯБРЬСКАЯ', 0.25)):
        cs = square.L / 2 + off * w
        g.box(square, cs - w * 0.2, cs + w * 0.2, H + 0.55, H + 1.45, 0.08, 0.2, 'dark')
        g.letters(square, word, cs, H + 0.72, 0.62, 0.23, col='#dff0c8', back=False)


@hero(15081493, 'ТЦ «Невский Атриум»')
def nevsky_atrium(fp, g):
    """Nevsky Atrium, Nevsky 71 / Marata 1 after Commons «SPB Newski house 71» and «Mayakovskaya spb»: a salmon-pink
    five-storey corner house with white pilaster strips and window surrounds, round-arched ground floor (the
    Mayakovskaya metro entrance is in it), railing on the roof and the red НЕВСКИЙ АТРИУМ letters over Nevsky, a
    glazed atrium roof inside."""
    g.pal = {'wall': '#d9a28f', 'wall2': '#cf9985', 'trim': '#f5f0e6', 'roof': '#5d6166'}
    walls, H = tenement(g, fp, ground=4.8, floor=3.45, floors=5, bay=3.3, win=1.4, win_h=2.1, ground_w=2.0,
                        hoods={1: 'cornice'}, lesenes=3, attic=0.45, roof=(3.2, 1.2), surround=0.16)
    nevsky = max((e for e in walls if e.n[1] > 0.6), key=lambda e: e.L, default=None)
    top = H + 0.45
    for chain, closed in chains(fp, fp.outer, lambda e: e in walls):
        for i in range(len(chain) - (0 if closed else 1)):
            e = Edge(chain[i], chain[(i + 1) % len(chain)])
            g.quad(e, 0, e.L, top + 0.95, top + 1.05, -0.5, 'metal')
            for s in bays(e.L, 2.5, 0.2):
                g.quad(e, s - 0.03, s + 0.03, top, top + 1.0, -0.5, 'metal')
    if nevsky:
        g.view = nevsky
        g.letters(nevsky, 'НЕВСКИЙ АТРИУМ', nevsky.L * 0.55, top + 1.5, 2.1, -1.0, col='#d7282f')
        for k in range(6):
            s = nevsky.L * 0.55 + (k - 2.5) * 5.0
            g.box(nevsky, s - 0.06, s + 0.06, top, top + 3.6, -1.3, -1.15, 'metal', top=False)
    cx = sum(p[0] for p in fp.outer) / len(fp.outer)
    cy = sum(p[1] for p in fp.outer) / len(fp.outer)
    z = top + 1.2
    half = 6.0
    while half > 2 and not all(inside((cx + sx * (half + 3), cy + sy * (half + 3)), fp.outer) for sx in (-1, 1) for sy in (-1, 1)):
        half -= 0.5
    tip = z + half * 0.5
    sq = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half)]
    g.prism(sq, z - 1.0, z, 'metal', top=False)
    for i in range(4):
        a, b = sq[i], sq[(i + 1) % 4]
        g.poly([(a[0], a[1], z), (b[0], b[1], z), (cx, cy, tip)], 'glass', Edge(a, b).nvec(1, 1))


@hero(1784115, 'ТЦ «Невский Центр»')
def nevsky_centre(fp, g):
    """Nevsky Centre, Nevsky 114–116 (Stockmann mall, 2010, behind the kept front of Nevsky 114) after Commons
    «4567. St. Petersburg. Nevsky Prospect, 114» and «4568-1 … Nevsky Prospect, 112»: on Nevsky an orange-yellow
    four-storey classical front with round-arched shop openings, a white garland frieze, mansard with dormers and
    chimneys, and the mall's glazed top storeys set back behind it; the long side along Vosstaniya street and the
    back are the new building in light stone with regular windows."""
    front = [e for e in fp.edges() if not fp.party(e) and fp.route_near(e)[0] < 40 and fp.route_near(e)[1] > 0.6]
    front_set = set(front)
    g.pal = {'wall': '#e7a94f', 'wall2': '#dc9e46', 'trim': '#f7f2e6', 'roof': '#4f4b49'}
    G, F, NF = 5.8, 3.9, 4
    H = G + F * (NF - 1)
    for e in front:
        g.box(e, 0, e.L, 0, 0.5, 0, 0.1, 'wall2')
        gh, uh = [], []
        cs = bays(e.L, 3.7, 1.0)
        for i, s in enumerate(cs):
            if i % 4 == 1:
                window(g, e, s, 0.6, G - 0.4, 2.6, depth=0.5, kind='arch', sill=False, holes=gh, surround=0.18, arch_segs=5)
            else:
                window(g, e, s, 1.4, G - 1.3, 1.6, depth=0.35, holes=gh, surround=0.12)
            for k in range(1, NF):
                z0 = G + F * (k - 1) + 1.0
                window(g, e, s, z0, z0 + 2.3, 1.45, depth=0.3, surround=0.14, hood='pediment' if k == 1 and i % 2 == 0 else ('cornice' if k == 1 else None), holes=uh)
        g.wall(e, 0, e.L, 0.5, G, gh, mat='wall2')
        g.wall(e, 0, e.L, G, H, uh)
        g.quad(e, 0, e.L, H - 1.45, H - 0.75, 0.08, 'trim')
        for s in bays(e.L, 1.8, 0.6):
            g.poly([e.at(s - 0.55, 0.1, H - 1.3), e.at(s + 0.55, 0.1, H - 1.3), e.at(s, 0.1, H - 0.95)], 'wall', e.nvec(), col='#dfe0d6')
        g.box(e, 0, e.L, H + 1.0, H + 1.6, -3.0, -0.2, 'roof', top=False)
        for s in bays(e.L, 7.4, 3.0):
            gable_dormer(g, e, s, H + 0.6, 1.6, 1.4, 3.0)
            x, y, _ = e.at(s + 3.7, -2.2, 0)
            if s + 3.7 < e.L - 2:
                chimney(g, x, y, H + 0.8, 1.3, 2.9, col='#f0b24f')
    others = [e for e in fp.edges() if e not in front_set]
    MOD = 23.0
    for e in others:
        if fp.party(e):
            g.quad(e, 0, e.L, 0, MOD, 0, 'wall', col='#cdbfa9')
            continue
        uh = []
        far = fp.route_near(e)[0] > 45
        for s in bays(e.L, 3.2, 1.2):
            window(g, e, s, 0.8, 4.6, 2.2, depth=0.3, holes=uh, sill=False, flush=far)
            for k in range(4):
                z0 = 6.2 + k * 3.7
                window(g, e, s, z0, z0 + 2.4, 1.8, depth=0.25, sill=False, holes=uh, flush=far, mullion=False)
        g.wall(e, 0, e.L, 0, MOD - 2.4, uh, col='#cdbfa9')
        g.quad(e, 0, e.L, MOD - 2.4, MOD, 0, 'glass')
        for s in bays(e.L, 3.2, 0):
            g.quad(e, s - 0.05, s + 0.05, MOD - 2.4, MOD, 0.03, 'frame')
    for chain, closed in chains(fp, fp.outer, lambda e: e in front_set):
        g.band(chain, [(0, G - 0.1), (0.2, G), (0.2, G + 0.3), (0, G + 0.45)], 'trim', False)
        g.band(chain, [(0, H - 0.5), (0.15, H - 0.4), (0.7, H + 0.15), (0.7, H + 0.4), (0, H + 0.4)], 'trim', False)
        g.band(chain, [(0, H + 0.4), (-3.2, H + 3.9)], 'roof', False, ends=False)
    for chain, closed in chains(fp, fp.outer, lambda e: e not in front_set and not fp.party(e)):
        g.band(chain, [(0, MOD), (0.4, MOD), (0.4, MOD + 0.5), (-0.3, MOD + 0.5)], 'metal', False)
    # the mall's glazed top set back from Nevsky, and the flat roof
    inner = offset(fp.outer, -9.0, True)
    g.cap(fp.outer, [], MOD + 0.3, 'roof')
    for i in range(len(inner)):
        a, b = inner[i], inner[(i + 1) % len(inner)]
        e = Edge(a, b)
        if e.L < 2:
            continue
        g.quad(e, 0, e.L, MOD + 0.3, MOD + 3.2, 0, 'glass')
        for s in bays(e.L, 2.6, 0):
            g.quad(e, s - 0.05, s + 0.05, MOD + 0.3, MOD + 3.2, 0.03, 'frame')
    g.cap(inner, [], MOD + 3.2, 'metal')


@hero(1588277, 'Best Western Plus, Невский 83 / Лиговский 41')
def best_western(fp, g):
    """Nevsky 83 / Ligovsky 41 (house of Sh. A. Markevich – F. I. Korovin, the Best Western Plus Centre hotel) after
    Commons «Дом Ш.А. Маркевич – Ф.И. Коровина Невский 83 фасад по Лиговскому 2024» and «LigovskyProspektSPb 4888»:
    a pink Art Nouveau house of five storeys over a dark red granite ground floor with big shop windows (restaurant
    Du Nord), a bay window rising through three floors with a balcony on top, a tall arched window, white plaques,
    and stepped attic gables over the ends of the front; chamfered corner to Vosstaniya Square."""
    g.pal = {'wall': '#d69c8d', 'wall2': '#6e3b33', 'trim': '#f1e7de', 'roof': '#5a5e63'}
    GF, FL, NF = 4.8, 3.5, 5
    H = GF + FL * (NF - 1)
    walls, _ = tenement(g, fp, ground=GF, floor=FL, floors=NF, bay=3.3, win=1.5, win_h=2.1, ground_kind='shop',
                        hoods={}, lesenes=0, attic=0.45, roof=(3.0, 1.6), surround=0.1,
                        skip=lambda e, s, k: e.L > 30 and abs(s - e.L * 0.78) < 2.0 and 1 <= k <= 3)
    for e, centres in walls.items():
        if e.L < 20:
            continue
        s_e = e.L * 0.78
        erker(g, e, s_e, 3.6, GF + 0.6, GF + 3 * FL, 0.9, FL, 1.6, rounded=False)
        g.box(e, s_e - 1.9, s_e + 1.9, GF + 3 * FL, GF + 3 * FL + 0.12, 0, 0.9, 'trim', bottom=True)
        g.box(e, s_e - 1.8, s_e + 1.8, GF + 3 * FL + 0.12, GF + 3 * FL + 1.05, 0.85, 0.9, 'metal', top=False)
        for s in centres[1::3]:
            g.quad(e, s - 0.6, s + 0.6, GF + FL + 3.2, GF + FL + 3.6, 0.04, 'trim')
        # stepped attic gables at both ends of the front
        for sc in (e.L * 0.12, e.L * 0.78):
            w = 5.4
            z = H + 0.45
            pts = [(sc - w / 2, z), (sc + w / 2, z), (sc + w / 2, z + 1.2), (sc + w * 0.3, z + 1.2), (sc + w * 0.3, z + 2.2),
                   (sc - w * 0.3, z + 2.2), (sc - w * 0.3, z + 1.2), (sc - w / 2, z + 1.2)]
            loops = [[Vector((a, b, 0)) for a, b in pts]]
            for t in geometry.tessellate_polygon(loops):
                g.poly([e.at(pts[i][0], 0.02, pts[i][1]) for i in t], 'wall', e.nvec())
                g.poly([e.at(pts[i][0], -0.5, pts[i][1]) for i in t], 'wall', e.nvec(-1))
            for a, b in zip(pts, pts[1:] + pts[:1]):
                if a[1] == b[1] and a[1] > z:
                    g.poly([e.at(a[0], 0.02, a[1]), e.at(b[0], 0.02, b[1]), e.at(b[0], -0.5, b[1]), e.at(a[0], -0.5, a[1])], 'trim', (0, 0, 1))
                elif a[0] == b[0]:
                    sgn = 1 if a[0] > sc else -1
                    g.poly([e.at(a[0], 0.02, a[1]), e.at(b[0], 0.02, b[1]), e.at(b[0], -0.5, b[1]), e.at(a[0], -0.5, a[1])], 'wall', (e.u[0] * sgn, e.u[1] * sgn, 0))
            g.quad(e, sc - 0.7, sc + 0.7, z + 0.9, z + 1.7, 0.05, 'glass')
    front = max(walls, key=lambda e: e.L)
    g.box(front, front.L * 0.3, front.L * 0.55, GF - 0.95, GF - 0.35, 0.05, 0.25, 'sign', col='#1c3f7a')
    g.letters(front, 'BEST WESTERN PLUS', front.L * 0.425, GF - 0.85, 0.42, 0.27, col='#ffd24a', back=False)


@hero(1303159, 'Дом Перцова (Лиговский 44)')
def pertsov(fp, g):
    """Pertsov house, Ligovsky 44 (S. Galenzovsky, I. Pretro, 1911) after Commons «Dochodniy dom Pertsova» and
    «Доходный дом А.Н. Перцова, Лиговский проспект, 44 1–4»: a seven-storey Art Nouveau block of rough grey-ochre
    plaster around an inner street and five courtyards; to Ligovsky two fronts flank the entrance to the inner street,
    each with a rounded bay window through five floors crowned by a steep tented roof, balconies with iron railings,
    round-arched top-floor windows, shops in the ground floor and steep roofs with gables."""
    g.pal = {'wall': '#bfa98a', 'wall2': '#8a7d6c', 'trim': '#d8cbb4', 'roof': '#55585c'}
    GF, FL, NF = 4.8, 3.45, 7
    H = GF + FL * (NF - 1)
    fronts = {}

    def skip(e, s, k):
        return any(abs(s - se) < 2.2 for se in fronts.get(e, ())) and 1 <= k <= 5

    for e in fp.edges():
        dist, facing = fp.route_near(e)
        if not fp.party(e) and dist < 25 and facing > 0.5 and e.L > 10:
            fronts[e] = [3.2, e.L - 3.2] if e.L > 22 else [e.L - 3.2 if fp.party(Edge(e.q, e.q)) else 3.2]
    walls, _ = tenement(g, fp, ground=GF, floor=FL, floors=NF, bay=3.4, win=1.4, win_h=2.1, ground_kind='shop',
                        hoods={2: 'cornice'}, arch_floors=(6,), attic=0.6, roof=(4.0, 4.2), surround=0.12, skip=skip,
                        cornice_d=0.9, near=18)
    for e, ss in fronts.items():
        for se in ss:
            erker(g, e, se, 4.0, GF + 0.8, GF + 5 * FL, 0.95, FL, 1.5)
            c = e.at(se, 0.45, 0)
            z = H + 0.6
            ring = [e.at(se + dx, dd, 0) for dx, dd in ((-2.3, -1.6), (2.3, -1.6), (2.3, 1.0), (-2.3, 1.0))]
            ring = [(p[0], p[1]) for p in ring]
            if area2(ring) < 0:
                ring.reverse()
            g.prism(ring, GF + 5 * FL, z + 1.2, 'wall', top=False)
            for i in range(4):
                a, b = ring[i], ring[(i + 1) % 4]
                g.poly([(a[0], a[1], z + 1.2), (b[0], b[1], z + 1.2), (c[0], c[1], z + 8.5)], 'roof', Edge(a, b).nvec(1, 0.6))
            g.prism([(c[0] - 0.1, c[1] - 0.1), (c[0] + 0.1, c[1] - 0.1), (c[0] + 0.1, c[1] + 0.1), (c[0] - 0.1, c[1] + 0.1)], z + 8.3, z + 10.0, 'metal')
        # a curved gable over the middle of each front and iron balconies
        sc = e.L / 2
        z = H + 0.6
        pts = [(sc - 3.4, z), (sc + 3.4, z)] + [(sc + 3.4 * math.cos(math.pi * k / 6), z + 1.2 + 2.6 * math.sin(math.pi * k / 6)) for k in range(0, 7)]
        loops = [[Vector((a, b, 0)) for a, b in pts]]
        for t in geometry.tessellate_polygon(loops):
            g.poly([e.at(pts[i][0], 0.05, pts[i][1]) for i in t], 'wall', e.nvec())
            g.poly([e.at(pts[i][0], -0.6, pts[i][1]) for i in t], 'wall', e.nvec(-1))
        for a, b in zip(pts[2:], pts[3:]):
            g.poly([e.at(a[0], 0.05, a[1]), e.at(b[0], 0.05, b[1]), e.at(b[0], -0.6, b[1]), e.at(a[0], -0.6, a[1])], 'trim', (0, 0, 1))
        g.poly([e.at(sc - 0.9, 0.08, z + 0.6), e.at(sc + 0.9, 0.08, z + 0.6), e.at(sc + 0.9, 0.08, z + 2.2), e.at(sc - 0.9, 0.08, z + 2.2)], 'glass', e.nvec())
        for k in (2, 4):
            zb = GF + FL * (k - 1) + 0.8
            g.box(e, sc - 2.0, sc + 2.0, zb - 0.15, zb, 0, 0.8, 'trim', bottom=True)
            g.box(e, sc - 1.95, sc + 1.95, zb, zb + 1.0, 0.72, 0.8, 'metal', top=False)


@hero(19186354, 'Доходный дом, Марата 36–38')
def marata_36(fp, g):
    """Marata 36–38: a seven-storey Petersburg tenement of the 1900s on a deep U-shaped plot. No usable photograph was
    found, so the front follows the street's Art Nouveau tenements of the same height: ochre plaster over a rusticated
    ground floor with shops, two flat-sided bay windows through five floors, a round-arched gateway to the yard,
    iron balconies and a steep metal roof with dormers."""
    g.pal = {'wall': '#cdb58e', 'wall2': '#b39c78', 'trim': '#efe6d4', 'roof': '#5c5f63'}
    GF, FL, NF = 4.6, 3.45, 7
    H = GF + FL * (NF - 1)
    fronts = {}
    for e in fp.edges():
        dist, facing = fp.route_near(e)
        if not fp.party(e) and dist < 40 and facing > 0.5 and e.L > 16:
            fronts[e] = (e.L * 0.22, e.L * 0.78)

    def skip(e, s, k):
        if e not in fronts:
            return False
        if k == 0 and abs(s - e.L / 2) < 2:
            return True
        return any(abs(s - se) < 2.1 for se in fronts[e]) and 1 <= k <= 5

    walls, _ = tenement(g, fp, ground=GF, floor=FL, floors=NF, bay=3.3, win=1.35, win_h=2.1, ground_kind='shop',
                        hoods={1: 'pediment', 2: 'cornice'}, attic=0.6, roof=(3.8, 3.2), skip=skip, surround=0.14,
                        near=25)
    for e, ss in fronts.items():
        for se in ss:
            erker(g, e, se, 3.8, GF + 0.6, GF + 5 * FL, 0.85, FL, 1.4, rounded=False)
        gate = arch(e.L / 2 - 1.8, e.L / 2 + 1.8, 0.02, 3.2, 6)
        g.poly([e.at(a, 0.04, b) for a, b in gate], 'dark', e.nvec())
        g.poly([e.at(a, 0.06, b) for a, b in [(e.L / 2 - 2.1, 0.02), (e.L / 2 - 1.8, 0.02), (e.L / 2 - 1.8, 3.4), (e.L / 2 - 2.1, 3.4)]], 'trim', e.nvec())
        g.poly([e.at(a, 0.06, b) for a, b in [(e.L / 2 + 1.8, 0.02), (e.L / 2 + 2.1, 0.02), (e.L / 2 + 2.1, 3.4), (e.L / 2 + 1.8, 3.4)]], 'trim', e.nvec())
        for k in (2, 3, 4, 5):
            zb = GF + FL * (k - 1) + 0.8
            g.box(e, e.L / 2 - 2.2, e.L / 2 + 2.2, zb - 0.15, zb, 0, 0.8, 'trim', bottom=True)
            g.box(e, e.L / 2 - 2.15, e.L / 2 + 2.15, zb, zb + 1.0, 0.72, 0.8, 'metal', top=False)
        for s in bays(e.L, 6.6, 3.0):
            gable_dormer(g, e, s, H + 1.4, 1.6, 1.5, 3.3)


@hero(953406, 'Доходный дом, Лиговский 65')
def ligovsky_65(fp, g):
    """Ligovsky 65 after Commons «Ligovsky65.jpg» and «Лиговский 65 02dif»: a seven-storey Neo-classical / late Art
    Nouveau tenement faced in grey textured stone plaster, four rounded bay windows through the upper floors,
    round-arched windows on the two top floors, a pelican relief under a balcony, a tall arched gateway in the middle
    and small pediments on the attic."""
    g.pal = {'wall': '#a9a8a2', 'wall2': '#96948d', 'trim': '#c4c2bb', 'roof': '#55585c'}
    GF, FL, NF = 4.4, 3.45, 7
    H = GF + FL * (NF - 1)
    fronts = {}
    for e in fp.edges():
        dist, facing = fp.route_near(e)
        if not fp.party(e) and dist < 40 and facing > 0.5 and e.L > 20:
            fronts[e] = [e.L * f for f in (0.12, 0.36, 0.64, 0.88)]

    def skip(e, s, k):
        if e not in fronts:
            return False
        if k == 0 and abs(s - e.L / 2) < 2:
            return True
        return any(abs(s - se) < 1.9 for se in fronts[e]) and 1 <= k <= 5

    walls, _ = tenement(g, fp, ground=GF, floor=FL, floors=NF, bay=3.2, win=1.3, win_h=2.0, ground_kind='shop',
                        hoods={}, arch_floors=(5, 6), attic=1.0, roof=(3.2, 2.0), skip=skip, surround=0.12, rust=True)
    for e, ss in fronts.items():
        for se in ss:
            erker(g, e, se, 3.4, GF + FL, GF + 5 * FL, 0.9, FL, 1.3)
        gate = arch(e.L / 2 - 1.7, e.L / 2 + 1.7, 0.02, 3.4, 6)
        g.poly([e.at(a, 0.04, b) for a, b in gate], 'dark', e.nvec())
        for sc in (e.L * 0.24, e.L * 0.5, e.L * 0.76):
            z = H + 1.0
            g.poly([e.at(sc - 2.2, 0.02, z), e.at(sc + 2.2, 0.02, z), e.at(sc, 0.02, z + 1.3)], 'wall', e.nvec())
            g.poly([e.at(sc - 2.3, 0.08, z), e.at(sc, 0.08, z + 1.36), e.at(sc, -0.3, z + 1.36), e.at(sc - 2.3, -0.3, z)], 'trim', e.nvec(-0.5, 1))
            g.poly([e.at(sc + 2.3, 0.08, z), e.at(sc + 2.3, -0.3, z), e.at(sc, -0.3, z + 1.36), e.at(sc, 0.08, z + 1.36)], 'trim', e.nvec(-0.5, 1))
        zb = GF + FL * 3 + 0.8
        g.box(e, e.L / 2 - 2.0, e.L / 2 + 2.0, zb - 0.9, zb, 0, 0.85, 'wall2', bottom=True)
        g.box(e, e.L / 2 - 1.95, e.L / 2 + 1.95, zb, zb + 1.0, 0.78, 0.85, 'metal', top=False)


@hero(61650439, 'БЦ «Olympic Plaza»')
def olympic_plaza(fp, g):
    """Olympic Plaza business centre, Stremyannaya 21/5 at Marata. No photograph was available offline; modelled as
    the 2000s Petersburg business centre it is: six storeys of light granite cladding with large punched windows in
    pairs, a glazed ground floor behind a thin canopy, the corner to Marata glazed full height and rising a storey
    above the metal-coped parapet with the name on it."""
    g.pal = {'wall': '#c6bfb2', 'wall2': '#9d968b', 'trim': '#e2ddd3', 'roof': '#5e6166'}
    H, GF, FL = 22.4, 4.8, 3.5
    edges = fp.edges()
    street = [e for e in edges if not fp.party(e)]
    corner_v = None
    if len(street) >= 2:
        for a in street:
            for b in street:
                if a is not b and math.hypot(a.q[0] - b.p[0], a.q[1] - b.p[1]) < 0.01:
                    corner_v = (a, b)
    for e in edges:
        if e not in street:
            g.quad(e, 0, e.L, 0, H + 0.9, 0, 'wall')
            continue
        gh, uh = [], []
        cs = bays(e.L, 3.3, 0.9)
        for i, s in enumerate(cs):
            o = rect(s - 1.35, s + 1.35, 0.4, GF - 0.6)
            gh.append(o)
            g.opening(e, o, 0.35)
            g.quad(e, s - 0.04, s + 0.04, 0.4, GF - 0.6, -0.32, 'frame')
            for k in range(5):
                z0 = GF + k * FL + 0.8
                o = rect(s - 1.1, s + 1.1, z0, z0 + 2.2)
                uh.append(o)
                g.opening(e, o, 0.3, reveal='trim')
                g.quad(e, s - 0.04, s + 0.04, z0, z0 + 2.2, -0.28, 'frame')
        g.wall(e, 0, e.L, 0, GF, gh, mat='wall2')
        g.wall(e, 0, e.L, GF, H, uh)
        g.box(e, 0, e.L, GF - 0.2, GF + 0.05, 0, 0.9, 'metal', bottom=True)
        for i, s in enumerate(cs[:-1]):
            ps = (s + cs[i + 1]) / 2
            g.box(e, ps - 0.3, ps + 0.3, GF + 0.05, H, 0, 0.15, 'wall')
    for chain, closed in chains(fp, fp.outer, lambda e: e in street):
        g.band(chain, [(0, H), (0.35, H), (0.35, H + 0.9), (-0.3, H + 0.9)], 'metal', closed)
    g.cap(fp.outer, [], H + 0.5, 'roof')
    if corner_v:
        a, b = corner_v
        # glazed corner: the last 5 m of one front and the first 5 m of the other, a storey higher
        for e, s0, s1 in ((a, a.L - 5.0, a.L), (b, 0.0, 5.0)):
            g.quad(e, s0, s1, 0.4, H + 3.8, 0.35, 'glass')
            for s in (s0 + 0.05, (s0 + s1) / 2, s1 - 0.05):
                g.quad(e, s - 0.06, s + 0.06, 0.4, H + 3.8, 0.4, 'frame')
            for k in range(7):
                z = GF + k * FL
                g.quad(e, s0, s1, z - 0.1, z + 0.1, 0.4, 'frame')
            g.box(e, s0, s1, H + 3.8, H + 4.2, -0.2, 0.45, 'metal')
        cp = a.q
        back = [a.at(a.L - 5.0, 0.35, 0), a.at(a.L - 5.0, -5.0, 0), b.at(5.0, -5.0, 0), b.at(5.0, 0.35, 0)]
        g.poly([(p[0], p[1], H + 3.8) for p in back] + [(cp[0] + (a.n[0] + b.n[0]) * 0.35, cp[1] + (a.n[1] + b.n[1]) * 0.35, H + 3.8)], 'roof', (0, 0, 1))
        g.letters(a, 'OLYMPIC PLAZA', a.L - 14.0, H + 1.2, 1.1, 0.2, col='#f4f6f8', back=False)
        g.view = a


@hero(60913204, 'БЦ «Лиговка» (Лиговский 73)')
def ligovka(fp, g):
    """Business centre «Ligovka», Ligovsky 73, after the Commons panorama «Saint Petersburg Ligovsky Avenue 73
    2016-06»: a late-Soviet office front re-clad in the 2000s — white vertical piers and blue-grey ribbon glazing over
    five storeys, a glazed ground floor with a curved canopy and the БИЗНЕС-ЦЕНТР sign over the entrance."""
    g.pal = {'wall': '#e3e4e1', 'wall2': '#8f959b', 'trim': '#f4f5f3', 'roof': '#5e6166'}
    H, GF, FL = 18.6, 4.2, 3.6
    edges = fp.edges()
    for e in edges:
        if fp.party(e):
            g.quad(e, 0, e.L, 0, H + 0.7, 0, 'wall')
            continue
        dist, facing = fp.route_near(e)
        uh = []
        n = max(1, int(e.L / 1.9))
        step = e.L / n
        for k in range(4):
            z0 = GF + k * FL + 0.9
            o = rect(0.35, e.L - 0.35, z0, z0 + 2.1)
            uh.append(o)
            g.opening(e, o, 0.25)
            for i in range(1, n):
                g.box(e, step * i - 0.25, step * i + 0.25, z0, z0 + 2.1, -0.25, 0.3, 'trim', top=False)
        o = rect(0.35, e.L - 0.35, 0.3, GF - 0.3)
        uh.append(o)
        g.opening(e, o, 0.3)
        for i in range(1, n):
            g.quad(e, step * i - 0.05, step * i + 0.05, 0.3, GF - 0.3, -0.27, 'frame')
        g.wall(e, 0, e.L, 0, H, uh)
        if dist < 40 and facing > 0.5 and e.L > 20:
            mid = e.L / 2
            pts = [(mid - 6 + 12 * k / 8, 0.6 + 0.35 * math.sin(math.pi * k / 8)) for k in range(9)]
            for (s0, d0), (s1, d1) in zip(pts, pts[1:]):
                g.poly([e.at(s0, 0, GF - 0.5), e.at(s1, 0, GF - 0.5), e.at(s1, d1, GF - 0.5), e.at(s0, d0, GF - 0.5)], 'metal', (0, 0, -1))
                g.poly([e.at(s0, 0, GF - 0.3), e.at(s0, d0, GF - 0.3), e.at(s1, d1, GF - 0.3), e.at(s1, 0, GF - 0.3)], 'metal', (0, 0, 1))
                a, b = e.at(s0, d0, 0), e.at(s1, d1, 0)
                fe = Edge((a[0], a[1]), (b[0], b[1]))
                g.quad(fe, 0, fe.L, GF - 0.5, GF - 0.3, 0, 'metal')
            g.box(e, mid - 7.5, mid + 7.5, GF + 0.05, GF + 0.85, 0.02, 0.3, 'sign', col='#1f4f8f')
            g.letters(e, 'БИЗНЕС-ЦЕНТР', mid, GF + 0.2, 0.5, 0.32, col='#ffffff', back=False)
    for chain, closed in chains(fp, fp.outer, lambda e: not fp.party(e)):
        g.band(chain, [(0, H), (0.3, H), (0.3, H + 0.7), (-0.3, H + 0.7)], 'metal', closed)
        g.band(chain, [(0, GF - 0.05), (0.1, GF - 0.05), (0.1, GF + 0.9), (0, GF + 0.9)], 'wall2', closed)
    g.cap(fp.outer, [], H + 0.4, 'roof')


@hero(28962850, 'Вестибюль станции метро «Площадь Восстания»', parts=(310869151,))
def vosstaniya_metro(fp, g):
    """entrance hall of Ploshchad Vosstaniya metro station on the corner of Nevsky and Vosstaniya street (1955) after
    Commons «Ligovsky Avenue at crossing with Nevsky Avenue»: a round ochre pavilion — rusticated lower storey with
    arched doors and windows, a drum ringed by a colonnade, cornice and parapet, a low dome and a tall spire"""
    g.pal = {'wall': '#d9b77f', 'wall2': '#cfae78', 'trim': '#f2ebdc', 'roof': '#6a7071'}
    drum = fp.part(310869151)
    cx = sum(p[0] for p in drum) / len(drum)
    cy = sum(p[1] for p in drum) / len(drum)
    R = sum(math.hypot(p[0] - cx, p[1] - cy) for p in drum) / len(drum)
    G = 6.6
    for e in fp.edges():
        gh = []
        for s in bays(e.L, 3.6, 0.6):
            door = fp.route_near(e)[1] > 0.3
            window(g, e, s, 0.35 if door else 1.4, G - 1.0, 2.0 if door else 1.4, depth=0.4, kind='arch', sill=not door,
                   hood='key', holes=gh, arch_segs=4)
        g.wall(e, 0, e.L, 0, G, gh, mat='wall2')
    g.band(fp.outer, [(0, G - 0.2), (0.35, G - 0.05), (0.35, G + 0.35), (0, G + 0.35)], 'trim', True)
    g.cap(fp.outer, [drum], G + 0.35, 'roof')
    Z1 = G + 0.35 + 8.4
    segs = 16
    g.lathe(cx, cy, [(R - 0.6, G + 0.35), (R - 0.6, Z1)], segs, 'wall', closed_top=False)
    for k in range(segs):
        a = 2 * math.pi * (k + 0.5) / segs
        px, py = cx + math.cos(a) * (R - 0.05), cy + math.sin(a) * (R - 0.05)
        g.lathe(px, py, [(0.42, G + 0.8), (0.42, Z1 - 0.8), (0.55, Z1 - 0.5)], 6, 'trim', closed_top=False)
        wa = 2 * math.pi * k / segs
        e = Edge((cx + math.cos(wa - 0.13) * (R - 0.58), cy + math.sin(wa - 0.13) * (R - 0.58)), (cx + math.cos(wa + 0.13) * (R - 0.58), cy + math.sin(wa + 0.13) * (R - 0.58)))
        g.poly([e.at(0.15, 0.02, G + 2.2), e.at(e.L - 0.15, 0.02, G + 2.2), e.at(e.L - 0.15, 0.02, G + 5.8), e.at(e.L / 2, 0.02, G + 6.5), e.at(0.15, 0.02, G + 5.8)], 'glass', e.nvec())
    g.lathe(cx, cy, [(R - 0.6, G + 0.35), (R + 0.5, G + 0.35), (R + 0.5, G + 0.8), (R - 0.6, G + 0.8)], segs, 'trim', closed_top=False)
    g.lathe(cx, cy, [(R - 0.6, Z1 - 0.5), (R + 0.35, Z1 - 0.4), (R + 0.6, Z1), (R + 0.6, Z1 + 0.5), (R - 0.6, Z1 + 0.5)], segs, 'trim', closed_top=False)
    g.lathe(cx, cy, [(R + 0.1, Z1 + 0.5), (R + 0.1, Z1 + 1.4), (R - 0.4, Z1 + 1.4)], segs, 'wall', closed_top=False)
    g.lathe(cx, cy, [(R - 0.4, Z1 + 1.2), (R * 0.8, Z1 + 2.8), (R * 0.45, Z1 + 4.2), (1.2, Z1 + 4.8)], segs, 'roof', closed_top=False)
    g.lathe(cx, cy, [(1.2, Z1 + 4.8), (1.2, Z1 + 6.4), (0.9, Z1 + 6.6)], 8, 'wall', closed_top=False)
    g.lathe(cx, cy, [(0.9, Z1 + 6.6), (0.5, Z1 + 7.6), (0.08, Z1 + 15.0)], 8, 'gold')


# ── wave 2: the tenements along Svechnoy, Marata and the Nevsky corner ──

@hero(56020036, 'Доходный дом Сагалова (Лиговский 91 / Свечной 27)', tol=0.7)
def sagalov(fp, g):
    """Sagalov tenement, Ligovsky 91 / Svechnoy 27 (OSM wikipedia «Доходный дом Сагалова», a heritage site) after
    Commons «Ligovsky Avenue 91 2010-08»: seven storeys of grey textured stone plaster, a rounded bay taking the corner
    through all upper floors, a big half-round window in a curved gable over the middle of the Ligovsky front, round-
    arched top-floor windows there, shops below and a steep grey roof."""
    g.pal = {'wall': '#aeaca5', 'wall2': '#8e8b84', 'trim': '#c9c6be', 'roof': '#596064'}
    GF, FL, NF = 4.6, 3.2, 7
    H = GF + FL * (NF - 1)
    es = fp.edges()
    svech = max(fronts(fp), key=lambda e: e.L)
    lig = max((e for e in es if e.n[0] > 0.8 and not fp.party(e)), key=lambda e: e.L)
    corner = ring_walk(fp, lig, 2.8)
    ce = Edge(lig.at(lig.L - 2.8, 0, 0)[:2], corner)

    def skip(e, s, k):
        return e == lig and s > lig.L - 3.4 and k >= 1

    walls, _ = tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.4, win=1.3, win_h=1.95, ground_kind='shop',
                        hoods={}, arch_floors=lambda e, s, k: e == lig and k == NF - 1, attic=0.8, roof=(3.2, 3.6),
                        surround=0.1, skip=skip, near=15, rust_floors=2, keep=(lig,), surround_floors=2)
    g.view = lig
    after = fp.edges()[(fp.edges().index(lig) + 1) % len(fp.edges())]
    corner_tower(g, lig, after, 3.0, GF + 0.3, H, FL)
    gable(g, lig, lig.L / 2, H + 0.8, 7.6, 4.4, 'curved', window='half')
    for e in (svech,):
        for k in (2, 5):
            for s in (e.L * 0.3, e.L * 0.7):
                balcony(g, e, s - 1.6, s + 1.6, GF + FL * (k - 1) + 0.95, 0.75)


@hero(60913189, 'Доходный дом, Свечной 20')
def svechnoy_20(fp, g):
    """Svechnoy 20: a long four-storey house of the 1850s–80s lining the lane for 80 m. No photograph was found; it is
    modelled as the lane's plain late-classical houses are: warm ochre plaster, rusticated ground floor with a round-
    arched carriage gateway in the middle, window cornices on the main floor, a central balcony and a low metal roof."""
    g.pal = {'wall': '#d9c59c', 'wall2': '#c4ae85', 'trim': '#efe7d6', 'roof': '#5c6166'}
    GF, FL = 4.2, 3.5
    main = max(fronts(fp), key=lambda e: e.L)

    def skip(e, s, k):
        return e == main and k == 0 and abs(s - e.L / 2) < 2.2

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=4, bay=3.3, win=1.35, win_h=2.1, ground_kind='rect',
             hoods={1: 'cornice'}, attic=0.45, roof=(2.6, 1.5), surround=0.12, skip=skip, near=25)
    gate = arch(main.L / 2 - 1.6, main.L / 2 + 1.6, 0.02, 2.4, 6)
    g.poly([main.at(a, 0.04, b) for a, b in gate], 'dark', main.nvec())
    g.box(main, main.L / 2 - 0.25, main.L / 2 + 0.25, 3.6, 4.1, 0, 0.14, 'trim')
    balcony(g, main, main.L / 2 - 2.2, main.L / 2 + 2.2, GF + 0.95, 0.7)


@hero(19575781, 'Доходный дом, Марата 40')
def marata_40(fp, g):
    """Marata 40: a six-storey tenement of about 1900. No photograph was found; it follows the eclectic houses of the
    same street (Marata 36–38, 33): dusty-pink plaster over a rusticated shop floor, two bay windows through four floors
    with balconies on top and small pediments over them on the attic, pediments and cornices over the windows, a
    carriage arch in the middle."""
    g.pal = {'wall': '#c9aa9c', 'wall2': '#a98e81', 'trim': '#ede3d9', 'roof': '#5a5e62'}
    GF, FL, NF = 4.6, 3.4, 6
    H = GF + FL * (NF - 1)
    main = max(fronts(fp), key=lambda e: e.L)
    ers = (main.L * 0.2, main.L * 0.8)

    def skip(e, s, k):
        if e != main:
            return False
        if k == 0 and abs(s - e.L / 2) < 2.0:
            return True
        return 1 <= k <= 4 and any(abs(s - se) < 2.0 for se in ers)

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.2, win=1.35, win_h=2.1, ground_kind='shop',
             hoods={1: 'pediment', 2: 'cornice'}, attic=0.9, roof=(3.2, 2.4), surround=0.14, skip=skip, near=30)
    for se in ers:
        z1 = GF + 4 * FL
        erker(g, main, se, 3.6, GF + 0.5, z1, 0.85, FL, 1.4, rounded=False)
        g.box(main, se - 1.75, se + 1.75, z1, z1 + 1.0, 0.78, 0.85, 'metal', top=False)
        gable(g, main, se, H + 0.9, 4.4, 1.9, 'triangle', window=False)
    gate = arch(main.L / 2 - 1.6, main.L / 2 + 1.6, 0.02, 2.8, 6)
    g.poly([main.at(a, 0.04, b) for a, b in gate], 'dark', main.nvec())


@hero(61580054, 'Доходный дом, Марата 30')
def marata_30(fp, g):
    """Marata 30: a narrow seven-storey Art Nouveau tenement between lower neighbours. No photograph was found; it is
    given the features of the street's 1900s houses of that height: light beige plaster with a darker rusticated base of
    two storeys, a rounded bay window in the middle crowned by a curved gable, round-arched top-floor windows, iron
    balconies and a steep roof."""
    g.pal = {'wall': '#cfbc99', 'wall2': '#a28f70', 'trim': '#ebe1cc', 'roof': '#555a5f'}
    GF, FL, NF = 4.8, 3.25, 7
    H = GF + FL * (NF - 1)
    main = max(fronts(fp), key=lambda e: e.L)

    def skip(e, s, k):
        return e == main and 2 <= k <= 5 and abs(s - e.L / 2) < 2.4

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.1, win=1.3, win_h=2.0, ground_kind='shop',
             hoods={2: 'cornice'}, arch_floors=(6,), attic=0.6, roof=(3.0, 3.2), surround=0.12, skip=skip, near=30,
             rust_floors=2)
    erker(g, main, main.L / 2, 4.6, GF + FL + 0.4, GF + 5 * FL, 0.9, FL, 1.4)
    gable(g, main, main.L / 2, H + 0.6, 6.0, 3.4, 'curved')
    for k in (3, 5):
        for s in (main.L * 0.18, main.L * 0.82):
            balcony(g, main, s - 1.2, s + 1.2, GF + FL * (k - 1) + 0.95, 0.7)


@hero(61580031, 'Доходный дом, Свечной 16 / Коломенская 19')
def svechnoy_16(fp, g):
    """Svechnoy 16 / Kolomenskaya 19: a four-storey corner house of the mid-19th century. No photograph was found; it
    is modelled as the lane's late-classical houses: pale green plaster, white pilaster strips and pediments on the
    main floor, shops in the ground floor and a balcony over the middle."""
    g.pal = {'wall': '#b9c3b0', 'wall2': '#9ca793', 'trim': '#eef0e6', 'roof': '#5b6064'}
    GF, FL = 4.3, 3.5
    main = max(fronts(fp), key=lambda e: e.L)
    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=4, bay=3.3, win=1.35, win_h=2.1, ground_kind='shop',
             hoods={1: 'pediment'}, lesenes=3, attic=0.45, roof=(2.6, 1.5), surround=0.12, near=25)
    balcony(g, main, main.L / 2 - 3.0, main.L / 2 + 3.0, GF + 0.95, 0.8)


@hero(61580027, 'Доходный дом, Марата 26 / Кузнечный 11')
def marata_26(fp, g):
    """Marata 26 / Kuznechny 11 after Commons «Tsentralny District, St Petersburg, Russia - panoramio (335), (337)»: a
    sand-coloured four-storey eclectic corner house — rusticated walls, pediments and cornices over the windows, a
    corner bay with a balcony over the cut-off corner and a curved gable with a round window above it, small attic
    gables along Marata."""
    g.pal = {'wall': '#cdbd97', 'wall2': '#b8a680', 'trim': '#e6dbc1', 'roof': '#5b5f63'}
    GF, FL, NF = 4.4, 3.6, 4
    H = GF + FL * (NF - 1)
    es = fp.edges()
    mar = max(fronts(fp), key=lambda e: e.L)
    i = es.index(mar)
    # the Kuznechny front: the long street wall that ends a few metres before Marata starts
    north = None
    run = 0.0
    for k in range(1, 6):
        c = es[(i - k) % len(es)]
        if c.L > 15 and not fp.party(c):
            north = c
            break
        run += c.L
    ce = Edge(north.q, mar.p) if north else None

    def skip(e, s, k):
        return ce is not None and 1 <= k <= 2 and ((e == mar and s < 2.6) or (e == north and s > e.L - 2.6))

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.4, win=1.4, win_h=2.2, ground_kind='rect',
             hoods={1: 'pediment', 2: 'cornice'}, lesenes=3, attic=0.45, roof=(3.0, 1.6), surround=0.14, skip=skip,
             near=30)
    if ce:
        w = max(ce.L, 3.4)
        erker(g, ce, ce.L / 2, w, GF + 0.3, GF + 2 * FL, 0.8, FL, 1.3, rounded=False)
        g.box(ce, ce.L / 2 - w / 2, ce.L / 2 + w / 2, GF + 2 * FL, GF + 2 * FL + 1.0, 0.72, 0.8, 'metal', top=False)
        gable(g, ce, ce.L / 2, H + 0.45, max(ce.L + 1.0, 4.4), 4.0, 'curved')
    for f in (0.35, 0.8):
        gable(g, mar, mar.L * f, H + 0.45, 3.4, 1.6, 'triangle', window=False)


@hero(946837, 'Доходный дом, Лиговский 87')
def ligovsky_87(fp, g):
    """Ligovsky 87 (a heritage-listed tenement) after Commons «Saint Petersburg Ligovsky Avenue 87 2025-03 282» and
    «… 295»: a six-storey eclectic house in terracotta-pink plaster, richly framed windows with pediments on the second
    floor and cornices above, bay windows at both ends of the front with balconies on top and small gables over them,
    iron balconies in between and shops in the rusticated ground floor."""
    g.pal = {'wall': '#c98770', 'wall2': '#a8705c', 'trim': '#efdccb', 'roof': '#585c60'}
    GF, FL, NF = 5.0, 3.5, 6
    H = GF + FL * (NF - 1)
    main = max(fronts(fp), key=lambda e: e.L)
    ers = (main.L * 0.12, main.L * 0.88)

    def skip(e, s, k):
        return e == main and 1 <= k <= 4 and any(abs(s - se) < 1.8 for se in ers)

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.0, win=1.3, win_h=2.1, ground_kind='shop',
             hoods={1: 'pediment', 2: 'cornice', 3: 'cornice'}, attic=0.7, roof=(3.0, 2.0), surround=0.16, skip=skip,
             near=25)
    for se in ers:
        z1 = GF + 4 * FL
        erker(g, main, se, 3.4, GF + 0.5, z1, 0.85, FL, 1.3, rounded=False)
        g.box(main, se - 1.65, se + 1.65, z1, z1 + 1.0, 0.78, 0.85, 'metal', top=False)
        gable(g, main, se, H + 0.7, 4.0, 1.8, 'triangle', window=False)
    for k in (2, 4):
        balcony(g, main, main.L / 2 - 4.2, main.L / 2 + 4.2, GF + FL * (k - 1) + 0.95, 0.8)


@hero(18896086, 'Доходный дом, Марата 33')
def marata_33(fp, g):
    """Marata 33 after Commons «4953. St. Petersburg. Marata Street, 33» and «Saint Petersburg. Marat Street, 33.
    --2024-06-09»: a long five-storey house in peach plaster with white trim — shallow end risalits marked by pilaster
    strips and round-arched top-floor windows, cornices over the main-floor windows, small iron balconies, shops."""
    g.pal = {'wall': '#e1b597', 'wall2': '#cc9e7f', 'trim': '#f4e8da', 'roof': '#5c6064'}
    GF, FL, NF = 4.4, 3.5, 5
    H = GF + FL * (NF - 1)
    main = max(fronts(fp), key=lambda e: e.L)
    walls, _ = tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.3, win=1.35, win_h=2.1, ground_kind='shop',
                        hoods={1: 'cornice'}, arch_floors=lambda e, s, k: e == main and k == NF - 1 and (s < 7.5 or s > e.L - 7.5),
                        attic=0.45, roof=(3.0, 1.8), surround=0.13, near=25)
    for ps in (7.5, main.L - 7.5):
        g.box(main, ps - 0.35, ps + 0.35, GF + 0.4, H - 0.5, 0, 0.14, 'trim')
    cs = walls.get(main, [])
    for k, pick in ((2, (3, len(cs) - 4)), (3, (len(cs) // 2,))):
        for i in pick:
            if 0 <= i < len(cs):
                balcony(g, main, cs[i] - 1.1, cs[i] + 1.1, GF + FL * (k - 1) + 0.95, 0.6)


@hero(15081491, 'Доходный дом, Марата 3 / Стремянная 22')
def marata_3(fp, g):
    """Marata 3 / Stremyannaya 22 after Commons «Saint Petersburg. Marat Street, 3 (Stremyannaya St., 22)»: a five-storey
    corner house of about 1900 — the two lower floors rusticated in dark grey-brown, the upper floors in cream plaster
    with pediments and cornices over the windows — its corner taken by a rounded bay and crowned with a drum, a green
    dome and a gilded spire."""
    g.pal = {'wall': '#d8c6a2', 'wall2': '#7e7166', 'trim': '#ece2cc', 'roof': '#5b5f63'}
    GF, FL, NF = 4.4, 3.6, 5
    H = GF + FL * (NF - 1)
    es = fp.edges()
    mar = max(fronts(fp), key=lambda e: e.L)
    south = es[es.index(mar) - 1]
    ce = corner_edge(south, mar, 3.0)

    def skip(e, s, k):
        return (e == mar and s < 3.2) or (e == south and s > e.L - 3.2)

    tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.4, win=1.35, win_h=2.1, ground_kind='shop',
             hoods={2: 'pediment', 3: 'cornice'}, attic=0.45, roof=(3.0, 1.8), surround=0.13, skip=skip, near=30,
             rust_floors=2)
    cx, cy = corner_tower(g, south, mar, 3.0, 0.6, H, FL)
    dome(g, cx, cy, H + 0.3, 2.5, 2.4, 2.8, spire=2.4, cap_col='#6f8a78')
    for k in (2, 3):
        for f in (0.35, 0.7):
            balcony(g, mar, mar.L * f - 1.2, mar.L * f + 1.2, GF + FL * (k - 1) + 0.95, 0.6)


@hero(4156618, 'Доходный дом, Невский 73–75 / Марата 2')
def nevsky_73(fp, g):
    """Nevsky 73–75 / Marata 2 after Commons «SPB Newski house 73» and «SPB Newski house 75»: a five-storey eclectic
    corner block opposite the Nevsky Atrium — ochre plaster, shop windows under the ground-floor cornice, pediments on
    the second floor and cornices on the third, iron balconies, a dentilled main cornice and a railing on the roof."""
    g.pal = {'wall': '#d5b37e', 'wall2': '#bf9b66', 'trim': '#f0e4cc', 'roof': '#5a5e62'}
    GF, FL, NF = 4.8, 3.6, 5
    H = GF + FL * (NF - 1)
    walls, _ = tenement(g, fp, away_flat=True, ground=GF, floor=FL, floors=NF, bay=3.6, win=1.4, win_h=2.2, ground_kind='shop',
                        hoods={1: 'pediment', 2: 'cornice'}, attic=0.6, roof=(3.2, 1.8), surround=0.15, near=30,
                        surround_floors=2)
    top = H + 0.6
    for e in fronts(fp):
        cs = walls.get(e, [])
        mid = len(cs) // 2
        if len(cs) >= 5:
            balcony(g, e, cs[mid - 1] - 0.9, cs[mid + 1] + 0.9, GF + 0.95, 0.85)
            for i in (1, len(cs) - 2):
                balcony(g, e, cs[i] - 0.9, cs[i] + 0.9, GF + 2 * FL + 0.95, 0.6)
        g.quad(e, 0, e.L, top + 0.95, top + 1.05, -0.4, 'metal')
        for s in bays(e.L, 2.4, 0.2):
            g.quad(e, s - 0.03, s + 0.03, top, top + 1.0, -0.4, 'metal')


# ───────────────────────── build, export, manifest ─────────────────────────

manifest = {'map': 'ligovsky', 'heroes': []}
cams = {}
for osm_id, name, parts, fn, tol in HEROES:
    if ONLY and osm_id not in ONLY:
        continue
    fp = Footprint(osm_id, parts, tol)
    g = Geo(f'hero__{osm_id}_mesh', {})
    fn(fp, g)
    r = root(osm_id)
    ob = g.build(r)
    zs = [v[2] for v in g.v]
    xs = [v[0] for v in g.v]
    ys = [v[1] for v in g.v]
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'hero {osm_id} {name}: {tris} tris, x {min(xs):.1f}…{max(xs):.1f} (fp {fp.bbox[0]:.1f}…{fp.bbox[2]:.1f}), '
          f'y {min(ys):.1f}…{max(ys):.1f} (fp {fp.bbox[1]:.1f}…{fp.bbox[3]:.1f}), z {max(zs):.1f}')
    manifest['heroes'].append({'id': osm_id, 'ids': [osm_id, *parts], 'name': name, 'height': round(max(zs), 1), 'tris': tris})
    if os.environ.get('HERO_CAMS'):
        # preview camera (scratch only): across the street from the wall that shows most to the route
        def score(e):
            dist, facing = fp.route_near(e)
            return 0 if fp.party(e) else e.L * max(0.0, facing) / (1 + dist / 40)
        e = g.view or max(fp.edges(), key=score)
        dist = min(fp.route_near(e)[0], 35)
        top = max(zs)
        span = max(e.L, 30)
        cams[osm_id] = [*e.at(e.L / 2 - span * 0.55, dist + 18 + span * 0.35, 0)[:2], top * 0.55 + 6, *e.at(e.L / 2, 0, 0)[:2], top * 0.42]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT',
                          export_vertex_color='ACTIVE', export_extras=False, export_lights=False, export_cameras=False,
                          use_selection=False)
with open(os.path.splitext(OUT)[0] + '.json', 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
    f.write('\n')
if os.environ.get('HERO_CAMS'):
    json.dump(cams, open(os.environ['HERO_CAMS'], 'w'))
print(f'heroes: {len(manifest["heroes"])} buildings, {sum(h["tris"] for h in manifest["heroes"])} triangles → {OUT}')
