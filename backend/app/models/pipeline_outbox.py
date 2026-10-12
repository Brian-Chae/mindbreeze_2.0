"""종료 파이프라인 발행 Outbox — 발행 의도 durable 기록(트랜잭셔널 outbox).

세션 종료 시 STT·요약·병합·리포트 발행 의도를 세션 상태 전이와 같은 트랜잭션으로 기록한다.
발행(apply_async)이 실패하거나 프로세스가 발행 직전에 죽어도, beat 스윕이 미발행(pending) 건을
재발행한다. 아웃박스 행이 발행 멱등키 역할을 겸해 중복 체인 적재를 막는다.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PipelineOutbox(Base):
    __tablename__ = "pipeline_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # 체인 재구성에 필요한 플래그 (발행기는 이 플래그로 태스크 목록을 재구성)
    has_recording: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    needs_video_merge: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    needs_report: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # pending(발행 대기) / published(발행 완료) / failed(최대 재시도 초과)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
