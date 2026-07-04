"""project_cascade_delete_safety

Revision ID: 7f7cfcfa8eaf
Revises: 209505f9739f
Create Date: 2026-07-04 00:48:31.945677

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7f7cfcfa8eaf'
down_revision: Union[str, None] = '209505f9739f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# NOTE: autogenerate also flagged ~8 unrelated "removed unique constraint" diffs
# (uq_cost_elements_project_code, uq_cost_variance_criteria_project_level,
# uq_icd_criteria_project_dimension_level, uq_icd_items_project_code,
# uq_risk_impact_criteria_project_level, uq_risk_mitigation_actions_risk_code,
# uq_risk_probability_criteria_project_level, uq_risks_project_code) — these are
# pre-existing DB constraints the models never declared via __table_args__, a
# known false-positive that recurs on every autogenerate in this repo. Stripped
# here as out of scope; only the FK ondelete="CASCADE" changes below are new.


def upgrade() -> None:
    op.drop_constraint('activities_period_id_fkey', 'activities', type_='foreignkey')
    op.drop_constraint('activities_project_id_fkey', 'activities', type_='foreignkey')
    op.create_foreign_key(None, 'activities', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'activities', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('calendars_project_id_fkey', 'calendars', type_='foreignkey')
    op.create_foreign_key(None, 'calendars', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('cost_commitments_cost_element_id_fkey', 'cost_commitments', type_='foreignkey')
    op.create_foreign_key(None, 'cost_commitments', 'cost_elements', ['cost_element_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('cost_elements_period_id_fkey', 'cost_elements', type_='foreignkey')
    op.drop_constraint('cost_elements_project_id_fkey', 'cost_elements', type_='foreignkey')
    op.create_foreign_key(None, 'cost_elements', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'cost_elements', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('cost_rate_lines_cost_element_id_fkey', 'cost_rate_lines', type_='foreignkey')
    op.create_foreign_key(None, 'cost_rate_lines', 'cost_elements', ['cost_element_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('cost_variance_criteria_project_id_fkey', 'cost_variance_criteria', type_='foreignkey')
    op.create_foreign_key(None, 'cost_variance_criteria', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('icd_action_items_icd_item_id_fkey', 'icd_action_items', type_='foreignkey')
    op.create_foreign_key(None, 'icd_action_items', 'icd_items', ['icd_item_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('icd_comments_icd_item_id_fkey', 'icd_comments', type_='foreignkey')
    op.create_foreign_key(None, 'icd_comments', 'icd_items', ['icd_item_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('icd_criteria_project_id_fkey', 'icd_criteria', type_='foreignkey')
    op.create_foreign_key(None, 'icd_criteria', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('icd_items_period_id_fkey', 'icd_items', type_='foreignkey')
    op.drop_constraint('icd_items_project_id_fkey', 'icd_items', type_='foreignkey')
    op.create_foreign_key(None, 'icd_items', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'icd_items', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('periods_project_id_fkey', 'periods', type_='foreignkey')
    op.create_foreign_key(None, 'periods', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('resources_project_id_fkey', 'resources', type_='foreignkey')
    op.create_foreign_key(None, 'resources', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('risk_impact_criteria_project_id_fkey', 'risk_impact_criteria', type_='foreignkey')
    op.create_foreign_key(None, 'risk_impact_criteria', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('risk_mitigation_actions_risk_id_fkey', 'risk_mitigation_actions', type_='foreignkey')
    op.create_foreign_key(None, 'risk_mitigation_actions', 'risks', ['risk_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('risk_probability_criteria_project_id_fkey', 'risk_probability_criteria', type_='foreignkey')
    op.create_foreign_key(None, 'risk_probability_criteria', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('risks_period_id_fkey', 'risks', type_='foreignkey')
    op.drop_constraint('risks_project_id_fkey', 'risks', type_='foreignkey')
    op.create_foreign_key(None, 'risks', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key(None, 'risks', 'periods', ['period_id'], ['id'], ondelete='CASCADE')
    op.drop_constraint('schedule_baselines_period_id_fkey', 'schedule_baselines', type_='foreignkey')
    op.create_foreign_key(None, 'schedule_baselines', 'periods', ['period_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint(None, 'schedule_baselines', type_='foreignkey')
    op.create_foreign_key('schedule_baselines_period_id_fkey', 'schedule_baselines', 'periods', ['period_id'], ['id'])
    op.drop_constraint(None, 'risks', type_='foreignkey')
    op.drop_constraint(None, 'risks', type_='foreignkey')
    op.create_foreign_key('risks_project_id_fkey', 'risks', 'projects', ['project_id'], ['id'])
    op.create_foreign_key('risks_period_id_fkey', 'risks', 'periods', ['period_id'], ['id'])
    op.drop_constraint(None, 'risk_probability_criteria', type_='foreignkey')
    op.create_foreign_key('risk_probability_criteria_project_id_fkey', 'risk_probability_criteria', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'risk_mitigation_actions', type_='foreignkey')
    op.create_foreign_key('risk_mitigation_actions_risk_id_fkey', 'risk_mitigation_actions', 'risks', ['risk_id'], ['id'])
    op.drop_constraint(None, 'risk_impact_criteria', type_='foreignkey')
    op.create_foreign_key('risk_impact_criteria_project_id_fkey', 'risk_impact_criteria', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'resources', type_='foreignkey')
    op.create_foreign_key('resources_project_id_fkey', 'resources', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'periods', type_='foreignkey')
    op.create_foreign_key('periods_project_id_fkey', 'periods', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'icd_items', type_='foreignkey')
    op.drop_constraint(None, 'icd_items', type_='foreignkey')
    op.create_foreign_key('icd_items_project_id_fkey', 'icd_items', 'projects', ['project_id'], ['id'])
    op.create_foreign_key('icd_items_period_id_fkey', 'icd_items', 'periods', ['period_id'], ['id'])
    op.drop_constraint(None, 'icd_criteria', type_='foreignkey')
    op.create_foreign_key('icd_criteria_project_id_fkey', 'icd_criteria', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'icd_comments', type_='foreignkey')
    op.create_foreign_key('icd_comments_icd_item_id_fkey', 'icd_comments', 'icd_items', ['icd_item_id'], ['id'])
    op.drop_constraint(None, 'icd_action_items', type_='foreignkey')
    op.create_foreign_key('icd_action_items_icd_item_id_fkey', 'icd_action_items', 'icd_items', ['icd_item_id'], ['id'])
    op.drop_constraint(None, 'cost_variance_criteria', type_='foreignkey')
    op.create_foreign_key('cost_variance_criteria_project_id_fkey', 'cost_variance_criteria', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'cost_rate_lines', type_='foreignkey')
    op.create_foreign_key('cost_rate_lines_cost_element_id_fkey', 'cost_rate_lines', 'cost_elements', ['cost_element_id'], ['id'])
    op.drop_constraint(None, 'cost_elements', type_='foreignkey')
    op.drop_constraint(None, 'cost_elements', type_='foreignkey')
    op.create_foreign_key('cost_elements_project_id_fkey', 'cost_elements', 'projects', ['project_id'], ['id'])
    op.create_foreign_key('cost_elements_period_id_fkey', 'cost_elements', 'periods', ['period_id'], ['id'])
    op.drop_constraint(None, 'cost_commitments', type_='foreignkey')
    op.create_foreign_key('cost_commitments_cost_element_id_fkey', 'cost_commitments', 'cost_elements', ['cost_element_id'], ['id'])
    op.drop_constraint(None, 'calendars', type_='foreignkey')
    op.create_foreign_key('calendars_project_id_fkey', 'calendars', 'projects', ['project_id'], ['id'])
    op.drop_constraint(None, 'activities', type_='foreignkey')
    op.drop_constraint(None, 'activities', type_='foreignkey')
    op.create_foreign_key('activities_project_id_fkey', 'activities', 'projects', ['project_id'], ['id'])
    op.create_foreign_key('activities_period_id_fkey', 'activities', 'periods', ['period_id'], ['id'])
