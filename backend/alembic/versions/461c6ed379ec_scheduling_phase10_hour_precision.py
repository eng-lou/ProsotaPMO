"""Scheduling Phase 10: hour-level calendar + CPM precision

Reworks the calendar/CPM data model from whole-day to hour precision, so the
"advanced calendar editor" backlog item (e.g. "08:00-09:00 non-working") can
genuinely change computed dates, not just display a label. Per Maro's confirmed
decision (2026-07-02): "Full hour-level CPM scheduling."

- calendars: hours_per_day (typed-in number) replaced by day_start_time/
  day_end_time (the working envelope); net hours/day is now derived from that
  minus any calendar_breaks spans (app/services/calendar_time.py).
- calendar_breaks (new): recurring daily non-working windows (e.g. lunch).
- calendar_exceptions: gains optional start_time/end_time for partial-day
  overrides (null = whole day, the original Phase 4 behaviour).
- activity_relationships.lag_days -> lag_hours.
- activities: duration_days (input) -> duration_hours (input); duration_days is
  repurposed as a computed display value. remaining_duration_days ->
  remaining_duration_hours. bl_duration_days -> bl_duration_hours. total_float/
  free_float -> total_float_hours/free_float_hours. start/finish/actual_start/
  actual_finish/bl_start/bl_finish/constraint_date: Date -> DateTime.

Existing data is converted with a nominal 8h/working-day assumption (this
project's previous default) — a one-time best-effort conversion for dev/test
data, not a precision guarantee. start/finish/bl_start/bl_finish are
overwritten by the next CPM recompute/baseline capture regardless; only
actual_start/actual_finish/constraint_date (plain user inputs, never
auto-recomputed) get a nominal 08:00 time-of-day anchor so they're not
silently stuck at midnight.

See docs/SCHEDULING_MODULE_PLAN.md Phase 10.

Revision ID: 461c6ed379ec
Revises: 203c324947c5
Create Date: 2026-07-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "461c6ed379ec"
down_revision = "203c324947c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- calendars: hours_per_day -> day_start_time/day_end_time ---
    op.add_column("calendars", sa.Column("day_start_time", sa.Time(), nullable=False, server_default="08:00"))
    op.add_column("calendars", sa.Column("day_end_time", sa.Time(), nullable=False, server_default="17:00"))
    op.drop_column("calendars", "hours_per_day")

    # --- calendar_breaks: new table ---
    op.create_table(
        "calendar_breaks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "calendar_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendars.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Seed a 12:00-13:00 lunch break for every calendar that already exists, so its net
    # hours/day stays 8 (this project's long-standing default) rather than silently
    # becoming 9 (the new 08:00-17:00 envelope with no break) — keeps the *8 hour
    # conversions below (duration/float/lag) consistent with each calendar's actual
    # working envelope post-migration. app/services/calendar.py seeds the same break
    # for any calendar created from here on.
    op.execute(
        """
        INSERT INTO calendar_breaks (id, calendar_id, label, start_time, end_time, created_at, updated_at)
        SELECT gen_random_uuid(), id, 'Lunch', '12:00', '13:00', now(), now() FROM calendars
        """
    )

    # --- calendar_exceptions: optional partial-day window ---
    op.add_column("calendar_exceptions", sa.Column("start_time", sa.Time(), nullable=True))
    op.add_column("calendar_exceptions", sa.Column("end_time", sa.Time(), nullable=True))

    # --- activity_relationships: lag_days -> lag_hours ---
    op.add_column(
        "activity_relationships", sa.Column("lag_hours", sa.Numeric(6, 2), nullable=False, server_default="0")
    )
    op.execute("UPDATE activity_relationships SET lag_hours = lag_days * 8")
    op.drop_column("activity_relationships", "lag_days")

    # --- activities: duration/float renames + Date -> DateTime ---
    op.add_column("activities", sa.Column("duration_hours", sa.Numeric(7, 2), nullable=True))
    op.execute("UPDATE activities SET duration_hours = duration_days * 8 WHERE duration_days IS NOT NULL")
    op.alter_column(
        "activities", "duration_days", type_=sa.Numeric(7, 2), existing_type=sa.Integer(), postgresql_using="duration_days::numeric"
    )

    op.add_column("activities", sa.Column("remaining_duration_hours", sa.Numeric(7, 2), nullable=True))
    op.execute(
        "UPDATE activities SET remaining_duration_hours = remaining_duration_days * 8 "
        "WHERE remaining_duration_days IS NOT NULL"
    )
    op.drop_column("activities", "remaining_duration_days")

    op.add_column("activities", sa.Column("bl_duration_hours", sa.Numeric(7, 2), nullable=True))
    op.execute("UPDATE activities SET bl_duration_hours = bl_duration_days * 8 WHERE bl_duration_days IS NOT NULL")
    op.drop_column("activities", "bl_duration_days")

    op.add_column("activities", sa.Column("total_float_hours", sa.Numeric(7, 2), nullable=True))
    op.execute("UPDATE activities SET total_float_hours = total_float * 8 WHERE total_float IS NOT NULL")
    op.drop_column("activities", "total_float")

    op.add_column("activities", sa.Column("free_float_hours", sa.Numeric(7, 2), nullable=True))
    op.execute("UPDATE activities SET free_float_hours = free_float * 8 WHERE free_float IS NOT NULL")
    op.drop_column("activities", "free_float")

    for col in ("start", "finish", "bl_start", "bl_finish"):
        op.alter_column(
            "activities", col, type_=sa.DateTime(), existing_type=sa.Date(),
            postgresql_using=f"{col}::timestamp",
        )
    for col in ("actual_start", "actual_finish", "constraint_date"):
        op.alter_column(
            "activities", col, type_=sa.DateTime(), existing_type=sa.Date(),
            postgresql_using=f"{col}::timestamp + interval '8 hours'",
        )


def downgrade() -> None:
    for col in ("actual_start", "actual_finish", "constraint_date", "start", "finish", "bl_start", "bl_finish"):
        op.alter_column(
            "activities", col, type_=sa.Date(), existing_type=sa.DateTime(),
            postgresql_using=f"{col}::date",
        )

    op.add_column("activities", sa.Column("free_float", sa.Integer(), nullable=True))
    op.execute("UPDATE activities SET free_float = round(free_float_hours / 8) WHERE free_float_hours IS NOT NULL")
    op.drop_column("activities", "free_float_hours")

    op.add_column("activities", sa.Column("total_float", sa.Integer(), nullable=True))
    op.execute("UPDATE activities SET total_float = round(total_float_hours / 8) WHERE total_float_hours IS NOT NULL")
    op.drop_column("activities", "total_float_hours")

    op.add_column("activities", sa.Column("bl_duration_days", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE activities SET bl_duration_days = round(bl_duration_hours / 8) WHERE bl_duration_hours IS NOT NULL"
    )
    op.drop_column("activities", "bl_duration_hours")

    op.add_column("activities", sa.Column("remaining_duration_days", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE activities SET remaining_duration_days = round(remaining_duration_hours / 8) "
        "WHERE remaining_duration_hours IS NOT NULL"
    )
    op.drop_column("activities", "remaining_duration_hours")

    op.alter_column(
        "activities", "duration_days", type_=sa.Integer(), existing_type=sa.Numeric(7, 2),
        postgresql_using="round(duration_days)::integer",
    )
    op.drop_column("activities", "duration_hours")

    op.add_column("activity_relationships", sa.Column("lag_days", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE activity_relationships SET lag_days = round(lag_hours / 8)")
    op.drop_column("activity_relationships", "lag_hours")

    op.drop_column("calendar_exceptions", "end_time")
    op.drop_column("calendar_exceptions", "start_time")

    op.drop_table("calendar_breaks")

    op.add_column("calendars", sa.Column("hours_per_day", sa.Numeric(4, 2), nullable=False, server_default="8"))
    op.drop_column("calendars", "day_end_time")
    op.drop_column("calendars", "day_start_time")
