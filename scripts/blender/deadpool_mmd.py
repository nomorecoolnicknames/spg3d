"""The boss-fight hero: «Deadpool MMD PORT FBX» by Izann2842_o (Sketchfab, CC BY 4.0) — the owner's file
release/deadpool_mmd_port_fbx.glb (52k triangles, 251-joint MMD rig, 2048² PNGs) turned into a light game skin.

    blender -b --factory-startup -P scripts/blender/deadpool_mmd.py -- <out.glb> [preview.png]
    npx gltf-transform webp <out.glb> /mnt/ramdisk/deadpool-mmd/webp.glb --quality 88
    npx gltf-transform meshopt /mnt/ramdisk/deadpool-mmd/webp.glb src/assets/deadpool.glb --level medium

- rig: the Japanese bone names were lost to mojibake, so the humanoid chain is found from the hierarchy and the
  joint positions and renamed hips, spine, chest, neck, head, shoulder_l/r, upperarm_l/r, forearm_l/r, hand_l/r,
  thigh_l/r, shin_l/r, foot_l/r (l = the character's left = glTF +X). The other bones keep their names;
  bones without weights in their whole subtree (IK targets, "_end" tips, hand item sockets, dummy/shadow
  helpers) are removed. The model has no animations: the game poses the bones procedurally.
- weapons: the katanas crossed on the back and the pistols in the thigh holsters stay (skinned to the chest and
  the thighs, they move with the body). Dropped: the two shotguns hanging behind the buttocks (skinned to
  opposite thighs, they cut through each other as soon as the legs swing) and the sai on the calves (5k
  triangles for a detail that is a few pixels in the game).
- parts that share a texture set are joined into one mesh with one material — body (arms, body, face, wrists,
  eyes), pistols, katanas, straps — 4 draw calls
- decimated to ≈ 18k triangles, the face least; textures: body 1024², the rest 512²
- 1.8 m tall, feet on y = 0, facing glTF +Z, transforms applied
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/mnt/ramdisk/deadpool-mmd/deadpool.raw.glb'
PREVIEW = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(OUT), 'preview.png')
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'release', 'deadpool_mmd_port_fbx.glb')
HEIGHT = 1.8

# source material → (output part, decimate ratio)
PARTS = {
    'Face': ('body', 0.8),
    'Eyes': ('body', 1.0),
    'Body': ('body', 0.65),
    'Arms': ('body', 0.6),
    'Wrists': ('body', 1.0),
    'Straps': ('straps', 0.45),
    'Straps_Metal': ('straps', 0.4),
    'Gun_Hip_R': ('pistols', 0.18),
    'Gun_Hip_L': ('pistols', 0.18),
    'Sword_R': ('katanas', 0.4),
    'Sword_L': ('katanas', 0.4),
}
TEXTURE_SIZE = {'body': 1024, 'straps': 512, 'pistols': 512, 'katanas': 512}

bpy.ops.wm.read_factory_settings(use_empty=True)
# the joint nodes hold the bind pose; guessing it from the inverse bind matrices trips over the weightless
# helpers, whose matrices are garbage
bpy.ops.import_scene.gltf(filepath=SRC, guess_original_bind_pose=False, disable_bone_shape=True)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')

# ---------------------------------------------------------------- flatten the Sketchfab node chain
for o in [o for o in scene.objects if o.type in ('ARMATURE', 'MESH')]:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in scene.objects if o.type not in ('ARMATURE', 'MESH')]:
    bpy.data.objects.remove(o, do_unlink=True)
for o in [o for o in scene.objects if o.type == 'MESH' and not any(m.type == 'ARMATURE' for m in o.modifiers)]:
    bpy.data.objects.remove(o, do_unlink=True)
for o in [o for o in scene.objects if o.type == 'MESH' and o.active_material.name not in PARTS]:
    print('drop mesh', o.active_material.name, len(o.data.polygons))
    bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in scene.objects if o.type == 'MESH']


def apply_transforms(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


apply_transforms([arm] + meshes)

# ---------------------------------------------------------------- scale: 1.8 m, feet on the ground
zs = np.concatenate([np.array([v.co.z for v in o.data.vertices]) for o in meshes])
lo, hi = float(zs.min()), float(zs.max())
k = HEIGHT / (hi - lo)
fit = Matrix.Translation((0, 0, -lo * k)) @ Matrix.Scale(k, 4)
for o in [arm] + meshes:
    o.matrix_world = fit @ o.matrix_world
apply_transforms([arm] + meshes)

# ---------------------------------------------------------------- find the humanoid bones
weight = {}
for o in meshes:
    names = {g.index: g.name for g in o.vertex_groups}
    for v in o.data.vertices:
        for g in v.groups:
            if g.weight > 1e-4:
                weight[names[g.group]] = weight.get(names[g.group], 0.0) + g.weight
bones = arm.data.bones


def w(b):
    return weight.get(b.name, 0.0)


def heavy(b):
    return w(b) > 0 or any(heavy(c) for c in b.children)


def head(b):
    return b.head_local


def next_down(b):
    """the next joint of a leg: the weighted child with the lowest head"""
    kids = [c for c in b.children if w(c) > 0]
    return min(kids, key=lambda c: head(c).z) if kids else None


def next_out(b):
    """the next joint of an arm: the weighted child furthest from the midline"""
    kids = [c for c in b.children if w(c) > 0]
    return max(kids, key=lambda c: abs(head(c).x)) if kids else None


legs = []
for b in bones:
    if w(b) == 0 or abs(head(b).x) < 0.03 * HEIGHT or not 0.5 * HEIGHT < head(b).z < 0.7 * HEIGHT:
        continue
    shin = next_down(b)
    foot = shin and next_down(shin)
    if foot and 0.25 * HEIGHT < head(shin).z < 0.45 * HEIGHT and head(foot).z < 0.1 * HEIGHT:
        legs.append((b, shin, foot))
arms = []
for b in bones:
    if w(b) == 0 or head(b).x == 0:
        continue
    chain = [b]
    while len(chain) < 4 and chain[-1] and next_out(chain[-1]):
        chain.append(next_out(chain[-1]))
    # shoulder → upper arm → forearm → hand, each further out, and a hand has fingers
    if len(chain) == 4 and all(abs(head(chain[i + 1]).x) > abs(head(chain[i]).x) for i in range(3)) \
            and sum(1 for c in chain[3].children if heavy(c)) >= 5:
        arms.append(chain)
assert len(legs) == 2 and legs[0][0].parent == legs[1][0].parent, legs
assert len(arms) == 2 and arms[0][0].parent == arms[1][0].parent, arms
hips = legs[0][0].parent
chest = arms[0][0].parent
spine = chest
while spine.parent and spine.parent != hips.parent:
    spine = spine.parent
assert spine.parent == hips.parent and spine != chest, 'the upper body does not branch off beside the hips'
neck = next(c for c in chest.children if w(c) > 0 and abs(head(c).x) < 0.005 * HEIGHT and head(c).z > head(chest).z)
# down the neck to the face rig: the head is the joint just before the bone that fans out into the face
fan = neck
while len([c for c in fan.children if heavy(c)]) == 1:
    fan = next(c for c in fan.children if heavy(c))
head_bone = fan.parent
assert head_bone != chest and len([c for c in fan.children if heavy(c)]) >= 3, 'no face rig under the neck'

rename = {hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head_bone: 'head'}
for leg in legs:
    s = 'l' if head(leg[0]).x > 0 else 'r'
    rename.update({leg[0]: f'thigh_{s}', leg[1]: f'shin_{s}', leg[2]: f'foot_{s}'})
for chain in arms:
    s = 'l' if head(chain[0]).x > 0 else 'r'
    rename.update({chain[0]: f'shoulder_{s}', chain[1]: f'upperarm_{s}', chain[2]: f'forearm_{s}', chain[3]: f'hand_{s}'})
assert len(set(rename.values())) == 19
drop = [b.name for b in bones if not heavy(b)]
for b, new in rename.items():
    print('BONE', new, '<-', repr(b.name), 'head', tuple(round(x, 3) for x in head(b)), 'weight', round(w(b), 1))
    b.name = new  # renames the vertex groups too

# ---------------------------------------------------------------- prune weightless bones
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name in drop:
    arm.data.edit_bones.remove(arm.data.edit_bones[name])
bpy.ops.object.mode_set(mode='OBJECT')
print('bones', len(arm.data.bones), 'removed', len(drop))
for o in meshes:
    for g in [g for g in o.vertex_groups if g.name not in arm.data.bones]:
        o.vertex_groups.remove(g)

# ---------------------------------------------------------------- weld, decimate, join by texture set
for o in meshes:
    src = o.active_material.name
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()
    ratio = PARTS[src][1]
    if ratio < 1:
        dec = o.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_move_to_index(modifier=dec.name, index=0)
            bpy.ops.object.modifier_apply(modifier=dec.name)
    if o.data.has_custom_normals:
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for p in o.data.polygons:
        p.use_smooth = True
    # hard edges on the hardware, one smooth skin on the body
    if PARTS[src][0] != 'body':
        o.data.set_sharp_from_angle(angle=math.radians(40))
    print('mesh', src, 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))

parts = {}
for o in meshes:
    parts.setdefault(PARTS[o.active_material.name][0], []).append(o)
joined = []
for part, objs in parts.items():
    main = max(objs, key=lambda o: len(o.data.polygons))
    mat = main.active_material
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = main
    if len(objs) > 1:
        bpy.ops.object.join()
    main.data.materials.clear()
    main.data.materials.append(mat)
    for p in main.data.polygons:
        p.material_index = 0
    main.name = main.data.name = mat.name = f'deadpool_{part}'
    # textures of the part: base colour + normal map, downscaled
    for node in mat.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            img = node.image
            size = TEXTURE_SIZE[part]
            if max(img.size) > size:
                f = size / max(img.size)
                img.scale(max(1, round(img.size[0] * f)), max(1, round(img.size[1] * f)))
                img.pack()
            img.name = f'deadpool_{part}_{"normal" if img.colorspace_settings.name == "Non-Color" else "color"}'
            print('texture', img.name, tuple(img.size))
    joined.append(main)
meshes = joined
for o in meshes:
    o.parent = arm
    o.matrix_parent_inverse = Matrix.Identity(4)
arm.name = arm.data.name = 'deadpool'
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print('TRIS', tris)
assert tris <= 22000, tris

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_animations=False, export_tangents=False, export_yup=True,
    export_skins=True, export_influence_nb=4, export_leaf_bone=False, export_extras=False, export_apply=False,
)
print('EXPORT_OK', OUT, os.path.getsize(OUT))

# ---------------------------------------------------------------- preview: bind pose front + 3/4, and a test pose
def pose_test():
    """swing the renamed bones about world axes through their heads: bad weights show up as torn skin"""
    moves = [('thigh_l', 'X', -0.8), ('shin_l', 'X', 1.0), ('thigh_r', 'X', 0.6), ('upperarm_r', 'Y', 1.1),
             ('forearm_r', 'X', -1.4), ('upperarm_l', 'X', -0.9), ('spine', 'X', 0.25), ('head', 'Z', 0.5)]
    for name, axis, ang in moves:
        pb = arm.pose.bones[name]
        h = arm.matrix_world @ pb.head
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(ang, 4, axis) @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()


scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'TEXTURE'
shading.show_cavity = False
scene.render.resolution_x, scene.render.resolution_y = 320, 720
world = bpy.data.worlds.new('preview')
scene.world = world
world.color = (0.2, 0.22, 0.26)
cam = bpy.data.objects.new('preview_cam', bpy.data.cameras.new('preview_cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = HEIGHT * 1.08
centre = Vector((0, 0, HEIGHT / 2))
tiles = []
for label, ang, posed in (('front', 0, False), ('q34', 35, False), ('posed', 20, True), ('back', 160, True)):
    if posed and label == 'posed':
        pose_test()
    a = math.radians(ang)
    cam.location = centre + Vector((math.sin(a), -math.cos(a), 0.15)) * 10
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    path = f'{os.path.splitext(PREVIEW)[0]}-{label}.png'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(320 * 720 * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    tiles.append(px.reshape(720, 320, 4))
grid = bpy.data.images.new('preview', 1280, 720)
grid.pixels.foreach_set(np.concatenate(tiles, axis=1).ravel())
grid.filepath_raw = PREVIEW
grid.file_format = 'PNG'
grid.save()
print('PREVIEW_OK', PREVIEW)
