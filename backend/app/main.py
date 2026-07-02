from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.activities import router as activities_router
from app.api.activity_relationships import router as activity_relationships_router
from app.api.calendar_breaks import router as calendar_breaks_router
from app.api.calendar_exceptions import router as calendar_exceptions_router
from app.api.calendars import router as calendars_router
from app.api.cost_commitments import router as cost_commitments_router
from app.api.cost_elements import router as cost_elements_router
from app.api.cost_rate_lines import router as cost_rate_lines_router
from app.api.cost_variance_criteria import router as cost_variance_criteria_router
from app.api.icd_action_items import router as icd_action_items_router
from app.api.icd_comments import router as icd_comments_router
from app.api.icd_criteria import router as icd_criteria_router
from app.api.icd_items import router as icd_items_router
from app.api.periods import router as periods_router
from app.api.projects import router as projects_router
from app.api.reassessments import router as reassessments_router
from app.api.record_links import router as record_links_router
from app.api.resource_assignments import router as resource_assignments_router
from app.api.resources import router as resources_router
from app.api.risk_criteria import router as risk_criteria_router
from app.api.risk_mitigation_actions import router as risk_mitigation_actions_router
from app.api.risks import router as risks_router
from app.api.scheduling_quality import router as scheduling_quality_router
from app.api.users import router as users_router
from app.core.auth import get_current_user

_auth = [Depends(get_current_user)]

app = FastAPI(title="ProsotaPMO API", version="0.1.0")

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
app.include_router(calendars_router, prefix="/api/v1", dependencies=_auth)
app.include_router(calendar_exceptions_router, prefix="/api/v1", dependencies=_auth)
app.include_router(calendar_breaks_router, prefix="/api/v1", dependencies=_auth)
app.include_router(scheduling_quality_router, prefix="/api/v1", dependencies=_auth)
app.include_router(resources_router, prefix="/api/v1", dependencies=_auth)
app.include_router(resource_assignments_router, prefix="/api/v1", dependencies=_auth)
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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
