from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.cost_element import CostElement
from app.models.icd_item import IcdItem
from app.models.record_link import RecordLink
from app.models.resource import Resource
from app.models.risk import Risk
from app.services.record_link import list_links

# find_records + explain_causal_baseline (2026-09-01, per Maro: "in one run
# include all the server/proposal and client tools needed") — both exist to
# close a real gap the propose_link_records research turned up: RecordLink's
# own source_id/target_id are real UUIDs of *existing* records (see
# record_link.py's own docstring — deliberately not FK-constrained, but
# still real foreign references, never invented), and get_project_snapshot
# only ever returns *names* for anything outside risk/ICD counts. Poe has
# no way to propose a link, or explain one, without first resolving a name
# to the real ID behind it — same "never guess an ID" rule this whole
# module already follows, just applied to a lookup step instead of a
# create.

# Per-type (id, display-name) column pairs — the one thing that
# legitimately differs by record_type; every query below is otherwise the
# same shape (search box vs pull-full-name).
_NAME_COLUMN = {
    "risk": Risk.title,
    "cost_element": CostElement.description,
    "issue": IcdItem.title,
    "change": IcdItem.title,
    "decision": IcdItem.title,
}


async def find_records(
    db: AsyncSession,
    project_id: uuid.UUID,
    record_type: str,
    query: str,
    schedule_period_id: uuid.UUID | None,
    period_id: uuid.UUID | None,
) -> dict:
    """Name/title search -> real (id, name) pairs, scoped to whichever
    period this record_type actually lives in — activities scope by
    schedule_period_id (Schedule's own variant/period split, same as
    get_project_snapshot), everything else by the shared period_id.
    Returns an empty match list (not an error) when the relevant period
    isn't in scope at all, e.g. asked for an activity outside the 4D/
    Scheduling context — nothing to search, not a failure."""
    like = f"%{query}%"

    if record_type == "activity":
        if schedule_period_id is None:
            return {"record_type": record_type, "matches": []}
        rows = (await db.execute(
            select(Activity.id, Activity.task_name).where(
                Activity.schedule_period_id == schedule_period_id,
                Activity.task_name.ilike(like),
                Activity.is_archived.is_(False),
            ).limit(20)
        )).all()
        return {"record_type": record_type, "matches": [{"id": str(i), "name": n} for i, n in rows]}

    if record_type == "resource":
        # Resource (2026-09-02, per Maro: "can poe also work on resources")
        # — project_id-scoped only, no period concept (see resource.py's own
        # docstring: "a reusable, project-scoped resource pool entry"),
        # unlike everything else find_records handles, which is why this
        # gets its own branch rather than joining _NAME_COLUMN's
        # period_id-scoped shape below.
        rows = (await db.execute(
            select(Resource.id, Resource.name).where(
                Resource.project_id == project_id, Resource.name.ilike(like),
            ).limit(20)
        )).all()
        return {"record_type": record_type, "matches": [{"id": str(i), "name": n} for i, n in rows]}

    if record_type not in _NAME_COLUMN:
        raise ValueError(f"Unknown record_type: {record_type}")
    if period_id is None:
        return {"record_type": record_type, "matches": []}

    name_col = _NAME_COLUMN[record_type]
    if record_type == "risk":
        stmt = select(Risk.id, name_col).where(
            Risk.project_id == project_id, Risk.period_id == period_id, name_col.ilike(like),
        )
    elif record_type == "cost_element":
        stmt = select(CostElement.id, name_col).where(
            CostElement.project_id == project_id, CostElement.period_id == period_id, name_col.ilike(like),
        )
    else:  # issue | change | decision — same table, item_type discriminates
        stmt = select(IcdItem.id, name_col).where(
            IcdItem.project_id == project_id, IcdItem.period_id == period_id,
            IcdItem.item_type == record_type, name_col.ilike(like),
        )
    rows = (await db.execute(stmt.limit(20))).all()
    return {"record_type": record_type, "matches": [{"id": str(i), "name": n} for i, n in rows]}


async def _resolve_names(db: AsyncSession, project_id: uuid.UUID, ids_by_type: dict[str, set[uuid.UUID]]) -> dict[tuple[str, str], str]:
    """One query per touched record_type, IN-filtered on exactly the ids
    explain_causal_baseline's own BFS actually visited — never a full-table
    scan, and never guesses a name for an id nothing else returned."""
    names: dict[tuple[str, str], str] = {}
    activity_ids = ids_by_type.get("activity")
    if activity_ids:
        rows = (await db.execute(select(Activity.id, Activity.task_name).where(Activity.id.in_(activity_ids)))).all()
        names.update({("activity", str(i)): n for i, n in rows})
    risk_ids = ids_by_type.get("risk")
    if risk_ids:
        rows = (await db.execute(select(Risk.id, Risk.title).where(Risk.id.in_(risk_ids)))).all()
        names.update({("risk", str(i)): n for i, n in rows})
    cost_ids = ids_by_type.get("cost_element")
    if cost_ids:
        rows = (await db.execute(select(CostElement.id, CostElement.description).where(CostElement.id.in_(cost_ids)))).all()
        names.update({("cost_element", str(i)): n for i, n in rows})
    icd_ids = ids_by_type.get("issue", set()) | ids_by_type.get("change", set()) | ids_by_type.get("decision", set())
    if icd_ids:
        rows = (await db.execute(select(IcdItem.id, IcdItem.item_type, IcdItem.title).where(IcdItem.id.in_(icd_ids)))).all()
        names.update({(item_type, str(i)): title for i, item_type, title in rows})
    return names


async def explain_causal_baseline(
    db: AsyncSession, project_id: uuid.UUID, record_type: str, record_id: uuid.UUID, max_depth: int = 3,
) -> dict:
    """Breadth-first walk of RecordLink edges starting at one record, up to
    max_depth hops. No existing causal-chain tracer to reuse (checked
    directly, 2026-09-01 — nothing under app/services/ does this), so this
    is a fresh, generic traversal rather than a specific "Issue -> Risk ->
    Activity" script — the real seeded data in this app today is entirely
    single-hop (issue/change/decision -> activity/cost_element, checked
    directly against the dev DB), so most real calls will return one edge,
    not a deep chain; the multi-hop capability is here for whenever richer
    linking data exists, not because today's data needs it.

    is_source tracks which side of the RecordLink row *this* BFS step's own
    node was on — needed only to find the *other* node to keep expanding
    from; every returned edge always reports its real source/target exactly
    as stored, regardless of which direction the walk discovered it from.
    """
    start = (record_type, record_id)
    visited: set[tuple[str, uuid.UUID]] = {start}
    frontier: list[tuple[str, uuid.UUID]] = [start]
    edges: list[dict] = []
    seen_link_ids: set[uuid.UUID] = set()

    for _ in range(max_depth):
        if not frontier:
            break
        next_frontier: list[tuple[str, uuid.UUID]] = []
        for rtype, rid in frontier:
            links: list[RecordLink] = await list_links(db, rtype, rid)
            for link in links:
                if link.id in seen_link_ids:
                    continue
                seen_link_ids.add(link.id)
                edges.append({
                    "source": {"type": link.source_type, "id": str(link.source_id)},
                    "target": {"type": link.target_type, "id": str(link.target_id)},
                    "link_type": link.link_type,
                    "note": link.note,
                })
                is_source = link.source_type == rtype and link.source_id == rid
                other = (link.target_type, link.target_id) if is_source else (link.source_type, link.source_id)
                if other not in visited:
                    visited.add(other)
                    next_frontier.append(other)
        frontier = next_frontier

    ids_by_type: dict[str, set[uuid.UUID]] = {}
    for rtype, rid in visited:
        ids_by_type.setdefault(rtype, set()).add(rid)
    names = await _resolve_names(db, project_id, ids_by_type)

    return {
        "start": {"type": record_type, "id": str(record_id), "name": names.get((record_type, str(record_id)))},
        "nodes": [
            {"type": rtype, "id": str(rid), "name": names.get((rtype, str(rid)))}
            for rtype, rid in visited
        ],
        "edges": [
            {**edge, "source": {**edge["source"], "name": names.get((edge["source"]["type"], edge["source"]["id"]))},
             "target": {**edge["target"], "name": names.get((edge["target"]["type"], edge["target"]["id"]))}}
            for edge in edges
        ],
    }


async def find_relationships(db: AsyncSession, activity_id: uuid.UUID) -> dict:
    """One activity's own real predecessor/successor links (2026-09-01, for
    propose_edit_relationships) — exists to close the same gap
    find_records/explain_causal_baseline exist for: "reassigning" a
    relationship is delete-then-recreate (ActivityRelationshipUpdate's own
    docstring — predecessor_id/successor_id aren't editable in place), so
    Poe needs a real relationship_id to delete before it can propose a
    replacement, never guessed or inferred from the two activity names
    alone. Returns both directions (this activity as predecessor, and as
    successor) since either could be the one a user means by "its
    relationship" without saying which."""
    activity = await db.get(Activity, activity_id)
    if activity is None:
        return {"activity_id": str(activity_id), "activity_name": None, "as_predecessor": [], "as_successor": []}

    rows = (await db.execute(
        select(
            ActivityRelationship.id, ActivityRelationship.predecessor_id, ActivityRelationship.successor_id,
            ActivityRelationship.relationship_type, ActivityRelationship.lag_hours,
        ).where(
            (ActivityRelationship.predecessor_id == activity_id) | (ActivityRelationship.successor_id == activity_id),
        )
    )).all()

    other_ids = {r.successor_id if r.predecessor_id == activity_id else r.predecessor_id for r in rows}
    other_names: dict[uuid.UUID, str] = {}
    if other_ids:
        name_rows = (await db.execute(select(Activity.id, Activity.task_name).where(Activity.id.in_(other_ids)))).all()
        other_names = dict(name_rows)

    as_predecessor, as_successor = [], []
    for r in rows:
        if r.predecessor_id == activity_id:
            as_predecessor.append({
                "relationship_id": str(r.id), "successor_id": str(r.successor_id),
                "successor_name": other_names.get(r.successor_id), "relationship_type": r.relationship_type,
                "lag_hours": float(r.lag_hours),
            })
        else:
            as_successor.append({
                "relationship_id": str(r.id), "predecessor_id": str(r.predecessor_id),
                "predecessor_name": other_names.get(r.predecessor_id), "relationship_type": r.relationship_type,
                "lag_hours": float(r.lag_hours),
            })
    return {
        "activity_id": str(activity_id), "activity_name": activity.task_name,
        "as_predecessor": as_predecessor, "as_successor": as_successor,
    }
