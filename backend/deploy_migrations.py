"""Run production migrations before Vercel publishes a new backend.

Preview builds only verify the revision: they must never migrate a shared
production database. A failed upgrade fails the build rather than serving code
which queries columns that do not exist yet.
"""
from pathlib import Path
import os

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, pool, text

ROOT = Path(__file__).resolve().parent
MIGRATION_LOCK = 746392815


def migration_config() -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    return config


def prepare_database(connection, *, production: bool) -> None:
    config = migration_config()
    if production:
        # Transaction-scoped locking works with transaction-pooling databases
        # and prevents concurrent builds from applying the same revision twice.
        connection.execute(text("SET LOCAL lock_timeout = '30s'"))
        connection.execute(text("SET LOCAL statement_timeout = '300s'"))
        connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": MIGRATION_LOCK})
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    current = set(MigrationContext.configure(connection).get_current_heads())
    expected = set(ScriptDirectory.from_config(config).get_heads())
    if current != expected:
        raise RuntimeError(
            "Database migrations are pending. Apply alembic upgrade head to the "
            "database assigned to this deployment before publishing it. "
            "Preview builds do not modify database schemas."
        )
    print("Database schema is current: " + ", ".join(sorted(current)))


def main() -> None:
    # Require the deployment's explicit URL; never fall back to a local .env.
    # Match Settings' case-insensitive environment lookup. Linux preserves key
    # casing, and existing deployments use DATABASE_url as well as DATABASE_URL.
    environment = {key.lower(): value for key, value in os.environ.items()}
    database_url = environment.get("database_url")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set for the backend build.")
    engine = create_engine(database_url, poolclass=pool.NullPool, connect_args={"connect_timeout": 10})
    try:
        with engine.begin() as connection:
            prepare_database(connection, production=os.environ.get("VERCEL_ENV") == "production")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
