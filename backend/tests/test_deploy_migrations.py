import os
import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

from deploy_migrations import main, prepare_database


def test_upgrade_previous_schema_preserves_rows_and_is_repeatable():
    url = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres:password@localhost:5432/prosotapmo_test")
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                schema = "migration_test_" + uuid.uuid4().hex
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
                for table in ("activities", "resource_assignments", "schedule_baselines", "schedule_baseline_activities"):
                    connection.execute(text(f'CREATE TABLE "{table}" (id integer primary key)'))
                    connection.execute(text(f'INSERT INTO "{table}" (id) VALUES (1)'))
                connection.execute(text("CREATE TABLE cost_elements (bl_budget numeric(14,2))"))
                connection.execute(text("INSERT INTO cost_elements VALUES (123.45)"))
                connection.execute(text("CREATE TABLE cost_baseline_items (bac numeric(14,2))"))
                connection.execute(text("CREATE TABLE alembic_version (version_num varchar(32) primary key)"))
                connection.execute(text("INSERT INTO alembic_version VALUES ('b4d9e1a7c352')"))

                # Reproduce the failure even with an empty result set: PostgreSQL
                # resolves missing columns before it can return any rows.
                for table in ("activities", "resource_assignments"):
                    with pytest.raises(ProgrammingError, match="p6_data"):
                        with connection.begin_nested():
                            connection.execute(text(f'SELECT p6_data FROM "{table}" WHERE id = -1'))

                with pytest.raises(RuntimeError, match="migrations are pending"):
                    prepare_database(connection, production=False)
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "b4d9e1a7c352"

                prepare_database(connection, production=True)
                prepare_database(connection, production=True)
                prepare_database(connection, production=False)
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "c6a1f823d904"
                for table in ("activities", "resource_assignments", "schedule_baselines"):
                    assert connection.execute(text(f'SELECT id, p6_data FROM "{table}"')).all() == [(1, None)]
                assert connection.execute(text("SELECT id, budget FROM schedule_baseline_activities")).all() == [(1, None)]
                assert str(connection.scalar(text("SELECT bl_budget FROM cost_elements"))) == "123.45000000"
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


def test_build_requires_explicit_database_url(monkeypatch):
    monkeypatch.setattr("deploy_migrations.os.environ", {})
    with pytest.raises(RuntimeError, match="DATABASE_URL must be set"):
        main()


@pytest.mark.parametrize("name", ["DATABASE_URL", "DATABASE_url", "database_url"])
def test_build_accepts_runtime_database_variable_casing(monkeypatch, name):
    url = "postgresql+psycopg://example.invalid/test"
    # A plain mapping reproduces Linux case sensitivity even on Windows.
    monkeypatch.setattr("deploy_migrations.os.environ", {name: url, "VERCEL_ENV": "production"})
    factory = MagicMock()
    prepare = MagicMock()
    monkeypatch.setattr("deploy_migrations.create_engine", factory)
    monkeypatch.setattr("deploy_migrations.prepare_database", prepare)
    main()
    assert factory.call_args.args == (url,)
    prepare.assert_called_once_with(factory.return_value.begin.return_value.__enter__.return_value, production=True)
    factory.return_value.dispose.assert_called_once()
