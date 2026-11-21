from uuid import uuid4

import pytest

from app.models.path import Path
from app.models.site_scene import SiteSceneCommand
from app.models.zone import Zone


@pytest.mark.parametrize("source_model", [Path, Zone])
@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("source_removed", [False, True])
async def test_undo_ground_removal_with_stale_source(client, db, project, source_model, legacy, source_removed):
    points = [dict(x=x, y=0, z=z) for x, z in [(0, 0), (12, 0), (12, 8), (0, 8)]]
    source = source_model(id=uuid4(), project_id=project.id, points=points)
    if source_model is Path:
        source.closed, source.curve_mode = True, "straight"
    db.add(source)
    await db.commit()
    key = "path_id" if source_model is Path else "zone_id"
    ground = dict(id=str(uuid4()), kind="shape", name="Site ground", up_axis="y",
                  position=points[0], closed=True, points=points, finish="compacted-gravel",
                  **{key: str(source.id)})
    other = dict(id=str(uuid4()), kind="cabin", name="Cabin", up_axis="y", position=points[0])
    url = f"/api/v1/site-scenes/{project.id}"

    async def write(revision, items, command=None):
        return await client.put(url, json=dict(command_id=str(command or uuid4()),
                                               expected_revision=revision, items=items))

    setup_command = uuid4()
    original = await write(0, [ground, other], setup_command)
    assert original.status_code == 200, original.text
    if not legacy:
        # Imported scenes can have no historical commands before the removal.
        await db.delete(await db.get(SiteSceneCommand, setup_command))
    if source_removed:
        await db.delete(source)
    else:
        source.points = [{**point, "x": point["x"] + 2} for point in points]
    await db.commit()
    removal = uuid4()
    assert (await write(1, [other], removal)).status_code == 200
    if legacy:
        receipt = await db.get(SiteSceneCommand, removal)
        receipt.before_removal_hash = None
        await db.commit()

    invalid = await write(2, [{**ground, "name": "Different object"}, other])
    assert invalid.status_code == (422 if source_removed else 409)
    assert (await client.get(url)).json()["revision"] == 2
    restore = uuid4()
    undone = await write(2, [ground, other], restore)
    assert undone.status_code == 200, undone.text
    assert undone.json()["items"] == original.json()["items"]
    assert (await client.get(url)).json() == undone.json()
    assert (await write(2, [ground, other], restore)).json() == undone.json()
    assert (await write(2, [other])).status_code == 409
    assert (await write(3, [other])).status_code == 200


async def test_saved_undo_after_reopen_preserves_ground_and_gate_motion(client, db, project):
    point = lambda x, z=0: dict(x=x, y=0, z=z)
    ground = dict(id=str(uuid4()), name="Grass platform", kind="shape", position=point(7, 9),
                  up_axis="y", points=[point(0), point(12), point(12, 8), point(0, 8)],
                  closed=True, height=0.35, finish="compacted-gravel")
    boundary = Path(id=uuid4(), project_id=project.id, points=ground["points"], closed=True, curve_mode="straight")
    line = Path(id=uuid4(), project_id=project.id, points=[point(0), point(18)], closed=False, curve_mode="straight")
    db.add(boundary)
    db.add(line)
    await db.commit()
    ground["path_id"] = str(boundary.id)
    gate = dict(id=str(uuid4()), name="Site entrance", kind="fence", position=point(0), up_axis="y",
                path_id=str(line.id), points=line.points, enclosure=dict(style="mesh", openings=[
                    dict(kind="vehicle", start=2, width=5, angle=-90)]))
    url = f"/api/v1/site-scenes/{project.id}"

    async def write(revision, items, label):
        response = await client.put(url, json=dict(command_id=str(uuid4()), expected_revision=revision,
                                                    items=items, label=label))
        assert response.status_code == 200, response.text
        return response.json()

    original = await write(0, [ground, gate], "Place ground and gate")
    removed = await write(1, [gate], "Remove Grass platform")
    await db.delete(boundary)
    await db.delete(line)
    await db.commit()
    reopened = (await client.get(url)).json()
    assert reopened == removed
    action = reopened["history"]["past"][-1]
    assert action["label"] == "Remove Grass platform"

    def command(revision, action):
        return dict(command_id=str(uuid4()), expected_revision=revision, action_id=action["id"])

    undo = command(2, action)
    restored = await client.post(url + "/history/undo", json=undo)
    assert restored.status_code == 200, restored.text
    assert restored.json()["items"] == original["items"]
    assert (await client.post(url + "/history/undo", json=undo)).json() == restored.json()
    assert (await client.post(url + "/history/redo", json=command(2, action))).status_code == 409
    assert (await client.get(url)).json()["history"]["future"] == [action]
    redone = await client.post(url + "/history/redo", json=command(3, action))
    assert redone.json()["items"] == removed["items"]
    assert (await client.post(url + "/history/undo", json=command(4, action))).json()["items"] == original["items"]

    gate["enclosure"]["openings"][0].update(pose=0.3, pose_keys=[
        dict(date="2026-11-21T12:00:00Z", value=1), dict(date="2026-11-21T08:00:00Z", value=0)])
    keyed = await write(5, [ground, gate], "Key vehicle gate")
    assert keyed["history"]["future"] == []
    assert [k["value"] for k in keyed["items"][1]["enclosure"]["openings"][0]["pose_keys"]] == [0, 1]
    assert "pose_keys" not in keyed["items"][1]["layout"]["openings"][0]
    latest = keyed["history"]["past"][-1]
    assert (await client.post(url + "/history/undo", json=command(6, latest))).json()["items"] == original["items"]
    assert (await client.post(url + "/history/redo", json=command(7, latest))).json()["items"] == keyed["items"]

    for keys in ([dict(date="2026-11-21T08:00:00Z", value=1.1)],
                 [dict(date="2026-11-21T08:00:00Z", value=1)] * 2):
        gate["enclosure"]["openings"][0]["pose_keys"] = keys
        bad = await client.put(url, json=dict(command_id=str(uuid4()), expected_revision=8, items=[ground, gate]))
        assert bad.status_code == 422
    assert (await client.get(url)).json()["revision"] == 8
