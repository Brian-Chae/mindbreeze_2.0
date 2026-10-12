"""SDD-071 데이터 내보내기 작업·감사 원장."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'e036a0000007'
down_revision = 'e036a0000006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('data_export_jobs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('requester_role', sa.String(length=20), nullable=False),
    sa.Column('session_id', sa.UUID(), nullable=False),
    sa.Column('participant_id', sa.UUID(), nullable=False),
    sa.Column('include', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('purpose', sa.Text(), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('schema_version', sa.String(length=30), nullable=False),
    sa.Column('consent_policy_version', sa.String(length=50), nullable=False),
    sa.Column('consent_eeg', sa.Boolean(), nullable=False),
    sa.Column('snapshot_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('object_key', sa.String(length=500), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('checksum', sa.String(length=64), nullable=True),
    sa.Column('completed_count', sa.Integer(), nullable=False),
    sa.Column('warnings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error_code', sa.String(length=60), nullable=True),
    sa.CheckConstraint("status IN ('queued','preparing','ready','ready_with_warnings','failed','expired','cancelled')", name='ck_data_export_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_data_export_idempotency')
    )
    op.create_index(op.f('ix_data_export_jobs_expires_at'), 'data_export_jobs', ['expires_at'], unique=False)
    op.create_index(op.f('ix_data_export_jobs_status'), 'data_export_jobs', ['status'], unique=False)
    op.create_index(op.f('ix_data_export_jobs_user_id'), 'data_export_jobs', ['user_id'], unique=False)
    op.create_table('data_export_audits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('export_id', sa.UUID(), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('session_id', sa.UUID(), nullable=False),
    sa.Column('participant_id', sa.UUID(), nullable=False),
    sa.Column('purpose', sa.Text(), nullable=False),
    sa.Column('policy_version', sa.String(length=50), nullable=False),
    sa.Column('event', sa.String(length=40), nullable=False),
    sa.Column('result', sa.String(length=60), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_data_export_audits_export_id'), 'data_export_audits', ['export_id'], unique=False)


def downgrade() -> None:
    op.drop_table('data_export_audits')
    op.drop_table('data_export_jobs')
