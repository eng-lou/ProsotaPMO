from app.schemas.camera_motion import MotionPause
from pydantic import ValidationError
import pytest


def test_pause_roundtrip():
    value = dict(id="pause-a", phase="transition", at=1.5, duration=3,
                 details=["annotation:a", "path:b", "site:c"], onlyLinked=True, actors="continue")
    assert MotionPause.model_validate(value).model_dump() == value


@pytest.mark.parametrize("patch", [{"duration":0}, {"at":-1}, {"duration":float("nan")}, {"phase":"unknown"}])
def test_invalid_pause_rejected(patch):
    with pytest.raises(ValidationError):
        MotionPause.model_validate(dict(id="p", duration=3, at=1) | patch)


async def test_camera_pause_saved_and_loaded(client, project):
    pose = dict(base_position_x=10, base_position_y=0, base_position_z=4,
                base_target_x=0, base_target_y=0, base_target_z=0,
                base_focal_length=35, base_clip_start=.1, base_clip_end=10000)
    pause = dict(id="p", phase="shot", at=4, duration=3, details=["annotation:a"], onlyLinked=True, actors="freeze")
    shot = dict(id="shot", name="Orbit", settings=dict(kind="orbit", duration=10, amount=1, angle=180,
                reverse=False, easing="linear", shotSize="wide", alignment="center", lookAt=True, startView="current"),
                target=[0,0,0], radius=2, upAxis="z", start=pose, end=None, startOffset=[0,0,0], endOffset=[0,0,0],
                stage="progress", dateStart="2026-01-01T00:00:00Z", dateEnd="2026-04-01T00:00:00Z", blend=0, pauses=[pause])
    result = await client.post("/api/v1/cameras/", json=dict(project_id=str(project.id), name="Pause test", **pose, motion=dict(version=1, shots=[shot])))
    assert result.status_code == 201, result.text
    saved = result.json()
    assert saved["motion"]["shots"][0]["pauses"] == [pause]
    loaded = await client.get("/api/v1/cameras/", params={"project_id":str(project.id)})
    assert loaded.status_code == 200
    assert next(c for c in loaded.json() if c["id"] == saved["id"])["motion"]["shots"][0]["pauses"] == [pause]
