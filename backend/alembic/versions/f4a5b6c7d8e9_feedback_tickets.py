"""feedback_tickets

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-08-27 12:00:00.000000

Feedback/bug-report tickets (2026-08-27, per Maro — modelled on
Reallusion's own support-ticket flow). See app/models/feedback_ticket.py
for the full shape/reasoning.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('feedback_tickets',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False, server_default='open'),
    sa.Column('attachments', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_feedback_tickets_created_by', 'feedback_tickets', ['created_by'])


def downgrade() -> None:
    op.drop_index('ix_feedback_tickets_created_by', table_name='feedback_tickets')
    op.drop_table('feedback_tickets')
