"""User Model"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # counselor, client, org_admin, platform_admin
    phone: Mapped[str | None] = mapped_column(String(20))
    profile_image: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(Text)
    verified_tier: Mapped[str] = mapped_column(String(20), default="unverified")
    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    hosted_sessions = relationship("Session", back_populates="host", foreign_keys="Session.host_id")
    credentials = relationship("Credential", back_populates="user")
    notifications = relationship("Notification", back_populates="user")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    consents = relationship("Consent", back_populates="user", cascade="all, delete-orphan")
    onboarding_progress = relationship("OnboardingProgress", back_populates="user", uselist=False, cascade="all, delete-orphan")
    counselor_links = relationship("ClientCounselorLink", foreign_keys="ClientCounselorLink.client_id", back_populates="client")
    client_links = relationship("ClientCounselorLink", foreign_keys="ClientCounselorLink.counselor_id", back_populates="counselor")
    password_history = relationship("PasswordHistory", back_populates="user", cascade="all, delete-orphan")
    counselor_profile = relationship("CounselorProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    client_profile = relationship("ClientProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    org = relationship("Organization", foreign_keys=[org_id])
