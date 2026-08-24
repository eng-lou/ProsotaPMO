from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.environment == "development",
    # Verifies each pooled connection with a lightweight ping before handing
    # it to a request, transparently reconnecting if it's gone stale — a
    # warm serverless container reusing this engine across invocations can
    # otherwise hand out a connection the DB provider already closed on its
    # end, surfacing as "SSL connection has been closed unexpectedly".
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
