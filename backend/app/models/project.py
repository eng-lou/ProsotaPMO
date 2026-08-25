from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organisation import Organisation
    from app.models.period import Period


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=False, index=True)
    # 2026-08-25 (per Maro, alongside the trial/beta access gate) — projects
    # are private to whoever created them, not org-wide shared: a normal
    # (non-super) user is capped at 2 of their own, and a super user reviewing
    # access requests shouldn't incidentally see a normal user's project data
    # either. org_id is kept alongside this as a genuine tenant boundary, not
    # a visibility one.
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    # Optional — not every project has a meaningful floor area (e.g. non-building projects).
    # £/m² and £/Space unit-rate figures simply don't render when these aren't set.
    gfa_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    space_count: Mapped[int | None] = mapped_column(Integer)

    organisation: Mapped[Organisation] = relationship(back_populates="projects")
    periods: Mapped[list[Period]] = relationship(back_populates="project")
