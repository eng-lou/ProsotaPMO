from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.activity import Activity
from app.models.project import Project
from app.models.resource_assignment import ResourceAssignment
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> list:
    result = await db.execute(
        select(Project).where(Project.org_id == current_user.org_id)
    )
    return list(result.scalars().all())


@router.post("/", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    project = Project(org_id=current_user.org_id, **data.model_dump())
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
    if project is None or project.org_id != current_user.org_id:
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
    if project is None or project.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
) -> Response:
    project = await db.get(Project, project_id)
    if project is None or project.org_id != current_user.org_id:
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
