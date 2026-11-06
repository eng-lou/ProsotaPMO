# 3D construction parts and schedules

For an assembly already placed in a project:

1. Select the assembly in **3D Site tools**.
2. Open **Construction parts**. Use **Source files / top-level groups** to retain
   the original construction pieces, or **Individual meshes** for finer detail.
3. Review the names, then **Extract independent parts**. Their assembled layout
   remains; each part becomes selectable and linkable. The library copy remains
   available, and Undo restores the original placement.
4. Click a part and use **Activity links & profiles** to link it to existing work.
   Alternatively, choose **Schedule this assembly’s parts** or **Generate Schedule**.
5. Review the checked objects, task names, working hours, calendar and order.
   Exclude a base or surrounding scenery if it should stay visible throughout.
   Previously linked objects begin unchecked to avoid accidental additional links.
6. Choose **Drop into place**, **Fade in**, the activity default, or a saved profile.
   Generate the activities and links, then play the ordinary Animation Timeline.

For new multi-file imports, **Independent construction parts** is selected by
default. Place the collection together and Save. **One equipment / model assembly**
retains the existing whole-machine rigging workflow. A single GLB can also be
placed as independent parts if it contains separate groups/meshes.

The generated schedule is a reviewed draft: durations are user inputs. It does not
infer IFC categories, quantities or production rates. The resulting activities
support ordinary resource/cost assignments and operational methods in Simulator.

Animated/skinned assets stay whole; extracting static parts cannot transfer their
rig. Whole-assembly activity links, rig, movement path or transform keys must be
removed before extraction to avoid leaving them attached to an object that no
longer exists. Clear whole-object custom material overrides before extraction;
authored materials are retained, and custom overrides can be applied to the
individual parts afterwards.
Parts share the original immutable asset and retain their own source references,
so they survive saving, reopening and portable backup. Independent site objects
have no fixed count limit; large assemblies retain their separate selectable and
schedulable parts. Performance depends on geometry, materials and hardware.
Generated fence/array limits are separate from imported construction parts.
Geometry already merged into one mesh cannot be recovered as its original
components automatically.
