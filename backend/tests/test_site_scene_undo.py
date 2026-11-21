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
