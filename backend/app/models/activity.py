from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Activity(Base, TimestampMixin):
    __tablename__ = "activities"
    # Scoped per schedule variant, not per project (2026-07-07, per Maro —
    # docs/SCHEDULE_VARIANTS_PLAN.md §D.6) — deliberately allows two schedule
    # variants in the same project to each have their own "T-0042," which is
    # exactly what forking a variant needs to preserve (an activity's code is
    # what makes it recognisably "the same activity, more mature" across a
    # Working Schedule and a Recovery Schedule forked from it).
    __table_args__ = (UniqueConstraint("schedule_variant_id", "code", name="uq_activities_schedule_variant_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    # P (top-level WBS summary) | W (nested WBS summary) | T (task) | M (milestone)
    # | SP (a nested WBS tagged as a sub-project's root, 2026-07-06 — see
    # docs/SUBPROJECT_FLOAT_PLAN.md §E) — the structural role `code`'s prefix is
    # meant to reflect, tracked independently of the code string itself
    # (2026-07-04, per Maro's P/W/T/M scheme). Kept as its own column rather than
    # parsed from `code` on every check, because `code` is also manually editable
    # (inline editing) — a user renaming T-0001 to something of their own choosing
    # must not be mistaken for a real hierarchy-driven role change the next time
    # app/services/activity.py:_recompute_hierarchy runs. Never accepted as API
    # input; auto-maintained by _recompute_hierarchy alongside activity_type.
    wbs_role: Mapped[str] = mapped_column(String(2), nullable=False, default="T")
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Which schedule this activity belongs to (2026-07-07, per Maro —
    # docs/SCHEDULE_VARIANTS_PLAN.md). Denormalised alongside schedule_period_id
    # (rather than derived via a join every time) specifically so the code-
    # uniqueness constraint above can be a real DB constraint.
    schedule_variant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_variants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Was `period_id` (FK to the shared `periods` table Risk/Cost/ICD still use)
    # until the schedule-variants split — see SchedulePeriod's own docstring for
    # why this needed to become a genuinely separate table, not just a renamed
    # column pointing at the same one.
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_name: Mapped[str] = mapped_column(String(500), nullable=False)
    # task | milestone | wbs_summary. Milestones always have zero duration; wbs_summary
    # is never accepted as API input directly — it's auto-assigned/removed by
    # app/services/activity.py:_recompute_hierarchy whenever an activity gains or loses
    # children (MS Project style: any row becomes a summary as soon as something is
    # indented under it). See docs/SCHEDULING_MODULE_PLAN.md Phase 2.
    activity_type: Mapped[str] = mapped_column(String(20), nullable=False, default="task")
    # Self-referencing outline hierarchy — no separate WBS-dictionary entity (P6 style);
    # the activity list *is* the WBS (MS Project style, per Maro 2026-07-02). Cascades on
    # delete: removing a summary task removes its subtree, matching MS Project behaviour.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), index=True
    )
    # Sibling order within a parent — entirely server-managed (see _recompute_hierarchy),
    # never accepted as API input, same discipline as wbs_path below.
    sort_order: Mapped[int | None] = mapped_column(Integer)
    # Computed from parent_id + sort_order outline position ("1", "1.1", "1.2", "2"...)
    # — never accepted as API input from Phase 2 onward.
    wbs_path: Mapped[str | None] = mapped_column(String(500))
    # Phase 10 (hour-level CPM): duration_hours is now the primary input. duration_days
    # is the OLD field name repurposed as a computed, display-only value (duration_hours
    # / the activity's resolved calendar's net hours/day) — refreshed by
    # scheduling_cpm.recompute_schedule alongside start/finish, never accepted as API
    # input, same as those. Numeric now (was Integer) since it can be fractional.
    duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    duration_days: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # start/finish are computed by app/services/scheduling_cpm.py's forward/backward
    # pass (duration + logic + calendar + constraints), never accepted as API input
    # from Phase 5 onward — see docs/SCHEDULING_MODULE_PLAN.md. wbs_summary rows are
    # the exception: theirs stay rollups from children (_recompute_hierarchy).
    # DateTime since Phase 10 — hour-of-day now genuinely matters (a task can start
    # mid-morning and finish mid-afternoon), not just the calendar date.
    start: Mapped[datetime | None] = mapped_column(DateTime)
    finish: Mapped[datetime | None] = mapped_column(DateTime)
    actual_start: Mapped[datetime | None] = mapped_column(DateTime)
    actual_finish: Mapped[datetime | None] = mapped_column(DateTime)
    # P6's suspend/resume actuals (docs/SCHEDULING_GAPS_PLAN.md Phase 11) —
    # distinct from actual_start/actual_finish: an activity can start, get
    # suspended mid-flight, then resume later, and the gap between suspend
    # and resume isn't worked time. Plain user-entered facts for this first
    # cut — no CPM interaction (see app/services/activity.py:_validate_suspend_resume).
    suspend_date: Mapped[datetime | None] = mapped_column(DateTime)
    resume_date: Mapped[datetime | None] = mapped_column(DateTime)
    # planned | in_progress | suspended | completed (2026-09-03, per Maro:
    # "it needs a column on its own") — same plain-String(20) pattern as
    # activity_type above, not a Postgres-native enum, validated at the
    # Pydantic schema layer (ActivityStatus, app/schemas/activity.py). A
    # real, independently-stored fact, not re-derived from pct_complete/
    # suspend_date/actual_start on every read — setting it is what drives
    # those fields (app/services/activity.py:_apply_status_change), not the
    # other way around. A WBS/Project summary row's own status is a rollup
    # from its children (_recompute_hierarchy), same as its pct_complete.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planned")
    remaining_duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # bl_start/bl_finish/bl_duration_hours/variance_days/total_float_hours/
    # free_float_hours/is_critical are never accepted as API input (see
    # app/services/activity.py:_apply_computed_fields and
    # app/services/scheduling_cpm.py) — same discipline as Risk's EMV and Cost's
    # CPI/SPI fixes. bl_start/bl_finish/bl_duration_hours are set only by the "Set
    # Baseline" action (app/services/scheduling_baseline.py) — snapshotting current
    # start/finish/duration_hours, same "assign a Baseline" discipline Cost Plan's
    # own bl_budget now uses too (app/models/cost_element.py) — a deliberate,
    # repeatable capture (client-agreed revisions), not a value fixed forever at row creation.
    # total_float_hours/free_float_hours/is_critical are null for wbs_summary rows
    # (outside the CPM network).
    bl_start: Mapped[datetime | None] = mapped_column(DateTime)
    bl_finish: Mapped[datetime | None] = mapped_column(DateTime)
    bl_duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # Whole-day wall-clock slip (finish vs bl_finish) — deliberately stays a simple
    # calendar-day count even post-Phase-10, since that's the unit planners actually
    # report variance in; duration/float (below) are the fields that needed hour
    # precision, not this summary figure.
    variance_days: Mapped[int | None] = mapped_column(Integer)
    pct_complete: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Renamed from total_float/free_float (Integer, whole working days) — Phase 10
    # makes float a genuinely fractional, hour-precision quantity (e.g. "4.5 hours of
    # float", not just whole days), so the rename makes the unit change impossible to
    # miss in code that reads these fields.
    total_float_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    free_float_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    is_critical: Mapped[bool | None] = mapped_column(Boolean)
    commentary: Mapped[str | None] = mapped_column(Text)
    # asap | snet (Start On or After) | ms (Mandatory Start) | fnlt (Finish On or Before).
    # constraint_date is required for every type except asap — see app/schemas/activity.py.
    # Per PMBOK7/Rita Mulcahy Ch. 8: soft constraints (snet/fnlt) can still be pushed by
    # the network; ms is hard and can produce negative float if infeasible. DateTime since
    # Phase 10 — a Mandatory Start can now pin an exact hour, not just a date.
    constraint_type: Mapped[str | None] = mapped_column(String(10))
    constraint_date: Mapped[datetime | None] = mapped_column(DateTime)
    # Null = inherit the project's default calendar (app/services/calendar.py). SET NULL
    # on delete: removing a custom calendar reverts any activities using it back to the
    # project default rather than blocking the delete or leaving a dangling reference.
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="SET NULL"), index=True
    )
    # 4D animation profile for this activity (2026-07-22, per Maro: "allow me
    # set animation profile per activity not just per element, this will
    # allow for bulk profile setting"). Null = every element linked to this
    # activity animates with the default opacity-only profile, same as
    # ModelElementLink.animation_profile_id's own null case — Viewport3D.tsx's
    # own resolve() reads this as the fallback whenever a specific link has
    # no override of its own, so setting this once here is what "influences
    # the behaviour of all elements assigned to it" without needing to touch
    # every individual link row. SET NULL on delete: removing a custom
    # profile reverts every activity using it back to the default, same
    # "never a hard block" convention calendar_id already has just above.
    animation_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("animation_profiles.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Matches Risk/ICD/Cost's field of the same name — manually settable, and
    # auto-bumped whenever a reassessment is logged against this activity
    # (app/services/reassessment.py). Stays a plain Date — "last reviewed" only ever
    # needed day granularity, unlike the CPM-facing fields above.
    last_reviewed_date: Mapped[date | None] = mapped_column(Date)
    # Archive system (2026-07-04, per Maro): archiving actualises an activity
    # (pct_complete forced to 100, all its relationships stripped) and reparents it
    # under the period's reserved Archived container instead of hard-deleting it —
    # preserves the row (and its baseline history) for audit/assurance rather than
    # losing it. is_archived is never accepted as API input directly; only
    # app/services/activity.py:archive_activity sets it. Deleting an activity that
    # appears in any saved baseline snapshot now archives it instead — real deletion
    # would otherwise sever the very audit trail baselines exist to provide.
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Marks the one reserved "Archived" WBS container per period that archived
    # activities get reparented under (see app/services/activity.py:
    # _get_or_create_archive_container) — excluded from normal WBS numbering,
    # promote/demote logic, and can't itself be deleted, archived, or used as an
    # indent/outdent target.
    is_archive_container: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Sub-project float (2026-07-05, per Maro — docs/SUBPROJECT_FLOAT_PLAN.md in
    # the private docs repo). owning_party_org_id is PM-assigned only, purely
    # informational, no cascading from a schedule_subproject's own
    # owning_party_org_id (deliberately deferred — see the plan doc's §G).
    # sub_total_float_hours/sub_is_critical mirror total_float_hours/is_critical's
    # own shape exactly (same precision, same threshold convention) but come from
    # a second, additional CPM pass scoped to whichever tagged ScheduleSubproject
    # branch this activity's nearest tagged ancestor belongs to (see
    # app/services/scheduling_cpm.py) — null for any activity outside every
    # tagged branch, same as the master fields are null for wbs_summary rows.
    owning_party_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="SET NULL"), index=True
    )
    sub_total_float_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    sub_is_critical: Mapped[bool | None] = mapped_column(Boolean)
    # Set once, at IFC schedule generation, never editable afterward (2026-07-17,
    # per Maro's phased-generation plan) — which ScheduleCategory/CategoryPhase
    # (frontend's own ifcScheduleExtraction.ts/scheduleGeneration.ts) this
    # activity was generated as, e.g. category="Columns", phase_key="erect".
    # Schedule generation itself no longer creates Resource/ResourceAssignment
    # rows (see schedule_bulk_generate.py's own docstring) — these two columns
    # are what a LATER, separate "Generate Resources"/"Auto Assign Resources"
    # pass (Resources tab) reads to reconstruct which activities need which
    # crew/equipment without re-scanning the IFC file or parsing task_name
    # (both fragile — task_name is freely user-editable after generation).
    # Null for every activity created any other way (manual entry, P6 import,
    # a pre-2026-07-17 generation) — those simply aren't eligible for the
    # resource-generation pass, same "opt-in, not retrofitted" contract
    # ModelElementLink's own element_ref already has for IFC linkage.
    schedule_category: Mapped[str | None] = mapped_column(String(100))
    schedule_phase_key: Mapped[str | None] = mapped_column(String(100))
    # The real IFC-measured quantity this activity's own duration_hours was
    # computed FROM (2026-07-18, per Maro's own QA: isolating L2's beams in
    # the 4D viewer showed 193 real IfcBeam elements, but the BOQ line for
    # that same task showed 200 — because until this column existed, nothing
    # persisted the true count at all; duration_hours (computeDurationHours,
    # scheduleGeneration.ts) is Math.ceil(quantity / productivityPerCrewDay)
    # days, and BOQ generation had to reverse THAT lossy rounding instead of
    # reading the real number — recovering "whole days x rate" (200), not
    # the true 193 that produced those days in the first place). Same units
    # as CategoryRate.unit for this activity's own category/phase ('each' for
    # a discrete count, 'm²' for an area) — see boqGeneration.ts, the only
    # reader. Null for every activity created any other way (manual entry, P6
    # import, a pre-2026-07-18 generation) — same "opt-in, not retrofitted"
    # contract schedule_category/schedule_phase_key already have; those
    # older/other activities still fall back to boqGeneration.ts's own
    # reverse-engineered estimate.
    schedule_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    # Real material take-off for this one activity (2026-07-27, per Maro:
    # "how is concrete and steel catered for if they exist" — every
    # structural category's own resources were crew/equipment only, no
    # material line at all, so concrete/steel never showed up as a cost or a
    # resource anywhere). Same "opt-in, not retrofitted" contract as
    # schedule_category/schedule_quantity just above — null for every
    # activity created any other way. schedule_material_quantity is a REAL
    # measured quantity (frontend's own getExpressIdWorldVolume, not a
    # bounding-box guess) — m³ as-is for concrete, converted through a real
    # steel-density constant for a 'tonne' material (steel/rebar) —
    # scheduleGeneration.ts's own CategoryRate.materialName header has the
    # full "why". All four null together, never partially set; read by the
    # same later "Generate Resources"/"Auto Assign Resources" pass
    # schedule_category/schedule_phase_key already exist for, to emit a
    # resource_type='material' resource + a quantity-costed assignment
    # (app/services/resource_assignment.py already supports this — "material:
    # quantity — the original Qty x Rate build-up" — this is simply the
    # first writer of it from an automatic IFC generation).
    schedule_material_name: Mapped[str | None] = mapped_column(String(200))
    schedule_material_quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    schedule_material_unit: Mapped[str | None] = mapped_column(String(20))
    schedule_material_cost_per_unit: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
