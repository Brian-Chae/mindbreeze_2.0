"""SDD-209 B11: 연구 동의 모델 (MG-5)

신규 테이블 3종(추가형):
- research_consents: 참여자별 현재 상태(참여자 1행, 가명 ID·key_version·생년월·성별·export_state)
- research_consent_events: 불변 이력(append-only)
- research_withdrawal_requests: 플랫폼 관리자 철회 요청 기록

세션/참여자 FK 를 걸지 않는다(CASCADE 금지) — 가명 ID 해시는 개인정보 스크럽·세션 숨김 뒤에도 철회 대조에 필요.
기존 행·테이블은 변경하지 않는다(기록 없음 = 미동의). 다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않는다).

Revision ID: e036a0000047
Revises: e036a0000046
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e036a0000047"
down_revision: Union[str, Sequence[str], None] = "e036a0000046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_consents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consented", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notice_version", sa.String(20), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("research_subject_id", sa.String(64), nullable=True),
        sa.Column("key_version", sa.Integer(), nullable=True),
        sa.Column("birth_year_month", sa.String(7), nullable=True),
        sa.Column("gender", sa.String(20), nullable=True),
        sa.Column("export_state", sa.String(30), nullable=False, server_default="not_applicable"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("participant_id", name="uq_research_consents_participant"),
    )
    op.create_index("ix_research_consents_session_id", "research_consents", ["session_id"])
    op.create_index("ix_research_consents_research_subject_id", "research_consents", ["research_subject_id"])

    op.create_table(
        "research_consent_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("participant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("previous_consented", sa.Boolean(), nullable=False),
        sa.Column("new_consented", sa.Boolean(), nullable=False),
        sa.Column("notice_version", sa.String(20), nullable=True),
        sa.Column("actor_kind", sa.String(20), nullable=False, server_default="self"),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_research_consent_events_session_id", "research_consent_events", ["session_id"])
    op.create_index("ix_research_consent_events_participant_id", "research_consent_events", ["participant_id"])

    op.create_table(
        "research_withdrawal_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("research_subject_id", sa.String(64), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("affected_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("spark_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_research_withdrawal_requests_research_subject_id", "research_withdrawal_requests", ["research_subject_id"]
    )
    op.create_index("ix_research_withdrawal_requests_requested_by", "research_withdrawal_requests", ["requested_by"])


def downgrade() -> None:
    op.drop_table("research_withdrawal_requests")
    op.drop_table("research_consent_events")
    op.drop_table("research_consents")
