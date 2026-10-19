"""연구 목적 데이터 활용 동의 (SDD-209 B11 / BE-R1 · MG-5).

- ``research_consents``: 참여자별 **현재 상태**(1행). 기본은 기록 없음 = 미동의.
- ``research_consent_events``: **불변(append-only)** 이력 — 변경 시 이전/이후/시각/주체. 수정·삭제 시도는 예외.
- ``research_withdrawal_requests``: 플랫폼 관리자 철회 요청 기록(Spark 측 삭제 확인 시각 포함).

세션/참여자 FK 를 두지 않는다(CASCADE 금지) — 가명 ID 해시는 개인정보 스크럽·세션 숨김 뒤에도 철회 대조에 필요하다.
이름 원문과 생년월일의 일(日)은 저장하지 않는다(N-4: 연·월만, ``birth_year_month``).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, event, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ResearchConsent(Base):
    __tablename__ = "research_consents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    # SDD-217: 가입/기본값 선택 원본 연결. 기존 회차 동의를 가입 동의로 추정하지 않는다.
    origin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    consented: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 동의 시점에 본 고지 문구 버전
    notice_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # HMAC-SHA256(키, NFC(trim(이름)) + "|" + 생년월일) 16진 64자. 키 미설정/식별정보 부족이면 NULL.
    research_subject_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # N-4: 생년월일은 연·월(YYYY-MM)만. 성별은 동의 시점 값을 함께 보관(기본 DB 개인정보 스크럽 뒤에도 내보내기 가능).
    birth_year_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # not_applicable | pending | blocked_key_missing | blocked_identity_missing | blocked_withdrawn
    # | withdrawn | exported | acked   (exported/acked 는 B13 내보내기 배치가 갱신)
    export_state: Mapped[str] = mapped_column(String(30), nullable=False, default="not_applicable")
    # SDD-209(B12): 삭제 보류가 임계(RETENTION_HOLD_ALERT_DAYS)를 넘겨 운영 알림을 보낸 시각(중복 알림 방지)
    hold_alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ResearchConsentEvent(Base):
    __tablename__ = "research_consent_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # consented | declined | withdrawn
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    previous_consented: Mapped[bool] = mapped_column(Boolean, nullable=False)
    new_consented: Mapped[bool] = mapped_column(Boolean, nullable=False)
    notice_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # self | platform_admin
    actor_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="self")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


@event.listens_for(ResearchConsentEvent, "before_update")
def _forbid_event_update(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("연구 동의 이력은 수정할 수 없습니다(append-only)")


@event.listens_for(ResearchConsentEvent, "before_delete")
def _forbid_event_delete(mapper, connection, target) -> None:  # noqa: ARG001
    raise ValueError("연구 동의 이력은 삭제할 수 없습니다(append-only)")


class ResearchWithdrawalRequest(Base):
    __tablename__ = "research_withdrawal_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    research_subject_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    affected_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 연구 DB(Spark) 측 삭제 실행 확인 시각 — Spark 운영 스크립트 수행 후 기록(이 SDD 범위 밖).
    spark_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
