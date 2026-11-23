from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.project import Project


async def _create_activity_field(client: AsyncClient, project: Project, name: str, data_type: str) -> dict:
    resp = await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "activity", "name": name, "data_type": data_type,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_and_list_definitions_scoped_by_entity_type(client: AsyncClient, project: Project):
    await _create_activity_field(client, project, "Deadline", "finish_date")
    await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "resource", "name": "Trade", "data_type": "text",
    })

    activity_fields = (await client.get("/api/v1/user-defined-fields/definitions", params={
        "project_id": str(project.id), "entity_type": "activity",
    })).json()
    assert {f["name"] for f in activity_fields} == {"Deadline", "4D Viewable"}

    resource_fields = (await client.get("/api/v1/user-defined-fields/definitions", params={
        "project_id": str(project.id), "entity_type": "resource",
    })).json()
    assert len(resource_fields) == 1
    assert resource_fields[0]["name"] == "Trade"


async def test_render_visibility_persists_on_the_schedule(client: AsyncClient, project: Project, live_schedule_period):
    params = {"project_id": str(project.id), "schedule_period_id": str(live_schedule_period.id)}
    parent = (await client.post("/api/v1/activities/", json={**params, "task_name": "Project Milestones"})).json()
    child = (await client.post("/api/v1/activities/", json={**params, "task_name": "Handover", "parent_id": parent["id"]})).json()
    async def visibility():
        rows = (await client.get("/api/v1/activities/", params=params)).json()
        return {r["id"]: r["viewable_4d"] for r in rows}

    assert await visibility() == {parent["id"]: True, child["id"]: True}
    # A pre-existing field with this title keeps its own data and meaning.
    original = await _create_activity_field(client, project, "4D Viewable", "text")
    field_params = {"project_id": str(project.id), "entity_type": "activity"}
    fields = (await client.get("/api/v1/user-defined-fields/definitions", params=field_params)).json()
    field = next(f for f in fields if f["data_type"] == "4d_viewable")
    assert field["id"] != original["id"]
    assert fields == (await client.get("/api/v1/user-defined-fields/definitions", params=field_params)).json()
    url = f"/api/v1/user-defined-fields/values/{field['id']}/{parent['id']}"
    assert (await client.put(url, json={"value_text": "No"})).status_code == 200
    assert await visibility() == {parent["id"]: False, child["id"]: True}
    variant = await client.post("/api/v1/schedule-variants/", json={
        "project_id": str(project.id), "name": "Render copy",
        "duplicate_from_variant_id": str(live_schedule_period.schedule_variant_id),
    })
    assert variant.status_code == 201, variant.text
    all_rows = (await client.get("/api/v1/activities/", params={"project_id": str(project.id)})).json()
    copies = {r["task_name"]: r["viewable_4d"] for r in all_rows if r["schedule_variant_id"] == variant.json()["id"]}
    assert copies == {"Project Milestones": False, "Handover": True}
    assert (await client.put(url, json={"value_text": "invalid"})).status_code == 422
    assert (await client.put(url, json={"value_text": "Yes"})).status_code == 200
    assert all((await visibility()).values())


async def test_duplicate_name_same_entity_type_rejected(client: AsyncClient, project: Project):
    await _create_activity_field(client, project, "Deadline", "finish_date")
    resp = await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "activity", "name": "Deadline", "data_type": "text",
    })
    assert resp.status_code == 422


async def test_same_name_different_entity_type_allowed(client: AsyncClient, project: Project):
    await _create_activity_field(client, project, "Notes", "text")
    resp = await client.post("/api/v1/user-defined-fields/definitions", json={
        "project_id": str(project.id), "entity_type": "cost_element", "name": "Notes", "data_type": "text",
    })
    assert resp.status_code == 201, resp.text


async def test_rename_definition(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Deadline", "finish_date")
    resp = await client.patch(f"/api/v1/user-defined-fields/definitions/{field['id']}", json={"name": "Contract Deadline"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Contract Deadline"
    assert resp.json()["data_type"] == "finish_date"  # unchanged


async def test_rename_to_existing_name_rejected(client: AsyncClient, project: Project):
    await _create_activity_field(client, project, "Deadline", "finish_date")
    other = await _create_activity_field(client, project, "Notes", "text")
    resp = await client.patch(f"/api/v1/user-defined-fields/definitions/{other['id']}", json={"name": "Deadline"})
    assert resp.status_code == 422


async def test_changing_data_type_clears_existing_values(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Priority", "text")
    record_id = str(uuid.uuid4())
    await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{record_id}", json={"value_text": "High"})

    resp = await client.patch(f"/api/v1/user-defined-fields/definitions/{field['id']}", json={"data_type": "integer"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data_type"] == "integer"

    values = (await client.post("/api/v1/user-defined-fields/values/bulk-fetch", json={
        "field_definition_ids": [field["id"]], "record_ids": [record_id],
    })).json()
    assert values == []  # cleared — value_text under the old type has no meaning under 'integer'


async def test_update_missing_definition_404s(client: AsyncClient, project: Project):
    resp = await client.patch(f"/api/v1/user-defined-fields/definitions/{uuid.uuid4()}", json={"name": "X"})
    assert resp.status_code == 404


async def test_delete_definition_cascades_its_values(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Deadline", "finish_date")
    record_id = str(uuid.uuid4())
    await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{record_id}", json={
        "value_date": "2027-03-01T00:00:00",
    })

    resp = await client.delete(f"/api/v1/user-defined-fields/definitions/{field['id']}")
    assert resp.status_code == 204

    values = (await client.post("/api/v1/user-defined-fields/values/bulk-fetch", json={
        "field_definition_ids": [field["id"]], "record_ids": [record_id],
    })).json()
    assert values == []


async def test_set_and_bulk_fetch_values(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Deadline", "finish_date")
    record_a = str(uuid.uuid4())
    record_b = str(uuid.uuid4())

    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{record_a}", json={
        "value_date": "2027-03-01T00:00:00",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["value_date"] == "2027-03-01T00:00:00"

    values = (await client.post("/api/v1/user-defined-fields/values/bulk-fetch", json={
        "field_definition_ids": [field["id"]], "record_ids": [record_a, record_b],
    })).json()
    assert len(values) == 1
    assert values[0]["record_id"] == record_a


async def test_set_value_upserts(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Deadline", "finish_date")
    record_id = str(uuid.uuid4())
    await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{record_id}", json={
        "value_date": "2027-03-01T00:00:00",
    })
    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{record_id}", json={
        "value_date": "2027-06-01T00:00:00",
    })
    assert resp.status_code == 200

    values = (await client.post("/api/v1/user-defined-fields/values/bulk-fetch", json={
        "field_definition_ids": [field["id"]], "record_ids": [record_id],
    })).json()
    assert len(values) == 1  # updated in place, not a duplicate row
    assert values[0]["value_date"] == "2027-06-01T00:00:00"


async def test_set_value_rejects_wrong_column_for_data_type(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Deadline", "finish_date")
    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{uuid.uuid4()}", json={
        "value_text": "not a date",
    })
    assert resp.status_code == 422
    assert "finish_date" in resp.json()["detail"]


async def test_set_value_rejects_non_whole_number_for_integer_field(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Priority", "integer")
    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{uuid.uuid4()}", json={
        "value_number": "1.5",
    })
    assert resp.status_code == 422


async def test_set_value_accepts_indicator_token(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Status", "indicator")
    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{uuid.uuid4()}", json={
        "value_indicator": "at_risk",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["value_indicator"] == "at_risk"


async def test_set_value_rejects_invalid_indicator_token(client: AsyncClient, project: Project):
    field = await _create_activity_field(client, project, "Status", "indicator")
    resp = await client.put(f"/api/v1/user-defined-fields/values/{field['id']}/{uuid.uuid4()}", json={
        "value_indicator": "on_fire",
    })
    assert resp.status_code == 422


async def test_set_value_missing_definition_404s(client: AsyncClient, project: Project):
    resp = await client.put(f"/api/v1/user-defined-fields/values/{uuid.uuid4()}/{uuid.uuid4()}", json={
        "value_text": "x",
    })
    assert resp.status_code == 404


async def test_delete_missing_definition_404s(client: AsyncClient, project: Project):
    resp = await client.delete(f"/api/v1/user-defined-fields/definitions/{uuid.uuid4()}")
    assert resp.status_code == 404
