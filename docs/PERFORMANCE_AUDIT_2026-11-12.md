# Performance audit — 12 November 2026

Target: 0.2.49-preview.13. Trigger: creating/renaming unlinked activities and WBS rows remained slow in Preview .12. Expanded scope: application startup, scheduling, data refreshes, dashboard/cost/risk/ICD entry points, persistent 3D background work and diagnostics.

## Confirmed findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Activity edits | Every ordinary PATCH ran hierarchy, CPM, then hierarchy again, including label-only saves. | Metadata-only/no-op requests skip schedule recomputation. Schedule-affecting edits keep CPM and rollups. |
| Inspector | Every save echoed unchanged schedule fields, including minute-rounded dates; its values did not follow inline edits. | Send only changed normalized fields. Refresh clean form fields from server results without replacing unsaved typing. |
| Grid / creation / WBS | Name edits reloaded schedule collections; new rows and outline moves also reloaded all model links/calendars/resources. | Apply name-edit response to its row. Creation and outline edits refresh affected scheduling collections only. |
| Shared calendar calculations | Float, rollup and EVM calculations repeatedly walked years of working days for each row. | Request-local cumulative calendar totals reuse whole-day calculations. Partial days retain original rounding; calendars, exceptions and breaks stay authoritative. Short ranges avoid yearly setup. |
| Resources | Spread loading and derived resource data ran even on Activities tab. | Demand-load on Resources tab; cancel obsolete requests; stop spread requests while 4D is inactive. |
| Backend startup | IFC revision worker, spreadsheet parser, Anthropic and Gemini SDKs loaded at startup regardless of use. | Import them when the corresponding feature is invoked; retain dependencies in the desktop build. |
| Hidden 3D | Idle driver continued requestAnimationFrame polling and global input listeners with frameloop=never. | Suspend polling/listeners when the canvas is inactive, resume on activation. Geometry stays mounted. |
| Diagnostics | No request-duration separation to distinguish backend delay from renderer blocking. | Server-Timing header, slow API route-template logging (750ms threshold); bounded memory-only browser timing records. |

## Measured results

- 661 working-time queries, including a 600-activity six-year horizon: original day walk **1.427s**, cumulative totals **0.012s**. Exact equality checked against the original algorithm, including reversed ranges, partial days, breaks, exceptions and leap year. This is a calculation benchmark, not total UI latency.
- Fresh Python processes importing app.main: **5.494s before**, **2.716s after** lazy feature imports. This measures the backend import phase, not complete installed application startup; OS caching and concurrent workloads affect timings.
- Metadata-edit regression verifies no CPM/hierarchy execution and unchanged dates, while duration edits still perform CPM and both hierarchy passes.

## Scan coverage and limits

Read the route/lazy-load and persistent-view lifecycle, desktop startup composition, backend import profile, API undo interceptors, scheduling edit/creation paths, resource hooks, backend await-in-loop hotspots, dashboard/cost/risk/ICD fetch patterns, and 3D idle/render drivers. Dashboard already uses an aggregate overview endpoint; core routes already lazy-load. No blanket caching or reduction of rendering quality was introduced.

This is a broad source audit with targeted tests and benchmarks. It is **not** an end-to-end timing capture of every feature on the user's Tower project. Native IFC parsing, large-model GPU/shadow cost, bulk hierarchy mutations and baseline trend queries remain candidates if measurements identify them as material bottlenecks. No user-project database was used for mutation tests.

## Diagnostics for remaining stalls

In browser/desktop DevTools: `console.table(window.prosotaPerformance.snapshot())`; reset with `window.prosotaPerformance.clear()`. Records are capped at 100, memory-only, and contain slow request paths with UUIDs masked and query strings removed, timings, and long-task durations. They contain no request/response bodies or credentials and are not uploaded. API response Server-Timing reports server duration separately. The desktop backend log records slow API route templates, never query strings or request bodies.

## Validation

- Scheduling/calendar/metadata regression run: 38 tests passed.
- Optional-feature and calendar run: 55 tests passed, 14 subtests passed (OpenAI integration, P6 Excel, IFC revision, calendars).
- Frontend activity patch, timeline date reuse, selection migration and site animation: 12 tests passed.
- Frontend resource profiles/assignments, pending reads, undo and load errors: 27 tests passed.
- Resource demand-loading test: passed; hidden panel performs no spread POST, opening loads, cleanup aborts.
- WBS summary locks and profile update regressions: 16 tests passed.
- Diagnostic record bounds and redaction test: passed.
- Total unique tested cases: 109 backend tests plus 14 subtests; 41 frontend tests.
- TypeScript, production UI build and backend rebuild completed. Copied runtime fingerprint verified; archived application modules and deferred dependencies verified present. Installer packaging remains a separate step. No Stable release or publication.
