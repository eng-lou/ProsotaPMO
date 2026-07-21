from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RecordLink(Base):
    """
    Polymorphic graph-edge table linking any two records across modules.
    source_id / target_id are intentionally not FK-constrained — they are
    cross-table references resolved at query time by (type, id).
    Do not normalise into per-type-pair join tables (see ARCHITECTURE.md §4.3).

    Composite indexes on (source_type, source_id) / (target_type, target_id)
    (2026-07-20, optimization pass) — every real lookup filters on exactly
    this pair (list_links' own OR-of-two-ANDs, promote_variant's link
    rewrite, icd_bulk_generate's reconcile pass), and since source_id/
    target_id aren't FK columns, they get no index at all otherwise — this
    is the one shared edge table for every cross-module link, project-wide,
    forever, so it only grows.
    """

    __tablename__ = "record_links"
    __table_args__ = (
        Index("ix_record_links_source", "source_type", "source_id"),
        Index("ix_record_links_target", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # activity | risk | cost_element | issue | change | decision
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # causes | impacts | mitigates | relates_to
    link_type: Mapped[str] = mapped_column(String(50), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
