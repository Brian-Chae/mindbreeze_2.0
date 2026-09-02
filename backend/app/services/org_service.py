"""상담센터(Organization) 비즈니스 로직 서비스"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.org_join_request import OrganizationJoinRequest
from app.models.user import User
from app.schemas.org import OrganizationCreate
from app.services import code_service


def validate_biz_number(biz_number: str) -> bool:
    """사업자등록번호 체크섬 검증 (국세청 표준 알고리즘).

    형식: XXX-XX-XXXXX 또는 10자리 숫자. 가중치 (1,3,7,1,3,7,1,3,5)를 곱해
    합을 구한 뒤, 9번째 자리(5*가중치)는 10으로 나눈 몫을 더해
    (10 - 합 % 10) % 10 이 마지막 체크 디짓과 같아야 한다.
    """
    digits = "".join(ch for ch in str(biz_number) if ch.isdigit())
    if len(digits) != 10:
        return False

    weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    total = 0
    for i in range(9):
        total += int(digits[i]) * weights[i]
    # 9번째 자리(인덱스 8)에 5를 곱한 결과의 10의 자리 가산
    total += int(digits[8]) * 5 // 10
    check = (10 - (total % 10)) % 10
    return check == int(digits[9])


def _normalize_biz_number(biz_number: str) -> str:
    """저장용으로 하이픈 제거된 10자리 숫자만 보관."""
    return "".join(ch for ch in str(biz_number) if ch.isdigit())


def _org_to_dict(org: Organization, status_str: str | None = None) -> dict:
    return {
        "id": str(org.id),
        "name": org.name,
        "ceo_name": org.ceo_name,
        "biz_number": org.biz_number,
        "address": org.address,
        "phone": org.phone,
        "verified": org.verified,
        "verified_at": org.verified_at.isoformat() if org.verified_at else None,
        "created_at": org.created_at.isoformat() if org.created_at else None,
    }


def create_organization(
    data: OrganizationCreate, created_by_id: str, db: Session
) -> Organization:
    """센터 등록 + 신청자 OrgAdmin 승격 + User.org_id 설정."""
    if not validate_biz_number(data.biz_number):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="유효하지 않은 사업자등록번호입니다",
        )

    biz_norm = _normalize_biz_number(data.biz_number)
    existing = db.query(Organization).filter(Organization.biz_number == biz_norm).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 등록된 사업자등록번호입니다",
        )

    user = db.query(User).filter(User.id == uuid.UUID(created_by_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    if user.org_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 다른 센터에 소속된 사용자입니다",
        )

    org = Organization(
        name=data.name,
        ceo_name=data.ceo_name,
        biz_number=biz_norm,
        address=data.address,
        phone=data.phone,
        verified=False,
        # SDD-015: 상담사 가입에 쓰이는 6자리 기관 코드를 등록 시점에 발급
        org_code=generate_org_code(db),
    )
    db.add(org)
    db.flush()

    # 신청자를 OrgAdmin으로 승격하고 센터 소속 부여
    user.role = "org_admin"
    user.org_id = org.id

    db.commit()
    db.refresh(org)
    return org


def search_organizations(
    q: str | None, region: str | None, db: Session
) -> list[Organization]:
    """센터 검색 (이름·주소 LIKE 검색)."""
    query = db.query(Organization)
    if q:
        like = f"%{q}%"
        query = query.filter((Organization.name.ilike(like)) | (Organization.address.ilike(like)))
    if region:
        query = query.filter(Organization.address.ilike(f"%{region}%"))
    return query.order_by(Organization.created_at.desc()).limit(50).all()


def get_organization(org_id: str, db: Session) -> Organization:
    org = db.query(Organization).filter(Organization.id == uuid.UUID(org_id)).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="센터를 찾을 수 없습니다")
    return org


def request_join(org_id: str, user_id: str, db: Session) -> OrganizationJoinRequest:
    """가입 신청 (중복·기소속 체크)."""
    org_uuid = uuid.UUID(org_id)
    user_uuid = uuid.UUID(user_id)

    org = db.query(Organization).filter(Organization.id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="센터를 찾을 수 없습니다")

    user = db.query(User).filter(User.id == user_uuid).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    if user.org_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 다른 센터에 소속되어 있습니다",
        )

    # 동일 센터에 pending 상태 신청이 있는지 확인
    existing = (
        db.query(OrganizationJoinRequest)
        .filter(
            OrganizationJoinRequest.user_id == user_uuid,
            OrganizationJoinRequest.org_id == org_uuid,
            OrganizationJoinRequest.status == "pending",
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 가입 신청이 진행 중입니다",
        )

    req = OrganizationJoinRequest(user_id=user_uuid, org_id=org_uuid, status="pending")
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def list_my_join_requests(user_id: str, db: Session) -> list[dict]:
    """내가 신청한 가입 요청 목록."""
    rows = (
        db.query(OrganizationJoinRequest, Organization)
        .join(Organization, Organization.id == OrganizationJoinRequest.org_id)
        .filter(OrganizationJoinRequest.user_id == uuid.UUID(user_id))
        .order_by(OrganizationJoinRequest.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(req.id),
            "org_id": str(req.org_id),
            "org_name": org.name,
            "status": req.status,
            "reason": req.reason,
            "created_at": req.created_at.isoformat() if req.created_at else "",
        }
        for req, org in rows
    ]


def list_org_join_requests(org_id: str, db: Session) -> list[dict]:
    """센터의 가입 신청 목록 — OrgAdmin 전용."""
    rows = (
        db.query(OrganizationJoinRequest, User, Organization)
        .join(User, User.id == OrganizationJoinRequest.user_id)
        .join(Organization, Organization.id == OrganizationJoinRequest.org_id)
        .filter(OrganizationJoinRequest.org_id == uuid.UUID(org_id))
        .order_by(OrganizationJoinRequest.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(req.id),
            "org_id": str(req.org_id),
            "org_name": org.name,
            "user_id": str(user.id),
            "user_name": user.name,
            "user_email": user.email,
            "status": req.status,
            "reason": req.reason,
            "created_at": req.created_at.isoformat() if req.created_at else "",
        }
        for req, user, org in rows
    ]


def handle_join_request(
    req_id: str,
    org_id: str,
    admin_user_id: str,
    new_status: str,
    reason: str | None,
    db: Session,
) -> OrganizationJoinRequest:
    """승인/거절 처리 + 승인 시 User.org_id 설정."""
    if new_status not in ("approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status는 approved 또는 rejected만 허용됩니다",
        )

    admin = db.query(User).filter(User.id == uuid.UUID(admin_user_id)).first()
    if not admin or admin.role != "org_admin" or str(admin.org_id) != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 센터의 관리자만 처리할 수 있습니다",
        )

    req = (
        db.query(OrganizationJoinRequest)
        .filter(
            OrganizationJoinRequest.id == uuid.UUID(req_id),
            OrganizationJoinRequest.org_id == uuid.UUID(org_id),
        )
        .first()
    )
    if not req:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="가입 신청을 찾을 수 없습니다"
        )
    if req.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 처리된 신청입니다",
        )

    req.status = new_status
    req.reason = reason

    if new_status == "approved":
        applicant = db.query(User).filter(User.id == req.user_id).first()
        if applicant and applicant.org_id is None:
            applicant.org_id = req.org_id

    db.commit()
    db.refresh(req)
    return req


def get_counselors(org_id: str, db: Session) -> list[User]:
    """소속 상담사 목록 (counselor + org_admin)."""
    return (
        db.query(User)
        .filter(
            User.org_id == uuid.UUID(org_id),
            User.role.in_(["counselor", "org_admin"]),
        )
        .order_by(User.created_at.asc())
        .all()
    )


def update_counselor_role(
    org_id: str, user_id: str, new_role: str, admin_user_id: str, db: Session
) -> User:
    """상담사 권한 조정 (counselor ↔ org_admin)."""
    if new_role not in ("counselor", "org_admin"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="role은 counselor 또는 org_admin만 허용됩니다",
        )

    admin = db.query(User).filter(User.id == uuid.UUID(admin_user_id)).first()
    if not admin or admin.role != "org_admin" or str(admin.org_id) != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 센터의 관리자만 변경할 수 있습니다",
        )

    user = (
        db.query(User)
        .filter(User.id == uuid.UUID(user_id), User.org_id == uuid.UUID(org_id))
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="대상 상담사를 찾을 수 없습니다"
        )

    user.role = new_role
    db.commit()
    db.refresh(user)
    return user


def remove_counselor(org_id: str, user_id: str, admin_user_id: str, db: Session) -> None:
    """상담사 소속 해제."""
    admin = db.query(User).filter(User.id == uuid.UUID(admin_user_id)).first()
    if not admin or admin.role != "org_admin" or str(admin.org_id) != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 센터의 관리자만 해제할 수 있습니다",
        )

    user = (
        db.query(User)
        .filter(User.id == uuid.UUID(user_id), User.org_id == uuid.UUID(org_id))
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="대상 상담사를 찾을 수 없습니다"
        )

    user.org_id = None
    # OrgAdmin이었다면 일반 상담사로 강등
    if user.role == "org_admin":
        user.role = "counselor"
    db.commit()


# ---------------------------------------------------------------------------
# SDD-015: 기관 코드 발급 · system_admin 간이 등록 · 코드 조회
# ---------------------------------------------------------------------------


def generate_org_code(db: Session) -> str:
    """6자리 기관 코드 발급 — Organization.org_code 에서 unique 보장."""
    return code_service.generate_unique_code(db, Organization, "org_code", label="기관 코드")


def admin_create_organization(name: str, db: Session, *, phone: str | None = None) -> Organization:
    """system_admin(platform_admin) 전용 간이 기관 등록.

    기관명만으로 기관을 만들고 기관 코드를 발급한다.
    기존 /org/register(신청자 → org_admin 승격) 흐름과 달리 사용자 역할을 바꾸지 않는다.
    """
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="기관명을 입력해야 합니다",
        )

    org = Organization(
        name=clean_name,
        phone=phone,
        verified=True,  # 플랫폼 관리자가 직접 등록하므로 검증 완료로 간주
        org_code=generate_org_code(db),
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def get_organization_by_code(code: str, db: Session) -> Organization | None:
    """기관 코드로 기관 조회 — 없으면 None."""
    normalized = code_service.normalize_code(code)
    if len(normalized) != code_service.CODE_LENGTH:
        return None
    return db.query(Organization).filter(Organization.org_code == normalized).first()


def list_organizations(db: Session) -> list[Organization]:
    """전체 기관 목록 (system_admin 용)."""
    return db.query(Organization).order_by(Organization.created_at.desc()).all()


# ---------------------------------------------------------------------------
# SDD-016: 기관 + 주 담당자(org_admin) 동시 등록
# ---------------------------------------------------------------------------


def create_org_with_admin(
    *,
    name: str,
    admin_name: str,
    admin_email: str,
    admin_phone: str | None,
    phone: str | None,
    address: str | None,
    db: Session,
) -> tuple[Organization, User]:
    """기관 + org_admin 계정을 함께 생성한다 (SDD-016).

    담당자 계정은 비밀번호를 설정하지 않은 상태(status="pending")로 만들고,
    추측 불가능한 난수 해시를 넣어 초대 수락 전에는 로그인할 수 없게 한다.
    이메일이 이미 사용 중이면 409로 거부한다 — 자동 병합·승격은 권한 상승 위험이 있다.
    """
    import secrets

    from app.core.security import hash_password

    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="기관명을 입력해야 합니다",
        )

    email = (admin_email or "").strip().lower()
    if db.query(User).filter(User.email == email).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 등록된 이메일입니다",
        )

    org = Organization(
        name=clean_name,
        phone=phone,
        address=address,
        verified=True,  # 플랫폼 관리자가 직접 등록하므로 검증 완료로 간주
        org_code=generate_org_code(db),
    )
    db.add(org)
    db.flush()

    admin = User(
        email=email,
        # 초대 수락 전까지 아무도 알 수 없는 난수 — 실질적으로 로그인 불가
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=(admin_name or "").strip(),
        phone=admin_phone,
        role="org_admin",
        org_id=org.id,
        status="pending",
        verified_tier="unverified",
    )
    db.add(admin)
    db.flush()

    org.primary_admin_id = admin.id
    db.commit()
    db.refresh(org)
    db.refresh(admin)
    return org, admin


def get_primary_admin(org_id: str, db: Session) -> tuple[Organization, User]:
    """기관과 주 담당자를 함께 조회한다. 없으면 404."""
    try:
        oid = uuid.UUID(str(org_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기관을 찾을 수 없습니다")

    org = db.query(Organization).filter(Organization.id == oid).first()
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기관을 찾을 수 없습니다")
    if org.primary_admin_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="기관에 등록된 담당자가 없습니다"
        )

    admin = db.query(User).filter(User.id == org.primary_admin_id).first()
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="담당자 계정을 찾을 수 없습니다"
        )
    return org, admin
