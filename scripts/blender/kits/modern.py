"""`modern` facade kit — 1990s–2020s offices, business centres and malls, built headless in Blender.

    blender -b --factory-startup -P scripts/blender/kits/modern.py -- src/assets/kits/modern.glb \
        [--preview docs/kits/modern.png] [--engine CYCLES|WORKBENCH] [--panels DIR] [--scale S]

Contract: docs/KITS.md §1–2. Every module is one mesh object `modern__<module>` at the origin: X along the
facade 0…W, Z up 0…H, wall plane Y = 0, street at −Y. Glazing and reveals recess to +Y (≤ 0.45); mullions,
fins, sills, canopies and copings stick out to −Y (≤ 1.6). The manifest next to the GLB gets the real
triangle counts. `--preview` also renders the sample sheet (an office and a business centre, three close-ups);
`--engine WORKBENCH` renders it flat with back-face culling to catch inverted faces.

The glazed modules share one grid so any two can stand side by side: a mullion every 1.6 m (half of one on
each module edge, so neighbours join into a full mullion) and a horizontal line at the slab (Z = 0). Every
recess is closed at the module edges, so a neighbour of another depth never shows a slot into the void.

  curtain     unitised curtain wall: full-height glass, protruding mullions, stack transom at the slab
  spandrel    vision glass between opaque glass spandrel bands (below the sill, above the ceiling), transoms
  ribbon      1990s ribbon window recessed in a continuous cladding band, metal sill flashing
  fins        curtain wall with deep vertical metal fins every 1.6 m
  punched     stone/composite cladding with a deep punched window, frame, mullion, transom, metal sill
  blank       cladding panels with V-groove joints (gables, short walls)
  g_lobby     glass lobby with thick mullions, stone kerb, opaque glass fascia, clerestory transom
  g_glass     recessed shop/office glazing between stone piers under a stone band
  g_entry     glass lobby with a framed sliding-door recess, a thin metal canopy on tie rods, name sign
  g_shop      mall retail front: shop window and door, canopy, sign light box on an opaque glass fascia
  cap         top-floor slab band, clad parapet with joints, metal coping
  cap_screen  low parapet and coping with a louvred rooftop plant screen above it
  corner      aluminium corner strip with shadow gaps
"""
import math
import os
import shutil
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

KIT = 'modern'
BAY, FLOOR, GROUND, CAP, CORNER = 3.2, 3.8, 4.8, 1.2, 0.35
W = BAY
LAYER = 0.06       # least gap between a face and a parallel face of another material it covers (depth precision)
JOINT = 0.012      # half width of a V-groove cladding joint
BUDGET = {'floor': 90, 'stair': 90, 'blank': 90, 'ground': 150, 'entrance': 150, 'shop': 150, 'cap': 40,
          'corner': 24}

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OPTS = {'out': 'src/assets/kits/modern.glb', 'preview': None, 'engine': 'CYCLES', 'panels': None, 'scale': '1'}
_rest = list(argv)
while _rest:
    arg = _rest.pop(0)
    if arg.startswith('--'):
        OPTS[arg[2:]] = _rest.pop(0)
    else:
        OPTS['out'] = arg

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ───────────────────────── materials ─────────────────────────

def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MATERIALS = {
    # name:  sRGB colour, metallic, roughness
    'wall':  ('#c9c6bf', 0.0, 0.75),   # stone / composite cladding, tinted per building
    'wall2': ('#8f8c86', 0.0, 0.7),    # secondary stone, tinted per building: kerbs, plinths, piers, recess linings
    'glass': ('#2e3e4c', 0.0, 0.05),   # dark blue-grey tinted glass
    'glass2': ('#2f3a44', 0.3, 0.1),   # opaque back-painted glass, not tinted: spandrels, glass fascias
    'frame': ('#b4b8bc', 0.3, 0.45),   # light grey aluminium mullions
    'metal': ('#6a7077', 0.6, 0.45),   # anodised aluminium: fins, canopies, copings, louvres
    'roof':  ('#4a4c50', 0.0, 0.9),
    'dark':  ('#1c1e21', 0.0, 0.95),
    'sign':  ('#ebe7dc', 0.0, 0.5),    # light box face
}

for name, (color, metal, rough) in MATERIALS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(color), 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*srgb(color), 1.0)
    m.metallic, m.roughness = metal, rough


# ───────────────────────── mesh builder ─────────────────────────

class Module:
    """Faces of one module, each an explicitly oriented quad; built into one mesh object."""

    def __init__(self, key, role, w, h, weight):
        self.key, self.role, self.w, self.h, self.weight = key, role, w, h, weight
        self.name = f'{KIT}__{key}'
        self.faces = []

    def quad(self, pts, normal, mat):
        a, b, c = (Vector(p) for p in pts[:3])
        if (b - a).cross(c - a).dot(Vector(normal)) < 0:
            pts = pts[::-1]
        self.faces.append((pts, mat))

    def fy(self, x0, x1, z0, z1, y, mat, s=-1):
        """Rectangle in the plane Y = y facing s·Y (−1: towards the street)."""
        self.quad([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, s, 0), mat)

    def fx(self, y0, y1, z0, z1, x, mat, s):
        self.quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], (s, 0, 0), mat)

    def fz(self, x0, x1, y0, y1, z, mat, s):
        self.quad([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], (0, 0, s), mat)

    def box(self, x0, x1, y0, y1, z0, z1, mat, faces):
        """Axis-aligned box with only the listed faces ('-y +x -x +z -z +y')."""
        for f in faces.split():
            if f == '-y':
                self.fy(x0, x1, z0, z1, y0, mat, -1)
            elif f == '+y':
                self.fy(x0, x1, z0, z1, y1, mat, 1)
            elif f == '-x':
                self.fx(y0, y1, z0, z1, x0, mat, -1)
            elif f == '+x':
                self.fx(y0, y1, z0, z1, x1, mat, 1)
            elif f == '-z':
                self.fz(x0, x1, y0, y1, z0, mat, -1)
            elif f == '+z':
                self.fz(x0, x1, y0, y1, z1, mat, 1)

    def mullion(self, xc, half, y0, y1, z0, z1, mat):
        """Vertical bar centred on xc; on a module edge only its inner half, closed on the outer side."""
        if xc <= 0:
            self.box(0, half, y0, y1, z0, z1, mat, '-y +x -x')
        elif xc >= self.w:
            self.box(self.w - half, self.w, y0, y1, z0, z1, mat, '-y -x +x')
        else:
            self.box(xc - half, xc + half, y0, y1, z0, z1, mat, '-y -x +x')

    def groove(self, axis, c, a0, a1, mat, half=JOINT, depth=0.01):
        """V joint sunk into the wall plane, so there is no gap to see through: centred on X = c running up over
        Z a0…a1 (axis 'x') or on Z = c running across over X a0…a1 (axis 'z'). A module carries the joints of its
        left and bottom edges just inside them, so the plane stays flat where two modules meet."""
        for e, tilt in ((c - half, depth), (c + half, -depth)):
            if axis == 'x':
                self.quad([(e, 0, a0), (c, depth, a0), (c, depth, a1), (e, 0, a1)], (tilt, -half, 0), mat)
            else:
                self.quad([(a0, 0, e), (a0, depth, c), (a1, depth, c), (a1, 0, e)], (0, -half, tilt), mat)

    def beam(self, p0, p1, size, mat):
        """Square rod between two points (four sides, open ends)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0).normalized()
        u = Vector((1, 0, 0))
        v = d.cross(u).normalized()
        u = v.cross(d).normalized()
        r = size / 2
        for n, t in ((u, v), (v, -u), (-u, -v), (-v, u)):
            pts = [p0 + (n + t) * r, p0 + (n - t) * r, p1 + (n - t) * r, p1 + (n + t) * r]
            self.quad([tuple(p) for p in pts], n, mat)

    @property
    def tris(self):
        return sum(len(pts) - 2 for pts, _ in self.faces)

    def build(self):
        order = list(MATERIALS)
        mats = sorted({m for _, m in self.faces}, key=order.index)
        verts, polys, index = [], [], []
        for pts, m in self.faces:
            polys.append(tuple(range(len(verts), len(verts) + len(pts))))
            verts.extend(pts)
            index.append(mats.index(m))
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(verts, [], polys)
        for m in mats:
            mesh.materials.append(bpy.data.materials[m])
        mesh.polygons.foreach_set('material_index', index)
        mesh.update()
        assert not mesh.validate(), f'{self.name}: invalid mesh'
        assert len(mesh.polygons) == len(polys), f'{self.name}: degenerate faces'
        obj = bpy.data.objects.new(self.name, mesh)
        scene.collection.objects.link(obj)

        xs, ys, zs = zip(*verts)
        eps = 1e-4
        assert min(xs) >= -eps and max(xs) <= self.w + eps, f'{self.name}: X out of 0…{self.w}'
        assert min(ys) >= -1.6 - eps and max(ys) <= 0.45 + eps, f'{self.name}: Y out of −1.6…0.45'
        assert min(zs) >= -eps and max(zs) <= self.h + eps, f'{self.name}: Z out of 0…{self.h}'
        assert self.tris <= BUDGET[self.role], f'{self.name}: {self.tris} tris > {BUDGET[self.role]}'
        return obj


MODULES = []


def module(key, role, w, h, weight):
    m = Module(key, role, w, h, weight)
    MODULES.append(m)
    return m


# ───────────────────────── typical floors ─────────────────────────

MUL = 0.045        # half width of a curtain-wall mullion
MUL_D = 0.14       # its projection in front of the glass
GRID = (0, W / 2, W)


def mullions(m, covered):
    """Mullions on the 1.6 m grid; the foot is closed in front of the slab transom (`covered` deep)."""
    for xc in GRID:
        m.mullion(xc, MUL, -MUL_D, 0, 0, FLOOR, 'frame')
        m.fz(max(xc - MUL, 0), min(xc + MUL, W), -MUL_D, -covered, 0, 'frame', -1)


def curtain():
    m = module('curtain', 'floor', W, FLOOR, 3)
    m.fy(0, W, 0, FLOOR, 0, 'glass')
    mullions(m, 0.10)
    m.box(0, W, -0.10, 0, 0, 0.20, 'frame', '-y +z -z')              # stack transom at the slab


def spandrel():
    m = module('spandrel', 'floor', W, FLOOR, 3)
    sill, head = 0.9, 3.45
    m.fy(0, W, 0, sill, 0, 'glass2')
    m.fy(0, W, sill, head, 0, 'glass')
    m.fy(0, W, head, FLOOR, 0, 'glass2')
    mullions(m, 0.06)
    m.box(0, W, -0.06, 0, 0, 0.05, 'frame', '-y +z -z')              # stack joint inside the band
    m.box(0, W, -0.10, 0, sill - 0.08, sill, 'frame', '-y +z -z')
    m.box(0, W, -0.10, 0, head, head + 0.08, 'frame', '-y +z -z')


def fins():
    m = module('fins', 'floor', W, FLOOR, 1)
    m.fy(0, W, 0, FLOOR, 0, 'glass')
    mullions(m, 0.10)
    m.box(0, W, -0.10, 0, 0, 0.20, 'frame', '-y +z -z')
    for xc in (W / 4, 3 * W / 4):
        m.box(xc - 0.03, xc + 0.03, -0.45, 0, 0, FLOOR, 'metal', '-y -x +x +z')
        m.fz(xc - 0.03, xc + 0.03, -0.45, -0.10, 0, 'metal', -1)        # the part in front of the transom


def ribbon():
    m = module('ribbon', 'floor', W, FLOOR, 2)
    d, sill, head = 0.16, 1.1, 3.4
    m.fy(0, W, 0, sill, 0, 'wall')
    m.fy(0, W, head, FLOOR, 0, 'wall')
    m.box(0, W, -LAYER, d, sill - 0.06, sill, 'metal', '-y +z -z')      # flashing, its top is the reveal floor
    m.fz(0, W, 0, d, head, 'wall', -1)                                  # soffit
    m.fx(0, d, sill, head, 0, 'frame', 1)                               # recess closed at the module edges
    m.fx(0, d, sill, head, W, 'frame', -1)
    m.fy(0, W, sill, head, d, 'glass')
    f = d - 0.06
    m.box(0, W, f, d, sill, sill + 0.07, 'frame', '-y +z')
    m.box(0, W, f, d, head - 0.07, head, 'frame', '-y -z')
    m.box(0, 0.035, f, d, sill + 0.07, head - 0.07, 'frame', '-y +x')
    m.box(W - 0.035, W, f, d, sill + 0.07, head - 0.07, 'frame', '-y -x')
    m.box(W / 2 - 0.035, W / 2 + 0.035, f, d, sill + 0.07, head - 0.07, 'frame', '-y -x +x')


def punched():
    m = module('punched', 'floor', W, FLOOR, 2)
    x0, x1, z0, z1, d, fw = 0.5, W - 0.5, 0.8, 3.25, 0.32, 0.07
    j, k = JOINT, 0.008                         # panel joints: left and bottom edge, along the sill and head lines
    m.fy(2 * j, W, 2 * j, z0 - 2 * k, 0, 'wall')
    m.fy(2 * j, W, z1 + 2 * k, FLOOR, 0, 'wall')
    m.fy(2 * j, x0, z0, z1, 0, 'wall')
    m.fy(x1, W, z0, z1, 0, 'wall')
    for axis, c, span, half in (('x', j, FLOOR, j), ('z', j, W, j), ('z', z0 - k, W, k), ('z', z1 + k, W, k)):
        m.groove(axis, c, 0, span, 'dark', half)
    m.fx(0, d, z0, z1, x0, 'wall', 1)                                   # deep reveals
    m.fx(0, d, z0, z1, x1, 'wall', -1)
    m.fz(x0, x1, 0, d, z0, 'wall', 1)
    m.fz(x0, x1, 0, d, z1, 'wall', -1)
    m.fy(x0, x1, z0, z1, d, 'glass')
    f = d - LAYER
    m.fy(x0, x1, z0, z0 + fw, f, 'frame')
    m.fy(x0, x1, z1 - fw, z1, f, 'frame')
    m.fy(x0, x0 + fw, z0 + fw, z1 - fw, f, 'frame')
    m.fy(x1 - fw, x1, z0 + fw, z1 - fw, f, 'frame')
    m.box(W / 2 - 0.035, W / 2 + 0.035, d - 0.11, d, z0 + fw, z1 - fw, 'frame', '-y -x +x')
    m.box(x0 + fw, x1 - fw, d - 0.10, d, 2.55, 2.62, 'frame', '-y +z -z')
    m.box(x0 - 0.03, x1 + 0.03, -0.06, 0, z0 - 0.05, z0, 'metal', '-y +z -z -x +x')


def blank():
    m = module('blank', 'blank', W, FLOOR, 1)
    j, mid = JOINT, FLOOR / 2
    for xa, xb in ((2 * j, W / 2 - j), (W / 2 + j, W)):
        for za, zb in ((2 * j, mid - j), (mid + j, FLOOR)):
            m.fy(xa, xb, za, zb, 0, 'wall')
    for c in (j, W / 2):
        m.groove('x', c, 0, FLOOR, 'dark')
    for c in (j, mid):
        m.groove('z', c, 0, W, 'dark')


# ───────────────────────── ground floor ─────────────────────────

GY = 0.12          # lobby glass line
KERB, FASCIA = 0.12, 4.3


def lobby_frame(m, centre=True):
    m.box(0, W, -0.06, GY, FASCIA, GROUND, 'glass2', '-y -z +z')
    for xc in (0, W / 2, W) if centre else (0, W):
        m.mullion(xc, 0.09, -0.22, GY, 0, GROUND, 'frame')
        m.fz(max(xc - 0.09, 0), min(xc + 0.09, W), -0.22, -0.06, GROUND, 'frame', 1)


def g_lobby():
    m = module('g_lobby', 'ground', W, GROUND, 2)
    lobby_frame(m)
    m.box(0, W, -0.04, GY, 0, KERB, 'wall2', '-y +z')
    m.fy(0, W, KERB, FASCIA, GY, 'glass')
    for xc in (W / 4, 3 * W / 4):
        m.box(xc - 0.025, xc + 0.025, GY - 0.07, GY, KERB, FASCIA, 'frame', '-y -x +x')
    m.box(0, W, GY - 0.06, GY, 3.5, 3.56, 'frame', '-y +z -z')          # clerestory transom


def g_glass():
    m = module('g_glass', 'ground', W, GROUND, 2)
    p, d, z0, z1 = 0.25, 0.22, 0.3, 3.9
    m.fy(0, p, 0, z1, 0, 'wall')
    m.fy(W - p, W, 0, z1, 0, 'wall')
    m.fy(0, W, z1, GROUND, 0, 'wall')
    m.fy(p, W - p, 0, z0, 0, 'wall2')
    m.fx(0, d, z0, z1, p, 'wall', 1)
    m.fx(0, d, z0, z1, W - p, 'wall', -1)
    m.fz(p, W - p, 0, d, z1, 'wall', -1)
    m.fz(p, W - p, 0, d, z0, 'wall2', 1)
    m.fy(p, W - p, z0, z1, d, 'glass')
    f, fw = d - LAYER, 0.06
    m.fy(p, W - p, z0, z0 + fw, f, 'frame')
    m.fy(p, W - p, z1 - fw, z1, f, 'frame')
    m.fy(p, p + fw, z0 + fw, z1 - fw, f, 'frame')
    m.fy(W - p - fw, W - p, z0 + fw, z1 - fw, f, 'frame')
    m.box(W / 2 - 0.03, W / 2 + 0.03, d - 0.10, d, z0 + fw, z1 - fw, 'frame', '-y -x +x')
    m.box(p + fw, W - p - fw, d - 0.09, d, 2.97, 3.03, 'frame', '-y +z -z')


def g_entry():
    m = module('g_entry', 'entrance', W, GROUND, 1)
    rx0, rx1, rz, rd = 0.55, W - 0.55, 3.0, 0.45
    lobby_frame(m, centre=False)
    m.box(0, rx0 - 0.08, -0.04, GY, 0, KERB, 'wall2', '-y +z')
    m.box(rx1 + 0.08, W, -0.04, GY, 0, KERB, 'wall2', '-y +z')
    m.fy(0, rx0 - 0.08, KERB, rz + 0.1, GY, 'glass')
    m.fy(rx1 + 0.08, W, KERB, rz + 0.1, GY, 'glass')
    m.fy(0, W, rz + 0.1, FASCIA, GY, 'glass')
    # door portal and recess
    m.box(rx0 - 0.08, rx0, -0.10, GY, 0, rz + 0.1, 'frame', '-y -x +x')
    m.box(rx1, rx1 + 0.08, -0.10, GY, 0, rz + 0.1, 'frame', '-y -x +x')
    m.box(rx0, rx1, -0.10, GY, rz, rz + 0.1, 'frame', '-y -z +z')
    m.fx(GY, rd, 0, rz, rx0, 'wall2', 1)
    m.fx(GY, rd, 0, rz, rx1, 'wall2', -1)
    m.fz(rx0, rx1, GY, rd, rz, 'metal', -1)
    m.fz(rx0, rx1, -0.10, rd, 0.03, 'roof', 1)
    m.fy(rx0, rx1, 0, rz, rd, 'glass')
    f, fw = rd - LAYER, 0.07
    m.fy(rx0, rx0 + fw, 0, rz, f, 'frame')
    m.fy(rx1 - fw, rx1, 0, rz, f, 'frame')
    m.fy(rx0 + fw, rx1 - fw, 2.4, 2.48, f, 'frame')
    m.fy(W / 2 - 0.03, W / 2 + 0.03, 0.12, 2.4, f, 'frame')
    m.fy(rx0 + fw, rx1 - fw, 0, 0.12, f, 'frame')
    # glazing above the door
    for xc in (W / 4, W / 2, 3 * W / 4):
        m.box(xc - 0.025, xc + 0.025, GY - 0.07, GY, rz + 0.1, FASCIA, 'frame', '-y -x +x')
    m.box(0.09, W - 0.09, GY - 0.06, GY, 3.5, 3.56, 'frame', '-y +z -z')
    # canopy on two tie rods, name sign above it
    m.box(0.2, W - 0.2, -1.5, GY, 3.2, 3.32, 'metal', '-y +z -z -x +x')
    for x in (0.45, W - 0.45):
        m.beam((x, -1.35, 3.30), (x, GY - 0.03, 4.15), 0.035, 'metal')
    m.fy(0.75, W - 0.75, 3.62, 3.92, GY - 0.07 - LAYER, 'sign')


def g_shop():
    m = module('g_shop', 'shop', W, GROUND, 1)
    p, sy, head, door = 0.14, 0.10, 3.3, 1.9
    for xc in (0, W):
        m.mullion(xc, p, -0.06, sy, 0, GROUND, 'wall2')
        m.fz(max(xc - p, 0), min(xc + p, W), -0.06, 0, GROUND, 'wall2', 1)
    m.fy(p, W - p, head, GROUND, 0, 'glass2')
    m.fz(p, W - p, 0, sy, head, 'wall2', -1)
    m.fy(p, door, 0, 0.3, 0, 'wall2')
    m.fz(p, door, 0, sy, 0.3, 'wall2', 1)
    m.fx(0, sy, 0, 0.3, door, 'wall2', 1)
    m.fy(p, door, 0.3, head, sy, 'glass')
    m.fy(door, W - p, 0, head, sy, 'glass')
    m.fy(p, W - p, head - 0.1, head, sy - LAYER, 'frame')
    m.box(door - 0.03, door + 0.03, sy - 0.08, sy, 0.3, head - 0.1, 'frame', '-y -x +x')
    m.box(door + 0.03, W - p, sy - 0.08, sy, 2.4, 2.46, 'frame', '-y +z -z')
    m.fy(door + 0.03, W - p, 0, 0.22, sy - 0.05, 'metal')
    m.box(p, W - p, -1.1, 0, 3.36, 3.44, 'metal', '-y +z -z -x +x')
    m.box(0.3, W - 0.3, -0.26, 0, 3.7, 4.4, 'metal', '+z -z -x +x')
    m.fy(0.3, W - 0.3, 3.7, 4.4, -0.26, 'sign')


# ───────────────────────── caps and corner ─────────────────────────

def cap():
    m = module('cap', 'cap', W, CAP, 3)
    top = 1.05
    m.box(0, W, -0.10, 0, 0, 0.18, 'frame', '-y +z -z')                 # roof slab edge
    j = JOINT
    m.fy(2 * j, W / 2 - j, 0.18, top, 0, 'wall')
    m.fy(W / 2 + j, W, 0.18, top, 0, 'wall')
    for c in (j, W / 2):
        m.groove('x', c, 0.18, top, 'dark')
    m.fx(0, 0.45, 0.18, top, 0, 'wall', -1)
    m.fx(0, 0.45, 0.18, top, W, 'wall', 1)
    m.box(0, W, -0.07, 0.45, top, CAP, 'metal', '-y +z -z -x +x')       # coping


def cap_screen():
    m = module('cap_screen', 'cap', W, CAP, 1)
    top, base = 0.5, 0.58
    m.box(0, W, -0.10, 0, 0, 0.18, 'frame', '-y +z -z')
    m.fy(0, W, 0.18, top, 0, 'wall')
    m.box(0, W, -0.07, 0.45, top, base, 'metal', '-y +z -z -x +x')
    m.fy(0, W, base, CAP, 0.22, 'dark')                                 # plant behind the louvres
    pitch = (CAP - 0.06 - base) / 3
    for i in range(3):
        z = base + i * pitch
        m.quad([(0, -0.02, z), (W, -0.02, z), (W, 0.10, z + pitch * 0.9), (0, 0.10, z + pitch * 0.9)],
               (0, -1, 1), 'metal')
    for xc in (0, W):
        m.mullion(xc, 0.05, -0.08, 0.22, base, CAP, 'metal')
    m.fy(0, W, CAP - 0.06, CAP, -0.06, 'metal')                         # top rail


def corner():
    m = module('corner', 'corner', CORNER, FLOOR, 1)
    m.fy(0, CORNER, 0, FLOOR, 0, 'dark')
    m.box(0.03, CORNER - 0.03, -0.12, 0, 0, FLOOR, 'frame', '-y -x +x')


for build in (curtain, spandrel, ribbon, fins, punched, blank, g_lobby, g_glass, g_entry, g_shop, cap,
              cap_screen, corner):
    build()
OBJECTS = {m.key: m.build() for m in MODULES}

# The game keeps one family per building (the first when it asks for none), so a glass tower never gets a
# punched or ribbon column; modules in no family (ground floor, caps, blank, corner) are shared by all.
FAMILIES = {'glass': ['curtain', 'spandrel', 'fins'], 'ribbon': ['ribbon'], 'punched': ['punched']}


# ───────────────────────── export ─────────────────────────

out = os.path.abspath(OPTS['out'])
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=True,
                          export_materials='EXPORT', use_selection=False)

lines = [f'    "{m.key}": {{ "w": {m.w}, "h": {m.h}, "role": "{m.role}", "weight": {m.weight}, "tris": {m.tris} }}'
         for m in MODULES]
families = ', '.join(f'"{k}": [{", ".join(chr(34) + v + chr(34) for v in vs)}]' for k, vs in FAMILIES.items())
with open(os.path.splitext(out)[0] + '.json', 'w') as fh:
    fh.write('{\n  "kit": "%s",\n  "bay": %s, "floor": %s, "ground": %s, "cap": %s, "corner": %s,\n'
             '  "families": { %s },\n  "modules": {\n%s\n  }\n}\n'
             % (KIT, BAY, FLOOR, GROUND, CAP, CORNER, families, ',\n'.join(lines)))
for m in MODULES:
    print(f'MODULE {m.name:24s} {m.role:9s} {m.w:.2f}x{m.h:.2f} tris={m.tris}')
print('EXPORT_OK', out, os.path.getsize(out), 'bytes')


# ───────────────────────── preview sheet ─────────────────────────

def place(key, origin, angle, x, z, sz=1.0):
    ob = bpy.data.objects.new(f'preview.{key}', OBJECTS[key].data)
    ob.matrix_world = (Matrix.Translation(origin) @ Matrix.Rotation(angle, 4, 'Z') @
                       Matrix.Translation((x, 0, z)) @ Matrix.Diagonal((1, 1, sz, 1)))
    scene.collection.objects.link(ob)


def facade(origin, angle, columns):
    """columns: one bottom-up list of module keys per bay — ground, floors…, cap."""
    heights = [GROUND] + [FLOOR] * (len(columns[0]) - 2) + [CAP]
    length = 2 * CORNER + BAY * len(columns)
    z = 0.0
    for level, h in enumerate(heights):
        for x in (0, length - CORNER):
            place('corner', origin, angle, x, z, h / FLOOR)
        for i, col in enumerate(columns):
            place(col[level], origin, angle, CORNER + i * BAY, z)
        z += h
    return length, z


def building(x0, front, side):
    length, height = facade(Vector((x0, 0, 0)), 0.0, front)
    depth, _ = facade(Vector((x0 + length, 0, 0)), math.pi / 2, side)
    mesh = bpy.data.meshes.new('preview.roof')
    z = height - 0.6
    mesh.from_pydata([(x0, 0, z), (x0 + length, 0, z), (x0 + length, depth, z), (x0, depth, z)], [], [(0, 1, 2, 3)])
    mesh.materials.append(bpy.data.materials['roof'])
    scene.collection.objects.link(bpy.data.objects.new('preview.roof', mesh))


def column(ground, floor, cap_key, n):
    return [ground] + [floor] * n + [cap_key]


def preview_scene():
    for ob in OBJECTS.values():                                # the exported originals sit at the origin
        ob.hide_render = True
    # business centre: punched front, ribbon side with a blank end bay, shops and an entrance
    centre = [column(g, 'punched', 'cap', 4) for g in ('g_glass', 'g_shop', 'g_entry', 'g_glass', 'g_shop', 'g_glass')]
    centre_side = [column('g_glass', 'ribbon', 'cap', 4), column('g_glass', 'ribbon', 'cap', 4),
                   column('g_glass', 'blank', 'cap', 4)]
    building(0.0, centre, centre_side)
    # glass office: curtain wall framed by spandrel bays, lobby with entrance and shops, plant screen, fins side
    grounds = ('g_shop', 'g_lobby', 'g_lobby', 'g_entry', 'g_lobby', 'g_lobby', 'g_glass', 'g_shop')
    office = [column(g, 'spandrel' if i in (0, 7) else 'curtain', 'cap_screen' if i >= 4 else 'cap', 6)
              for i, g in enumerate(grounds)]
    office_side = [column('g_glass', 'fins', 'cap', 6) for _ in range(3)]
    building(OFFICE_X, office, office_side)

    ground = bpy.data.meshes.new('preview.ground')
    ground.from_pydata([(-150, -150, 0), (250, -150, 0), (250, 150, 0), (-150, 150, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new('preview.asphalt')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb('#6a6b6c'), 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    gm.diffuse_color = (*srgb('#6a6b6c'), 1)
    ground.materials.append(gm)
    scene.collection.objects.link(bpy.data.objects.new('preview.ground', ground))

    sun_dir = Vector((0.55, 0.62, -0.56)).normalized()        # from the front-left, ~34° high
    sun = bpy.data.objects.new('preview.sun', bpy.data.lights.new('preview.sun', 'SUN'))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(0.6)
    sun.data.color = (1.0, 0.96, 0.9)
    sun.rotation_euler = sun_dir.to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new('preview.sky')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    rng = nt.nodes.new('ShaderNodeMapRange')
    rng.inputs['From Min'].default_value = -1.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    stops = ((0.0, '#3c3b39'), (0.495, '#7d7c78'), (0.505, '#dfe6ec'), (0.62, '#a9c1d9'), (1.0, '#4d79ad'))
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = stops[0][0], (*srgb(stops[0][1]), 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = stops[-1][0], (*srgb(stops[-1][1]), 1)
    for pos, col in stops[1:-1]:
        ramp.color_ramp.elements.new(pos).color = (*srgb(col), 1)
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], rng.inputs['Value'])
    nt.links.new(rng.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    return sun_dir


OFFICE_X = 34.0
VIEWS = [
    # name, sheet rect (x, y from top, w, h), camera, look-at, lens mm; the camera stays level and the
    # lens is shifted up to the look-at point, so verticals stay vertical like in architectural photos
    ('centre', (0, 0, 640, 440), (33.7, -31.5, 1.7), (10.5, 3.0, 12.6), 30),
    ('office', (640, 0, 640, 440), (OFFICE_X + 43.2, -41.8, 1.7), (OFFICE_X + 13.0, 3.0, 17.6), 30),
    ('glass', (0, 440, 426, 280), (OFFICE_X + 32.0, -8.8, 25.0), (OFFICE_X + 23.2, 2.0, 25.0), 38),
    ('entry', (426, 440, 427, 280), (OFFICE_X + 17.5, -8.5, 1.7), (OFFICE_X + 11.3, 0.0, 2.9), 30),
    ('punched', (853, 440, 427, 280), (25.5, -9.0, 4.5), (16.5, 1.0, 7.4), 30),
]


def render_preview(path):
    sun_dir = preview_scene()
    engine = OPTS['engine'].upper()
    scale = float(OPTS['scale'])
    if engine == 'WORKBENCH':
        scene.render.engine = 'BLENDER_WORKBENCH'
        shading = scene.display.shading
        shading.light, shading.color_type = 'STUDIO', 'MATERIAL'
        shading.show_cavity, shading.cavity_type = True, 'BOTH'
        shading.show_shadows = True
        shading.show_backface_culling = True
        scene.display.light_direction = tuple(-sun_dir)
    else:
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    tmp = OPTS['panels'] or tempfile.mkdtemp(prefix='kit-modern-')
    os.makedirs(tmp, exist_ok=True)
    cam = bpy.data.objects.new('preview.cam', bpy.data.cameras.new('preview.cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    sheet = np.zeros((720, 1280, 4), np.float32)
    sheet[..., 3] = 1.0
    for name, (sx, sy, sw, sh), eye, target, lens in VIEWS:
        cam.data.lens = lens
        cam.location = eye
        look = Vector(target) - Vector(eye)
        flat = Vector((look.x, look.y, 0))
        cam.rotation_euler = flat.to_track_quat('-Z', 'Y').to_euler()
        cam.data.shift_y = lens * look.z / flat.length / cam.data.sensor_width     # landscape: shift in widths
        scene.render.resolution_x, scene.render.resolution_y = int(sw * scale), int(sh * scale)
        scene.render.filepath = os.path.join(tmp, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        if scale != 1.0:
            continue
        img = bpy.data.images.load(scene.render.filepath)
        px = np.empty(sw * sh * 4, np.float32)
        img.pixels.foreach_get(px)
        top = 720 - sy - sh                                    # image rows run bottom-up
        sheet[top:top + sh, sx:sx + sw] = px.reshape(sh, sw, 4)
        bpy.data.images.remove(img)
    if scale == 1.0:
        sheet[280:720, 639:641, :3] = 0.08                     # panel separators
        for x in (426, 853):
            sheet[0:280, x - 1:x + 1, :3] = 0.08
        sheet[279:281, :, :3] = 0.08
        out_img = bpy.data.images.new('preview.sheet', 1280, 720)
        out_img.pixels.foreach_set(sheet.ravel())
        out_img.filepath_raw = os.path.abspath(path)
        out_img.file_format = 'PNG'
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        out_img.save()
        print('PREVIEW_OK', path)
    if not OPTS['panels']:
        shutil.rmtree(tmp, ignore_errors=True)


if OPTS['preview']:
    render_preview(OPTS['preview'])
