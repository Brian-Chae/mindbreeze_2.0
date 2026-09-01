"""Session & SessionParticipant Models"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, DateTime, Text, Boolean, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # clinical, hypnosis, meditation, custom
    custom_type_name: Mapped[str | None] = mapped_column(String(30))  # type=custom 시 필수
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # SDD-015: 즉석 클래스는 일정 없이 생성되므로 nullable
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-015: 참여자가 입력하는 6자리 클래스 코드 (생성 시 자동 발급)
    access_code: Mapped[str | None] = mapped_column(String(6), unique=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    max_participants: Mapped[int] = mapped_column(Integer, default=1)
    # 진행 형태 설정
    location_type: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")  # online, offline
    participant_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="one_on_one")  # one_on_one, group
    linkband_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="none")  # none, required, optional
    # 온라인(WebRTC) 설정 — location_type=online 시 자동 생성
    webrtc_room_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    sfu_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    host = relationship("User", back_populates="hosted_sessions", foreign_keys=[host_id])
    participants = relationship("SessionParticipant", back_populates="session", cascade="all, delete-orphan")
    record = relationship("SessionRecord", back_populates="session", uselist=False, cascade="all, delete-orphan")
    eeg_records = relationship("EEGRecord", back_populates="session", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="session", cascade="all, delete-orphan")


class SessionParticipant(Base):
    __tablename__ = "session_participants"

    # SDD-015: 게스트는 user_id가 NULL이므로 복합 PK를 유지할 수 없다.
    # 대리 키(id)를 PK로 두고 (session_id, user_id)는 UNIQUE 제약으로 강등한다.
    # PostgreSQL의 UNIQUE는 NULL을 서로 다른 값으로 취급하므로 게스트 중복 참여가 허용된다.
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_session_participant_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    # SDD-015: 회원가입 없이 참여하는 게스트의 표시 이름 (user_id가 NULL일 때만 사용)
    guest_name: Mapped[str | None] = mapped_column(String(100))
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    band_connected: Mapped[bool] = mapped_column(Boolean, default=False)  # LINK BAND 실연결 여부
    linkband_device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    webrtc_peer_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    consent_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_eeg: Mapped[bool] = mapped_column(Boolean, default=False)
    is_waitlisted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    waitlist_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    session = relationship("Session", back_populates="participants")
