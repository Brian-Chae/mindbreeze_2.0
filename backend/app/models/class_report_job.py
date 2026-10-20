"""SDD-218 클래스 리포트 일괄 작업 (승인·재생성·메일 재발송).

설계 근거는 plan.md §2·§3.
- 접수 멱등: (actor_id, operation_key) 유니크 + request_hash 불일치 시 409
- 건별 멱등: (job_id, report_id) 유니크로 워커 재시도 중복 처리 차단
- 재시도 가능한 실패(`failed`)와 정책상 처리 제외(`excluded`)를 분리한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# 일괄 작업 종류
JOB_ACTIONS = ("approve", "regenerate", "resend_email")
# 작업 전체 상태
JOB_STATUSES = ("accepted", "running", "completed")
# 건별 결과. failed 만 재시도 대상이다.
ITEM_STATES = ("pending", "succeeded", "failed", "excluded")
# excluded 사유 — 재시도해도 결과가 달라지지 않는 정책적 제외
EXCLUDED_REASONS = ("absent", "consent_withdrawn", "not_target", "forbidden")


class ClassReportJob(Base):
    """일괄 작업 1건. 접수 시점에 생성되고 202 로 응답한다."""

    __tablename__ = "class_report_jobs"
    __table_args__ = (
        UniqueConstraint("actor_id", "operation_key", name="uq_class_report_jobs_actor_operation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="accepted", server_default="accepted", index=True
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # 대행 승인 여부. approved_by_user_id 에는 언제나 실제 승인자가 들어가고,
    # 이 플래그가 "주강사가 타인 진행 회차를 대신 승인했다"는 사실을 남긴다 (D-36).
    on_behalf: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )
    operation_key: Mapped[str] = mapped_column(String(100), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    accepted_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ClassReportJobItem(Base):
    """일괄 작업의 건별 결과. (job_id, report_id) 는 유일하다."""

    __tablename__ = "class_report_job_items"
    __table_args__ = (
        UniqueConstraint("job_id", "report_id", name="uq_class_report_job_items_job_report"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("class_report_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reports.id", ondelete="RESTRICT"), nullable=False
    )
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending", index=True
    )
    # excluded 사유 또는 failed 원인 코드
    reason_code: Mapped[str | None] = mapped_column(String(40))
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    error_message: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
