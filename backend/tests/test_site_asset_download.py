"""Restore library assets without an authenticated cross-origin redirect."""
import uuid
import pytest
from app.models.site_asset import SiteAsset
from app.services import object_storage


@pytest.mark.parametrize("status", ["ready", "archived", "pending"])
async def test_download_link_and_legacy_redirect(client, db, project, monkeypatch, status):
    ident = uuid.uuid4()
    row = SiteAsset(id=ident, project_id=project.id, name="Cube", category="Other",
                    storage_key=f"site-assets/{ident}.glb", upload_key=f"uploads/{ident}.glb",
                    status=status, size_bytes=100, dimensions={})
    db.add(row)
    await db.commit()
    signed = "https://storage.example/cube.glb?signature=test"
    monkeypatch.setattr(object_storage, "presigned_get_url", lambda key: signed)
    response = await client.get(f"/api/v1/site-assets/{ident}/download?direct=true")
    if status == "pending":
        assert response.status_code == 409
    else:
        assert response.status_code == 200
        assert response.json() == {"download_url": signed}
        legacy = await client.get(f"/api/v1/site-assets/{ident}/download", follow_redirects=False)
        assert legacy.status_code == 307
        assert legacy.headers["location"] == signed


async def test_download_link_is_owner_only(client, db, project, other_user, monkeypatch):
    ident = uuid.uuid4()
    row = SiteAsset(id=ident, project_id=project.id, name="Private", category="Other",
                    storage_key=f"site-assets/{ident}.glb", upload_key=f"uploads/{ident}.glb",
                    status="ready", size_bytes=100, dimensions={})
    db.add(row)
    project.created_by = other_user.id
    await db.commit()
    def must_not_sign(key):
        pytest.fail("Signed a download for a different owner's project")
    monkeypatch.setattr(object_storage, "presigned_get_url", must_not_sign)
    response = await client.get(f"/api/v1/site-assets/{ident}/download?direct=true")
    assert response.status_code == 404
