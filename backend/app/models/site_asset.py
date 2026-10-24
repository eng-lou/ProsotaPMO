import uuid
from sqlalchemy import ForeignKey, String, BigInteger
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin


class SiteAsset(Base, TimestampMixin):
    __tablename__ = "site_assets"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(30))
    storage_key: Mapped[str] = mapped_column(String(300), unique=True)
    upload_key: Mapped[str] = mapped_column(String(300), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    dimensions: Mapped[dict] = mapped_column(JSONB, default=dict)
