"""SDD-243 M243-1: 데이터 센터 일괄 작업 범위·preview·고정 대상(additive).

- data_export_jobs: kind/scope_org_id/identity/purpose_type/reason/policy/lease 등 컬럼 추가(전부 nullable 또는 default).
  단건(legacy) 필수 컬럼 session_id/participant_id/consent_eeg 는 nullable 로 풀고 CHECK 로 단건에만 필수 유지.
- data_export_previews / data_export_targets 신규. 원천(session/participant) FK 와 cascade 없음.
- rollback: 센터 capability(data_center_enabled) 비활성. 데이터/열 삭제·자동 downgrade 없음(downgrade 는 신규 객체 제거만).

통합 시 down_revision 은 244 마이그레이션 헤드 뒤로 재체인한다(통합 담당).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e036a0243001'
down_revision = 'e036a0000061'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('data_export_jobs', sa.Column('kind', sa.String(length=20), nullable=False, server_default='single'))
    op.add_column('data_export_jobs', sa.Column('scope_org_id', sa.UUID(), nullable=True))
    op.add_column('data_export_jobs', sa.Column('export_scope', sa.String(length=20), nullable=True))
    op.add_column('data_export_jobs', sa.Column('identity', sa.String(length=20), nullable=True))
    op.add_column('data_export_jobs', sa.Column('purpose_type', sa.String(length=20), nullable=True))
    op.add_column('data_export_jobs', sa.Column('reason', sa.Text(), nullable=True))
    op.add_column('data_export_jobs', sa.Column('policy_version', sa.String(length=50), nullable=True))
    op.add_column('data_export_jobs', sa.Column('policy_hash', sa.String(length=64), nullable=True))
    op.add_column('data_export_jobs', sa.Column('preview_id', sa.UUID(), nullable=True))
    op.add_column('data_export_jobs', sa.Column('target_count', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('data_export_jobs', sa.Column('participant_total', sa.Integer(), nullable=True))
    op.add_column('data_export_jobs', sa.Column('auth_epoch', sa.Integer(), nullable=True))
    op.add_column('data_export_jobs', sa.Column('lease_owner', sa.String(length=64), nullable=True))
    op.add_column('data_export_jobs', sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('data_export_jobs', sa.Column('fencing_token', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('data_export_jobs', sa.Column('expected_part_count', sa.Integer(), nullable=True))
    op.alter_column('data_export_jobs', 'session_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('data_export_jobs', 'participant_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('data_export_jobs', 'consent_eeg', existing_type=sa.Boolean(), nullable=True)
    op.create_check_constraint('ck_data_export_kind', 'data_export_jobs', "kind IN ('single','data_center')")
    op.create_check_constraint(
        'ck_data_export_single_required', 'data_export_jobs',
        "kind <> 'single' OR (session_id IS NOT NULL AND participant_id IS NOT NULL AND consent_eeg IS NOT NULL)")
    op.create_index(op.f('ix_data_export_jobs_scope_org_id'), 'data_export_jobs', ['scope_org_id'], unique=False)

    op.create_table(
        'data_export_previews',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('scope_org_id', sa.UUID(), nullable=True),
        sa.Column('export_scope', sa.String(length=20), nullable=False),
        sa.Column('target_id', sa.UUID(), nullable=False),
        sa.Column('purpose_type', sa.String(length=20), nullable=False),
        sa.Column('identity', sa.String(length=20), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('request', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
        sa.Column('session_count', sa.Integer(), nullable=False),
        sa.Column('participant_count', sa.Integer(), nullable=False),
        sa.Column('estimated_bytes', sa.BigInteger(), nullable=True),
        sa.Column('estimated_part_count', sa.Integer(), nullable=True),
        sa.Column('exclusions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('exclusion_counts', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('policy_version', sa.String(length=50), nullable=False),
        sa.Column('policy_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_job_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )
    op.create_index(op.f('ix_data_export_previews_expires_at'), 'data_export_previews', ['expires_at'], unique=False)
    op.create_index('ix_data_export_previews_actor_created', 'data_export_previews', ['actor_id', 'created_at'], unique=False)

    op.create_table(
        'data_export_targets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('preview_id', sa.UUID(), nullable=True),
        sa.Column('job_id', sa.UUID(), nullable=True),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=False),
        sa.Column('participant_id', sa.UUID(), nullable=False),
        sa.Column('manifest_revision', sa.Integer(), nullable=True),
        sa.Column('source_deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('consent_state', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['preview_id'], ['data_export_previews.id']),
        sa.ForeignKeyConstraint(['job_id'], ['data_export_jobs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_id', 'session_id', 'participant_id', name='uq_data_export_target_job'),
        sa.UniqueConstraint('preview_id', 'session_id', 'participant_id', name='uq_data_export_target_preview'),
    )
    op.create_index('ix_data_export_targets_job_ordinal', 'data_export_targets', ['job_id', 'ordinal'], unique=False)
    op.create_index('ix_data_export_targets_preview_ordinal', 'data_export_targets', ['preview_id', 'ordinal'], unique=False)


def downgrade() -> None:
    # 신규 객체만 제거한다. 일괄 작업이 이미 쌓였다면 운영 승인 후 수동 판단(자동 downgrade 금지).
    op.drop_table('data_export_targets')
    op.drop_table('data_export_previews')
    op.drop_index(op.f('ix_data_export_jobs_scope_org_id'), table_name='data_export_jobs')
    op.drop_constraint('ck_data_export_single_required', 'data_export_jobs', type_='check')
    op.drop_constraint('ck_data_export_kind', 'data_export_jobs', type_='check')
    for col in ('expected_part_count', 'fencing_token', 'lease_expires_at', 'lease_owner', 'auth_epoch', 'participant_total',
                'target_count', 'preview_id', 'policy_hash', 'policy_version', 'reason', 'purpose_type', 'identity',
                'export_scope', 'scope_org_id', 'kind'):
        op.drop_column('data_export_jobs', col)
