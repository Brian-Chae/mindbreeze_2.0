"""SDD-243 M243-3: 데이터 센터 반출 감사 확장(additive).

- data_export_audits: 일괄 작업용 컬럼(scope_org_id/identity/purpose_type/reason/request_hash/consent_version/part_no/
  session_count/participant_count/event_id) 추가, session_id/participant_id nullable(차단된 무대상 요청도 기록).
- data_export_audit_targets: 요청 시점 고정 대상 사본(원천 FK·cascade 없음). 원천/job 삭제가 감사로 cascade 되지 않는다.
- URL·비밀·생체값 컬럼 없음. 기존 단건(legacy) 행·코드와 공존.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e036a0243003'
down_revision = 'e036a0243002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, col in (
        ('event_id', sa.UUID()), ('scope_org_id', sa.UUID()), ('identity', sa.String(length=20)),
        ('purpose_type', sa.String(length=20)), ('reason', sa.Text()), ('request_hash', sa.String(length=64)),
        ('consent_version', sa.String(length=50)), ('part_no', sa.Integer()), ('session_count', sa.Integer()),
        ('participant_count', sa.Integer()),
    ):
        op.add_column('data_export_audits', sa.Column(name, col, nullable=True))
    op.alter_column('data_export_audits', 'session_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('data_export_audits', 'participant_id', existing_type=sa.UUID(), nullable=True)
    op.create_index('uq_data_export_audits_event_id', 'data_export_audits', ['event_id'], unique=True)
    op.create_index('ix_data_export_audits_org_created', 'data_export_audits', ['scope_org_id', 'created_at'], unique=False)
    op.create_index('ix_data_export_audits_user_created', 'data_export_audits', ['user_id', 'created_at'], unique=False)
    op.create_table(
        'data_export_audit_targets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('audit_id', sa.UUID(), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=False),
        sa.Column('participant_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['audit_id'], ['data_export_audits.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('audit_id', 'session_id', 'participant_id', name='uq_data_export_audit_target'),
    )
    op.create_index('ix_data_export_audit_targets_audit', 'data_export_audit_targets', ['audit_id', 'ordinal'], unique=False)


def downgrade() -> None:
    op.drop_table('data_export_audit_targets')
    op.drop_index('ix_data_export_audits_user_created', table_name='data_export_audits')
    op.drop_index('ix_data_export_audits_org_created', table_name='data_export_audits')
    op.drop_index('uq_data_export_audits_event_id', table_name='data_export_audits')
    for name in ('participant_count', 'session_count', 'part_no', 'consent_version', 'request_hash', 'reason',
                 'purpose_type', 'identity', 'scope_org_id', 'event_id'):
        op.drop_column('data_export_audits', name)
