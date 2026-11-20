import uuid
from app.services.project_materials import apply_material_changes
import pytest

def test_empty_browser_cannot_claim_migration_and_seed_never_overwrites():
    assert apply_material_changes(None, {}, {}) is None
    assert apply_material_changes(None, {"road": "asphalt"}, {}) == {"road": "asphalt"}
    assert apply_material_changes({}, {"road": "asphalt"}, {}) == {}

def test_concurrent_conflict_is_atomic_and_unrelated_edits_merge():
    current = {"road": "gravel", "grass": "grass"}
    assert apply_material_changes(current, None, {"grass": {"before": "grass", "after": "moquette"}}) == {"road": "gravel", "grass": "moquette"}
    with pytest.raises(ValueError):
        apply_material_changes(current, None, {"road": {"before": "asphalt", "after": None}})
    assert current["road"] == "gravel"

async def test_materials_roundtrip_and_conflicts(client):
    project = (await client.post("/api/v1/projects/", json={"name": "Materials"})).json()
    url = f"/api/v1/projects/{project['id']}/materials"
    assert (await client.get(url)).json() == {"mapping": None}
    assert (await client.patch(url, json={"seed": {}})).json() == {"mapping": None}
    assert (await client.patch(url, json={"seed": {"road": "asphalt"}})).json() == {"mapping": {"road": "asphalt"}}
    assert (await client.patch(url, json={"seed": {"road": "soil"}})).json()['mapping']['road'] == 'asphalt'
    edit = {"changes": {"road": {"before": "asphalt", "after": "gravel"}}}
    assert (await client.patch(url, json=edit)).status_code == 200
    assert (await client.patch(url, json=edit)).status_code == 200  # lost response retry
    assert (await client.patch(url, json={"changes": {"road": {"before": "asphalt", "after": "soil"}}})).status_code == 409
    assert (await client.get(url)).json()['mapping'] == {"road": "gravel"}
    assert (await client.patch(url, json={"changes": {"road": {"before": "gravel", "after": None}}})).json()['mapping'] == {}
    assert (await client.get(f"/api/v1/projects/{uuid.uuid4()}/materials")).status_code == 404

async def test_other_owner_cannot_read_or_edit_materials(client, db, org):
    from app.models.user import User
    from app.models.project import Project
    other = User(org_id=org.id, email='other@materials.test', auth0_sub='other-materials', display_name='Other', role='admin', status='approved')
    db.add(other)
    await db.flush()
    project = Project(org_id=org.id, created_by=other.id, name='Private')
    db.add(project)
    await db.commit()
    url = f'/api/v1/projects/{project.id}/materials'
    assert (await client.get(url)).status_code == 404
    assert (await client.patch(url, json={'seed': {'road': 'asphalt'}})).status_code == 404
