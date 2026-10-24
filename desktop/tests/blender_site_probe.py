"""Synthetic preparation feasibility probe, run by Blender in factory background mode.

No user assets, preferences, add-ons or original .blend files are modified.
This proves a narrow export route, not the complete managed worker contract.
"""
import bpy
import json
import sys
from pathlib import Path

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
ordinary = bpy.context.object
ordinary.name = 'Ordinary_2m_fixture'
bpy.ops.mesh.primitive_cube_add(size=2, location=(3, 0, 1))
modified = bpy.context.object
modified.name = 'Bevel_fixture'
bevel = modified.modifiers.new('Test bevel', 'BEVEL')
bevel.width = .1
bevel.segments = 2
mesh = bpy.data.meshes.new('GN host')
generated = bpy.data.objects.new('GeometryNodes_fixture', mesh)
bpy.context.collection.objects.link(generated)
generated.location = (6, 0, 1)
group = bpy.data.node_groups.new('Synthetic cube generator', 'GeometryNodeTree')
group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
cube = group.nodes.new('GeometryNodeMeshCube')
cube.inputs['Size'].default_value = (2, 2, 2)
out = group.nodes.new('NodeGroupOutput')
group.links.new(cube.outputs['Mesh'], out.inputs['Geometry'])
modifier = generated.modifiers.new('Synthetic nodes', 'NODES')
modifier.node_group = group
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
records = []
for obj in (ordinary, modified, generated):
    evaluated = obj.evaluated_get(depsgraph)
    records.append({'name': obj.name, 'dimensions_m': list(evaluated.dimensions), 'vertices': len(evaluated.data.vertices)})
assert records[0]['vertices'] == 8
assert records[1]['vertices'] > 8
assert records[2]['vertices'] == 8
assert all(abs(d-2) < .0001 for r in records for d in r['dimensions_m'])
bpy.ops.export_scene.gltf(filepath=str(output / 'site-preparation-probe.glb'), export_format='GLB', export_apply=True)
report = {'blender': bpy.app.version_string, 'mode': 'factory background', 'fixtures': records,
          'export': 'GLB with evaluated modifiers', 'source_files_opened': 0, 'icity_tested': False,
          'managed_cancellation_and_recovery_tested': False, 'prosota_import_tested': False}
(output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('SITE_PREPARATION_PROBE_PASS')
