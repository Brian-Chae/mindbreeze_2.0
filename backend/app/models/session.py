"""Session & SessionParticipant Models"""

import uuid
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, Text, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # clinical, hypnosis, meditation
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    max_participants: Mapped[int] = mapped_column(Integer, default=1)
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
    band_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_eeg: Mapped[bool] = mapped_column(Boolean, default=False)

    session = relationship("Session", back_populates="participants")
