from __future__ import annotations

import asyncio
import os
import sys

import pytest

# psycopg3 requires SelectorEventLoop; Windows defaults to ProactorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.auth import TokenPayload, get_current_user, get_db_user
from app.database import get_db
from app.main import app
from app.models.base import Base
from app.models.organisation import Organisation
from app.models.period import Period
from app.models.project import Project
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.user import User

_DEFAULT_URL = "postgresql+psycopg://postgres:password@localhost:5432/prosotapmo_test"
_ASYNC_URL = os.environ.get("TEST_DATABASE_URL", _DEFAULT_URL)
_SYNC_URL = _ASYNC_URL

_async_engine = create_async_engine(_ASYNC_URL)
_Session = async_sessionmaker(_async_engine, expire_on_commit=False)

_TEST_USER_SUB = "auth0|test-user"
_TEST_USER_EMAIL = "test@prosota.com"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    engine = create_engine(_SYNC_URL)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _truncate():
    yield
    async with _Session() as session:
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(text(f'TRUNCATE TABLE "{table.name}" CASCADE'))
        await session.commit()


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    async with _Session() as session:
        yield session


@pytest_asyncio.fixture
async def org(db: AsyncSession) -> Organisation:
    o = Organisation(name="Test Org", plan_tier="starter")
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


@pytest_asyncio.fixture
async def user(db: AsyncSession, org: Organisation) -> User:
    u = User(
        org_id=org.id,
        email=_TEST_USER_EMAIL,
        auth0_sub=_TEST_USER_SUB,
        display_name="Test User",
        role="admin",
        status="approved",
        is_super_user=True,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest_asyncio.fixture
async def other_user(db: AsyncSession, org: Organisation) -> User:
    """A second, normal (non-super) approved user in the same org as `user`
    — for tests covering the 2026-08-25 per-user project ownership/cap
    (project visibility no longer follows org membership alone)."""
    u = User(
        org_id=org.id,
        email="other-user@example.com",
        auth0_sub="auth0|other-user",
        display_name="Other User",
        role="member",
        status="approved",
        is_super_user=False,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest_asyncio.fixture
async def client(db: AsyncSession, user: User) -> AsyncClient:
    async def _override_db():
        yield db

    async def _override_auth() -> TokenPayload:
        return TokenPayload(sub=_TEST_USER_SUB, email=_TEST_USER_EMAIL)

    async def _override_db_user() -> User:
        return user

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_auth
    app.dependency_overrides[get_db_user] = _override_db_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def raw_client() -> AsyncClient:
    """Client with no auth override — used to test that unauthed requests get 401."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def project(db: AsyncSession, org: Organisation, user: User) -> Project:
    p = Project(org_id=org.id, created_by=user.id, name="Test Project", client_name="Test Client")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest_asyncio.fixture
async def live_period(db: AsyncSession, project: Project) -> Period:
    p = Period(project_id=project.id, period_label="Period 1", freeze_status="live")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest_asyncio.fixture
async def frozen_period(db: AsyncSession, project: Project) -> Period:
    p = Period(project_id=project.id, period_label="Period 0", freeze_status="frozen")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest_asyncio.fixture
async def schedule_variant(db: AsyncSession, project: Project) -> ScheduleVariant:
    """The project's master schedule — Activity and its schedule-side
    siblings live under this (and its SchedulePeriods below), unrelated to
    Risk/Cost/ICD's own `live_period`/`frozen_period` above (see
    docs/SCHEDULE_VARIANTS_PLAN.md, private docs repo)."""
    v = ScheduleVariant(project_id=project.id, name="Working Schedule", is_master=True)
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


@pytest_asyncio.fixture
async def live_schedule_period(db: AsyncSession, schedule_variant: ScheduleVariant) -> SchedulePeriod:
    p = SchedulePeriod(schedule_variant_id=schedule_variant.id, period_label="Period 1", freeze_status="live")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@pytest_asyncio.fixture
async def frozen_schedule_period(db: AsyncSession, schedule_variant: ScheduleVariant) -> SchedulePeriod:
    p = SchedulePeriod(schedule_variant_id=schedule_variant.id, period_label="Period 0", freeze_status="frozen")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p
