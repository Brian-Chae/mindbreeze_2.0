"""Session & SessionParticipant Models"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String, Integer, DateTime, Text, Boolean, ForeignKey, func
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
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
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

    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    band_connected: Mapped[bool] = mapped_column(Boolean, default=False)  # LINK BAND 실연결 여부
    linkband_device_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    webrtc_peer_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    consent_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_eeg: Mapped[bool] = mapped_column(Boolean, default=False)
    is_waitlisted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    waitlist_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    session = relationship("Session", back_populates="participants")
