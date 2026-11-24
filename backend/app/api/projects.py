from __future__ import annotations

import uuid
import json

from pydantic import BaseModel, Field
from app.services.project_materials import apply_material_changes

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.activity import Activity
from app.models.project import Project
from app.models.resource_assignment import ResourceAssignment
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectDuplicateRequest, ProjectResponse, ProjectUpdate
from app.services import project_copy
from app.services.project import check_project_capacity

router = APIRouter(prefix="/projects", tags=["projects"])

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
    await check_project_capacity(db, current_user)
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
    original = await db.get(Project, project_id)
    if original is None or original.org_id != current_user.org_id or original.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    target_id = uuid.uuid5(project_id, str(data.request_id)) if data.request_id else uuid.uuid4()
    if data.request_id:
        # A large duplicate may finish after the browser loses its response.
        # Check after taking the same owner lock as create/import, before the cap.
        await db.execute(select(User.id).where(User.id == current_user.id).with_for_update())
        existing = await db.get(Project, target_id)
        if existing is not None:
            return await get_project(target_id, db, current_user)
    await check_project_capacity(db, current_user)
    new_name = data.name.strip() if data.name and data.name.strip() else f"{original.name} (Copy)"
    return await project_copy.duplicate_project(db, project_id, target_id, new_name, current_user)


class RestoreProject3D(BaseModel):
    source_project_id: uuid.UUID


@router.post("/{project_id}/restore-3d")
async def restore_project_3d(
    project_id: uuid.UUID, data: RestoreProject3D, db: AsyncSession = Depends(get_db),
    current_user=Depends(get_db_user),
):
    await get_project(data.source_project_id, db, current_user)
    return await project_copy.restore_visuals(db, data.source_project_id, project_id, current_user)


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


class MaterialChange(BaseModel):
    before: str | None = None
    after: str | None = None


class MaterialEdit(BaseModel):
    seed: dict[str, str] | None = Field(default=None, max_length=50000)
    changes: dict[str, MaterialChange] = Field(default_factory=dict, max_length=50000)


@router.get("/{project_id}/materials")
async def get_materials(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_db_user)):
    project = await get_project(project_id, db, current_user)
    return {"mapping": project.material_mapping}


@router.patch("/{project_id}/materials")
async def edit_materials(project_id: uuid.UUID, data: MaterialEdit, db: AsyncSession = Depends(get_db), current_user=Depends(get_db_user)):
    if len(json.dumps(data.model_dump()).encode()) > 2 * 1024 * 1024:
        raise HTTPException(413, "Material assignments exceed the project limit")
    # Lock the owner row so two browsers cannot both pass the comparison then overwrite each other.
    project = (await db.execute(select(Project).where(Project.id == project_id).with_for_update())).scalar_one_or_none()
    if not project or project.org_id != current_user.org_id or project.created_by != current_user.id:
        raise HTTPException(404, "Project not found")
    try:
        mapping = apply_material_changes(project.material_mapping, data.seed,
            {key: change.model_dump() for key, change in data.changes.items()})
    except ValueError:
        raise HTTPException(409, "Materials changed in another browser. Your local copy has been retained.")
    project.material_mapping = mapping
    await db.commit()
    return {"mapping": mapping}
