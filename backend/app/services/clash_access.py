from fastapi import HTTPException
from sqlalchemy import select
from app.models.project import Project
from app.models.clash_test import ClashTest
from app.models.collection import Collection

async def owned_project(db, project_id, user):
    project = await db.get(Project, project_id)
    if not project or project.created_by != user.id or project.org_id != user.org_id:
        raise HTTPException(404, "Project not found")
    return project

async def owned_test(db, test_id, user, lock=False):
    q = select(ClashTest).where(ClashTest.id == test_id)
    if lock:
        q = q.with_for_update()
    test = (await db.execute(q)).scalar_one_or_none()
    if not test:
        raise HTTPException(404, "Clash test not found")
    await owned_project(db, test.project_id, user)
    return test

async def check_collections(db, project_id, ids):
    for id in ids:
        collection = await db.get(Collection, id)
        if not collection or collection.project_id != project_id:
            raise HTTPException(422, "Both collections must belong to this project")
