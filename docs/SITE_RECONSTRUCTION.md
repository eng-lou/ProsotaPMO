# Editable geographic context

Site Context now supports two separate workflows:

1. **Isolate current view** saves the current camera's six clipping planes, including the camera-frame crop. They stay fixed while orbiting and persist with the project. **Hide isolated tiles / Show isolated tiles** toggles visibility without clearing that frame, including after saving a reconstruction or reopening the panel. The top **Show isolated Google tiles** checkbox restores the same region. Only **Clear isolation / show all** explicitly resets it. A simple convex Zone with 3–64 points can also keep or remove the region inside its outline. This is live rendering isolation: Google tiles continue streaming, and no Google geometry is downloaded into a project asset.
2. **Editable 3D reconstruction** requests independent OpenStreetMap vector features for a bounded area. Preview, refine and save the native recipe into **3D Site tools**. Buildings retain mapped footprints and courtyards. Roads, rail, paving, landscape, water and vegetation have separate visibility controls. Heights, roof forms, building colours, road widths and surface colours can be edited. Saved recipes work offline and participate in normal scene revision checks, undo and backups.

## Kylemore study

Original site anchor: **53.330746, -6.345527**. Study centre: **53.329622, -6.343270**; extent: **850 × 670 m**. The centre shifts east and south to include the industrial block of interest. To use the supplied `Kylemore.prosota-context.json`, set the original site anchor, choose **Open saved reconstruction**, inspect it with **Frame Selected**, then **Save reconstruction**. Saving hides live tiles; enable them again to compare. The saved scene can be edited through Site Context or 3D Site tools.

The file contains 902 editable features, including derived parking aprons. The source query covers latitude 53.3275–53.3365 and longitude -6.353–-6.337. Full crossing ways are included, but the southern fringe of the study extends beyond the source query. That limitation is embedded in the recipe and displayed in the editor. The original service returned 502 errors for further requests; the user-approved Private.coffee mirror timed out. Missing buildings have not been invented to fill that gap.

Mapped footprints and mapped heights/floor counts are distinguished from estimates. Most building heights in this source are estimated. Roof bays, skylights, facades, parking bay positions and woodland tree positions are procedural presentation detail. Three parallel service lanes in the study have an explicitly estimated parking-aisle classification. Ground is level: this is an architectural context model, not a measured terrain or facade survey. No cars are generated. Do not use the enhanced image or Google tiles as extracted geometry or as training/reference data for this reconstruction.

## Appearance and performance

The native Three.js generator batches geometry by layer and material. With closed, individually addressable building surfaces, the current detailed study renders about **286,808 triangles in 46 material draws** before shadow/postprocessing passes. Tree foliage uses five baked views with a geometric trunk, instanced across the study; it is suited to neighbourhood views, with close-up card limitations. No per-frame scene regeneration is required while orbiting. Procedural detail is bounded; Balanced mode omits windows, skylights and markings. These counts are measured in the UI fixture, not a promised frame rate on every machine. Imported replacements use their own geometry; replacing many trees with a heavy asset can increase the cost substantially.

The standalone HTML preview uses the same geometry generator, with ambient occlusion and shadows. It is an engine preview, not a screenshot of the user's Sample project. Its view is interactive and contains the recipe and vegetation asset locally. The native component was also checked in a hidden Electron UI fixture, including edit, save failure, save, refresh and project-switch behaviour.

## Plan framing and persistent editing

In Site Context, choose **Set plan view**, pan/zoom to the area, then **Use plan frame**. This switches to top-down orthographic framing and disables orbit until **Return to orbit**. The footprint calculation accounts for the site's offsets, rotation, scale and up axis. It locates independent vector data; it does not extract imagery or tile geometry. Extents remain bounded to 100–1,500 metres per side.

Select a saved reconstruction in **3D Site tools**. Its **Reconstruction objects & surfaces** inspector stays available after saving or reopening. Click a feature in the viewport or search/filter the list. Building roofs, outside walls and courtyard walls have separate surfaces; height, roof form and numeric footprint points remain editable. Material changes can target one surface, one feature or a category. The main Materials panel also has category/surface entries instead of treating the entire reconstruction as one material.

The renderer still batches geometry for performance. Stable source feature IDs and surface ranges provide selection and editing without making each facade a separate draw call. Woodland trees have deterministic child IDs; editing one materializes only that tree's override.

## Regeneration and preservation

Open **Regenerate from map · preserve edits** in the saved reconstruction inspector. Materials, geometry and replacements are preserved by default. Each can be turned off, and the feature checklist allows selective preservation. Regeneration creates a draft for review; **Save changes** commits it as one revision-safe undoable scene command, while **Discard edits** restores the saved scene.

Matching uses source IDs. Selected features missing from a new response are retained and listed for review. If preserving face materials while refreshing geometry, unchanged wall edges are matched geometrically even when ring order changes. If the edited face cannot be identified in the new outline, the feature retains its prior geometry and is flagged. This avoids painting another wall silently. Clearing preservation explicitly uses the fresh source for that category of edit. Hidden layers and feature visibility remain part of the saved recipe.

Boolean results are independent saved assets. Regeneration of the source reconstruction does not rewrite them. When an operation hides a source feature, that visibility persists through preservation so the original does not reappear over its result.

## Replacement and Blender refinement

**Replace object / instances** accepts an imported asset from the project library. Replace one selected feature/site object/generated instance, or all matching instances with the displayed count. Matching uses the same imported asset or generated type; locked objects are skipped. Position/orientation remain, with a choice to fit existing size. Reconstructed trees and generated instances fit height while preserving the imported asset's proportions. Replacement starts at the asset's static pose: old path motion, animation and equipment rigs are not transferred. Undo restores the previous state.

Export a selected reconstruction feature or the complete reconstruction as **GLB**. The file uses metres, with named type → feature → surface groups and stable feature metadata. An individual export is centred at its base for editing. Refine it in Blender, export GLB, then import it normally through the **Asset library**. Use **Replace object / instances** if you want to substitute it for the old feature; otherwise place it as a separate object. There is no separate return-file control. Regeneration can preserve replacements, and imported material slots remain individually editable in Prosota. Imported geometry is not reverse-converted into procedural footprints. Keep metre scale during refinement and choose whether replacement should fit the existing size.

Ordinary site objects also have static GLB export. Full animated scene export, IFC inclusion and FBX export are separate follow-on work, not part of this reconstruction release. Custom shader effects are approximated by standard GLB materials. Replacement library assets must remain available; export refuses an incomplete reconstruction while a required replacement is unavailable.

Building shells (including flat, gabled, hipped, industrial roofs and courtyards) support the existing shape operations. Select the individual feature and use it as base/cutter. Roads, grass and water surfaces have no enclosed volume and cannot be treated as solids. Imported replacements must pass the same closed-solid and triangle-limit checks as other objects. CSG seam repair is limited to 10 micrometres; actual open meshes remain rejected.

## Sources and redistribution

- Geographic vectors: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. The downloaded source timestamp is 2026-10-26T12:39:20Z. The saved recipe is an adapted database and retains source attribution. Include that attribution and ODbL information when sharing the recipe or a rendered study.
- Vegetation: [Poly Haven tree_small_02](https://polyhaven.com/a/tree_small_02), Rico Cilliers, [CC0](https://polyhaven.com/license). The bundled asset is an optimized baked derivative, not a redistributable copy of a purchased library asset.
- Buildings, roof and surface details are generated by Prosota from vector geometry. No Google tile mesh, texture, screenshot-derived geometry, or generated-image geometry is included.

Map requests send only the entered study bounds to the chosen fixed Overpass endpoint. They do not send IFC files, project names or model contents. Main and Private.coffee are explicit provider choices; there is no silent change of destination.
