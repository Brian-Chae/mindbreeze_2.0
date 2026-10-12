"""SDD-075 기관 운영 상태/버전 및 신규 세션 기관 귀속."""
from alembic import op
import sqlalchemy as sa

revision = 'e036a0000009'
down_revision = 'e036a0000008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('organizations') as batch:
        batch.add_column(sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('deactivated_by', sa.UUID(), nullable=True))
        batch.add_column(sa.Column('deactivation_reason', sa.Text(), nullable=True))
        batch.add_column(sa.Column('version', sa.Integer(), server_default='1', nullable=False))
        batch.create_foreign_key('fk_organizations_deactivated_by', 'users', ['deactivated_by'], ['id'])
    with op.batch_alter_table('sessions') as batch:
        batch.add_column(sa.Column('organization_id', sa.UUID(), nullable=True))
        batch.add_column(sa.Column('organization_attribution_known', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch.create_foreign_key('fk_sessions_organization_id', 'organizations', ['organization_id'], ['id'])
        batch.create_index('ix_sessions_organization_id', ['organization_id'])


def downgrade() -> None:
    with op.batch_alter_table('sessions') as batch:
        batch.drop_index('ix_sessions_organization_id')
        batch.drop_constraint('fk_sessions_organization_id', type_='foreignkey')
        batch.drop_column('organization_attribution_known')
        batch.drop_column('organization_id')
    with op.batch_alter_table('organizations') as batch:
        batch.drop_constraint('fk_organizations_deactivated_by', type_='foreignkey')
        for column in ('version', 'deactivation_reason', 'deactivated_by', 'deactivated_at'):
            batch.drop_column(column)
