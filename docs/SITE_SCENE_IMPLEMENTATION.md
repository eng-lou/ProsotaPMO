# Site scene implementation

Scope: initial R0/R1 delivery from the supplied Prosota Site Context and Construction Scene Requirements v1.2. This is not a declaration that all 119 requirements are implemented.

## Repository integration inventory

| Responsibility | Existing implementation | Integration decision |
| --- | --- | --- |
| Viewer | React Three Fiber / Three.js, `Viewport3D.tsx` | Add a scene layer; retain cameras, IFC/material handling and captures. |
| Paths | `paths.ts`, `pathCurve.ts`, backend `Path` | Reference canonical path ID. Fence v1 explicitly uses straight control segments, retaining the existing smooth animation curve. |
| Binding and playback | `pathFollowers.ts`, `timelinePlayback.ts`, `elementKeyframes.ts` | Preserve follower behaviour. Temporary site presence references existing activity IDs and reads the shared playhead. |
| Coordinates | `upAxis.ts`, model source axes, site-context transforms | Persist each recipe's declared Y/Z up and metre units. Require metre confirmation; do not reinterpret existing coordinates. Full datum calibration remains outstanding. |
| Selection | existing IFC/mesh selection and frame controls | Site groups and fence panels have separate stable logical IDs; site selection and framing are integrated. |
| Undo | `undoHistory.ts`, `apiUndo.ts` | One site command creates/updates/removes the complete recipe set atomically; register one inverse with existing Undo. History remains session-local. |
| Persistence/access | PostgreSQL, FastAPI, project ownership | Add separate scene and command tables with revision checks, per-command idempotency and project/source access checks. Imported models remain unchanged. |
| Windows | Electron main/preload; Python runner and private PostgreSQL | Same UI/API scene code. Existing process launch capability is reusable but is not yet a Blender preparation service. |
| Assets | existing model3d-files and imported model loaders | Built-in concept geometry and a separate project-owned GLB library. Immutable asset versions and a checked palette are available; Blender source indexing and managed preparation remain outstanding. |
| Capture | existing viewport still/video renderer | Committed site geometry participates; temporary previews and site selection highlights are excluded during capture. Visual export does not replace native recipes. |

## Initial implemented scope

- One Site Tools inspector with numeric placement/editing for context blocks, cabins, schematic trees, static people and arrows.
- Fence generation from an existing level path; whole fixed-length panels and one gate opening within a straight segment. Self-intersections, unresolved spans and slopes are rejected.
- Authoritative server preview is read-only. Saving uses the same generator and validates the current source path.
- Versioned recipes, stable per-chainage panel IDs, group/panel selection, saved locks and reversible commands.
- Activity-linked temporary visibility, using dates from the loaded schedule. An unavailable activity hides its object and is reported in the inspector.
- Source path changes retain the last committed geometry and show a repair/regeneration message. They do not silently regenerate locked geometry.
- Bounded initial scene: 200 parent objects, 2,000 panels per fence, 5,000 panels per scene. These are protective limits, not measured performance guarantees.

## Deliberate limits and next work

This is a starter authoring workflow, not the complete R1 asset-browser slice. The GLB library and surface click placement are available. Blender library indexing/preparation, spatial compound packing, persistent surface anchors, terrain solver, road corridor generator, full decal attachment and a general dependency/job service are not implemented yet. The cabin/tree/person palette is conceptual geometry, not a verified construction asset catalogue. Fences provide a gate opening, not a rigged gate leaf or slope/step system. Panels can be selected but have no individual override editor yet. Built-in road arrows are manually positioned geometry, not surface-attached decals.

The shared scene API preserves all its objects in one transaction. It does not yet atomically combine changes to legacy paths and external cost/schedule records. Quantity/cost calculations, comparison views, IFC output of generated site objects, arbitrary project package export and measured combined-scene performance are not claimed. Existing native Windows backup includes the new tables.

Next acceptance gates: portable source preparation and pinned asset versions; terrain/placement coordinate proof; controlled regeneration with per-child matching; reference scene performance; Blender ordinary/modifier/Geometry Nodes fixture preparation and cancellation/recovery. iCity is not supported or advertised until exact version/asset evidence exists.

## Recorded checks

- Pure geometry tests cover the five-panel gate fixture, Y/Z up and translated origins, invalid spans/slopes, gate corners, self-intersections and non-finite input.
- Disposable PostgreSQL smoke checks cover read-only preview, atomic commit, replay idempotency, revision conflicts, stable IDs through inverse/redo commands, locks, cross-project source rejection, preservation after source edits, and native backup/reopen. Existing IFC conversion, measurements, resources/costs and Maps checks also pass.
- Blender 5.1.1 factory/background probe prepares three synthetic 2 m objects: ordinary mesh, evaluated bevel modifier and Geometry Nodes cube. All export to GLB and preserve dimensions through the installed Three.js GLTFLoader. No source .blend file or user preference is touched. This is narrow feasibility evidence only: real libraries, iCity, materials/rigs, dependency failures, managed cancellation/recovery and viewer interaction remain unverified.
- Final web production build and Windows packaged-backend regression checks pass. Electron UI checks exercise the actual Preview, Save, Undo and Redo controls; a captured preview verifies five panels and the gate opening fit in a narrow viewport. Authentication is stubbed only in the disposable UI test, so this does not verify the production Google sign-in flow.

## Trying this release

### Windows 0.2.7: portable asset library and direct placement

**Site Tools → Asset library → Import GLB** registers a portable model separately from scene geometry. Pick a category, import a self-contained GLB and inspect its actual geometry, materials and dimensions in the orbitable preview. Clicking its name changes preview focus; checking its checkbox changes the palette only. Neither action places a model.

**Place this asset** arms a translucent viewport preview. Move the pointer over a visible surface and click to set its base-centre position; empty space uses a horizontal plane at the current base elevation. Right-drag remains available for navigation. Save commits the instance; Escape cancels the draft. Layout shapes have the same **Place in viewport** control. Exact coordinates are available in a collapsed section.

Each import is a new immutable asset ID. Uploads publish to a separate final object-storage key, so an unexpired upload URL cannot overwrite a saved version. Multiple placements reference that version and keep independent size, rotation, activity visibility and lock state. Source and placement access are project checked. The existing object-storage service and Windows backup are reused; library entries never appear as ordinary imported scene models. Old site recipes remain compatible.

Current import scope: self-contained GLB v2, embedded buffers/textures, no required extensions, up to 50 MB. GLB coordinates are treated as metres and Y-up, with placement converted to the viewer's chosen axis. Clips remain in their static pose. Blender-library indexing, animated actors, scatter/compound generators, full surface anchors and production asset packs remain outstanding. These are user-supplied models, not a bundled licensed asset catalogue. Click placement sets a position; it does not automatically follow later edits to the supporting surface or align to slopes.

Checks include a GLB cabin fixture, library/scene separation, immutable published bytes, project validation and native backup/reopen with the asset still bound to its instance.
The Windows UI test also imports the fixture through the library file input, inspects the preview, clicks the viewport and saves its instance. Final library and placed-object screenshots were inspected after disabling background frame throttling in the test harness; the final run reports no capture warnings. The web production build, packaged-backend smoke suite, fence geometry, path-display and drag-selection regressions pass.

Open BIM, Simulations & Reality Capture, then **Site Tools**. Choose a built-in object, set its position/dimensions, confirm metre coordinates, and click **Preview**. Use **Frame Selected** to inspect it, then **Save**. Existing Undo/Redo controls reverse saved operations.

For a fence, draw a level path in **Paths** first and select it in Site Tools. A 12 m straight path with 2 m panels and a 2 m opening starting at 4 m produces five panels. Select the saved object, then use **Activity links & profiles** to link installation/removal activities and choose existing profiles. A link override wins over the activity profile; an unconfigured activity uses the shared Default profile. Select a saved object to edit, lock or remove it.

The shared web source is built and checked locally; deployment requires the new database migration. Windows preview 0.2.8 includes the site-scene and asset-library migrations and shared changes. The installer remains unsigned.


## Shared activity profiles (0.2.8)

Saved site objects use `model-element-links` with source kind `site` and their stable scene item ID. The same ActivityPicker and ElementLinkFields controls used by model elements assign activities and saved profiles. Playback uses the shared timeline evaluator for opacity, colour, movement, scale, rotation and growth clipping, including reverse seeking. Multiple activity links support installation and later removal; the latest started activity controls the object. Site-instance stagger ordering uses the existing ordering rules within the linked site-object group. Fence runs animate as one object, about their first path point.

Older activity-only visibility is preserved, but normal profile links take precedence. Clear the previous visibility setting when editing an older object if no longer needed. Objects without links remain visible. Undated/unavailable linked activities cannot drive playback. GLB authored animation clips and manual site-object keyframes are not part of this change.

API validation rejects missing site instances and profiles from another project. Tests cover lifecycle scrubbing, override inheritance, material restoration, transforms, instance isolation, stagger order, saved links and backup restore. Windows UI tests exercise the real activity picker/profile assignment.

## Path navigation fix (0.2.9)

Draw / edit a path now activates the Paths tab even when it was already open behind Site Tools. The unfinished Site Tools form stays mounted while switching tabs, preserving the source path, dimensions and preview. Desktop UI regression checks cover repeated activation, entering point-drawing mode, returning to the draft and saving it.

## Material checks and opacity repair (0.2.10)

Site Tools > Asset library > Import GLB now previews the model before upload. Each material reports whether it has a colour texture, cutout transparency or zero opacity. For leaf cards, choose the matching black-and-white opacity image under the leaf material, inspect the preview and click Import checked asset. Prosota combines the colour and mask into an embedded PNG and saves a new GLB version; the source file is not changed. White is visible, black is cut out at 50%. Masks must match the colour image dimensions and UV layout. The existing colour UV transform and sampler are retained.

Restore opacity is an explicit action for a zero-alpha material, not a universal fence shader conversion. Materials with no colour texture get an informational message: plain colours can be intentional, while unsupported procedural Blender materials need baking. No missing opacity is inferred from green pixels, and this workflow does not import or bake .blend shader graphs. Both web and Windows use the shared client-side implementation. Tests cover binary preservation, material isolation, validation, browser PNG alpha encoding and desktop import review.

## Foliage distance rendering (0.2.11)

Imported site assets with alpha-tested colour textures now receive coverage-preserving mipmaps on load. Standard averaging can move small leaves below the alpha cutoff and erase them at a distance. The new mip chain rescales alpha to retain the source coverage while leaving level-zero pixels, RGB, sampler coordinates and the material cutoff unchanged. Transparent texels remain transparent. Realistic material variants reuse the corrected texture. Existing saved GLBs benefit on reload without changing their stored files.

The preparation is scoped to single-map cutouts with opacity 1 and textures up to 16 megapixels. Separate alpha maps and blended materials are left unchanged. Unit tests check coverage, empty masks and colour preservation; an isolated Electron render compares the supplied beech at a distant camera position.


## Foliage coverage correction (0.2.12)

The 0.2.11 mipmap adjustment was insufficient and is superseded. Site GLB cutouts now use stochastic alpha coverage with ordinary texture mipmaps, depth writing and no transparent sorting. This avoids discarding all minified leaf samples below a fixed threshold. Authored opaque and blended surfaces remain unchanged. Custom depth and distance materials retain cutouts for directional and point-light shadows because Three r169 does not propagate alphaHash into its default shadow materials. Realistic finish changes preserve the source map and alphaHash flag. This can produce fine dithering at leaf edges; it keeps the canopy rather than erasing it.

The actual beech regression now renders close, medium and far zooms and requires substantial canopy coverage at each. The previous test accepting a small number of surviving green pixels was inadequate. Screenshot results are in outputs/corrected-assets/distance-after-{0,1,2}.png.

## Library selection and transforms (0.2.13)

Placed library assets register their existing scene roots with the viewport's selectable-object list using `site:<instance-id>` identities. The library still stores reusable sources; placing an asset creates an independently selectable instance. No duplicate mesh import or model-file row is created. Click, additive selection, box selection, Select All, framing, Hide/Show and isolation now include these instances. Box drags are tracked in capture handlers with a ref so hit handlers and React render timing cannot lose the rectangle.

Selected assets expose location, rotation, scale, Global/Local gizmos and a shortcut to Realistic Materials in the properties sidebar. The manual transform wraps the existing site-animation group, preventing playback from resetting edits. Location, Euler rotation and scale persist through the site-scene revision API, with debounced writes and existing undo/redo. Older recipes default to zero rotation and unit scale. Locked instances cannot be transformed. Asset-load notifications refresh scene bounds after asynchronous geometry loading.

This change covers placed library assets. Generated fence recipes keep their path-based editing tools. It does not migrate library instances into legacy mesh-file identities or add legacy mesh rigging, pivot baking or mesh-keyframe tracks to them. Materials remain editable through their existing library material mapping.

Validation: TypeScript and web/desktop builds; six backend geometry/schema checks; ten focused frontend tests; isolated Electron component test for transform/animation separation, selection and visibility; full Windows UI smoke test including library box selection mixed with IFC, saved numeric movement and Undo, existing activity/profile links, material mapping and archive retention.
