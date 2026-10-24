"""Read-only lookup regression checks using an isolated, in-memory table.

Override the suite's Postgres create/drop/truncate fixtures for this module.
No development or production database is used by these tests.
"""
from datetime import datetime, timedelta
import uuid

import pytest
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Uuid, create_engine
from sqlalchemy.orm import Session

from app.schemas.activity import ActivityWbsOption
from app.services import activity as svc


@pytest.fixture(scope="session", autouse=True)
def _schema():
    yield


@pytest.fixture(autouse=True)
def _truncate():
    yield


async def test_wbs_lookup_is_scoped_ordered_and_skips_financial_calculations(monkeypatch):
    engine = create_engine("sqlite://")
    metadata = MetaData()
    table = Table("activities", metadata,
        Column("id", Uuid, primary_key=True), Column("project_id", Uuid),
        Column("schedule_period_id", Uuid), Column("code", String),
        Column("task_name", String), Column("activity_type", String),
        Column("parent_id", Uuid), Column("sort_order", Integer),
        Column("wbs_path", String), Column("created_at", DateTime),
    )
    metadata.create_all(engine)
    project, period, other_project, other_period = [uuid.uuid4() for _ in range(4)]
    first, child, later, unsorted = [uuid.uuid4() for _ in range(4)]
    now = datetime(2026, 10, 19)

    def row(id=None, **overrides):
        return dict(id=id or uuid.uuid4(), project_id=project, schedule_period_id=period,
                    code="W-0001", task_name="Summary", activity_type="wbs_summary",
                    parent_id=None, sort_order=1, wbs_path="1", created_at=now) | overrides

    rows = [
        row(later, sort_order=2, wbs_path="2"),
        row(child, parent_id=first, sort_order=2, wbs_path="1.2"),
        row(activity_type="task", parent_id=first, wbs_path="1.1"),
        row(first),
        row(unsorted, sort_order=None, wbs_path="3"),
        row(sort_order=None, created_at=now + timedelta(seconds=1), wbs_path="4"),
        row(project_id=other_project), row(schedule_period_id=other_period),
        row(activity_type="finish_milestone"),
    ]
    with engine.begin() as connection:
        connection.execute(table.insert(), rows)

    async def forbidden(*_):
        raise AssertionError("WBS options must not calculate EVM")
    monkeypatch.setattr(svc, "_attach_evm_fields", forbidden)
    with Session(engine) as session:
        class ReadSession:
            calls = 0

            async def execute(self, statement):
                self.calls += 1
                return session.execute(statement)

        db = ReadSession()
        result = await svc.list_wbs_options(db, project, period)
        assert [a.id for a in result] == [first, child, later, unsorted, rows[5]["id"]]
        assert db.calls == 1
        payload = [ActivityWbsOption.model_validate(a).model_dump(mode="json") for a in result]
        assert set(payload[0]) == {"id", "code", "task_name", "wbs_path", "activity_type"}
        assert payload[1]["wbs_path"] == "1.2"
        assert await svc.list_wbs_options(db, other_project, other_period) == []
    engine.dispose()


def test_wbs_route_precedes_activity_id_and_requires_both_scopes():
    from app.api.activities import router
    routes = [route.path for route in router.routes]
    assert routes.index("/activities/wbs-options") < routes.index("/activities/{activity_id}")
    route = next(r for r in router.routes if r.path == "/activities/wbs-options")
    assert {field.name for field in route.dependant.query_params if field.required} == {"project_id", "schedule_period_id"}
