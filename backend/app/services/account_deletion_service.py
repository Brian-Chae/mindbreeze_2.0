"""SDD-220 — 본인 계정 탈퇴(즉시 접근 차단) · 소셜 연결 해제 outbox · 공개 삭제 요청 접수.

탈퇴는 두 단계다.
1) 즉시(이 모듈): users.status='deleted', deleted_at/purge_after 기록, 토큰·푸시·접근 권한 폐기, 이름·연락처 비식별화.
2) 30일 뒤(account_deletion_sweep_service): 개인 데이터·원본 영구 삭제.
관리자 삭제의 _purge_user_hard / media_cleanup_service.delete_user_media 는 호스트 전체 데이터를 지우므로 여기서 쓰지 않는다.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.account_deletion import (
    AccountDeletionLedger,
    AccountDeletionRequest,
    SocialIdentity,
    SocialRevokeOutbox,
)
from app.models.device_token import DeviceToken
from app.models.refresh_token import RefreshToken
from app.models.session import Session
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.services import admin_service, apple_auth_service
from app.services.signup_policy_service import api_error, normalize_email

logger = logging.getLogger(__name__)

DELETED_DISPLAY_NAME = "탈퇴한 사용자"
REVOKE_RETRY_MINUTES = 30
REQUEST_LIMIT_PER_EMAIL = 3
REQUEST_LIMIT_PER_IP = 10
REQUEST_WINDOW_SECONDS = 3600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite 는 tz 없는 datetime 을 돌려주므로 비교 전에 UTC 로 맞춘다."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def hash_email(email: str) -> str:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()  # signup_policy_service.email_hash 와 동일


# ── 탈퇴 전 예외 검사 ──────────────────────────────────────────────────


def _active_org_admin_ids(db: DBSession, org_id: uuid.UUID) -> set[uuid.UUID]:
    ids = {
        m.user_id
        for m in db.query(UserOrgMembership)
        .filter(UserOrgMembership.org_id == org_id, UserOrgMembership.role == "org_admin", UserOrgMembership.status == "active")
        .all()
    }
    ids |= {
        u.id
        for u in db.query(User).filter(User.org_id == org_id, User.role == "org_admin", User.status == "active").all()
    }
    return ids


def check_deletion_blockers(db: DBSession, user: User, *, now: datetime | None = None) -> None:
    """단독 기관 관리자(409 SOLE_ORG_ADMIN) · 미래 예정 회차 진행자(409 SCHEDULED_SESSIONS_EXIST)면 탈퇴를 막는다.

    막을 때는 아무것도 바꾸지 않는다. 완료·취소된 과거 회차는 탈퇴를 막지 않는다.
    """
    current = now or _now()
    if user.role == "org_admin":
        org_ids = {user.org_id} if user.org_id else set()
        org_ids |= {
            m.org_id
            for m in db.query(UserOrgMembership)
            .filter(UserOrgMembership.user_id == user.id, UserOrgMembership.role == "org_admin", UserOrgMembership.status == "active")
            .all()
        }
        for org_id in org_ids:
            if not (_active_org_admin_ids(db, org_id) - {user.id}):
                raise api_error(
                    409, "SOLE_ORG_ADMIN", "기관의 유일한 관리자예요. 다른 관리자를 지정한 뒤 탈퇴해 주세요"
                )
    future = (
        db.query(func.count(Session.id))
        .filter(
            Session.host_id == user.id,
            Session.status == "scheduled",
            Session.hidden_at.is_(None),
            Session.is_template.is_(False),
            Session.scheduled_at.isnot(None),
            Session.scheduled_at > current,
        )
        .scalar()
    )
    if future:
        raise api_error(
            409, "SCHEDULED_SESSIONS_EXIST", "예정된 진행 회차가 남아 있어요. 회차를 정리하거나 다른 진행자에게 넘긴 뒤 탈퇴해 주세요"
        )


# ── 즉시 탈퇴 ─────────────────────────────────────────────────────────


def _null_org_refs(db: DBSession, user_id: uuid.UUID) -> None:
    """기관의 이 사용자 참조만 해제한다 — 다른 관리자 참조는 건드리지 않는다(열 단위 UPDATE)."""
    uid = str(user_id)
    for col in ("primary_admin_id", "owner_user_id", "deactivated_by"):
        db.execute(text(f"UPDATE organizations SET {col} = NULL WHERE {col} = :id"), {"id": uid})


def _queue_revoke(
    db: DBSession,
    user: User,
    identities: list[SocialIdentity],
    google_token_enc: str | None,
    now: datetime,
) -> list[SocialRevokeOutbox]:
    rows: list[SocialRevokeOutbox] = []
    apple = next((i for i in identities if i.provider == "apple"), None)
    if apple is not None:
        row = SocialRevokeOutbox(
            user_id=user.id,
            provider="apple",
            client_id=apple.client_id,
            encrypted_token=apple.encrypted_refresh_token,
            token_type_hint="refresh_token",
            status="pending" if apple.encrypted_refresh_token else "skipped",
            last_error=None if apple.encrypted_refresh_token else "no_revocable_token",
            next_attempt_at=now,
        )
        rows.append(row)
    if user.auth_provider == "google":
        row = SocialRevokeOutbox(
            user_id=user.id,
            provider="google",
            encrypted_token=google_token_enc,
            token_type_hint="access_token",
            status="pending" if google_token_enc else "skipped",
            last_error=None if google_token_enc else "no_revocable_token",
            next_attempt_at=now,
        )
        rows.append(row)
    for row in rows:
        db.add(row)
    return rows


def delete_account(
    db: DBSession,
    user_id: uuid.UUID,
    *,
    google_token_enc: str | None = None,
    now: datetime | None = None,
) -> AccountDeletionLedger:
    """본인 탈퇴 — 한 트랜잭션으로 상태 전환·접근 폐기·원장 기록 후 커밋한다.

    호출 전에 재인증이 끝나 있어야 한다. 예외(단독 관리자·예정 회차)는 여기서 다시 검사해
    행 잠금 이후 판정과 전환이 원자적이게 한다.
    """
    current = now or _now()
    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if user is None or user.status == "deleted":
        raise api_error(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다")
    if user.role == "platform_admin":
        raise api_error(403, "PLATFORM_ADMIN_PROTECTED", "플랫폼 관리자는 직접 탈퇴할 수 없어요")
    check_deletion_blockers(db, user, now=current)

    original_email = user.email
    purge_after = current + timedelta(days=int(settings.account_deletion_grace_days))
    identities = db.query(SocialIdentity).filter(SocialIdentity.user_id == user.id).all()

    ledger = AccountDeletionLedger(
        user_id=user.id,
        email_hash=hash_email(original_email),
        role=user.role,
        deleted_at=current,
        purge_after=purge_after,
        status="requested",
    )
    db.add(ledger)
    _queue_revoke(db, user, identities, google_token_enc, current)
    # 연구 철회 원장을 먼저 만든다 — 이후 삭제로 가명 ID 근거를 잃어도 Spark 철회 확인을 추적할 수 있다(중복 요청 0).
    from app.services import privacy_consent_service

    privacy_consent_service._withdraw_research(db, user.id, current)

    # 접근 정리가 지우는 행 중 객체 키를 가진 것(자격 증빙 파일)은 키를 잃기 전에 삭제 대상 원장에 옮겨 둔다.
    from app.models.account_deletion import AccountDeletionObject
    from app.models.credential import Credential

    db.flush()  # ledger.id 확정
    for (key,) in db.query(Credential.s3_key).filter(Credential.user_id == user.id).all():
        if key:
            db.add(AccountDeletionObject(
                ledger_id=ledger.id, object_key=key, kind="local" if key.startswith("/") else "s3", status="pending"
            ))

    # 접근 권한·소속·알림·로그인 토큰 정리(관리자 삭제와 같은 규칙, 커밋 없음).
    admin_service.remove_account_access(db, user.id)
    _null_org_refs(db, user.id)
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).delete(synchronize_session=False)
    # 앱 푸시 토큰·웹 푸시 구독은 같은 테이블 — 발송 대상에서 즉시 제외한다.
    db.query(DeviceToken).filter(DeviceToken.user_id == user.id).delete(synchronize_session=False)

    # 호스트 클래스는 숨김(원본 보존은 M2·스위프 규칙을 따른다).
    db.execute(
        text("UPDATE sessions SET hidden_at = :now WHERE host_id = :id AND class_id IS NULL AND hidden_at IS NULL"),
        {"id": str(user.id), "now": current},
    )

    # 30일 유예 동안 명단·채팅에는 "탈퇴한 사용자"만 보이게 식별 정보를 비운다.
    # 이메일은 재가입 차단(F2) 근거를 원장 해시로 옮기고, 행에는 되돌릴 수 없는 자리표시 주소를 둔다.
    user.status = "deleted"
    user.deleted_at = current
    user.purge_after = purge_after
    user.name = DELETED_DISPLAY_NAME
    user.email = f"deleted+{user.id}@deleted.invalid"
    user.phone = None
    user.profile_image = None
    user.bio = None
    user.password_hash = "!"  # 어떤 비밀번호도 검증을 통과하지 못하는 값
    db.commit()
    db.refresh(ledger)
    return ledger


# ── 소셜 연결 해제 outbox ──────────────────────────────────────────────


async def process_revoke_outbox(
    db: DBSession,
    *,
    now: datetime | None = None,
    user_id: uuid.UUID | None = None,
    google_revoker: Any = None,
) -> dict[str, int]:
    """pending 건만 처리한다. 성공(done)·건너뜀(skipped) 건은 다시 호출하지 않는다. 실패는 pending 유지·재시도."""
    current = now or _now()
    query = db.query(SocialRevokeOutbox).filter(SocialRevokeOutbox.status == "pending")
    if user_id is not None:
        query = query.filter(SocialRevokeOutbox.user_id == user_id)
    stats = {"done": 0, "failed": 0, "skipped": 0}
    for row in query.all():
        due_at = _as_utc(row.next_attempt_at)
        if user_id is None and due_at is not None and due_at > current:
            continue
        token = apple_auth_service.decrypt_token(row.encrypted_token)
        row.attempts += 1
        try:
            if token is None:
                row.status = "skipped"
                row.last_error = "no_revocable_token"
                stats["skipped"] += 1
            elif row.provider == "apple":
                await apple_auth_service.revoke_token(row.client_id or "", token, row.token_type_hint)
                row.status, row.last_error, row.completed_at = "done", None, current
                stats["done"] += 1
            elif row.provider == "google":
                revoker = google_revoker or revoke_google_token
                await revoker(token)
                row.status, row.last_error, row.completed_at = "done", None, current
                stats["done"] += 1
            else:
                row.status = "skipped"
                row.last_error = "unknown_provider"
                stats["skipped"] += 1
            if row.status != "pending":
                row.encrypted_token = None  # 해제가 끝났거나 불가하면 암호문도 남기지 않는다
        except Exception as exc:  # noqa: BLE001 — 실패 사유만 기록(토큰·응답 본문 금지)
            row.last_error = type(exc).__name__[:100]
            row.next_attempt_at = current + timedelta(minutes=REVOKE_RETRY_MINUTES)
            stats["failed"] += 1
            logger.warning("[account-deletion] 소셜 연결 해제 실패 provider=%s attempts=%d", row.provider, row.attempts)
        db.commit()
    return stats


async def revoke_google_token(token: str) -> None:
    import httpx

    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post("https://oauth2.googleapis.com/revoke", params={"token": token})
    # 이미 만료·해제된 토큰(400)은 목적 달성으로 본다.
    if resp.status_code not in (200, 400):
        raise RuntimeError(f"google_revoke_http_{resp.status_code}")


# ── 공개 /account-deletion 접수 ─────────────────────────────────────────


async def _hit(redis: Any, key: str, limit: int) -> bool:
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, REQUEST_WINDOW_SECONDS)
    return int(count) <= limit


async def submit_public_request(db: DBSession, redis: Any, *, email: str, ip: str | None) -> None:
    """이메일 접수 — 계정 존재 여부와 무관하게 같은 동작. 한도 초과는 429, 접수만으로 계정은 바뀌지 않는다."""
    email_norm = normalize_email(email)
    ip_hash = hashlib.sha256((ip or "unknown").encode("utf-8")).hexdigest()
    if not await _hit(redis, f"acctdel:email:{hash_email(email_norm)}", REQUEST_LIMIT_PER_EMAIL) or not await _hit(
        redis, f"acctdel:ip:{ip_hash}", REQUEST_LIMIT_PER_IP
    ):
        raise api_error(429, "TOO_MANY_REQUESTS", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요")
    db.add(AccountDeletionRequest(email=email_norm, ip_hash=ip_hash))
    db.commit()


def deliver_pending_request_notices(db: DBSession, *, sender: Any = None, limit: int = 50) -> dict[str, int]:
    """접수 건을 운영 메일로 알린다. 실패하면 pending 으로 남겨 재시도하며, 성공 건은 다시 보내지 않는다."""
    if sender is None:
        from app.tasks.email import _send_email

        def sender(subject: str, body: str) -> bool:
            return _send_email(settings.signup_notice_email, subject, body)

    stats = {"sent": 0, "failed": 0}
    rows = (
        db.query(AccountDeletionRequest)
        .filter(AccountDeletionRequest.notify_status == "pending")
        .order_by(AccountDeletionRequest.created_at)
        .limit(limit)
        .all()
    )
    for row in rows:
        row.notify_attempts += 1
        subject = f"[MIND BREEZE] 계정 삭제 요청 접수 {row.id}"
        body = (
            "공개 계정 삭제 페이지로 요청이 접수되었습니다.\n"
            f"· 요청 ID: {row.id}\n· 요청 이메일: {row.email}\n"
            "· 본인 확인 뒤에만 처리하세요(접수만으로 계정은 삭제되지 않습니다)."
        )
        try:
            ok = bool(sender(subject, body))
        except Exception:  # noqa: BLE001
            ok = False
        if ok:
            row.notify_status, row.notified_at = "sent", _now()
            stats["sent"] += 1
        else:
            stats["failed"] += 1
        db.commit()
    return stats
