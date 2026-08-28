from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.auth import get_db_user
from app.main import app
from app.models.user import User


async def _create_ticket(client: AsyncClient, **overrides) -> dict:
    payload = {"subject": "Something's broken", "description": "Steps to reproduce...", **overrides}
    resp = await client.post("/api/v1/feedback-tickets/", json=payload)
    assert resp.status_code == 201, resp.json()
    return resp.json()


async def test_create_and_list_own_ticket(client: AsyncClient, user: User):
    ticket = await _create_ticket(client)
    assert ticket["subject"] == "Something's broken"
    assert ticket["status"] == "open"
    assert ticket["attachments"] == []
    assert ticket["reporter_email"] == user.email

    list_resp = await client.get("/api/v1/feedback-tickets/")
    assert list_resp.status_code == 200
    assert [t["id"] for t in list_resp.json()] == [ticket["id"]]


async def test_normal_user_only_sees_their_own_tickets(client: AsyncClient, other_user: User, user: User):
    await _create_ticket(client, subject="From the super user")

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        await _create_ticket(client, subject="From a normal user")
        list_resp = await client.get("/api/v1/feedback-tickets/")
        assert list_resp.status_code == 200
        subjects = [t["subject"] for t in list_resp.json()]
        assert subjects == ["From a normal user"]
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_super_user_sees_every_ticket(client: AsyncClient, other_user: User, user: User):
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        await _create_ticket(client, subject="From a normal user")
    finally:
        app.dependency_overrides[get_db_user] = lambda: user

    await _create_ticket(client, subject="From the super user")

    list_resp = await client.get("/api/v1/feedback-tickets/")
    assert list_resp.status_code == 200
    subjects = {t["subject"] for t in list_resp.json()}
    assert subjects == {"From a normal user", "From the super user"}


async def test_normal_user_cannot_update_status(client: AsyncClient, other_user: User, user: User):
    ticket = await _create_ticket(client)

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        resp = await client.patch(f"/api/v1/feedback-tickets/{ticket['id']}", json={"status": "closed"})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_super_user_can_update_status(client: AsyncClient):
    ticket = await _create_ticket(client)
    resp = await client.patch(f"/api/v1/feedback-tickets/{ticket['id']}", json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


async def test_status_change_recorded_as_an_event(client: AsyncClient, user: User):
    ticket = await _create_ticket(client)
    resp = await client.patch(f"/api/v1/feedback-tickets/{ticket['id']}", json={"status": "in_progress"})
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["kind"] == "status_change"
    assert events[0]["old_status"] == "open"
    assert events[0]["new_status"] == "in_progress"
    assert events[0]["author_email"] == user.email


async def test_setting_the_same_status_does_not_record_an_event(client: AsyncClient):
    ticket = await _create_ticket(client)
    resp = await client.patch(f"/api/v1/feedback-tickets/{ticket['id']}", json={"status": "open"})
    assert resp.json()["events"] == []


async def test_owner_and_super_user_can_both_comment(client: AsyncClient, other_user: User, user: User):
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        ticket = await _create_ticket(client)
        resp = await client.post(f"/api/v1/feedback-tickets/{ticket['id']}/comments", json={"body": "Here's more detail"})
        assert resp.status_code == 200
        assert resp.json()["events"][0]["body"] == "Here's more detail"
    finally:
        app.dependency_overrides[get_db_user] = lambda: user

    resp = await client.post(f"/api/v1/feedback-tickets/{ticket['id']}/comments", json={"body": "Thanks, looking into it"})
    assert resp.status_code == 200
    bodies = [e["body"] for e in resp.json()["events"]]
    assert bodies == ["Here's more detail", "Thanks, looking into it"]


async def test_unrelated_normal_user_cannot_comment_or_see_ticket(client: AsyncClient, other_user: User, user: User):
    ticket = await _create_ticket(client)  # owned by the super user (`user`)

    third = User(
        org_id=user.org_id, email="third@example.com", auth0_sub="auth0|third",
        display_name="Third", role="member", status="approved", is_super_user=False,
    )
    app.dependency_overrides[get_db_user] = lambda: third
    try:
        resp = await client.post(f"/api/v1/feedback-tickets/{ticket['id']}/comments", json={"body": "butting in"})
        assert resp.status_code == 404
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_unread_reflects_activity_since_last_viewed(client: AsyncClient, other_user: User, user: User):
    # Nothing yet.
    assert (await client.get("/api/v1/feedback-tickets/unread")).json() == {"has_unread": False}

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        await _create_ticket(client, subject="A new one")
    finally:
        app.dependency_overrides[get_db_user] = lambda: user

    # Super user hasn't looked yet — the new ticket from someone else counts.
    assert (await client.get("/api/v1/feedback-tickets/unread")).json() == {"has_unread": True}

    mark_resp = await client.post("/api/v1/feedback-tickets/mark-read")
    assert mark_resp.status_code == 200
    assert (await client.get("/api/v1/feedback-tickets/unread")).json() == {"has_unread": False}


async def test_normal_user_sees_unread_when_super_user_replies(client: AsyncClient, other_user: User, user: User):
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        ticket = await _create_ticket(client)
        assert (await client.get("/api/v1/feedback-tickets/unread")).json() == {"has_unread": False}
    finally:
        app.dependency_overrides[get_db_user] = lambda: user

    await client.post(f"/api/v1/feedback-tickets/{ticket['id']}/comments", json={"body": "Can you share a screenshot?"})

    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        assert (await client.get("/api/v1/feedback-tickets/unread")).json() == {"has_unread": True}
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_export_requires_super_user(client: AsyncClient, other_user: User, user: User):
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        resp = await client.get("/api/v1/feedback-tickets/export")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides[get_db_user] = lambda: user


async def test_export_returns_csv_of_all_events(client: AsyncClient):
    ticket = await _create_ticket(client, subject="Export me")
    await client.post(f"/api/v1/feedback-tickets/{ticket['id']}/comments", json={"body": "a note"})
    await client.patch(f"/api/v1/feedback-tickets/{ticket['id']}", json={"status": "closed"})

    resp = await client.get("/api/v1/feedback-tickets/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    body = resp.text
    assert "Export me" in body
    assert "a note" in body
    assert "status_change" in body
    assert "comment" in body


async def test_update_missing_ticket_404s(client: AsyncClient):
    resp = await client.patch(f"/api/v1/feedback-tickets/{uuid.uuid4()}", json={"status": "closed"})
    assert resp.status_code == 404


async def test_create_ticket_verifies_attachment_exists_in_storage(client: AsyncClient, monkeypatch):
    # No presigned upload actually happened for this key — head_object_size
    # should raise (mirrors what a real missing/expired R2 object does),
    # and the endpoint must turn that into a clean 400, not a 500.
    import app.services.object_storage as object_storage

    def _boom(key: str) -> int:
        raise Exception("NoSuchKey")

    monkeypatch.setattr(object_storage, "head_object_size", _boom)

    resp = await client.post("/api/v1/feedback-tickets/", json={
        "subject": "With a bogus attachment",
        "description": "...",
        "attachments": [{"key": "feedback-attachments/nope.png", "filename": "nope.png", "size_bytes": 1, "content_type": "image/png"}],
    })
    assert resp.status_code == 400


async def test_create_ticket_rejects_oversized_attachment(client: AsyncClient, monkeypatch):
    import app.services.object_storage as object_storage

    monkeypatch.setattr(object_storage, "head_object_size", lambda key: 26 * 1024 * 1024)

    resp = await client.post("/api/v1/feedback-tickets/", json={
        "subject": "Too big",
        "description": "...",
        "attachments": [{"key": "feedback-attachments/huge.png", "filename": "huge.png", "size_bytes": 1, "content_type": "image/png"}],
    })
    assert resp.status_code == 400
    assert "25MB" in resp.json()["detail"]


async def test_create_ticket_with_attachment_uses_authoritative_size(client: AsyncClient, monkeypatch):
    # Client-claimed size_bytes must never be trusted — same reasoning as
    # every other upload path in this app (object_storage.head_object_size's
    # own docstring).
    import app.services.object_storage as object_storage

    monkeypatch.setattr(object_storage, "head_object_size", lambda key: 12345)
    monkeypatch.setattr(object_storage, "presigned_get_url", lambda key, expires_in=3600: f"https://example.test/{key}")

    ticket = await _create_ticket(client, attachments=[
        {"key": "feedback-attachments/real.png", "filename": "real.png", "size_bytes": 1, "content_type": "image/png"},
    ])
    assert len(ticket["attachments"]) == 1
    assert ticket["attachments"][0]["size_bytes"] == 12345
    assert ticket["attachments"][0]["download_url"] == "https://example.test/feedback-attachments/real.png"
