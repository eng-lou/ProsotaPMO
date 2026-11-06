"""Isolated operational scenarios. Running one never edits the programme."""
import uuid
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin


class SimulationScenario(Base, TimestampMixin):
    __tablename__ = 'simulation_scenarios'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('schedule_periods.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_hash: Mapped[str | None] = mapped_column(String(64))
    source: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    decisions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class WorkingSimulationSequence(Base, TimestampMixin):
    """An explicit, immutable run snapshot, independent of later scenario edits."""
    __tablename__ = 'working_simulation_sequences'
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('schedule_periods.id', ondelete='CASCADE'), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
