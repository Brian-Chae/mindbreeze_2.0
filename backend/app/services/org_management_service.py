"""기관 정보/운영 상태 변경의 잠금, 감사, 영향 검사."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.session import Session as CounselingSession
from app.models.client_counselor_link import ClientCounselorLink
from app.models.credential import VerificationAudit
from app.schemas.org import OrganizationPatch, OrganizationDeactivationImpact, OrganizationDeactivate, OrganizationReactivate


def notify_org_members(org_id: uuid.UUID, actor_id: uuid.UUID, event_type: str,
                       title: str, body: str, db: Session, *, admins_only: bool = False,
                       changed_fields: list[str] | None = None) -> None:
    """활성 소속과 계정으로 수신자를 결정하고 행위자를 제외한다."""
    from app.services import notification_service

    query = db.query(User).join(UserOrgMembership, UserOrgMembership.user_id == User.id).filter(
        UserOrgMembership.org_id == org_id, UserOrgMembership.status == "active",
        User.status == "active", User.id != actor_id,
        UserOrgMembership.role.in_(["counselor", "org_admin"]),
    )
    if admins_only:
        # 기관 상세 API는 현재 주 소속 기관 관리자에게만 접근을 허용한다.
        query = query.filter(UserOrgMembership.role == "org_admin", User.role == "org_admin", User.org_id == org_id)
    recipients = {user.id for user in query.all()}
    for recipient_id in recipients:
        notification_service.notify_event(event_type, recipient_id, {
            "title": title, "body": body,
            "extra": notification_service.build_standard_extra(
                event_type, "organization" if admins_only else "notice",
                str(org_id) if admins_only else None,
                params={"changed_fields": changed_fields} if changed_fields is not None else {},
                legacy={"org_id": str(org_id)},
            ),
        }, db)


def notify_role_changed(user: User, org_id: uuid.UUID, actor_id: uuid.UUID, db: Session) -> None:
    """역할 변경 당사자에게 본인 프로필 딥링크를 전달한다."""
    from app.services import notification_service

    if user.id == actor_id or user.status != "active":
        return
    event_type = "organization_role_changed"
    notification_service.notify_event(event_type, user.id, {
        "title": "기관 내 권한이 변경되었습니다",
        "body": "현재 권한과 이용 가능한 기능을 확인해주세요.",
        "extra": notification_service.build_standard_extra(event_type, "self_profile", None,
            params={"role": user.role}, legacy={"org_id": str(org_id)}),
    }, db)


def lock_organization(org_id: uuid.UUID | str, db: Session) -> Organization:
    # AUTH4-07: 경로 파라미터가 UUID 형식이 아니면 uuid.UUID() 가 ValueError 로 터져
    #   미처리 500 이 된다. 잘못된 형식은 400 으로 명시 거부한다.
    try:
        org_uuid = uuid.UUID(str(org_id))
    except (TypeError, ValueError):
        raise HTTPException(400, "잘못된 기관 ID 형식입니다")
    org = db.query(Organization).filter(Organization.id == org_uuid).populate_existing().with_for_update().first()
    if org is None:
        raise HTTPException(404, "기관을 찾을 수 없습니다")
    return org


def require_active_org(org_id: uuid.UUID | str, db: Session) -> Organization:
    """신규 업무도 같은 행 잠금을 유지한 채 커밋하여 중단과 직렬화한다."""
    org = lock_organization(org_id, db)
    if org.deactivated_at is not None:
        raise HTTPException(409, "비활성화된 기관에서는 이 작업을 수행할 수 없습니다")
    return org


def require_active_user_org(user: User, db: Session) -> Organization | None:
    previous_org_id = user.org_id
    org = require_active_org(previous_org_id, db) if previous_org_id else None
    # 잠금 대기 중 소속 해제가 완료됐으면 이전 기관으로 업무를 생성하지 않는다.
    db.refresh(user, attribute_names=["org_id", "role", "status"])
    if user.org_id != previous_org_id:
        raise HTTPException(409, "소속 기관이 변경되었습니다. 다시 시도해주세요")
    return org


def check_version(org: Organization, if_match: str | None) -> None:
    if if_match is None:
        raise HTTPException(428, "If-Match 버전이 필요합니다")
    if not re.fullmatch(r'(?:[1-9][0-9]*|"[1-9][0-9]*")', if_match):
        raise HTTPException(422, "If-Match 버전 형식이 올바르지 않습니다")
    if int(if_match.strip('"')) != org.version:
        raise HTTPException(412, "기관 정보가 변경되었습니다. 다시 불러온 뒤 확인해주세요")


def snapshot(org: Organization) -> dict:
    fields = ("name", "phone", "address", "verified", "verified_at", "deactivated_at", "deactivated_by", "deactivation_reason", "version")
    result = {}
    for field in fields:
        value = getattr(org, field)
        result[field] = value.isoformat() if isinstance(value, datetime) else str(value) if isinstance(value, uuid.UUID) else value
    return result


def commit_change(org: Organization, before: dict, action: str, reason: str | None, admin_id: uuid.UUID, db: Session) -> Organization:
    org.version += 1
    db.add(VerificationAudit(target_type="organization", target_id=org.id, admin_id=admin_id,
                             action=action, reason=reason, extra={"before": before, "after": snapshot(org)}))
    db.commit()
    db.refresh(org)
    return org


def patch_organization(org_id: uuid.UUID, data: OrganizationPatch, if_match: str | None, admin_id: uuid.UUID, db: Session) -> Organization:
    org = require_active_org(org_id, db)
    check_version(org, if_match)
    before = snapshot(org)
    values = data.model_dump(exclude_unset=True, exclude={"reason"})
    if "verified" in values and values["verified"] != org.verified:
        if not data.reason:
            raise HTTPException(422, "인증 상태 변경 사유가 필요합니다")
        org.verified_at = datetime.now(timezone.utc) if values["verified"] else None
    for key, value in values.items():
        setattr(org, key, value)
    changed_fields = [key for key, value in values.items() if before.get(key) != value]
    org = commit_change(org, before, "org_updated", data.reason, admin_id, db)
    if changed_fields:
        notify_org_members(org.id, admin_id, "organization_updated", "기관 정보가 변경되었습니다",
                           "기관의 최신 정보를 확인해주세요.", db, admins_only=True, changed_fields=changed_fields)
    return org


def deactivation_impact(org: Organization, db: Session) -> OrganizationDeactivationImpact:
    # SDD-079: 구성원 = membership 기준 (active 소속 + invited 초대, left 제외).
    # org_id 미러만 있는 계정(예: 기관 소속 내담자)도 놓치지 않도록 합집합으로 계산한다.
    member_ids = db.query(UserOrgMembership.user_id).filter(
        UserOrgMembership.org_id == org.id,
        UserOrgMembership.status.in_(["active", "invited"]),
    ).union(db.query(User.id).filter(User.org_id == org.id))
    unknown = and_(CounselingSession.organization_attribution_known.is_(False), CounselingSession.host_id.in_(member_ids))
    candidates = db.query(CounselingSession).filter(or_(CounselingSession.organization_id == org.id, unknown))
    # SDD-088: open(오픈/대기)은 아직 시작 전이므로 예정 집계에 포함한다
    scheduled = candidates.filter(CounselingSession.status.in_(["ready", "scheduled", "open"])).count()
    ongoing = candidates.filter(CounselingSession.status.in_(["in_progress"])).count()
    # 귀속 불명 차단은 "이 기관 소속자"의 미확정 세션으로 한정한다.
    # 타 기관·미소속의 미확정 세션은 이 기관 비활성화를 차단하지 않는다.
    unknown_count = db.query(CounselingSession).filter(
        CounselingSession.organization_attribution_known.is_(False),
        CounselingSession.host_id.in_(member_ids),
    ).count()
    active_links = db.query(ClientCounselorLink).filter(
        ClientCounselorLink.status == "active",
        or_(ClientCounselorLink.counselor_id.in_(member_ids), ClientCounselorLink.client_id.in_(member_ids)),
    ).count()
    blockers = []
    if org.kind != "institution":
        blockers.append("개인 기관 또는 유형이 확인되지 않은 기관은 비활성화할 수 없습니다")
    if scheduled or ongoing:
        blockers.append("진행·예정·대기 세션을 먼저 정리해주세요")
    if active_links:
        blockers.append("활성 내담자 연결을 먼저 이관하거나 종료해주세요")
    if unknown_count:
        blockers.append("이 기관 소속자 중 기관 귀속이 확인되지 않은 기존 세션이 있습니다. 소속 이력과 귀속 확인이 필요합니다")
    if org.deactivated_at:
        blockers.append("이미 비활성화된 기관입니다")
    return OrganizationDeactivationImpact(
        account_count=member_ids.count(), active_link_count=active_links,
        scheduled_session_count=scheduled, ongoing_session_count=ongoing,
        unknown_attribution_count=unknown_count, preserved_session_count=candidates.count(),
        attribution_note="세션 건수는 기관 스냅샷과 현재 소속자 기준 후보입니다. 귀속 확인 필요 건수는 이 기관 소속자 중 소속 이력이 확인되지 않은 미확정 세션입니다. 계정과 기존 기록은 삭제하지 않습니다.",
        blockers=blockers, can_deactivate=not blockers, version=org.version,
    )


def deactivate(org_id: uuid.UUID, data: OrganizationDeactivate, if_match: str | None, admin_id: uuid.UUID, db: Session) -> Organization:
    org = lock_organization(org_id, db)
    check_version(org, if_match)
    if data.confirmation_value != (org.org_code or org.name):
        raise HTTPException(422, "기관 코드(코드가 없으면 기관명)가 일치하지 않습니다")
    if org.deactivated_at:
        return org
    impact = deactivation_impact(org, db)
    if not impact.can_deactivate:
        raise HTTPException(409, " · ".join(impact.blockers))
    before = snapshot(org)
    org.deactivated_at = datetime.now(timezone.utc)
    org.deactivated_by = admin_id
    org.deactivation_reason = data.reason
    org = commit_change(org, before, "org_deactivated", data.reason, admin_id, db)
    notify_org_members(org.id, admin_id, "organization_deactivated", "기관 이용이 중지되었습니다",
                       "소속 기관의 이용 상태를 확인해주세요.", db)
    return org


def reactivate(org_id: uuid.UUID, data: OrganizationReactivate, if_match: str | None, admin_id: uuid.UUID, db: Session) -> Organization:
    org = lock_organization(org_id, db)
    # 기존 계약은 사유만 필수. UI가 보낸 버전은 재활성화에도 검사한다.
    if if_match is not None:
        check_version(org, if_match)
    if not org.deactivated_at:
        return org
    before = snapshot(org)
    org.deactivated_at = None
    org.deactivated_by = None
    org.deactivation_reason = None
    org = commit_change(org, before, "org_reactivated", data.reason, admin_id, db)
    notify_org_members(org.id, admin_id, "organization_reactivated", "기관 이용이 재개되었습니다",
                       "소속 기관의 이용 상태를 확인해주세요.", db)
    return org


def _has_other_active_org_admin(db: Session, org_id: uuid.UUID, exclude_user_id: uuid.UUID) -> bool:
    """이 기관의 '다른' 활성 기관 관리자가 존재하는지 membership 기준으로 판정한다.

    membership(role=org_admin, invited/active) + 활성 계정을 우선 기준으로 삼고,
    멤버십이 없는 레거시 미러(User.org_id/role) 계정도 잔여 관리자로 집계한다.
    다기관 소속에서 미러가 다른 기관을 가리켜 생기는 오판을 막는다.
    """
    member_admin = (
        db.query(UserOrgMembership.id)
        .join(User, User.id == UserOrgMembership.user_id)
        .filter(
            UserOrgMembership.org_id == org_id,
            UserOrgMembership.user_id != exclude_user_id,
            UserOrgMembership.role == "org_admin",
            UserOrgMembership.status.in_(("invited", "active")),
            User.status == "active",
        )
        .first()
    )
    if member_admin is not None:
        return True
    legacy_admin = (
        db.query(User.id)
        .filter(
            User.org_id == org_id,
            User.id != exclude_user_id,
            User.role == "org_admin",
            User.status == "active",
            ~User.id.in_(
                db.query(UserOrgMembership.user_id).filter(
                    UserOrgMembership.org_id == org_id,
                    UserOrgMembership.status != "left",
                )
            ),
        )
        .first()
    )
    return legacy_admin is not None


def change_counselor(org_id: uuid.UUID, user_id: uuid.UUID, admin_id: uuid.UUID,
                     reason: str, db: Session, *, role: str | None = None) -> User:
    """기관 잠금 안에서 역할/소속과 감사 이력을 함께 변경한다. role=None은 소속 해제."""
    from app.services import membership_service

    # AUTH4-08: 비활성화(deactivated)된 기관에서는 역할 변경/소속 해제를 허용하지 않는다
    #   (409). lock 만 걸던 이전 로직은 비활성 기관에서도 변경이 통과했다.
    org = require_active_org(org_id, db)
    user = db.query(User).filter(User.id == user_id).populate_existing().with_for_update().first()
    membership = (
        membership_service.get_membership(db, user_id, org.id) if user is not None else None
    )
    # membership 미보유라도 org_id 미러가 이 기관이면 기존 계약(role 422 등)을 유지한다
    if user is None or (membership is None and user.org_id != org.id):
        raise HTTPException(404, "대상 상담사를 찾을 수 없습니다")
    # AUTH4-02: 역할 판정·중복 단락은 전역 User.role 이 아니라 이 기관의 membership role 을 기준으로
    #   한다. 다기관 소속에서 미러(전역 role)는 주 소속 기관 역할만 반영하므로, 부 소속에서의
    #   role 비교가 틀어져 멱등 요청이 오판되거나 불필요한 변경이 일어난다.
    current_role = membership.role if membership is not None else user.role
    if current_role not in ("counselor", "org_admin") or role not in (None, "counselor", "org_admin"):
        raise HTTPException(422, "상담사와 기관 관리자 역할만 변경할 수 있습니다")
    if org.kind == "individual" and org.owner_user_id == user.id:
        raise HTTPException(409, "개인 기관 소유자는 역할 변경이나 소속 해제를 할 수 없습니다")
    if role == current_role:
        return user
    if org.primary_admin_id == user.id:
        raise HTTPException(409, "주 담당자를 먼저 교체해주세요")
    # MB2-ORG-LASTADMIN-MIRROR: '마지막 활성 관리자' 보호는 User.org_id/User.role 미러가 아니라
    #   membership(user_org_memberships) 기준으로 판정한다. 다기관 소속에서 미러가 다른 기관을
    #   가리키면 관리자 여부·잔여 인원을 오판한다(미러는 주 소속 기관에만 유효).
    if user.status == "active":
        membership_admin = membership is not None and membership.role == "org_admin"
        mirror_admin = user.role == "org_admin" and user.org_id == org.id  # 레거시(멤버십 미보유) 호환
        if (membership_admin or mirror_admin) and not _has_other_active_org_admin(db, org.id, user.id):
            raise HTTPException(409, "마지막 활성 기관 관리자는 강등하거나 소속 해제할 수 없습니다")
    if role is None:
        active_session = db.query(CounselingSession.id).filter(
            CounselingSession.host_id == user.id,
            CounselingSession.status.in_(["ready", "scheduled", "open", "in_progress"]),
        ).first()
        if active_session:
            raise HTTPException(409, "진행·예정·대기 세션을 먼저 정리해주세요")
        active_link = db.query(ClientCounselorLink.id).filter(
            ClientCounselorLink.status == "active",
            or_(ClientCounselorLink.counselor_id == user.id, ClientCounselorLink.client_id == user.id),
        ).first()
        if active_link:
            raise HTTPException(409, "활성 내담자 연결을 먼저 이관하거나 종료해주세요")
    before = {"org_id": str(org.id), "role": current_role}
    # AUTH4-02: 전역 User.role 은 '주 소속 기관'의 역할 미러이므로, 주 소속 기관에서의 변경일 때만
    #   동기화한다. 다기관 소속 상담사의 부 소속(비주 소속)에서 역할을 바꿔도 전역 role 을 오염시키지
    #   않는다(membership.role 만 갱신).
    if user.org_id == org.id:
        user.role = role or "counselor"
    office = None
    if role is None:
        # SDD-079: 소속 해제 = membership left (+ User.org_id 미러 동기 갱신)
        membership_service.leave_membership(db, user, org.id)
        if user.org_id == org.id:
            user.org_id = None
        # SDD-081: 남은 active 소속이 없으면 개인 상담소로 복귀 (무소속 차단) + 안내 알림
        from app.services import personal_office_service

        office = personal_office_service.fallback_to_personal_office(db, user)
        if office is not None:
            personal_office_service.create_org_removed_notification(db, user, org.name, office)
    elif membership is not None:
        membership.role = role
    # 인증은 JWT 역할을 신뢰하지 않고 매 요청 DB의 role/org_id를 다시 읽는다.
    # 과거 세션의 기관 스냅샷과 프로필/연결/계정은 변경하지 않는다.
    org.version += 1
    db.add(VerificationAudit(
        target_type="user", target_id=user.id, admin_id=admin_id,
        action="org_counselor_removed" if role is None else "org_counselor_role_changed",
        reason=reason, extra={"org_id": str(org.id), "before": before,
                              "after": {"org_id": str(user.org_id) if user.org_id else None,
                                        "role": role if role is not None else "counselor"}},
    ))
    db.commit()
    db.refresh(user)
    if role is not None:
        notify_role_changed(user, org.id, admin_id, db)
    if office is not None:
        from app.services import personal_office_service

        personal_office_service.enqueue_org_removed_notice(user.id, org.name, office.name)
    return user
