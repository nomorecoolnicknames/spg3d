"""Facade kit `panel`: Soviet / Polish large-panel residential blocks (П-44, П-3, 1-464, II-49, wielka płyta).

    blender -b --factory-startup -P scripts/blender/kits/panel.py -- src/assets/kits/panel.glb [--preview docs/kits/panel.png]

Contract: docs/KITS.md §1–2. Every module is one mesh object `panel__<module>` at the origin: X along the facade
(0 … W), Z up (0 … H), wall plane Y = 0, street at −Y. Reveals and loggias recess into +Y (≤ 0.45); sills, slabs,
canopies stick out into −Y (≤ 1.6). Faces are authored one at a time with an explicit outward direction and only
where they can be seen, which keeps the modules inside the budgets (bay 90, ground 150, cap 40, corner 24).
Every panel carries its sealed joint (wall2) on the left and bottom edge, so tiling bays gives the panel grid.
The manifest `<glb>.json` is written next to the GLB with the real triangle counts.

  win            one large window (1.5 × 1.5): reveal, concrete sill, frame, mullion, fortochka
  win2           a two-leaf and a single-leaf window
  win_ac         large window with an air-conditioner unit under the sill
  loggia         semi-recessed open loggia: slabs, side fins, ribbed concrete parapet, balcony door behind
  loggia_glazed  the same loggia glazed by the owner: flat parapet, glazing projecting on a metal ledge
  balcony        slab with a steel bar railing in front of a balcony door and window
  stair          staircase window, low in the panel so the column reads offset by half a floor
  blank          plain panel (gables, short walls)
  g_win          plinth with a basement vent, ground-floor window with bars
  g_plinth       plinth with two grilled vents, small high window of a utility room
  g_door         entrance: steel door in a niche, porch walls, canopy slab 1.4 m out, landing and step, lamp
  g_shop         shop cut into the ground floor: portal, shopfront and glass door, sign band, canopy, step
  cap            parapet with a roof coping and an attic vent
  cap_drain      parapet with a roof coping and a steel drain spout
  corner         0.4 m end strip of the panel wall
"""
import json
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = None
if '--preview' in argv:
    i = argv.index('--preview')
    PREVIEW = argv[i + 1]
    del argv[i:i + 2]
OUT = argv[0] if argv else '/mnt/ramdisk/kits-panel/panel.glb'
SCRATCH = '/mnt/ramdisk/kits-panel'

KIT = 'panel'
BAY, FLOOR, GROUND, CAP, CORNER = 3.0, 2.8, 3.0, 0.9, 0.4
J = 0.06        # sealed panel joint
D = 0.22        # window reveal depth; the frame closes the reveal, the glass sits 3.5 cm in front of it
PLZ, PLY = 0.7, -0.05   # plinth height and how far it stands proud of the wall
BUDGET = {'floor': 90, 'stair': 90, 'blank': 90, 'ground': 150, 'entrance': 150, 'shop': 150, 'cap': 40, 'corner': 24}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ───────────────────────── materials ─────────────────────────

def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, hexstr, metal=0.0, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    color = (*srgb(hexstr), 1.0)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = color     # viewport colour
    return m


MATS = {
    'wall': material('wall', '#c4bfb2', rough=0.9),
    'wall2': material('wall2', '#7b786f', rough=0.9),
    'trim': material('trim', '#dcd8ce', rough=0.8),
    'glass': material('glass', '#3b4a57', rough=0.08),
    'frame': material('frame', '#e8e6e0', rough=0.5),
    'metal': material('metal', '#4d535a', metal=0.7, rough=0.45),
    'roof': material('roof', '#4a4c50', rough=0.8),
    'dark': material('dark', '#1d1e20', rough=0.95),
    'sign': material('sign', '#b8352c', rough=0.5),
}


# ───────────────────────── module builder ─────────────────────────

MODULES = []


class Module:
    def __init__(self, name, role, weight, w=BAY, h=FLOOR):
        self.name, self.role, self.weight, self.w, self.h = name, role, weight, w, h
        self.polys = []
        self.obj = None
        MODULES.append(self)

    def poly(self, pts, mat, n):
        """planar polygon turned so its normal points along n; repeated and collinear corners are dropped"""
        pts = [Vector(p) for p in pts]
        k = 0
        while len(pts) >= 3 and k < len(pts):
            a, b, c = pts[k - 1], pts[k], pts[(k + 1) % len(pts)]
            if (b - a).cross(c - b).length < 1e-9:
                del pts[k]
                k = 0
            else:
                k += 1
        if len(pts) < 3:
            return
        normal = Vector()
        for a, b in zip(pts, pts[1:] + pts[:1]):
            normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if normal.dot(Vector(n)) < 0:
            pts.reverse()
        self.polys.append((pts, mat))

    def fy(self, y, x0, x1, z0, z1, mat, s=-1):
        self.poly([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat, (0, s, 0))

    def fx(self, x, y0, y1, z0, z1, mat, s):
        self.poly([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], mat, (s, 0, 0))

    def fz(self, z, x0, x1, y0, y1, mat, s):
        self.poly([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, (0, 0, s))

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces='-y +z -z -x +x'):
        """cuboid with only the listed faces; mat is a name or {face: name, None: default}"""
        for f in faces.split():
            mt = mat.get(f, mat.get(None)) if isinstance(mat, dict) else mat
            if f == '-y':
                self.fy(y0, x0, x1, z0, z1, mt, -1)
            elif f == '+y':
                self.fy(y1, x0, x1, z0, z1, mt, 1)
            elif f == '-x':
                self.fx(x0, y0, y1, z0, z1, mt, -1)
            elif f == '+x':
                self.fx(x1, y0, y1, z0, z1, mt, 1)
            elif f == '-z':
                self.fz(z0, x0, x1, y0, y1, mt, -1)
            elif f == '+z':
                self.fz(z1, x0, x1, y0, y1, mt, 1)

    def plane(self, x0, x1, z0, z1, holes=(), y=0.0, mat='wall'):
        """street-facing rectangle at Y = y with rectangular holes in a row. Each hole gets its own cell cut as a
        picture frame (four trapezoids): 8 triangles per hole and no T-junctions for the sky to leak through."""
        holes = sorted(holes)
        if not holes:
            self.fy(y, x0, x1, z0, z1, mat)
            return
        cuts = [x0] + [(a[1] + b[0]) / 2 for a, b in zip(holes, holes[1:])] + [x1]
        for (hx0, hx1, hz0, hz1), cx0, cx1 in zip(holes, cuts, cuts[1:]):
            for q in (((cx0, z0), (cx1, z0), (hx1, hz0), (hx0, hz0)),
                      ((cx1, z0), (cx1, z1), (hx1, hz1), (hx1, hz0)),
                      ((cx1, z1), (cx0, z1), (hx0, hz1), (hx1, hz1)),
                      ((cx0, z1), (cx0, z0), (hx0, hz0), (hx0, hz1))):
                self.poly([(u, y, v) for u, v in q], mat, (0, -1, 0))

    def tris(self):
        return sum(len(p) - 2 for p, _ in self.polys)


# ───────────────────────── facade parts ─────────────────────────

def panel(m, holes=(), top=None, bottom_joint=True):
    """the panel surface up to `top`: joint strip on the left and at the bottom, wall with holes in the rest"""
    W, H = m.w, top if top is not None else m.h
    if bottom_joint:
        # the left strip is three triangles so its edge carries the corner of the bottom strip (no T-junction)
        m.poly([(0, 0, 0), (J, 0, 0), (J, 0, J)], 'wall2', (0, -1, 0))
        m.poly([(0, 0, 0), (J, 0, J), (0, 0, H)], 'wall2', (0, -1, 0))
        m.poly([(J, 0, J), (J, 0, H), (0, 0, H)], 'wall2', (0, -1, 0))
        m.fy(0, J, W, 0, J, 'wall2')
        m.plane(J, W, J, H, holes)
    else:
        m.fy(0, 0, J, 0, H, 'wall2')
        m.plane(J, W, 0, H, holes)


def hollow(m, x0, x1, z0, z1, depth, y0=0.0, mat='wall', back='dark', bottom=True):
    """the four sides of an opening from Y = y0 back to Y = depth, closed by `back` (None: left open)"""
    m.fx(x0, y0, depth, z0, z1, mat, 1)
    m.fx(x1, y0, depth, z0, z1, mat, -1)
    m.fz(z1, x0, x1, y0, depth, mat, -1)
    if bottom:
        m.fz(z0, x0, x1, y0, depth, mat, 1)
    if back:
        m.fy(depth, x0, x1, z0, z1, back)


def panes(style, x0, x1, z0, z1):
    """glass lights of a Soviet window inside its frame: `wide` two leaves with a fortochka over the narrow one,
    `single` one leaf with a fortochka, `stair` four lights"""
    fw, mw = 0.06, 0.07
    ix0, ix1, iz0, iz1 = x0 + fw, x1 - fw, z0 + fw, z1 - fw
    zt = iz1 - (iz1 - iz0) * 0.3
    if style == 'wide':
        xm = ix0 + (ix1 - ix0) * 0.42
        return [(ix0, xm - mw / 2, iz0, zt - mw / 2), (ix0, xm - mw / 2, zt + mw / 2, iz1), (xm + mw / 2, ix1, iz0, iz1)]
    if style == 'single':
        return [(ix0, ix1, iz0, zt - mw / 2), (ix0, ix1, zt + mw / 2, iz1)]
    xm, zm = (ix0 + ix1) / 2, iz0 + (iz1 - iz0) * 0.55
    return [(ix0, xm - mw / 2, iz0, zm - mw / 2), (xm + mw / 2, ix1, iz0, zm - mw / 2),
            (ix0, xm - mw / 2, zm + mw / 2, iz1), (xm + mw / 2, ix1, zm + mw / 2, iz1)]


def window(m, x0, x1, z0, z1, style='wide', sill=True):
    """reveal, sill running into the reveal, frame closing the reveal, glass lights"""
    hollow(m, x0, x1, z0, z1, D, back='frame', bottom=not sill)
    if sill:
        m.fz(z0, x0, x1, 0, D, 'trim', 1)
        m.box(x0 - 0.05, x1 + 0.05, -0.08, 0, z0 - 0.06, z0, 'trim')
    for u0, u1, v0, v1 in panes(style, x0, x1, z0, z1):
        m.fy(D - 0.035, u0, u1, v0, v1, 'glass')


def plinth(m, x0, x1, holes=(), left=True, right=True):
    """basement plinth standing proud of the wall, with vents into the dark"""
    m.plane(x0, x1, 0, PLZ, holes, y=PLY, mat='wall2')
    m.fz(PLZ, x0, x1, PLY, 0, 'trim', 1)
    if left:
        m.fx(x0, PLY, 0, 0, PLZ, 'wall2', -1)
    if right:
        m.fx(x1, PLY, 0, 0, PLZ, 'wall2', 1)
    for hx0, hx1, hz0, hz1 in holes:
        hollow(m, hx0, hx1, hz0, hz1, 0.15, y0=PLY, mat='wall2')


CX = (J + BAY) / 2     # middle of the panel between its joints


# ───────────────────────── floor bays ─────────────────────────

def win():
    m = Module('win', 'floor', 3)
    hole = (CX - 0.75, CX + 0.75, 0.85, 2.35)
    panel(m, [hole])
    window(m, *hole, 'wide')


def win2():
    m = Module('win2', 'floor', 2)
    big, small = (0.33, 1.53, 0.85, 2.35), (1.93, 2.73, 0.85, 2.35)
    panel(m, [big, small])
    window(m, *big, 'wide')
    window(m, *small, 'single')


def win_ac():
    m = Module('win_ac', 'floor', 1)
    hole = (CX - 0.75, CX + 0.75, 0.85, 2.35)
    panel(m, [hole])
    window(m, *hole, 'wide')
    m.box(1.72, 2.52, -0.3, 0, 0.18, 0.7, 'trim')           # outdoor unit on its brackets
    m.fy(-0.315, 1.8, 2.2, 0.26, 0.62, 'dark')              # fan grille


FT, P, ST = 0.14, 0.78, 0.14     # loggia: fin thickness, how far fins stand out, slab thickness
SLAB = -P - 0.04                 # slab edge line, a little proud of the fins


def loggia_box(m, back, ceiling=True, floor=True, inner=True):
    """floor and ceiling slabs across the bay and the two side fins; `back` is where the loggia ends in +Y.
    Stacked loggias put their slabs together into one 0.28 m floor slab."""
    W, H = m.w, m.h
    for z0, z1 in ((0, ST), (H - ST, H)):
        m.fy(SLAB, 0, W, z0, z1, 'trim')
        m.fx(0, SLAB, 0, z0, z1, 'trim', -1)
        m.fx(W, SLAB, 0, z0, z1, 'trim', 1)
    m.fz(0, 0, W, SLAB, 0, 'trim', -1)
    m.fz(H, 0, W, SLAB, 0, 'trim', 1)
    if floor:
        m.fz(ST, 0, W, SLAB, back, 'trim', 1)
    if ceiling:
        m.fz(H - ST, 0, W, SLAB, back, 'trim', -1)
    for xo, xi, s in ((0, FT, 1), (W, W - FT, -1)):
        m.fx(xo, -P, 0, ST, H - ST, 'wall', -s)
        m.fy(-P, min(xo, xi), max(xo, xi), ST, H - ST, 'wall')
        if inner:
            m.fx(xi, -P, back, ST, H - ST, 'wall', s)


def loggia():
    m = Module('loggia', 'floor', 2)
    W, H, R = m.w, m.h, 0.45
    loggia_box(m, R)
    # back wall: balcony door and window block
    m.fy(R, FT, W - FT, ST, H - ST, 'wall')
    m.fy(R - 0.03, 0.5, 2.5, ST, 2.36, 'frame')
    m.fy(R - 0.06, 0.58, 1.18, 1.0, 2.28, 'glass')
    m.fy(R - 0.06, 1.3, 2.42, 1.0, 2.28, 'glass')
    # ribbed concrete parapet: a zigzag profile between the fins, crests just behind the fin fronts
    top, n = ST + 1.0, 10
    xs = [FT + (W - 2 * FT) * k / (2 * n) for k in range(2 * n + 1)]
    ys = [-P + (0.07 if k % 2 == 0 else 0.01) for k in range(2 * n + 1)]
    for k in range(2 * n):
        m.poly([(xs[k], ys[k], ST), (xs[k + 1], ys[k + 1], ST), (xs[k + 1], ys[k + 1], top), (xs[k], ys[k], top)],
               'wall', (0, -1, 0))
    m.box(FT, W - FT, -P, -P + 0.12, top, top + 0.06, 'trim', '-y +z')


def loggia_glazed():
    m = Module('loggia_glazed', 'floor', 2)
    W, H = m.w, m.h
    loggia_box(m, 0.0, ceiling=False, floor=False, inner=False)   # all of that is behind the glass
    top, gy = ST + 1.0, -P - 0.12
    m.fy(-P + 0.02, FT, W - FT, ST, top - 0.06, 'wall2')           # parapet panel
    m.fx(FT, -P, -P + 0.02, ST, top - 0.06, 'wall', 1)
    m.fx(W - FT, -P, -P + 0.02, ST, top - 0.06, 'wall', -1)
    m.box(FT, W - FT, gy - 0.05, -P + 0.02, top - 0.06, top, 'metal', '-y -z +z')   # ledge carrying the glazing
    m.fx(FT, gy - 0.05, -P, top - 0.06, top, 'metal', -1)
    m.fx(W - FT, gy - 0.05, -P, top - 0.06, top, 'metal', 1)
    m.fy(gy, FT, W - FT, top, H - ST, 'frame')
    m.fx(FT, gy, -P, top, H - ST, 'frame', -1)
    m.fx(W - FT, gy, -P, top, H - ST, 'frame', 1)
    m.poly([(FT, gy, H - ST), (W - FT, gy, H - ST), (W - FT, SLAB, H - ST + 0.08), (FT, SLAB, H - ST + 0.08)],
           'metal', (0, -1, 1))                                     # flashing up to the slab edge
    for x, s in ((FT, -1), (W - FT, 1)):
        m.poly([(x, gy, H - ST), (x, SLAB, H - ST), (x, SLAB, H - ST + 0.08)], 'metal', (s, 0, 0))
    fw, gap = 0.06, 0.05
    lw = (W - 2 * FT - 2 * fw - 3 * gap) / 4
    zt = H - ST - fw - 0.34
    for k in range(4):
        u0 = FT + fw + k * (lw + gap)
        m.fy(gy - 0.03, u0, u0 + lw, top + fw, zt - gap / 2, 'glass')
        m.fy(gy - 0.03, u0, u0 + lw, zt + gap / 2, H - ST - fw, 'glass')


def balcony():
    m = Module('balcony', 'floor', 1)
    sl, by, rz = 0.15, -0.95, 1.1
    hole = (0.5, 2.5, sl, 2.35)
    panel(m, [hole])
    hollow(m, *hole, D, back=None, bottom=False)
    m.fz(sl, 0.5, 2.5, 0, D, 'trim', 1)
    m.fy(D, 0.5, 1.28, sl, 2.35, 'frame')        # door
    m.fy(D, 1.28, 2.5, 0.9, 2.35, 'frame')       # window
    m.fy(D, 1.28, 2.5, sl, 0.9, 'wall')          # wall under the window
    for u0, u1, v0, v1 in ((0.58, 1.2, 1.12, 2.27), (1.36, 1.84, 0.98, 2.27), (1.94, 2.42, 0.98, 2.27)):
        m.fy(D - 0.035, u0, u1, v0, v1, 'glass')
    m.box(0.2, 2.8, by, 0, 0, sl, 'trim')
    # railing: flat-bar handrail on three sides, square balusters
    m.box(0.2, 2.8, by, by + 0.05, rz - 0.05, rz, 'metal', '-y +z -z')
    m.box(0.2, 0.25, by, 0, rz - 0.05, rz, 'metal', '-x +x +z -z')
    m.box(2.75, 2.8, by, 0, rz - 0.05, rz, 'metal', '-x +x +z -z')
    for k in range(7):
        bx = 0.23 + k * (2.54 - 0.04) / 6
        m.fy(by + 0.02, bx, bx + 0.04, sl, rz - 0.05, 'metal')
    for y in (by * 0.66, by * 0.33):
        m.fx(0.2, y, y + 0.04, sl, rz - 0.05, 'metal', -1)
        m.fx(2.8, y, y + 0.04, sl, rz - 0.05, 'metal', 1)


def stair():
    m = Module('stair', 'stair', 1)
    hole = (CX - 0.6, CX + 0.6, 0.2, 1.3)
    panel(m, [hole])
    window(m, *hole, 'stair')


def blank():
    m = Module('blank', 'blank', 1)
    panel(m)


# ───────────────────────── ground floor ─────────────────────────

def g_win():
    m = Module('g_win', 'ground', 3, h=GROUND)
    plinth(m, 0, BAY, [(CX - 0.25, CX + 0.25, 0.22, 0.46)])
    hole = (CX - 0.75, CX + 0.75, 1.3, 2.7)
    m.fy(0, 0, J, PLZ, GROUND, 'wall2')
    m.plane(J, BAY, PLZ, GROUND, [hole])
    window(m, *hole, 'wide')
    x0, x1, z0, z1 = hole
    for k in range(1, 6):                          # window bars inside the reveal
        bx = x0 + (x1 - x0) * k / 6
        m.fy(0.04, bx - 0.015, bx + 0.015, z0, z1, 'metal')
    for bz in (z0 + 0.45, z1 - 0.45):
        m.fy(0.04, x0, x1, bz - 0.015, bz + 0.015, 'metal')


def g_plinth():
    m = Module('g_plinth', 'ground', 1, h=GROUND)
    vents = [(0.45, 1.05, 0.2, 0.5), (2.01, 2.61, 0.2, 0.5)]
    plinth(m, 0, BAY, vents)
    for x0, x1, z0, z1 in vents:
        for k in (1, 2):
            bx = x0 + (x1 - x0) * k / 3
            m.fy(PLY + 0.03, bx - 0.02, bx + 0.02, z0, z1, 'metal')
    hole = (CX - 0.45, CX + 0.45, 2.05, 2.65)
    m.fy(0, 0, J, PLZ, GROUND, 'wall2')
    m.plane(J, BAY, PLZ, GROUND, [hole])
    window(m, *hole, 'single')


def g_door():
    m = Module('g_door', 'entrance', 1, h=GROUND)
    W, G = BAY, GROUND
    plinth(m, 0, 0.2, right=False)
    plinth(m, 2.8, W, left=False)
    m.fy(0, 0, J, PLZ, G, 'wall2')
    door = (CX - 0.68, CX + 0.68, 0.3, 2.45)
    m.plane(J, W, 0.3, G, [door])
    x0, x1, z0, z1 = door
    hollow(m, x0, x1, z0, z1, 0.3, back='dark', bottom=False)
    m.fz(z0, x0, x1, 0, 0.3, 'trim', 1)
    m.fy(0.27, x0 + 0.08, CX - 0.01, z0, z1 - 0.09, 'metal')      # two steel leaves
    m.fy(0.27, CX + 0.01, x1 - 0.08, z0, z1 - 0.09, 'metal')
    m.fy(-0.02, 2.3, 2.46, 1.3, 1.56, 'metal')                    # intercom
    m.box(0.4, 2.6, -1.25, 0, 0, 0.3, 'trim', '-y +z')             # landing
    m.box(0.65, 2.41, -1.55, -1.25, 0, 0.15, 'trim')              # step
    m.box(0.2, 0.4, -1.25, 0, 0, 2.62, 'wall', '-x -y +x')         # porch walls
    m.box(2.6, 2.8, -1.25, 0, 0, 2.62, 'wall', '-x -y +x')
    m.box(0.1, 2.9, -1.4, 0, 2.62, 2.8, {'+z': 'roof', None: 'trim'})   # canopy slab
    m.box(CX - 0.15, CX + 0.15, -0.14, 0, 2.5, 2.58, 'sign', '-y -z -x +x')   # lamp


def g_shop():
    m = Module('g_shop', 'shop', 1, h=GROUND)
    W, G, rv = BAY, GROUND, 0.15
    front = (0.3, 2.76, 0.12, 2.4)
    m.fy(0, 0, J, 0, G, 'wall2')
    m.plane(J, W, 0, G, [front])
    m.box(0.14, 0.3, -0.12, 0, 0, 2.48, 'trim', '-y -x +x')        # portal jambs
    m.box(2.76, 2.92, -0.12, 0, 0, 2.48, 'trim', '-y -x +x')
    hollow(m, *front, rv, mat='trim', back='frame')
    for u0, u1, v0, v1 in ((0.37, 1.02, 0.62, 2.33), (1.08, 1.73, 0.62, 2.33), (1.83, 2.69, 0.14, 2.05), (1.83, 2.69, 2.11, 2.33)):
        m.fy(rv - 0.03, u0, u1, v0, v1, 'glass')
    m.fy(rv - 0.03, 0.37, 1.73, 0.18, 0.56, 'metal')               # stall riser
    m.box(0.08, 2.98, -0.24, 0, 2.48, 2.95, {'-y': 'sign', None: 'metal'})   # sign band
    u0 = 0.62
    for lw in (0.17, 0.15, 0.17, 0.16, 0.15, 0.16, 0.13, 0.19):     # letters
        m.fy(-0.26, u0, u0 + lw, 2.6, 2.83, 'trim')
        u0 += lw + 0.045
    m.box(1.72, 2.86, -0.85, -0.12, 2.36, 2.44, 'metal')           # canopy over the door
    m.box(1.76, 2.76, -0.5, 0, 0, 0.12, 'trim', '-y +z -x +x')      # step


# ───────────────────────── cap and corner ─────────────────────────

def cap(name, weight, vent=None, spout=False):
    m = Module(name, 'cap', weight, h=CAP)
    ct = 0.8
    panel(m, [vent] if vent else [], top=ct)
    if vent:
        hollow(m, *vent, 0.15, bottom=True)
    m.fy(-0.06, 0, BAY, ct, CAP, 'roof')
    m.fz(ct, 0, BAY, -0.06, 0, 'roof', -1)
    m.fz(CAP, 0, BAY, -0.06, 0.45, 'roof', 1)
    m.fx(0, -0.06, 0.45, ct, CAP, 'roof', -1)
    m.fx(BAY, -0.06, 0.45, ct, CAP, 'roof', 1)
    if spout:
        m.box(2.45, 2.6, -0.4, 0, 0.6, 0.7, 'metal')


def corner():
    m = Module('corner', 'corner', 1, w=CORNER)
    panel(m)


for build in (win, win2, win_ac, loggia, loggia_glazed, balcony, stair, blank, g_win, g_plinth, g_door, g_shop, corner):
    build()
cap('cap', 3, vent=(CX - 0.3, CX + 0.3, 0.3, 0.52))
cap('cap_drain', 1, spout=True)


# ───────────────────────── meshes, checks, export ─────────────────────────

problems = []
for mod in MODULES:
    me = bpy.data.meshes.new(f'{KIT}__{mod.name}')
    bm = bmesh.new()
    names = []
    for pts, mat in mod.polys:
        if mat not in names:
            names.append(mat)
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.material_index = names.index(mat)
        f.smooth = False
    bm.to_mesh(me)
    bm.free()
    for n in names:
        me.materials.append(MATS[n])
    mod.obj = bpy.data.objects.new(f'{KIT}__{mod.name}', me)
    scene.collection.objects.link(mod.obj)
    lo = [min(p[a] for pts, _ in mod.polys for p in pts) for a in range(3)]
    hi = [max(p[a] for pts, _ in mod.polys for p in pts) for a in range(3)]
    if mod.tris() > BUDGET[mod.role]:
        problems.append(f'{mod.name}: {mod.tris()} triangles > {BUDGET[mod.role]}')
    if lo[0] < -1e-6 or hi[0] > mod.w + 1e-6 or lo[1] < -1.6 or hi[1] > 0.45 + 1e-6 or lo[2] < -1e-6 or hi[2] > mod.h + 1e-6:
        problems.append(f'{mod.name}: bounds {lo} … {hi} outside {mod.w} × {mod.h}')
    print(f'{mod.obj.name:24s} {mod.role:9s} {mod.w:.1f}×{mod.h:.1f}  {mod.tris():4d} tris  mats {names}')
if problems:
    raise SystemExit('panel kit off contract:\n  ' + '\n  '.join(problems))

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT',
                          export_extras=False, export_lights=False, export_cameras=False, use_selection=False)
manifest = {
    'kit': KIT, 'bay': BAY, 'floor': FLOOR, 'ground': GROUND, 'cap': CAP, 'corner': CORNER,
    'modules': {m.name: {'w': m.w, 'h': m.h, 'role': m.role, 'weight': m.weight, 'tris': m.tris()} for m in MODULES},
}
with open(os.path.splitext(OUT)[0] + '.json', 'w') as fh:
    fh.write(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(f'{KIT}: {len(MODULES)} modules, {sum(m.tris() for m in MODULES)} triangles, {os.path.getsize(OUT)} bytes → {OUT}')


# ───────────────────────── preview ─────────────────────────

def preview(path):
    """sample facade (8 bays, ground + 5 floors + cap, corners) and a close 3/4 view of 2 × 2 bays, side by side"""
    import numpy as np

    by_name = {m.name: m for m in MODULES}
    for m in MODULES:
        m.obj.hide_render = True

    placed = []

    def place(name, x, z, sx=1.0, sz=1.0):
        mod = by_name[name]
        o = bpy.data.objects.new(f'pv_{name}', mod.obj.data)
        scene.collection.objects.link(o)
        o.location = (x, 0, z)
        o.scale = (sx, 1, sz)
        placed.append(o)

    def facade(x0, ground, floors):
        n = len(ground)
        rows = [(0.0, GROUND, ground)]
        for f, row in enumerate(floors):
            rows.append((GROUND + f * FLOOR, FLOOR, row))
        for z, h, row in rows:
            place('corner', x0, z, sz=h / FLOOR)
            place('corner', x0 + CORNER + n * BAY, z, sz=h / FLOOR)
            for i, name in enumerate(row):
                place(name, x0 + CORNER + i * BAY, z)
        z = GROUND + len(floors) * FLOOR
        sx = (n * BAY + 2 * CORNER) / (n * BAY)        # caps stretch over the corners (+3 % … +13 %)
        for i in range(n):
            place('cap_drain' if i in (0, n - 1) else 'cap', x0 + i * BAY * sx, z, sx=sx)
        group = placed[:]
        placed.clear()
        return group

    big = facade(0.0, ['g_win', 'g_shop', 'g_win', 'g_plinth', 'g_door', 'g_win', 'g_win', 'g_win'], [
        ['win', 'loggia', 'win2', 'balcony', 'stair', 'win', 'loggia_glazed', 'win_ac'],
        ['win_ac', 'loggia_glazed', 'win2', 'win', 'stair', 'win', 'loggia', 'win'],
        ['win', 'loggia', 'win2', 'balcony', 'stair', 'win_ac', 'loggia_glazed', 'win'],
        ['win', 'loggia_glazed', 'win2', 'win', 'stair', 'win', 'loggia_glazed', 'win'],
        ['win', 'loggia', 'win2', 'balcony', 'stair', 'win', 'loggia', 'win'],
    ])
    close = facade(60.0, ['g_shop', 'g_door'], [['loggia', 'stair']])

    gmat = bpy.data.materials.new('pv_ground')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.055, 1)
    gm = bpy.data.meshes.new('pv_ground')
    gm.from_pydata([(-80, -80, 0), (160, -80, 0), (160, 30, 0), (-80, 30, 0)], [], [(0, 1, 2, 3)])
    gm.materials.append(gmat)
    scene.collection.objects.link(bpy.data.objects.new('pv_ground', gm))

    world = bpy.data.worlds.new('pv_world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.55, 0.75, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    scene.world = world
    sun = bpy.data.objects.new('pv_sun', bpy.data.lights.new('pv_sun', 'SUN'))
    sun.data.energy = 4.5
    sun.data.angle = 0.02
    sun.rotation_euler = Vector((-0.8, -0.45, 0.62)).to_track_quat('Z', 'Y').to_euler()   # from front-left, low
    scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'

    cam = bpy.data.objects.new('pv_cam', bpy.data.cameras.new('pv_cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = [
        ('facade', 800, (-5.5, -23.0, 2.0), (12.4, 0.0, 8.6), 30, big, close),
        ('close', 480, (55.8, -7.0, 1.5), (63.9, 0.0, 3.1), 26, close, big),
    ]
    parts = []
    for tag, width, loc, target, lens, shown, hidden in shots:
        for o in shown:
            o.hide_render = False
        for o in hidden:
            o.hide_render = True
        cam.data.lens = lens
        cam.location = loc
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.resolution_x, scene.render.resolution_y = width, 720
        scene.render.resolution_percentage = 100
        scene.render.filepath = os.path.join(SCRATCH, f'pv_{tag}.png')
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(scene.render.filepath)
        px = np.empty(width * 720 * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        parts.append(px.reshape(720, width, 4))
    sheet = np.concatenate(parts, axis=1)
    out = bpy.data.images.new('pv_sheet', sheet.shape[1], 720, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.abspath(path)
    out.file_format = 'PNG'
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    out.save()
    print(f'{KIT}: preview → {path}')


if PREVIEW:
    preview(PREVIEW)
