"""가입 신청(기관 상담 / 개인 상담사) 비즈니스 로직 (SDD-073)

- 기관 신청: SignupApplication 만 저장한다. 접수만으로 기관·계정을 만들지 않는다.
- 개인 상담사 신청: 신청 + 개인 Organization(kind=individual) + pending User(counselor)
  + CounselorProfile + 소유 관계를 하나의 트랜잭션으로 생성한다.
- 운영 알림은 email_app(Celery) 아웃박스 패턴 — notify_status 로 발송 상태를
  신청 상태와 분리해 추적하고, 큐 적재 실패 시에도 신청은 접수 상태로 남긴다.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.signup_application import SignupApplication
from app.models.user import User
from app.services import code_service, email_verify_service

logger = logging.getLogger(__name__)

# 신청 유형
TYPE_ORGANIZATION = "organization"
TYPE_INDIVIDUAL_COUNSELOR = "individual_counselor"

# 검토가 끝나지 않은(열린) 신청 상태 — 같은 이메일 중복 접수 방지 기준
OPEN_STATUSES = ("submitted", "reviewing")

# 공개 폼 남용 완화 — 같은 이메일 재접수 쿨다운(초)
SUBMIT_COOLDOWN_SECONDS = 60


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    local, _, domain = email.partition("@")
    return f"{local[:2]}{'*' * max(len(local) - 2, 1)}@{domain}"


async def check_submit_cooldown(email: str, application_type: str, redis) -> None:
    """같은 이메일의 반복 제출 쿨다운 — 새로고침·중복 클릭 멱등성 보조."""
    key = f"signup_app_submit:{application_type}:{email.strip().lower()}"
    if await redis.get(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="잠시 후 다시 시도해 주세요. 이미 접수 요청이 처리 중입니다.",
        )
    await redis.setex(key, SUBMIT_COOLDOWN_SECONDS, "1")


def _reject_open_duplicate(email: str, application_type: str, db: Session) -> None:
    existing = (
        db.query(SignupApplication)
        .filter(
            SignupApplication.email == email,
            SignupApplication.application_type == application_type,
            SignupApplication.status.in_(OPEN_STATUSES),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 접수된 신청이 있습니다. 검토 후 등록하신 이메일로 안내드립니다.",
        )


def create_organization_application(
    *,
    organization_name: str,
    contact_name: str,
    email: str,
    phone: str | None,
    inquiry: str | None,
    db: Session,
) -> SignupApplication:
    """기관 가입 상담 신청 접수 — 계정·기관을 만들지 않는다."""
    email_norm = (email or "").strip().lower()
    _reject_open_duplicate(email_norm, TYPE_ORGANIZATION, db)

    app_row = SignupApplication(
        application_type=TYPE_ORGANIZATION,
        organization_name=organization_name.strip(),
        contact_name=contact_name.strip(),
        email=email_norm,
        phone=(phone or "").strip() or None,
        inquiry=(inquiry or "").strip() or None,
        status="submitted",
        notify_status="pending",
        consented_at=datetime.now(timezone.utc),
    )
    db.add(app_row)
    db.commit()
    db.refresh(app_row)
    return app_row


def create_individual_counselor_application(
    *,
    name: str,
    email: str,
    email_verify_token: str,
    phone: str | None,
    display_name: str | None,
    specialties: str | None,
    inquiry: str | None,
    db: Session,
) -> SignupApplication:
    """개인 상담사 신청 — 신청 + 개인 기관 + pending 상담사 + 프로필을 원자적으로 생성.

    - 이메일은 OTP(email_verify_token)로 소유가 확인된 값만 수용한다.
    - 계정은 status="pending" + 난수 비밀번호 해시 → 승인·초대 수락 전 로그인 불가.
    - counselor_code 는 발급하지만 상담사가 active 가 되기 전에는 사용할 수 없다.
    - 개인 기관에는 org_code 를 발급하지 않는다(기관 코드 가입 경로 우회 방지).
    """
    verified_email = email_verify_service.verify_email_token(email_verify_token)
    email_norm = (email or "").strip().lower()
    if verified_email.lower() != email_norm:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰과 신청 이메일이 일치하지 않습니다",
        )

    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="이름을 입력해야 합니다",
        )

    if db.query(User).filter(User.email == email_norm).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 등록된 이메일입니다",
        )
    _reject_open_duplicate(email_norm, TYPE_INDIVIDUAL_COUNSELOR, db)

    org_name = (display_name or "").strip() or f"{clean_name} 개인 상담실"
    phone_norm = (phone or "").strip() or None

    # 트랜잭션: 기관 → 사용자 순으로 flush 후 소유 관계·신청 참조를 설정하고 한 번에 commit.
    org = Organization(
        name=org_name,
        kind="individual",
        verified=False,
        org_code=None,
    )
    db.add(org)
    db.flush()

    user = User(
        email=email_norm,
        # 승인·초대 수락 전까지 아무도 알 수 없는 난수 — 실질적으로 로그인 불가
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=clean_name,
        phone=phone_norm,
        role="counselor",
        org_id=org.id,
        status="pending",
        verified_tier="email",
    )
    db.add(user)
    db.flush()

    org.owner_user_id = user.id

    counselor_code = code_service.generate_unique_code(
        db, CounselorProfile, "counselor_code", label="상담사 코드"
    )
    db.add(CounselorProfile(user_id=user.id, counselor_code=counselor_code, specialties=[]))

    app_row = SignupApplication(
        application_type=TYPE_INDIVIDUAL_COUNSELOR,
        organization_name=org_name,
        contact_name=clean_name,
        email=email_norm,
        phone=phone_norm,
        specialties=(specialties or "").strip() or None,
        inquiry=(inquiry or "").strip() or None,
        status="submitted",
        notify_status="pending",
        organization_id=org.id,
        user_id=user.id,
        consented_at=datetime.now(timezone.utc),
    )
    db.add(app_row)
    db.commit()
    db.refresh(app_row)
    return app_row


def enqueue_notice(app_row: SignupApplication, db: Session) -> None:
    """운영 알림을 email_app 큐에 적재한다. 브로커 장애 시에도 신청은 유지한다."""
    from app.tasks.report_email_task import signup_notice_task

    try:
        signup_notice_task.apply_async(args=[str(app_row.id)], retry=False)
        app_row.notify_status = "queued"
        db.commit()
    except Exception as exc:  # 브로커 미가동 등 — 신청은 접수 상태로 남기고 재발송으로 복구
        logger.warning(
            f"[SIGNUP] 알림 큐 적재 실패 (application={app_row.id}, "
            f"email={_mask_email(app_row.email)}): {exc}"
        )


def deliver_signup_notice(application_id: str, db: Session) -> str:
    """email_app worker 가 호출 — 운영 알림 실제 발송. 반환: sent | failed."""
    from app.tasks.email import send_signup_application_notice

    app_row = (
        db.query(SignupApplication)
        .filter(SignupApplication.id == uuid.UUID(str(application_id)))
        .first()
    )
    if app_row is None:
        logger.error(f"[SIGNUP] 알림 대상 신청을 찾을 수 없음: {application_id}")
        return "failed"

    ok = send_signup_application_notice(
        application_id=str(app_row.id),
        application_type=app_row.application_type,
        organization_name=app_row.organization_name,
        contact_name=app_row.contact_name,
        contact_email=app_row.email,
        phone=app_row.phone,
        inquiry=app_row.inquiry,
        created_at=app_row.created_at.isoformat() if app_row.created_at else "",
    )
    app_row.notify_status = "sent" if ok else "failed"
    if ok:
        app_row.notified_at = datetime.now(timezone.utc)
    db.commit()
    return "sent" if ok else "failed"


# ---------------------------------------------------------------------------
# 관리자 검토
# ---------------------------------------------------------------------------


def _get_application(application_id: str, db: Session) -> SignupApplication:
    try:
        aid = uuid.UUID(str(application_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="신청을 찾을 수 없습니다")
    app_row = db.query(SignupApplication).filter(SignupApplication.id == aid).first()
    if app_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="신청을 찾을 수 없습니다")
    return app_row


def serialize_application(app_row: SignupApplication, *, detail: bool = False) -> dict:
    """목록에서는 전화번호를 마스킹하고, 관리자 상세에서만 전체를 노출한다."""
    from app.tasks.email import mask_phone

    data = {
        "id": str(app_row.id),
        "application_type": app_row.application_type,
        "organization_name": app_row.organization_name,
        "contact_name": app_row.contact_name,
        "email": app_row.email,
        "phone": app_row.phone if detail else mask_phone(app_row.phone),
        "status": app_row.status,
        "notify_status": app_row.notify_status,
        "created_at": app_row.created_at.isoformat() if app_row.created_at else None,
    }
    if detail:
        data.update(
            {
                "inquiry": app_row.inquiry,
                "specialties": app_row.specialties,
                "review_note": app_row.review_note,
                "reviewed_at": app_row.reviewed_at.isoformat() if app_row.reviewed_at else None,
                "organization_id": str(app_row.organization_id) if app_row.organization_id else None,
                "user_id": str(app_row.user_id) if app_row.user_id else None,
                "notified_at": app_row.notified_at.isoformat() if app_row.notified_at else None,
            }
        )
    return data


def list_applications(
    db: Session,
    *,
    application_type: str | None = None,
    status_filter: str | None = None,
    page: int = 1,
    size: int = 20,
) -> dict:
    query = db.query(SignupApplication)
    if application_type:
        query = query.filter(SignupApplication.application_type == application_type)
    if status_filter:
        query = query.filter(SignupApplication.status == status_filter)
    total = query.count()
    rows = (
        query.order_by(SignupApplication.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return {
        "items": [serialize_application(r) for r in rows],
        "total": total,
        "page": page,
        "size": size,
    }


def get_application_detail(application_id: str, db: Session) -> dict:
    return serialize_application(_get_application(application_id, db), detail=True)


async def approve_application(
    application_id: str, admin_id: uuid.UUID, redis, db: Session
) -> tuple[SignupApplication, bool]:
    """승인 — 개인 상담사는 계정을 바로 active 로 전환하고 초대(비밀번호 설정) 메일 발송.

    기관 신청 승인은 검토 통과 기록이며, 기관·담당자 생성은 기존
    플랫폼 관리자 기관 등록(/admin/orgs) 절차로 진행한다.
    같은 신청의 중복 승인은 409 로 거부한다(동시 승인·재시도 대비).
    """
    from app.services import org_invite_service

    app_row = _get_application(application_id, db)
    if app_row.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 처리된 신청입니다",
        )

    invite_sent = False
    now = datetime.now(timezone.utc)

    if app_row.application_type == TYPE_INDIVIDUAL_COUNSELOR:
        user = db.query(User).filter(User.id == app_row.user_id).first()
        org = db.query(Organization).filter(Organization.id == app_row.organization_id).first()
        if user is None or org is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="신청과 연결된 계정·기관 정보가 없습니다. 수동 확인이 필요합니다.",
            )
        # 정책 확정(SDD-073): 승인 즉시 적용 — 계정 active + 개인 기관 검증 완료.
        # 로그인은 초대 메일의 비밀번호 설정을 마쳐야 가능하다(난수 해시 유지).
        user.status = "active"
        user.invited_at = now
        user.invite_expires_at = None
        org.verified = True
        org.verified_at = now

    app_row.status = "approved"
    app_row.reviewed_by = admin_id
    app_row.reviewed_at = now
    db.commit()
    db.refresh(app_row)

    if app_row.application_type == TYPE_INDIVIDUAL_COUNSELOR:
        user = db.query(User).filter(User.id == app_row.user_id).first()
        org = db.query(Organization).filter(Organization.id == app_row.organization_id).first()
        invite_sent = await org_invite_service.issue_counselor_invite(user, org.name, redis)

    return app_row, invite_sent


def reject_application(
    application_id: str, admin_id: uuid.UUID, reason: str | None, db: Session
) -> SignupApplication:
    """반려 — 개인 상담사 신청의 대기 계정은 pending 으로 남아 로그인·코드 연결이 불가하다."""
    app_row = _get_application(application_id, db)
    if app_row.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 처리된 신청입니다",
        )

    app_row.status = "rejected"
    app_row.reviewed_by = admin_id
    app_row.reviewed_at = datetime.now(timezone.utc)
    app_row.review_note = (reason or "").strip() or None
    db.commit()
    db.refresh(app_row)
    return app_row


def resend_notice(application_id: str, db: Session) -> SignupApplication:
    """운영 알림 재발송 — 큐 적재 실패(pending)·발송 실패(failed) 복구용."""
    app_row = _get_application(application_id, db)
    enqueue_notice(app_row, db)
    db.refresh(app_row)
    return app_row


# ---------------------------------------------------------------------------
# 회원 가입용 상담사 코드 검증 (SDD-073 T5)
# ---------------------------------------------------------------------------


def validate_counselor_code(code: str, db: Session) -> tuple[User, CounselorProfile, str | None]:
    """상담사 코드 형식·존재·활성 상태를 검증하고 (상담사, 프로필, 기관명)을 반환.

    - 형식: 6자리 대문자+숫자 (code_service 규칙과 동일하게 정규화).
    - 대상: role=counselor 이고 status=active 인 계정만 연결을 허용한다.
      (개인 상담사 신청의 승인 전 pending 계정은 코드 사용 불가)
    """
    normalized = code_service.normalize_code(code)
    if len(normalized) != code_service.CODE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="상담사 코드는 6자리입니다",
        )
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.counselor_code == normalized)
        .first()
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="상담사 코드를 찾을 수 없습니다",
        )
    counselor = db.query(User).filter(User.id == profile.user_id).first()
    if counselor is None or counselor.role not in ("counselor", "org_admin") or counselor.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="아직 활동을 시작하지 않은 상담사입니다. 상담사에게 확인해 주세요.",
        )

    org_name = None
    if counselor.org_id:
        org = db.query(Organization).filter(Organization.id == counselor.org_id).first()
        if org:
            org_name = org.name
    return counselor, profile, org_name
