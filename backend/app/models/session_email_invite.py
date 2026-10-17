"""비회원 이메일 초대 (SDD-209 B14 / BE-R4 · MG-7).

상담사가 비회원 이메일로 클래스 초대(4자리 코드 안내)를 요청한 기록이다. 알림 아웃박스는 ``user_id`` 가 필수라
비회원에게 쓸 수 없어 별도 테이블을 둔다.

- ``status``: ``queued``(큐 투입) → ``requested``(Resend 2xx 접수 — **전달·수신 확인이 아니다**) | ``failed``.
- 보관 기간이 지나면 보관 스위프(B12)가 ``email``/``email_norm`` 을 비운다(행·세션 참조는 유지, ``pii_scrubbed_at`` 기록).
- 세션 하드 삭제(플랫폼 관리자 전용)에는 함께 삭제되도록 세션 FK 는 CASCADE 다.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SessionEmailInvite(Base):
    __tablename__ = "session_email_invites"
    __table_args__ = (
        # 같은 클래스에 같은 주소는 1행(재발송은 같은 행을 갱신). 스크럽 후 NULL 은 중복 허용.
        UniqueConstraint("session_id", "email_norm", name="uq_session_email_invite"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    email_norm: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # queued | requested | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", server_default="queued")
    last_error: Mapped[str | None] = mapped_column(String(100), nullable=True)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # 마지막으로 큐에 넣은 시각(쿨다운·적체 감지 기준) / Resend 접수 시각
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pii_scrubbed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
