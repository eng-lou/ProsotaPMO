from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.icd_item import IcdItem
from app.models.risk import Risk


async def get_project_snapshot(
    db: AsyncSession,
    project_id: uuid.UUID,
    schedule_period_id: uuid.UUID | None = None,
    period_id: uuid.UUID | None = None,
) -> dict:
    """The assistant's grounding tool (2026-08-31) — condensed cross-pillar
    stats so it can answer open questions without guessing. schedule_period_id
    scopes Activity (Schedule's own variant/period split — see Activity's own
    docstring); period_id scopes Risk/ICD (the shared periods table Cost/Risk/
    ICD still use). Either may be omitted (e.g. the assistant opened outside
    a specific pillar's context) — that pillar's stats are simply left out
    rather than guessed at from some other period."""
    snapshot: dict = {"project_id": str(project_id)}

    if schedule_period_id is not None:
        activity_result = await db.execute(
            select(
                func.count(Activity.id),
                func.count(Activity.id).filter(Activity.is_critical.is_(True)),
                func.count(Activity.id).filter(Activity.activity_type == "milestone"),
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
                Activity.activity_type == "milestone",
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

    if period_id is not None:
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
