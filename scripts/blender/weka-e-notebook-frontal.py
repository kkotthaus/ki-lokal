"""Notebook frontal, freigestellt (transparenter Hintergrund, ohne Schatten), Bildschirminhalt als Textur.

    blender -b -P scripts/blender/weka-e-notebook-frontal.py -- [--preview] [--elev 20] [--name a] [--screen <png>] [--out <png>]

--elev: Kamerahöhe in Grad; der Deckel wird gleich weit geneigt, der Bildschirm bleibt frontal.
Die Kamera wird automatisch so eingepasst, dass das Notebook das Bild ausfüllt.

Vorschau: halbe Auflösung, 64 Samples. Final: 1200x1200, 256 Samples.
Aufbau nur aus Grundformen (Quader mit Bevel), Cycles + OptiX + Denoising.
"""
import argparse
import math
import sys

import bpy

ARGS = argparse.ArgumentParser()
ARGS.add_argument('--preview', action='store_true')
ARGS.add_argument('--screen', default='D:/Projekte-KI/medien/renders/weka-e/notebook-bildschirm.png')
ARGS.add_argument('--out', default=None)
ARGS.add_argument('--size', type=int, default=1200)
ARGS.add_argument('--elev', type=float, default=20)
ARGS.add_argument('--name', default='')
ARGS.add_argument('--rand', type=float, default=0.015)  # Rand je Seite, Anteil der Bildbreite
A = ARGS.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

NAME = 'notebook-frontal' + (f'-{A.name}' if A.name else '')
OUT = A.out or (f'D:/Projekte-KI/medien/renders/weka-e/{NAME}-preview.png' if A.preview
                else f'D:/Projekte-KI/medien/raw/weka-e/{NAME}.png')

# ---------- Szene leeren ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- Materialien ----------
def mat_principled(name, color, metallic=0.0, rough=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if coat and 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
    return m

ALU = mat_principled('Aluminium', (0.66, 0.67, 0.70), metallic=1.0, rough=0.38)
ALU_DUNKEL = mat_principled('Aluminium dunkel', (0.55, 0.56, 0.58), metallic=1.0, rough=0.4)
RAHMEN = mat_principled('Rahmen', (0.008, 0.008, 0.009), rough=0.42, coat=0.15)
TASTE = mat_principled('Taste', (0.01, 0.01, 0.012), rough=0.85)
SCHACHT = mat_principled('Tastaturschacht', (0.03, 0.03, 0.034), rough=0.7)
TOUCH = mat_principled('Touchpad', (0.42, 0.43, 0.46), metallic=1.0, rough=0.55)

def mat_bildschirm(pfad):
    m = bpy.data.materials.new('Bildschirm')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(pfad)
    tex.interpolation = 'Cubic'
    emi = nt.nodes.new('ShaderNodeEmission')
    emi.inputs['Strength'].default_value = 1.0
    glas = nt.nodes.new('ShaderNodeBsdfGlossy')
    glas.inputs['Roughness'].default_value = 0.05
    glas.inputs['Color'].default_value = (1, 1, 1, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.04  # leichte Spiegelung der Glasfläche
    nt.links.new(tex.outputs['Color'], emi.inputs['Color'])
    nt.links.new(emi.outputs['Emission'], mix.inputs[1])
    nt.links.new(glas.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m

BILDSCHIRM = mat_bildschirm(A.screen)

# ---------- Grundformen ----------
def quader(name, groesse, ort, mat, bevel=0.0, segmente=6, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=ort)
    o = bpy.context.active_object
    o.name = name
    o.scale = groesse
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segmente
        mod.limit_method = 'ANGLE'
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
    return o

# Maße in Metern (ca. 14-Zoll-Notebook)
B, T, H = 0.320, 0.222, 0.014       # Breite, Tiefe, Höhe Unterteil
LH, LD = 0.214, 0.006               # Deckel Höhe, Dicke

# Unterteil
quader('Unterteil', (B, T, H), (0, 0, H / 2), ALU, bevel=0.006)
# Vertiefung für die Tastatur
quader('Tastaturschacht', (0.290, 0.126, 0.0012), (0, 0.0377, H), SCHACHT, bevel=0.002)
# Tasten: 5 Reihen à 14, darunter Leertastenreihe
tb, abst = 0.0168, 0.0201
for reihe in range(5):
    y = 0.088 - reihe * abst
    for sp in range(14):
        x = -0.1307 + sp * abst
        quader(f'Taste {reihe}-{sp}', (tb, tb, 0.0016), (x, y, H + 0.0006), TASTE, bevel=0.0015, segmente=3)
y = 0.088 - 5 * abst
for x, w in [(-0.1207, 0.0368), (-0.0806, 0.0168), (0, 0.118), (0.0806, 0.0168), (0.1107, 0.0168), (0.1307, 0.0168)]:
    quader(f'Taste unten {x:.3f}', (w, tb * 0.9, 0.0016), (x, y, H + 0.0006), TASTE, bevel=0.0015, segmente=3)
# Touchpad
quader('Touchpad', (0.122, 0.072, 0.0008), (0, -0.068, H + 0.0001), TOUCH, bevel=0.004)
# Griffmulde vorne
quader('Griffmulde', (0.06, 0.004, 0.003), (0, -T / 2 + 0.0015, H - 0.0012), ALU_DUNKEL, bevel=0.0012)

# Deckel am Scharnier
bpy.ops.object.empty_add(location=(0, T / 2 - 0.006, H))
scharnier = bpy.context.active_object
scharnier.name = 'Scharnier'
deckel = quader('Deckel', (B - 0.002, LD, LH), (0, -LD / 2, LH / 2 + 0.002), RAHMEN, bevel=0.005, parent=scharnier)
# Rückseite aus Aluminium
quader('Deckel Rückseite', (B - 0.0021, LD * 0.6, LH - 0.0004), (0, -LD * 0.3 + 0.0006, LH / 2 + 0.002), ALU, bevel=0.0048, parent=scharnier)
# Bildschirm (Seitenverhältnis wie die Textur 1600x976)
sb = 0.2985
sh = sb * 976 / 1600
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -LD - 0.0002, 0.002 + 0.0105 + sh / 2 + 0.003), rotation=(math.radians(90), 0, 0))
bild = bpy.context.active_object
bild.name = 'Bildschirm'
bild.scale = (sb, sh, 1)
bild.data.materials.append(BILDSCHIRM)
bild.parent = scharnier
# Kamera-Punkt oben im Rahmen
quader('Kamera', (0.003, 0.0005, 0.003), (0, -LD - 0.0002, 0.002 + LH - 0.0055), mat_principled('Linse', (0.04, 0.05, 0.08), rough=0.1), bevel=0.0014, segmente=4, parent=scharnier)
# Deckel so weit nach hinten geneigt wie die Kamera erhöht ist -> Bildschirm frontal
scharnier.rotation_euler = (math.radians(-A.elev), 0, 0)

# ---------- Licht ----------
def flaechenlicht(name, ort, ziel, staerke, groesse):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = staerke
    d.size = groesse
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = ort
    richtung = o.constraints.new('TRACK_TO')
    richtung.target = ziel
    richtung.track_axis = 'TRACK_NEGATIVE_Z'
    richtung.up_axis = 'UP_Y'
    return o

bpy.ops.object.empty_add(location=(0, 0, 0.09))
ziel = bpy.context.active_object
ziel.name = 'Ziel'
flaechenlicht('Hauptlicht', (-1.3, -0.6, 1.5), ziel, 70, 1.2)
flaechenlicht('Fuelllicht', (1.4, -0.5, 0.9), ziel, 35, 1.4)
flaechenlicht('Kante', (0, 1.2, 1.1), ziel, 60, 1.0)

welt = bpy.data.worlds.new('Welt')
scene.world = welt
welt.use_nodes = True
hg = welt.node_tree.nodes['Background']
hg.inputs['Color'].default_value = (0.75, 0.78, 0.83, 1)
hg.inputs['Strength'].default_value = 0.45

# ---------- Kamera: frontal, Höhe per --elev, automatisch eingepasst ----------
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

scene.render.resolution_x = scene.render.resolution_y = A.size
cam_d = bpy.data.cameras.new('Kamera')
cam_d.lens = 85
cam_d.sensor_fit = 'HORIZONTAL'
cam = bpy.data.objects.new('Kamera', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
e = math.radians(A.elev)
cam.rotation_euler = (math.pi / 2 - e, 0, 0)
ziel_pkt = Vector((0, 0.03, 0.10))

def punkte():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    return pts

bpy.context.view_layer.update()
PUNKTE = punkte()
d = 1.0
for _ in range(8):
    cam.location = ziel_pkt + Vector((0, -d * math.cos(e), d * math.sin(e)))
    bpy.context.view_layer.update()
    pr = [world_to_camera_view(scene, cam, p) for p in PUNKTE]
    x0, x1 = min(p.x for p in pr), max(p.x for p in pr)
    y0, y1 = min(p.y for p in pr), max(p.y for p in pr)
    cam_d.shift_x += (x0 + x1) / 2 - 0.5
    cam_d.shift_y += (y0 + y1) / 2 - 0.5
    d *= max(x1 - x0, y1 - y0) / (1 - 2 * A.rand)
print(f'Einpassung: Abstand {d:.3f} m, Breite {x1 - x0:.3f}, Höhe {y1 - y0:.3f}')

# ---------- Rendern ----------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64 if A.preview else 256
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'  # Interface-Farben unverfälscht
scene.render.resolution_percentage = 50 if A.preview else 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('Gespeichert:', OUT)
