"""SDD-220 — 소셜 연결·계정 탈퇴·영구 삭제 원장 모델.

이 모듈의 모델은 users 행이 영구 삭제된 뒤에도 남아야 하는 기록(삭제 원장·revoke outbox)을 포함하므로
``user_id`` 에 FK 를 걸지 않는다. 개인 식별 정보는 이메일 해시만 보관한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SocialIdentity(Base):
    """소셜 공급자 주체(sub) 연결 — 이메일이 같다는 이유로 기존 계정에 자동 병합하지 않는다."""

    __tablename__ = "social_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_social_identity_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_social_identity_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # apple | google
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    # Apple revoke 에 쓰는 audience(번들/Services ID). 코드 교환·revoke 모두 같은 client_id 여야 한다.
    client_id: Mapped[str | None] = mapped_column(String(255))
    # Fernet 암호문. 키 미설정이면 저장하지 않는다(NULL). 평문은 로그·응답에 싣지 않는다.
    encrypted_refresh_token: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SocialRevokeOutbox(Base):
    """탈퇴 시 소셜 연결 해제(Apple revoke / Google 연결 해제) 재시도 큐.

    로컬 접근 차단은 이 작업의 성공 여부와 무관하게 유지된다. 성공 건은 다시 호출하지 않는다.
    """

    __tablename__ = "social_revoke_outbox"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_social_revoke_user_provider"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)  # FK 없음
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    client_id: Mapped[str | None] = mapped_column(String(255))
    encrypted_token: Mapped[str | None] = mapped_column(Text)
    token_type_hint: Mapped[str] = mapped_column(String(30), nullable=False, default="refresh_token")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)  # pending|done|skipped
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(200))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccountDeletionLedger(Base):
    """사용자 단위 영구 삭제 원장 — users 행이 사라진 뒤에도 완료 근거를 남긴다."""

    __tablename__ = "account_deletion_ledger"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, index=True)  # FK 없음
    email_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str | None] = mapped_column(String(20))
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    purge_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # requested(탈퇴 접수) → purging(스위프 진행) → purged(완료) / failed(재시도 대기)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="requested", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(200))
    retained_reasons: Mapped[dict | None] = mapped_column(JSONB)  # 예: {"shared_session_media_retained": 2}
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AccountDeletionObject(Base):
    """삭제 대상 객체(S3 키·로컬 파일) 원장 — 실패한 키를 잃지 않고 재시도한다."""

    __tablename__ = "account_deletion_objects"
    __table_args__ = (UniqueConstraint("ledger_id", "object_key", name="uq_account_deletion_object_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("account_deletion_ledger.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # s3 | local
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending|deleted|failed|skipped
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(String(200))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountDeletionRequest(Base):
    """공개 /account-deletion 이메일 접수 원장 — 접수만으로 계정을 삭제하지 않는다(별도 본인 확인)."""

    __tablename__ = "account_deletion_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="received")
    # 운영 알림 메일 outbox 상태: pending → sent / failed(재시도)
    notify_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    notify_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
