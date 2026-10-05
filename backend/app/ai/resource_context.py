"""Compact resource-planning context, independent of the 4D viewport."""
from sqlalchemy import select, func
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from app.models.activity import Activity
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.model_element_link import ModelElementLink
from app.models.model3d_file import Model3DFile

TOOL = {
    "name": "get_resource_planning_context",
    "description": "Read activities/WBS/durations/quantities, resource pool, existing assignments and saved IFC link summaries together before creating or assigning resources. Works for manual, brief-generated and imported schedules: IFC is optional. Page using returned offsets; reuse real IDs and do not duplicate existing assignments. Saved IFC labels and measured schedule quantities are evidence; this does not inspect raw geometry or unlinked model elements.",
    "input_schema": {"type": "object", "properties": {
        key: {"type": "integer", "minimum": 0} for key in ("activity_offset", "resource_offset", "assignment_offset")
    }, "additionalProperties": False},
}

async def get_context(db, project_id, schedule_id, activity_offset=0, resource_offset=0, assignment_offset=0):
    for value in (activity_offset, resource_offset, assignment_offset):
        if not isinstance(value, int) or value < 0: raise HTTPException(422, "Invalid page offset")
    if schedule_id is None: return {"error": "Select a schedule first; resources cannot be assigned without activities."}
    fields = ("id", "code", "task_name", "parent_id", "wbs_path", "activity_type", "duration_hours", "start", "finish", "calendar_id", "commentary", "schedule_category", "schedule_phase_key", "schedule_quantity", "schedule_material_name", "schedule_material_quantity", "schedule_material_unit")
    activities = (await db.execute(select(*(getattr(Activity, f) for f in fields)).where(
        Activity.project_id == project_id, Activity.schedule_period_id == schedule_id, Activity.is_archived.is_(False)
    ).order_by(Activity.id).offset(activity_offset).limit(51))).mappings().all()
    resource_fields = ("id", "name", "resource_type", "role", "unit", "rate", "max_hours_per_day", "calendar_id", "members")
    resources = (await db.execute(select(*(getattr(Resource, f) for f in resource_fields)).where(
        Resource.project_id == project_id).order_by(Resource.id).offset(resource_offset).limit(101))).mappings().all()
    assignments = (await db.execute(select(ResourceAssignment.id, ResourceAssignment.activity_id,
        ResourceAssignment.resource_id, ResourceAssignment.role, ResourceAssignment.quantity, ResourceAssignment.utilisation_pct)
        .join(Activity, ResourceAssignment.activity_id == Activity.id)
        .where(Activity.project_id == project_id, Activity.schedule_period_id == schedule_id, Activity.is_archived.is_(False))
        .order_by(ResourceAssignment.id).offset(assignment_offset).limit(501))).mappings().all()
    ids = [a["id"] for a in activities[:50]]
    links = (await db.execute(select(ModelElementLink.activity_id, func.count().label("element_count"),
        func.min(ModelElementLink.element_label).label("example_label"))
        .where(ModelElementLink.project_id == project_id, ModelElementLink.activity_id.in_(ids), ModelElementLink.source_kind == "ifc")
        .group_by(ModelElementLink.activity_id))).mappings().all() if ids else []
    model_count = (await db.execute(select(func.count()).select_from(Model3DFile).where(
        Model3DFile.project_id == project_id, Model3DFile.kind == "ifc"))).scalar_one()
    return jsonable_encoder({
        "activities": [dict(r) for r in activities[:50]], "resources": [dict(r) for r in resources[:100]],
        "assignments": [dict(r) for r in assignments[:500]], "ifc_links_for_activity_page": [dict(r) for r in links],
        "ifc_file_count": model_count,
        "next_activity_offset": activity_offset + 50 if len(activities) > 50 else None,
        "next_resource_offset": resource_offset + 100 if len(resources) > 100 else None,
        "next_assignment_offset": assignment_offset + 500 if len(assignments) > 500 else None,
        "guidance": "Use activity scope, hierarchy, duration and brief even without IFC categories. Reuse the pool; assign only missing pairs. If there are no activities, propose the schedule first. IFC links can outlive a removed file; never infer quantities from element counts. Crew members text is descriptive, not verified headcount capacity."
    })
