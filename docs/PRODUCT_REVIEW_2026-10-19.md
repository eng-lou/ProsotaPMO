# Prosota improvement review — 19 October 2026

The next investment should make the existing schedule, model, resource, cost and risk data easier to follow through a decision. Prosota already has substantial capability; speed, visible data context and connected workflows offer the strongest immediate return.

Follow-up: the user authorised logging the recommendations and applying fixes. The [improvement backlog](IMPROVEMENT_BACKLOG.md) now tracks current status, priorities and acceptance criteria. The compact WBS lookup and the dashboard/register failure-recovery fixes below have since been implemented locally and checked; the larger workflow recommendations remain planned. The sections below preserve the original review findings.

This is a repository review across the main modules, with a production frontend build, the existing frontend tests and isolated browser checks of the changes below. It is not an authenticated production walkthrough, a backend integration test run or a large-model GPU benchmark. No production records were edited. Changes remain local and have not been pushed.

## Implemented in this pass

| Change | Practical effect | Verification |
| --- | --- | --- |
| Read schedule/resources only when Generate is pressed in Risk and ICD | Removes two full-dataset requests from opening each register. Each generation reads current inputs instead of retaining the initial snapshot in component memory. | Browser fixture using the real components and mocked APIs: opening makes no activity/assignment requests; failed reads produce no generation POST; retry succeeds; changing the budget changes the next generated values. |
| Index assigned resource IDs once | Replaces a scan through assignments for every resource with set membership checks. Filtering costs O(resources + assignments), rather than O(resources × assignments) in the worst case. | Identical results for 2,000 synthetic resources and 30,000 assignments, with and without selection filters. No change to spread or financial calculations. |
| Add frontend tests/build to CI and expose `npm test` | Frontend regressions can fail the CI run alongside backend regressions. | 103 tests passed; two optional real-IFC fixture tests skipped. CI itself will run after push. |
| Repair the signed-download test transport | Restores a test that failed during module initialisation because its Axios mock omitted the interceptor API required by undo. | Tests still check isolated signed downloads, transient retry and no retry on HTTP 403. Production download behavior unchanged. |

`npm run build` and `git diff --check` passed. Build warnings about large chunks remain. The 4D chunk is approximately 1.08 MB minified (308 KB gzip); the IFC model chunk is 3.60 MB (408 KB gzip). These are chunk sizes, not the total first-load download or measured loading times. Route lazy loading, persistent 4D, table virtualisation and request sharing already exist and should be retained.

## Next quick wins, in order

Effort is relative: small means a narrow change; medium crosses several views/services and needs integration checks. These are recommendations, not features implemented in this pass.

| Priority | Improvement | Evidence and user benefit | Effort / acceptance |
| --- | --- | --- | --- |
| 1 | Lightweight WBS lookup | Dashboard Overview downloads the complete activity response solely to populate its WBS selector. The activity service also attaches calculated EVM fields. Return only the identifiers, names, codes and hierarchy needed by the picker. | Small–medium. Preserve project/period access and ordering; compare payload size and API time on a large schedule. |
| 2 | Clear, consistent loading and retry | Dashboard has good initial/refresh handling, but its WBS lookup silently swallows errors and related-record filtering has no rejection handler. Cost's secondary schedule/resource load also lacks a catch. A failed request must not resemble an empty dataset or a successfully applied filter. | Small–medium. Exercise offline, retry and rapid project/scope switching; identify retained results as previous data. |
| 3 | One visible data-context strip | Dashboard already shows its data date and baseline status, but modules resolve the schedule period and controls period separately. Show active schedule, reporting date, baseline and live/frozen state consistently. | Small. The same context must appear in exports and remain correct after switching schedules/projects. |
| 4 | Explain a figure on demand | Resource Tracking explicitly uses elapsed-time estimates and cost-derived equivalents where period records are absent. Power BI distinguishes estimates and known totals too. Make this discoverable beside the figure: source, units, formula, date and missing inputs. | Small–medium. Never represent missing actuals as zero; opening the explanation must identify the contributing records. |
| 5 | Three useful starting layouts | Dashboard already supports saved layouts, look-ahead, mitigation actions, pending decisions and many other widgets. Offer focused starting layouts for Planner, Project Manager and Commercial users, with a few useful widgets each. | Small. Reuse existing layout storage; preserve saved user layouts and keep advanced widgets available. |
| 6 | Preview generated risks and ICD before saving | Risk generation uses template probabilities/impacts and a fallback programme duration; ICD includes watch placeholders. Buttons currently build drafts and immediately submit them. Present editable draft rows with assumptions and selection before applying. | Medium. Cancel must write nothing; show contingency effects; label suggested risks/watch items distinctly from observed issues. |

Evidence: `frontend/src/modules/dashboard/Overview.tsx`, `backend/app/services/activity.py`, `frontend/src/modules/costs/CostPlan.tsx`, `frontend/src/modules/scheduling/ResourceTrackingWidget.tsx`, `frontend/src/modules/dashboard/widgets.tsx`, `frontend/src/modules/risks/riskGeneration.ts`, `frontend/src/modules/icd/icdGeneration.ts`, and `prosotaPowerBI/README.md`.

## Value adds with the strongest product benefit

**1. A shared activity detail panel.** Select an activity from the Gantt, a model element or a report and open the same panel containing dates/logic, assigned resources, cost, linked risks/issues and model links. Keep the current screen and selection in place. Reuse activity IDs, RecordLinks, dashboard related-record resolution and existing detail editors. Start read-only with direct actions to the existing editors; do not duplicate financial logic. Success: investigate a late package without searching through five modules.

**2. A weekly controls report pack.** Assemble the existing baseline comparison, look-ahead, cost trend, top risks, decisions and selected model views into one dated, reproducible report. Store its scope and snapshot references so a later download contains the same figures. Extend existing baselines, layouts, print and export support. Success: one reviewed report has consistent totals, date and scope across all pages.

**3. Guided recovery comparisons.** Existing schedule variants, baselines, CPM and resource levelling provide much of the foundation. Guide the user through copying a plan, changing a constraint/resource assumption, recalculating and comparing completion, peak resource demand and cost. Protect the working plan until explicitly adopted. Schedule variants alone do not establish independent cost/risk scenarios; those effects need explicit scoping. Success: a user can explain the trade-off between two recovery options from reproducible calculations.

**4. Poe explanations tied to the selected work.** Add contextual prompts such as “Explain this finish variance”, “What is blocking this work?” and “Review this resource overload”. Reuse the existing planning tools and approval cards; return links to source records, assumptions and computed results. Distinguish a structural link from a proven cause. Success: each factual claim can be inspected, and proposed changes are reviewable before applying.

**5. Shareable Power BI models.** The current preview keeps IFC files in memory, so report viewers must reopen them after reload. A secured model/snapshot source with explicit permissions and refresh behavior would turn this from a local demonstration into a repeatable reporting workflow. This is a larger integration, with access and lifecycle design required. Do not market the current preview as already providing it.

## Subsequent optimisation work

Risk, Cost and ICD still render all visible register rows; reuse the schedule's row-window approach for large registers while retaining complete print/export datasets and expanded editors. Introduce retained query data gradually, scoped by project/period/schedule and invalidated after writes/undo. React Query is installed, but the main reviewed screens use manual effects; a library's presence does not mean caching is already effective.

Profile model download, IFC parsing, scene assembly, draw calls, memory and frame time separately before changing rendering. Use representative models and preserve existing import/export behavior. Keep Synchro/Bonsai compatibility work separate from this optimisation pass, as requested.

Recommended order: lightweight lookup and failure recovery; data context and figure explanations; shared activity panel; report pack; guided recovery and Power BI persistence. Measure request counts/payloads, module-open time and the number of steps needed to investigate one activity, rather than only counting new features.
