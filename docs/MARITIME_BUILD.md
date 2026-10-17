# Prosota Maritime — first build

17 October 2026. Based on the supplied Maritime Development Brief v1.0.

## Product separation

- `/construction`: existing Construction public website and sign-in.
- `/maritime`: Maritime public website.
- `/maritime/workspace`: public, synthetic terminal prototype.
- Construction retains its authenticated projects and existing routes. Its Maritime link opens a separate tab to preserve open editing sessions.

The prototype does not query or modify Construction projects. Scenario parameters use the tab-scoped `prosota_maritime_demo_v1` session-storage key. There is no backend migration or live terminal feed in this release.

## Implemented

- Selectable procedural 3D terminal, eight shared asset IDs, camera views and controllable playback.
- Operate: vessel arrival, cargo handling, crane outage inputs, deterministic baseline comparison and downloadable JSON scenario report.
- Train: identify a restricted lifting zone, choose a response, receive a first-decision score, restart the exercise.
- Deliver: four illustrative expansion stages using the existing `computeAppliedAnimationStateAt` animation engine. These are calendar-day previews, not a calculated construction schedule.
- Responsive product pages and workspace, accessible labelled inputs and explicit synthetic-data assumptions.

The default scenario handles 1,200 moves using two independent cranes at 30 moves/hour after arrival at hour 2. Baseline completion is hour 22. Losing one crane from hour 8 to 14 shifts completion to hour 25. Cargo conservation and outage boundary cases have automated tests. Vehicle animations are illustrative; tides, weather, queues and yard congestion are not modelled.

## Reuse assessment

The existing application provides React Three Fiber/Three.js rendering, animation profiles, authenticated project infrastructure, resources, costs, risks and Poe. Maritime reuses rendering dependencies and the animation engine now. Construction's full viewer, IFC export and scheduling logic remain unchanged.

The actual schedule UI uses a custom Gantt, not the Syncfusion EJ2 component described in the brief. Authoritative scheduling is backend/database based in `backend/app/services/scheduling_cpm.py` and `scheduling_reschedule.py`; a second client-side CPM engine has deliberately not been introduced.

## Next implementation stages

1. Add an authenticated Maritime project scope and persistent shared asset/scenario records using the existing project infrastructure.
2. Seed the berth expansion into the existing scheduling engine, including calendars, dependencies, resource assignments and costs. Verify the proposed 15-working-day delay against its baseline and downstream effects.
3. Bind those calculated dates and assignments to the terminal delivery sequence and comparison view.
4. Extend training with timed events and stored exercise reports; keep certification claims out of the prototype.
5. Connect Poe to authoritative scenario outputs and project tools. Explanations must not invent simulation results.

Model import, live AIS/IoT, operational physics and certified training are outside this first release.

## Validation

- Seven Node tests in `frontend/tests/maritimeSimulation.test.mjs` cover calculations, boundaries, input validation, scoring and shared references.
- Production frontend build.
- Built-app browser checks: public routes, WebGL rendering, outage edits, baseline delta, safety scoring, delivery playback, report download, session persistence and mobile overflow.

These checks do not constitute validation of backend Maritime scheduling, which is not yet connected.
