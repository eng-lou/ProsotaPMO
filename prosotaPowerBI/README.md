# Prosota BIM & 4D — Power BI preview

A custom visual following the approved model-left, schedule-right dashboard layout. This is a first working **preview**, not an AppSource-certified visual. No production IFC exporter or Synchro/Bonsai mappings are changed.

## Try it

1. Build with `npm ci` followed by `npm run package` in this directory. The `.pbiviz` is written to `dist/`.
2. In Power BI Desktop, use the Visualizations menu → **Import a visual from a file**, and select the `.pbiviz`.
3. Add **Prosota BIM & 4D** to a report page and give it most of the page width.
4. Click **Open IFC** and choose a Prosota integrated IFC. Model geometry, embedded activity links, saved animation recipes, activity financial values and resource assignment budgets load locally.
5. Use **Start / End**, **Play** or the date slider. Click an activity or linked model element to see details; **Isolate** limits geometry to that activity. **Clear selection** releases it.
6. Enable **Compare baseline**, then **Open baseline IFC**. Supply an integrated snapshot exported at the baseline date, containing its own model, schedule, assignments and profiles. Playback uses one date but each snapshot's own dates/recipes. Cameras can be linked. Baseline bars appear below current bars. Activities match by ID, then code.

Local IFC files are held in memory for this visual session. **They are not embedded into the PBIX and must be reopened after a report reload**, including by other report viewers. There is no hosted model URL, automatic Prosota login/sync or shared model storage in this preview. Files are not uploaded by the visual (`privileges: []`; IFC WASM is bundled).

## Dashboard controls (1.1)

- Schedule names wrap in full. Search by code/name, switch Fit/Months/Weeks and use **Expand** for a larger schedule. Horizontal scrolling retains the activity-name column. Selection is highlighted; milestones use diamonds.
- Playback supports a date picker and 0.5x/1x/2x/4x speeds. The dashed chart line follows playback, not a measured reporting date.
- The resource plan shows monthly or weekly **budget cost** or explicit **budget hours**. Hours are read only from labour/equipment/crew assignments with an exported hours value; material quantities are not hours.
- Resource budgets are estimated uniformly over elapsed activity time. The cumulative budget curve uses the same assumption. These estimates do not model calendars, holidays, exceptions or resource curves and are not the scheduling engine's measured PV.
- EV, AC and imported PV remain separate snapshot totals. No actual-history or capacity lines are invented. Missing values remain missing; partial budgets are identified.
- Assignment and cost tables are available beneath collapsible details. Model/activity selection filters the charts; clearing selection restores the filtered schedule.

## Power BI field binding

An integrated IFC works without bound report fields. A plain IFC can instead use a Power BI table with the following roles:

| Role | Contract |
| --- | --- |
| Activity ID | Required with bound data; stable unique activity ID |
| Activity name | Optional label |
| Start / Finish | Required valid dates; avoid Date Hierarchy aggregation |
| IFC GlobalId | Exact IFC product GlobalId; one row per activity/element link |
| Budget / Actual cost / Earned value / Planned value | Activity-level currency totals, repeated unchanged for every element row of that activity |
| Progress % | 0–100 |
| Level / Discipline | Optional activity filters; repeat consistently on an activity's rows |
| Prosota profile JSON | Optional saved Prosota recipe object; overrides the imported recipe for that link |

Duplicate element rows do not multiply activity totals. Conflicting rows for the same activity fail visibly. Missing financial values stay missing; Totals labelled **known** sum only supplied values. SPI is EV/PV only when both totals are complete and PV is positive. Filtering beyond the 30,000-row Power BI window produces a visible warning and clears totals rather than reporting an incomplete dataset as complete.

Bound activity IDs must match the integrated IFC's Prosota IDs to retain its assignment budgets and per-element recipes. Without a profile JSON override, matching imported recipes are preserved. Removing field bindings restores the IFC snapshot. Selecting a bound activity publishes a Power BI selection; other report filters update the visual through its table mapping. Format pane supports text size.

## Animation and baseline behaviour

The build bundles Prosota's actual `timelinePlayback.ts` engine and pure default recipe. It supports that engine's task-linked colour, opacity, translation, rotation, scale, grow, fall/pop/spiral and stagger evaluation. It does not reproduce equipment controls, free keyframes, paths, cameras, viewport-only transforms or every scene setting: those are not in integrated IFC exports. Turning profiles off uses simple start-date visibility with original materials. An empty view at an early date may be correct; use **End** to inspect completed construction.

Baseline model coordinates must use the same spatial reference as the current model. The viewer shares an origin for comparison, but does not automatically register differently positioned models. A hidden baseline remains loaded until replaced or the visual is destroyed.

## Data and preview limits

- Schedule and cost figures are snapshot values. Period utilisation/capacity and cumulative actual/earned-value history are not exported in the current IFC contract. Charts show explicitly labelled budget estimates; a real period data feed is needed for historical actual/earned-value curves and capacity.
- No resource/cost write-back, schedule editing or production API access.
- Risk and ICD are labelled as planned.
- Large models load on the UI thread and can briefly pause interaction. Native Power BI Desktop/Service sandbox behaviour, report save/reopen and deployment policy acceptance still need host acceptance testing. Browser tests and successful packaging alone do not verify those.
- No AppSource certification, high-contrast theme integration, Power BI tooltips or custom context menu yet.

## Development and verification

`npm run check` — generate assets and type-check.

`npm test` — data/profile/long STEP metadata regression tests.

`npm run test:browser` — headless Edge tests with generated integrated IFC snapshots. Override `EDGE_PATH` for another local Edge executable. Optional `IFC_PATH` adds a real model check. No production data is modified.

`npm run preview` — standalone local dashboard at http://127.0.0.1:4180 (not the Power BI host). `PORT` overrides it for manual preview.

`npm run package` — lint and generate the importable `.pbiviz`.

Verified with the 35 MB clinic snapshot: 3,664 elements, 3,664 links, 69 non-summary activities and 102 resource assignments. Embedded JSON is read from full STEP text because web-ifc truncates long text properties; geometry still uses web-ifc. Baseline fixtures verify independent task dates/IDs, shared origin, profile opacity, isolate and resizing. A mock Power BI host verifies field binding, selection, formatting and truncated-data warnings; it is not native host verification.
