"""상담사 개인 상담소 자동 개설 서비스 (SDD-081)

상담사 가입(초대 수락·개인 신청 승인) 시 개인 상담소(kind='individual')를
자동 개설해 기본 소속으로 배정하고, 기관 해제로 남은 active 소속이 없으면
개인 상담소로 복귀시켜 무소속 상태를 원천 차단한다.

- 개인 상담소는 상담사 개인 자산 — owner_user_id 기준으로만 조회·재사용한다 (중복 생성 금지).
- SDD-073 개인 상담사 신청이 만든 개인 기관도 owner_user_id 로 찾아 그대로 재사용한다.

트랜잭션 규칙: membership_service 와 동일하게 flush 까지만 수행한다. commit 은
호출자 책임. 단, enqueue_org_removed_notice 는 반드시 commit 이후에 호출할 것 —
커밋 실패 시 안내 메일이 잘못 나가는 것을 막는다.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.user import User
from app.services import membership_service

logger = logging.getLogger(__name__)

# 개인 상담소 이름 접미 — `{상담사 이름} 개인 상담소`
OFFICE_NAME_SUFFIX = "개인 상담소"


def get_personal_office(db: Session, user: User) -> Organization | None:
    """owner_user_id 기준 개인 상담소 조회 — 중복 생성 방지의 유일한 기준."""
    return (
        db.query(Organization)
        .filter(
            Organization.owner_user_id == user.id,
            Organization.kind == "individual",
        )
        .first()
    )


def active_institution_org_ids(db: Session, user: User) -> list[uuid.UUID]:
    """본인 개인 상담소를 제외한 active 소속 org id 목록 — "실제 기관 소속" 판정 기준."""
    office = get_personal_office(db, user)
    return [
        oid
        for oid in membership_service.get_active_org_ids(db, user.id)
        if office is None or oid != office.id
    ]


def _office_name(db: Session, user: User) -> str:
    """`{이름} 개인 상담소`. 동명 기관이 이미 있으면 사용자 id 앞자리로 구분한다."""
    base = f"{(user.name or '').strip() or '상담사'} {OFFICE_NAME_SUFFIX}"
    exists = db.query(Organization.id).filter(Organization.name == base).first()
    if exists is None:
        return base
    return f"{base} ({str(user.id)[:8]})"


def ensure_personal_office(db: Session, user: User) -> Organization:
    """개인 상담소를 보장한다 — 없으면 생성, 있으면 재사용 (T1).

    membership 은 active 로 보장한다. 주 소속 승격은 add_membership 규칙에 위임 —
    다른 active 주 소속이 없을 때만 자동으로 주 소속이 된다. 따라서 기관 초대로
    가입한 상담사는 초대 기관이 주 소속으로 유지되고, 개인 신청 승인·기관 해제
    복귀처럼 유일한 소속일 때는 개인 상담소가 주 소속이 된다.
    """
    office = get_personal_office(db, user)
    if office is None:
        office = Organization(
            name=_office_name(db, user),
            kind="individual",
            owner_user_id=user.id,
            verified=True,
            verified_at=datetime.now(timezone.utc),
            # 기관 코드 가입 경로 우회 방지 — 개인 기관에는 org_code 미발급 (SDD-073 동일)
            org_code=None,
        )
        db.add(office)
        db.flush()

    membership = membership_service.get_membership(db, user.id, office.id)
    if membership is None:
        membership_service.add_membership(db, user, office.id, status_="active")
    elif membership.status == "invited":
        membership_service.activate_membership(db, membership, user)
    return office


def fallback_to_personal_office(db: Session, user: User) -> Organization | None:
    """기관 해제 후 남은 기관 소속이 없으면 개인 상담소로 복귀 (T2).

    개인 상담소 membership 은 상시 active 이므로 "남은 소속" 판정에서 제외한다 —
    개인 상담소 외의 active 소속이 남아 있으면 SDD-079 의 주 소속 자동 승격에
    맡기고 아무것도 하지 않는다. 복귀(개인 상담소만 남음)가 일어난 경우에만
    개인 상담소를 반환한다. flush 까지만 수행하며, 안내 메일 큐 적재는
    호출자가 commit 후 처리한다.
    """
    if user.role != "counselor":
        return None
    if active_institution_org_ids(db, user):
        return None
    # 개인 상담소가 없던 기존 상담사(SDD-081 이전 가입)도 여기서 개설해 무소속을 막는다.
    # 이미 있으면 leave_membership 의 승격(또는 add_membership 규칙)으로 주 소속이 된다.
    return ensure_personal_office(db, user)


def create_org_removed_notification(
    db: Session, user: User, org_name: str, office: Organization
) -> None:
    """해제·전환 사실 로그인 팝업용 인앱 알림 (T4) — 미읽음이면 FE 가 1회 팝업."""
    from app.services import notification_service

    notification_service.create_notification(
        user.id,
        "org_removed",
        f"{org_name} 소속이 해제되었습니다",
        f"'{org_name}' 기관에서 소속이 해제되어 '{office.name}'(개인 상담소)로 등록되었습니다.",
        db,
        extra={"org_name": org_name, "office_name": office.name},
    )


def enqueue_org_removed_notice(user_id: uuid.UUID | str, org_name: str, office_name: str) -> None:
    """해제 안내 메일을 email_app 큐에 적재한다 — 반드시 commit 후 호출.

    브로커 장애 시에도 해제 처리 자체는 유지한다 (signup_notice 와 동일 패턴).
    """
    from app.tasks.report_email_task import org_removed_notice_task

    try:
        org_removed_notice_task.apply_async(
            args=[str(user_id), org_name, office_name], retry=False
        )
    except Exception as exc:  # 브로커 미가동 등 — 인앱 알림이 남아 있으므로 경고만
        logger.warning(f"[SDD-081] 해제 안내 메일 큐 적재 실패 (user={user_id}): {exc}")


def deliver_org_removed_notice(
    user_id: str, org_name: str, office_name: str, db: Session
) -> str:
    """email_app worker 가 호출 — 해제 안내 메일 실제 발송. 반환: sent | failed."""
    from app.tasks.email import send_org_removed_email

    user = db.query(User).filter(User.id == uuid.UUID(str(user_id))).first()
    if user is None or not user.email:
        logger.error(f"[SDD-081] 해제 안내 대상 사용자를 찾을 수 없음: {user_id}")
        return "failed"

    ok = send_org_removed_email(
        user.email,
        counselor_name=user.name,
        org_name=org_name,
        office_name=office_name,
    )
    return "sent" if ok else "failed"
