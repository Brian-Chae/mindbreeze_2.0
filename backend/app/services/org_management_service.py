"""기관 정보/운영 상태 변경의 잠금, 감사, 영향 검사."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.user import User
from app.models.session import Session as CounselingSession
from app.models.client_counselor_link import ClientCounselorLink
from app.models.credential import VerificationAudit
from app.schemas.org import OrganizationPatch, OrganizationDeactivationImpact, OrganizationDeactivate, OrganizationReactivate


def lock_organization(org_id: uuid.UUID | str, db: Session) -> Organization:
    org = db.query(Organization).filter(Organization.id == uuid.UUID(str(org_id))).populate_existing().with_for_update().first()
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
    return commit_change(org, before, "org_updated", data.reason, admin_id, db)


def deactivation_impact(org: Organization, db: Session) -> OrganizationDeactivationImpact:
    member_ids = db.query(User.id).filter(User.org_id == org.id)
    unknown = and_(CounselingSession.organization_attribution_known.is_(False), CounselingSession.host_id.in_(member_ids))
    candidates = db.query(CounselingSession).filter(or_(CounselingSession.organization_id == org.id, unknown))
    scheduled = candidates.filter(CounselingSession.status.in_(["ready", "scheduled"])).count()
    ongoing = candidates.filter(CounselingSession.status.in_(["in_progress", "paused"])).count()
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
        blockers.append("진행·일시정지·예정·대기 세션을 먼저 정리해주세요")
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
    return commit_change(org, before, "org_deactivated", data.reason, admin_id, db)


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
    return commit_change(org, before, "org_reactivated", data.reason, admin_id, db)


def change_counselor(org_id: uuid.UUID, user_id: uuid.UUID, admin_id: uuid.UUID,
                     reason: str, db: Session, *, role: str | None = None) -> User:
    """기관 잠금 안에서 역할/소속과 감사 이력을 함께 변경한다. role=None은 소속 해제."""
    org = lock_organization(org_id, db)
    user = db.query(User).filter(User.id == user_id, User.org_id == org.id).populate_existing().with_for_update().first()
    if user is None:
        raise HTTPException(404, "대상 상담사를 찾을 수 없습니다")
    if user.role not in ("counselor", "org_admin") or role not in (None, "counselor", "org_admin"):
        raise HTTPException(422, "상담사와 기관 관리자 역할만 변경할 수 있습니다")
    if org.kind == "individual" and org.owner_user_id == user.id:
        raise HTTPException(409, "개인 기관 소유자는 역할 변경이나 소속 해제를 할 수 없습니다")
    if role == user.role:
        return user
    if org.primary_admin_id == user.id:
        raise HTTPException(409, "주 담당자를 먼저 교체해주세요")
    if user.role == "org_admin" and user.status == "active":
        remaining = db.query(User.id).filter(
            User.org_id == org.id, User.id != user.id,
            User.role == "org_admin", User.status == "active",
        ).first()
        if remaining is None:
            raise HTTPException(409, "마지막 활성 기관 관리자는 강등하거나 소속 해제할 수 없습니다")
    if role is None:
        active_session = db.query(CounselingSession.id).filter(
            CounselingSession.host_id == user.id,
            CounselingSession.status.in_(["ready", "scheduled", "in_progress", "paused"]),
        ).first()
        if active_session:
            raise HTTPException(409, "진행·일시정지·예정·대기 세션을 먼저 정리해주세요")
        active_link = db.query(ClientCounselorLink.id).filter(
            ClientCounselorLink.status == "active",
            or_(ClientCounselorLink.counselor_id == user.id, ClientCounselorLink.client_id == user.id),
        ).first()
        if active_link:
            raise HTTPException(409, "활성 내담자 연결을 먼저 이관하거나 종료해주세요")
    before = {"org_id": str(user.org_id), "role": user.role}
    user.role = role or "counselor"
    if role is None:
        user.org_id = None
    # 인증은 JWT 역할을 신뢰하지 않고 매 요청 DB의 role/org_id를 다시 읽는다.
    # 과거 세션의 기관 스냅샷과 프로필/연결/계정은 변경하지 않는다.
    org.version += 1
    db.add(VerificationAudit(
        target_type="user", target_id=user.id, admin_id=admin_id,
        action="org_counselor_removed" if role is None else "org_counselor_role_changed",
        reason=reason, extra={"org_id": str(org.id), "before": before,
                              "after": {"org_id": str(user.org_id) if user.org_id else None, "role": user.role}},
    ))
    db.commit()
    db.refresh(user)
    return user
