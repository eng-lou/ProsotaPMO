# Prosota Maritime — implementation status

17 October 2026. Based on the supplied Maritime Development Brief v1.0.

## Product separation

- `/construction`: existing Construction public website and sign-in.
- `/maritime`: Maritime public website.
- `/maritime/workspace`: public, synthetic terminal prototype.
- Construction retains its authenticated projects and existing routes. Its Maritime link opens a separate tab to preserve open editing sessions.

The prototype does not query or modify Construction projects. Operations and delivery inputs use the tab-scoped `prosota_maritime_demo_v1` and `prosota_maritime_delivery_v1` session-storage keys. Delivery calculations run on the backend with isolated in-memory records. No database migration or live terminal feed is required. Poe uses the existing authenticated, approved-user AI allowance.

## Implemented

- Selectable procedural 3D terminal, eight shared asset IDs, camera views and controllable playback.
- Operate: vessel arrival, cargo handling, crane outage inputs, deterministic baseline comparison and downloadable JSON scenario report.
- Train: identify a restricted lifting zone, choose a response, receive a first-decision score, restart the exercise.
- Deliver: six activities (including parallel procurement and the readiness milestone), shared CPM working-calendar calculations, baseline/scenario criticality and float, resource assignments and forecast costs. Four visible expansion stages use the existing `computeAppliedAnimationStateAt` engine with the calculated dates. Playback progress is planned sequence progress, not actual progress.
- Poe: explanations grounded in server-calculated operations/delivery results, plus a validated delivery-scenario tool and explicit Apply proposal action. Provider errors remain visible; no fabricated fallback reply.
- Responsive product pages and workspace, accessible labelled inputs and explicit synthetic-data assumptions.

The default scenario handles 1,200 moves using two independent cranes at 30 moves/hour after arrival at hour 2. Baseline completion is hour 22. Losing one crane from hour 8 to 14 shifts completion to hour 25. Cargo conservation and outage boundary cases have automated tests. Vehicle animations are illustrative; tides, weather, queues and yard congestion are not modelled.

## Reuse assessment

The existing application provides React Three Fiber/Three.js rendering, animation profiles, authenticated project infrastructure, resources, costs, risks and Poe. Maritime reuses rendering dependencies, the animation engine, CPM forward/backward pass and resource-costing functions. Construction's full viewer and IFC export remain unchanged. The existing database scheduling wrapper now calls the extracted `calculate_schedule` function; its executable forward/backward-pass statements are identical to the previous implementation.

The actual Construction schedule UI uses a custom Gantt, not Syncfusion EJ2. Maritime presents a bounded scenario comparison table and timeline, using the same backend CPM pass, not a second client-side planning engine. `compute_assignment_budget_raw` calculates resource costs with full precision before totals are rounded.

## Connected delivery scenario

Default start: 19 October 2026. Mon–Fri, 08:00–17:00 with a one-hour lunch, no holidays. Foundation 12 days → deck 12 → installation 8 → commissioning 4 → readiness. Procurement runs for 20 days in parallel and also precedes installation.

- Baseline readiness: 8 December 2026; forecast £441,000.
- Foundation +15 working days: readiness 29 December, forecast £516,000, +240 crew/equipment assignment hours.
- Procurement +4 days: absorbed by four days of float, no readiness or cost change.
- Procurement +10 days: six working days of readiness delay and £6,000 additional site overhead; supply remains a lump sum.

Delay means **additional productive duration**, not idle suspension. Crews and plant stay fully utilised on the extended activity. Fixed material quantities and supply lump sums do not increase. Overhead is £1,000 per project working day by default. Rates, quantities and timing are synthetic, with material/supply costs recognised at task finish for the cost curve. Resource totals are assignment hours, not individual worker-hours; no resource levelling is performed.

## API and Poe

- `POST /api/v1/maritime/delivery/calculate`: public bounded synthetic calculation; no project identifiers or writes. Validates start date, selected activity, integer delay 0–90 days and finite nonnegative overhead rate.
- `POST /api/v1/maritime/poe`: approved sign-in and existing `require_ai_quota`; recalculates supplied inputs server-side. Uses the existing provider client. `evaluate_delivery_scenario` returns a calculated proposal, never an automatic mutation. Maximum four provider rounds and four tool calls per round.
- Calculation failures clear stale results and offer retry. Signed-in users return to Maritime after authentication. Scenario inputs and reports stay separate from Construction data.

## Next implementation stages

1. Persistent Maritime project/asset/scenario records and import/create workflows using existing project infrastructure; current scenario records remain synthetic and session-scoped.
2. Editable programme networks, calendars/holidays, resource quantities/rates and richer operational cost assumptions.
3. Stored training decisions and reports; no certification claims.
4. End-to-end demonstration recording and submission evidence.

Model import, live AIS/IoT, operational physics and certified training are outside this first release.

## Validation — 17 October 2026

- 53 backend tests: Maritime calculation/API/Poe tools and errors, existing CPM/whole-day/suspend-resume regressions, and resource-costing tests.
- Seven frontend operations/scoring/shared-ID tests.
- Production frontend build passed.
- Built-app browser checks against the real local calculation API: critical and parallel delays, costs, resource hours, baseline sequence, calculated playback dates, report export, Poe sign-in, operations/safety and mobile overflow.
- A real provider request was attempted. The locally configured Anthropic account rejected it for insufficient credit. The validated tool round-trip is tested with provider doubles, but live generated replies are **not verified**. Production uses its own configured provider/credentials and must have available quota/credit.

Construction saved-schedule tests passed after CPM extraction. This release does not claim live telemetry, actual cost/progress, persistent Maritime projects or certified training.
