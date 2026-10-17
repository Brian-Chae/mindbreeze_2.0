"""add updated_at to qualifications and careers

Revision ID: 30c1bfbc724f
Revises: d74027f66e1c
Create Date: 2026-05-27 13:44:44.691654

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '30c1bfbc724f'
down_revision: Union[str, Sequence[str], None] = 'd74027f66e1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _offline() -> bool:
    return op.get_context().as_sql


def _insp() -> sa.Inspector | None:
    """호출마다 새 인스펙터(캐시 없음)를 돌려준다. 오프라인(--sql) 렌더에서는 검사할 DB 가 없어 None."""
    if _offline():
        return None
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    insp = _insp()
    return insp is not None and insp.has_table(table)


def _column(table: str, name: str) -> dict | None:
    insp = _insp()
    if insp is None or not insp.has_table(table):
        return None
    return next((c for c in insp.get_columns(table) if c["name"] == name), None)


def _has_index(table: str, name: str) -> bool:
    insp = _insp()
    if insp is None or not insp.has_table(table):
        return False
    return any(i["name"] == name for i in insp.get_indexes(table))


def _has_fk(table: str, column: str, referred_table: str) -> bool:
    insp = _insp()
    if insp is None or not insp.has_table(table):
        return False
    return any(
        fk["constrained_columns"] == [column] and fk["referred_table"] == referred_table
        for fk in insp.get_foreign_keys(table)
    )


def _add_column(table: str, column: sa.Column) -> None:
    if _column(table, column.name) is None:
        op.add_column(table, column)


def upgrade() -> None:
    """Upgrade schema.

    이 리비전은 create_all 로 만들어진 DB 위에서 autogenerate 된 캐치업이라, 빈 DB 에서 체인을 처음부터
    적용하면 앞선 리비전이 이미 만든 테이블·컬럼을 다시 만들어 실패한다(SDD-211 P0). 리비전 id·체인은
    그대로 두고 각 변경을 존재 검사로 감싸 멱등화한다 — 이미 적용된 DB 는 이 리비전을 다시 실행하지 않으므로
    동작이 달라지지 않고, 빈 DB 에서는 아직 없는 변경(careers/qualifications.updated_at,
    careers.role 길이 100, careers.is_current NOT NULL)만 반영된다.
    """
    if not _has_table('chat_room_participants'):
        op.create_table('chat_room_participants',
        sa.Column('room_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['room_id'], ['chat_rooms.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('room_id', 'user_id')
        )
    _add_column('careers', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    role = _column('careers', 'role')
    if role is None or getattr(role['type'], 'length', None) != 100:
        op.alter_column('careers', 'role',
                   existing_type=sa.VARCHAR(length=200),
                   type_=sa.String(length=100),
                   existing_nullable=True)
    is_current = _column('careers', 'is_current')
    if is_current is None or is_current['nullable']:
        op.alter_column('careers', 'is_current',
                   existing_type=sa.BOOLEAN(),
                   nullable=False)
    if _offline() or _has_index('chat_messages', 'ix_chat_messages_room_created'):
        op.drop_index(op.f('ix_chat_messages_room_created'), table_name='chat_messages')
    _add_column('chat_rooms', sa.Column('room_type', sa.String(length=20), nullable=False))
    _add_column('chat_rooms', sa.Column('host_id', sa.UUID(), nullable=True))
    _add_column('chat_rooms', sa.Column('name', sa.String(length=120), nullable=True))
    chat_session_id = _column('chat_rooms', 'session_id')
    if chat_session_id is None or not chat_session_id['nullable']:
        op.alter_column('chat_rooms', 'session_id',
                   existing_type=sa.UUID(),
                   nullable=True)
    if not _has_fk('chat_rooms', 'host_id', 'users'):
        op.create_foreign_key(None, 'chat_rooms', 'users', ['host_id'], ['id'])
    _add_column('qualifications', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    _add_column('session_participants', sa.Column('is_waitlisted', sa.Boolean(), nullable=False))
    _add_column('session_participants', sa.Column('waitlist_position', sa.Integer(), nullable=True))
    _add_column('session_records', sa.Column('status', sa.String(length=20), nullable=False))
    _add_column('session_records', sa.Column('audio_s3_key', sa.String(length=500), nullable=True))
    _add_column('session_records', sa.Column('recording_started_at', sa.DateTime(timezone=True), nullable=True))
    _add_column('session_records', sa.Column('recording_ended_at', sa.DateTime(timezone=True), nullable=True))
    _add_column('users', sa.Column('status', sa.String(length=20), server_default='active', nullable=False))
    _add_column('users', sa.Column('notification_preferences', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    _add_column('users', sa.Column('auth_provider', sa.String(length=20), server_default='email', nullable=False))
    _add_column('verification_audits', sa.Column('target_type', sa.String(length=30), nullable=True))
    _add_column('verification_audits', sa.Column('target_id', sa.UUID(), nullable=True))
    credential_id = _column('verification_audits', 'credential_id')
    if credential_id is None or not credential_id['nullable']:
        op.alter_column('verification_audits', 'credential_id',
                   existing_type=sa.UUID(),
                   nullable=True)
    action = _column('verification_audits', 'action')
    if action is None or getattr(action['type'], 'length', None) != 30:
        op.alter_column('verification_audits', 'action',
                   existing_type=sa.VARCHAR(length=20),
                   type_=sa.String(length=30),
                   existing_nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column('verification_audits', 'action',
               existing_type=sa.String(length=30),
               type_=sa.VARCHAR(length=20),
               existing_nullable=False)
    op.alter_column('verification_audits', 'credential_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('verification_audits', 'target_id')
    op.drop_column('verification_audits', 'target_type')
    op.drop_column('users', 'auth_provider')
    op.drop_column('users', 'notification_preferences')
    op.drop_column('users', 'status')
    op.drop_column('session_records', 'recording_ended_at')
    op.drop_column('session_records', 'recording_started_at')
    op.drop_column('session_records', 'audio_s3_key')
    op.drop_column('session_records', 'status')
    op.drop_column('session_participants', 'waitlist_position')
    op.drop_column('session_participants', 'is_waitlisted')
    op.drop_column('qualifications', 'updated_at')
    op.drop_constraint(None, 'chat_rooms', type_='foreignkey')
    op.alter_column('chat_rooms', 'session_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('chat_rooms', 'name')
    op.drop_column('chat_rooms', 'host_id')
    op.drop_column('chat_rooms', 'room_type')
    op.create_index(op.f('ix_chat_messages_room_created'), 'chat_messages', ['room_id', 'created_at'], unique=False)
    op.alter_column('careers', 'is_current',
               existing_type=sa.BOOLEAN(),
               nullable=True)
    op.alter_column('careers', 'role',
               existing_type=sa.String(length=100),
               type_=sa.VARCHAR(length=200),
               existing_nullable=True)
    op.drop_column('careers', 'updated_at')
    op.drop_table('chat_room_participants')
    # ### end Alembic commands ###
