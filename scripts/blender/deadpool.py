"""The boss-fight hero: the Funko-style Deadpool of the first version (src/assets/chars-src/deadpool-funko.glb,
a single flat-shaded mesh) turned into rigid animatable parts.

    blender -b --factory-startup -P scripts/blender/deadpool.py -- <out.glb>

- vertices welded and shaded smooth (the source is a triangle soup with flat normals)
- colours as vertex colours: red suit, black patches round the eyes, black side panels, dark belt, both eyes
  white (the source has one white and one black eye mesh)
- split by face centre into parts, each with its origin on its joint so the game can swing it:
  dp_head (neck), dp_torso (hips), dp_arm_l / dp_arm_r (shoulders), dp_leg_l / dp_leg_r (hips)
Orientation: the figure faces glTF +Z, feet on y = 0, height 1.8 m.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/mnt/ramdisk/deadpool.glb'
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'src', 'assets', 'chars-src', 'deadpool-funko.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
for o in meshes:
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in [o for o in scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)

# the source faces +Y (Blender) = −Z in glTF: turn it round
turn = Matrix.Rotation(math.pi, 4, 'Z')
for o in meshes:
    o.data.transform(turn)

body = max(meshes, key=lambda o: len(o.data.polygons))
eyes = [o for o in meshes if o is not body and o.dimensions.z > 0.1]
buckle = [o for o in meshes if o is not body and o.dimensions.z <= 0.1]

# weld + smooth
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(body.data)
bm.free()
# the face is a few big triangles: subdivide the front of the head so the eye patches get a clean edge
bm = bmesh.new()
bm.from_mesh(body.data)
face_edges = {e for f in bm.faces if f.calc_center_median().z > 0.98 and f.calc_center_median().y < 0.05 for e in f.edges}
bmesh.ops.subdivide_edges(bm, edges=list(face_edges), cuts=2, use_grid_fill=True)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
bm.to_mesh(body.data)
bm.free()
for p in body.data.polygons:
    p.use_smooth = True
if hasattr(body.data, 'set_sharp_from_angle'):
    body.data.set_sharp_from_angle(angle=math.radians(50))

def centre(o):
    # bound_box is stale after data.transform(): average the vertices instead
    n = len(o.data.vertices)
    return sum((v.co for v in o.data.vertices), Vector()) / max(1, n)


# rebuild the eyes as two white lenses: mirror the white one to the other side (after the turn the face looks towards −Y)
white = next((o for o in eyes if o.active_material and o.active_material.diffuse_color[0] > 0.5), eyes[0])
for o in eyes:
    if o is not white:
        bpy.data.objects.remove(o, do_unlink=True)
mirror = white.copy()
mirror.data = white.data.copy()
scene.collection.objects.link(mirror)
mirror.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
mirror.data.flip_normals()
eyes = [white, mirror]
eye_pts = [centre(o) for o in eyes]
for o in eyes:
    for v in o.data.vertices:
        v.co.y -= 0.012  # sit proud of the black patch

RED = (0.62, 0.03, 0.04, 1.0)
BLACK = (0.035, 0.035, 0.04, 1.0)
BELT = (0.12, 0.1, 0.09, 1.0)
WHITE = (0.95, 0.95, 0.95, 1.0)


def paint(obj, fn, domain='CORNER'):
    col = obj.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain=domain)
    if domain == 'POINT':
        for v in obj.data.vertices:
            col.data[v.index].color = fn(v.co, v.normal)
        return
    for p in obj.data.polygons:
        c = fn(p.center, p.normal)
        for li in p.loop_indices:
            col.data[li].color = c


def body_colour(c, n):
    # per vertex, so the patch edges blend across the (large) triangles instead of stair-stepping
    # black patches round the eyes: teardrops on the front of the head, wider towards the temples
    if c.z > 1.0 and c.y < -0.05:
        for e in eye_pts:
            ox = c.x - e.x * 1.04
            dx, dz = ox / (0.22 if ox * e.x > 0 else 0.17), (c.z - e.z - 0.01) / 0.2
            if dx * dx + dz * dz < 1.0:
                return BLACK
    # belt round the waist (not across the hanging arms)
    if 0.44 < c.z < 0.56 and abs(c.x) < 0.26:
        return BELT
    # black side panels of the suit (torso only)
    if 0.58 < c.z < 0.95 and abs(n.x) > 0.85 and abs(c.x) < 0.2:
        return BLACK
    return RED


paint(body, body_colour)
for o in eyes:
    paint(o, lambda c, n: WHITE)
for o in buckle:
    paint(o, lambda c, n: (0.55, 0.55, 0.58, 1.0))

# ── split the body into rigid parts by face centre
NECK, HIP, SHOULDER_X = 0.98, 0.36, 0.26
parts = {
    'dp_head': lambda c: c.z > NECK,
    'dp_arm_l': lambda c: c.z > HIP and c.x > SHOULDER_X,
    'dp_arm_r': lambda c: c.z > HIP and c.x < -SHOULDER_X,
    'dp_leg_l': lambda c: c.z <= HIP and c.x >= 0,
    'dp_leg_r': lambda c: c.z <= HIP and c.x < 0,
}
pivots = {
    'dp_head': Vector((0, 0, NECK)),
    'dp_torso': Vector((0, 0, HIP)),
    'dp_arm_l': Vector((0.3, 0, 0.9)),
    'dp_arm_r': Vector((-0.3, 0, 0.9)),
    'dp_leg_l': Vector((0.13, 0, HIP)),
    'dp_leg_r': Vector((-0.13, 0, HIP)),
}
mat = bpy.data.materials.new('dp_vinyl')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
vc = mat.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.42
bsdf.inputs['Metallic'].default_value = 0.0

objects = {}
for name, test in list(parts.items()) + [('dp_torso', None)]:
    o = body.copy()
    o.data = body.data.copy()
    o.name = name
    scene.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    if test is None:
        drop = [f for f in bm.faces if any(t(f.calc_center_median()) for t in parts.values())]
    else:
        drop = [f for f in bm.faces if not test(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    o.data.materials.clear()
    o.data.materials.append(mat)
    objects[name] = o
bpy.data.objects.remove(body, do_unlink=True)

for o in eyes:
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.parent = objects['dp_head']
for o in buckle:
    o.data.materials.clear()
    o.data.materials.append(mat)
    o.parent = objects['dp_torso']

# origins on the joints: move the geometry, then the object
root = bpy.data.objects.new('deadpool', None)
scene.collection.objects.link(root)
for name, o in objects.items():
    piv = pivots[name]
    o.data.transform(Matrix.Translation(-piv))
    o.location = piv
for o in eyes:
    o.data.transform(Matrix.Translation(-pivots['dp_head']))
    o.location = (0, 0, 0)
for o in buckle:
    o.data.transform(Matrix.Translation(-pivots['dp_torso']))
    o.location = (0, 0, 0)
for name in ('dp_head', 'dp_arm_l', 'dp_arm_r'):
    objects[name].parent = objects['dp_torso']
    objects[name].location = pivots[name] - pivots['dp_torso']
for name in ('dp_torso', 'dp_leg_l', 'dp_leg_r'):
    objects[name].parent = root

# a lighter mesh for phones (the head keeps its subdivided face)
for o in [o for n, o in objects.items() if n != 'dp_head']:
    dec = o.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.5
    with bpy.context.temp_override(object=o, active_object=o):
        bpy.ops.object.modifier_apply(modifier='dec')

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_vertex_color='ACTIVE', use_selection=False, export_animations=False)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'DEADPOOL_OK parts={len(objects)} triangles={tris} eyes={[tuple(round(v, 2) for v in e) for e in eye_pts]} → {OUT}')
