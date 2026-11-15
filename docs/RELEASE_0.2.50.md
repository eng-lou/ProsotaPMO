# Prosota Planner Web 0.2.50

Linking many IFC products to Grow/removal profiles used to expand their representation pieces into individual render meshes. This release keeps those pieces in shared GPU batches. It also reduces repeated timeline work and moves IFC geometry extraction into a browser worker. Desktop packaging is unchanged.

## Implemented priorities

1. **Batched Grow/removal/fade.** Per-instance clip planes and opacity compose with existing materials, section planes, manual visibility and selection. Colour, depth/distance shadows, AO normals, transparent surface copies and edge instances consume animation state. Reused slots reset and unlinking releases animation state without overriding manual hiding.
2. **Affected-window updates.** Indexed activity/transition windows skip settled batch targets during playback and reverse scrubbing. Changes to schedule, bindings, appearance or visibility still reconcile. Paused camera-only frames skip animation writes.
3. **Background geometry and bounded reuse.** A dedicated worker parses/tessellates IFC geometry and transfers buffers; scene assembly yields to input. The content-addressed IndexedDB cache includes parser/extraction versions, rejects invalid records, tolerates unavailable storage, and caps individual entries at 256 MiB and total geometry at 512 MiB. Project switches cancel pending geometry workers. Loading stages distinguish checking saved geometry, reading records, preparing geometry, opening properties and building the view.
4. **Distant scatter detail.** Adaptive detail retains simpler geometry for small, distant static scatter/array assets even after navigation stops. Component density reduction preserves whole small leaf/twig components and larger components; vertex clustering retains UV/normal boundaries. Hysteresis avoids threshold flicker. Close/selected views, captures, offline video rendering and static geometry exports retain original geometry. Rigged, animated, grouped-material, coloured or otherwise unsupported meshes are excluded. Source files and project data are unchanged.
5. **Repeatable browser regressions.** Chromium exercises the real shaders and worker/cache pipeline. CI runs these alongside the frontend suite and production build. An optional local GLB benchmark measures distant geometry reduction without uploading asset data.

## Evidence and limits

- Owner-provided linked capture: 5.6 FPS, 179.8 ms/frame, 9,830 draws across four passes, 27.1 ms mesh-animation work. After unlink/reload, the owner's new capture showed 127.3 FPS, 7.9 ms/frame and 162 draws. These are user observations, not before/after measurements of this release; views and visible geometry also differ.
- Local Tower inventory: 165 products assigned to the vegetation Grow profile reference 37,384 IFC representation items. Representation items are not an exact visible draw count. A small count of selected/linked products can therefore represent substantial geometry.
- Production animation-loop regression: 165 Grow targets with 37,000 pieces remain in one batch through removal/reverse scrubbing. An isolated local run averaged 4.77 ms per active update and 0.068 ms for 120 paused callbacks. This is CPU fixture timing, not end-to-end Tower FPS.
- Actual Chromium/WebGL fixture: 37,000 pieces cost two draw calls across colour and directional-shadow passes. Opacity 1 matches the original image; zero removes faces and shadows; reverse restoration matches the original. AO normal, basic, Phong, Gouraud and realistic material passes compile and respect fade/removal. Compact transparent slot remapping is checked. Software rendering is used for reproducible correctness, not hardware FPS measurement.
- Actual exported Beech GLB: 448,223 source triangles become 126,010 at distant detail (71.9% reduction). The original remains available. This is geometry-count evidence; visual quality and overall FPS still need checking in the user's complete linked Tower view.
- Worker browser regression: real IFC extraction and scene assembly; cache hit; same-name changed-content cache miss; cancellation; disabled storage; oversized entry rejection; corrupt cache rejection; full-detail source retention.
- **Remaining limits:** synchronous IFC property-engine opening still occurs on the interface thread after worker extraction. Rotation/scale/keyframed or explicitly edited/materialized IFC pieces still use individual meshes. Selecting a detailed product for transform editing can still materialize its pieces; this release does not claim that all editing paths are batched. No measured FPS guarantee is made for the live Tower project.

Validation completed: 396 frontend tests passed, two existing optional tests skipped; TypeScript and production build passed (22.63 s); focused Chromium suites passed. Backend and desktop packaging were not changed.

Publication is pending: this session cannot write the Git index, and elevated access was rejected. Run `scripts/publish-web-0.2.50.ps1` from normal PowerShell to commit/push the validated files. It checks their fingerprints and refuses to overwrite newer remote history.

## Validation commands

From `frontend`:

```powershell
npm test
npm run build
npm run test:browser
node tests/browser/context-asset-benchmark.mjs "C:\path\to\tree.glb"
```

`CHROME_PATH` can select another installed Chromium/Chrome. Browser tests use a temporary profile and local fixture server; they do not sign in or modify saved projects. The GLB benchmark is optional and read-only. After deployment, reload the web application before reassigning the vegetation profile; previously materialized in-memory geometry is not retroactively rebuilt by hot updates. Compare the same timeline time, camera, materials and effects with the original linked capture.

## Related proposals, deliberately not implemented

**Traceable model-derived estimates:** provide an auditable recommendation beside the planner's authored schedule. Each quantity should carry source model/revision, element identity, quantity property, unit, exclusions and adjustments. Productivity inputs specify crew composition/count, output per working day, calendar and constraints. For example, 120 m3 / 20 m3 per crew-day gives six crew-days; two crews suggest three working days only if work fronts allow parallel output. Costs should show quantity/rate or resource time/rate components without double counting. Show the current planned duration/cost, suggested values and difference. A planner must accept a proposal before it changes schedule or cost; source changes flag it as stale. IFC representation/triangle counts must never be mistaken for takeoff quantities.

**Reliable offline readiness:** first define which operations can work without the server. A readiness check must verify the application version, project records, schedule/calendars, model bytes, site assets, textures and animation profiles, plus any required authentication/permission state. Distinguish online-only, partially cached and verified available-offline projects; show missing items and download progress. Interrupted downloads/version changes need recovery screens and safe retry. Offline edits require an explicit sync/conflict design. The bounded geometry cache in this release is an acceleration cache and does not establish offline project readiness or fix the desktop asset-serving issue.

## Research attribution

Reviewed [Redhuan D. Oon's BIM OOTB](https://github.com/red1oon/bim-ootb) at commit `27ac46cc01e36cfe6dbd6f4564676b1ceff62313` (MIT). Useful patterns: separating IFC processing from interaction, reusable geometry, selective timeline work, and repeatable browser checks. This release is original Prosota implementation; no BIM OOTB source was copied. Any future source reuse must preserve its copyright/license notice and check bundled dependencies separately.
