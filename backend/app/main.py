from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.activities import router as activities_router
from app.api.activity_relationships import router as activity_relationships_router
from app.api.activity_steps import router as activity_steps_router
from app.api.animation_profiles import router as animation_profiles_router
from app.api.calendar_breaks import router as calendar_breaks_router
from app.api.calendar_exceptions import router as calendar_exceptions_router
from app.api.calendars import router as calendars_router
from app.api.camera_views import router as camera_views_router
from app.api.collection_members import router as collection_members_router
from app.api.collections import router as collections_router
from app.api.cost_commitments import router as cost_commitments_router
from app.api.cost_elements import router as cost_elements_router
from app.api.cost_rate_lines import router as cost_rate_lines_router
from app.api.cost_variance_criteria import router as cost_variance_criteria_router
from app.api.dock_layouts import router as dock_layouts_router
from app.api.element_keyframes import router as element_keyframes_router
from app.api.element_transforms import router as element_transforms_router
from app.api.icd_action_items import router as icd_action_items_router
from app.api.icd_comments import router as icd_comments_router
from app.api.icd_criteria import router as icd_criteria_router
from app.api.icd_items import router as icd_items_router
from app.api.gantt_layouts import router as gantt_layouts_router
from app.api.material_presets import router as material_presets_router
from app.api.model3d_files import router as model3d_files_router
from app.api.model_element_links import router as model_element_links_router
from app.api.periods import router as periods_router
from app.api.project_letterhead import router as project_letterhead_router
from app.api.projects import router as projects_router
from app.api.reassessments import router as reassessments_router
from app.api.record_links import router as record_links_router
from app.api.resource_assignments import router as resource_assignments_router
from app.api.resource_assignment_spreads import router as resource_assignment_spreads_router
from app.api.resources import router as resources_router
from app.api.risk_criteria import router as risk_criteria_router
from app.api.risk_mitigation_actions import router as risk_mitigation_actions_router
from app.api.risks import router as risks_router
from app.api.schedule_baselines import router as schedule_baselines_router
from app.api.schedule_periods import router as schedule_periods_router
from app.api.schedule_subprojects import router as schedule_subprojects_router
from app.api.schedule_variants import router as schedule_variants_router
from app.api.scheduling_filters import router as scheduling_filters_router
from app.api.scheduling_highlights import router as scheduling_highlights_router
from app.api.scheduling_quality import router as scheduling_quality_router
from app.api.scheduling_quality_criteria import router as scheduling_quality_criteria_router
from app.api.scheduling_quality_runs import router as scheduling_quality_runs_router
from app.api.section_boxes import router as section_boxes_router
from app.api.user_defined_fields import router as user_defined_fields_router
from app.api.users import router as users_router
from app.core.auth import get_current_user

_auth = [Depends(get_current_user)]

app = FastAPI(title="Prosota API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router, prefix="/api/v1", dependencies=_auth)
app.include_router(projects_router, prefix="/api/v1", dependencies=_auth)
app.include_router(periods_router, prefix="/api/v1", dependencies=_auth)
app.include_router(activities_router, prefix="/api/v1", dependencies=_auth)
app.include_router(activity_relationships_router, prefix="/api/v1", dependencies=_auth)
app.include_router(activity_steps_router, prefix="/api/v1", dependencies=_auth)
app.include_router(calendars_router, prefix="/api/v1", dependencies=_auth)
app.include_router(calendar_exceptions_router, prefix="/api/v1", dependencies=_auth)
app.include_router(calendar_breaks_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_quality_router, prefix="/api/v1", dependencies=_auth)
app.include_router(resources_router, prefix="/api/v1", dependencies=_auth)
app.include_router(resource_assignments_router, prefix="/api/v1", dependencies=_auth)
app.include_router(resource_assignment_spreads_router, prefix="/api/v1", dependencies=_auth)
app.include_router(risks_router, prefix="/api/v1", dependencies=_auth)
app.include_router(risk_mitigation_actions_router, prefix="/api/v1", dependencies=_auth)
app.include_router(risk_criteria_router, prefix="/api/v1", dependencies=_auth)
app.include_router(record_links_router, prefix="/api/v1", dependencies=_auth)
app.include_router(cost_elements_router, prefix="/api/v1", dependencies=_auth)
app.include_router(cost_variance_criteria_router, prefix="/api/v1", dependencies=_auth)
app.include_router(cost_rate_lines_router, prefix="/api/v1", dependencies=_auth)
app.include_router(cost_commitments_router, prefix="/api/v1", dependencies=_auth)
app.include_router(icd_items_router, prefix="/api/v1", dependencies=_auth)
app.include_router(icd_criteria_router, prefix="/api/v1", dependencies=_auth)
app.include_router(icd_action_items_router, prefix="/api/v1", dependencies=_auth)
app.include_router(icd_comments_router, prefix="/api/v1", dependencies=_auth)
app.include_router(reassessments_router, prefix="/api/v1", dependencies=_auth)
app.include_router(schedule_baselines_router, prefix="/api/v1", dependencies=_auth)
app.include_router(project_letterhead_router, prefix="/api/v1", dependencies=_auth)
app.include_router(gantt_layouts_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_quality_criteria_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_quality_runs_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_filters_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_highlights_router, prefix="/api/v1", dependencies=_auth)
app.include_router(schedule_subprojects_router, prefix="/api/v1", dependencies=_auth)
app.include_router(schedule_variants_router, prefix="/api/v1", dependencies=_auth)
app.include_router(schedule_periods_router, prefix="/api/v1", dependencies=_auth)
app.include_router(user_defined_fields_router, prefix="/api/v1", dependencies=_auth)
app.include_router(model_element_links_router, prefix="/api/v1", dependencies=_auth)
app.include_router(dock_layouts_router, prefix="/api/v1", dependencies=_auth)
app.include_router(animation_profiles_router, prefix="/api/v1", dependencies=_auth)
app.include_router(element_keyframes_router, prefix="/api/v1", dependencies=_auth)
app.include_router(material_presets_router, prefix="/api/v1", dependencies=_auth)
app.include_router(model3d_files_router, prefix="/api/v1", dependencies=_auth)
app.include_router(section_boxes_router, prefix="/api/v1", dependencies=_auth)
app.include_router(camera_views_router, prefix="/api/v1", dependencies=_auth)
app.include_router(collections_router, prefix="/api/v1", dependencies=_auth)
app.include_router(collection_members_router, prefix="/api/v1", dependencies=_auth)
app.include_router(element_transforms_router, prefix="/api/v1", dependencies=_auth)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
