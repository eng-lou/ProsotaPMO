"""Camera motion sequences reuse named cameras."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision = 'ac23de45fa67'
down_revision = 'ab12cd34ef56'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('cameras', sa.Column('motion', JSONB(), nullable=True))


def downgrade():
    op.drop_column('cameras', 'motion')
