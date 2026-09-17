"""SDD-079 상담사 다중 기관 소속 — user_org_memberships 테이블 + 백필

Revision ID: e036a0000011
Revises: e036a0000010
Create Date: 2026-09-17
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = 'e036a0000011'
down_revision = 'e036a0000010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_org_memberships',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('org_id', UUID(as_uuid=True),
                  sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='counselor'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='invited'),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('invited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('invite_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_user_org_memberships_user_id', 'user_org_memberships', ['user_id'])
    op.create_index('ix_user_org_memberships_org_id', 'user_org_memberships', ['org_id'])
    # 동일 기관 중복 소속 방지 — left 이력은 제외해 재가입을 허용한다
    op.create_index(
        'uq_membership_user_org_alive', 'user_org_memberships', ['user_id', 'org_id'],
        unique=True, postgresql_where=sa.text("status != 'left'"),
    )
    # 주 소속은 user 당 active 소속 중 1개만
    op.create_index(
        'uq_membership_primary_active', 'user_org_memberships', ['user_id'],
        unique=True, postgresql_where=sa.text("is_primary AND status = 'active'"),
    )

    # ------------------------------------------------------------------
    # 백필 (T2): User.org_id 보유 counselor/org_admin → membership 이관
    #  - active 계정 → status=active, is_primary=True, joined_at=created_at 근사
    #  - pending 초대 계정 → status=invited (invited_at/expires 이관)
    # ------------------------------------------------------------------
    conn = op.get_bind()
    users = conn.execute(sa.text(
        "SELECT id, org_id, role, status, invited_at, invite_expires_at, created_at "
        "FROM users WHERE org_id IS NOT NULL AND role IN ('counselor', 'org_admin')"
    )).mappings().all()

    membership = sa.table(
        'user_org_memberships',
        sa.column('id'), sa.column('user_id'), sa.column('org_id'), sa.column('role'),
        sa.column('status'), sa.column('is_primary'), sa.column('invited_at'),
        sa.column('invite_expires_at'), sa.column('joined_at'),
    )
    rows = []
    for u in users:
        pending = u['status'] == 'pending'
        rows.append({
            'id': uuid.uuid4(),
            'user_id': u['id'],
            'org_id': u['org_id'],
            'role': u['role'],
            'status': 'invited' if pending else 'active',
            'is_primary': not pending,
            'invited_at': u['invited_at'],
            'invite_expires_at': u['invite_expires_at'],
            'joined_at': None if pending else u['created_at'],
        })
    if rows:
        op.bulk_insert(membership, rows)


def downgrade() -> None:
    op.drop_index('uq_membership_primary_active', table_name='user_org_memberships')
    op.drop_index('uq_membership_user_org_alive', table_name='user_org_memberships')
    op.drop_index('ix_user_org_memberships_org_id', table_name='user_org_memberships')
    op.drop_index('ix_user_org_memberships_user_id', table_name='user_org_memberships')
    op.drop_table('user_org_memberships')
