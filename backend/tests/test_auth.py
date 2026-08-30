from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

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


async def test_current_users_list_only_shows_approved_not_pending(client: AsyncClient, user: User, db):
    pending = User(
        org_id=user.org_id, email="still-pending@example.com", auth0_sub="auth0|still-pending",
        display_name="Still Pending", role="member", status="pending",
    )
    approved = User(
        org_id=user.org_id, email="another-approved@example.com", auth0_sub="auth0|another-approved",
        display_name="Another Approved", role="member", status="approved",
    )
    db.add_all([pending, approved])
    await db.commit()

    resp = await client.get("/api/v1/access-requests/users")
    assert resp.status_code == 200
    rows = resp.json()
    emails = [row["email"] for row in rows]
    assert "another-approved@example.com" in emails
    assert "still-pending@example.com" not in emails
    # `user` (the fixture's own super user, status="approved") shows up too
    assert user.email in emails
    assert all("total_active_seconds" in row for row in rows)


async def test_non_super_user_cannot_list_current_users(client: AsyncClient, user: User):
    user.is_super_user = False
    resp = await client.get("/api/v1/access-requests/users")
    assert resp.status_code == 403


async def test_display_name_heals_even_when_email_already_resolved(user: User, db, monkeypatch):
    # Regression (2026-08-27) — display_name healing used to be nested
    # inside the "does email need fixing" check, so a row whose *email* had
    # already healed on an earlier login (but predated this display_name
    # fix) never triggered the /userinfo call again at all, leaving
    # display_name stuck on the synthetic default forever. Real email,
    # synthetic display_name is exactly that scenario.
    import app.core.auth as auth_module
    from app.core.auth import TokenPayload, get_db_user

    user.email = "already-real@example.com"
    user.display_name = f"user+{user.auth0_sub.split('|')[-1]}@prosotapmo.local"
    await db.commit()

    monkeypatch.setattr(auth_module, "_fetch_userinfo_sync", lambda access_token: {"name": "Real Name"})

    token = TokenPayload(sub=user.auth0_sub, email=None, access_token="fake-token")
    healed = await get_db_user(token=token, db=db)
    assert healed.display_name == "Real Name"
    assert healed.email == "already-real@example.com"  # untouched, was already fine


async def test_last_active_at_set_on_first_request_and_throttled_after(user: User, db):
    # The `client` fixture overrides get_db_user entirely (returns the fixture's
    # `user` directly, see conftest.py), so it can't exercise get_db_user's own
    # body at all — calling the real function directly instead, the same way
    # its own self-heal logic above would need to be (nothing in this file
    # tests that either, a pre-existing gap, not one this test tries to close).
    from app.core.auth import TokenPayload, get_db_user

    token = TokenPayload(sub=user.auth0_sub, email=user.email)
    healed = await get_db_user(token=token, db=db)
    assert healed.last_active_at is not None
    first_seen = healed.last_active_at

    # A second call within the throttle window must NOT rewrite it — get_db_user's
    # own 5-minute throttle, not a bug if this stays equal.
    healed_again = await get_db_user(token=token, db=db)
    assert healed_again.last_active_at == first_seen

    # First-ever heartbeat has no prior last_active_at to measure a gap
    # against, so it shouldn't credit anything yet.
    assert healed.total_active_seconds == 0


async def test_total_active_seconds_accumulates_a_small_gap(user: User, db):
    from app.core.auth import TokenPayload, get_db_user

    user.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    user.total_active_seconds = 0
    await db.commit()

    token = TokenPayload(sub=user.auth0_sub, email=user.email)
    healed = await get_db_user(token=token, db=db)
    # ~10 minutes (600s) since the last heartbeat, comfortably inside the
    # 30-minute "plausibly still active" cap — credited close to in full,
    # allowing a little slack for real time elapsed during the test itself.
    assert 590 <= healed.total_active_seconds <= 630


async def test_total_active_seconds_caps_a_large_gap(user: User, db):
    from app.core.auth import TokenPayload, get_db_user

    user.last_active_at = datetime.now(timezone.utc) - timedelta(hours=2)
    user.total_active_seconds = 0
    await db.commit()

    token = TokenPayload(sub=user.auth0_sub, email=user.email)
    healed = await get_db_user(token=token, db=db)
    # A 2-hour gap means they were away, not continuously active — credited
    # only the throttle interval itself (5 minutes = 300s), not the full gap.
    assert healed.total_active_seconds == 300
