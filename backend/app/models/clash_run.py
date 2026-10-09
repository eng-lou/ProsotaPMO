"""Immutable run evidence and deliberately scoped external reports."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Boolean
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin


class ClashRun(Base, TimestampMixin):
    __tablename__ = "clash_runs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clash_test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clash_tests.id", ondelete="CASCADE"), index=True)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ClashReport(Base, TimestampMixin):
    __tablename__ = "clash_reports"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clash_test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clash_tests.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_comments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    comments: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
