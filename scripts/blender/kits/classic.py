"""`classic` facade kit: pre-revolution Petersburg / Warsaw tenement and Stalinist plaster facades.

Run (cwd = repo root):
  blender -b --factory-startup -P scripts/blender/kits/classic.py -- src/assets/kits/classic.glb [--preview docs/kits/classic.png]

Builds every module per docs/KITS.md §1–2 (one mesh root `classic__<module>` per module, X along the facade,
Z up, wall plane Y = 0, street at −Y), exports the GLB, writes the manifest next to it and optionally renders the
preview. Modules are triangle soups authored face by face so the triangle budgets stay exact: only faces that
can be seen from the street are emitted, every face is oriented to an explicit outward normal.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

KIT = 'classic'
BAY, FLOOR, GROUND, CAP, CORNER = 3.4, 3.7, 4.4, 1.5, 0.6
BUDGET = {'floor': 90, 'blank': 90, 'ground': 150, 'entrance': 150, 'shop': 150, 'cap': 40, 'corner': 24}

# name: (sRGB hex, roughness, metallic)
MATS = {
    'wall': ('#d9cdb4', 0.92, 0.0),
    'wall2': ('#a09580', 0.9, 0.0),
    'trim': ('#ece7dc', 0.8, 0.0),
    'glass': ('#3b4a57', 0.1, 0.0),
    'frame': ('#e8e6e0', 0.6, 0.0),
    'metal': ('#33373c', 0.55, 0.8),
    'roof': ('#4a4c50', 0.6, 0.3),
    'dark': ('#141416', 1.0, 0.0),
    'sign': ('#2e4a3c', 0.5, 0.0),
}


def linear(hexstr):
    def ch(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(ch(int(hexstr[i:i + 2], 16) / 255) for i in (1, 3, 5)) + (1.0,)


class Part:
    """Triangle soup of one module; every polygon is flipped to face its given outward normal."""

    def __init__(self):
        self.tris = []

    def tri(self, a, b, c, mat, n):
        cr = (b - a).cross(c - a)
        if cr.length < 1e-9:
            return
        if cr.dot(n) < 0:
            b, c = c, b
        self.tris.append((a, b, c, mat))

    def poly(self, pts, mat, n, holes=()):
        n = Vector(n)
        loops = [[Vector(p) for p in pts]] + [[Vector(p) for p in h] for h in holes]
        flat = [v for loop in loops for v in loop]
        if len(flat) == 3:
            idx = [(0, 1, 2)]
        else:
            drop = max(range(3), key=lambda i: abs(n[i]))
            keep = [i for i in range(3) if i != drop]
            idx = tessellate_polygon([[Vector((v[keep[0]], v[keep[1]], 0)) for v in loop] for loop in loops])
        for a, b, c in idx:
            self.tri(flat[a], flat[b], flat[c], mat, n)

    def front(self, x0, x1, z0, z1, y, mat):
        self.poly([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat, (0, -1, 0))

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces='FTBLR'):
        """Axis box; faces: F front (−Y), K back, T top, B bottom, L (−X), R (+X)."""
        if 'F' in faces:
            self.poly([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], mat, (0, -1, 0))
        if 'K' in faces:
            self.poly([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], mat, (0, 1, 0))
        if 'T' in faces:
            self.poly([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat, (0, 0, 1))
        if 'B' in faces:
            self.poly([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], mat, (0, 0, -1))
        if 'L' in faces:
            self.poly([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], mat, (-1, 0, 0))
        if 'R' in faces:
            self.poly([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], mat, (1, 0, 0))

    def prism(self, x0, x1, prof, mats, ends=None):
        """Extrude a (y, z) profile along X. The profile runs bottom → top with the solid on its +Y side;
        mats[i] is the material of segment i (None = no face); ends = material of the two end caps."""
        for i, mat in enumerate(mats):
            (ya, za), (yb, zb) = prof[i], prof[i + 1]
            if mat is None:
                continue
            n = (0, -(zb - za), yb - ya)
            self.poly([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], mat, n)
        if ends:
            self.poly([(x0, y, z) for y, z in prof], ends, (-1, 0, 0))
            self.poly([(x1, y, z) for y, z in prof], ends, (1, 0, 0))

    def wall(self, w, h, holes=(), mat='wall', y=0.0):
        """The plaster plane with rectangular holes (x0, z0, x1, z1)."""
        self.poly([(0, y, 0), (w, y, 0), (w, y, h), (0, y, h)], mat, (0, -1, 0),
                  holes=[[(a, y, b), (c, y, b), (c, y, d), (a, y, d)] for a, b, c, d in holes])


# ---------------------------------------------------------------- window parts

SW = 0.16    # architrave (surround) band width
SD = -0.07   # architrave front plane
YG = 0.2     # glass plane: reveal depth behind the wall


def band(p, w=BAY):
    """Inter-floor string course at the foot of a floor module."""
    p.prism(0, w, [(0, 0), (-0.08, 0), (-0.08, 0.13), (0, 0.19)], ['wall', 'wall', 'wall'])


def surround(p, x0, x1, z0, z1, bevel=False):
    """U-shaped profiled architrave: jambs + head around the opening. Returns the outer top."""
    zt = z1 + SW
    if bevel:
        p.poly([(x0 - SW, 0, z0), (x0, SD, z0), (x0, SD, z1), (x0 - SW, 0, zt)], 'trim', (-1, -1, 0))
        p.poly([(x1, SD, z0), (x1 + SW, 0, z0), (x1 + SW, 0, zt), (x1, SD, z1)], 'trim', (1, -1, 0))
        p.poly([(x0, SD, z1), (x1, SD, z1), (x1 + SW, 0, zt), (x0 - SW, 0, zt)], 'trim', (0, -1, 1))
        return zt
    p.poly([(x0 - SW, SD, z0), (x0, SD, z0), (x0, SD, z1), (x1, SD, z1), (x1, SD, z0), (x1 + SW, SD, z0),
            (x1 + SW, SD, zt), (x0 - SW, SD, zt)], 'trim', (0, -1, 0))
    p.box(x0 - SW, x1 + SW, SD, 0, z0, zt, 'trim', 'LR')
    return zt


def reveal(p, x0, x1, z0, z1, yf, yg=YG, bottom=True, bottom_from=0.0, mat='wall'):
    """Jambs, head and (optionally) the window board of an opening, from the front plane yf back to the glass."""
    p.poly([(x0, yf, z0), (x0, yg, z0), (x0, yg, z1), (x0, yf, z1)], mat, (1, 0, 0))
    p.poly([(x1, yf, z0), (x1, yg, z0), (x1, yg, z1), (x1, yf, z1)], mat, (-1, 0, 0))
    p.poly([(x0, yf, z1), (x1, yf, z1), (x1, yg, z1), (x0, yg, z1)], mat, (0, 0, -1))
    if bottom:
        p.poly([(x0, bottom_from, z0), (x1, bottom_from, z0), (x1, yg, z0), (x0, yg, z0)], 'trim', (0, 0, 1))


def glazing(p, x0, x1, z0, z1, zs, cols=2, yg=YG, tcols=1, fw=0.07, mw=0.06):
    """Frame plane at the glass depth with glass panes 3 cm in front of it: `cols` sashes below the transom zs,
    `tcols` panes above it; the frame shows through the gaps as mullions."""
    p.front(x0, x1, z0, z1, yg, 'frame')
    yp = yg - 0.03

    def row(za, zb, n):
        span = (x1 - x0 - 2 * fw - (n - 1) * mw) / n
        for i in range(n):
            a = x0 + fw + i * (span + mw)
            p.front(a, a + span, za, zb, yp, 'glass')
    row(z0 + fw, zs - mw / 2, cols)
    if zs < z1:
        row(zs + mw / 2, z1 - fw, tcols)


def sill(p, x0, x1, z, depth=0.22, th=0.1):
    p.box(x0, x1, -depth, 0, z - th, z, 'trim', 'FTBLR')


def console(p, xc, w, z, depth, h, mat='trim'):
    """Wedge bracket under a slab: top edge `depth` deep at z, tapering to the wall at z − h."""
    a, b = xc - w / 2, xc + w / 2
    p.poly([(a, -depth, z), (b, -depth, z), (b, 0, z - h), (a, 0, z - h)], mat, (0, -h, -depth))
    p.poly([(a, 0, z), (a, -depth, z), (a, 0, z - h)], mat, (-1, 0, 0))
    p.poly([(b, 0, z), (b, -depth, z), (b, 0, z - h)], mat, (1, 0, 0))


def keystone(p, xc, z0, z1, w=0.22, y0=-0.13, y1=SD):
    p.box(xc - w / 2, xc + w / 2, y0, y1, z0, z1, 'trim', 'FLRB')


def hood(p, x0, x1, z0, depth=0.24, h=0.26):
    """Straight window cornice (сандрик) with a sloped top."""
    p.prism(x0, x1, [(0, z0), (-depth, z0), (-depth, z0 + h * 0.45), (0, z0 + h)], ['trim', 'trim', 'trim'],
            ends='trim')


def pediment_base(p, x0, x1, z0, depth=0.22, h=0.11):
    """Horizontal cornice a pediment stands on."""
    p.prism(x0, x1, [(0, z0), (-depth, z0), (-depth, z0 + h), (0, z0 + h)], ['trim', 'trim', 'trim'], ends='trim')
    return z0 + h


def pediment_tri(p, x0, x1, z0, rise, depth=0.22, t=0.13, ty=-0.08):
    """Triangular pediment: tympanum at ty under two raking cornices (front, soffit, top, outer end)."""
    xc, za = (x0 + x1) / 2, z0 + rise
    p.poly([(x0, ty, z0), (x1, ty, z0), (xc, ty, za)], 'trim', (0, -1, 0))
    for xe, s in ((x0, -1), (x1, 1)):
        run = abs(xc - xe)
        tv = t * math.hypot(run, rise) / run            # vertical thickness of the sloped slab
        up = Vector((s * rise, 0, run)).normalized()    # normal of the top, up and outwards
        p.poly([(xe, -depth, z0), (xc, -depth, za), (xc, -depth, za + tv), (xe, -depth, z0 + tv)], 'trim',
               (0, -1, 0))
        p.poly([(xe, -depth, z0), (xc, -depth, za), (xc, ty, za), (xe, ty, z0)], 'trim', -up)
        p.poly([(xe, -depth, z0 + tv), (xc, -depth, za + tv), (xc, 0, za + tv), (xe, 0, z0 + tv)], 'roof', up)
        p.poly([(xe, 0, z0), (xe, -depth, z0), (xe, -depth, z0 + tv), (xe, 0, z0 + tv)], 'trim', (s, 0, 0))


def pediment_seg(p, x0, x1, z0, rise, n=4, depth=0.22, t=0.13, ty=-0.08):
    """Segmental pediment: an arc slab (front, soffit, ends) over an arc-shaped tympanum."""
    xc, half = (x0 + x1) / 2, (x1 - x0) / 2
    r = (half * half + rise * rise) / (2 * rise)
    zc = z0 + rise - r
    a0 = math.asin(half / r)
    ang = [-a0 + 2 * a0 * i / n for i in range(n + 1)]
    lo = [(xc + r * math.sin(a), zc + r * math.cos(a)) for a in ang]
    hi = [(xc + (r + t) * math.sin(a), zc + (r + t) * math.cos(a)) for a in ang]
    p.poly([(x, ty, z) for x, z in lo], 'trim', (0, -1, 0))
    for i in range(n):
        (xa, za), (xb, zb) = lo[i], lo[i + 1]
        (xa2, za2), (xb2, zb2) = hi[i], hi[i + 1]
        am = (ang[i] + ang[i + 1]) / 2
        out = Vector((math.sin(am), 0, math.cos(am)))
        p.poly([(xa, -depth, za), (xb, -depth, zb), (xb2, -depth, zb2), (xa2, -depth, za2)], 'trim', (0, -1, 0))
        p.poly([(xa, -depth, za), (xb, -depth, zb), (xb, ty, zb), (xa, ty, za)], 'trim', -out)
    for (xl, zl), (xh, zh), s in ((lo[0], hi[0], -1), (lo[-1], hi[-1], 1)):
        p.poly([(xl, 0, zl), (xl, -depth, zl), (xh, -depth, zh), (xh, 0, zh)], 'trim', (s, 0, 0))


# ---------------------------------------------------------------- rustication

RD, RG = 0.04, 0.05                                # course front depth, joint chamfer height
JOINTS = [round(0.7 + 0.55 * i, 3) for i in range(7)]   # ground floor: plinth top 0.7 … string course 4.0


def edge(x):
    return lambda zb, zt: [(x, zb), (x, zt)]


def arch_edge(cx, rm, zc, side, key=0.0, n=2):
    """Course end following the mid radius rm of an archivolt (so the archivolt hides it), clamped to the
    keystone half-width near the crown."""
    def path(zb, zt):
        pts = []
        for i in range(n + 1):
            z = zb + (zt - zb) * i / n
            off = math.sqrt(max(rm * rm - (z - zc) ** 2, 0.0))
            pts.append((cx + side * max(off, key), z))
        return pts
    return path


def course(p, z0, z1, left, right, mat='wall'):
    """One rusticated course between joints z0 and z1 with V joints; left/right build the end paths."""
    zb, zt = z0 + RG, z1 - RG
    lp, rp = left(zb, zt), right(zb, zt)
    p.poly([(x, -RD, z) for x, z in [lp[0]] + rp + lp[:0:-1]], mat, (0, -1, 0))
    p.poly([(lp[0][0], 0, z0), (rp[0][0], 0, z0), (rp[0][0], -RD, zb), (lp[0][0], -RD, zb)], mat, (0, -1, -1))
    p.poly([(lp[-1][0], -RD, zt), (rp[-1][0], -RD, zt), (rp[-1][0], 0, z1), (lp[-1][0], 0, z1)], mat, (0, -1, 1))


def plinth(p, x0=0.0, x1=BAY):
    p.prism(x0, x1, [(-0.1, 0), (-0.1, 0.7), (0, 0.7)], ['wall2', 'wall2'])


def string_course(p, w=BAY):
    """Cornice band over the ground floor, 4.0 … 4.4."""
    p.prism(0, w, [(0, 4.0), (-0.17, 4.0), (-0.17, 4.2), (0, 4.4)], ['trim', 'trim', 'trim'])


def archivolt(p, cx, r_in, r_out, zc, n=6, yi=-0.12, yo=-RD):
    """Bevelled arch ring (inner edge proud at yi, outer edge on the course front yo)."""
    for i in range(n):
        a, b = math.pi * i / n, math.pi * (i + 1) / n
        pa_i = (cx + r_in * math.cos(a), yi, zc + r_in * math.sin(a))
        pb_i = (cx + r_in * math.cos(b), yi, zc + r_in * math.sin(b))
        pa_o = (cx + r_out * math.cos(a), yo, zc + r_out * math.sin(a))
        pb_o = (cx + r_out * math.cos(b), yo, zc + r_out * math.sin(b))
        m = (a + b) / 2
        p.poly([pa_i, pb_i, pb_o, pa_o], 'trim', (0.4 * math.cos(m), -1, 0.4 * math.sin(m)))


def arch_soffit(p, cx, r, zc, yf, yb, n=6, mat='wall'):
    for i in range(n):
        a, b = math.pi * i / n, math.pi * (i + 1) / n
        m = (a + b) / 2
        pa, pb = (cx + r * math.cos(a), zc + r * math.sin(a)), (cx + r * math.cos(b), zc + r * math.sin(b))
        p.poly([(pa[0], yf, pa[1]), (pb[0], yf, pb[1]), (pb[0], yb, pb[1]), (pa[0], yb, pa[1])], mat,
               (-math.cos(m), 0, -math.sin(m)))


def check_arch_cut(name, path, zb, zt, cx, r_in, r_out, zc, key, key_z0):
    """Warn when a course end is not hidden under the archivolt or the keystone."""
    pts = path(zb, zt)
    for (xa, za), (xb, zb_) in zip(pts, pts[1:]):
        for k in range(11):
            x, z = xa + (xb - xa) * k / 10, za + (zb_ - za) * k / 10
            rr = math.hypot(x - cx, z - zc)
            if not (r_in + 0.01 <= rr <= r_out - 0.01 or (abs(x - cx) <= key and z >= key_z0)):
                print(f'WARN {name}: course end ({x:.3f}, {z:.3f}) r={rr:.3f} not covered')


# ---------------------------------------------------------------- floor modules (3.4 × 3.7)

WX0, WX1, WZ0, WZ1, WTR = 0.975, 2.425, 0.85, 2.95, 2.3   # typical window opening and its transom


def window(p, z0=WZ0, bevel=False, board=True, sill_consoles=True):
    """Wall with a window/door opening in a profiled architrave; returns the architrave top."""
    p.wall(BAY, FLOOR, [(WX0 - SW, z0, WX1 + SW, WZ1 + SW)])
    zt = surround(p, WX0, WX1, z0, WZ1, bevel=bevel)
    reveal(p, WX0, WX1, z0, WZ1, SD, bottom=board)
    glazing(p, WX0, WX1, z0, WZ1, WTR)
    if sill_consoles:
        sill(p, WX0 - SW - 0.1, WX1 + SW + 0.1, z0)
        for xc in (WX0 - SW / 2, WX1 + SW / 2):
            console(p, xc, 0.12, z0 - 0.1, 0.18, 0.3)
    return zt


def m_win():
    p = Part()
    band(p)
    zt = window(p)
    keystone(p, BAY / 2, WZ1 - 0.14, zt)
    hood(p, WX0 - SW - 0.14, WX1 + SW + 0.14, zt)
    return p


def m_win_ped():
    p = Part()
    band(p)
    zt = window(p)
    zb = pediment_base(p, WX0 - SW - 0.12, WX1 + SW + 0.12, zt)
    pediment_tri(p, WX0 - SW - 0.06, WX1 + SW + 0.06, zb, 0.33, t=0.12)
    return p


def m_win_seg():
    p = Part()
    band(p)
    zt = window(p, board=False)
    zb = pediment_base(p, WX0 - SW - 0.12, WX1 + SW + 0.12, zt)
    pediment_seg(p, WX0 - SW - 0.06, WX1 + SW + 0.06, zb, 0.3, t=0.12)
    return p


def railing(p, x0, x1, y, z0, z1, posts=7, bar=0.03, foot=0.16, rail=0.06):
    """Wrought-iron railing: a solid ornamental foot band, a handrail and bars on the front plane; the sides are
    foot band + handrail back to the wall, seen from both sides."""
    bands = [(z0, z0 + foot), (z1 - rail, z1)]
    for za, zb in bands:
        p.front(x0, x1, za, zb, y, 'metal')
    for i in range(posts):
        xa = x0 + (x1 - x0 - bar) * i / (posts - 1)
        p.front(xa, xa + bar, z0 + foot, z1 - rail, y, 'metal')
    for xs in (x0, x1):
        for s in (-1, 1):
            x = xs + s * 0.005
            for za, zb in bands:
                p.poly([(x, y, za), (x, -0.02, za), (x, -0.02, zb), (x, y, zb)], 'metal', (s, 0, 0))


def m_win_balcony():
    p = Part()
    dz = 0.45                                           # door threshold = balcony floor
    zt = window(p, z0=dz, bevel=True, board=False, sill_consoles=False)
    hood(p, WX0 - SW - 0.14, WX1 + SW + 0.14, zt)
    bx0, bx1, by = 0.55, 2.85, -0.8
    p.box(bx0, bx1, by, 0, 0.3, dz, 'trim', 'FTBLR')
    for xc in (0.8, 2.6):
        console(p, xc, 0.14, 0.3, 0.62, 0.28)
    railing(p, bx0 + 0.04, bx1 - 0.04, by + 0.04, dz, dz + 0.95)
    return p


def m_pilaster():
    """Pier bay: a pilaster on the bay axis between two recessed blind-window niches."""
    p = Part()
    niches = [(0.38, WZ0, 1.12, WZ1), (2.28, WZ0, 3.02, WZ1)]
    p.wall(BAY, FLOOR, niches)
    band(p)
    for a, z0, b, z1 in niches:
        p.front(a, b, z0, z1, 0.08, 'wall2')
        reveal(p, a, b, z0, z1, 0, yg=0.08, bottom=False)
        p.poly([(a, 0, z0), (b, 0, z0), (b, 0.08, z0), (a, 0.08, z0)], 'wall', (0, 0, 1))
    cx, hw = BAY / 2, 0.34
    p.box(cx - hw, cx + hw, -0.15, 0, 0, FLOOR, 'wall', 'FLR')
    p.box(cx - hw - 0.06, cx + hw + 0.06, -0.21, 0, 0, 0.34, 'trim', 'FTLR')
    p.box(cx - hw - 0.03, cx + hw + 0.03, -0.18, 0, 3.18, 3.38, 'trim', 'FBLR')
    p.box(cx - hw - 0.1, cx + hw + 0.1, -0.25, 0, 3.38, 3.54, 'trim', 'FTBLR')
    return p


def m_blank():
    p = Part()
    band(p)
    j = [0.19 + (FLOOR - 0.19) * i / 6 for i in range(7)]
    for z0, z1 in zip(j, j[1:]):
        course(p, z0, z1, edge(0), edge(BAY))
    return p


# ---------------------------------------------------------------- ground-floor modules (3.4 × 4.4)

def full_course(p, i):
    course(p, JOINTS[i], JOINTS[i + 1], edge(0), edge(BAY))


def pier_courses(p, i0, i1, xl, xr):
    """Courses i0 … i1−1 cut by a straight opening xl … xr (the opening reveal closes the course ends)."""
    for a, b in zip(JOINTS[i0:i1], JOINTS[i0 + 1:i1 + 1]):
        course(p, a, b, edge(0), edge(xl))
        course(p, a, b, edge(xr), edge(BAY))


def arch_courses(p, name, i0, i1, cx, r_in, r_out, zc, key, segs):
    """Courses i0 … i1−1 cut along the archivolt mid radius, the top one clamped to the keystone."""
    rm = (r_in + r_out) / 2
    for i, n in zip(range(i0, i1), segs):
        a, b = JOINTS[i], JOINTS[i + 1]
        left, right = arch_edge(cx, rm, zc, -1, key - 0.03, n), arch_edge(cx, rm, zc, 1, key - 0.03, n)
        check_arch_cut(name, left, a + RG, b - RG, cx, r_in, r_out, zc, key, zc + r_in - 0.15)
        course(p, a, b, edge(0), left)
        course(p, a, b, right, edge(BAY))


def arch_opening(p, cx, r, zc, z0, yb, jamb_y=-RD, soffit_mat='wall', r_out=None, yi=-0.12):
    """Jambs below the springing, the arch soffit and the caps closing the archivolt at the springing."""
    for x, s in ((cx - r, 1), (cx + r, -1)):
        p.poly([(x, jamb_y, z0), (x, yb, z0), (x, yb, zc), (x, jamb_y, zc)], soffit_mat, (s, 0, 0))
        xo = x - s * (r_out - r)
        p.poly([(x, yi, zc), (xo, -RD, zc), (xo, 0, zc), (x, 0, zc)], 'trim', (0, 0, -1))
    arch_soffit(p, cx, r, zc, yi, yb, mat=soffit_mat)


def m_g_rustic():
    p = Part()
    x0, x1, z0, z1 = 1.0, 2.4, JOINTS[1], JOINTS[5]
    plinth(p)
    full_course(p, 0)
    pier_courses(p, 1, 5, x0, x1)
    full_course(p, 5)
    string_course(p)
    reveal(p, x0, x1, z0, z1, -RD, yg=0.22)
    glazing(p, x0, x1, z0, z1, 2.75, yg=0.22)
    sill(p, x0 - 0.1, x1 + 0.1, z0, depth=0.2, th=0.12)
    # flat arch of splayed voussoirs under the keystone
    lz0, lz1, ly = z1, JOINTS[6], -0.08
    p.poly([(x0 - 0.06, ly, lz0), (x1 + 0.06, ly, lz0), (x1 + 0.3, ly, lz1), (x0 - 0.3, ly, lz1)], 'wall', (0, -1, 0))
    p.poly([(x0 - 0.06, ly, lz0), (x1 + 0.06, ly, lz0), (x1 + 0.06, -RD, lz0), (x0 - 0.06, -RD, lz0)], 'wall',
           (0, 0, -1))
    p.poly([(x0 - 0.06, ly, lz0), (x0 - 0.3, ly, lz1), (x0 - 0.3, -RD, lz1), (x0 - 0.06, -RD, lz0)], 'wall',
           (-(lz1 - lz0), 0, -0.24))
    p.poly([(x1 + 0.06, ly, lz0), (x1 + 0.3, ly, lz1), (x1 + 0.3, -RD, lz1), (x1 + 0.06, -RD, lz0)], 'wall',
           ((lz1 - lz0), 0, -0.24))
    keystone(p, BAY / 2, z1 - 0.15, JOINTS[6], w=0.26, y0=-0.14, y1=-RD)
    return p


def m_g_rustic2():
    p = Part()
    cx, r, r_out, zc, key = BAY / 2, 0.7, 0.92, JOINTS[4], 0.13
    z0 = JOINTS[1]
    plinth(p)
    full_course(p, 0)
    pier_courses(p, 1, 4, cx - r, cx + r)
    arch_courses(p, 'g_rustic2', 4, 6, cx, r, r_out, zc, key, (1, 2))
    string_course(p)
    archivolt(p, cx, r, r_out, zc)
    arch_opening(p, cx, r, zc, z0, 0.22, r_out=r_out)
    p.poly([(cx - r, 0, z0), (cx + r, 0, z0), (cx + r, 0.22, z0), (cx - r, 0.22, z0)], 'trim', (0, 0, 1))
    p.front(cx - r, cx + r, z0, zc + r, 0.22, 'frame')
    for a, b in ((cx - r + 0.07, cx - 0.03), (cx + 0.03, cx + r - 0.07)):
        p.front(a, b, z0 + 0.07, zc - 0.03, 0.19, 'glass')
    rp = r - 0.07
    p.poly([(cx + rp * math.cos(a), 0.19, zc + 0.03 + (rp - 0.03) * math.sin(a))
            for a in (0, math.pi / 4, math.pi / 2, 3 * math.pi / 4, math.pi)], 'glass', (0, -1, 0))
    sill(p, cx - r - 0.1, cx + r + 0.1, z0, depth=0.2, th=0.12)
    keystone(p, cx, zc + r - 0.1, JOINTS[6], w=2 * key, y0=-0.17, y1=-RD)
    return p


def m_g_gate():
    p = Part()
    cx, r, r_out, zc, key = BAY / 2, 1.2, 1.45, JOINTS[3], 0.15
    yb = 0.45
    plinth(p, 0, cx - r)
    plinth(p, cx + r, BAY)
    pier_courses(p, 0, 3, cx - r, cx + r)
    arch_courses(p, 'g_gate', 3, 6, cx, r, r_out, zc, key, (1, 1, 2))
    string_course(p)
    archivolt(p, cx, r, r_out, zc, yi=-0.13)
    for x, s in ((cx - r, 1), (cx + r, -1)):          # plinth-height part of the jambs
        p.poly([(x, -0.1, 0), (x, yb, 0), (x, yb, 0.7), (x, -0.1, 0.7)], 'wall2', (s, 0, 0))
    arch_opening(p, cx, r, zc, JOINTS[0], yb, soffit_mat='wall2', r_out=r_out, yi=-0.13)
    p.front(cx - r, cx + r, 0, zc + r, yb, 'dark')
    for a, b in ((cx - r + 0.1, cx - 0.02), (cx + 0.02, cx + r - 0.1)):   # iron gate leaves
        p.front(a, b, 0, zc - 0.1, yb - 0.04, 'metal')
    for ang in (math.pi / 4, math.pi / 2, 3 * math.pi / 4):             # fanlight grille bars
        c, s = math.cos(ang), math.sin(ang)
        w = 0.025
        p.poly([(cx - s * w, yb - 0.04, zc + c * w), (cx + s * w, yb - 0.04, zc - c * w),
                (cx + (r - 0.05) * c + s * w, yb - 0.04, zc + (r - 0.05) * s - c * w),
                (cx + (r - 0.05) * c - s * w, yb - 0.04, zc + (r - 0.05) * s + c * w)], 'metal', (0, -1, 0))
    keystone(p, cx, zc + r - 0.12, JOINTS[6], w=2 * key, y0=-0.2, y1=-RD)
    return p


def awning(p, x0, x1, zt, zf, yf, valance=0.2, yt=-0.05):
    """Canvas awning sloping from the wall (zt) to the street edge (yf, zf), with valance and iron arms."""
    up = (0, zf - zt, -(yf - yt))
    p.poly([(x0, yt, zt), (x1, yt, zt), (x1, yf, zf), (x0, yf, zf)], 'wall2', up)
    p.poly([(x0, yt, zt - 0.02), (x1, yt, zt - 0.02), (x1, yf, zf - 0.02), (x0, yf, zf - 0.02)], 'wall2',
           tuple(-v for v in up))
    p.front(x0, x1, zf - valance, zf, yf, 'wall2')
    for x, s in ((x0, -1), (x1, 1)):
        p.poly([(x, yt, zt), (x, yf, zf), (x, yf, zf - valance)], 'wall2', (s, 0, 0))
        xa = x - s * 0.03                                 # folding arm from the wall up to the valance
        za = zf - 0.42
        for side in (-1, 1):
            xb = xa + side * 0.012
            p.poly([(xb, 0, za), (xb, yf + 0.05, zf - valance), (xb, yf + 0.05, zf - valance + 0.05),
                    (xb, 0, za + 0.05)], 'metal', (side, 0, 0))
        p.poly([(xa - 0.025, 0, za), (xa + 0.025, 0, za), (xa + 0.025, yf + 0.05, zf - valance),
                (xa - 0.025, yf + 0.05, zf - valance)], 'metal', (0, -0.5, -1))


def m_g_shop():
    p = Part()
    x0, x1, z0, z1 = 0.35, BAY - 0.35, JOINTS[0], JOINTS[5]
    plinth(p)
    pier_courses(p, 0, 5, x0, x1)
    full_course(p, 5)
    string_course(p)
    reveal(p, x0, x1, z0, z1, -RD, yg=0.16)
    glazing(p, x0, x1, z0, z1, 2.75, cols=3, yg=0.16, tcols=3, fw=0.08, mw=0.08)
    p.box(0.3, BAY - 0.3, -0.12, -RD, 3.5, 3.95, 'sign', 'FTBLR')
    awning(p, 0.42, BAY - 0.42, 3.42, 2.8, -1.0)
    return p


# ---------------------------------------------------------------- cap (3.4 × 1.5) and corner (0.6 × 3.7)

def m_cap():
    """Full entablature: two-fascia architrave, plaster frieze, bed moulding, modillions, corona, zinc slope.
    The end plates close the cornice silhouette at a wall end and read as a bracket at every bay joint."""
    p = Part()
    prof = [(0, 0), (-0.05, 0), (-0.05, 0.1), (-0.09, 0.1), (-0.09, 0.22), (0, 0.27), (0, 0.8), (-0.16, 0.8),
            (-0.16, 1.0), (-0.95, 1.0), (-0.95, 1.22), (0, CAP)]
    p.prism(0, BAY, prof, ['trim', 'trim', 'trim', 'trim', 'trim', 'wall', 'trim', 'trim', 'trim', 'trim', 'roof'])
    for x, s in ((0, -1), (BAY, 1)):
        p.poly([(x, 0, 0.8), (x, -0.95, 1.0), (x, -0.95, 1.22), (x, 0, CAP)], 'trim', (s, 0, 0))
    for i in (1, 2, 3):
        console(p, BAY * i / 4, 0.14, 1.0, 0.75, 0.2)
    return p


def m_cap_attic():
    """Lighter cornice under an attic balustrade: pedestal, balusters over a dark void, coping."""
    p = Part()
    prof = [(0, 0), (-0.12, 0.2), (-0.6, 0.2), (-0.6, 0.36), (-0.1, 0.5), (-0.1, 0.72), (0.08, 0.72), (0.08, 1.28),
            (-0.14, 1.4), (0, CAP)]
    p.prism(0, BAY, prof, ['trim', 'trim', 'trim', 'roof', 'wall', 'wall', 'dark', 'trim', 'roof'])
    for x, s in ((0, -1), (BAY, 1)):
        p.poly([(x, 0, 0), (x, -0.6, 0.2), (x, -0.6, 0.36), (x, -0.1, 0.5), (x, 0, 0.5)], 'trim', (s, 0, 0))
    posts = [(0, 0.16), (BAY - 0.16, BAY)]
    for i in range(6):
        xc = 0.16 + (BAY - 0.32) * (i + 0.5) / 6
        posts.append((xc - 0.07, xc + 0.07))
    top = 1.28 + 0.12 * (0.08 + 0.06) / 0.22 + 0.01     # sloped coping underside above the post plane y = −0.06
    for a, b in posts:
        p.front(a, b, 0.72, top, -0.06, 'trim')
    return p


def m_corner():
    """Quoins: alternately deep and shallow rusticated blocks."""
    p = Part()
    p.box(0, CORNER, -0.08, 0, 0, 1.22, 'wall', 'FLRBT')
    p.box(0, CORNER, -0.045, 0, 1.22, 2.46, 'wall', 'FLR')
    p.box(0, CORNER, -0.08, 0, 2.46, FLOOR, 'wall', 'FLRB')
    return p


# ---------------------------------------------------------------- build + export

MODULES = [  # name, builder, role, weight
    ('win', m_win, 'floor', 4),
    ('win_ped', m_win_ped, 'floor', 2),
    ('win_seg', m_win_seg, 'floor', 2),
    ('win_balcony', m_win_balcony, 'floor', 1),
    ('pilaster', m_pilaster, 'floor', 1),
    ('blank', m_blank, 'blank', 1),
    ('g_rustic', m_g_rustic, 'ground', 3),
    ('g_rustic2', m_g_rustic2, 'ground', 2),
    ('g_gate', m_g_gate, 'entrance', 1),
    ('g_shop', m_g_shop, 'shop', 1),
    ('cap', m_cap, 'cap', 3),
    ('cap_attic', m_cap_attic, 'cap', 1),
    ('corner', m_corner, 'corner', 1),
]
SIZE = {'floor': (BAY, FLOOR), 'blank': (BAY, FLOOR), 'ground': (BAY, GROUND), 'entrance': (BAY, GROUND),
        'shop': (BAY, GROUND), 'cap': (BAY, CAP), 'corner': (CORNER, FLOOR)}


def make_materials():
    out = {}
    for name, (hexc, rough, metal) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = linear(hexc)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        m.diffuse_color = linear(hexc)          # Workbench preview colour
        m.roughness, m.metallic = rough, metal
        out[name] = m
    return out


def to_object(name, part, mats):
    order = [m for m in MATS if any(t[3] == m for t in part.tris)]
    verts, faces, idx = [], [], []
    for a, b, c, mat in part.tris:
        i = len(verts)
        verts += [tuple(round(v, 5) for v in q) for q in (a, b, c)]
        faces.append((i, i + 1, i + 2))
        idx.append(order.index(mat))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in order:
        me.materials.append(mats[m])
    me.polygons.foreach_set('material_index', idx)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    me.shade_flat()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    manifest = {'kit': KIT, 'bay': BAY, 'floor': FLOOR, 'ground': GROUND, 'cap': CAP, 'corner': CORNER, 'modules': {}}
    objs, ok = {}, True
    for name, builder, role, weight in MODULES:
        ob = to_object(f'{KIT}__{name}', builder(), mats)
        objs[name] = ob
        me = ob.data
        tris = sum(len(poly.vertices) - 2 for poly in me.polygons)
        w, h = SIZE[role]
        xs, ys, zs = ([v.co[i] for v in me.vertices] for i in range(3))
        bbox = (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
        inside = bbox[0] >= -1e-4 and bbox[1] <= w + 1e-4 and bbox[2] >= -1.6 and bbox[3] <= 0.45 and \
            bbox[4] >= -1e-4 and bbox[5] <= h + 1e-4
        flag = '' if tris <= BUDGET[role] and inside else '   <-- FAIL'
        ok = ok and not flag
        print(f'MODULE {name:12s} {role:9s} {w}x{h} tris={tris:3d}/{BUDGET[role]} '
              f'bbox=({", ".join(f"{v:.2f}" for v in bbox)}){flag}')
        manifest['modules'][name] = {'w': w, 'h': h, 'role': role, 'weight': weight, 'tris': tris}
    for m in list(bpy.data.materials):
        if m.name not in MATS:
            bpy.data.materials.remove(m)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True,
                              export_materials='EXPORT', use_selection=False)
    with open(os.path.splitext(out)[0] + '.json', 'w') as f:
        f.write(json.dumps(manifest, indent=2) + '\n')
    print(f'EXPORTED {out} ({os.path.getsize(out)} bytes) budgets+bounds {"OK" if ok else "FAILED"}')
    return objs


# ---------------------------------------------------------------- preview

FACADE = {   # 8-bay tenement: ground, floors bottom → top, caps
    'ground': ['g_shop', 'g_rustic2', 'g_rustic', 'g_gate', 'g_rustic', 'g_rustic2', 'g_shop', 'g_rustic'],
    'floors': [['win_ped', 'win_ped', 'pilaster', 'win_balcony', 'win_balcony', 'pilaster', 'win_ped', 'win_ped'],
               ['win_seg', 'win_seg', 'pilaster', 'win', 'win', 'pilaster', 'win_seg', 'win_seg'],
               ['win', 'win', 'pilaster', 'win_balcony', 'win_balcony', 'pilaster', 'win', 'win'],
               ['win', 'win', 'pilaster', 'win', 'win', 'pilaster', 'win', 'win']],
    'caps': ['cap', 'cap', 'cap_attic', 'cap_attic', 'cap_attic', 'cap_attic', 'cap', 'cap'],
}
RETURN = {   # 2-bay side wall meeting the facade at its left corner
    'ground': ['g_rustic', 'g_rustic2'],
    'floors': [['win', 'win_ped'], ['win', 'win_seg'], ['win', 'win'], ['blank', 'win']],
    'caps': ['cap', 'cap'],
}


def render_preview(objs, path):
    import numpy as np
    sc = bpy.context.scene
    scratch = '/mnt/ramdisk/kits-classic'
    os.makedirs(scratch, exist_ok=True)
    for ob in objs.values():
        ob.hide_render = True
    groups = {'a': [], 'b': []}

    def place(g, name, x, y, z, rot=0.0, sx=1.0, sz=1.0):
        ob = bpy.data.objects.new(f'preview_{g}{len(groups[g])}', objs[name].data)
        ob.location, ob.rotation_euler, ob.scale = (x, y, z), (0, 0, rot), (sx, 1, sz)
        sc.collection.objects.link(ob)
        groups[g].append(ob)

    def lay(g, ox, oy, rot, spec, corners=True):
        """Lay a wall the way the game does: corner strips at both ends, bays, caps stretched over the corners."""
        c, s = math.cos(rot), math.sin(rot)
        n, u0 = len(spec['ground']), CORNER if corners else 0.0

        def put(name, u, z, sx=1.0, sz=1.0):
            place(g, name, ox + u * c, oy + u * s, z, rot, sx, sz)
        if corners:
            for u in (0.0, u0 + n * BAY):
                put('corner', u, 0, sz=GROUND / FLOOR)
                for f in range(len(spec['floors'])):
                    put('corner', u, GROUND + f * FLOOR)
        for i, name in enumerate(spec['ground']):
            put(name, u0 + i * BAY, 0)
        for f, row in enumerate(spec['floors']):
            for i, name in enumerate(row):
                put(name, u0 + i * BAY, GROUND + f * FLOOR)
        ztop = GROUND + len(spec['floors']) * FLOOR
        for i, name in enumerate(spec.get('caps', [])):
            u, sx = u0 + i * BAY, 1.0
            if corners and i == 0:
                u, sx = 0.0, (BAY + CORNER) / BAY
            elif corners and i == n - 1:
                sx = (BAY + CORNER) / BAY
            put(name, u, ztop, sx=sx)

    lay('a', 0, 0, 0, FACADE)
    depth = 2 * BAY + 2 * CORNER
    lay('a', 0, depth, -math.pi / 2, RETURN)
    lay('b', 200, 0, 0, {'ground': ['g_rustic2', 'g_shop'], 'floors': [['win_balcony', 'win_ped']]}, corners=False)

    ground = bpy.data.meshes.new('preview_ground')
    ground.from_pydata([(-60, -60, -0.01), (260, -60, -0.01), (260, 40, -0.01), (-60, 40, -0.01)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new('preview_ground')
    ground.materials.append(gm)
    sc.collection.objects.link(bpy.data.objects.new('preview_ground', ground))

    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = linear('#6f7174')
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95

    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = -0.35
    sun = bpy.data.lights.new('preview_sun', 'SUN')
    sun.energy, sun.angle = 3.2, math.radians(1.0)
    sun_ob = bpy.data.objects.new('preview_sun', sun)
    sc.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = Vector((-0.62, -0.42, 0.66)).to_track_quat('Z', 'Y').to_euler()   # from front-left
    world = bpy.data.worlds.new('preview')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = linear('#a9bdd2')
    bg.inputs['Strength'].default_value = 0.55
    sc.world = world

    def shot(g, res, cam, target, lens):
        for k, obs in groups.items():
            for ob in obs:
                ob.hide_render = k != g
        data = bpy.data.cameras.new(f'cam_{g}')
        data.lens = lens
        ob = bpy.data.objects.new(f'cam_{g}', data)
        sc.collection.objects.link(ob)
        ob.location = cam
        ob.rotation_euler = (Vector(target) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()
        sc.camera = ob
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = f'{scratch}/view_{g}.png'
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(sc.render.filepath)
        px = np.empty(res[0] * res[1] * 4, np.float32)
        im.pixels.foreach_get(px)
        return px.reshape(res[1], res[0], 4)

    wa = 856
    a = shot('a', (wa, 720), (-12.0, -35.0, 5.0), (12.6, 0, 10.6), 40)
    b = shot('b', (1280 - wa - 4, 720), (200 - 3.6, -7.6, 2.4), (200 + 3.4, 0, 4.2), 28)
    out = np.zeros((720, 1280, 4), np.float32)
    t = np.linspace(0, 1, 720, dtype=np.float32)[:, None, None]          # row 0 = bottom of the image
    sky = (1 - t) * np.array([0.86, 0.89, 0.92, 1]) + t * np.array([0.56, 0.68, 0.82, 1])
    out[:] = sky
    out[:, wa:wa + 4, :3] = 0.15
    for img, x0, x1 in ((a, 0, wa), (b, wa + 4, 1280)):
        al = img[..., 3:4]
        out[:, x0:x1, :3] = img[..., :3] * al + sky[:, :, :3] * (1 - al)
    img = bpy.data.images.new('preview', 1280, 720)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = os.path.abspath(path)
    img.file_format = 'PNG'
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img.save()
    print(f'PREVIEW {path}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0] if argv and not argv[0].startswith('--') else 'src/assets/kits/classic.glb'
    objs = build(out)
    if '--preview' in argv:
        render_preview(objs, argv[argv.index('--preview') + 1])


if __name__ == '__main__':
    main()
