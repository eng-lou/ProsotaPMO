from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.icd_item import IcdItem
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.risk import Risk
from app.services.cost_element import rollup_evm_from_totals
from app.services.dashboard import _live_schedule_spi, _resolve_bac_ac
from app.services.resource_costing import compute_assignment_budget_raw


async def get_project_snapshot(
    db: AsyncSession,
    project_id: uuid.UUID,
    schedule_period_id: uuid.UUID | None = None,
    period_id: uuid.UUID | None = None,
) -> dict:
    """The assistant's grounding tool (2026-08-31, extended same day per
    Maro: "educate poe... all modules including resourcing") — condensed
    cross-pillar stats so it can answer open questions without guessing.
    schedule_period_id scopes Activity/Resources (Schedule's own variant/
    period split — see Activity's own docstring; a ResourceAssignment has
    no period of its own, only an activity_id, so it's scoped through
    Activity here too); period_id scopes Cost/Risk/ICD (the shared periods
    table those three still use). Either may be omitted (e.g. the assistant
    opened outside a specific pillar's context) — that pillar's stats are
    simply left out
    rather than guessed at from some other period."""
    snapshot: dict = {"project_id": str(project_id)}

    if schedule_period_id is not None:
        activity_result = await db.execute(
            select(
                func.count(Activity.id),
                func.count(Activity.id).filter(Activity.is_critical.is_(True)),
                # "milestone" was never a real activity_type value (checked
                # directly in app/schemas/activity.py's own ActivityType
                # Literal — split into start_milestone/finish_milestone back
                # on 2026-07-07) — this filter matched zero rows from the
                # day it was written, which is exactly what produced Poe's
                # own wrong "0 milestones defined" report (caught 2026-08-31
                # by Maro cross-checking against the real M-0001..M-0003
                # rows in Scheduling — see dashboard.py's own
                # start_milestone/finish_milestone check for the same
                # pattern this now matches).
                func.count(Activity.id).filter(Activity.activity_type.in_(("start_milestone", "finish_milestone"))),
                func.avg(Activity.pct_complete),
                # Project start/finish (2026-08-31, per Maro's own report: asked
                # for "the substantial completion or planned finish date" and
                # Poe had no date field at all to answer from, even though the
                # schedule clearly has one — see Activity's own docstring:
                # start/finish are CPM-computed, never a manual input, so
                # MIN/MAX across every real (non-summary, non-archived)
                # activity in this schedule *is* the project's own start/
                # finish — the same rollup wbs_summary rows already display).
                func.min(Activity.start),
                func.max(Activity.finish),
            ).where(
                Activity.schedule_period_id == schedule_period_id,
                Activity.activity_type != "wbs_summary",
                Activity.is_archived.is_(False),
            )
        )
        total, critical_count, milestone_count, avg_pct, project_start, project_finish = activity_result.one()
        critical_names_result = await db.execute(
            select(Activity.task_name).where(
                Activity.schedule_period_id == schedule_period_id,
                Activity.is_critical.is_(True),
                Activity.is_archived.is_(False),
            ).order_by(Activity.wbs_path).limit(20)
        )
        # Named milestones + their own dates (2026-08-31, same report as
        # above) — separate from milestone_count, which only ever counted
        # them; a question like "what's Substantial Completion's date"
        # needs the actual name/date pairs, not just how many there are.
        milestones_result = await db.execute(
            select(Activity.task_name, Activity.finish).where(
                Activity.schedule_period_id == schedule_period_id,
                Activity.activity_type.in_(("start_milestone", "finish_milestone")),
                Activity.is_archived.is_(False),
            ).order_by(Activity.finish)
        )
        snapshot["schedule"] = {
            "activity_count": total,
            "critical_activity_count": critical_count,
            "milestone_count": milestone_count,
            "avg_pct_complete": float(avg_pct) if avg_pct is not None else None,
            "critical_activity_names": [row[0] for row in critical_names_result.all()],
            "project_start": project_start.date().isoformat() if project_start is not None else None,
            "project_finish": project_finish.date().isoformat() if project_finish is not None else None,
            "milestones": [
                {"name": name, "finish": finish.date().isoformat() if finish is not None else None}
                for name, finish in milestones_result.all()
            ],
        }

        # Resources (2026-08-31, per Maro: "educate poe... all modules
        # including resourcing" — Poe's own prior answer had to admit it
        # had nothing here at all and fall back to inferring a likely
        # constraint from activity *names*, not real assignment data).
        # Reuses compute_assignment_budget (app/services/resource_costing.py)
        # verbatim — the exact same per-assignment cost formula Resource
        # Usage/Tracking already show — rather than a second, independently
        # -invented one. Scoped through Activity.schedule_period_id (a
        # ResourceAssignment has no period of its own, only an activity_id)
        # so this reads the same schedule variant everything else here does.
        # "Most committed" ranks by total assigned cost, not headcount or
        # assignment count alone — a single subcontractor lump sum can
        # dwarf a dozen small labour assignments, and cost is what actually
        # answers "which resource matters most." Day-by-day
        # loading/over-allocation is deliberately NOT attempted here — this
        # app's own Controls Dashboard already flags that as needing real
        # captured-over-time usage data it doesn't have yet, not something
        # a single live query can produce; scoped down to what's actually
        # answerable from today's data.
        assignment_rows = (await db.execute(
            select(ResourceAssignment, Resource, Activity)
            .join(Resource, ResourceAssignment.resource_id == Resource.id)
            .join(Activity, ResourceAssignment.activity_id == Activity.id)
            .where(Activity.schedule_period_id == schedule_period_id, Activity.is_archived.is_(False))
        )).all()
        resource_totals: dict[uuid.UUID, dict] = {}
        for assignment, resource, activity in assignment_rows:
            entry = resource_totals.setdefault(resource.id, {
                "name": resource.name, "resource_type": resource.resource_type,
                "assignment_count": 0, "total_committed_cost": Decimal(0),
            })
            entry["assignment_count"] += 1
            # Raw (unrounded) per assignment, rounded once at this resource's
            # own total — see compute_assignment_budget_raw's own header on
            # why summing already-rounded lines drifts off the real total.
            entry["total_committed_cost"] += compute_assignment_budget_raw(resource, activity, assignment)
        top_committed = sorted(resource_totals.values(), key=lambda r: r["total_committed_cost"], reverse=True)[:10]
        snapshot["resources"] = {
            "resource_count": len(resource_totals),
            "assignment_count": len(assignment_rows),
            "top_committed": [
                {
                    "name": r["name"], "resource_type": r["resource_type"],
                    "assignment_count": r["assignment_count"],
                    "total_committed_cost": float(r["total_committed_cost"].quantize(Decimal("0.01"))),
                }
                for r in top_committed
            ],
        }

    if period_id is not None:
        # Cost/EVM (2026-08-31, per Maro: "educate poe... all modules") —
        # reuses _live_schedule_spi/_resolve_bac_ac (app/services/dashboard.py,
        # already imported there from cost_element.py) and
        # rollup_evm_from_totals verbatim: the *exact* portfolio BAC/AC/EV
        # rollup and SPI/CPI/EAC formulas the Controls Dashboard's own KPI
        # strip computes, never a second, independently-derived version —
        # summed first, then run through one shared rollup (never averaging
        # per-element CPIs — see that function's own docstring on why that
        # misrepresents which cost line actually drives the real number).
        # None across the board when there's no cost-linked data yet ("leave
        # it blank rather than show a fake number", this app's own rule
        # everywhere else), not a guessed 0/100%.
        schedule_spi, cost_elements = await _live_schedule_spi(db, project_id, period_id)
        bac_total = ac_total = ev_cost_total = Decimal(0)
        has_cost_evm = False
        for el in cost_elements:
            bac, ac = _resolve_bac_ac(el)
            if bac is None:
                continue
            has_cost_evm = True
            bac_total += bac
            if ac is not None:
                ac_total += ac
            if el.pct_complete is not None:
                ev_cost_total += bac * Decimal(el.pct_complete) / Decimal(100)
        cost_rollup = rollup_evm_from_totals(bac_total, ac_total, None, ev_cost_total) if has_cost_evm else {}
        snapshot["cost"] = {
            "bac": float(bac_total) if has_cost_evm else None,
            "ac": float(ac_total) if has_cost_evm else None,
            "eac": float(cost_rollup["eac"]) if cost_rollup.get("eac") is not None else None,
            "cpi": float(cost_rollup["cpi"]) if cost_rollup.get("cpi") is not None else None,
            "spi": float(schedule_spi) if schedule_spi is not None else None,
        }

        risk_result = await db.execute(
            select(
                func.count(Risk.id),
                func.count(Risk.id).filter(Risk.status == "open"),
                func.sum(Risk.emv_cost).filter(Risk.risk_type == "threat", Risk.status == "open"),
                func.sum(Risk.emv_cost).filter(Risk.risk_type == "opportunity", Risk.status == "open"),
            ).where(Risk.project_id == project_id, Risk.period_id == period_id)
        )
        risk_total, open_count, threat_emv, opportunity_emv = risk_result.one()
        snapshot["risk"] = {
            "risk_count": risk_total,
            "open_risk_count": open_count,
            "open_threat_emv_cost": float(-threat_emv) if threat_emv is not None else 0.0,
            "open_opportunity_emv_cost": float(opportunity_emv) if opportunity_emv is not None else 0.0,
        }

        icd_result = await db.execute(
            select(
                IcdItem.item_type,
                func.count(IcdItem.id),
            ).where(
                IcdItem.project_id == project_id, IcdItem.period_id == period_id, IcdItem.status == "open",
            ).group_by(IcdItem.item_type)
        )
        snapshot["icd"] = {"open_by_type": {item_type: count for item_type, count in icd_result.all()}}

    return snapshot
