from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.main import app
from app.models.organisation import Organisation
from app.models.project import Project
from app.models.user import User


async def _create(client: AsyncClient, **kwargs) -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": "Test Project", **kwargs})
    assert resp.status_code == 201, resp.json()
    return resp.json()


async def test_create_project(client: AsyncClient):
    p = await _create(client, client_name="Acme Corp")
    assert p["name"] == "Test Project"
    assert p["client_name"] == "Acme Corp"
    assert p["status"] == "active"


async def test_list_projects(client: AsyncClient):
    await _create(client, name="Project A")
    await _create(client, name="Project B")
    resp = await client.get("/api/v1/projects/")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_get_project(client: AsyncClient):
    p = await _create(client)
    resp = await client.get(f"/api/v1/projects/{p['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == p["id"]


async def test_get_project_not_found(client: AsyncClient):
    assert (await client.get(f"/api/v1/projects/{uuid.uuid4()}")).status_code == 404


async def test_update_project(client: AsyncClient):
    p = await _create(client)
    resp = await client.patch(f"/api/v1/projects/{p['id']}", json={"status": "archived"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"


async def test_delete_project(client: AsyncClient):
    p = await _create(client)
    assert (await client.delete(f"/api/v1/projects/{p['id']}")).status_code == 204
    assert (await client.get(f"/api/v1/projects/{p['id']}")).status_code == 404


async def test_projects_are_private_to_their_creator(client: AsyncClient, other_user: User, user: User):
    """2026-08-25 — projects stopped being org-wide shared: `user` (a super
    user) must not see or reach `other_user`'s project just by sharing an
    org, and vice versa isn't tested here only because `other_user` is the
    one under test in the cap tests below."""
    mine = await _create(client, name="Mine")

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        list_resp = await client.get("/api/v1/projects/")
        assert list_resp.json() == []
        assert (await client.get(f"/api/v1/projects/{mine['id']}")).status_code == 404
        assert (await client.patch(f"/api/v1/projects/{mine['id']}", json={"status": "archived"})).status_code == 404
        assert (await client.delete(f"/api/v1/projects/{mine['id']}")).status_code == 404
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_normal_user_capped_at_two_projects(client: AsyncClient, other_user: User, user: User):
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        await _create(client, name="P1")
        await _create(client, name="P2")
        third = await client.post("/api/v1/projects/", json={"name": "P3"})
        assert third.status_code == 403
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_super_user_not_capped(client: AsyncClient):
    await _create(client, name="P1")
    await _create(client, name="P2")
    third = await client.post("/api/v1/projects/", json={"name": "P3"})
    assert third.status_code == 201


async def test_duplicate_owned_by_duplicator_and_counts_against_their_cap(
    client: AsyncClient, other_user: User, user: User,
):
    original = await _create(client, name="Original")

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        # Not `other_user`'s project — duplicating it should 404, same as any
        # other cross-owner access, not silently succeed.
        dup_resp = await client.post(f"/api/v1/projects/{original['id']}/duplicate", json={})
        assert dup_resp.status_code == 404
    finally:
        app.dependency_overrides[get_db_user] = lambda: user

    dup_resp = await client.post(f"/api/v1/projects/{original['id']}/duplicate", json={})
    assert dup_resp.status_code == 201
    assert dup_resp.json()["created_by"] == str(user.id)


async def test_delete_project_with_real_data_cascades_cleanly(
    client: AsyncClient, project: Project, live_period, live_schedule_period
):
    """Regression test: a project with real cross-module data used to throw a
    Postgres IntegrityError on delete, since most tables referencing projects
    had no ON DELETE CASCADE. Covers the resource-assignment RESTRICT edge case
    too — that FK is deliberately left non-cascading (see
    app/models/resource_assignment.py), so the delete endpoint must clear
    assignments explicitly before the project-level cascade runs."""
    activity_resp = await client.post("/api/v1/activities/", json={
        "project_id": project.id.__str__(), "schedule_period_id": live_schedule_period.id.__str__(),
        "task_name": "Piling",
    })
    assert activity_resp.status_code == 201
    activity = activity_resp.json()

    resource_resp = await client.post("/api/v1/resources/", json={
        "project_id": project.id.__str__(), "resource_type": "labour", "name": "J. Davies", "unit": "day", "rate": "45",
    })
    assert resource_resp.status_code == 201
    resource = resource_resp.json()

    assignment_resp = await client.post("/api/v1/resource-assignments/", json={
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": "100",
    })
    assert assignment_resp.status_code == 201

    risk_resp = await client.post("/api/v1/risks/", json={
        "project_id": project.id.__str__(), "period_id": live_period.id.__str__(), "title": "Test risk",
    })
    assert risk_resp.status_code == 201

    resp = await client.delete(f"/api/v1/projects/{project.id}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/projects/{project.id}")).status_code == 404


async def test_get_me(client: AsyncClient, user: User):
    resp = await client.get("/api/v1/users/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == user.email
    assert resp.json()["role"] == "admin"


async def test_create_and_list_periods(client: AsyncClient):
    p = await _create(client)
    period_resp = await client.post("/api/v1/periods/", json={
        "project_id": p["id"],
        "period_label": "Period 1",
        "freeze_status": "live",
    })
    assert period_resp.status_code == 201

    list_resp = await client.get("/api/v1/periods/", params={"project_id": p["id"]})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["period_label"] == "Period 1"


async def test_bootstrap_period_creates_once_then_reuses(client: AsyncClient):
    """The stopgap 'auto-create Period 1' used to do find-or-create client-side,
    which raced under concurrent calls and could silently create two 'live'
    periods for the same brand-new project (real incident: two rows ~1.5ms
    apart, splitting that project's activities across both — see migration
    a3f9c02e5b71). The bootstrap endpoint does it as one atomic call instead;
    calling it twice for the same project must return the exact same period,
    not create a second one."""
    p = await _create(client)
    first = await client.post("/api/v1/periods/bootstrap", params={"project_id": p["id"]})
    assert first.status_code == 200
    second = await client.post("/api/v1/periods/bootstrap", params={"project_id": p["id"]})
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    list_resp = await client.get("/api/v1/periods/", params={"project_id": p["id"]})
    assert len(list_resp.json()) == 1


async def test_bootstrap_period_returns_existing_live_period(client: AsyncClient, project: Project, live_period):
    resp = await client.post("/api/v1/periods/bootstrap", params={"project_id": project.id.__str__()})
    assert resp.status_code == 200
    assert resp.json()["id"] == live_period.id.__str__()


async def test_only_one_live_period_allowed_per_project(db: AsyncSession, project: Project, live_period):
    """The DB-level guard behind bootstrap's race safety: a second 'live'
    period for the same project must be rejected outright, not silently
    accepted the way the two pre-existing rows were before this fix."""
    from sqlalchemy.exc import IntegrityError

    from app.models.period import Period

    dupe = Period(project_id=project.id, period_label="Period 1 (dupe)", freeze_status="live")
    db.add(dupe)
    with pytest.raises(IntegrityError):
        await db.commit()
