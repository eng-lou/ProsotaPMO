# Prosota improvement backlog

Updated: 19 October 2026. Source: [product review](PRODUCT_REVIEW_2026-10-19.md).

**Implemented locally** means code is changed and checked; it does not mean deployed. **Next** and **Later** are recommendations awaiting implementation. Scope is the existing Prosota platform. Synchro resource interoperability and Maritime are excluded from this pass.

## Fixes and optimisations

| ID | Priority | Recommendation | Status | Acceptance / evidence |
| --- | --- | --- | --- | --- |
| FIX-01 | High | Load generation inputs only when needed in Risk and ICD | Implemented locally | Register opening avoids full activity/assignment downloads. Each Generate reads current inputs; failed reads write nothing. Previous browser checks covered retry and changed source budgets. |
| FIX-02 | High | Use a compact WBS lookup | Implemented locally | Dashboard Overview and Baseline Comparison request five picker fields for summary activities. One scoped query, preserved outline order, no EVM calculation. In-memory database checks cover ordering, project/period isolation and response shape. |
| FIX-03 | High | Make dashboard failures recoverable | Implemented locally | WBS lookup, related-record resolution, baseline-set loading and baseline comparison expose retries. Failed related filters are not marked active. Failed WBS changes hide old figures while preserving widget layout state. Late/cancelled responses cannot replace the current view. |
| FIX-04 | High | Recover failed Risk, ICD and Cost register loads | Implemented locally | Retry reloads inputs and clears the error. Failed loads do not expose an empty editable register. Project changes reset local component state; controls-period changes wait for that period's data. |
| FIX-05 | High | Handle missing Cost schedule/resource inputs explicitly | Implemented locally | Lookup failure shows Retry. Resource grouping, its grouped print action and linked rate breakdowns are unavailable until supporting data loads. The rest of the cost plan remains usable; no financial formula changes. |
| FIX-06 | Medium | Index assigned resources | Implemented locally | Set membership replaces a resource-by-assignment scan. Previous equivalence check used 2,000 resources and 30,000 assignments. No changes to resource spread calculations. |
| FIX-07 | High | Run frontend regression checks in CI | Implemented locally | `npm test` and the production build are in CI. Signed-download test transport repaired. Local frontend suite: 103 passed, 2 optional real-IFC fixtures skipped. Remote CI has not run for these unpushed changes. |

## Next improvements

Effort is relative: small is a focused UI change; medium spans several modules/services; large requires data lifecycle or integration design.

| ID | Priority | Recommendation | Effort | Acceptance criteria |
| --- | --- | --- | --- | --- |
| UX-01 | High | A consistent data-context strip | Small–medium | Show active schedule, reporting/data date, assigned baseline and live/frozen state across reports and modules. The same scope appears in exports and remains correct after project/schedule changes. |
| UX-02 | High | Explain a figure on demand | Medium | Beside a KPI, show source records, formula, units, date and missing inputs. Explicitly distinguish recorded actuals, elapsed estimates and cost-derived equivalents. Missing actuals must never silently become zero. |
| UX-03 | Medium | Planner, Manager and Commercial starting layouts | Small | Reuse existing dashboard widgets/layout storage. Useful defaults with a few relevant widgets; never overwrite saved user layouts. |
| UX-04 | High | Preview generated Risk/ICD drafts | Medium | Show assumptions, suggested rows and contingency effects before saving. Allow editing/selection; cancelling writes nothing. Suggested risks and watch items are distinct from observed issues. |

## Value adds

| ID | Priority | Recommendation | Effort | Acceptance criteria / reuse |
| --- | --- | --- | --- | --- |
| VALUE-01 | High | Shared activity detail panel | Medium | Open the same activity context from Gantt, model or report: logic, dates, resources, cost, risks/ICD and linked elements. Preserve screen/selection. Reuse IDs, RecordLinks and existing editors; begin with read-only detail and links to actions. |
| VALUE-02 | High | Weekly controls report pack | Medium–large | Combine baseline comparison, look-ahead, cost trend, risks, decisions and selected model views. Save snapshot/scope references so later downloads reproduce the reviewed figures. Reuse layouts, baselines and export support. |
| VALUE-03 | Medium | Guided recovery comparisons | Large | Copy a plan, adjust constraints/resources, recalculate and compare finish, demand and cost. Working plan changes only on adoption. Reuse variants/CPM/levelling; explicitly design cost/risk scenario isolation. |
| VALUE-04 | Medium | Contextual Poe explanations | Medium | Explain a selected variance, blocking work or overload using defined tools and calculation outputs, with inspectable sources/assumptions. Proposed writes remain reviewable. Links alone are not proof of causation. |
| VALUE-05 | Medium | Shareable Power BI model source | Large | Report viewers reopen an authorised, versioned model/snapshot without manually selecting a local IFC every session. Define storage, access, expiry and refresh behavior. Current in-memory preview does not provide this. |

## Later optimisation

| ID | Priority | Recommendation | Acceptance criteria |
| --- | --- | --- | --- |
| PERF-01 | Medium | Window large Risk, Cost and ICD registers | Measure render/scroll time with large registers. Reuse scheduling's row-window approach, preserving expanded editors, keyboard access and complete print/export data. |
| PERF-02 | Medium | Retain query data across module visits | Scope by project, controls period and schedule. Invalidate after writes and undo; cover out-of-order responses and selection changes before broad rollout. |
| PERF-03 | Medium | Profile the 3D pipeline before further changes | Measure download, parsing, scene assembly, memory, draw calls and frame time with representative models. Preserve import/export and animation behavior. Chunk size alone is not a rendering benchmark. |

## Verification for this fix pass

- Frontend: 103 tests passed, two optional real-IFC fixture tests skipped; production build passed with the existing large-chunk warnings.
- New WBS tests: two passed using an isolated in-memory SQLite table and real SQLAlchemy queries; no project database used. The tests verify scope, ordering, compact schema, no EVM calls and static route placement. A live PostgreSQL/API latency benchmark is still outstanding.
- Browser fixture: real Overview, Baseline Comparison, Risk, ICD and Cost components with synthetic API responses. DashboardGrid is replaced with a stateful test child to verify that scope changes preserve its edits. Checks cover failure/retry, disabled resource grouping, hidden stale figures, late schedule responses and cancelling pending filters. This is not an authenticated production walkthrough.
- No schedule, resource spread, cost, risk or IFC calculation/export algorithms changed in this pass.
- Deploy the frontend with the backend containing `/api/v1/activities/wbs-options`; the lookup needs that new endpoint. No database migration is required. These changes have not been pushed or deployed.

Repeat the isolated WBS checks from `backend`: `python -m pytest --noconftest -p pytest_asyncio.plugin tests/test_wbs_options.py -q`. The browser fixture builder and source are retained under `outputs/build-recovery-smoke.mjs` and `outputs/recovery-smoke-source.tsx`; build with `node outputs/build-recovery-smoke.mjs`, serve `outputs`, open `recovery-smoke.html` and select **Run checks**. All its APIs are mocked and unexpected writes are rejected.

Recommended next delivery: UX-01 and UX-02, followed by VALUE-01. They make the existing figures and linked records easier to trust before adding more screens.
