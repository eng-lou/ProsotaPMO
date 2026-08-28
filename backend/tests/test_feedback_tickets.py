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
