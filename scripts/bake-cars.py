"""
Car bake pipeline (Blender 4.5, headless).

  blender -b --factory-startup -P scripts/bake-cars.py -- <intermediate.glb> <out_dir> '<spec json>'

Input: wheel-tagged, uncompressed GLB from `node scripts/optimize-glb.mjs --intermediate`.
Output: <out_dir>/<model>.rig.glb — still multi-material; `scripts/atlas-cars.mjs` then packs the
original textures into one atlas and merges each body LOD into a single primitive.

  rig            armature: root + wheel_FL / wheel_FR / wheel_RL / wheel_RR (bone head = wheel centre)
  body_LOD0..2   skinned mesh per LOD (original materials),
                   COLOR_0: R = paint mask, G = head lights, B = brake lights, A = baked ambient occlusion
  glass_LOD0..2  one mesh per LOD, material `spg_glass`

Car space: +Z (glTF) forward, +X left, ground at y = 0.
"""
import bpy, bmesh, sys, json, math, re, os, time
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT_DIR, SPEC = argv[0], argv[1], json.loads(argv[2])
NAME = SPEC['model']
LODS = SPEC.get('lods', [60000, 14000, 3500])
AO_SAMPLES = int(SPEC.get('aoSamples', 24))
PAINT = [p.lower() for p in SPEC.get('paint', [])]
LENGTH = float(SPEC['length'])
os.makedirs(OUT_DIR, exist_ok=True)
T0 = time.time()

WHEEL_RE = re.compile(r'^spgwheel_(\d+)')
BRAKE_RE = re.compile(r'red_glass|glassred|lightglass_red|light_red|brake|tail|rearlight|lightglassnormal_outerred', re.I)
HEAD_RE = re.compile(r'lightglassnormal_clear|light_clear|headlight|lightd|lightemissive|^lighta|lighta_material', re.I)
GLASS_RE = re.compile(r'glass|window|windscreen|windshield', re.I)


def log(*a):
    print(f'[bake {NAME} {time.time() - T0:6.1f}s]', *a, flush=True)


def principled(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return None


def classify(mat):
    raw = mat.name if mat else ''
    nm = raw.lower()
    m = WHEEL_RE.match(raw)
    if m:
        return 'wheel', int(m.group(1))
    if BRAKE_RE.search(nm):
        return 'rear', 0
    if HEAD_RE.search(nm):
        return 'head', 0
    if any(p in nm for p in PAINT):
        return 'paint', 0
    p = principled(mat)
    blended = getattr(mat, 'surface_render_method', '') == 'BLENDED' or getattr(mat, 'blend_method', '') == 'BLEND'
    alpha_linked = bool(p and p.inputs['Alpha'].is_linked)
    alpha_val = p.inputs['Alpha'].default_value if p else 1.0
    if blended and not alpha_linked and alpha_val < 0.05:
        return 'hidden', 0  # fully transparent helper surfaces (inner window sides, shadow planes)
    if alpha_linked and not GLASS_RE.search(nm):
        return 'cutout', 0
    if GLASS_RE.search(nm) or (blended and alpha_val < 0.98):
        return 'glass', 0
    return 'rest', 0


# ───────────────────────────────────────────── import + flatten transforms
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy()
    if o.data.users > 1:
        o.data = o.data.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in [o for o in scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)

with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes, selected_objects=meshes):
    bpy.ops.object.join()
car = meshes[0]
car.name = 'car_full'
log('joined', len(car.data.polygons), 'polys', len(car.data.materials), 'materials')

# ───────────────────────────────────────────── normalise orientation / scale
co = np.empty(len(car.data.vertices) * 3, np.float32)
car.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
size = mx - mn
rot = Matrix.Identity(4)
if size[0] > size[1]:
    rot = Matrix.Rotation(math.radians(90), 4, 'Z')
car.data.transform(rot)
co = np.empty(len(car.data.vertices) * 3, np.float32)
car.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
scale = LENGTH / max(1e-6, (mx - mn)[1])
centre = (mn + mx) / 2
car.data.transform(Matrix.Diagonal((scale, scale, scale, 1.0)) @ Matrix.Translation((-centre[0], -centre[1], -mn[2])))
log('normalised: scale', round(scale, 4))

# ───────────────────────────────────────────── classify materials, masks, wheel groups
slot_class = [classify(m) for m in car.data.materials]
counts = {}
for c, _ in slot_class:
    counts[c] = counts.get(c, 0) + 1
log('material classes', counts)

bm = bmesh.new()
bm.from_mesh(car.data)
bmesh.ops.triangulate(bm, faces=bm.faces[:])
glass_faces = [f for f in bm.faces if slot_class[f.material_index][0] == 'glass']
# glass → its own object
glass_bm = bmesh.new()
bm_glass_copy = bm.copy()
bmesh.ops.delete(bm_glass_copy, geom=[f for f in bm_glass_copy.faces if slot_class[f.material_index][0] != 'glass'], context='FACES')
bmesh.ops.delete(bm, geom=glass_faces + [f for f in bm.faces if slot_class[f.material_index][0] == 'hidden'], context='FACES')

# wheel centres
wheel_verts = {}
for f in bm.faces:
    c, idx = slot_class[f.material_index]
    if c == 'wheel':
        wheel_verts.setdefault(idx, set()).update(v.index for v in f.verts)
bm.verts.ensure_lookup_table()
wheel_centre = {}
for idx, vs in wheel_verts.items():
    pts = np.array([bm.verts[i].co[:] for i in vs])
    wheel_centre[idx] = (pts.min(0) + pts.max(0)) / 2
wheel_name = {}
for idx, c in wheel_centre.items():
    side = 'L' if c[0] > 0 else 'R'
    end = 'F' if c[1] < 0 else 'R'
    wheel_name[idx] = f'wheel_{end}{side}'
log('wheels', {wheel_name[i]: [round(float(x), 2) for x in c] for i, c in wheel_centre.items()})
rigged = len(set(wheel_name.values())) == 4

body = car
bm.to_mesh(body.data)
bm.free()
glass = bpy.data.objects.new('glass_full', bpy.data.meshes.new('glass_full'))
scene.collection.objects.link(glass)
bm_glass_copy.to_mesh(glass.data)
bm_glass_copy.free()
glass_colors = []
for m in body.data.materials:
    if classify(m)[0] == 'glass':
        p = principled(m)
        if p:
            glass_colors.append(list(p.inputs['Base Color'].default_value))
glass_rgb = np.mean(np.array(glass_colors), axis=0)[:3].tolist() if glass_colors else [0.05, 0.06, 0.08]

# vertex groups + colour mask on the body
groups = {'root': body.vertex_groups.new(name='root')}
for n in sorted(set(wheel_name.values())):
    groups[n] = body.vertex_groups.new(name=n)
mask = body.data.color_attributes.new(name='mask', type='FLOAT_COLOR', domain='CORNER')
wheel_of_vert = {}
for poly in body.data.polygons:
    c, idx = slot_class[poly.material_index]
    col = (1.0 if c == 'paint' else 0.0, 1.0 if c == 'head' else 0.0, 1.0 if c == 'rear' else 0.0, 1.0)
    for li in poly.loop_indices:
        mask.data[li].color = col
    if c == 'wheel' and rigged:
        for vi in poly.vertices:
            wheel_of_vert[vi] = wheel_name[idx]
for g in groups.values():
    pass
root_idx = [v.index for v in body.data.vertices if v.index not in wheel_of_vert]
groups['root'].add(root_idx, 1.0, 'REPLACE')
by_wheel = {}
for vi, n in wheel_of_vert.items():
    by_wheel.setdefault(n, []).append(vi)
for n, vs in by_wheel.items():
    groups[n].add(vs, 1.0, 'REPLACE')
body.data.color_attributes.active_color = mask
log('body tris', len(body.data.polygons), 'glass tris', len(glass.data.polygons))

# ───────────────────────────────────────────── ambient occlusion → vertex colours
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = AO_SAMPLES
if scene.world is None:
    scene.world = bpy.data.worlds.new('w')
scene.world.light_settings.distance = 0.4
ao_attr = body.data.color_attributes.new(name='ao', type='FLOAT_COLOR', domain='CORNER')
body.data.color_attributes.active_color = ao_attr
for o in scene.objects:
    o.select_set(False)
bpy.context.view_layer.objects.active = body
body.select_set(True)
t = time.time()
with bpy.context.temp_override(active_object=body, selected_objects=[body], selected_editable_objects=[body], object=body):
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
log('baked AO to vertex colours', f'{time.time() - t:.1f}s')
# adding a colour attribute reallocates the attribute array → Python refs made before are dangling (segfault)
ao_attr = body.data.color_attributes['ao']
mask = body.data.color_attributes['mask']
n_loops = len(body.data.loops)
aov = np.empty(n_loops * 4, np.float32)
ao_attr.data.foreach_get('color', aov)
mk = np.empty(n_loops * 4, np.float32)
mask.data.foreach_get('color', mk)
mk = mk.reshape(-1, 4)
mk[:, 3] = 0.35 + 0.65 * aov.reshape(-1, 4)[:, 0]
mask.data.foreach_set('color', mk.ravel())
body.data.color_attributes.remove(ao_attr)
body.data.color_attributes.active_color = body.data.color_attributes['mask']
for uv in list(body.data.uv_layers)[1:]:
    body.data.uv_layers.remove(uv)

glass_mat = bpy.data.materials.new('spg_glass')
glass_mat.use_nodes = True
gp = glass_mat.node_tree.nodes['Principled BSDF']
gp.inputs['Base Color'].default_value = (*glass_rgb, 1.0)
gp.inputs['Roughness'].default_value = 0.05
gp.inputs['Metallic'].default_value = 0.1
gp.inputs['Alpha'].default_value = 0.45
if hasattr(glass_mat, 'surface_render_method'):
    glass_mat.surface_render_method = 'BLENDED'
glass.data.materials.clear()
glass.data.materials.append(glass_mat)
for uv in list(glass.data.uv_layers):
    glass.data.uv_layers.remove(uv)
# drop material slots the body no longer uses (glass) so the exporter does not emit them
used = sorted({p.material_index for p in body.data.polygons})
remap = {old: new for new, old in enumerate(used)}
mats = [body.data.materials[i] for i in used]
new_idx = np.array([remap[p.material_index] for p in body.data.polygons], np.int32)
body.data.materials.clear()  # clear() resets every polygon's material_index to 0 …
for m in mats:
    body.data.materials.append(m)
body.data.polygons.foreach_set('material_index', new_idx)  # … so restore them afterwards
body.data.update()

# ───────────────────────────────────────────── rig
rig = None
if rigged:
    arm = bpy.data.armatures.new('rig')
    rig = bpy.data.objects.new('rig', arm)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in scene.objects:
        o.select_set(o == rig)
    bpy.ops.object.mode_set(mode='EDIT')
    rb = arm.edit_bones.new('root')
    rb.head = (0, 0, 0)
    rb.tail = (0, 0, 0.5)
    for idx, c in wheel_centre.items():
        b = arm.edit_bones.new(wheel_name[idx])
        b.head = Vector(c.tolist())
        b.tail = Vector(c.tolist()) + Vector((0.0, 0.0, 0.3))
        b.parent = rb
    bpy.ops.object.mode_set(mode='OBJECT')

# ───────────────────────────────────────────── LODs
body_tris = len(body.data.polygons)
glass_tris = len(glass.data.polygons)
total = body_tris + glass_tris
lod_objects = []
for li, target in enumerate(LODS):
    for src, kind in ((body, 'body'), (glass, 'glass')):
        o = src.copy()
        o.data = src.data.copy()
        o.name = f'{kind}_LOD{li}'
        o.data.name = o.name
        scene.collection.objects.link(o)
        share = (body_tris if kind == 'body' else glass_tris) / max(1, total)
        n = len(o.data.polygons)
        ratio = min(1.0, (target * share) / max(1, n))
        if ratio < 0.999 and n > 0:
            mod = o.modifiers.new('dec', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = ratio
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.object.modifier_apply(modifier='dec')
        if kind == 'body' and rig:
            am = o.modifiers.new('rig', 'ARMATURE')
            am.object = rig
            o.parent = rig
        lod_objects.append(o)
        log(o.name, len(o.data.polygons), 'tris')
bpy.data.objects.remove(body, do_unlink=True)
bpy.data.objects.remove(glass, do_unlink=True)

# ───────────────────────────────────────────── export
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())


def export(path):
    kw = dict(filepath=path, export_format='GLB', export_skins=True, export_animations=False, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
              export_extras=False, export_def_bones=False, export_rest_position_armature=True, use_selection=False,
              export_apply=False, export_colors=True)
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
    log('exported', path, os.path.getsize(path) // 1024, 'KB')


export(os.path.join(OUT_DIR, f'{NAME}.rig.glb'))
print('BAKE_OK', NAME, json.dumps({'body_tris': body_tris, 'glass_tris': glass_tris, 'rigged': rigged, 'classes': counts}), flush=True)
