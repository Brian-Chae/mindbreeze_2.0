"""SDD-246 T03 — 실시간 v2 영속 상태 (additive).

- LiveSessionEpoch: 회차별 epoch·durable revision 카운터. 회차 직렬화 락(행 락)의 대상이기도 하다.
- LiveCommandLedger: (session, actor, command_id) 멱등 원장. 같은 ID·같은 body_hash 면 원 결과를 돌려준다.
- LiveOutbox: 명령 트랜잭션과 같은 commit 으로 쌓이는 projection 대기 이벤트(T04 가 소비). 민감 원문 금지.
- CaptureStream: 수집 stream 등록(세대·fencing·lease·clock anchor·종료 cutoff).

Redis 는 정본이 아니다. 이 4개 테이블이 명령 결과와 순서의 정본이다.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LiveSessionEpoch(Base):
    __tablename__ = "live_session_epoch"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    # Redis 전체 소실 재구축 시 증가. 이전 epoch 의 ACK/snapshot 이 현재 상태를 덮지 못하게 한다.
    epoch: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    # 회차 내 durable revision(outbox 순서). 명령 트랜잭션 안에서 행 락 아래 증가한다.
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    # 권한회수(추방·동의철회·종료) 시 증가. 모든 emit 직전 scope 검사 기준.
    auth_revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class LiveCommandLedger(Base):
    __tablename__ = "live_command_ledger"
    __table_args__ = (
        UniqueConstraint("session_id", "actor_id", "command_id", name="uq_live_command_ledger_cmd"),
        Index("ix_live_command_ledger_session_rev", "session_id", "revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    # 계정은 user_id, 게스트는 participant_id (호출자 T05 가 정한 불변 식별자). system 은 고정 UUID.
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    command_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)  # applied | rejected
    code: Mapped[str | None] = mapped_column(String(64))
    epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 이 명령이 커밋된 시점의 회차 durable revision(= 명령 outbox 의 마지막 revision 또는 직전 값).
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    entity_version: Mapped[int | None] = mapped_column(BigInteger)
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LiveOutbox(Base):
    __tablename__ = "live_outbox"
    __table_args__ = (
        UniqueConstraint("session_id", "revision", name="uq_live_outbox_session_revision"),
        Index(
            "ix_live_outbox_pending",
            "session_id",
            "revision",
            postgresql_where=text("processed_at IS NULL"),
            sqlite_where=text("processed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    domain: Mapped[str] = mapped_column(String(16), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64))
    entity_version: Mapped[int | None] = mapped_column(BigInteger)
    # 허용 audience 목록: ["host","public","member:<participant uuid>"] — 서버 생성 불투명 ID 만.
    audience_policy: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    command_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CaptureStream(Base):
    __tablename__ = "capture_stream"
    __table_args__ = (
        UniqueConstraint("participant_id", "generation", name="uq_capture_stream_participant_generation"),
        # 참가자당 활성 stream 은 하나(fencing). 인계 시 이전 stream 은 먼저 superseded 로 닫힌다.
        Index(
            "uq_capture_stream_active_participant",
            "participant_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_capture_stream_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    participant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("session_participants.id", ondelete="CASCADE"), nullable=False
    )
    owner_actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # 참가자별 서버 등록 순서(= fencing 세대). 오래된 owner 는 live 최신값 갱신 금지.
    generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # active | closed | superseded | ended(회차 종료 cutoff, close 대기) | revoked(추방·동의철회)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    device_profile: Mapped[str] = mapped_column(String(64), nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    # 서버 서명 시계 anchor — 클라이언트 wall clock 은 신뢰하지 않는다.
    clock_anchor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    clock_probe_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    anchor_device_ticks: Mapped[int | None] = mapped_column(BigInteger)
    anchor_monotonic_us: Mapped[int | None] = mapped_column(BigInteger)
    anchor_server_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clock_uncertainty_ms: Mapped[int | None] = mapped_column(Integer)
    clock_uncertain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # 온라인 lease 30초(renew 5초), 오프라인 구간 상한은 마지막 서명 후 최대 10분.
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    offline_bound_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    close_reason: Mapped[str | None] = mapped_column(String(64))
    # 종료 cutoff: 회차 종료/추방/동의철회 확정 시각. 이후 시각에 속한 창은 수락하지 않는다.
    cutoff_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 권한 코드: completed(수료·정상 종료) 와 expelled/consent_withdrawn 은 별개.
    cutoff_code: Mapped[str | None] = mapped_column(String(32))
    close_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    final_sequences: Mapped[dict | None] = mapped_column(JSONB)
    entity_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
