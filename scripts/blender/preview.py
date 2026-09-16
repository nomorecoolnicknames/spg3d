"""Render a preview of what is in the live Blender scene (scripts/blender/mcp.py code preview.py).

Environment (passed by setting globals before exec, or edited in place):
  PREVIEW_OUT   png path            PREVIEW_TARGET  x,y,z of the look-at point
  PREVIEW_CAM   x,y,z of the camera PREVIEW_RES     width,height
"""
import math
import os

import bpy
from mathutils import Vector

OUT = os.environ.get('PREVIEW_OUT', '/mnt/ramdisk/preview.png')
CAM = [float(v) for v in os.environ.get('PREVIEW_CAM', '9,-11,5').split(',')]
TARGET = [float(v) for v in os.environ.get('PREVIEW_TARGET', '0,0,1.2').split(',')]
RES = [int(v) for v in os.environ.get('PREVIEW_RES', '900,600').split(',')]
SAMPLES = int(os.environ.get('PREVIEW_SAMPLES', '48'))

scene = bpy.context.scene
for name in ('preview_cam', 'preview_sun', 'preview_fill', 'preview_ground'):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

cam_data = bpy.data.cameras.new('preview_cam')
cam_data.lens = 50
cam = bpy.data.objects.new('preview_cam', cam_data)
scene.collection.objects.link(cam)
cam.location = CAM
cam.rotation_euler = (Vector(TARGET) - Vector(CAM)).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

sun_data = bpy.data.lights.new('preview_sun', 'SUN')
sun_data.energy = 4.0
sun_data.angle = 0.06
sun = bpy.data.objects.new('preview_sun', sun_data)
scene.collection.objects.link(sun)
sun.location = (6, -8, 12)
sun.rotation_euler = (math.radians(52), 0, math.radians(35))

fill_data = bpy.data.lights.new('preview_fill', 'AREA')
fill_data.energy = 600
fill_data.size = 8
fill = bpy.data.objects.new('preview_fill', fill_data)
scene.collection.objects.link(fill)
fill.location = (-7, -9, 6)
fill.rotation_euler = (math.radians(65), 0, math.radians(-40))

mesh = bpy.data.meshes.new('preview_ground')
mesh.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
ground = bpy.data.objects.new('preview_ground', mesh)
scene.collection.objects.link(ground)
gm = bpy.data.materials.get('preview_ground_mat') or bpy.data.materials.new('preview_ground_mat')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.17, 0.18, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
mesh.materials.append(gm)

world = scene.world or bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.24, 0.31, 0.42, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('PREVIEW_OK', OUT)
