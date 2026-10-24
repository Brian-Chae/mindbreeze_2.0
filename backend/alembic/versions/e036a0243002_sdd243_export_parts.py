"""SDD-243 M243-2: ZIP part 원장과 큐 적재 outbox(additive).

- data_export_parts: unique(job_id, part_no), size ≤ 1,000,000,000B CHECK. object 참조는 API 비노출.
- data_export_dispatch_outbox: job 당 1행(unique). job 생성 트랜잭션에 함께 커밋되고 cron 이 재전달한다.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e036a0243002'
down_revision = 'e036a0243001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'data_export_parts',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('part_no', sa.Integer(), nullable=False),
        sa.Column('object_key', sa.String(length=500), nullable=True),
        sa.Column('object_version', sa.String(length=200), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('checksum', sa.String(length=64), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('part_no >= 1', name='ck_data_export_part_no'),
        sa.CheckConstraint('size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 1000000000)', name='ck_data_export_part_size'),
        sa.CheckConstraint("status IN ('pending','building','ready','failed','expired')", name='ck_data_export_part_status'),
        sa.ForeignKeyConstraint(['job_id'], ['data_export_jobs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_id', 'part_no', name='uq_data_export_part_no'),
    )
    op.create_index(op.f('ix_data_export_parts_job_id'), 'data_export_parts', ['job_id'], unique=False)

    op.create_table(
        'data_export_dispatch_outbox',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('job_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='pending', nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending','delivering','published')", name='ck_data_export_outbox_status'),
        sa.ForeignKeyConstraint(['job_id'], ['data_export_jobs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_id'),
    )
    op.create_index('ix_data_export_outbox_status_next', 'data_export_dispatch_outbox', ['status', 'next_attempt_at'], unique=False)


def downgrade() -> None:
    op.drop_table('data_export_dispatch_outbox')
    op.drop_table('data_export_parts')
