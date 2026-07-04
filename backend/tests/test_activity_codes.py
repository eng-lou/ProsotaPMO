from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.period import Period
from app.models.project import Project


async def _create(client: AsyncClient, project: Project, period: Period, **overrides) -> dict:
    payload = {"project_id": str(project.id), "period_id": str(period.id), "task_name": "Activity"}
    payload.update(overrides)
    resp = await client.post("/api/v1/activities/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_new_task_gets_t_prefix(client: AsyncClient, project: Project, live_period: Period):
    a = await _create(client, project, live_period, task_name="Excavation")
    assert a["code"] == "T-0001"
    assert a["wbs_role"] == "T"


async def test_new_milestone_gets_m_prefix(client: AsyncClient, project: Project, live_period: Period):
    m = await _create(client, project, live_period, task_name="Practical Completion", activity_type="milestone")
    assert m["code"] == "M-0001"
    assert m["wbs_role"] == "M"


async def test_indent_promotes_top_level_parent_to_p_prefix(
    client: AsyncClient, project: Project, live_period: Period
):
    """A WBS summary with no parent of its own is the "overarching" top-level
    group (2026-07-04, per Maro: "the overarching WBS summary top of the
    hierarchy can be P-0001") — distinct from a WBS nested under something
    else, which gets W- instead (see test_indent_promotes_nested_parent_to_w_prefix)."""
    parent = await _create(client, project, live_period, task_name="Development")
    assert parent["code"] == "T-0001"

    await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])

    refreshed = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert refreshed["activity_type"] == "wbs_summary"
    assert refreshed["wbs_role"] == "P"
    assert refreshed["code"] == "P-0001"


async def test_indent_promotes_nested_parent_to_w_prefix(
    client: AsyncClient, project: Project, live_period: Period
):
    grandparent = await _create(client, project, live_period, task_name="Programme")
    parent = await _create(client, project, live_period, task_name="Development", parent_id=grandparent["id"])
    await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])

    refreshed = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert refreshed["wbs_role"] == "W"
    assert refreshed["code"] == "W-0001"

    top = (await client.get(f"/api/v1/activities/{grandparent['id']}")).json()
    assert top["wbs_role"] == "P"
    assert top["code"] == "P-0001"


async def test_outdent_demotes_back_to_fresh_t_code(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Development")
    child = await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])
    promoted = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert promoted["code"] == "P-0001"

    resp = await client.patch(f"/api/v1/activities/{child['id']}", json={"parent_id": None})
    assert resp.status_code == 200

    demoted = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert demoted["activity_type"] == "task"
    assert demoted["wbs_role"] == "T"
    # A fresh T-code, not the original T-0001 it started with — that number
    # already belongs to the child (T-0002, assigned on its own creation before
    # being indented under — then back out from — the parent).
    assert demoted["code"] == "T-0003"


async def test_role_counters_are_independent_per_prefix(
    client: AsyncClient, project: Project, live_period: Period
):
    """T-0005 existing must not make the next WBS become W-0006 — each role has
    its own sequence (2026-07-04, per Maro: "if there's another wbs with that
    exact code then of course W-0002")."""
    for i in range(5):
        await _create(client, project, live_period, task_name=f"Task {i}")

    parent = await _create(client, project, live_period, task_name="Development")
    await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])
    promoted = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert promoted["code"] == "P-0001"


async def test_promote_and_demote_logged_in_code_history(
    client: AsyncClient, project: Project, live_period: Period
):
    parent = await _create(client, project, live_period, task_name="Development")
    child = await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])

    history = (await client.get(f"/api/v1/activities/{parent['id']}/code-history")).json()
    assert len(history) == 1
    assert history[0]["old_code"] == "T-0001"
    assert history[0]["new_code"] == "P-0001"
    assert history[0]["reason"] == "promoted_to_wbs"

    await client.patch(f"/api/v1/activities/{child['id']}", json={"parent_id": None})
    history = (await client.get(f"/api/v1/activities/{parent['id']}/code-history")).json()
    assert len(history) == 2
    # Most recent first. T-0003, not T-0002 — that number already belongs to
    # the child (T-0002, assigned on its own creation).
    assert history[0]["old_code"] == "P-0001"
    assert history[0]["new_code"] == "T-0003"
    assert history[0]["reason"] == "demoted_to_task"


async def test_manual_code_rename_logged_and_not_reverted_by_recompute(
    client: AsyncClient, project: Project, live_period: Period
):
    """Regression guard: a manually-renamed code (inline editing) must not be
    mistaken for a stale prefix by the next _recompute_hierarchy pass and
    silently reassigned back — wbs_role (not the code string) is what that
    comparison is actually based on, precisely to avoid this."""
    a = await _create(client, project, live_period, task_name="Excavation")
    resp = await client.patch(f"/api/v1/activities/{a['id']}", json={"code": "EXC-01"})
    assert resp.status_code == 200
    assert resp.json()["code"] == "EXC-01"

    # Trigger another _recompute_hierarchy pass (creating any activity in the
    # period runs one) and confirm the manual rename survived untouched.
    await _create(client, project, live_period, task_name="Something else")
    refreshed = (await client.get(f"/api/v1/activities/{a['id']}")).json()
    assert refreshed["code"] == "EXC-01"
    assert refreshed["wbs_role"] == "T"

    history = (await client.get(f"/api/v1/activities/{a['id']}/code-history")).json()
    assert len(history) == 1
    assert history[0]["activity_id"] == a["id"]
    assert history[0]["old_code"] == "T-0001"
    assert history[0]["new_code"] == "EXC-01"
    assert history[0]["reason"] == "manual_edit"


async def test_baseline_snapshot_captures_code_at_capture_time(
    client: AsyncClient, db: AsyncSession, project: Project, live_period: Period
):
    from datetime import date
    live_period.start_date = date(2025, 6, 2)
    await db.commit()

    parent = await _create(client, project, live_period, task_name="Development")
    child = await _create(client, project, live_period, task_name="Design", parent_id=parent["id"])

    baseline = (await client.post("/api/v1/schedule-baselines/", json={
        "period_id": str(live_period.id), "name": "Baseline 1", "baseline_date": "2026-01-01",
    })).json()

    snapshot = (await client.get(f"/api/v1/schedule-baselines/{baseline['id']}/snapshot")).json()
    parent_snap = next(s for s in snapshot if s["activity_id"] == parent["id"])
    assert parent_snap["code"] == "P-0001"

    # Demote the parent back to a task after the baseline was captured — its
    # live code moves on, but the baseline's own snapshot of "what it was called
    # then" must stay exactly as captured.
    await client.patch(f"/api/v1/activities/{child['id']}", json={"parent_id": None})
    live = (await client.get(f"/api/v1/activities/{parent['id']}")).json()
    assert live["code"] != "P-0001"

    snapshot_again = (await client.get(f"/api/v1/schedule-baselines/{baseline['id']}/snapshot")).json()
    parent_snap_again = next(s for s in snapshot_again if s["activity_id"] == parent["id"])
    assert parent_snap_again["code"] == "P-0001"
