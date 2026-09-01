"""sdd-015 class code lite: org_code, access_code, guest participants

Revision ID: 881a08fbe584
Revises: 001fd31549c5
Create Date: 2026-09-01 22:44:01.044498

SDD-015 라이트 모델 스키마 변경:
  1. organizations.org_code — 상담사 가입에 쓰는 6자리 기관 코드
     (system_admin 간이 등록을 위해 사업자 정보 3종을 nullable로 완화)
  2. sessions.access_code / started_at / ended_at + scheduled_at nullable
     (일정 없이 "시작" 버튼으로 진행하는 즉석 클래스)
  3. session_participants 게스트 지원 — user_id nullable + guest_name
     user_id가 PK 구성 컬럼이라 NULL을 넣을 수 없으므로 대리 키(id)를 PK로 승격하고
     (session_id, user_id)는 UNIQUE 제약으로 강등한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '881a08fbe584'
down_revision: Union[str, Sequence[str], None] = '001fd31549c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- 1) organizations: 기관 코드 + 사업자 정보 nullable 완화 ---
    op.add_column("organizations", sa.Column("org_code", sa.String(length=6), nullable=True))
    op.create_index("ix_organizations_org_code", "organizations", ["org_code"], unique=True)
    op.alter_column("organizations", "ceo_name", existing_type=sa.String(length=100), nullable=True)
    op.alter_column("organizations", "biz_number", existing_type=sa.String(length=10), nullable=True)
    op.alter_column("organizations", "address", existing_type=sa.String(length=300), nullable=True)

    # --- 2) sessions: 클래스 코드 + 시작/종료 시각 + 일정 nullable ---
    op.add_column("sessions", sa.Column("access_code", sa.String(length=6), nullable=True))
    op.add_column("sessions", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sessions_access_code", "sessions", ["access_code"], unique=True)
    op.alter_column(
        "sessions", "scheduled_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )

    # --- 3) session_participants: 게스트 참여 지원 ---
    op.add_column(
        "session_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "session_participants", sa.Column("guest_name", sa.String(length=100), nullable=True)
    )
    op.add_column(
        "session_participants",
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
    )
    # 기존 행에 대리 키 값을 채운 뒤 NOT NULL로 승격
    op.execute("UPDATE session_participants SET id = gen_random_uuid() WHERE id IS NULL")
    op.alter_column(
        "session_participants", "id", existing_type=postgresql.UUID(as_uuid=True), nullable=False
    )

    # 복합 PK 해제 → 대리 키 PK + (session_id, user_id) UNIQUE
    op.drop_constraint("session_participants_pkey", "session_participants", type_="primary")
    op.create_primary_key("session_participants_pkey", "session_participants", ["id"])
    op.alter_column(
        "session_participants",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_unique_constraint(
        "uq_session_participant_user", "session_participants", ["session_id", "user_id"]
    )
    op.create_index(
        "ix_session_participants_session_id", "session_participants", ["session_id"]
    )
    op.create_index("ix_session_participants_user_id", "session_participants", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    # --- 3) session_participants 되돌리기 ---
    # 게스트 행(user_id IS NULL)은 복합 PK로 되돌릴 수 없으므로 제거한다.
    op.execute("DELETE FROM session_participants WHERE user_id IS NULL")
    op.drop_index("ix_session_participants_user_id", table_name="session_participants")
    op.drop_index("ix_session_participants_session_id", table_name="session_participants")
    op.drop_constraint("uq_session_participant_user", "session_participants", type_="unique")
    op.alter_column(
        "session_participants",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_constraint("session_participants_pkey", "session_participants", type_="primary")
    op.create_primary_key(
        "session_participants_pkey", "session_participants", ["session_id", "user_id"]
    )
    op.drop_column("session_participants", "joined_at")
    op.drop_column("session_participants", "guest_name")
    op.drop_column("session_participants", "id")

    # --- 2) sessions 되돌리기 ---
    # scheduled_at 을 NOT NULL로 되돌리기 전에 즉석 클래스는 생성 시각으로 채운다.
    op.execute("UPDATE sessions SET scheduled_at = created_at WHERE scheduled_at IS NULL")
    op.alter_column(
        "sessions", "scheduled_at", existing_type=sa.DateTime(timezone=True), nullable=False
    )
    op.drop_index("ix_sessions_access_code", table_name="sessions")
    op.drop_column("sessions", "ended_at")
    op.drop_column("sessions", "started_at")
    op.drop_column("sessions", "access_code")

    # --- 1) organizations 되돌리기 ---
    op.execute("UPDATE organizations SET ceo_name = '' WHERE ceo_name IS NULL")
    op.execute("UPDATE organizations SET address = '' WHERE address IS NULL")
    op.alter_column("organizations", "address", existing_type=sa.String(length=300), nullable=False)
    op.alter_column("organizations", "biz_number", existing_type=sa.String(length=10), nullable=False)
    op.alter_column("organizations", "ceo_name", existing_type=sa.String(length=100), nullable=False)
    op.drop_index("ix_organizations_org_code", table_name="organizations")
    op.drop_column("organizations", "org_code")
