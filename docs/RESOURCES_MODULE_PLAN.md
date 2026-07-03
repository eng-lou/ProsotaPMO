# Resources Module — Resource-Loaded / Cost-Loaded Scheduling

Same process as every other module: read the prototype, read the relevant PMBOK/Rita
Mulcahy chapter (Chapter 9, "Budget and Resources" — Plan Resource Management,
Estimate Activity Resources, Earned Value Management formulas), reconcile against
what's built, propose a plan, get sign-off, implement phase by phase.

## A. What exists today

Nothing. `docs/SCHEDULING_MODULE_PLAN.md` flagged Resources as "a genuinely
separate module-sized piece of work" and deliberately deferred it (same treatment
as Period Manager). No `Resource` model, no resource FK anywhere, confirmed by a
full grep of `backend/app/models/`.

The prototype (`docs/prototype/prosota-pmo_7.html`) shows Resources as a 5th tab
inside an activity's detail panel (`#ptab-resources`), not a standalone module: an
"Assigned Resources" table (Resource / Role / Units / Budget columns, e.g. "Piling
Contractor (Huber)" / Subcontractor / "1 mob." / £354,451), a "+ Assign Resource"
button, and a weekly resource-loading histogram. DCMA check #14 ("Resources Loaded
%," >90% threshold) also references this but is out of scope — checks 13-14 are
already deferred pending longitudinal data, per the Scheduling plan.

Cost Plan's `CostElement`/`CostRateLine` models have no resource hooks at all.
`CostElement.budget` is a plain, independently-editable column — `CostRateLine`
rows are supporting breakdown detail, not currently rolled up automatically into
`budget`.

## B. Why now

Cost Plan's SPI (Schedule Performance Index) was removed in Session 11 because it
needed a real time-phased Planned Value curve to compare against, which didn't
exist yet — noted at the time as blocked on the Scheduling module. Scheduling now
has real baseline dates (`bl_start`/`bl_finish`, hour-precision since Phase 10).
Per Rita Mulcahy Ch.9's own definitions:

| Acronym | Term | Formula | Meaning |
|---|---|---|---|
| PV | Planned Value | (time-phased) | As of today, the estimated value of work planned to be done |
| EV | Earned Value | BAC × %complete | As of today, the estimated value of work actually done |
| SPI | Schedule Performance Index | EV / PV | >1 good, <1 bad |
| SV | Schedule Variance | EV − PV | positive good, negative bad |

A resource-loaded activity (budget = Σ resource assignment costs) with a baseline
start/finish is exactly the input a real PV curve needs — this module is what
finally makes that possible, not a separate concern.

## C. Decisions confirmed by Maro (2026-07-02)

1. **Cost Plan integration: full, not a loose cross-link.** Resource assignments
   are the source of truth for an activity's budget; Cost Plan gets a real
   time-phased PV curve out of it, not just a visual link.
2. **Resource calendars: reuse activity calendars.** No separate resource-calendar
   concept — a resource just runs on whichever calendar(s) its assigned
   activities already use.
3. **Resource types, all four:** Labour, Equipment/Plant, Material, Subcontractor
   (lump sum) — matching the prototype's own example rows exactly.
4. **Sync direction and the "unlink" pattern**, per Maro's explicit correction —
   *"there are estimators who don't link the schedule and have it independently...
   use schedule if resource/cost data exists, once it exists, if the user wants to
   manually override, a warning should prompt them that they are effectively
   unlinking that line."* This is the standard P6-style behaviour, not a loose
   two-way sync:
   - An activity's resource assignments auto-create/maintain a linked
     `CostElement` (`source = "schedule"`) — its `budget` and `CostRateLine`
     breakdown are kept in sync automatically whenever assignments change.
   - Editing that element's **budget** or its **rate lines** directly in Cost
     Plan is still allowed, but the frontend confirms first ("this will unlink
     it from Scheduling — resource changes won't update it automatically
     anymore"), and the backend flips `source` to `"manual"` the moment such an
     edit lands, permanently detaching it (no accidental silent re-sync
     clobbering a deliberate override later). Metadata-only edits (status, cost
     owner, commentary, sign-off) don't unlink — only budget/rate-line edits do,
     since those are what the resource sync actually owns.
   - This is a **one-way** sync (Scheduling → Cost Plan) by construction — there
     is no path for a Cost Plan edit to flow back into `ResourceAssignment` rows,
     avoiding the sync-loop problem a two-way link would create.

## D. Data model

**`Resource`** (project-scoped, a reusable pool entry — "Piling Contractor",
"J. Davies", "360° Excavator"):
- `resource_type`: `labour | equipment | material | subcontractor`
- `name`, `unit` (e.g. "hour", "day", "each", "lump sum"), `rate` (Decimal)
- No calendar field — resolves through whichever activity it's assigned to
  (decision B.2).

**`ResourceAssignment`** (the join between an `Activity` and a `Resource`):
- `activity_id`, `resource_id`, `role` (free text, matching the prototype's
  "Role" column — e.g. "Site Engineer" — independent of the resource's own name),
  `quantity` (Decimal)
- `budget` is **never stored** — always `quantity × resource.rate`, computed at
  read time, same "never store what you can derive" discipline as everywhere
  else in this codebase. Subcontractor lump sums are just `quantity = 1`,
  `resource.rate = the lump sum`, `resource.unit = "lump sum"` — no separate
  override field needed.

**`CostElement`** gains:
- `source`: `manual | schedule` (default `manual` — existing elements are
  unaffected)
- `linked_activity_id`: nullable FK to `activities`, unique — one auto-managed
  cost element per resourced activity, created on the first assignment.

## E. Planned Value / SPI

**Corrected post-Session-16, per Maro's confirmed P6 domain expertise:** PV is
prorated against the activity's own **live** `start`/`finish` (CPM-computed,
always available once scheduled), **not** `bl_start`/`bl_finish`. "Set Baseline"
drives schedule variance (`variance_days`/Fin. Var (d) — current Finish vs
baseline Finish) — a separate concern from Planned Value. Gating PV on a
captured baseline was the original (wrong) implementation; P6 itself doesn't
require a saved baseline for BCWS, only that the schedule is cost-loaded, since
PV asks "how far along its own current duration should this activity be by the
data date" — a live-schedule question, not a frozen-plan one.

For each CPM-participant activity with a budget and a live `start`/`finish`, the
fraction of `[start, finish]` elapsed by the data date (0 before `start`, 1
at/after `finish`, linear between) × that activity's budget gives PV. `EV =
budget × pct_complete` (physical % complete, distinct from this duration-elapsed
"Activity % Complete"). `SPI = EV / PV`, `SV = EV − PV` — reinstated in Cost
Plan's summary once this exists, replacing the "removed, was a fake number"
state from Session 11. See `app/services/cost_element.py:_schedule_evm`.

Weighted-milestone or other more sophisticated PV distribution techniques exist,
but linear-over-duration is the standard simple technique and is what's
implemented here — flagged the same way DCMA's 2x warn-band was: a reasonable,
documented interpretation, not a rigorously-derived one.

## F. Explicitly deferred

- **Resource loading histogram** (the prototype's weekly-bucket SVG chart,
  peak-capacity line). Real value, genuinely separate visualisation work — built
  after the core assignment/sync/PV pieces land, not blocking them.
- **DCMA #14 (Resources Loaded %)** — stays deferred alongside #13, per the
  existing Scheduling plan (needs longitudinal data to mean anything).
- **Resource-specific calendars** — explicitly ruled out per decision B.2.

## G. Phased implementation

1. `Resource` + `ResourceAssignment` models/schemas/service/API/tests (backend
   only — a resource pool CRUD and per-activity assignment CRUD, no Cost Plan
   sync yet).
2. Cost Plan sync: `CostElement.source`/`linked_activity_id`, the sync service
   (create/update/delete the linked element + rate lines on assignment changes),
   the unlink-on-direct-edit behaviour.
3. Planned Value / EV / SPI: a period-level computation service, wired into Cost
   Plan's existing summary panel.
4. Frontend: a Resources tab on the activity detail panel (matching the
   prototype), a project-level Resource Pool management screen (Resources need
   to exist before they can be assigned to anything), Cost Plan's cost element
   form gaining the "schedule-linked" banner + unlink confirmation.

Each phase gets the same discipline as every other phase this project has run:
full backend test suite + `tsc --noEmit` after every step, verified before moving
on.

**Status:** Complete (2026-07-02) — all four phases built and tested same day as
the plan was drafted. `Resource`/`ResourceAssignment` CRUD, the one-way Cost Plan
sync with unlink-on-direct-edit, real PV/EV/SV/SPI (Cost Plan's summary panel now
shows Schedule Performance, closing out what was flagged as blocked back in
Session 11), and the frontend (Resource Pool widget, per-activity Resources panel,
Cost Plan's schedule-linked banner + unlink confirmations). 276 backend tests
passing (was 250 before this module — Show/Hide Columns and the hour-level CPM
rearchitecture landed the same session, ahead of this). `tsc --noEmit` and the
production build both clean. Migrations `079fa3ffcd40` and `6369d28b1505`, both
verified reversible. Not yet clicked through by Maro in the browser.

Deliberately deferred, unchanged from section F: the resource-loading histogram
and DCMA #14.
