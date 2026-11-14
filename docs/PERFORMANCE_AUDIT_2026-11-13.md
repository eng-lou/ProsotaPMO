# Responsiveness audit and Preview .15

## Scope and findings

Reviewed the shared request/undo interceptors, scheduling refresh paths, resource calculation and charts, BIM selection material effects, pointer hit-testing, animation frame callbacks, site context animation, and material/clipping update ownership. Earlier .13/.14 improvements did not resolve the user's reported Tower responsiveness. This pass makes targeted changes backed by source inspection, production-function tests and controlled benchmarks. It is not a live Tower performance trace or a claim that every feature has been profiled.

## Changes

- Viewport pointer rays now reject hidden objects before geometry intersection and stop recursive traversal of hidden groups. The old event filter ran after intersection. This applies only to registered viewport raycasters; measurement/construction and other geometry queries retain their original behavior. Visible instance and batched-element IDs are preserved; showing objects again restores picking immediately.
- Selecting or clearing the last element no longer invalidates the full model-material pass unless Fade Unselected actually requires it. Render settings, materialization and visibility changes still invalidate the full pass.
- Animation-driven numeric inspector updates are coalesced to at most ten per second with a trailing final update. 3D playback remains frame-driven. Manual edits keep their own immediate update/save paths.
- Unlinked site context no longer traverses every descendant material on every frame. Unlinking an animated item still restores its materials once; linked items retain per-frame visibility/material reconciliation.
- Clipping-plane composition reuses unchanged arrays and plane values, preserving ownership between grow animation and section boxes.
- Large site material signatures are memoized against site changes instead of serialized on every unrelated React render.
- Resource bulk reads can opt into sparse demand. Only nonzero defaults within each activity's span and explicit overrides are returned. Capacity remains complete; dense responses remain the default for existing clients. Zero overrides, holidays, out-of-span overrides and unscheduled activities are covered by tests.
- Resource charts aggregate existing demand cells rather than every assignment/day combination. Immutable response indices and bucket/date indices are reused with weak caches; new responses invalidate naturally.
- Resource fetch invalidation includes activity start/finish, calendar and utilisation, preventing stale demand when an edit leaves the overall project range unchanged.
- Preview's Developer Tools menu from the preceding diagnostic-access change is included.

## Controlled measurements

| Workload | Before | After | Verification |
| --- | ---: | ---: | --- |
| 500 assignments, six-year demand generation | 777.28 ms / 1,095,500 cells | 10.19 ms / 7,143 cells | Both total 57,144 hours |
| Five chart aggregations, 20 resources / 500 assignments / six years | 751.42 ms | 21.51 ms | Deep-equal chart values and capacity |
| Twelve pointer rays, 800 hidden sphere meshes | 232.36 ms | 0.02 ms | Hidden hits excluded; visible picking and independent geometry queries tested |

These timings isolate the changed algorithms. They do not measure installed startup time, live GPU time or Tower FPS. Hidden-model benchmark performance depends on how much geometry is hidden.

## Validation and delivery

- Full frontend suite: 350 passed, two skipped. The subsequently added inspector notifier test and targeted animation rerun passed (351 unique passing cases total).
- Backend resource/scheduling tests: 19 passed, plus one new sparse bulk API integration test passed. Tests used the isolated prosota_edit_perf_test_20261112 database, not user projects.
- TypeScript passed. UI and backend rebuilt for Preview .15; runtime fingerprint verification and final UI build checks recorded in the learning log.
- User project data preserved. No Stable publication or git commit. Live installed Tower responsiveness remains unverified because this execution session cannot access the user's running app and Electron GUI fixture launch fails here.
- Installer packaging was previously blocked by the execution environment. The user can run the built Preview directly with `npm.cmd --prefix desktop start` after closing the installed instance, or package it with `npm.cmd --prefix desktop run package:preview`.

## Follow-up: orbiting still slow; prepared Preview .16

The user reports that .15 did not resolve orbiting. Two further source-level fixes cover individual IFC mesh simplification after materialization and unchanged glass/outline batch mirroring. The latter measures 58.63ms to 0.11ms for 120 frames with 20,000 surface instances: this only removes roughly 0.49ms per frame in that fixture and cannot by itself explain a one-second interaction delay.

The viewport now has an opt-in Performance button to capture live orbit frame rate, CPU update/submission time, draw calls, triangles, multi-draw support and GPU identity without keyboard shortcuts. This is local-only and does not rerender the BIM React tree per frame. CPU submission is not a GPU execution measurement. The main remaining bottleneck has not been established without the user's live frame measurements.

Validation: 356 frontend tests passed, two skipped; TypeScript and production Preview UI build passed. Existing backend fingerprint verified; no project data changes. Preview .16 is prepared for direct local startup, not yet packaged or published.

## Follow-up: measured orbit frame cost; prepared Preview .17

Live .16 screenshot: **17.4 FPS, 57.6ms/frame, 29.6ms before rendering**, NVIDIA RTX 5090 Laptop GPU, multi-draw available, 1718 x 1025 buffer. Final-pass statistics (one draw / one triangle and 3.3ms/pass) cannot represent the full scene or its total render cost.

The paused batched-animation loop was still scanning every linked element on every orbit frame. It now scans again only after timeline/binding changes, a React commit, or a changed batch visibility revision. Normal paused-camera frames inspect the small set of batches. Individual-mesh/material reconciliation and path following remain intact. Fully removed grow scatters skip redundant bounds updates; reverse scrub immediately restores the visible cut.

Controlled 55,000-target test: 60 unchanged frames took **999.32ms before / 0.05ms after**; a targeted rerun measured **1078.93ms / 0.02ms**. Target reads fall from 3,300,000 to zero. The earlier console's 54,811 placements is not evidence that all of Tower's placements use this animation path. Live Tower savings have not yet been measured.

The Performance display now sums all render passes, preserves shadow counters across Three's internal reset, and reports 4D and Site update time separately. CPU submission remains distinct from GPU execution. Metrics use bounded counters and direct DOM text, with no per-frame React state or telemetry.

Validation: **362 tests passed, two skipped**, TypeScript passed, production UI build passed (18.35s). Backend fingerprint verified; settings assets restored. .17 is ready for local `npm.cmd --prefix desktop start`; installer not packaged and nothing published. User project data unchanged.


## 2026-11-13 - Remaining orbit costs after .17; prepared Preview .18

Live .17 screenshot remains poor: 16.0 FPS / 62.6ms per frame, 23.9ms before first render, 4D 23.0ms, Site 0.6ms, CPU submission 34.0ms across eight render calls, 3,350 draw calls and 47,305,672 submitted triangles across all passes. GPU remains RTX 5090 Laptop, multi-draw available, buffer 1718 x 1025. The .17 synthetic batch-loop improvement did not establish a live fix. Submitted triangles include repeated passes; these are not unique model triangle counts. The live 4D total does not yet distinguish batch scans from individual-mesh work.

Confirmed additional work: individual animation targets still build grow clipping planes, compose material values and synchronize display variants on every paused frame even while fully hidden by the schedule. At an unchanged date, hidden targets now retain their lightweight mesh-visibility reconciliation and skip those material/clipping writes. Existing transform handling is unchanged. Changed dates still run the full path; selection cannot reveal hidden scheduled meshes, and reverse scrubbing restores replaced materials, clipping and opacity. Visible animated targets remain on the existing reconciliation path.

Controlled test of the production frame callback, 10,000 individual grow targets over 60 paused frames: 608.35ms before, 52.78ms after (~10.14ms to 0.88ms per frame). Earlier run: 585.15ms / 50.39ms. This is a CPU fixture, not a live Tower FPS improvement. New tests cover reveal/removal, selection, replacement display variants, manual Hide and reverse scrubbing.

Simplify while orbiting now bypasses N8AO sampling/blur passes during an active navigation drag. The composer, scene pass, tone mapping and AO resources stay mounted; releasing the drag restores the same AO pass. The user's saved AO setting is unchanged. High-quality capture and all offline exports (including draft) retain AO. Synchronized comparison panes follow the main drag; disconnected panes do not. Hook-callback tests cover restoration, disabling simplification mid-drag, capture/export and unchanged tone mapping. This removes extra AO fullscreen passes, not the entire reported scene triangle count. No live WebGL visual/performance validation was possible in this tool session.

The Performance panel now splits 4D work into meshes, batches and paths/edges. This preserves the distinction between measured total costs and the algorithms changed here.

Validation: 365 frontend tests passed, two skipped; TypeScript passed; production Preview UI build passed (18.25s). Backend fingerprint verified, desktop settings assets restored. No user project data changes, no backend rebuild, no Stable publication. Preview .18 is prepared for direct local startup; installer is not packaged. Live orbit rate remains to be checked in Tower.


## 2026-11-13 - Mouse-release stalls and paused individual meshes (Preview .19)

Live .18 HUD: 18.3 FPS / 54.8ms per frame; 26.6ms before render, including 25.8ms individual 4D meshes and 0.0ms batch/path work. CPU render submission is 26.5ms over two calls, with 2,098 draws and 46,534,143 submitted triangles. The user then clarified that navigation gets faster while dragging but stalls again on mouse release.

Confirmed release-time cause in Viewport3D: OrbitControls.end set boostQuality=true. This caused a full viewport React commit, raised the sun shadow map from 2048 to as much as 8192 (16x texels, including map disposal/reallocation), and raised N8AO from 16/8 samples at half resolution to 64/32 at full resolution. High quality is now enabled only for explicit non-draft capture/export. Mouse release restores normal interactive AO and shadows; saved effect toggles are unchanged. Per-instance frustum culling still enables during navigation and restores afterward, but is managed by MovingQualityDriver without a React state toggle.

Idle rendering now has a 120ms settling tail instead of 1500ms. Plain pointer hover no longer repeatedly wakes the full renderer. Camera damping, timeline changes, React commits, explicit render requests and the 1-second asynchronous-resource heartbeat remain supported. Imported animation requests continuous frames only while its clip is active and its hierarchy visible, rather than every imported file with any animation keeping the renderer busy forever. Hidden clips still advance on actual idle frames. Comparison views no longer request continuous rendering merely because an import contains clips.

Individual paused 4D targets now reuse their applied material state. A lightweight guard checks actual visibility, material identity/slots, opacity/blending/depth state, clipping-array identity, transforms and simulator ownership. React commits invalidate authored colour/material/profile changes; changed dates always apply the full path. Fully hidden paused targets keep their cheap composed-visibility pass. Fresh bindings, same-date schedule updates, replacement variants, selection, manual Hide, forward/reverse scrub and simulator ownership are covered. Paths and edges retain their existing update path. An initial broader snapshot implementation failed to improve the benchmark and was replaced before delivery.

The final isolated CPU fixture (10,000 visible grow targets, 60 unchanged frames) measured 844.48ms before / 771.32ms after, with 600,000 repeated source clipping assignments eliminated. This is a modest, workload-dependent saving; timings varied under concurrent build/type-check load, including a slower candidate run. It is not evidence of a particular live Tower FPS. The concrete mouse-release quality change and removal of idle rendering bursts are independent of this synthetic mesh-loop measurement. The remaining 46.5M submitted triangles have not been attributed to individual assets or reduced by geometry simplification.

Validation: full frontend suite 372 passed, two skipped; after the final pose-guard adjustment, all six affected animation tests passed again. TypeScript passed, Preview UI production build passed (29.76s), backend fingerprint verified, desktop release-channel/data-isolation test passed, settings assets restored. Initial new mixer fixture failed because Windows line endings prevented extracting its function; normalized line endings and reran successfully. No backend rebuild, no user-project data changes, no Stable publication. Live Tower/WebGL performance remains unverified in this execution session.

Prepared local Preview 0.2.49-preview.19. Close Preview and run `npm.cmd --prefix desktop start` from the repository to use the rebuilt UI. Installer has not been packaged; the previously recorded sandbox EPERM packaging limitation remains. Packaging, if needed from normal PowerShell: `npm.cmd --prefix desktop run package:preview`.


## Follow-up: zoom, rest and UI actions; Preview .20

The .19 orbit/release improvements did not resolve the user's broader complaint. This pass removes wheel-event raycasting when there is no wheel tool, groups synchronous OrbitControls wheel start/end pairs into one navigation session, stops side-panel events and unrelated UI commits from starting renderer bursts, and retains paused animation caches across unrelated UI changes. Real scene/selection/material/clipping/schedule edits still invalidate them. Section-box arrays are now stable across parent renders.

Hidden site animation and hidden/unused water assignments no longer keep the full renderer awake. Hidden BIM schedule/working-sequence refreshes are suspended until reactivation; identical refreshed schedule data retains its references. The Performance HUD now includes zoom and settled-camera render costs rather than collecting only orbit samples.

Controlled wheel-event fixture: 800 visible sphere meshes, 12 events, 9,600 mesh raycasts reduced to zero. Isolated dispatch time: 265.42ms before / 0.01ms after. A real registered wheel tool still receives intersections; clicks, misses, hidden picking and restored picking are covered. Navigation tests cover wheel bursts, damping, held drags and forced capture/cleanup restoration. Idle tests cover side-panel input and one-frame UI commits; schedule tests cover unchanged/changed data and out-of-order replies. Cache tests cover parent clipping props and all appearance/selection invalidators.

These are CPU/source-level checks, not a live Tower GPU or interaction trace. The 46.5M previously reported submitted triangles and the remaining individual-target inspection costs are not claimed fixed. Details and delivery verification are recorded in LEARNING_LOG.md under Preview .20.
