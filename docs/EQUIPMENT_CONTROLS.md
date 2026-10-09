# Equipment controls

Equipment Controls is inside the BIM/4D **Rigging** panel. It animates rigid parts
inside a mesh import without a skeleton. The existing whole-model transform and
path controls continue to move the equipment around the site.

## Prepare the model

Import a GLB/FBX/OBJ with separate named parts or groups. Keep the boom, dipper,
bucket, stabilisers and cylinder parts separate. A model merged into one mesh
cannot articulate individual components. Use a model without embedded animation;
equipment controls and an embedded animation must not drive the same parts.
Give each equipment import a unique filename.

The Unreal BackhoeController project informed the design: named mechanical inputs,
joint chains and automatic cylinder followers. Prosota evaluates these poses
kinematically. It does not run Unreal physics, load `.uasset` Blueprints, simulate
soil/contact forces, or infer a rig automatically from geometry.

## Set up once

1. In Rigging → Equipment Controls, select the imported model and create a rig.
2. Add named controls, or use **Backhoe control names**. This creates labels and
   default inputs, not calibrated joint geometry. Each control has a 0–1 slider.
3. In **Joint setup**, add a hinge or slide for each driven part. Choose its parent
   joint: for example swing → boom → dipper → bucket. Sibling meshes in the source
   file can be connected this way without changing their import hierarchy.
4. Enter each hinge pivot and motion axis in the imported model's **root coordinate
   system**, before Prosota's scene up-axis conversion. Slide distances use the
   source model's units; hinge limits use degrees. The axis is normalized.
5. Set the endpoints labelled **At 0 / At 1**. The control's **Model's rest value**
   identifies the normalized input matching the imported geometry's pose. Thus a
   centred swing can have rest 0.5; neither loading nor resetting introduces a jump.
6. Link several joints to the same control to coordinate stabilisers or linkages.
   Optional response curves are increasing input positions with 0–1 output values,
   entered as `0:0, 0.5:0.25, 1:1`. Output may increase or decrease between points.
7. Add hydraulic cylinders: choose barrel/piston parts, base/tip attachment parts,
   and points expressed in each attachment part's local coordinates. Barrel and
   piston aim along the attachment line and slide with their respective endpoints.
   Their imported offsets and sizes are preserved; geometry is not stretched.
8. Save the rig. Invalid/missing parts, zero axes, cycles, conflicting drivers and
   follower feedback are rejected. An incomplete edit keeps the last valid pose
   while showing the reason it cannot yet be saved.

One part has one driver. A driven part nested beneath another driven part must
inherit that ancestor in its joint chain. Cylinder followers cannot be ancestors
of another mechanism or drive their own attachment references. Physical cylinder
stroke/contact limits are not simulated; calibrate the joint ranges accordingly.

## Animate

Move the Timeline playhead or use the equipment panel's local date/time input.
Adjust a slider and press **◆ Key** to key that control at the exact time. Sliders
preview immediately. Moving the playhead resumes interpolation. Unkeyed values
are saved as a static equipment pose; changing a keyed slider requires **◆ Key**
to change that time's animation.

Expand **Control setup & keyframes** to change key time, value and interpolation:
linear, smooth easing or hold. Interpolation is selected on the outgoing key.
Values before/after the track hold its first/last key. No keys means the saved
unkeyed value. **Rest pose** previews the calibrated imported pose.

Use **Save rig & keys** after editing. The Timeline includes named equipment
control tracks: click a diamond to seek, drag to retime and select/delete a key.
Timeline changes save immediately; they are disabled while setup edits are pending.
The overall timeline range includes equipment keys, even without schedule activities.
Saved definitions use version checks to prevent another tab silently overwriting them.

Equipment evaluation composes after whole-model schedule/path movement and
supports backward seeking without accumulated transform drift. Comparison panes
mirror the internal equipment pose while retaining their own root/schedule state.
Video capture uses the same timeline evaluation.

## Reuse

Export a reusable JSON preset, select another imported equipment model, create its
rig, then import the preset. Presets include controls, joint hierarchy, limits,
response curves and cylinder bindings; they omit project keyframes and reset
controls to rest. Matching uses structural node paths and names, never transient
Three.js UUIDs. Matching geometry works on reload; changed/missing paths require
explicit rebinding in joint/cylinder setup. Renaming/reordering source model parts
may require rebinding. Presets do not contain geometry or Unreal assets.

## Validation and deployment

- Migration `e8c395fd0123` creates `equipment_rigs`; deploy migrations before the UI.
- Equipment API access is restricted to the project owner; changes are versioned.
- `node --test tests/equipmentRig.test.mjs` (frontend): hierarchy, curves, calibrated
  rest, interpolation, multiple cylinders, backward evaluation, malformed rigs,
  stable node paths, nested mesh transforms and zero-scale schedule roots.
- `python -m pytest tests/test_equipment_rigs.py -q` (backend): CRUD, stale writes,
  duplicate bindings, validation, ownership and migration upgrade/downgrade.
- `tests/equipment-smoke.html` under local Vite is a synthetic rigid-model browser
  fixture for sliders, key insertion, interpolation, tracks and light/dark themes.

The actual Unreal backhoe's mesh export and numerical pivot/limit calibration have
not been imported into Prosota by this implementation. Configure its exported rigid
parts using the workflow above; the feature does not claim a pre-calibrated backhoe.

## Assembling separate imports (2026-10-09)
In Rigging > Equipment Controls > Assemble separate imports, enter a unique name,
select the machine's imports (Select all is available), then Assemble. This saves
one GLB with individually addressable parts at their current world positions.
It selects the new import; click Create equipment rig, then configure controls,
joints and cylinder followers normally. No Blender re-export is required.

Original files are retained and hidden, including after reload. Show All can
reveal these backups. The new copy does not inherit schedule links, paths or
keyframes from the source files. Configure those on the assembled equipment.
Assembly requires saved imports with unique filenames and rigid, non-animated
geometry. Zero-scale or sheared root transforms are rejected with a message.
