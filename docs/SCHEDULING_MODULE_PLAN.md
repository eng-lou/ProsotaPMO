# Scheduling Module — Consolidated Plan

Same process as `docs/RISK_MODULE_PLAN.md`, `docs/ICD_MODULE_PLAN.md`, and `docs/COST_PLAN_MODULE_PLAN.md`: read the prototype's actual Scheduling markup, read the relevant PMBOK/Rita Mulcahy chapter (Chapter 8, "Schedule" — covers Plan Schedule Management, Define/Sequence Activities, Estimate Activity Durations, Develop Schedule, Control Schedule), reconcile against what's currently built, then propose a phased plan for review before implementing anything.

This module is a bigger lift than Risk/ICD/Cost: those three added rigor to an existing CRUD screen. Scheduling has **no frontend module at all yet**, and the backend `activities` table is Sprint 1's bare-bones schema — no dependency logic, no calendars, no CPM engine. This plan proposes building the module to the same rigor bar in one pass rather than a "basic CRUD first, polish later" split, since a schedule without logic/float/critical-path is not really a schedule — it's a task list with date columns.

---

## A. What the Prototype Already Specifies

### A.1 Split-pane Gantt (left: data grid, right: bar chart)
Columns: Activity (with WBS icon + indent), Dur, BL Start, BL Finish, Start, Finish, Var (d), % Complete, Commentary. Rows are grouped into collapsible **WBS phases** (e.g. "Phase 1: Substructure") that themselves behave like real activities — they have a duration, BL/current dates, and roll up their children rather than being a purely cosmetic group header.

### A.2 Activity Detail panel — 5 tabs (Activity Details / Dates / Logic / Resources / Linked)
- **Activity Details**: Activity ID (human code, editable — e.g. `A1002`), Activity Name, WBS (parent chip + own chip), **Type** (Task / Milestone / WBS Summary), **Calendar** assignment, % Complete, Linked Cost (via `record_links`), Start/Finish, BL Start/Finish (read-only), Variance, Total Float, free-text **Commentary**.
- **Dates**: Early Start/Finish, Late Start/Finish, Total Float, Free Float (Current Dates column); BL Start/Finish/Duration/Float + a finish-variance narrative (Baseline Dates column); Actual Start/Finish, Remaining Duration (Actuals column).
- **Logic**: Predecessors table (ID / Activity / Type FS·SS·FF·SF / Lag) and Successors table, same shape, plus a **Constraint** (Constraint Type: As Soon As Possible / Start On or After / Mandatory Start / Finish On or Before, + Constraint Date).
- **Resources**: assigned resources table (Resource / Role / Units / Budget £) + a resource loading histogram (SVG bar chart, weekly buckets, mobilisation vs demobilisation).
- **Linked**: standard `record_links` tab, same as every other module.

### A.3 Toolbar + widgets
Search, Filters, Status filter (Critical/Delayed/At Risk), Link, Indent, a running strip (SPI, Float (CP), Planned Finish). Three schedule widgets:
- **Reschedule** — shift all/critical-path/selected/WBS-group activities forward or backward by N days/weeks/months, with an impact preview before applying.
- **Quality Check** — a **DCMA 14-point-style schedule quality panel**: 7 summary tiles (Logic Score, Missing Logic %, High Float %, Neg Float %, Hard Constraints %, Long Durations %, Resources Loaded %) plus a detail table of individual checks (Missing Predecessors, Missing Successors, Relationship Types non-FS, Positive Lags, High Float >44d, Negative Float, Hard Constraints, Durations >44d, Resources Loaded), each with a named DCMA standard number, threshold, actual value, and PASS/WARN/FAIL.
- **Calendar** — a table of named calendars (Standard/7-Day/Concrete, each with working days + hours/day + what's assigned to it) and a separate non-working exceptions table (bank holidays, shutdowns).

Import (.xer/.mpp/.pp/.xml, 3-step wizard: upload → map fields → review/resolve conflicts) and Export (.xer/.mpp/.pp/.xml/.xlsx) and Print/Preview (A3 landscape default, baseline bars/critical-path/data-date-line/commentary toggles) round out the toolbar — same shape as every other module's Import/Export/Print.

---

## B. What PMBOK7 / Rita Mulcahy Chapter 8 Adds

### B.1 The core theory our current schema has zero of
Our `activities` table has `start`/`finish`/`bl_start`/`bl_finish`/`variance_days`/`pct_complete`/`total_float`/`is_critical` — all as **free manual-entry fields**, including `total_float` and `is_critical`, which is the exact same "computed value exposed as manual input" bug already caught and fixed five times across Risk/ICD/Cost ([[feedback_computed_fields]]). Float and criticality are not opinions — they're outputs of the **Critical Path Method**:
- **Forward pass**: walk Start→End following dependencies, computing Early Start/Early Finish for every activity (at path convergence, take the *latest* EF feeding in).
- **Backward pass**: walk End→Start, computing Late Start/Late Finish (at path convergence, take the *earliest* LS feeding in).
- **Float = LS − ES = LF − EF.** Zero float = critical path. Negative float = behind an imposed constraint.
- **Total float**: how long an activity can slip without delaying the project end date. **Free float**: how long it can slip without delaying its successor's early start. Different numbers; the prototype's Dates tab shows both.

None of this is computable without the two things also currently missing entirely: **dependency logic** (predecessor/successor relationships with type + lag) and **duration** (we store dates, not a duration input — duration must be the real input, with dates derived from duration + calendar, matching how the prototype's Dur column and Import mapping (`total_float_hr_cnt` → `total_float`, i.e. imported schedules bring float in, they don't compute it locally) already assume this).

### B.2 Logical relationship types (all four, not just FS)
Finish-to-Start (activity must finish before successor starts — the default/most common), Start-to-Start, Finish-to-Finish, Start-to-Finish (rare). Matches the prototype's Logic tab exactly (FS/SS/FF/SF chips + Lag column). Dependencies are also classified as mandatory/discretionary/external/internal — mandatory + discretionary matters for schedule compression (only discretionary logic can be fast-tracked); external/internal is not visibly used in the prototype and isn't proposed here.

### B.3 Constraints
As Soon As Possible (no constraint — normal case), Start On or After / Finish On or Before (soft — the network can still push dates but not before/after the constraint), Mandatory Start (hard — CPM must honour it exactly, can produce negative float if infeasible). Matches the prototype's Constraint Type dropdown field-for-field.

### B.4 Schedule compression (the Reschedule widget's actual theory)
**Fast tracking** = running critical-path activities in parallel that were sequential (only works on discretionary dependencies; adds risk/rework). **Crashing** = adding resources to shorten critical activities (adds cost). The book is explicit that compression only ever targets the **critical path** — pushing a non-critical activity does nothing to the end date. This directly informs the prototype's Reschedule widget's "Apply To: Critical path only" option, which is the option that actually does something to the finish date; "All remaining activities" is a blunt shift, not true compression.

### B.5 Schedule baseline
"The approved version of the schedule model used to manage the project... can only be changed as a result of formally approved changes." This is architecturally the same shape as Cost Plan's `rev_a_baseline` fix from last session — a baseline should be **set once (frozen)**, not a pair of free-edit fields quietly drifting alongside the live dates. Ch. 8 also states project float = the gap between the schedule baseline's finish and the critical path's calculated finish — i.e. baseline capture and CPM output are the same mechanism, not two separate features.

### B.6 What the reference material does *not* cover
The DCMA 14-Point Assessment is a US Defense Contract Management Agency standard, not a PMI/PMBOK artifact — it doesn't appear in Rita Mulcahy or the PMBOK Guide. It's real, industry-standard practice for schedule quality auditing (Maro will already know it from planning practice), but the exact check formulas and thresholds need to come from Maro directly rather than being guessed from the prototype's 8 example rows — same situation as the EMV fix, where domain-specific numbers needed the human expert, not just the reference PDFs.

---

## C. Gap Analysis

| Capability | Prototype | PMBOK Ch. 8 | Currently built? |
|---|---|---|---|
| Any frontend module at all | Yes | — | ❌ Missing — backend-only, no `frontend/src/modules/scheduling/` |
| Human-readable reference code (`ACT-0001`-style, distinct from the prototype's freely-editable "Activity ID") | Implied by pattern used everywhere else | — | ❌ Missing |
| `duration_days` as the real input (dates derived) | Yes (Dur column) | Yes — duration estimates drive Develop Schedule | ❌ Missing — only `start`/`finish` dates exist, no duration field |
| `activity_type` (Task/Milestone/WBS Summary) | Yes | Yes (milestones have zero duration, WBS summary rows roll up children) | ❌ Missing |
| Real WBS hierarchy (phase rows roll up children) | Yes | Yes (WBS decomposition) | ❌ Missing — `wbs_path` is a flat string, no parent/child structure |
| Predecessor/successor logic (FS/SS/FF/SF + lag) | Yes | Yes — Sequence Activities, whole section | ❌ Missing entirely — no relationship table |
| Constraints (type + date) | Yes | Yes | ❌ Missing |
| Calendars (named, working days/hours, assigned per activity) + non-working exceptions | Yes | Yes (calendar needed to convert duration → dates) | ❌ Missing entirely |
| **CPM engine**: ES/EF/LS/LF, total float, free float, is_critical — computed, not manual | Implied (shown as data) | Yes — the chapter's core content | ❌ **Actively wrong today** — `total_float`/`is_critical` are manual free-entry fields, same bug class as Risk's EMV/Cost's CPI-SPI |
| Actual Start/Finish, Remaining Duration | Yes (Dates tab, Actuals column) | Yes (progress tracking) | ❌ Missing |
| Baseline captured once, then frozen (not free-edit) | Implied by Ch. 8 §B.5 | Yes | ❌ `bl_start`/`bl_finish` are free-edit manual fields today — same bug class as Cost's `rev_a_baseline` before its fix |
| `variance_days` computed from finish vs BL finish | Yes | Yes | ❌ Currently manual entry |
| Commentary (free text) | Yes | — | ❌ Missing |
| Resources (assigned resources, budget, loading histogram) | Yes | Yes (Estimate Activity Resources, resource optimization) | ❌ Missing — no resource model anywhere in the app |
| Schedule Quality panel (DCMA-style) | Yes | Not PMBOK (industry standard, see B.6) | ❌ Missing |
| Reschedule tool (shift + compression, with impact preview) | Yes | Yes (schedule compression theory, §B.4) | ❌ Missing |
| Search/Filters/Group/Export/Print toolbar | Yes | — | ❌ Missing — same pattern already built 3x for Risk/ICD/Cost |
| Reassessment/history log | Not explicit in prototype, but same real need as other 3 modules | (implicit — Control Schedule is iterative) | ❌ Missing — 4th occurrence; shared `reassessments` table + `ReassessmentLog.tsx` already exist from the Cost Plan session, this would be pure reuse, not a new build |
| Real Import (.xer/.mpp/.pp/.xml parsing) | Yes (UI only) | — | ❌ Deliberately deferred, same as Risk/ICD/Cost |
| Monte Carlo / what-if simulation | Not in prototype | Yes (mentioned, not detailed) | Not proposed — no UI demand from the prototype |

---

## D. Proposed Phased Plan (for review — nothing implemented yet)

**Phase 1 — Field gaps + fix the computed-field bug**
- Add `code` (reference code, `ACT-0001`-style, reusing the shared `next_code()` generator), `activity_type` (`task | milestone | wbs_summary`), `duration_days` (Integer — the real input; milestones always 0), `commentary` (Text), `actual_start`/`actual_finish` (Date), `remaining_duration_days` (Integer).
- `variance_days`, `total_float`, `is_critical` become **computed-only** (server-side, never accepted as API input) — same fix pattern as Risk's EMV and Cost's CPI/SPI. Until Phase 5's CPM engine exists, these compute from the simplest honest formula available (`variance_days` = finish − bl_finish; `total_float`/`is_critical` return null/unknown rather than a fake number) rather than inventing a placeholder.
- `bl_start`/`bl_finish` become **frozen-at-baseline-capture**, not free-edit — removed from the routine Update schema, only settable via a dedicated "Set Baseline" action (Phase 6).

**Phase 2 — WBS hierarchy**
- Add self-referencing `parent_id` on `Activity`. A `wbs_summary`-type activity's duration/dates/pct_complete become computed rollups of its children (earliest child start, latest child finish, duration spanning that range, pct_complete as a duration-weighted average) rather than independently editable — matches how the prototype's Phase 1 row behaves.

**Phase 3 — Logic (dependencies) + constraints**
- New `activity_relationships` table: `predecessor_id`, `successor_id`, `relationship_type` (`FS|SS|FF|SF`), `lag_days` (signed integer — lag or lead). Reject self-referencing and direct-cycle links at the API layer (a same-pair reverse link already existing is a cycle; full cycle detection runs as part of Phase 5's CPM pass, which needs a cycle-free graph to terminate).
- Add `constraint_type` (`asap|snet|ms|fnlt`) and `constraint_date` to `Activity`.

**Phase 4 — Calendars**
- New `calendars` table (project-scoped: name, working-day pattern (Mon–Sun booleans), hours/day, `is_project_default`) + `calendar_exceptions` (date or date-range, label, `is_working` — covers both "bank holiday" and "planned Saturday working" cases) + `calendar_id` FK on `Activity`, **nullable** — null means "inherit the project's default calendar." Auto-seed one "Standard Calendar" (Mon–Fri, 8h/day) as the project default on first access, same lazy-seeding pattern as Risk/ICD/Cost's criteria tables. Full CRUD UI for creating additional named calendars (e.g. "Saturday Working") and assigning them per-activity, matching Maro's excavation-activity example.

**Phase 5 — CPM engine**
- A new service (`app/services/scheduling_cpm.py`) that, given a period's activities + relationships + durations + calendars + constraints, performs the forward pass (ES/EF) and backward pass (LS/LF) per Ch. 8 §B.1, honouring lag/lead per relationship type and constraint type, and writes back computed `start`/`finish`/`total_float`/`free_float`/`is_critical` for every activity plus the project's overall critical-path finish date. Runs on-demand (activity create/update/delete/relationship change triggers a recompute of the affected period) rather than on every read, for performance. Detects cycles and reports them as a validation error rather than looping.
- **Reference (study only, no code reuse):** Maro pointed to `bardsoftware/ganttproject` (GPL-3.0, Java/Kotlin desktop app) as a free resource. Confirmed with Maro (2026-07-02) to use it as a clean-room algorithmic reference alongside PMBOK Ch. 8 — read how its scheduling core structures forward/backward pass, WBS rollups, and calendar-exception handling for ideas, then independently write our own Python implementation. No code copied: GPL-3.0 contamination risk for a commercial product plus a total stack mismatch (JVM vs. our Python/TypeScript stack) rule out literal reuse.
- This is the single largest phase and the one the rest of the module depends on — `total_float`/`is_critical`/computed dates are all downstream of it.

**Phase 6 — Baseline capture**
- A "Set Baseline" action: copies current `start`/`finish`/`duration_days` into `bl_start`/`bl_finish`/`bl_duration_days` for every activity in the period, one-time and then frozen (mirrors Cost Plan's `rev_a_baseline` pattern). This is also the mechanism that unlocks a genuine time-phased Planned Value curve for Cost Plan's still-deferred real SPI/SV — each activity's baseline dates + its linked cost budget become a PV distribution over time, closing the gap flagged at the end of the Cost Plan session.

**Phase 7 — Schedule Quality panel (DCMA-style)**
- Reuses the Risk/ICD/Cost Criteria & Thresholds pattern: a project-scoped `schedule_quality_thresholds`-equivalent (or hard-coded defaults if Maro prefers, pending his answer below), computing the checks that are honestly derivable from our own data once Phases 3–5 exist: missing predecessors/successors, relationship-type mix (% non-FS), positive-lag %, hard-constraint %, high-float %, negative-float %, long-duration %. Exact thresholds/formulas per DCMA standard numbers to be confirmed by Maro (§B.6) before implementing this phase specifically.

**Phase 8 — Reassessment log + toolbar utilities**
- Wire `Activity` into the existing shared `reassessments` table + `ReassessmentLog.tsx` (trigger fields: `start`/`finish`/`pct_complete`/`status` if a status field is added — see open question 5) — pure reuse, no new backend pattern.
- Search/Filters(critical/delayed/at-risk, matching the prototype's status filter)/Group-by(WBS phase)/CSV export/Print — same shape as Risk/ICD/Cost, new files following the established pattern.

**Phase 9 — Reschedule tool**
- Given Phase 5's CPM engine exists, "shift critical path by N days" is a real, computable action: shift the affected activities' dates and re-run the CPM pass, with the impact preview being an honest before/after diff rather than a mockup number. "All remaining" and "WBS group" shift modes included; "Selected activities" reuses the toolbar's existing selection mechanism from Phase 8.

**Explicitly deferred, with reasoning:**
- **Resources** (assignment, budget-per-resource, loading histograms) — no resource model exists anywhere in the app yet; this is a genuinely separate module-sized piece of work (resource pool, calendars-per-resource, leveling/smoothing per Ch. 8 §"Resource Optimization"), not a Scheduling sub-feature to bolt on. Flagging as a future module, same treatment as Period Manager.
- **Real Import** (.xer/.mpp/.pp/.xml parsing) — same reasoning as every prior module: a separate, substantial task (`ARCHITECTURE.md` §6 already flags MPP specifically as needing a research spike). Would be the highest-value import of the four modules once tackled, since Maro's own `xerparser` familiarity makes `.xer` tractable first.
- **Monte Carlo / what-if simulation** — no prototype UI demand for it beyond a passing mention in the reference material; not worth building speculatively.
- ~~Multi-calendar assignment~~ — **not deferred**, confirmed in scope for Phase 4 (see Decisions below): a full calendar CRUD (working days/hours + exceptions) with project-default + per-activity override, not just the auto-seeded Standard Calendar.

---

## Decisions Confirmed by Maro (2026-07-02)

1. **WBS hierarchy** — confirmed real hierarchy, **Microsoft Project style rather than P6 style**: no separate WBS-dictionary entity distinct from the activity list (P6's model). The outline hierarchy *is* the activity list — any row can be indented under any other, a row becomes a summary task automatically when something is indented under it, and WBS codes are auto-generated from outline position (`1`, `1.1`, `1.2`, `2`...) rather than user-typed. Confirms Phase 2's self-referencing `parent_id` approach; adds that `wbs_path` should be computed from tree position, not a manually-typed string.
2. **CPM engine (Phase 5)** — confirmed build it now, "very important to get it right." No change to the phased approach proposed.
3. **Calendars (Phase 4)** — expanded beyond the single-default proposal: real multi-calendar support in this first pass. A calendar defines working days + hours/day and can have exception days (both "add a non-working holiday" and "add working — e.g. Saturday" cases). One calendar is the **project default**; individual activities can either inherit the project default or be assigned a specific calendar override (Maro's example: whole project on a standard 5-day week, one excavation activity overridden onto a Saturday-working calendar due to resource availability). `calendar_id` on `Activity` is nullable — null means "inherit project default."
4. **DCMA Schedule Quality checks (Phase 7)** — confirmed: **checks 1–12 are the priority** (Logic/Missing Predecessors, Leads, Lags, Relationship Types, Hard Constraints, High Float, Negative Float, High Duration, Invalid Dates, Resources, Missed Tasks, Critical Path Test). Checks 13–14 (Critical Path Length Index, Baseline Execution Index) require longitudinal data across multiple periods of actual baseline-execution history and are deferred until enough period history exists to make them meaningful — consistent with how Reserve Rollup/Sensitivity Analysis were deferred for Risk pending the future Controls Dashboard.
5. **Status field** — confirmed: defer to Claude's judgement. Proceeding with computed badges (critical/delayed/at-risk), no new manual `status` column, per the reasoning in the original question.
6. **Rollout** — confirmed **staged**, not one continuous authorized run. Each phase gets implemented, verified (tests + `tsc --noEmit` + manual click-through where relevant), and confirmed by Maro before moving to the next phase — same discipline as the Risk Module's rollout, not Cost Plan's single continuous pass.

---

## E. Gantt Chart — Rendering Plan

The prototype's layout is a split pane: a resizable **data grid on the left** (Section A.1's columns — Activity/Dur/BL Start/BL Finish/Start/Finish/Var/% Complete/Commentary) and a **time-scaled bar chart on the right**, both sharing row height and vertical scroll position; only the right pane scrolls horizontally, with zoom levels (day/week/month/quarter).

**Recommendation: build this as a custom SVG component, not a third-party Gantt library.** Commercial options (Bryntum, dhtmlx-gantt) add licensing cost and a dependency risk `ARCHITECTURE.md` doesn't currently carry; free React Gantt libraries (frappe-gantt, gantt-task-react) fight our Tailwind design system and don't cleanly support CPM-driven critical-path highlighting or baseline ghost-bars without heavy overriding. The prototype itself is raw SVG/HTML — there's already a working reference to build from, and Recharts (our existing charting dependency) is the wrong tool for row-synced Gantt bars with dependency arrows.

Fidelity is added incrementally alongside the phases that produce the data it renders, rather than built once monolithically:
- **Phase 1** (as soon as activities/dates/duration exist): plain bars, start→finish, no arrows, no colour-coding beyond a default and a milestone diamond marker.
- **Phase 3** (once `activity_relationships` exists): dependency arrows drawn between predecessor/successor bars, respecting FS/SS/FF/SF connection points.
- **Phase 5** (once the CPM engine computes `is_critical`): critical-path bars and arrows rendered in red, matching the prototype.
- **Phase 6** (once baseline capture exists): a ghost/outline baseline bar behind the current bar, matching the prototype's "Show baseline bars" print toggle.
- **Phase 7** (Quality Check panel): no new Gantt rendering needed — the panel is a separate widget, not an overlay on the chart.
- **Phase 9** (Reschedule tool): the impact-preview diff can reuse the same bar-rendering component in a small before/after comparison, rather than building a second renderer.

No separate "Phase 10: build the Gantt" — the chart is a rendering layer over data that already has to exist for other reasons, so each phase above includes "extend the Gantt renderer" as one of its steps rather than deferring visualisation to the end.

---

**Status:** Approved — proceeding phase by phase, staged (TaskCreate-tracked, verified and confirmed by Maro at each phase before moving on) — per Decision 6 above.
