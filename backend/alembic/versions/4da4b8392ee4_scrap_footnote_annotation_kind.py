"""scrap footnote annotation kind

Revision ID: 4da4b8392ee4
Revises: 0743bdaa4452
Create Date: 2026-08-06

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '4da4b8392ee4'
down_revision = '0743bdaa4452'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Footnote was functionally identical to Comment (2026-08-06, per Maro:
    # "scrap footnote as its basically just comment") — see annotation.py's
    # own model docstring for the one review-workflow field (status) that
    # already only ever meant anything for kind="comment" anyway.
    op.execute("UPDATE annotations SET kind = 'comment' WHERE kind = 'footnote'")


def downgrade() -> None:
    # No reverse mapping — a former footnote is indistinguishable from a
    # comment that was always a comment, so there's nothing to restore.
    pass
