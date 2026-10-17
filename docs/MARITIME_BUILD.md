# Prosota Maritime — implementation status

17 October 2026. The governing product scope is [MARITIME_SCOPE.md](MARITIME_SCOPE.md).

## Current release: persistent project workspace

`/maritime/workspace` now uses the existing approved-user authentication and project infrastructure. Construction and Maritime projects have separate selectors and tab storage. Existing projects default to Construction; the migration does not reclassify them. The earlier synthetic demonstration remains at `/maritime/demo` as a reference, not the editable project platform.

### Implemented

- Editable, persisted Maritime working plans with asset registers, vessel calls, availability scenarios, maintenance work orders and guided exercise definitions.
- Shared asset identifiers across records, with geometry links using the existing IFC GlobalId / mesh-name / split-element reference conventions. Import, restore, selection and isolation use the existing model viewer. Mesh links identify imported objects, not individual submeshes; existing rigging supports equipment parts.
- Existing model import, rigging, paths, animation profiles, 4D sequencing, scheduling, calendars, resources, cost, risk, ICD and dashboards accessible within the Maritime navigation. Shared module links retain Maritime context.
- Deterministic terminal flow calculations with exclusive berths/cranes, FIFO calls, truck capacity, finite pooled yard storage and outbound gate capacity. Outages and scheduled maintenance constrain availability. Incomplete horizons return no invented finish time.
- Saved operation runs contain the complete plan/version, scenario and results. Reports expose the working-plan comparison, cargo flow, vessel completion, equipment utilisation and cost assumptions. JSON, CSV and print exports use the saved run.
- Editable guided safety exercises, timestamped participant actions, ordered/timed criteria, saved debriefs and action-log replay. Attempts remain active across scene navigation, with the same controls in the model inspector.
- Project-scoped Poe evidence tool reads saved plans and runs, reports staleness and calculation assumptions, and excludes large geometry arrays. Existing planning tools remain available for delivery records.
- Existing ten-step undo/redo is retained for shared modules and integrated with local Maritime plan edits; undoing a plan edit marks it unsaved.
- Optimistic version checks reject stale saves/runs, project ownership checks isolate Maritime data, and old run snapshots do not change when the plan changes. Project duplication remaps planning links; model links are cleared because the existing duplication service does not copy model files. Run history is not copied.
- Optional terminal starter records use the same editors and validation as user-authored plans. They are clearly synthetic and require separately imported model geometry.

### Operational calculation contract

The engine uses one-minute fluid steps, elapsed hours and cargo moves (not TEU). All configured cargo unloads to a pooled yard and exits through outbound gates. Crane productivity is moves per productive hour; truck rate includes travel. Equipment utilisation uses productive-equivalent hours divided by elapsed run hours. Berth hours measure occupancy.

Costs charge productive crane/truck/gate hours, occupied berth hours, and scheduled maintenance once when it starts within the run. They do not imply idle, fuel, demurrage or labour costs. Operational costs are a separate calculation from the delivery cost plan; a resource association does not copy or double-count charges. An outage can therefore delay completion without changing the cost if no time-dependent occupancy/idle charge applies.

The synthetic starter unloads 1,200 moves, arriving at hour 2, using two cranes at 30 moves/hour. Working-plan vessel finish is hour 22; one crane unavailable from hour 8 to 14 gives hour 25. A truck bottleneck of 20 moves/hour gives hour 62 in both cases: increasing crane capacity cannot bypass transport capacity. Terminal clearance may follow vessel completion because the yard still needs to drain.

### Delivery integration

Delivery uses real project schedules and model assignments through the existing modules. Asset records can explicitly reference a planning resource and delivery activity. These associations currently identify related records; operational outages do **not** automatically alter construction durations or reschedule the project. No new planning engine or guessed dependency impact has been introduced.

### Remaining approved scope

This release establishes the editable project foundation; it does not complete the full scope statement.

- Scene-driven operational playback tied to saved flow states, transport routes, operating calendars, arrival windows and priorities.
- Spatial exercise authoring: exclusion zones, triggers, equipment interaction, system events and participant actions distinguished in the debrief. Current actions are participant-recorded controls, not automatic hazard detection or certified assessment.
- Explicit cross-workspace impact calculation and review/adoption for linked delivery work, berth restrictions and shared-equipment conflicts.
- Saved reference baselines and richer scenario parameter alternatives; current operation comparisons use the working plan captured in each run.
- A representative imported terminal and berth-extension project exercising the complete three-workspace workflow, plus submission evidence.
- Richer shared inspectors, saved spatial viewpoints/hotspots, report assembly and project access controls where the existing project model permits them.

Live AIS/IoT, predictive maintenance, advanced physical simulation, VR integration and certified training remain future capabilities under the approved scope.

## Deployment

Alembic revision `f9017ab12c34` adds `projects.workspace`, `maritime_workspaces` and `maritime_runs`. Existing production deployment runs migrations before publishing. No production records were manually changed during implementation.

The new authenticated API lives at `/api/v1/maritime/projects/{project_id}`: workspace GET/PUT, run list/detail, operation execution and exercise-attempt submission. Definitions are bounded and validated, with a 2 MB persisted-plan limit. Runs retain immutable input/result snapshots; the UI lists the latest 100 runs.

## Verification and reproducibility

- 85 backend checks passed across the selected regression suites (including the migration test and a corrected fixture rerun). Coverage includes conservation, outage boundaries, transport and yard bottlenecks, shared capacity, maintenance, invalid inputs, authentication, ownership, conflicting saves, snapshots, project-copy remapping and Poe evidence isolation. Existing project, CPM and resource-cost tests run alongside these.
- 33 frontend unit checks passed for undo, equipment rigging, animation profiles and the existing Maritime demo. Frontend build/type checks and an Edge browser workflow exercise the real local API, save/versioning, scenario results, asset edits, model import/mapping/reload, exercise navigation/debrief, dark mode, downloads and shared module navigation.
- Browser fixture: run `backend/.venv/Scripts/python.exe backend/tests/browser_maritime_server.py` from the repository root, then `node tests/maritimeWorkspace.smoke.mjs` from `frontend`. It only permits a database ending in `_test`, binds to localhost and replaces external object storage with memory. Do not run pytest concurrently against that database. Restart the fixture to reset its named project before rerunning the browser test.
- Existing migration/deployment infrastructure is retained. Construction geometry conversion and IFC export logic are not changed by this release.
- Live generated Poe replies remain unverified locally: the provider account previously rejected requests for insufficient credit. Saved-evidence/tool behavior is tested separately; provider failure remains visible rather than producing a fabricated reply.

## Previous prototype

The earlier `/maritime/demo` supports a procedural terminal, a multiple-choice safety example and a six-activity delivery example. Its delivery calculation reuses the existing CPM and resource-cost functions, and sequence playback uses the existing animation engine. Public prototype calculation endpoints remain bounded and separate from persisted projects. Its session-scoped inputs are not imported automatically into project workspaces.
