"""Reduce the CC0 Poly Haven tree_small_02 to a near-field instanced street tree.
blender -b --factory-startup -P scripts/blender/tree-lod.py -- source.gltf output.glb
Source and verified download manifest are kept separately; no source data is deleted.
"""
import bpy
import bmesh
import random
import sys
from mathutils import Vector

src, dest = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=src)
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for obj in meshes:
    name = obj.data.materials[0].name
    budget = 7000 if 'leaves' in name else 1800 if 'branches' in name else 1000
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    mod = obj.modifiers.new('street_lod', 'DECIMATE')
    mod.ratio = min(1, budget / triangles)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if 'leaves' in name:
        # Collapse cannot remove disconnected leaf silhouettes. Thin whole leaves deterministically,
        # then widen the survivors slightly: a hard triangle budget without tangled half-leaf triangles.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        remaining = set(bm.verts)
        islands = []
        for start in sorted(bm.verts, key=lambda v: v.index):
            if start not in remaining:
                continue
            remaining.remove(start)
            island, stack = [start], [start]
            while stack:
                for edge in stack.pop().link_edges:
                    for vertex in edge.verts:
                        if vertex in remaining:
                            remaining.remove(vertex)
                            island.append(vertex)
                            stack.append(vertex)
            islands.append(island)
        rng = random.Random(1703)
        rng.shuffle(islands)
        used, removed = 0, []
        original = sum(len(f.verts) - 2 for f in bm.faces)
        for island in islands:
            faces = {f for vertex in island for f in vertex.link_faces}
            tris = sum(len(f.verts) - 2 for f in faces)
            if used + tris > budget:
                removed.extend(island)
                continue
            used += tris
            center = sum((v.co for v in island), Vector()) / len(island)
            spread = min(1.8, (original / budget) ** 0.5 * 0.85)
            for vertex in island:
                vertex.co = center + (vertex.co - center) * spread
        bmesh.ops.delete(bm, geom=removed, context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
        print('TREE_LEAVES', len(islands), 'islands;', used, 'triangles', flush=True)
    obj.name = 'city_tree_' + name.rsplit('_', 1)[-1]
    print('TREE_LOD', obj.name, triangles, '->', len(obj.data.polygons), flush=True)
    for mat in obj.data.materials:
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Alpha'].default_value = 1
                node.inputs['Roughness'].default_value = 0.85
            if node.type == 'TEX_IMAGE' and node.image and max(node.image.size) > 1024:
                node.image.scale(1024, 1024)
# The game uses an 8.8 m reference tree. Preserve the authored branch structure and trunk root.
coords = [o.matrix_world @ Vector(p) for o in meshes for p in o.bound_box]
minz, maxz = min(p.z for p in coords), max(p.z for p in coords)
scale = 8.8 / (maxz - minz)
for obj in meshes:
    obj.location.z -= minz
    obj.location *= scale
    obj.scale *= scale
bpy.ops.export_scene.gltf(filepath=dest, export_format='GLB', export_image_format='AUTO', export_apply=True)
print('TREE_EXPORT', dest, flush=True)
