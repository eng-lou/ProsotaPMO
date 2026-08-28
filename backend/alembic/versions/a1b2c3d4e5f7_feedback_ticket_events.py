"""feedback_ticket_events

Revision ID: a1b2c3d4e5f7
Revises: f4a5b6c7d8e9
Create Date: 2026-08-28 10:00:00.000000

Two-way ticket comms + status-change history (2026-08-28, per Maro:
"its a two way comms between super user and the user" plus "keep track of
the progress ... back and forth"). See app/models/feedback_ticket.py's
own TicketEvent docstring for the full shape/reasoning. Also adds
users.last_viewed_feedback_at for the Feedback icon's unread badge.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('feedback_ticket_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('ticket_id', sa.UUID(), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('old_status', sa.String(length=20), nullable=True),
    sa.Column('new_status', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id']),
    sa.ForeignKeyConstraint(['ticket_id'], ['feedback_tickets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_feedback_ticket_events_ticket_id', 'feedback_ticket_events', ['ticket_id'])
    op.create_index('ix_feedback_ticket_events_author_id', 'feedback_ticket_events', ['author_id'])
    op.add_column('users', sa.Column('last_viewed_feedback_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_viewed_feedback_at')
    op.drop_index('ix_feedback_ticket_events_author_id', table_name='feedback_ticket_events')
    op.drop_index('ix_feedback_ticket_events_ticket_id', table_name='feedback_ticket_events')
    op.drop_table('feedback_ticket_events')
