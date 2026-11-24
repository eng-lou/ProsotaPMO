"""Repeat an authored WBS, retaining internal logic and rebinding matched IFC hosts."""
import re
import uuid
from collections import defaultdict

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.model_element_link import ModelElementLink
from app.models.project import Project
from app.services.activity import (_activity_role, _apply_computed_fields, _next_role_code,
                                  _recompute_hierarchy, _require_live_schedule_period)
from app.services.scheduling_cpm import _find_cycle, recompute_schedule


class HostMatch(BaseModel):
    ref: str = Field(min_length=1, max_length=255)
    label: str = Field(max_length=500)


class Floor(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    hosts: dict[str, HostMatch] = Field(default_factory=dict)


class RepeatCycle(BaseModel):
    project_id: uuid.UUID
    schedule_period_id: uuid.UUID
    source_wbs_id: uuid.UUID
    source_level: str = Field(min_length=1, max_length=150)
    floors: list[Floor] = Field(min_length=1, max_length=200)
    chain: bool = True


async def repeat_cycle(db, request):
    await db.scalar(select(Project.id).where(Project.id == request.project_id).with_for_update())
    period = await _require_live_schedule_period(db, request.schedule_period_id)
    rows = list((await db.scalars(select(Activity).where(
        Activity.project_id == request.project_id, Activity.schedule_period_id == period.id
    ).order_by(Activity.sort_order, Activity.id))).all())
    source = next((a for a in rows if a.id == request.source_wbs_id and a.activity_type == 'wbs_summary'), None)
    if not source:
        raise HTTPException(422, 'Choose a source WBS in the live schedule.')
    children = defaultdict(list)
    for a in rows:
        children[a.parent_id].append(a)
    template = []
    def walk(node):
        template.append(node)
        for child in children[node.id]:
            walk(child)
    walk(source)
    originals = {a.id for a in template}
    leaf_ids = {a.id for a in template if a.activity_type != 'wbs_summary'}
    if not leaf_ids:
        raise HTTPException(422, 'The source floor has no activities.')
    relations = list((await db.scalars(select(ActivityRelationship).join(
        Activity, Activity.id == ActivityRelationship.predecessor_id
    ).where(Activity.schedule_period_id == period.id))).all())
    internal = [r for r in relations if r.predecessor_id in leaf_ids and r.successor_id in leaf_ids]
    edges = {(r.predecessor_id, r.successor_id, r.relationship_type) for r in relations}
    entered = leaf_ids - {r.successor_id for r in internal}
    exited = leaf_ids - {r.predecessor_id for r in internal}
    links = list((await db.scalars(select(ModelElementLink).join(Activity).where(
        Activity.schedule_period_id == period.id, ModelElementLink.source_kind == 'ifc'
    ))).all())
    source_links = [link for link in links if link.activity_id in leaf_ids]
    linked = {(l.activity_id, l.element_ref) for l in links}
    previous = {i:i for i in leaf_ids}
    names = {source.task_name.strip().casefold(), request.source_level.strip().casefold()}
    created = reused = new_links = 0

    def connect(pred, succ, kind, lag):
        if (pred, succ, kind) not in edges:
            edges.add((pred,succ,kind))
            db.add(ActivityRelationship(id=uuid.uuid4(), predecessor_id=pred, successor_id=succ,
                                       relationship_type=kind, lag_hours=lag))

    for floor in request.floors:
        name = floor.name.strip()
        if not name or name.casefold() in names:
            raise HTTPException(422, 'Each destination floor must be different from the source and other destinations.')
        names.add(name.casefold())
        ids = {}
        for a in template:
            parent = source.parent_id if a is source else ids[a.parent_id]
            label = name if a is source else re.sub(r'(?<![a-zA-Z0-9_])'+re.escape(request.source_level)+r'(?![a-zA-Z0-9_])',lambda _:name,a.task_name,flags=re.I)
            found = [n for n in children[parent] if n.task_name.strip().casefold()==label.strip().casefold()]
            if len(found)>1 or (found and (found[0].activity_type!=a.activity_type or found[0].id in originals or found[0].id in ids.values())):
                raise HTTPException(422, 'Ambiguous destination activity: '+label)
            if found:
                dest = found[0]
                reused += 1
            else:
                role = _activity_role(a.activity_type, parent)
                dest = Activity(id=uuid.uuid4(), project_id=request.project_id, schedule_period_id=period.id,
                    schedule_variant_id=period.schedule_variant_id, parent_id=parent, activity_type=a.activity_type,
                    code=await _next_role_code(db,request.project_id,role), wbs_role=role,
                    sort_order=max((n.sort_order or 0 for n in children[parent]), default=-1)+1,
                    task_name=label, duration_hours=a.duration_hours, calendar_id=a.calendar_id,
                    schedule_category=a.schedule_category, schedule_phase_key=a.schedule_phase_key)
                _apply_computed_fields(dest)
                db.add(dest)
                children[parent].append(dest)
                created += 1
            ids[a.id] = dest.id
        for r in internal:
            connect(ids[r.predecessor_id],ids[r.successor_id],r.relationship_type,r.lag_hours)
        if request.chain:
            for end in exited:
                for start in entered:
                    connect(previous[end],ids[start],'FS',0)
        for link in source_links:
            match = floor.hosts.get(link.element_ref)
            if match and match.ref!=link.element_ref and (ids[link.activity_id],match.ref) not in linked:
                db.add(ModelElementLink(id=uuid.uuid4(),project_id=request.project_id,activity_id=ids[link.activity_id],
                    source_kind='ifc',element_ref=match.ref,element_label=match.label,animation_profile_id=link.animation_profile_id))
                linked.add((ids[link.activity_id],match.ref))
                new_links += 1
        previous = ids
    graph = [(a,b) for a,b,_ in edges]
    if _find_cycle(graph,{n for pair in graph for n in pair}):
        raise HTTPException(422,'Repeating this sequence conflicts with existing logic. Review the floor links.')
    await db.flush()
    await _recompute_hierarchy(db,period.id)
    await recompute_schedule(db,period.id)
    await _recompute_hierarchy(db,period.id)
    return dict(created=created,reused=reused,links=new_links)
