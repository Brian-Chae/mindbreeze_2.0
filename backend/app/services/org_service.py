"""상담센터(Organization) 비즈니스 로직 서비스"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.org_join_request import OrganizationJoinRequest
from app.models.user import User
from app.schemas.org import OrganizationCreate


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
