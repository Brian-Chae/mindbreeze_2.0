"""SDD-077 상담사 정보 관리 — 3자(본인/플랫폼/기관) 공용 조회·수정 서비스.

- 이메일은 계정 식별자이므로 어떤 경로로도 변경하지 않는다 (읽기 전용).
- role/org_id/verified_tier/status/counselor_code 전송은 403으로 거부한다 (대량 할당 차단).
- 관리자 수정은 사유 필수 + 감사(VerificationAudit) + 대상자 인앱 알림을 한 트랜잭션으로 저장한다.
  알림에는 성별/생년월일/주소 원문을 넣지 않는다 (필드명만).
- CounselorProfile.version 낙관적 잠금 — 낡은 버전이면 409.
"""

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.career import Career
from app.models.counselor_profile import CounselorProfile
from app.models.credential import VerificationAudit
from app.models.qualification import Qualification
from app.models.user import User
from app.schemas.auth import CareerItem, QualificationItem
from app.schemas.counselor_info import (
    FORBIDDEN_UPDATE_FIELDS,
    CounselorInfoResponse,
    CounselorInfoUpdate,
    PrimaryAdminProfilePatch,
)
from app.services.notification_service import create_notification

# 알림·감사에 원문을 남기지 않는 개인정보 필드
SENSITIVE_FIELDS = {"gender", "birth_date", "postal_code", "address_line1", "address_line2"}

FIELD_LABELS = {
    "name": "이름", "phone": "전화번호", "profile_image": "프로필 사진", "bio": "소개",
    "gender": "성별", "birth_date": "생년월일",
    "postal_code": "우편번호", "address_line1": "주소", "address_line2": "상세 주소",
    "affiliation_type": "활동 형태", "years_of_experience": "경력 연수",
    "specialties": "전문분야", "qualifications": "자격", "careers": "경력",
}

ACTOR_LABELS = {"platform_admin": "플랫폼 관리자", "org_admin": "기관 관리자"}


def _parse_iso_date(value: str | None, label: str, *, allow_future: bool = True) -> date | None:
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label} 형식이 올바르지 않습니다 (YYYY-MM-DD)",
        )
    if not allow_future and parsed > date.today():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{label}은 미래 날짜일 수 없습니다",
        )
    return parsed


def get_target_counselor(user_id: uuid.UUID, db: Session, *, org_id: uuid.UUID | str | None = None) -> User:
    """대상 상담사 조회 — 상담사/기관 관리자 계정만. 기관 경로는 소속 불일치 시 404."""
    from app.services import membership_service

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or user.role not in ("counselor", "org_admin"):
        raise HTTPException(status_code=404, detail="대상 상담사를 찾을 수 없습니다")
    # SDD-079: 소속 검사는 membership 기준 — 다중 소속 상담사도 소속 기관 관리자가 조회 가능
    if org_id is not None and membership_service.get_membership(db, user.id, org_id) is None:
        raise HTTPException(status_code=404, detail="대상 상담사를 찾을 수 없습니다")
    return user


def serialize(user: User) -> CounselorInfoResponse:
    profile = user.counselor_profile
    quals = [
        QualificationItem(
            id=str(q.id), name=q.name, issuer=q.issuer,
            issued_at=str(q.issued_at) if q.issued_at else None,
        )
        for q in (user.qualifications or [])
    ]
    cars = [
        CareerItem(
            id=str(c.id), organization=c.organization, role=c.role,
            started_at=str(c.started_at) if c.started_at else None,
            ended_at=str(c.ended_at) if c.ended_at else None,
            is_current=c.is_current,
        )
        for c in (user.careers or [])
    ]
    return CounselorInfoResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        status=user.status,
        org_id=str(user.org_id) if user.org_id else None,
        org_name=user.org.name if user.org else None,
        counselor_code=profile.counselor_code if profile else None,
        phone=user.phone,
        profile_image=user.profile_image or (profile.profile_image_url if profile else None),
        bio=user.bio or (profile.bio if profile else None),
        gender=profile.gender if profile else None,
        birth_date=str(profile.birth_date) if profile and profile.birth_date else None,
        postal_code=profile.postal_code if profile else None,
        address_line1=profile.address_line1 if profile else None,
        address_line2=profile.address_line2 if profile else None,
        affiliation_type=profile.affiliation_type if profile else None,
        years_of_experience=profile.years_of_experience if profile else None,
        specialties=list(profile.specialties or []) if profile else [],
        qualifications=quals,
        careers=cars,
        version=profile.version if profile else 1,
    )


def _validate_careers(items: list[CareerItem]) -> list[dict]:
    rows = []
    for c in items:
        if not (c.organization or "").strip():
            raise HTTPException(status_code=422, detail="경력의 기관명은 필수입니다")
        started = _parse_iso_date(c.started_at, "경력 시작일")
        ended = None if c.is_current else _parse_iso_date(c.ended_at, "경력 종료일")
        if started and ended and ended < started:
            raise HTTPException(status_code=422, detail="경력 종료일은 시작일 이전일 수 없습니다")
        rows.append({
            "organization": c.organization.strip(), "role": c.role,
            "started_at": started, "ended_at": ended, "is_current": bool(c.is_current),
        })
    return rows


def _validate_qualifications(items: list[QualificationItem]) -> list[dict]:
    rows = []
    for q in items:
        if not (q.name or "").strip():
            raise HTTPException(status_code=422, detail="자격명은 필수입니다")
        issued = _parse_iso_date(q.issued_at, "자격 취득일", allow_future=False)
        rows.append({"name": q.name.strip(), "issuer": q.issuer, "issued_at": issued})
    return rows


def _get_or_create_profile(user: User, db: Session) -> CounselorProfile:
    profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
    if profile is None:
        # 기존 코드 발급 정책 재사용 — 임의 코드 생성 금지
        from app.services.onboarding_service import generate_counselor_code
        profile = CounselorProfile(
            user_id=user.id, counselor_code=generate_counselor_code(db), specialties=[]
        )
        db.add(profile)
        db.flush()
    return profile


_USER_FIELDS = ("name", "phone", "profile_image", "bio")
_PROFILE_FIELDS = (
    "gender", "birth_date", "postal_code", "address_line1", "address_line2",
    "affiliation_type", "years_of_experience", "specialties",
)


def update_profile(
    target: User,
    req: CounselorInfoUpdate,
    db: Session,
    *,
    actor_id: uuid.UUID,
    actor_kind: str,  # "self" | "platform_admin" | "org_admin"
) -> bool:
    """정보 수정 적용 — 변경/감사/알림을 한 트랜잭션으로 커밋. 이름 변경 여부를 반환한다."""
    sent = req.model_fields_set

    forbidden = [f for f in FORBIDDEN_UPDATE_FIELDS if f in sent]
    if forbidden:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"수정할 수 없는 필드입니다: {', '.join(forbidden)}",
        )

    reason = (req.reason or "").strip()
    if actor_kind != "self" and not reason:
        raise HTTPException(status_code=422, detail="변경 사유가 필요합니다")

    profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == target.id).first()

    # 낙관적 잠금 — version 전송 시 현재 버전과 비교 (미전송 구 클라이언트는 생략)
    if req.version is not None:
        current_version = profile.version if profile else 1
        if req.version != current_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 시도해주세요",
            )

    changed: dict[str, tuple] = {}

    # --- 계정 기본 (User) ---
    if "name" in sent:
        if not (req.name or "").strip():
            raise HTTPException(status_code=422, detail="이름은 비울 수 없습니다")
        new_name = req.name.strip()
        if target.name != new_name:
            changed["name"] = (target.name, new_name)
            target.name = new_name
    for field in ("phone", "profile_image", "bio"):
        if field in sent:
            new_value = getattr(req, field)
            if isinstance(new_value, str):
                new_value = new_value.strip() or None
            if getattr(target, field) != new_value:
                changed[field] = (getattr(target, field), new_value)
                setattr(target, field, new_value)

    # --- 상담사 프로필 ---
    birth = _parse_iso_date(req.birth_date, "생년월일", allow_future=False) if "birth_date" in sent else None
    profile_touched = bool(sent & set(_PROFILE_FIELDS)) or req.qualifications is not None or req.careers is not None
    if profile_touched and profile is None:
        profile = _get_or_create_profile(target, db)

    if profile is not None:
        if "gender" in sent and profile.gender != req.gender:
            changed["gender"] = (profile.gender, req.gender)
            profile.gender = req.gender
        if "birth_date" in sent and profile.birth_date != birth:
            changed["birth_date"] = (profile.birth_date, birth)
            profile.birth_date = birth
        for field in ("postal_code", "address_line1", "address_line2", "affiliation_type"):
            if field in sent:
                new_value = getattr(req, field)
                if isinstance(new_value, str):
                    new_value = new_value.strip() or None
                if getattr(profile, field) != new_value:
                    changed[field] = (getattr(profile, field), new_value)
                    setattr(profile, field, new_value)
        if "years_of_experience" in sent and profile.years_of_experience != req.years_of_experience:
            changed["years_of_experience"] = (profile.years_of_experience, req.years_of_experience)
            profile.years_of_experience = req.years_of_experience
        if req.specialties is not None and list(profile.specialties or []) != req.specialties:
            changed["specialties"] = (list(profile.specialties or []), req.specialties)
            profile.specialties = req.specialties

    # 경력/자격 — 기존 정책(전체 삭제 후 재삽입) 유지
    if req.qualifications is not None:
        rows = _validate_qualifications(req.qualifications)
        db.query(Qualification).filter(Qualification.user_id == target.id).delete()
        for row in rows:
            db.add(Qualification(user_id=target.id, **row))
        changed["qualifications"] = (None, None)
    if req.careers is not None:
        rows = _validate_careers(req.careers)
        db.query(Career).filter(Career.user_id == target.id).delete()
        for row in rows:
            db.add(Career(user_id=target.id, **row))
        changed["careers"] = (None, None)

    if not changed:
        return False

    if profile is not None:
        profile.version = (profile.version or 1) + 1

    # --- 감사 + 대상자 알림 (관리자 수정만) — 변경과 같은 트랜잭션으로 저장 ---
    if actor_kind != "self":
        # 개인정보 필드는 원문 대신 필드명만 기록한다
        before = {k: v[0] for k, v in changed.items() if k not in SENSITIVE_FIELDS and k not in ("qualifications", "careers")}
        after = {k: v[1] for k, v in changed.items() if k not in SENSITIVE_FIELDS and k not in ("qualifications", "careers")}
        db.add(VerificationAudit(
            target_type="user", target_id=target.id, admin_id=actor_id,
            action="counselor_profile_updated", reason=reason,
            extra={
                "actor_kind": actor_kind,
                "changed_fields": sorted(changed.keys()),
                "org_id": str(target.org_id) if target.org_id else None,
                "before": before, "after": after,
            },
        ))
        labels = ", ".join(FIELD_LABELS.get(f, f) for f in sorted(changed.keys()))
        actor_label = ACTOR_LABELS.get(actor_kind, "관리자")
        create_notification(
            target.id, "system",
            "내 정보가 수정되었습니다",
            f"{actor_label}가 회원님의 정보({labels})를 수정했습니다. 사유: {reason}",
            db,
            extra={"changed_fields": sorted(changed.keys()), "actor_kind": actor_kind},
        )

    db.commit()
    db.refresh(target)
    return "name" in changed


def update_primary_admin_profile(
    org_id: uuid.UUID,
    req: PrimaryAdminProfilePatch,
    db: Session,
    *,
    actor_id: uuid.UUID,
) -> User:
    """기관 주 담당자 이름/전화 정정.

    primary_admin_id·기관 연락처(Organization.phone/address)는 변경하지 않는다.
    상담사 프로필이 없는 담당자도 수정 가능하며 프로필을 생성하지 않는다.
    """
    from app.services import org_management_service

    org = org_management_service.lock_organization(org_id, db)
    if org.primary_admin_id is None:
        raise HTTPException(status_code=404, detail="주 담당자가 지정되지 않은 기관입니다")
    if req.expected_user_id and str(org.primary_admin_id) != req.expected_user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="주 담당자가 변경되었습니다. 다시 불러온 뒤 시도해주세요",
        )
    user = db.query(User).filter(User.id == org.primary_admin_id).populate_existing().with_for_update().first()
    if user is None:
        raise HTTPException(status_code=404, detail="담당자 정보를 확인할 수 없습니다")

    changed: dict[str, tuple] = {}
    if req.name is not None and user.name != req.name:
        changed["name"] = (user.name, req.name)
        user.name = req.name
    if "phone" in req.model_fields_set:
        new_phone = (req.phone or "").strip() or None
        if user.phone != new_phone:
            changed["phone"] = (user.phone, new_phone)
            user.phone = new_phone

    if not changed:
        db.commit()  # 잠금 해제
        return user

    db.add(VerificationAudit(
        target_type="user", target_id=user.id, admin_id=actor_id,
        action="primary_admin_profile_updated", reason=req.reason,
        extra={
            "org_id": str(org.id),
            "changed_fields": sorted(changed.keys()),
            "before": {k: v[0] for k, v in changed.items()},
            "after": {k: v[1] for k, v in changed.items()},
        },
    ))
    labels = ", ".join(FIELD_LABELS.get(f, f) for f in sorted(changed.keys()))
    create_notification(
        user.id, "system",
        "내 정보가 수정되었습니다",
        f"플랫폼 관리자가 회원님의 정보({labels})를 수정했습니다. 사유: {req.reason}",
        db,
        extra={"changed_fields": sorted(changed.keys()), "actor_kind": "platform_admin"},
    )
    db.commit()
    db.refresh(user)
    return user
