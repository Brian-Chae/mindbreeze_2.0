"""내담자 포털 API — Client-facing (상담사 관리, 내 정보)"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.client_counselor_link import ClientCounselorLink
from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.user import User
from app.schemas.client import AddCounselorRequest, CounselorInfo

router = APIRouter(prefix="/client", tags=["client-portal"])


def _get_user_from_token(current_user: dict, db: Session) -> User:
    """deps.py의 get_current_user가 dict를 반환하므로 실제 User 객체로 변환"""
    user = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다",
        )
    return user


@router.get("/counselors", response_model=list[CounselorInfo])
def list_my_counselors(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내가 연결된 상담사 목록"""
    user = _get_user_from_token(current_user, db)

    links = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == user.id,
            ClientCounselorLink.status == "active",
        )
        .all()
    )

    result = []
    for link in links:
        counselor = db.query(User).filter(User.id == link.counselor_id).first()
        if not counselor:
            continue

        profile = (
            db.query(CounselorProfile)
            .filter(CounselorProfile.user_id == counselor.id)
            .first()
        )

        org_name = None
        if counselor.org_id:
            org = db.query(Organization).filter(Organization.id == counselor.org_id).first()
            if org:
                org_name = org.name

        result.append(
            CounselorInfo(
                id=str(counselor.id),
                name=counselor.name,
                profile_image=profile.profile_image_url if profile else None,
                org_name=org_name,
                status=link.status,
            )
        )

    return result


@router.post("/counselors", response_model=CounselorInfo, status_code=status.HTTP_201_CREATED)
def add_counselor_by_code(
    req: AddCounselorRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 코드로 연결 추가"""
    user = _get_user_from_token(current_user, db)

    # 상담사 코드로 CounselorProfile 검색
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.counselor_code == req.code)
        .first()
    )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="유효하지 않은 상담사 코드입니다",
        )

    counselor = db.query(User).filter(User.id == profile.user_id).first()
    if not counselor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="상담사를 찾을 수 없습니다",
        )

    # 이미 연결되어 있는지 확인
    existing = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == user.id,
            ClientCounselorLink.counselor_id == counselor.id,
        )
        .first()
    )

    if existing:
        if existing.status == "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 연결된 상담사입니다",
            )
        else:
            # ended 상태면 재활성화
            existing.status = "active"
            db.commit()
            db.refresh(existing)
    else:
        link = ClientCounselorLink(
            client_id=user.id,
            counselor_id=counselor.id,
            status="active",
        )
        db.add(link)
        db.commit()

    org_name = None
    if counselor.org_id:
        org = db.query(Organization).filter(Organization.id == counselor.org_id).first()
        if org:
            org_name = org.name

    return CounselorInfo(
        id=str(counselor.id),
        name=counselor.name,
        profile_image=profile.profile_image_url,
        org_name=org_name,
        status="active",
    )
