from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.activity import Activity
from app.models.project import Project
from app.models.resource_assignment import ResourceAssignment
from app.schemas.project import ProjectCreate, ProjectDuplicateRequest, ProjectResponse, ProjectUpdate
from app.services import project as project_svc

router = APIRouter(prefix="/projects", tags=["projects"])

# 2026-08-25 (per Maro, alongside the trial/beta access gate) — projects are
# private to whoever created them: a super user reviewing access requests
# shouldn't incidentally see a normal user's project, so ownership is
# enforced for everyone alike, not just normal users. Only the CREATION cap
# below is role-gated — super users can create as many as they like, a
# normal (non-super) user is capped at this many of their own.
_NORMAL_USER_PROJECT_CAP = 2


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> list:
    result = await db.execute(
        select(Project).where(
            Project.org_id == current_user.org_id,
            Project.created_by == current_user.id,
        )
    )
    return list(result.scalars().all())


@router.post("/", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    if not current_user.is_super_user:
        count_result = await db.execute(
            select(func.count()).select_from(Project).where(Project.created_by == current_user.id)
        )
        if count_result.scalar_one() >= _NORMAL_USER_PROJECT_CAP:
            raise HTTPException(
                status_code=403,
                detail=f"You've reached the {_NORMAL_USER_PROJECT_CAP}-project limit for trial accounts.",
            )
    project = Project(org_id=current_user.org_id, created_by=current_user.id, **data.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id or project.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id or project.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.post("/{project_id}/duplicate", response_model=ProjectResponse, status_code=201)
async def duplicate_project(
    project_id: uuid.UUID,
    data: ProjectDuplicateRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    """A full, independent deep copy — see app/services/project.py:duplicate_project
    for exactly what's cloned (2026-07-06, per Maro: "in switch projects,
    allow me to duplicate a project"). The copy is owned by whoever duplicates
    it, so it counts against *their* cap (2026-08-25), not the original
    owner's."""
    original = await db.get(Project, project_id)
    if original is None or original.org_id != current_user.org_id or original.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    if not current_user.is_super_user:
        count_result = await db.execute(
            select(func.count()).select_from(Project).where(Project.created_by == current_user.id)
        )
        if count_result.scalar_one() >= _NORMAL_USER_PROJECT_CAP:
            raise HTTPException(
                status_code=403,
                detail=f"You've reached the {_NORMAL_USER_PROJECT_CAP}-project limit for trial accounts.",
            )
    new_name = data.name.strip() if data.name and data.name.strip() else f"{original.name} (Copy)"
    return await project_svc.duplicate_project(db, project_id, new_name, current_user.id)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> Response:
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id or project.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    # resource_assignments.resource_id is deliberately RESTRICT, not CASCADE (see
    # app/models/resource_assignment.py) — a backstop against deleting an in-use
    # Resource outside of a full project teardown. Clear assignments explicitly
    # here first so the cascade below can remove this project's resources too,
    # since ON DELETE CASCADE actions between sibling tables (activities,
    # resources) aren't guaranteed to fire in an order that would satisfy that
    # RESTRICT on its own.
    await db.execute(
        delete(ResourceAssignment).where(
            ResourceAssignment.activity_id.in_(
                select(Activity.id).where(Activity.project_id == project_id)
            )
        )
    )
    # Core-level delete, not db.delete(project) — the ORM's own relationship
    # cascade (Project.periods) would otherwise try to UPDATE child rows'
    # project_id to NULL before the DB's ON DELETE CASCADE ever runs, which
    # fails since project_id is NOT NULL. A plain DELETE statement bypasses
    # ORM relationship cascade management and leaves cleanup entirely to the
    # DB-level foreign keys added for this feature.
    await db.execute(delete(Project).where(Project.id == project_id))
    await db.commit()
    return Response(status_code=204)
