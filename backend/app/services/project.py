from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_code_history import ActivityCodeHistory
from app.models.activity_relationship import ActivityRelationship
from app.models.base import Base, TimestampMixin
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.cost_commitment import CostCommitment
from app.models.cost_element import CostElement
from app.models.cost_rate_line import CostRateLine
from app.models.cost_variance_criterion import CostVarianceCriterion
from app.models.gantt_layout import GanttLayout
from app.models.icd_action_item import IcdActionItem
from app.models.icd_comment import IcdComment
from app.models.icd_criteria import IcdCriterion
from app.models.icd_item import IcdItem
from app.models.period import Period
from app.models.project import Project
from app.models.project_letterhead import ProjectLetterhead
from app.models.reassessment import Reassessment
from app.models.record_link import RecordLink
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.risk import Risk
from app.models.risk_criteria import RiskImpactCriterion, RiskProbabilityCriterion
from app.models.risk_mitigation_action import RiskMitigationAction
from app.models.schedule_baseline import ScheduleBaseline, ScheduleBaselineActivity
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_subproject import ScheduleSubproject
from app.models.schedule_variant import ScheduleVariant
from app.models.scheduling_filter import SchedulingFilter
from app.models.scheduling_quality_criterion import SchedulingQualityCriterion
from app.models.scheduling_quality_run import SchedulingQualityRun


def _clone_row(row: Base, new_id: uuid.UUID, **overrides):
    """Copies every real column off an existing row into a brand-new instance
    of the same class, generating a fresh id, then applies FK-remap overrides
    on top. Deliberately generic (reflects on `__table__.columns`) rather than
    hand-listing every field per model — with ~25 tables involved in a full
    project clone, a hand-written field list per model is exactly the kind of
    thing that quietly goes stale the next time a column is added to one of
    them, whereas this picks up new columns automatically.

    created_at/updated_at are excluded only for genuine TimestampMixin rows —
    those are ORM-managed "when was this row inserted" metadata, which should
    read as "now" for a freshly-cloned row, not the original's insert time.
    A handful of models (Reassessment.reviewed_at, RecordLink.created_at) have
    their own domain-meaningful timestamp under a similar name without using
    TimestampMixin at all — those are genuine data (when a reassessment was
    logged, when a link was actually made) and are deliberately preserved
    verbatim, which is exactly why this checks isinstance(row, TimestampMixin)
    rather than excluding columns by name alone.
    """
    cls = type(row)
    exclude = {"id"}
    if isinstance(row, TimestampMixin):
        exclude |= {"created_at", "updated_at"}
    data = {col.name: getattr(row, col.name) for col in cls.__table__.columns if col.name not in exclude}
    data["id"] = new_id
    data.update(overrides)
    return cls(**data)


async def duplicate_project(db: AsyncSession, project_id: uuid.UUID, new_name: str, created_by: uuid.UUID) -> Project:
    """A full, independent deep copy of a project — every module (Scheduling,
    Risk, Cost, ICD, Resources, Calendars, saved Layouts/Filters/Baselines,
    letterhead) and every cross-module link, with every internal id remapped
    so the copy never points back at the original project's rows (2026-07-06,
    per Maro: "in switch projects, allow me to duplicate a project").

    Built as one big function rather than one service module per area,
    deliberately — the whole point is a single, auditable, dependency-ordered
    pass (parents cloned and id-mapped before the children that reference
    them), which is much easier to get right and verify in one place than
    coordinating N independent per-module clone functions that would each
    need to agree on the same id maps.

    Three places embed a *different* row's id inside a JSONB blob rather than
    a real foreign key, and would otherwise silently keep pointing at the
    ORIGINAL project after a naive column-for-column copy — each is rewritten
    explicitly below: GanttLayout.letterhead_snapshot's own project_id,
    SchedulingQualityRun.report's schedule_period_id/scope_subproject_id, and
    Reassessment.record_id / RecordLink.source_id+target_id (both entirely
    unconstrained by any DB foreign key — "polymorphic, resolved at query
    time by (type, id)", per their own docstrings — so they can't be found via
    a join at all; found instead by matching against the id maps already
    built while cloning Activity/Risk/CostElement/IcdItem).

    Tenant-level ids are copied as-is, never remapped: Activity/ScheduleSubproject.
    owning_party_org_id, IcdComment.author_id, RecordLink.created_by — all
    point at Organisation/User rows the new project rightfully still shares
    with the original. Project.org_id and Project.created_by are the two
    exceptions — org_id is copied as-is (still the same tenant) but
    created_by is deliberately overridden to whoever is doing the
    duplicating (2026-08-25 per-user project ownership), not inherited from
    the original project's own creator.
    """
    original = await db.get(Project, project_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Project not found")

    new_project = _clone_row(original, uuid.uuid4(), name=new_name, created_by=created_by)
    db.add(new_project)

    # --- Periods (root scope container for Risk/Cost/ICD's own reporting
    # cycle — unrelated to Scheduling's ScheduleVariant/SchedulePeriod below
    # since the schedule-variants split, docs/SCHEDULE_VARIANTS_PLAN.md) ---
    periods = (await db.execute(select(Period).where(Period.project_id == project_id))).scalars().all()
    period_map = {p.id: uuid.uuid4() for p in periods}
    for p in periods:
        db.add(_clone_row(p, period_map[p.id], project_id=new_project.id))

    # --- Schedule variants + their schedule periods (root scope container
    # for Activity and its schedule-side siblings below) — every variant and
    # its full period history is cloned, not just the live one, matching
    # this being a full "everything" duplicate (per Maro) rather than
    # duplicate_schedule_variant's own lighter "fork the live schedule only"
    # scope (see app/services/schedule_variant.py). ---
    variants = (await db.execute(select(ScheduleVariant).where(ScheduleVariant.project_id == project_id))).scalars().all()
    variant_map = {v.id: uuid.uuid4() for v in variants}
    for v in variants:
        db.add(_clone_row(v, variant_map[v.id], project_id=new_project.id))

    schedule_periods = (await db.execute(
        select(SchedulePeriod).where(SchedulePeriod.schedule_variant_id.in_(variant_map.keys()))
    )).scalars().all() if variant_map else []
    schedule_period_map = {sp.id: uuid.uuid4() for sp in schedule_periods}
    for sp in schedule_periods:
        db.add(_clone_row(sp, schedule_period_map[sp.id], schedule_variant_id=variant_map[sp.schedule_variant_id]))

    # --- Calendars + breaks/exceptions ---
    calendars = (await db.execute(select(Calendar).where(Calendar.project_id == project_id))).scalars().all()
    calendar_map = {c.id: uuid.uuid4() for c in calendars}
    for c in calendars:
        db.add(_clone_row(c, calendar_map[c.id], project_id=new_project.id))

    if calendar_map:
        breaks = (await db.execute(
            select(CalendarBreak).where(CalendarBreak.calendar_id.in_(calendar_map.keys()))
        )).scalars().all()
        for b in breaks:
            db.add(_clone_row(b, uuid.uuid4(), calendar_id=calendar_map[b.calendar_id]))

        exceptions = (await db.execute(
            select(CalendarException).where(CalendarException.calendar_id.in_(calendar_map.keys()))
        )).scalars().all()
        for e in exceptions:
            db.add(_clone_row(e, uuid.uuid4(), calendar_id=calendar_map[e.calendar_id]))

    # --- Activities — self-referencing parent_id, so inserted with parent_id
    # left null first, then patched in a second pass once every cloned
    # activity's row already exists. Sidesteps needing to know (or trust)
    # whatever order SQLAlchemy's flush would otherwise pick for a self-
    # referential table full of brand-new, mutually-referencing rows. ---
    activities = (await db.execute(select(Activity).where(Activity.project_id == project_id))).scalars().all()
    activity_map = {a.id: uuid.uuid4() for a in activities}
    new_activities: dict[uuid.UUID, Activity] = {}
    for a in activities:
        clone = _clone_row(
            a, activity_map[a.id],
            project_id=new_project.id,
            schedule_variant_id=variant_map[a.schedule_variant_id],
            schedule_period_id=schedule_period_map[a.schedule_period_id],
            parent_id=None,
            calendar_id=calendar_map[a.calendar_id] if a.calendar_id is not None else None,
        )
        db.add(clone)
        new_activities[a.id] = clone
    if activities:
        await db.flush()
    for a in activities:
        if a.parent_id is not None:
            new_activities[a.id].parent_id = activity_map[a.parent_id]

    if activity_map:
        history = (await db.execute(
            select(ActivityCodeHistory).where(ActivityCodeHistory.activity_id.in_(activity_map.keys()))
        )).scalars().all()
        for h in history:
            db.add(_clone_row(h, uuid.uuid4(), activity_id=activity_map[h.activity_id]))

        relationships = (await db.execute(
            select(ActivityRelationship).where(ActivityRelationship.predecessor_id.in_(activity_map.keys()))
        )).scalars().all()
        for r in relationships:
            db.add(_clone_row(
                r, uuid.uuid4(),
                predecessor_id=activity_map[r.predecessor_id], successor_id=activity_map[r.successor_id],
            ))

    # --- Schedule baselines + their per-activity snapshots ---
    baselines = (await db.execute(
        select(ScheduleBaseline).where(ScheduleBaseline.schedule_period_id.in_(schedule_period_map.keys()))
    )).scalars().all() if schedule_period_map else []
    baseline_map = {b.id: uuid.uuid4() for b in baselines}
    for b in baselines:
        db.add(_clone_row(b, baseline_map[b.id], schedule_period_id=schedule_period_map[b.schedule_period_id]))

    if baseline_map:
        baseline_activities = (await db.execute(
            select(ScheduleBaselineActivity).where(ScheduleBaselineActivity.baseline_id.in_(baseline_map.keys()))
        )).scalars().all()
        for ba in baseline_activities:
            db.add(_clone_row(
                ba, uuid.uuid4(),
                baseline_id=baseline_map[ba.baseline_id], activity_id=activity_map[ba.activity_id],
            ))

    # --- Sub-projects (root_wbs_id needs the activity map; owning_party_org_id
    # is tenant-level and copied as-is, already handled by _clone_row) ---
    subprojects = (await db.execute(
        select(ScheduleSubproject).where(ScheduleSubproject.project_id == project_id)
    )).scalars().all()
    subproject_map = {sp.id: uuid.uuid4() for sp in subprojects}
    for sp in subprojects:
        db.add(_clone_row(
            sp, subproject_map[sp.id], project_id=new_project.id, root_wbs_id=activity_map[sp.root_wbs_id],
        ))

    # --- Saved Quality runs — report is a frozen JSONB blob embedding
    # schedule_period_id/scope_subproject_id as raw (string) UUIDs, not real
    # FKs to this row's own schedule_period_id/scope_subproject_id columns —
    # both rewritten here so a viewed saved run doesn't silently point back
    # at the ORIGINAL project's schedule period/sub-project. ---
    quality_runs = (await db.execute(
        select(SchedulingQualityRun).where(SchedulingQualityRun.schedule_period_id.in_(schedule_period_map.keys()))
    )).scalars().all() if schedule_period_map else []
    for qr in quality_runs:
        new_report = dict(qr.report)
        new_report["schedule_period_id"] = str(schedule_period_map[qr.schedule_period_id])
        old_scope_id = qr.scope_subproject_id
        new_report["scope_subproject_id"] = str(subproject_map[old_scope_id]) if old_scope_id is not None else None
        db.add(_clone_row(
            qr, uuid.uuid4(),
            schedule_period_id=schedule_period_map[qr.schedule_period_id],
            scope_subproject_id=subproject_map.get(old_scope_id) if old_scope_id is not None else None,
            report=new_report,
        ))

    # --- Quality criteria, custom filters, saved Gantt layouts ---
    quality_criteria = (await db.execute(
        select(SchedulingQualityCriterion).where(SchedulingQualityCriterion.project_id == project_id)
    )).scalars().all()
    for qc in quality_criteria:
        db.add(_clone_row(qc, uuid.uuid4(), project_id=new_project.id))

    filters = (await db.execute(select(SchedulingFilter).where(SchedulingFilter.project_id == project_id))).scalars().all()
    for f in filters:
        db.add(_clone_row(f, uuid.uuid4(), project_id=new_project.id))

    layouts = (await db.execute(select(GanttLayout).where(GanttLayout.project_id == project_id))).scalars().all()
    for gl in layouts:
        # letterhead_snapshot is a point-in-time copy of the letterhead as it
        # was when this layout was saved — preserved verbatim except for its
        # own embedded project_id, not re-derived from the (possibly
        # since-edited) current live letterhead.
        new_snapshot = dict(gl.letterhead_snapshot)
        new_snapshot["project_id"] = str(new_project.id)
        db.add(_clone_row(gl, uuid.uuid4(), project_id=new_project.id, letterhead_snapshot=new_snapshot))

    # --- Resources + assignments ---
    resources = (await db.execute(select(Resource).where(Resource.project_id == project_id))).scalars().all()
    resource_map = {r.id: uuid.uuid4() for r in resources}
    for r in resources:
        db.add(_clone_row(r, resource_map[r.id], project_id=new_project.id))

    if activity_map and resource_map:
        assignments = (await db.execute(
            select(ResourceAssignment).where(ResourceAssignment.activity_id.in_(activity_map.keys()))
        )).scalars().all()
        for ra in assignments:
            db.add(_clone_row(
                ra, uuid.uuid4(),
                activity_id=activity_map[ra.activity_id], resource_id=resource_map[ra.resource_id],
            ))

    # --- Risk: criteria, risks, mitigation actions ---
    for c in (await db.execute(select(RiskProbabilityCriterion).where(RiskProbabilityCriterion.project_id == project_id))).scalars().all():
        db.add(_clone_row(c, uuid.uuid4(), project_id=new_project.id))
    for c in (await db.execute(select(RiskImpactCriterion).where(RiskImpactCriterion.project_id == project_id))).scalars().all():
        db.add(_clone_row(c, uuid.uuid4(), project_id=new_project.id))

    risks = (await db.execute(select(Risk).where(Risk.project_id == project_id))).scalars().all()
    risk_map = {r.id: uuid.uuid4() for r in risks}
    for r in risks:
        db.add(_clone_row(r, risk_map[r.id], project_id=new_project.id, period_id=period_map[r.period_id]))

    if risk_map:
        mitigation_actions = (await db.execute(
            select(RiskMitigationAction).where(RiskMitigationAction.risk_id.in_(risk_map.keys()))
        )).scalars().all()
        for ma in mitigation_actions:
            db.add(_clone_row(ma, uuid.uuid4(), risk_id=risk_map[ma.risk_id]))

    # --- Cost: criteria, elements, rate lines, commitments ---
    for c in (await db.execute(select(CostVarianceCriterion).where(CostVarianceCriterion.project_id == project_id))).scalars().all():
        db.add(_clone_row(c, uuid.uuid4(), project_id=new_project.id))

    cost_elements = (await db.execute(select(CostElement).where(CostElement.project_id == project_id))).scalars().all()
    cost_element_map = {ce.id: uuid.uuid4() for ce in cost_elements}
    for ce in cost_elements:
        db.add(_clone_row(
            ce, cost_element_map[ce.id],
            project_id=new_project.id, period_id=period_map[ce.period_id],
            linked_activity_id=activity_map[ce.linked_activity_id] if ce.linked_activity_id is not None else None,
        ))

    if cost_element_map:
        rate_lines = (await db.execute(
            select(CostRateLine).where(CostRateLine.cost_element_id.in_(cost_element_map.keys()))
        )).scalars().all()
        for rl in rate_lines:
            db.add(_clone_row(rl, uuid.uuid4(), cost_element_id=cost_element_map[rl.cost_element_id]))

        commitments = (await db.execute(
            select(CostCommitment).where(CostCommitment.cost_element_id.in_(cost_element_map.keys()))
        )).scalars().all()
        for cm in commitments:
            db.add(_clone_row(cm, uuid.uuid4(), cost_element_id=cost_element_map[cm.cost_element_id]))

    # --- ICD: criteria, items, action items, comments ---
    for c in (await db.execute(select(IcdCriterion).where(IcdCriterion.project_id == project_id))).scalars().all():
        db.add(_clone_row(c, uuid.uuid4(), project_id=new_project.id))

    icd_items = (await db.execute(select(IcdItem).where(IcdItem.project_id == project_id))).scalars().all()
    icd_item_map = {it.id: uuid.uuid4() for it in icd_items}
    for it in icd_items:
        db.add(_clone_row(it, icd_item_map[it.id], project_id=new_project.id, period_id=period_map[it.period_id]))

    if icd_item_map:
        action_items = (await db.execute(
            select(IcdActionItem).where(IcdActionItem.icd_item_id.in_(icd_item_map.keys()))
        )).scalars().all()
        for ai in action_items:
            db.add(_clone_row(ai, uuid.uuid4(), icd_item_id=icd_item_map[ai.icd_item_id]))

        # author_id is a real user, kept as-is — the comment is still
        # genuinely "written by" that same person, same as IcdComment.author_name.
        comments = (await db.execute(
            select(IcdComment).where(IcdComment.icd_item_id.in_(icd_item_map.keys()))
        )).scalars().all()
        for cm in comments:
            db.add(_clone_row(cm, uuid.uuid4(), icd_item_id=icd_item_map[cm.icd_item_id]))

    # --- Letterhead (one row per project) ---
    letterhead = (await db.execute(
        select(ProjectLetterhead).where(ProjectLetterhead.project_id == project_id)
    )).scalar_one_or_none()
    if letterhead is not None:
        db.add(_clone_row(letterhead, uuid.uuid4(), project_id=new_project.id))

    # --- Reassessments — polymorphic (record_type, record_id), no DB FK at
    # all, so found by matching record_id against whichever of the three id
    # maps its record_type says it belongs to, not by any join. ---
    reassessment_lookup = {"risk": risk_map, "icd_item": icd_item_map, "cost_element": cost_element_map}
    for record_type, id_map in reassessment_lookup.items():
        if not id_map:
            continue
        rows = (await db.execute(
            select(Reassessment).where(Reassessment.record_type == record_type, Reassessment.record_id.in_(id_map.keys()))
        )).scalars().all()
        for row in rows:
            db.add(_clone_row(row, uuid.uuid4(), record_id=id_map[row.record_id]))

    # --- Record links — same "no DB FK, polymorphic (type, id)" shape as
    # Reassessment, but with two ends instead of one. issue/change/decision
    # are all really IcdItem rows (item_type discriminates further) so all
    # three source_type/target_type values map through icd_item_map.
    # created_by is a real user, kept as-is. ---
    type_to_map = {
        "activity": activity_map, "risk": risk_map, "cost_element": cost_element_map,
        "issue": icd_item_map, "change": icd_item_map, "decision": icd_item_map,
    }
    all_old_ids = set(activity_map) | set(risk_map) | set(cost_element_map) | set(icd_item_map)
    if all_old_ids:
        links = (await db.execute(
            select(RecordLink).where(or_(RecordLink.source_id.in_(all_old_ids), RecordLink.target_id.in_(all_old_ids)))
        )).scalars().all()
        for link in links:
            source_map = type_to_map.get(link.source_type)
            target_map = type_to_map.get(link.target_type)
            new_source_id = source_map.get(link.source_id) if source_map else None
            new_target_id = target_map.get(link.target_id) if target_map else None
            # Both ends must resolve within this project's own clone — a link
            # with one end elsewhere isn't this project's to safely duplicate.
            if new_source_id is None or new_target_id is None:
                continue
            db.add(_clone_row(link, uuid.uuid4(), source_id=new_source_id, target_id=new_target_id))

    await db.commit()
    await db.refresh(new_project)
    return new_project
