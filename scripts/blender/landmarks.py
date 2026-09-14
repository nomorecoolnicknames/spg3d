"""Landmark models for the real-place tracks, built headless in Blender and exported as one GLB.

    blender -b --factory-startup -P scripts/blender/landmarks.py -- <out.glb>

Every landmark is a root empty named after it (world/osm/OsmCity.ts clones it by name). Units are metres,
the origin is the base centre on the ground, the front of the model faces glTF +Z (Blender -Y).
Proportions follow photographs on Wikimedia Commons (see docs/PLAN_V4.md); detail is kept to a few
hundred triangles per model so a phone renders them among a city.

  shch_stela          entrance stela «ЩЁЛКОВО» of stacked letter cubes on the tricolour flowerbed of the
                      museum roundabout; the town coat of arms (public domain) on both sides of the plinth
  shch_love           «Я ❤ ЩЁЛКОВО» letters on a low stand (artwork at the town administration)
  spb_obelisk         obelisk «Городу-герою Ленинграду», Vosstaniya Square: 36 m with the Gold Star
  spb_station_tower   the clock tower over the main entrance of Moskovsky railway station
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/mnt/ramdisk/landmarks.glb'
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
ARMS = os.path.join(HERE, 'textures', 'shch-arms.png')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ───────────────────────── materials ─────────────────────────

def material(name, color, metal=0.0, rough=0.6, emit=None, strength=1.0, image=None, alpha_clip=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_clip:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP'
    return m


def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


M = {
    'granite': material('granite', srgb('#8c8580'), rough=0.8),
    'graniteDark': material('graniteDark', srgb('#5b3a34'), rough=0.55),
    'cubeGrey': material('cubeGrey', srgb('#c9ccd0'), metal=0.3, rough=0.45),
    'frame': material('frame', srgb('#4a4d52'), metal=0.6, rough=0.4),
    'letter': material('letter', srgb('#f4f6f8'), rough=0.3, emit=srgb('#ffffff'), strength=1.6),
    'bedRed': material('bedRed', srgb('#c8322a'), rough=0.9),
    'bedBlue': material('bedBlue', srgb('#2b56b8'), rough=0.9),
    'bedWhite': material('bedWhite', srgb('#e8e8e2'), rough=0.9),
    'flowers': material('flowers', srgb('#4f7a3a'), rough=0.95),
    'arms': material('arms', (1, 1, 1), rough=0.5, image=ARMS, alpha_clip=True),
    'bronze': material('bronze', srgb('#7a5a32'), metal=0.9, rough=0.35),
    'gold': material('gold', srgb('#f2c14e'), metal=1.0, rough=0.25, emit=srgb('#ffcf5a'), strength=2.5),
    'red': material('red', srgb('#e01e3c'), rough=0.35, emit=srgb('#ff2a4a'), strength=2.2),
    'plaster': material('plaster', srgb('#e3d2a6'), rough=0.85),
    'trim': material('trim', srgb('#f3efe6'), rough=0.8),
    'roofGreen': material('roofGreen', srgb('#58705f'), metal=0.4, rough=0.5),
    'glassWarm': material('glassWarm', srgb('#402a18'), rough=0.2, emit=srgb('#ffb45a'), strength=1.4),
    'clock': material('clock', srgb('#f8f4e8'), rough=0.4, emit=srgb('#fff6dc'), strength=1.8),
    'clockHands': material('clockHands', srgb('#1a1a1a'), rough=0.5),
    'steel': material('steel', srgb('#6c7076'), metal=0.8, rough=0.35),
}


# ───────────────────────── geometry helpers ─────────────────────────

def link(obj, parent):
    scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def root(name):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    return e


def box(parent, name, size, loc, mat, rot_z=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, size[2] / 2)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    return o


def cylinder(parent, name, r0, r1, h, loc, mat, segs=24, cap=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    return o


def frustum(parent, name, w0, w1, h, loc, mat):
    """square frustum: base w0 × w0, top w1 × w1"""
    me = bpy.data.meshes.new(name)
    a, b = w0 / 2, w1 / 2
    verts = [(-a, -a, 0), (a, -a, 0), (a, a, 0), (-a, a, 0), (-b, -b, h), (b, -b, h), (b, b, h), (-b, b, h)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0)]
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    return o


def pyramid(parent, name, w, h, loc, mat):
    me = bpy.data.meshes.new(name)
    a = w / 2
    verts = [(-a, -a, 0), (a, -a, 0), (a, a, 0), (-a, a, 0), (0, 0, h)]
    me.from_pydata(verts, [], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)])
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    return o


def wedge(parent, name, r, a0, a1, h, loc, mat, segs=10):
    """flat pie sector on the ground (flowerbed pattern)"""
    me = bpy.data.meshes.new(name)
    verts = [(0, 0, h)]
    for k in range(segs + 1):
        a = a0 + (a1 - a0) * k / segs
        verts.append((math.cos(a) * r, math.sin(a) * r, h))
    faces = [(0, k + 1, k + 2) for k in range(segs)]
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    return o


def text(parent, name, body, size, loc, mat, extrude=0.03, facing='front', align='CENTER'):
    """extruded glyphs converted to a mesh; 'front' faces Blender -Y (glTF +Z), 'back' faces +Y"""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    cu.size = size
    cu.extrude = extrude
    cu.resolution_u = 2
    cu.align_x = align
    cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    o.rotation_euler = (math.pi / 2, 0, 0 if facing == 'front' else math.pi)
    o.location = loc
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    o.select_set(False)
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.parent = parent
    return o


def plane(parent, name, w, h, loc, mat, facing='front'):
    me = bpy.data.meshes.new(name)
    verts = [(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h)]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            x, _, z = verts[vi]
            me.uv_layers[0].data[li].uv = (x / w + 0.5, z / h)
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    o.rotation_euler = (0, 0, 0 if facing == 'front' else math.pi)
    return o


# ───────────────────────── Shchyolkovo ─────────────────────────

def shch_stela():
    r = root('shch_stela')
    R = 8.2
    # granite curb ring and the tricolour gravel bed
    cylinder(r, 'curb', R + 0.5, R + 0.5, 0.55, (0, 0, 0), M['granite'], segs=40)
    cylinder(r, 'bedEdge', R, R, 0.62, (0, 0, 0), M['flowers'], segs=40)
    for k, key in enumerate(['bedRed', 'bedBlue', 'bedWhite']):
        a0 = math.radians(200 + 120 * k)
        wedge(r, f'bed{k}', R - 0.6, a0, a0 + math.radians(120), 0.66, (0, 0, 0), M[key])
    # plinth with the coat of arms, seven letter cubes, cap
    S = 1.35
    box(r, 'plinth', (S + 0.2, S + 0.2, 1.3), (0, 0, 0.62), M['frame'])
    for facing, y in (('front', -(S / 2 + 0.11)), ('back', S / 2 + 0.11)):
        plane(r, f'arms_{facing}', 0.8, 1.0, (0, y, 0.78), M['arms'], facing)
    z = 1.92
    for i, ch in enumerate(reversed('ЩЁЛКОВО')):  # built bottom-up: Щ ends on top, as on the real stela
        box(r, f'cube{i}', (S, S, S * 0.96), (0, 0, z), M['cubeGrey'])
        box(r, f'seam{i}', (S + 0.04, S + 0.04, 0.05), (0, 0, z + S * 0.96), M['frame'])
        for facing, y in (('front', -(S / 2 + 0.02)), ('back', S / 2 + 0.02)):
            text(r, f'l{i}{facing}', ch, 1.0, (0, y, z + S * 0.5), M['letter'], extrude=0.02, facing=facing)
        z += S
    box(r, 'cap', (S + 0.12, S + 0.12, 0.25), (0, 0, z), M['frame'])
    return r


def shch_love():
    r = root('shch_love')
    box(r, 'stand', (9.0, 1.2, 0.5), (0, 0, 0), M['granite'])
    text(r, 'ya', 'Я', 1.4, (-3.6, -0.2, 1.25), M['letter'], extrude=0.2)
    text(r, 'heart', '♥', 1.5, (-2.3, -0.2, 1.25), M['red'], extrude=0.22)
    text(r, 'town', 'ЩЁЛКОВО', 1.1, (1.4, -0.2, 1.15), M['letter'], extrude=0.18)
    return r


# ───────────────────────── Saint Petersburg ─────────────────────────

def star(parent, name, r_out, r_in, depth, loc, mat):
    me = bpy.data.meshes.new(name)
    ring = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        rr = r_out if k % 2 == 0 else r_in
        ring.append((math.cos(a) * rr, math.sin(a) * rr))
    verts = [(0, -depth, 0), (0, depth, 0)] + [(x, 0, z) for x, z in ring]
    faces = []
    for k in range(10):
        a, b = 2 + k, 2 + (k + 1) % 10
        faces.append((0, a, b))
        faces.append((1, b, a))
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    o = link(bpy.data.objects.new(name, me), parent)
    o.location = loc
    return o


def spb_obelisk():
    r = root('spb_obelisk')
    cylinder(r, 'platform', 11.0, 11.0, 0.45, (0, 0, 0), M['granite'], segs=48)
    cylinder(r, 'step', 7.0, 7.0, 0.5, (0, 0, 0.45), M['granite'], segs=40)
    box(r, 'plinth', (5.2, 5.2, 1.0), (0, 0, 0.95), M['graniteDark'])
    box(r, 'pedestal', (4.2, 4.2, 4.2), (0, 0, 1.95), M['graniteDark'])
    box(r, 'band', (4.35, 4.35, 0.8), (0, 0, 4.3), M['bronze'])
    for k in range(4):
        a = k * math.pi / 2
        c = cylinder(r, f'medal{k}', 0.8, 0.8, 0.12, (math.sin(a) * 2.18, -math.cos(a) * 2.18, 3.2), M['bronze'], segs=20)
        c.rotation_euler = (math.pi / 2, 0, a)
    frustum(r, 'shaft', 3.0, 1.25, 27.0, (0, 0, 6.15), M['graniteDark'])
    pyramid(r, 'tip', 1.25, 1.6, (0, 0, 33.15), M['graniteDark'])
    star(r, 'star', 1.3, 0.55, 0.18, (0, 0, 35.8), M['gold'])
    return r


def spb_station_tower():
    """central tower of Moskovsky vokzal (K. Thon, 1851): rises from the 17 m cornice, clock, attic, flagpole"""
    r = root('spb_station_tower')
    W = 11.0
    box(r, 'risalit', (W + 4, 1.2, 17.6), (0, -0.6, 0), M['plaster'])
    for k in range(3):
        x = (k - 1) * 4.0
        box(r, f'arch{k}', (2.4, 0.3, 5.2), (x, -1.3, 4.6), M['glassWarm'])
        box(r, f'win{k}', (1.6, 0.3, 2.6), (x, -1.3, 11.4), M['glassWarm'])
    box(r, 'cornice', (W + 4.6, 1.8, 0.7), (0, -0.6, 17.6), M['trim'])
    box(r, 'tier1', (W * 0.62, W * 0.62, 6.0), (0, 1.5, 18.3), M['plaster'])
    box(r, 'tier1Cornice', (W * 0.7, W * 0.7, 0.5), (0, 1.5, 24.3), M['trim'])
    for facing, y in (('front', 1.5 - W * 0.31 - 0.06), ('back', 1.5 + W * 0.31 + 0.06)):
        c = cylinder(r, f'clock_{facing}', 1.5, 1.5, 0.1, (0, y, 21.2), M['clock'], segs=28)
        c.rotation_euler = (math.pi / 2, 0, 0)
        box(r, f'hand_{facing}', (0.12, 0.08, 1.2), (0, y - 0.08 * (1 if facing == 'front' else -1), 21.2), M['clockHands'])
    box(r, 'tier2', (W * 0.44, W * 0.44, 4.2), (0, 1.5, 24.8), M['plaster'])
    for k in range(4):
        a = k * math.pi / 2
        box(r, f'belfry{k}', (1.4, 0.2, 2.4), (math.sin(a) * (W * 0.22 + 0.05), 1.5 - math.cos(a) * (W * 0.22 + 0.05), 25.6), M['glassWarm'], rot_z=a)
    box(r, 'tier2Cornice', (W * 0.5, W * 0.5, 0.4), (0, 1.5, 29.0), M['trim'])
    frustum(r, 'roof', W * 0.46, 0.6, 3.0, (0, 1.5, 29.4), M['roofGreen'])
    cylinder(r, 'mast', 0.08, 0.06, 5.0, (0, 1.5, 32.4), M['steel'], segs=8)
    return r


for build in (shch_stela, shch_love, spb_obelisk, spb_station_tower):
    build()

# apply transforms of the children so the glTF carries clean nodes, then export
for o in scene.objects:
    o.select_set(o.type == 'MESH')
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT', export_extras=False, export_lights=False, export_cameras=False, use_selection=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'landmarks: {len([o for o in scene.objects if o.parent is None])} roots, {tris} triangles → {OUT}')
