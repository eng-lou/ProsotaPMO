from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.user import User


async def test_health_requires_no_auth(raw_client: AsyncClient):
    resp = await raw_client.get("/health")
    assert resp.status_code == 200


async def test_protected_route_rejects_no_token(raw_client: AsyncClient):
    resp = await raw_client.get(f"/api/v1/activities/?project_id={uuid.uuid4()}")
    assert resp.status_code == 403  # HTTPBearer returns 403 when no credentials at all


async def test_protected_route_rejects_bad_token(raw_client: AsyncClient):
    resp = await raw_client.get(
        f"/api/v1/activities/?project_id={uuid.uuid4()}",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code == 401


async def test_authed_client_can_reach_protected_route(client: AsyncClient):
    # client fixture overrides auth — proves the override works end-to-end
    resp = await client.get(f"/api/v1/activities/?project_id={uuid.uuid4()}")
    assert resp.status_code == 200


async def test_pending_user_rejected_from_approved_gated_route(client: AsyncClient, user: User):
    # 2026-08-25 trial/beta access gate — a valid token from a not-yet-approved
    # user must still be turned away from the app-wide _auth_approved routers
    # (get_approved_user in app/core/auth.py), even though get_current_user
    # alone would happily accept the token.
    user.status = "pending"
    resp = await client.get(f"/api/v1/activities/?project_id={uuid.uuid4()}")
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "access_pending"


async def test_pending_user_can_still_reach_me_and_submit_access_request(client: AsyncClient, user: User):
    # The two exceptions to the approval gate (users_router, access_requests_router)
    # must stay reachable — otherwise a pending user could never see their own
    # status or actually ask for access.
    user.status = "pending"
    me_resp = await client.get("/api/v1/users/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["status"] == "pending"

    submit_resp = await client.post(
        "/api/v1/access-requests/",
        json={"name": "A New Person", "title": "Site Engineer", "organisation": "Acme Ltd"},
    )
    assert submit_resp.status_code == 200
    body = submit_resp.json()
    assert body["display_name"] == "A New Person"
    assert body["requested_title"] == "Site Engineer"
    assert body["requested_organisation"] == "Acme Ltd"
    assert body["requested_at"] is not None


async def test_non_super_user_cannot_list_or_approve_access_requests(client: AsyncClient, user: User):
    user.is_super_user = False
    list_resp = await client.get("/api/v1/access-requests/")
    assert list_resp.status_code == 403
    approve_resp = await client.post(f"/api/v1/access-requests/{uuid.uuid4()}/approve")
    assert approve_resp.status_code == 403
    deny_resp = await client.delete(f"/api/v1/access-requests/{uuid.uuid4()}")
    assert deny_resp.status_code == 403


async def test_super_user_can_list_and_approve_pending_requests(client: AsyncClient, user: User, db):
    pending = User(
        org_id=user.org_id,
        email="pending-person@example.com",
        auth0_sub="auth0|pending-person",
        display_name="Pending Person",
        role="member",
        status="pending",
        requested_title="PM",
    )
    db.add(pending)
    await db.commit()
    await db.refresh(pending)

    list_resp = await client.get("/api/v1/access-requests/")
    assert list_resp.status_code == 200
    emails = [row["email"] for row in list_resp.json()]
    assert "pending-person@example.com" in emails

    approve_resp = await client.post(f"/api/v1/access-requests/{pending.id}/approve")
    assert approve_resp.status_code == 200

    await db.refresh(pending)
    assert pending.status == "approved"


async def test_super_user_can_deny_a_pending_request(client: AsyncClient, user: User, db):
    pending = User(
        org_id=user.org_id,
        email="denied-person@example.com",
        auth0_sub="auth0|denied-person",
        display_name="Denied Person",
        role="member",
        status="pending",
    )
    db.add(pending)
    await db.commit()
    await db.refresh(pending)
    pending_id = pending.id

    deny_resp = await client.delete(f"/api/v1/access-requests/{pending_id}")
    assert deny_resp.status_code == 204

    assert await db.get(User, pending_id) is None


async def test_cannot_deny_an_already_approved_user(client: AsyncClient, user: User, db):
    approved = User(
        org_id=user.org_id,
        email="already-approved@example.com",
        auth0_sub="auth0|already-approved",
        display_name="Already Approved",
        role="member",
        status="approved",
    )
    db.add(approved)
    await db.commit()
    await db.refresh(approved)

    deny_resp = await client.delete(f"/api/v1/access-requests/{approved.id}")
    assert deny_resp.status_code == 400
