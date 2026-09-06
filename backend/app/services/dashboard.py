from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.baseline_set import BaselineSet
from app.models.cost_baseline import CostBaseline, CostBaselineItem
from app.models.cost_element import CostElement
from app.models.icd_baseline import IcdBaseline, IcdBaselineItem
from app.models.icd_item import IcdItem
from app.models.period import Period
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.risk import Risk
from app.models.risk_baseline import RiskBaseline, RiskBaselineItem
from app.models.risk_mitigation_action import RiskMitigationAction
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.user_defined_field import UserDefinedFieldDefinition, UserDefinedFieldValue
from app.schemas.dashboard import (
    BaselineComparisonResponse,
    ClashByTest,
    ClashPairSummary,
    ClashSummary,
    CostComparison,
    CostComparisonItem,
    CostComparisonSummary,
    CostElementSummary,
    CostPerformanceTrendPoint,
    CostPerformanceTrendResponse,
    DashboardKpis,
    DashboardOverviewResponse,
    DcmaQualitySummary,
    IcdComparison,
    IcdComparisonItem,
    IcdComparisonSummary,
    IcdComparisonTypeCounts,
    IcdItemSummary,
    IcdOpenItemsTrendPoint,
    IcdOpenItemsTrendResponse,
    LookaheadItem,
    LookaheadSummary,
    MilestoneTimelineItem,
    ProjectInfoSummary,
    PvEvAcTrendPoint,
    PvEvAcTrendResponse,
    RiskComparison,
    RiskComparisonItem,
    RiskComparisonSummary,
    RiskEmvTrendPoint,
    RiskEmvTrendResponse,
    RiskMitigationActionSummary,
    ResourceAssignmentSummary,
    RiskExposureBand,
    RiskOverview,
    RiskSummary,
    ScheduleActivitySummary,
    ScheduleBuckets,
    ScheduleComparison,
    ScheduleComparisonItem,
    ScheduleComparisonSummary,
    SpiTrendPoint,
    SpiTrendResponse,
    TopRisk,
)
from app.services import clash_test as clash_test_svc
from app.services import scheduling_quality as quality_svc
from app.services.activity import _subtree_ids
from app.services.cost_element import _schedule_evm, list_cost_elements, rollup_evm_from_totals
from app.services.resource_costing import compute_assignment_budget
from app.services.scheduling_cpm import _build_calendar_lookup

_MONEY = Decimal("0.01")


def _resolve_bac_ac(el) -> tuple[Decimal | None, Decimal | None]:
    """AC resolution _apply_computed (app/services/cost_element.py) already
    does per element — computed_actuals for a percentage element, actuals
    for a fixed one. BAC is simply el.bac (2026-09-03, per Maro's domain
    correction: bl_budget-with-live-fallback, already fully resolved server-
    side, cascaded for percentage elements too) — pulled out here so both
    the live KPI rollup and the baseline comparison's "current" side read it
    identically."""
    ac = el.computed_actuals if el.element_type == "percentage" else el.actuals
    return el.bac, ac


async def _live_schedule_spi(db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID) -> tuple[Decimal | None, list]:
    """PV/EV-based SPI (schedule-linked cost elements only, see
    cost_element._apply_computed's own docstring) evaluated right now —
    pulled out of _kpis so the baseline comparison's "current" side reads
    through the exact same formula rather than a second, independently-
    derived one. Also returns the live elements list, since _kpis' own
    BAC/EAC/CPI rollup needs them anyway and this avoids a second
    list_cost_elements round-trip."""
    elements = await list_cost_elements(db, project_id, period_id)
    pv_total = sum((el.pv for el in elements if el.pv is not None), Decimal(0))
    ev_total = sum((el.ev for el in elements if el.ev is not None), Decimal(0))
    has_schedule_evm = any(el.pv is not None for el in elements)
    spi = rollup_evm_from_totals(None, None, pv_total, ev_total)["spi"] if has_schedule_evm else None
    return spi, elements


async def _kpis(
    db: AsyncSession, project_id: uuid.UUID, period_id: uuid.UUID,
    schedule_activities: list[Activity], icd_items: list[IcdItem],
) -> tuple[DashboardKpis, list]:
    # The whole network's own latest finish — not restricted to a top-level
    # "P" WBS summary, since a schedule with more than one root branch (no
    # single enclosing "Programme" row) would otherwise never have one and
    # this KPI would always read blank. A "P" row's own finish is already a
    # rollup equal to this same max anyway, so reading every leaf directly
    # gives the identical answer and works regardless of hierarchy shape.
    planned_finish = max((a.finish for a in schedule_activities if a.finish is not None), default=None)
    plan_start = min((a.start for a in schedule_activities if a.start is not None), default=None)
    planned_finish_status = "unknown"
    if planned_finish is not None:
        bl_finishes = [a.bl_finish for a in schedule_activities if a.bl_finish is not None]
        if bl_finishes:
            planned_finish_status = "delayed" if planned_finish > max(bl_finishes) else "on_time"

    open_issues = len([i for i in icd_items if i.item_type == "issue" and i.status != "closed"])
    open_changes = len([i for i in icd_items if i.item_type == "change" and i.status != "closed"])

    schedule_spi, elements = await _live_schedule_spi(db, project_id, period_id)

    # Portfolio BAC/EAC/CPI — every element contributes (not just schedule-linked
    # ones), unlike SPI above. BAC/AC read el.bac (bl_budget-with-live-fallback)
    # and computed_actuals/actuals, the same resolution _resolve_bac_ac above
    # already applies; EV = BAC x pct_complete/100, same formula that file's own
    # docstring documents (never a second, independently-invented one). Summed
    # first, then run through the one shared rollup — never averaging per-element
    # CPIs directly (see rollup_evm_from_totals's own docstring on why that
    # misrepresents which line actually drives the portfolio's real performance).
    bac_total = ac_total = ev_cost_total = Decimal(0)
    has_cost_evm = False
    per_element_bac_ev: list[tuple[uuid.UUID | None, Decimal, Decimal | None]] = []
    for el in elements:
        bac, ac = _resolve_bac_ac(el)
        if bac is None:
            continue
        has_cost_evm = True
        bac_total += bac
        if ac is not None:
            ac_total += ac
        ev_el = bac * Decimal(el.pct_complete) / Decimal(100) if el.pct_complete is not None else None
        if ev_el is not None:
            ev_cost_total += ev_el
        per_element_bac_ev.append((el.linked_activity_id, bac, ev_el))
    cost_rollup = rollup_evm_from_totals(bac_total, ac_total, None, ev_cost_total) if has_cost_evm else {}

    # Two more PMBOK EAC formulas (Batch 6) alongside cost_rollup["eac"]
    # (BAC/CPI) above — "remaining work at the original plan rate" and the
    # SPI x CPI composite, the same three classic methods
    # WIDGET_LIBRARY_PLAN.md §E.1's EAC Forecast Comparison gap calls for —
    # matching 3 of the 4 named "PF" techniques in P6's own Admin
    # Preferences > Earned Value > "Technique for computing ETC" screen
    # (PF=1, PF=1/CPI, PF=1/(CPI*SPI)). A user-chosen custom PF is
    # deliberately not modelled — an interactive what-if input, not a
    # derived figure a read-only dashboard tile can show.
    eac_remaining_at_plan = (ac_total + (bac_total - ev_cost_total)).quantize(_MONEY) if has_cost_evm else None
    cpi = cost_rollup.get("cpi")
    eac_composite = None
    if has_cost_evm and schedule_spi is not None and cpi is not None and schedule_spi != 0 and cpi != 0:
        # Full-precision CPI/SPI here, not the already-4dp-rounded `cpi`/
        # `schedule_spi` display values above — dividing by their product
        # would compound two premature roundings into eac_composite, the
        # same class of error just fixed in cost_element._cost_side_evm
        # (verified 2026-09-06 against Juniper's real EAC/ETC export).
        pv_total_sched = sum((el.pv for el in elements if el.pv is not None), Decimal(0))
        ev_total_sched = sum((el.ev for el in elements if el.ev is not None), Decimal(0))
        if pv_total_sched != 0 and ac_total != 0:
            cpi_spi_raw = (ev_cost_total / ac_total) * (ev_total_sched / pv_total_sched)
            eac_composite = (ac_total + (bac_total - ev_cost_total) / cpi_spi_raw).quantize(_MONEY)

    # The 4th named P6 technique — "ETC = remaining cost for activity" — a
    # genuine bottom-up re-estimate, not a ratio of BAC/EV/AC/CPI/SPI at
    # all, so it needs its own real, independent input: each schedule-
    # linked element's own Activity.remaining_duration_hours (imported
    # verbatim from P6's own <RemainingDuration>, itself P6's own
    # resource-loaded remaining-work re-estimate — never a Prosota-derived
    # figure), scaled against that activity's own baseline-preferred total
    # duration (same "baseline wins when captured" rule as PV/schedule_pct_
    # complete — see _attach_evm_fields's own header) to convert hours
    # remaining into cost remaining, on the assumption the activity's own
    # cost accrues evenly across its duration (true for labour/equipment,
    # Prosota's own resource-costing rule — see ResourceAssignment's own
    # docstring). A manual (non-schedule-linked) element, or a schedule-
    # linked one P6 never reported a RemainingDuration for, has no
    # independent re-estimate available at all — falls back to "remaining
    # at plan rate" (BAC-EV) for just that element, the same best-available
    # substitute PF=1 already uses, rather than leaving the whole portfolio
    # figure null over one element with no bottom-up data.
    remaining_total = Decimal(0)
    if per_element_bac_ev:
        linked_ids = {aid for aid, _, _ in per_element_bac_ev if aid is not None}
        remaining_by_activity: dict[uuid.UUID, tuple[Decimal | None, Decimal | None]] = {}
        if linked_ids:
            rows = (await db.execute(
                select(Activity.id, Activity.remaining_duration_hours, Activity.duration_hours, Activity.bl_duration_hours)
                .where(Activity.id.in_(linked_ids))
            )).all()
            remaining_by_activity = {
                row.id: (row.remaining_duration_hours, row.bl_duration_hours or row.duration_hours) for row in rows
            }
        for aid, bac_i, ev_i in per_element_bac_ev:
            remaining_hours, total_hours = remaining_by_activity.get(aid, (None, None))
            if remaining_hours is not None and total_hours:
                remaining_total += bac_i * (remaining_hours / total_hours)
            else:
                remaining_total += bac_i - (ev_i if ev_i is not None else Decimal(0))
    eac_bottom_up = (ac_total + remaining_total).quantize(_MONEY) if has_cost_evm else None

    return DashboardKpis(
        plan_start=plan_start,
        planned_finish=planned_finish,
        planned_finish_status=planned_finish_status,
        open_issues=open_issues,
        open_changes=open_changes,
        schedule_spi=schedule_spi,
        bac=bac_total.quantize(_MONEY) if has_cost_evm else None,
        eac=cost_rollup.get("eac"),
        cpi=cpi,
        eac_remaining_at_plan=eac_remaining_at_plan,
        eac_composite=eac_composite,
        eac_bottom_up=eac_bottom_up,
    ), elements


def _schedule_buckets(activities: list[Activity]) -> ScheduleBuckets:
    on_time = at_risk = delayed = 0
    for a in activities:
        if a.variance_days is not None and a.variance_days > 0:
            delayed += 1
        elif a.is_critical is True:
            at_risk += 1
        else:
            on_time += 1
    total = on_time + at_risk + delayed
    return ScheduleBuckets(on_time=on_time, at_risk=at_risk, delayed=delayed, total=total)


def _milestones(activities: list[Activity]) -> list[MilestoneTimelineItem]:
    items = [
        MilestoneTimelineItem(
            id=a.id, task_name=a.task_name, finish=a.finish, bl_finish=a.bl_finish,
            is_critical=a.is_critical, variance_days=a.variance_days,
        )
        for a in activities
        if a.activity_type in ("start_milestone", "finish_milestone")
    ]
    items.sort(key=lambda m: m.finish or datetime.max)
    return items


# UDF values by record, keyed by the definition's own real NAME (2026-09-02,
# per Maro: "in the 4d, baseline comparison. there's a filter for discipline.
# also the radial chart?....there's precedent" — Radial Chart/Timeline Strip
# already scope by a UDF value (scheduleScope.ts's own udf_field_definition_id
# + udf_value, resolved via stringifyUdfValue there); this reuses the exact
# same real UserDefinedFieldValue data for dashboard widget filtering instead
# of treating UDFs as an unreachable gap. Keyed by name, not the definition's
# own UUID, since a filter condition's field should read "udf.Discipline",
# something a human/Poe can actually type, never a UUID they'd have to look
# up first. Stringifies whichever of the four value_* columns is actually
# populated — same "generic across data_type" reasoning stringifyUdfValue
# (frontend) already established, just the backend's own copy of it, since
# this dict is serialized straight into the dashboard response, not consumed
# by more Python after this.
async def _udf_values_by_record(db: AsyncSession, project_id: uuid.UUID, entity_type: str) -> dict[uuid.UUID, dict[str, str]]:
    rows = (await db.execute(
        select(UserDefinedFieldValue.record_id, UserDefinedFieldDefinition.name, UserDefinedFieldValue.value_text,
               UserDefinedFieldValue.value_number, UserDefinedFieldValue.value_date, UserDefinedFieldValue.value_indicator)
        .join(UserDefinedFieldDefinition, UserDefinedFieldValue.field_definition_id == UserDefinedFieldDefinition.id)
        .where(UserDefinedFieldDefinition.project_id == project_id, UserDefinedFieldDefinition.entity_type == entity_type)
    )).all()
    result: dict[uuid.UUID, dict[str, str]] = {}
    for record_id, name, value_text, value_number, value_date, value_indicator in rows:
        stringified = value_text or (str(value_number) if value_number is not None else None) or \
            (value_date.isoformat() if value_date is not None else None) or value_indicator
        if stringified is None:
            continue
        result.setdefault(record_id, {})[name] = stringified
    return result


def _cost_element_summaries(elements: list, udf_by_record: dict[uuid.UUID, dict[str, str]] | None = None) -> list[CostElementSummary]:
    udf_by_record = udf_by_record or {}
    summaries = []
    for el in elements:
        bac, ac = _resolve_bac_ac(el)
        summaries.append(CostElementSummary(
            id=el.id, code=el.code, description=el.description, element_group=el.element_group,
            cost_owner=el.cost_owner, status=el.status, bac=bac, ac=ac, pct_complete=el.pct_complete,
            cpi=el.cpi, eac=el.eac, vac=el.vac, udf=udf_by_record.get(el.id, {}),
        ))
    return summaries


async def _dcma_quality_summary(
    db: AsyncSession, schedule_period_id: uuid.UUID,
    all_activities: list[Activity], relationships: list[ActivityRelationship],
) -> DcmaQualitySummary:
    # all_activities/relationships (2026-07-20, optimization pass) — reuses
    # get_overview's own already-fetched whole-schedule data instead of
    # compute_quality independently re-running both full-table queries on
    # every single dashboard load (see that function's own docstring on why
    # this is a safe substitution).
    #
    # Always whole-schedule (2026-08-28) — get_overview's own WBS-node scope
    # slicer (Maro: "allow slicers for wbs which affects all the cards")
    # deliberately doesn't reach this: compute_quality's sub-project scoping
    # switches checks 6/7/12 to read sub_is_critical/sub_total_float_hours,
    # fields only meaningful for a *registered* ScheduleSubproject's own
    # dedicated isolated-CPM pass — not something derivable on the fly for
    # an arbitrary WBS node picked from a dropdown. Reproducing that
    # isolated pass ad hoc would be real new engineering, not a slicer wire-
    # up, so DCMA Quality stays whole-schedule regardless of the slicer's
    # current selection.
    report = await quality_svc.compute_quality(
        db, schedule_period_id, None,
        pre_fetched_activities=all_activities, pre_fetched_relationships=relationships,
    )
    checks = report["checks"]
    return DcmaQualitySummary(
        activity_count=report["activity_count"],
        logic_score=report["logic_score"],
        total_checks=len(checks),
        passing_count=sum(1 for c in checks if c["status"] == "pass"),
        failing_count=sum(1 for c in checks if c["status"] == "fail"),
        warning_count=sum(1 for c in checks if c["status"] == "warn"),
        scope_name=report.get("scope_name"),
    )


async def _clash_summary_and_pairs(db: AsyncSession, project_id: uuid.UUID) -> tuple[ClashSummary, list[ClashPairSummary]]:
    tests = await clash_test_svc.list_clash_tests(db, project_id)
    all_results = [r for t in tests for r in t.results]
    by_test = [
        ClashByTest(
            test_id=t.id, test_name=t.name, test_type=t.test_type, total=len(t.results),
            new_count=sum(1 for r in t.results if r.status == "new"),
            reviewed_count=sum(1 for r in t.results if r.status == "reviewed"),
            approved_count=sum(1 for r in t.results if r.status == "approved"),
        )
        for t in tests
    ]
    summary = ClashSummary(
        test_count=len(tests),
        total_clashes=len(all_results),
        new_count=sum(1 for r in all_results if r.status == "new"),
        reviewed_count=sum(1 for r in all_results if r.status == "reviewed"),
        approved_count=sum(1 for r in all_results if r.status == "approved"),
        by_test=by_test,
    )
    pairs = [
        ClashPairSummary(
            id=r.id, test_id=t.id, test_name=t.name,
            element_a_label=r.element_a_label, element_b_label=r.element_b_label,
            distance_mm=r.distance_mm, status=r.status,
        )
        for t in tests for r in t.results
    ]
    return summary, pairs


async def _project_info(
    db: AsyncSession, project_id: uuid.UUID, schedule_period_id: uuid.UUID, all_activities: list[Activity],
) -> tuple[ProjectInfoSummary, SchedulePeriod | None, list[ActivityRelationship]]:
    period = await db.get(SchedulePeriod, schedule_period_id)
    activity_ids = [a.id for a in all_activities]
    relationships = (await db.execute(
        select(ActivityRelationship).where(ActivityRelationship.predecessor_id.in_(activity_ids))
    )).scalars().all() if activity_ids else []
    resources = (await db.execute(select(Resource).where(Resource.project_id == project_id))).scalars().all()
    info = ProjectInfoSummary(
        data_date=period.cutoff_date if period is not None else None,
        total_activities=len(all_activities),
        total_relationships=len(relationships),
        total_resources=len(resources),
        has_baseline=any(a.bl_finish is not None for a in all_activities),
    )
    return info, period, list(relationships)


async def _resource_assignment_summaries(
    db: AsyncSession, schedule_period_id: uuid.UUID, udf_by_record: dict[uuid.UUID, dict[str, str]] | None = None,
) -> list[ResourceAssignmentSummary]:
    """Same join/denormalize shape as resource_assignment.py's own
    list_assignments_for_period/_attach_resource_fields, reimplemented
    directly here (rather than importing those) because this needs
    discipline/company alongside the fields that helper already denormalizes,
    and a dashboard-scoped ResourceAssignmentSummary rather than mutating
    transient attributes onto the ORM row."""
    result = await db.execute(
        select(ResourceAssignment)
        .join(Activity, Activity.id == ResourceAssignment.activity_id)
        .where(Activity.schedule_period_id == schedule_period_id)
    )
    assignments = list(result.scalars().all())
    if not assignments:
        return []

    resource_ids = {a.resource_id for a in assignments}
    resources_by_id = {
        r.id: r for r in (await db.execute(select(Resource).where(Resource.id.in_(resource_ids)))).scalars().all()
    }
    activity_ids = {a.activity_id for a in assignments}
    activities_by_id = {
        a.id: a for a in (await db.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars().all()
    }
    # Exact hours_per_day per activity's own calendar (2026-09-05, per Maro:
    # "time is costed by the hour" — see compute_assignment_budget's own
    # header) — one lookup per distinct project among these activities.
    calendar_lookups = {
        project_id: await _build_calendar_lookup(db, project_id)
        for project_id in {a.project_id for a in activities_by_id.values()}
    }

    udf_by_record = udf_by_record or {}
    summaries = []
    for a in assignments:
        resource = resources_by_id.get(a.resource_id)
        if resource is None:
            continue
        activity = activities_by_id.get(a.activity_id)
        hours_per_day = None
        if activity is not None:
            lookup = calendar_lookups.get(activity.project_id)
            if lookup is not None:
                hours_per_day = lookup.hours_per_day(lookup.resolve(activity))
        summaries.append(ResourceAssignmentSummary(
            id=a.id, resource_name=resource.name, resource_type=resource.resource_type,
            discipline=resource.discipline, company=resource.company, role=a.role,
            budget=compute_assignment_budget(resource, activity, a, hours_per_day),
            activity_id=a.activity_id,
            activity_task_name=activity.task_name if activity is not None else "Unknown",
            # Keyed by the RESOURCE's own id, not the assignment's — UDFs
            # with entity_type="resource" are attached to the Resource
            # itself (user_defined_field.py's own docstring), same record a
            # resource_name filter already identifies.
            udf=udf_by_record.get(a.resource_id, {}),
        ))
    return summaries


def _icd_item_summaries(items: list[IcdItem]) -> list[IcdItemSummary]:
    return [
        IcdItemSummary(
            id=i.id, code=i.code, title=i.title, item_type=i.item_type, status=i.status,
            priority=i.priority, owner=i.owner, raised_date=i.raised_date, due_date=i.due_date,
            closed_date=i.closed_date, severity=i.severity, decision_maker=i.decision_maker,
            required_by=i.required_by, ccb_decision=i.ccb_decision, cost_impact=i.cost_impact,
            schedule_impact_days=i.schedule_impact_days,
        )
        for i in items
    ]


def _schedule_activities(
    activities: list[Activity], udf_by_record: dict[uuid.UUID, dict[str, str]] | None = None,
) -> list[ScheduleActivitySummary]:
    """Raw per-task rows for Batch 1's dashboard widgets (float distribution,
    activities-by-category, baseline variance, critical activities) — one
    shared fetch they each aggregate client-side, same split _milestones/
    the other builders already use. Milestones are deliberately excluded:
    they're what _milestones/milestone_timeline already cover, and
    wbs_summary rows never carry float/criticality (outside the CPM
    network) so they'd only pollute every aggregation below."""
    udf_by_record = udf_by_record or {}
    return [
        ScheduleActivitySummary(
            id=a.id, code=a.code, task_name=a.task_name, start=a.start, finish=a.finish, bl_finish=a.bl_finish,
            variance_days=a.variance_days, total_float_hours=a.total_float_hours,
            is_critical=a.is_critical, pct_complete=a.pct_complete, schedule_category=a.schedule_category,
            suspend_date=a.suspend_date, resume_date=a.resume_date, wbs_path=a.wbs_path,
            udf=udf_by_record.get(a.id, {}),
        )
        for a in activities
        if a.activity_type == "task"
    ]


def _lookahead(
    all_activities: list[Activity], scoped_activities: list[Activity], relationships: list[ActivityRelationship],
    milestones: list[MilestoneTimelineItem], now: datetime,
) -> tuple[list[LookaheadItem], LookaheadSummary]:
    """Look-Ahead Planner (Batch 8, 2026-07-20) — task-type activities
    starting within a fixed 6-week window from now, each flagged with
    whether any of its own predecessors is still below 100% complete (a
    real ActivityRelationship-driven check, matching what a planner would
    actually mean by "ready to start"). The frontend sub-filters this same
    6-week list down to a 2/4-week view rather than three separate fetches.
    "Healthy float" mirrors the >80h threshold FloatDistributionWidget's own
    bucket already uses for "not near-critical". Predecessor completion is
    resolved against all_activities (never scoped_activities) — a
    sub-project-scoped candidate's real-world predecessor can sit outside
    that scope, and treating "not in scope" as "incomplete" would be a
    false positive, not a narrower-but-correct view."""
    window_weeks = 6
    window_end = now + timedelta(weeks=window_weeks)
    pct_complete_by_id = {a.id: a.pct_complete for a in all_activities}
    predecessors_by_successor: dict[uuid.UUID, list[uuid.UUID]] = {}
    for r in relationships:
        predecessors_by_successor.setdefault(r.successor_id, []).append(r.predecessor_id)

    def has_incomplete_predecessor(activity_id: uuid.UUID) -> bool:
        for pred_id in predecessors_by_successor.get(activity_id, []):
            pred_pct = pct_complete_by_id.get(pred_id)
            if pred_pct is None or pred_pct < 100:
                return True
        return False

    in_window = [
        a for a in scoped_activities
        if a.activity_type == "task" and a.start is not None and now <= a.start <= window_end
    ]
    items = [
        LookaheadItem(
            id=a.id, code=a.code, task_name=a.task_name, start=a.start, finish=a.finish,
            pct_complete=a.pct_complete, total_float_hours=a.total_float_hours, is_critical=a.is_critical,
            has_incomplete_predecessor=has_incomplete_predecessor(a.id),
        )
        for a in in_window
    ]
    next_milestone = next((m for m in milestones if m.finish is not None and m.finish >= now), None)
    summary = LookaheadSummary(
        window_weeks=window_weeks,
        total_in_window=len(items),
        critical_in_window=sum(1 for i in items if i.is_critical is True),
        healthy_float_count=sum(1 for i in items if i.total_float_hours is not None and i.total_float_hours > 80),
        incomplete_predecessor_count=sum(1 for i in items if i.has_incomplete_predecessor),
        next_milestone_name=next_milestone.task_name if next_milestone else None,
        next_milestone_date=next_milestone.finish if next_milestone else None,
    )
    return items, summary


async def _mitigation_actions(db: AsyncSession, risks: list[Risk]) -> list[RiskMitigationActionSummary]:
    if not risks:
        return []
    risk_code_by_id = {r.id: r.code for r in risks}
    actions = (await db.execute(
        select(RiskMitigationAction).where(RiskMitigationAction.risk_id.in_(risk_code_by_id.keys()))
    )).scalars().all()
    return [
        RiskMitigationActionSummary(
            id=a.id, risk_id=a.risk_id, risk_code=risk_code_by_id[a.risk_id], code=a.code,
            description=a.description, owner=a.owner, due_date=a.due_date,
            status=a.status, pct_complete=a.pct_complete,
        )
        for a in actions
    ]


def _top_risks(risks: list[Risk]) -> list[TopRisk]:
    ranked = sorted(risks, key=lambda r: r.rating if r.rating is not None else Decimal(-1), reverse=True)
    return [
        TopRisk(
            id=r.id, code=r.code, title=r.title, status=r.status,
            rating=r.rating, emv_cost=r.emv_cost, emv_schedule_days=r.emv_schedule_days,
        )
        for r in ranked[:5]
    ]


def _risk_summaries(risks: list[Risk]) -> list[RiskSummary]:
    return [
        RiskSummary(
            id=r.id, code=r.code, title=r.title, category=r.category, area=r.area, status=r.status,
            risk_owner=r.risk_owner, risk_type=r.risk_type, response_strategy=r.response_strategy,
            rating=r.rating, emv_cost=r.emv_cost, emv_schedule_days=r.emv_schedule_days,
            date_raised=r.date_raised,
        )
        for r in risks
    ]


def _band_of(value: Decimal) -> int:
    """Mirrors frontend/src/components/HeatMatrix.tsx's bandOf: floor(value*5),
    clamped 0-4 — the same 5-level probability/impact band the heat matrix
    already draws for every individual risk, kept in lockstep rather than a
    second, independently-invented banding rule."""
    return min(4, max(0, int(value * 5)))


def _risk_overview_and_exposure(risks: list[Risk]) -> tuple[RiskOverview, list[RiskExposureBand]]:
    open_risks = [r for r in risks if r.status != "closed"]
    closed_count = len(risks) - len(open_risks)

    high = medium = low = 0
    exposure = {"Low": Decimal(0), "Medium": Decimal(0), "High": Decimal(0)}
    for r in open_risks:
        if r.probability is None or r.impact is None:
            continue
        # Severity 0-8 (probBand + impactBand), same boundaries
        # HeatMatrix.tsx's cellColor already draws, collapsed from 5 colour
        # tiers to 3 counts: Low <=1, Medium 2-5, High 6-8.
        severity = _band_of(r.probability) + _band_of(r.impact)
        if severity <= 1:
            low += 1
            band = "Low"
        elif severity <= 5:
            medium += 1
            band = "Medium"
        else:
            high += 1
            band = "High"
        if r.emv_cost is not None:
            exposure[band] += r.emv_cost

    overview = RiskOverview(high=high, medium=medium, low=low, open=len(open_risks), closed=closed_count)
    exposure_bands = [RiskExposureBand(band=band, emv_cost=total.quantize(_MONEY)) for band, total in exposure.items()]
    return overview, exposure_bands


async def get_overview(
    db: AsyncSession,
    project_id: uuid.UUID,
    period_id: uuid.UUID,
    schedule_period_id: uuid.UUID,
    wbs_node_activity_id: uuid.UUID | None,
    critical_only: bool,
) -> DashboardOverviewResponse:
    activities_result = await db.execute(select(Activity).where(Activity.schedule_period_id == schedule_period_id))
    all_activities_including_wbs = list(activities_result.scalars().all())
    all_activities = [
        a for a in all_activities_including_wbs
        if a.activity_type != "wbs_summary" and not a.is_archived and not a.is_archive_container
    ]

    # WBS-node scope slicer (2026-08-28, per Maro: "allow slicers for wbs
    # which affects all the cards") — replaces the old registered-sub-
    # project picker with any real WBS node chosen directly from the tree,
    # so scoping isn't limited to whatever's been pre-tagged. Always uses
    # the master is_critical field (not a sub-project's own isolated
    # sub_is_critical) — that field only exists for a registered
    # ScheduleSubproject's dedicated CPM pass, not derivable on the fly for
    # an arbitrary node (see _dcma_quality_summary's own docstring for the
    # same reasoning, which is why DCMA Quality itself stays unscoped).
    scoped_activities = all_activities
    if wbs_node_activity_id is not None:
        node = next((a for a in all_activities_including_wbs if a.id == wbs_node_activity_id), None)
        if node is None or node.schedule_period_id != schedule_period_id:
            raise HTTPException(status_code=404, detail="WBS node not found in this schedule.")
        scope_ids = await _subtree_ids(db, schedule_period_id, wbs_node_activity_id)
        scoped_activities = [a for a in all_activities if a.id in scope_ids]

    bucket_activities = [a for a in scoped_activities if a.is_critical is True] if critical_only else scoped_activities

    icd_result = await db.execute(
        select(IcdItem).where(IcdItem.project_id == project_id, IcdItem.period_id == period_id)
    )
    icd_items = list(icd_result.scalars().all())

    kpis, cost_elements = await _kpis(db, project_id, period_id, all_activities, icd_items)
    schedule_buckets = _schedule_buckets(bucket_activities)
    milestones = _milestones(scoped_activities)
    # UDF values, fetched once per entity_type and threaded into each
    # summary builder (2026-09-02, see _udf_values_by_record's own header) —
    # a project with no UDFs configured for a given entity_type just gets an
    # empty dict, same "no filter, no penalty" shape everything else here
    # already has.
    activity_udf = await _udf_values_by_record(db, project_id, "activity")
    cost_element_udf = await _udf_values_by_record(db, project_id, "cost_element")
    resource_udf = await _udf_values_by_record(db, project_id, "resource")

    schedule_activities = _schedule_activities(scoped_activities, activity_udf)
    cost_element_summaries = _cost_element_summaries(cost_elements, cost_element_udf)
    icd_item_summaries = _icd_item_summaries(icd_items)
    resource_assignment_summaries = await _resource_assignment_summaries(db, schedule_period_id, resource_udf)

    risks_result = await db.execute(select(Risk).where(Risk.period_id == period_id))
    risks = list(risks_result.scalars().all())
    top_risks = _top_risks(risks)
    risk_summaries = _risk_summaries(risks)
    risk_overview, risk_exposure = _risk_overview_and_exposure(risks)
    mitigation_actions = await _mitigation_actions(db, risks)

    project_info, period, relationships = await _project_info(db, project_id, schedule_period_id, all_activities)
    dcma_quality = await _dcma_quality_summary(db, schedule_period_id, all_activities, relationships)
    clash_summary, clash_pairs = await _clash_summary_and_pairs(db, project_id)
    now = datetime.combine(period.cutoff_date, time.min) if period is not None and period.cutoff_date is not None else datetime.now()
    lookahead_items, lookahead_summary = _lookahead(all_activities, scoped_activities, relationships, milestones, now)

    return DashboardOverviewResponse(
        kpis=kpis,
        schedule_buckets=schedule_buckets,
        milestones=milestones,
        schedule_activities=schedule_activities,
        lookahead_items=lookahead_items,
        lookahead_summary=lookahead_summary,
        cost_elements=cost_element_summaries,
        resource_assignments=resource_assignment_summaries,
        icd_items=icd_item_summaries,
        risks=risk_summaries,
        mitigation_actions=mitigation_actions,
        top_risks=top_risks,
        risk_overview=risk_overview,
        risk_exposure=risk_exposure,
        dcma_quality=dcma_quality,
        clash_summary=clash_summary,
        clash_pairs=clash_pairs,
        project_info=project_info,
    )


async def _baseline_schedule_pv_ev_ac(
    db: AsyncSession, baseline_set_id: uuid.UUID, snapshots: list[ScheduleBaselineActivity],
) -> tuple[Decimal, Decimal, Decimal] | None:
    """Shared by _baseline_schedule_spi (ratio only) and get_pv_ev_ac_trend
    (the raw totals) — schedule-linked cost elements' PV/EV via the same
    _schedule_evm formula the live PV column uses, evaluated at the
    baseline's own capture date against the sibling ScheduleBaseline's own
    activity-date snapshots. AC is each element's own baseline-captured
    actual cost, same schedule-linked population as PV/EV — never a wider
    "all cost elements" total, since PV genuinely has no meaning for cost
    with no linked activity to give it a timeline. None whenever there's no
    sibling CostBaseline or no schedule-linked overlap, never a guessed
    number."""
    cost_baseline = (await db.execute(
        select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
        .order_by(CostBaseline.created_at.desc())
    )).scalars().first()
    if cost_baseline is None:
        return None
    baseline_set = await db.get(BaselineSet, baseline_set_id)
    cost_snapshots = {s.cost_element_id: s for s in (await db.execute(
        select(CostBaselineItem).where(CostBaselineItem.baseline_id == cost_baseline.id)
    )).scalars().all()}
    if not cost_snapshots:
        return None

    schedule_linked_elements = (await db.execute(
        select(CostElement).where(
            CostElement.id.in_(cost_snapshots.keys()), CostElement.source == "schedule",
            CostElement.linked_activity_id.isnot(None),
        )
    )).scalars().all()

    # A ScheduleBaselineActivity snapshot carries no calendar_id of its own
    # (see that model's own header) — resolved via the *live* Activity's own
    # calendar instead (a project's calendars don't churn), same "elapsed_
    # duration_fraction now needs a real calendar, not just start/finish"
    # requirement _schedule_evm's own header explains (2026-09-04, per Maro
    # — exact P6 parity: working-day proration, not calendar-time).
    lookup = await _build_calendar_lookup(db, baseline_set.project_id)
    linked_activities = (await db.execute(
        select(Activity.id, Activity.calendar_id).where(
            Activity.id.in_({el.linked_activity_id for el in schedule_linked_elements})
        )
    )).all()
    calendar_id_by_activity_id = {row.id: row.calendar_id for row in linked_activities}

    activity_snap_by_id = {s.activity_id: s for s in snapshots}
    data_date = datetime.combine(baseline_set.baseline_date, time.min)
    pv_total = ev_total = ac_total = Decimal(0)
    has_schedule_evm = False
    for el in schedule_linked_elements:
        activity_snap = activity_snap_by_id.get(el.linked_activity_id)
        cost_snap = cost_snapshots.get(el.id)
        if activity_snap is None or cost_snap is None:
            continue
        activity_calendar = lookup.resolve_calendar_id(calendar_id_by_activity_id.get(el.linked_activity_id))
        pv, ev, _sv, _spi = _schedule_evm(
            cost_snap.bac, cost_snap.pct_complete, activity_snap.start, activity_snap.finish, data_date,
            lookup, activity_calendar,
        )
        if pv is None:
            continue
        has_schedule_evm = True
        pv_total += pv
        if ev is not None:
            ev_total += ev
        ac_total += cost_snap.ac or Decimal(0)

    return (pv_total, ev_total, ac_total) if has_schedule_evm else None


async def _baseline_schedule_spi(
    db: AsyncSession, baseline_set_id: uuid.UUID, snapshots: list[ScheduleBaselineActivity],
) -> Decimal | None:
    """The same PV/EV-based SPI formula _live_schedule_spi uses, evaluated at
    the baseline's own capture date instead of now — see
    _baseline_schedule_pv_ev_ac for the shared totals computation."""
    totals = await _baseline_schedule_pv_ev_ac(db, baseline_set_id, snapshots)
    if totals is None:
        return None
    pv_total, ev_total, _ac_total = totals
    return rollup_evm_from_totals(None, None, pv_total, ev_total)["spi"]


async def _schedule_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> ScheduleComparison | None:
    baseline = (await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.baseline_set_id == baseline_set_id)
        .order_by(ScheduleBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_activity_ids = {s.activity_id for s in snapshots}
    activities = {a.id: a for a in (await db.execute(
        select(Activity).where(Activity.id.in_(snapshot_activity_ids))
    )).scalars().all()}

    items = []
    slip_days: list[int] = []
    for snap in snapshots:
        activity = activities.get(snap.activity_id)
        current_finish = activity.finish if activity else None
        variance_days = (
            (current_finish - snap.finish).days if current_finish is not None and snap.finish is not None else None
        )
        if variance_days is not None:
            slip_days.append(variance_days)
        items.append(ScheduleComparisonItem(
            activity_id=snap.activity_id, code=snap.code, task_name=activity.task_name if activity else snap.code,
            baseline_finish=snap.finish, current_finish=current_finish, variance_days=variance_days,
        ))

    # Activities added since the baseline was captured (no snapshot at all)
    # — surfaced with no baseline_finish rather than silently omitted, per
    # Maro: "if an item was added within period then it should [be] shown."
    # variance_days stays None for these (nothing to compare against), so
    # they never affect slipped_count/avg_slip_days below.
    added_activities = (await db.execute(
        select(Activity).where(
            Activity.schedule_period_id == baseline.schedule_period_id,
            Activity.activity_type != "wbs_summary", Activity.is_archived.is_(False), Activity.is_archive_container.is_(False),
            Activity.id.notin_(snapshot_activity_ids),
        )
    )).scalars().all()
    for activity in added_activities:
        items.append(ScheduleComparisonItem(
            activity_id=activity.id, code=activity.code, task_name=activity.task_name,
            baseline_finish=None, current_finish=activity.finish, variance_days=None,
        ))

    slipped_count = sum(1 for d in slip_days if d > 0)
    avg_slip = (Decimal(sum(slip_days)) / Decimal(len(slip_days))).quantize(Decimal("0.1")) if slip_days else None

    baseline_spi = await _baseline_schedule_spi(db, baseline_set_id, snapshots)
    period_row = await db.get(SchedulePeriod, baseline.schedule_period_id)
    variant = await db.get(ScheduleVariant, period_row.schedule_variant_id) if period_row else None
    current_spi = None
    if variant is not None:
        # "Current" SPI needs Risk/Cost/ICD's own shared Period, not this
        # SchedulePeriod — resolved via the sibling CostBaseline in this same
        # set (same period every module baseline in a capture-all set shares).
        cost_baseline = (await db.execute(
            select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
            .order_by(CostBaseline.created_at.desc())
        )).scalars().first()
        if cost_baseline is not None:
            current_spi, _elements = await _live_schedule_spi(db, variant.project_id, cost_baseline.period_id)

    return ScheduleComparison(
        baseline_name=baseline.name,
        summary=ScheduleComparisonSummary(
            total=len(items), slipped_count=slipped_count, avg_slip_days=avg_slip,
            baseline_spi=baseline_spi, current_spi=current_spi,
        ),
        items=items,
    )


async def _risk_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> RiskComparison | None:
    baseline = (await db.execute(
        select(RiskBaseline).where(RiskBaseline.baseline_set_id == baseline_set_id)
        .order_by(RiskBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(RiskBaselineItem).where(RiskBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_risk_ids = {s.risk_id for s in snapshots}
    risks = {r.id: r for r in (await db.execute(
        select(Risk).where(Risk.id.in_(snapshot_risk_ids))
    )).scalars().all()}

    items = []
    increased = decreased = unchanged = 0
    baseline_emv_total = current_emv_total = Decimal(0)
    for snap in snapshots:
        risk = risks.get(snap.risk_id)
        current_rating = risk.rating if risk else None
        current_emv_cost = risk.emv_cost if risk else None
        baseline_emv_total += snap.emv_cost or Decimal(0)
        current_emv_total += current_emv_cost or Decimal(0)
        if snap.rating is not None and current_rating is not None:
            if current_rating > snap.rating:
                increased += 1
            elif current_rating < snap.rating:
                decreased += 1
            else:
                unchanged += 1
        else:
            unchanged += 1
        items.append(RiskComparisonItem(
            risk_id=snap.risk_id, code=snap.code, title=risk.title if risk else snap.title,
            baseline_rating=snap.rating, current_rating=current_rating,
            baseline_emv_cost=snap.emv_cost, current_emv_cost=current_emv_cost,
        ))

    # Risks raised since the baseline was captured — no prior state to
    # compare direction against, so they don't count toward increased/
    # decreased/unchanged, but their current EMV still belongs in the
    # portfolio's current total, and they're shown rather than omitted.
    added_risks = (await db.execute(
        select(Risk).where(Risk.period_id == baseline.period_id, Risk.id.notin_(snapshot_risk_ids))
    )).scalars().all()
    for risk in added_risks:
        current_emv_total += risk.emv_cost or Decimal(0)
        items.append(RiskComparisonItem(
            risk_id=risk.id, code=risk.code, title=risk.title,
            baseline_rating=None, current_rating=risk.rating,
            baseline_emv_cost=None, current_emv_cost=risk.emv_cost,
        ))

    return RiskComparison(
        baseline_name=baseline.name,
        summary=RiskComparisonSummary(
            increased_count=increased, decreased_count=decreased, unchanged_count=unchanged,
            baseline_emv_cost_total=baseline_emv_total.quantize(_MONEY), current_emv_cost_total=current_emv_total.quantize(_MONEY),
        ),
        items=items,
    )


async def _cost_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> CostComparison | None:
    baseline = (await db.execute(
        select(CostBaseline).where(CostBaseline.baseline_set_id == baseline_set_id)
        .order_by(CostBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(CostBaselineItem).where(CostBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_element_ids = {s.cost_element_id for s in snapshots}
    period = await db.get(Period, baseline.period_id)
    # Reuses the *live* elements (already computes computed_budget/computed_actuals
    # for percentage elements) so "current" always reads through the one shared
    # resolution path — never a second, independently-derived figure.
    elements = {el.id: el for el in await list_cost_elements(db, period.project_id, baseline.period_id)}

    items = []
    baseline_bac_total = baseline_ac_total = baseline_ev_total = Decimal(0)
    # "Current" totals sum over *every* live element, not just ones that
    # existed at baseline time — an element added since capture still
    # belongs in today's real BAC/CPI/EAC, otherwise the portfolio total
    # itself would silently undercount (Maro: added items "should [be]
    # shown," which has to be true of the aggregate too, not just the table).
    current_bac_total = current_ac_total = current_ev_total = Decimal(0)
    for el in elements.values():
        bac, ac = _resolve_bac_ac(el)
        if bac is None:
            continue
        current_bac_total += bac
        current_ac_total += ac or Decimal(0)
        if el.pct_complete is not None:
            current_ev_total += bac * Decimal(el.pct_complete) / Decimal(100)

    for snap in snapshots:
        baseline_bac_total += snap.bac
        baseline_ac_total += snap.ac or Decimal(0)
        baseline_ev = snap.bac * Decimal(snap.pct_complete) / Decimal(100) if snap.pct_complete is not None else None
        if baseline_ev is not None:
            baseline_ev_total += baseline_ev
        baseline_cpi = (baseline_ev / snap.ac).quantize(Decimal("0.0001")) if baseline_ev is not None and snap.ac else None

        el = elements.get(snap.cost_element_id)
        current_budget, current_ac = _resolve_bac_ac(el) if el else (None, None)
        current_cpi = None
        if el is not None and current_budget is not None and el.pct_complete is not None and current_ac:
            current_ev = current_budget * Decimal(el.pct_complete) / Decimal(100)
            current_cpi = (current_ev / current_ac).quantize(Decimal("0.0001"))

        items.append(CostComparisonItem(
            cost_element_id=snap.cost_element_id, code=snap.code, description=el.description if el else snap.description,
            baseline_budget=snap.bac, current_budget=current_budget,
            baseline_cpi=baseline_cpi, current_cpi=current_cpi,
        ))

    # Cost elements added since the baseline was captured — no baseline
    # figure at all, shown rather than omitted (their current BAC/EV already
    # rolled into current_bac_total/current_ev_total above).
    for el in elements.values():
        if el.id in snapshot_element_ids:
            continue
        current_budget, current_ac = _resolve_bac_ac(el)
        if current_budget is None:
            continue
        current_cpi = None
        if el.pct_complete is not None and current_ac:
            current_ev = current_budget * Decimal(el.pct_complete) / Decimal(100)
            current_cpi = (current_ev / current_ac).quantize(Decimal("0.0001"))
        items.append(CostComparisonItem(
            cost_element_id=el.id, code=el.code, description=el.description,
            baseline_budget=None, current_budget=current_budget,
            baseline_cpi=None, current_cpi=current_cpi,
        ))

    baseline_rollup = rollup_evm_from_totals(baseline_bac_total, baseline_ac_total, None, baseline_ev_total)
    current_rollup = rollup_evm_from_totals(current_bac_total, current_ac_total, None, current_ev_total)
    return CostComparison(
        baseline_name=baseline.name,
        summary=CostComparisonSummary(
            baseline_bac=baseline_bac_total.quantize(_MONEY), current_bac=current_bac_total.quantize(_MONEY),
            baseline_cpi=baseline_rollup["cpi"], current_cpi=current_rollup["cpi"],
            baseline_eac=baseline_rollup["eac"], current_eac=current_rollup["eac"],
        ),
        items=items,
    )


async def _icd_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> IcdComparison | None:
    baseline = (await db.execute(
        select(IcdBaseline).where(IcdBaseline.baseline_set_id == baseline_set_id)
        .order_by(IcdBaseline.created_at.desc())
    )).scalars().first()
    if baseline is None:
        return None

    snapshots = (await db.execute(
        select(IcdBaselineItem).where(IcdBaselineItem.baseline_id == baseline.id)
    )).scalars().all()
    snapshot_item_ids = {s.icd_item_id for s in snapshots}
    live_all = (await db.execute(select(IcdItem).where(IcdItem.period_id == baseline.period_id))).scalars().all()
    live_items = {i.id: i for i in live_all}

    items = []
    # "Current" open counts are computed over *every* live item, not just
    # ones that existed at baseline time — same reasoning as Cost's totals
    # above: an item raised since capture still belongs in today's real
    # open count. "Baseline" open counts stay scoped to what was actually
    # captured, since that's genuinely what the baseline snapshot recorded.
    open_counts = {t: {"baseline": 0, "current": 0} for t in ("issue", "change", "decision")}
    for live in live_all:
        if live.status != "closed":
            open_counts[live.item_type]["current"] += 1

    for snap in snapshots:
        live = live_items.get(snap.icd_item_id)
        current_status = live.status if live else None
        if snap.status != "closed":
            open_counts[snap.item_type]["baseline"] += 1
        items.append(IcdComparisonItem(
            icd_item_id=snap.icd_item_id, code=snap.code, item_type=snap.item_type,
            title=live.title if live else snap.title, baseline_status=snap.status, current_status=current_status,
        ))

    # Items raised since the baseline was captured — shown with no
    # baseline_status rather than omitted; already counted in "current"
    # open above.
    for live in live_all:
        if live.id in snapshot_item_ids:
            continue
        items.append(IcdComparisonItem(
            icd_item_id=live.id, code=live.code, item_type=live.item_type,
            title=live.title, baseline_status=None, current_status=live.status,
        ))

    return IcdComparison(
        baseline_name=baseline.name,
        summary=IcdComparisonSummary(**{
            t: IcdComparisonTypeCounts(baseline_open=c["baseline"], current_open=c["current"])
            for t, c in open_counts.items()
        }),
        items=items,
    )


async def get_baseline_comparison(db: AsyncSession, baseline_set_id: uuid.UUID) -> BaselineComparisonResponse:
    baseline_set = await db.get(BaselineSet, baseline_set_id)
    if baseline_set is None:
        raise HTTPException(status_code=404, detail="Baseline set not found")

    return BaselineComparisonResponse(
        baseline_set_name=baseline_set.name,
        baseline_set_date=baseline_set.baseline_date,
        schedule=await _schedule_comparison(db, baseline_set_id),
        risk=await _risk_comparison(db, baseline_set_id),
        cost=await _cost_comparison(db, baseline_set_id),
        icd=await _icd_comparison(db, baseline_set_id),
    )


async def get_risk_emv_trend(db: AsyncSession, period_id: uuid.UUID) -> RiskEmvTrendResponse:
    """Risk EMV Trend (2026-09-03, per Maro — see schemas/dashboard.py's own
    header comment): portfolio-level open-risk EMV exposure at each saved
    RiskBaseline (chronological) plus a live Current point, so a planner can
    see at a glance whether overall risk exposure has been growing, shrinking,
    or stagnant across periods — not just today's single snapshot. "Open"
    matches _risk_overview_and_exposure's own convention (status != "closed")
    rather than _risk_comparison's portfolio-total (which deliberately
    includes closed risks for a different purpose, tracking total EMV
    movement including risks retired since the baseline) — a closed risk no
    longer contributes real exposure, so it's excluded here the same way the
    live Risk Exposure widget already excludes it."""
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")

    baselines = (await db.execute(
        select(RiskBaseline).where(RiskBaseline.period_id == period_id)
        .order_by(RiskBaseline.baseline_date.asc(), RiskBaseline.created_at.asc())
    )).scalars().all()

    # One batched query for every baseline's items, not one query per
    # baseline (2026-09-03 perf pass, per Maro: "switching between modules
    # and sometime clicking a particular process takes a longer time on
    # main/production" — this trend chart was doing N sequential round trips
    # to the DB, cheap over a low-latency local connection but genuinely slow
    # against production's real network RTT to Neon; same fix applied to the
    # other 3 trend charts and matches get_milestone_trend's own established
    # batching pattern below).
    snapshots_by_baseline: dict[uuid.UUID, list[RiskBaselineItem]] = {b.id: [] for b in baselines}
    if baselines:
        all_snapshots = (await db.execute(
            select(RiskBaselineItem).where(RiskBaselineItem.baseline_id.in_([b.id for b in baselines]))
        )).scalars().all()
        for s in all_snapshots:
            snapshots_by_baseline[s.baseline_id].append(s)

    points = []
    for b in baselines:
        open_snapshots = [s for s in snapshots_by_baseline[b.id] if s.status != "closed"]
        emv_cost_total = sum((s.emv_cost for s in open_snapshots if s.emv_cost is not None), Decimal(0))
        emv_days_total = sum((s.emv_schedule_days for s in open_snapshots if s.emv_schedule_days is not None), Decimal(0))
        points.append(RiskEmvTrendPoint(
            baseline_id=b.id, baseline_name=b.name, baseline_date=b.baseline_date,
            open_count=len(open_snapshots),
            emv_cost_total=emv_cost_total.quantize(_MONEY), emv_schedule_days_total=emv_days_total.quantize(Decimal("0.1")),
        ))

    live_risks = (await db.execute(select(Risk).where(Risk.period_id == period_id))).scalars().all()
    open_live = [r for r in live_risks if r.status != "closed"]
    current_emv_cost = sum((r.emv_cost for r in open_live if r.emv_cost is not None), Decimal(0))
    current_emv_days = sum((r.emv_schedule_days for r in open_live if r.emv_schedule_days is not None), Decimal(0))
    points.append(RiskEmvTrendPoint(
        baseline_id=None, baseline_name="Current", baseline_date=date.today(),
        open_count=len(open_live),
        emv_cost_total=current_emv_cost.quantize(_MONEY), emv_schedule_days_total=current_emv_days.quantize(Decimal("0.1")),
    ))
    return RiskEmvTrendResponse(points=points)


async def get_cost_performance_trend(db: AsyncSession, period_id: uuid.UUID) -> CostPerformanceTrendResponse:
    """Cost CPI/EAC Trend (2026-09-03, per Maro): portfolio-level BAC/CPI/EAC
    at each saved CostBaseline (chronological) plus a live Current point —
    same _cost_comparison rollup (sum bac/ac/ev across snapshot rows, then
    rollup_evm_from_totals once over the totals, never averaging per-element
    CPIs), just walked across *every* baseline instead of only the most
    recent one. Both CPI and EAC come out of this single fetch (they share
    the same underlying bac/ac/ev totals per point) — the frontend renders
    them as two separate widgets (different units/scales) off one series."""
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")

    baselines = (await db.execute(
        select(CostBaseline).where(CostBaseline.period_id == period_id)
        .order_by(CostBaseline.baseline_date.asc(), CostBaseline.created_at.asc())
    )).scalars().all()

    # Batched (see get_risk_emv_trend's own comment above for why).
    snapshots_by_baseline: dict[uuid.UUID, list[CostBaselineItem]] = {b.id: [] for b in baselines}
    if baselines:
        all_snapshots = (await db.execute(
            select(CostBaselineItem).where(CostBaselineItem.baseline_id.in_([b.id for b in baselines]))
        )).scalars().all()
        for s in all_snapshots:
            snapshots_by_baseline[s.baseline_id].append(s)

    points = []
    for b in baselines:
        bac_total = ac_total = ev_total = Decimal(0)
        for s in snapshots_by_baseline[b.id]:
            bac_total += s.bac
            ac_total += s.ac or Decimal(0)
            if s.pct_complete is not None:
                ev_total += s.bac * Decimal(s.pct_complete) / Decimal(100)
        rollup = rollup_evm_from_totals(bac_total, ac_total, None, ev_total)
        points.append(CostPerformanceTrendPoint(
            baseline_id=b.id, baseline_name=b.name, baseline_date=b.baseline_date,
            bac=bac_total.quantize(_MONEY), cpi=rollup["cpi"], eac=rollup["eac"],
        ))

    elements = await list_cost_elements(db, period.project_id, period_id)
    bac_total = ac_total = ev_total = Decimal(0)
    has_cost_evm = False
    for el in elements:
        bac, ac = _resolve_bac_ac(el)
        if bac is None:
            continue
        has_cost_evm = True
        bac_total += bac
        ac_total += ac or Decimal(0)
        if el.pct_complete is not None:
            ev_total += bac * Decimal(el.pct_complete) / Decimal(100)
    current_rollup = rollup_evm_from_totals(bac_total, ac_total, None, ev_total) if has_cost_evm else {}
    points.append(CostPerformanceTrendPoint(
        baseline_id=None, baseline_name="Current", baseline_date=date.today(),
        bac=bac_total.quantize(_MONEY) if has_cost_evm else None,
        cpi=current_rollup.get("cpi"), eac=current_rollup.get("eac"),
    ))
    return CostPerformanceTrendResponse(points=points)


async def get_spi_trend(db: AsyncSession, project_id: uuid.UUID) -> SpiTrendResponse:
    """SPI Trend (2026-09-03, per Maro): unlike the other three trends here,
    SPI is genuinely cross-pillar (needs a schedule-linked cost element's
    baseline bac/pct_complete *and* its activity's baseline start/finish
    together — see _baseline_schedule_spi), so this walks BaselineSets (the
    thing that actually links a ScheduleBaseline to its sibling CostBaseline),
    not a single per-pillar baseline table. A BaselineSet with no linked
    ScheduleBaseline, or one whose schedule-linked cost data isn't there yet,
    simply has no point — never a guessed number, same "no snapshot = no
    point" rule Milestone Trend already established."""
    baseline_sets = (await db.execute(
        select(BaselineSet).where(BaselineSet.project_id == project_id)
        .order_by(BaselineSet.baseline_date.asc(), BaselineSet.created_at.asc())
    )).scalars().all()

    # Batched: one query for every set's own ScheduleBaseline, one for all
    # their ScheduleBaselineActivity snapshots — not 2 round trips per set
    # (see get_risk_emv_trend's own comment for why this matters on
    # production). _baseline_schedule_spi itself still runs once per relevant
    # BaselineSet below (its own internal CostBaseline/CostElement lookups
    # aren't batched here — same function Baseline Comparison already calls
    # for exactly one set at a time, left as-is rather than risk that proven
    # path; SPI trend's real-world baseline-set count is typically small
    # since "Capture All Now" is a deliberate, occasional action, unlike
    # Risk/Cost/ICD's own more-frequent baselines).
    sched_baselines_by_set: dict[uuid.UUID, ScheduleBaseline] = {}
    if baseline_sets:
        set_ids = [bset.id for bset in baseline_sets]
        all_sched_baselines = (await db.execute(
            select(ScheduleBaseline).where(ScheduleBaseline.baseline_set_id.in_(set_ids))
            .order_by(ScheduleBaseline.created_at.desc())
        )).scalars().all()
        for sb in all_sched_baselines:
            sched_baselines_by_set.setdefault(sb.baseline_set_id, sb)  # first (most recent) wins

        sched_baseline_ids = [sb.id for sb in sched_baselines_by_set.values()]
        snapshots_by_sched_baseline: dict[uuid.UUID, list[ScheduleBaselineActivity]] = {bid: [] for bid in sched_baseline_ids}
        if sched_baseline_ids:
            all_snapshots = (await db.execute(
                select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id.in_(sched_baseline_ids))
            )).scalars().all()
            for snap in all_snapshots:
                snapshots_by_sched_baseline[snap.baseline_id].append(snap)
    else:
        snapshots_by_sched_baseline = {}

    points = []
    for bset in baseline_sets:
        sched_baseline = sched_baselines_by_set.get(bset.id)
        if sched_baseline is None:
            continue
        snapshots = snapshots_by_sched_baseline[sched_baseline.id]
        spi = await _baseline_schedule_spi(db, bset.id, snapshots)
        if spi is None:
            continue
        points.append(SpiTrendPoint(baseline_set_id=bset.id, baseline_name=bset.name, baseline_date=bset.baseline_date, spi=spi))

    live_period = (await db.execute(
        select(Period).where(Period.project_id == project_id, Period.freeze_status == "live")
    )).scalars().first()
    if live_period is not None:
        current_spi, _elements = await _live_schedule_spi(db, project_id, live_period.id)
        if current_spi is not None:
            points.append(SpiTrendPoint(baseline_set_id=None, baseline_name="Current", baseline_date=date.today(), spi=current_spi))
    return SpiTrendResponse(points=points)


async def get_pv_ev_ac_trend(db: AsyncSession, project_id: uuid.UUID) -> PvEvAcTrendResponse:
    """PV/EV/AC Trend (2026-09-04, per Maro — the classic PMBOK Figure 4
    S-curve, but sampled at baseline captures instead of continuous calendar
    time). Walks BaselineSets chronologically, same shape as SPI Trend
    above (PV is genuinely a schedule+cost cross-pillar concept — see
    _baseline_schedule_pv_ev_ac), plus a live Current point. Scoped to
    schedule-linked cost elements only for all three lines, not the whole
    cost plan, so PV/EV/AC represent the same body of work — PV has no
    meaning at all for cost with no linked activity to give it a timeline."""
    baseline_sets = (await db.execute(
        select(BaselineSet).where(BaselineSet.project_id == project_id)
        .order_by(BaselineSet.baseline_date.asc(), BaselineSet.created_at.asc())
    )).scalars().all()

    sched_baselines_by_set: dict[uuid.UUID, ScheduleBaseline] = {}
    snapshots_by_sched_baseline: dict[uuid.UUID, list[ScheduleBaselineActivity]] = {}
    if baseline_sets:
        set_ids = [bset.id for bset in baseline_sets]
        all_sched_baselines = (await db.execute(
            select(ScheduleBaseline).where(ScheduleBaseline.baseline_set_id.in_(set_ids))
            .order_by(ScheduleBaseline.created_at.desc())
        )).scalars().all()
        for sb in all_sched_baselines:
            sched_baselines_by_set.setdefault(sb.baseline_set_id, sb)  # first (most recent) wins

        sched_baseline_ids = [sb.id for sb in sched_baselines_by_set.values()]
        snapshots_by_sched_baseline = {bid: [] for bid in sched_baseline_ids}
        if sched_baseline_ids:
            all_snapshots = (await db.execute(
                select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id.in_(sched_baseline_ids))
            )).scalars().all()
            for snap in all_snapshots:
                snapshots_by_sched_baseline[snap.baseline_id].append(snap)

    points = []
    for bset in baseline_sets:
        sched_baseline = sched_baselines_by_set.get(bset.id)
        if sched_baseline is None:
            continue
        snapshots = snapshots_by_sched_baseline[sched_baseline.id]
        totals = await _baseline_schedule_pv_ev_ac(db, bset.id, snapshots)
        if totals is None:
            continue
        pv_total, ev_total, ac_total = totals
        points.append(PvEvAcTrendPoint(
            baseline_set_id=bset.id, baseline_name=bset.name, baseline_date=bset.baseline_date,
            pv=pv_total.quantize(_MONEY), ev=ev_total.quantize(_MONEY), ac=ac_total.quantize(_MONEY),
        ))

    live_period = (await db.execute(
        select(Period).where(Period.project_id == project_id, Period.freeze_status == "live")
    )).scalars().first()
    if live_period is not None:
        _spi, elements = await _live_schedule_spi(db, project_id, live_period.id)
        pv_total = ev_total = ac_total = Decimal(0)
        has_schedule_evm = False
        for el in elements:
            if el.pv is None:
                continue
            has_schedule_evm = True
            pv_total += el.pv
            if el.ev is not None:
                ev_total += el.ev
            _bac, ac = _resolve_bac_ac(el)
            if ac is not None:
                ac_total += ac
        if has_schedule_evm:
            points.append(PvEvAcTrendPoint(
                baseline_set_id=None, baseline_name="Current", baseline_date=date.today(),
                pv=pv_total.quantize(_MONEY), ev=ev_total.quantize(_MONEY), ac=ac_total.quantize(_MONEY),
            ))
    return PvEvAcTrendResponse(points=points)


async def get_icd_open_items_trend(db: AsyncSession, period_id: uuid.UUID) -> IcdOpenItemsTrendResponse:
    """Issues/Changes/Decisions Open-Count Trend (2026-09-03, per Maro:
    "tracking how many open over periods") — open count per item_type at each
    saved IcdBaseline (chronological) plus a live Current point, so a planner
    can see whether the backlog of open items has been growing, shrinking, or
    stagnant. "Open" matches _icd_comparison's own convention (status !=
    "closed")."""
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")

    baselines = (await db.execute(
        select(IcdBaseline).where(IcdBaseline.period_id == period_id)
        .order_by(IcdBaseline.baseline_date.asc(), IcdBaseline.created_at.asc())
    )).scalars().all()

    # Batched (see get_risk_emv_trend's own comment above for why).
    snapshots_by_baseline: dict[uuid.UUID, list[IcdBaselineItem]] = {b.id: [] for b in baselines}
    if baselines:
        all_snapshots = (await db.execute(
            select(IcdBaselineItem).where(IcdBaselineItem.baseline_id.in_([b.id for b in baselines]))
        )).scalars().all()
        for s in all_snapshots:
            snapshots_by_baseline[s.baseline_id].append(s)

    points = []
    for b in baselines:
        counts = {"issue": 0, "change": 0, "decision": 0}
        for s in snapshots_by_baseline[b.id]:
            if s.status != "closed":
                counts[s.item_type] += 1
        points.append(IcdOpenItemsTrendPoint(
            baseline_id=b.id, baseline_name=b.name, baseline_date=b.baseline_date,
            open_issues=counts["issue"], open_changes=counts["change"], open_decisions=counts["decision"],
        ))

    live_items = (await db.execute(select(IcdItem).where(IcdItem.period_id == period_id))).scalars().all()
    current_counts = {"issue": 0, "change": 0, "decision": 0}
    for i in live_items:
        if i.status != "closed":
            current_counts[i.item_type] += 1
    points.append(IcdOpenItemsTrendPoint(
        baseline_id=None, baseline_name="Current", baseline_date=date.today(),
        open_issues=current_counts["issue"], open_changes=current_counts["change"], open_decisions=current_counts["decision"],
    ))
    return IcdOpenItemsTrendResponse(points=points)
