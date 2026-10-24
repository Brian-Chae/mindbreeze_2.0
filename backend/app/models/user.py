"""User Model"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, String, DateTime, Text, ForeignKey, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship


DEFAULT_NOTIFICATION_PREFERENCES: dict = {
    "email": {
        # 이메일 기본 ON — 일정·검증·소속·계정 등 중요 통지
        "session_booked": True,
        "session_updated": True,
        "session_cancelled": True,
        "session_invited": True,
        "verification_result": True,
        "organization_verification_result": True,
        "verification_requested": True,
        "organization_join_result": True,
        "organization_removed": True,
        "account_suspended": True,
        "account_reactivated": True,
        # 이메일 기본 OFF — 과다 발송 방지
        "session_ready": False,
        "session_opened": False,
        "session_started": False,
        "session_completed": False,
        "session_waitlist_promoted": False,
        "session_participant_removed": False,
        "session_deleted": False,
        "chat_message": False,
        "chat_room_created": False,
        "chat_room_invited": False,
        "chat_room_removed": False,
        "report_review_requested": False,
        "report_ready": True,
        "report_generation_failed": False,
        "report_low_confidence": False,
        "report_email_failed": False,
        "organization_join_requested": False,
        "organization_updated": False,
        "organization_deactivated": False,
        "organization_reactivated": False,
        "organization_role_changed": False,
        "counselor_profile_updated": False,
        "primary_admin_profile_updated": False,
        "personal_office_opened": False,
    },
    "in_app": {
        # 인앱 기본 ON — 전 이벤트
        "session_booked": True,
        "session_updated": True,
        "session_cancelled": True,
        "session_ready": True,
        "session_opened": True,
        "session_started": True,
        "session_completed": True,
        "session_invited": True,
        "session_waitlist_promoted": True,
        "session_participant_removed": True,
        "session_deleted": True,
        "chat_message": True,
        "chat_room_created": True,
        "chat_room_invited": True,
        "chat_room_removed": True,
        "report_review_requested": True,
        "report_ready": True,
        "report_generation_failed": True,
        "report_low_confidence": True,
        "report_email_failed": True,
        "verification_result": True,
        "organization_verification_result": True,
        "verification_requested": True,
        "organization_join_requested": True,
        "organization_join_result": True,
        "organization_updated": True,
        "organization_deactivated": True,
        "organization_reactivated": True,
        "organization_role_changed": True,
        "organization_removed": True,
        "counselor_profile_updated": True,
        "primary_admin_profile_updated": True,
        "account_suspended": True,
        "account_reactivated": True,
        "personal_office_opened": True,
    },
}

DEFAULT_NOTIFICATION_PREFERENCES["push"] = {
    "session_updated": True, "session_cancelled": True,
    "session_host_changed": True, "session_host_change_requested": True,
    "chat_message": True, "report_ready": True, "session_invited": True,
    "class_invited": True, "session_started": True,
}

# SDD-216: 신규 클래스 운영 이벤트는 인앱 켬·이메일 끔으로 시작한다.
CLASS_NOTIFICATION_EVENTS = (
    "class_invited", "class_member_joined", "class_session_added", "class_completed", "class_cancelled",
    "session_host_assigned", "session_host_change_requested", "session_host_change_resolved",
    "session_host_transfer_requested", "session_host_changed", "session_host_released", "session_host_needed",
)
for _event in CLASS_NOTIFICATION_EVENTS:
    DEFAULT_NOTIFICATION_PREFERENCES["in_app"][_event] = True
    DEFAULT_NOTIFICATION_PREFERENCES["email"][_event] = False

from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    # SDD-220: 서버 기본값 컬럼(birth_date/deleted_at/purge_after)을 INSERT ... RETURNING 으로 읽지 않는다 —
    #   컬럼 추가 이전(052) 스키마에서 시드 스크립트가 users 를 INSERT 해도 깨지지 않게 한다.
    __mapper_args__ = {"eager_defaults": False}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # counselor, client, org_admin, platform_admin
    phone: Mapped[str | None] = mapped_column(String(20))
    profile_image: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(Text)
    verified_tier: Mapped[str] = mapped_column(String(20), default="unverified")
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, server_default="active")
    org_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    notification_preferences: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    auto_approve_report: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    # SDD-237: 클래스 종료 후 '진행 기록 남기기' 1회 안내를 모든 회차에서 끌 수 있다(기본 켜짐).
    #   deferred: 052 스키마에서 시드하는 스크립트처럼 컬럼 추가 이전 스키마에 ORM 으로 붙는 경로를 깨지 않는다(birth_date 와 같은 이유). Python default 를 두지 않아 INSERT 에서 빠지고 DB 기본값(true)이 쓰인다.
    show_session_note_prompt: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", deferred=True
    )
    auth_provider: Mapped[str] = mapped_column(String(20), default="email", nullable=False, server_default="email")  # "email" | "google" | "apple"
    # SDD-017: 초대(pending) 계정의 초대 시각·만료 시각. 초대 관리 목록에서 상태/만료 뱃지에 사용한다.
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SDD-220: 만 14세 확인용 생년월일. 기존 사용자에게 임의 값을 채우지 않는다(NULL 허용).
    #   deferred: 052 스키마에서 시드하는 스크립트(seed_test_accounts)처럼 컬럼 추가 이전 스키마에 ORM 으로 붙는 경로를 깨지 않는다.
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True, deferred=True, server_default=text("NULL"))
    # SDD-220: 본인 탈퇴 — 즉시 접근 차단(deleted_at)과 영구 삭제 시각(purge_after = deleted_at + 유예일)을 분리해 기록한다.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, deferred=True, server_default=text("NULL"))
    purge_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True, deferred=True, server_default=text("NULL"))
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
    qualifications = relationship("Qualification", back_populates="user", cascade="all, delete-orphan")
    careers = relationship("Career", back_populates="user", cascade="all, delete-orphan")
    org = relationship("Organization", foreign_keys=[org_id])

    @property
    def onboarding_completed(self) -> bool:
        return self.onboarding_progress is not None and self.onboarding_progress.completed

    @property
    def counselor_code(self) -> str | None:
        if self.counselor_profile:
            return self.counselor_profile.counselor_code
        return None
