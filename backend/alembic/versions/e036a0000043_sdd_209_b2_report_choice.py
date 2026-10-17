"""SDD-209 B2: 리포트 반영 선택 — 참여자 선택값·고지 증빙 + 선택 이력

- session_participants.report_included: NOT NULL, 서버 기본값 false(기본 제외). 기존 행은 모두 제외.
- session_participants.report_notice_ack_at / report_notice_version: 고지 확인 증빙(이력과 분리).
- report_choice_events: 선택 변경 이력(append-only, FK 없음 — 부모 삭제/스크럽에 휩쓸리지 않음).

모두 추가형. 상수 기본값 add column 이라 PG 11+ 에서 테이블 재작성이 없다.
롤백: 코드 revert 만으로 구 코드가 동작한다(신규 컬럼은 구 코드가 무시). 다운그레이드는 drop 이므로
데이터 손실 — 운영 롤백에는 사용하지 않는다.

Revision ID: e036a0000043
Revises: e036a0000042
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "e036a0000043"
down_revision: Union[str, Sequence[str], None] = "e036a0000042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_participants",
        sa.Column("report_included", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "session_participants",
        sa.Column("report_notice_ack_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "session_participants",
        sa.Column("report_notice_version", sa.String(length=20), nullable=True),
    )
    op.create_table(
        "report_choice_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", UUID(as_uuid=True), nullable=False),
        sa.Column("participant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("previous_included", sa.Boolean(), nullable=False),
        sa.Column("new_included", sa.Boolean(), nullable=False),
        sa.Column("actor_kind", sa.String(length=20), nullable=False),
        sa.Column("actor_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_report_choice_events_session_id", "report_choice_events", ["session_id"])
    op.create_index(
        "ix_report_choice_events_participant_id", "report_choice_events", ["participant_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_report_choice_events_participant_id", table_name="report_choice_events")
    op.drop_index("ix_report_choice_events_session_id", table_name="report_choice_events")
    op.drop_table("report_choice_events")
    op.drop_column("session_participants", "report_notice_version")
    op.drop_column("session_participants", "report_notice_ack_at")
    op.drop_column("session_participants", "report_included")
