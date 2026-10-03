# Performance and realistic materials review — 3 October 2026

Scope: repository review of project opening, module navigation, dashboard,
scheduling, risk/cost/ICD data loading, and 4D rendering. Local browser tests
use synthetic activities, not customer data. This is not an authenticated
end-to-end production audit or a GPU benchmark on a real IFC model.

## Implemented locally

- Activity pickers render only the visible rows plus a buffer, retaining
  search, selected-item/nearby-item scrolling and date labels. Arrow keys,
  Enter and Escape work from the search input, with listbox semantics.
- The 4D activity table renders a window of rows. Selection still covers
  the entire logical list. An active inline editor stays mounted when it
  scrolls out of view. Row heights remain aligned with the Gantt chart.
- Main and grouped Scheduling grids update their row windows once per
  animation frame instead of waiting for a 150 ms quiet period. Resize
  handlers now follow the current row count rather than the initial count.
- Concurrent initial period/schedule bootstrap calls and identical dashboard
  trend reads share an in-flight request. Completed results are not cached;
  explicit bootstrap refreshes and mutation-related reads remain fresh.
- Dashboard WBS refreshes retain the existing grid and its local layout/filter
  state. Obsolete overview requests are cancelled. Failed refreshes retain
  previous results with an explicit message and Retry. Switching projects
  resets the dashboard scope. Period responses from superseded requests are
  ignored.

## Measurements and verification

Same local Vite browser, synthetic 5,000-activity fixture. Single observations
are indicative, not medians or production performance guarantees. Times include
the first animation-frame callback following the render; browser scheduling
and development overhead affect the absolute figures.

| Operation | Before | Initial optimized run | Final interaction-test run |
| --- | ---: | ---: | ---: |
| Open activity picker | 228 ms | 11 ms | 8 ms |
| Mount 4D activity table | 813 ms | 13 ms | 9 ms |
| Picker rendered options | 5,000 | 23 | 23 |
| Table rendered activities | 5,000 | 17 | 17 |
| Table DOM elements | 60,022 | 228 | 228 |

Verified in the browser: anchor scrolling, keyboard selection, bounded row
counts, scrolling to row 4,001, Gantt row height, Shift range across unmounted
rows, inline editing across scrolling, and filtering a scrolled list down to
three activities without an empty viewport.

`npm run build` passed (TypeScript and Vite). Four Node tests passed across
`tests/pendingReads.test.mjs` and `tests/elementBatching.test.mjs`, covering
request sharing/retry/freshness and the existing outline-visibility regression.
The build retains its large-chunk warning, particularly for 4D/IFC code.

Reproduce from `frontend`: start `npm run dev`, open
`/tests/performance-smoke.html`, and read the results. The fixture contains no
backend requests or production writes. Run the Node tests with
`node --test tests/pendingReads.test.mjs tests/elementBatching.test.mjs`.

Dashboard refresh behavior and the full Scheduling screen were reviewed and
type/build checked; their authenticated workflows still need a real-project
browser pass. No production API latency or large-model frame-rate claim is
made from the synthetic table measurements.

## Next improvements, in priority order

1. **Project opening:** add a lightweight WBS/lookup response. Dashboard currently
   downloads the full activity response just to populate the WBS picker. Measure
   bootstrap, overview and activity API timings separately before changing the
   database queries. Preserve project permissions and live-period semantics.
2. **Module switching:** introduce a project/period/variant-scoped query cache
   with explicit invalidation after edits. Keep the last view visible with a
   refresh indicator when returning to a module. In-flight sharing implemented
   here avoids duplicate concurrent work but deliberately does not retain data
   across completed visits. Existing route lazy loading and the retained 4D
   viewport should stay in place.
3. **Risk, Cost and ICD:** virtualize large visible registers and defer lookup
   datasets used only by generation dialogs. Keep complete print/export data;
   screen virtualization must not truncate printed reports or exported files.
4. **Loading feedback:** show stages such as project setup, schedule loading and
   model preparation instead of one generic loading label. Preserve useful
   content through background refreshes and make failures retryable.
5. **Large models:** profile import/parse, scene assembly, draw calls, GPU memory
   and frame time separately on a representative IFC file. The 4D and IFC bundles
   are already separate; splitting more code only helps if it is outside the
   first-view path. Avoid speculative shader expansion or full-scene effects.

## Realistic materials: recommended design

The renderer already supports procedural material textures, per-material colour
overrides, mapping to material classes, sky/environment lighting, shadows,
optional ambient occlusion and optional glass transmission. Refine these rather
than add a second rendering system.

1. **Finish presets first:** distinguish smooth render from cast concrete, and
   painted/powder-coated metal from exposed metal. The current class table gives
   concrete/render one shared finish and metal one shared finish. Provide a small
   preview swatch and a reset-to-default action for each override.
2. **Scale and direction:** expose texture size in metres and grain/brick rotation
   per mapped material. Keep sensible class defaults. This helps the same texture
   read correctly on a wall, slab and timber panel without changing model geometry.
3. **Simple surface controls:** roughness and relief strength alongside colour,
   with advanced values hidden initially. Store overrides per material and feed
   them through the existing batched-material lookup approach where feasible;
   avoid creating a separate material/draw call for every IFC element.
4. **Lighting presets:** offer overcast daylight, clear daylight and presentation
   lighting, with exposure control. Use the existing environment/sun/shadow system.
   Validate on both Z-up and Y-up models and preserve imported colours.
5. **Glass and quality presets:** keep affordable glass as the navigation default
   and make refracting glass a deliberate presentation choice. It already incurs
   an additional scene render. Consider Navigation/Balanced/Presentation presets
   over existing controls, maintaining stable resolution during camera movement;
   earlier viewport notes document jitter from changing resolution during orbit.

Suggested first materials iteration: finish presets + texture scale/rotation +
preview/reset. Compare before/after on one exterior and one interior view, then
measure frame time with glass transmission and AO separately. Lighting presets
can follow once material appearance is consistent. No shader or material-default
changes were made in the initial performance pass.

## Follow-up: realistic-material controls implemented

The next local iteration adds two explicit finish choices (smooth render and
painted/powder-coated metal), texture scale (0.25×, 0.5×, 1×, 2×, 4×), quarter-turn
rotation and a Reset material button. The panel reports the texture repeat size
in metres; changes preview directly on the model. Settings use the existing
per-project local storage alongside material mappings and colour overrides.
Reset restores automatic mapping, original colour and default texture settings
for that material only. Existing automatic classifications are unchanged.

Both main and comparison views pass the same settings to individual meshes;
IFC batches encode the transform in their existing per-instance lookup. The
lookup grows from one to four bytes per slot, retaining one vertex texture
lookup and the existing varyings/draw calls. Finish presets reuse existing
texture layers. Colour/texture edits now preserve an unchanged glass batch
instead of recreating its geometry. Render exports use the configured viewport;
an exported video itself has not been tested in this pass.

The synthetic WebGL fixture at `/tests/realistic-materials-smoke.html` rendered
all six sample surfaces without shader errors. Changing a batched brick's scale
and rotation changed its appearance while retaining six draw calls; applying
the same settings to an individual brick gave matching patterns. Switching the
batch to coated metal and resetting restored the expected class/transform bytes.
The production build passed. Material regression tests cover legacy mappings,
serialization, malformed values, reset isolation, finish classes, batch/mesh
transforms, glass-batch reuse and explicit-material suppression.

Large-model GPU timings and final appearance under project-specific lighting
remain to be checked on representative production models. Lighting/quality
presets and independent roughness/relief sliders remain recommendations.
