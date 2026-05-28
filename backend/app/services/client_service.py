"""내담자 관리 비즈니스 로직"""

import secrets
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.client_counselor_link import ClientCounselorLink
from app.models.client_invite import ClientInvite
from app.models.client_profile import ClientProfile
from app.models.counselor_profile import CounselorProfile
from app.models.user import User


def list_clients(
    counselor_id: str,
    q: str | None,
    page: int,
    size: int,
    db: Session,
) -> tuple[list[dict], int]:
    """상담사 본인의 내담자 목록 + 검색 + 페이징"""
    query = (
        db.query(User, ClientProfile)
        .join(ClientCounselorLink, ClientCounselorLink.client_id == User.id)
        .outerjoin(ClientProfile, ClientProfile.user_id == User.id)
        .filter(ClientCounselorLink.counselor_id == UUID(counselor_id))
    )

    if q:
        like = f"%{q}%"
        query = query.filter(
            (User.name.ilike(like)) | (User.email.ilike(like))
        )

    total = query.count()
    rows = (
        query.order_by(User.name)
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )

    clients = []
    for user, profile in rows:
        clients.append(
            {
                "id": str(user.id),
                "name": user.name,
                "email": user.email,
                "concerns": profile.concerns if profile else [],
                "last_session_at": None,  # 추후 세션 연동
            }
        )

    return clients, total


def get_client_profile(
    client_id: str, counselor_id: str, db: Session
) -> dict:
    """내담자 프로필 상세 (본인 내담자만)"""
    link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == UUID(client_id),
            ClientCounselorLink.counselor_id == UUID(counselor_id),
        )
        .first()
    )
    if not link:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다",
        )

    user = db.query(User).filter(User.id == client_id).first()
    profile = (
        db.query(ClientProfile)
        .filter(ClientProfile.user_id == client_id)
        .first()
    )

    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "gender": profile.gender if profile else None,
        "birth_date": str(profile.birth_date) if profile and profile.birth_date else None,
        "concerns": profile.concerns if profile else [],
        "interests": profile.interests if profile else [],
        "bio": profile.bio if profile else None,
        "profile_image_url": profile.profile_image_url if profile else None,
        "memo": link.memo if hasattr(link, "memo") else None,
    }


def update_memo(client_id: str, counselor_id: str, memo: str, db: Session):
    """상담사 비공개 메모 수정"""
    link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == client_id,
            ClientCounselorLink.counselor_id == counselor_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="접근 권한이 없습니다"
        )
    # ClientCounselorLink에 memo 컬럼이 없으면 일단 skip
    # 추후 모델에 추가


def create_invite(counselor_id: str, email: str, db: Session) -> dict:
    """내담자 초대 토큰 생성 + 초대 이메일 발송"""
    import logging

    from app.tasks.email import send_invite_email

    logger = logging.getLogger(__name__)
    token = secrets.token_urlsafe(32)
    invite = ClientInvite(
        counselor_id=UUID(counselor_id), email=email, token=token
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    invite_url = f"http://dev.mindbreeze.looxidlabs.com/invite/{token}"

    # 상담사 이름 + 코드 조회
    counselor = db.query(User).filter(User.id == UUID(counselor_id)).first()
    counselor_name = counselor.name if counselor else "상담사"
    profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == UUID(counselor_id)).first()
    counselor_code = profile.counselor_code if profile else "------"

    # 이메일 발송 (실패해도 초대 자체는 성공)
    try:
        send_invite_email(email, invite_url, counselor_name, counselor_code)
        message = f"{email}로 초대 메일을 발송했습니다"
    except Exception as e:
        logger.warning(f"초대 이메일 발송 실패: {e}")
        message = "초대 링크가 생성되었습니다 (이메일 발송 실패)"

    return {
        "invite_token": token,
        "invite_url": f"/invite/{token}",
        "message": message,
    }


def get_invite(token: str, db: Session) -> dict:
    """초대 토큰 조회 → 상담사 정보"""
    invite = (
        db.query(ClientInvite)
        .filter(ClientInvite.token == token)
        .first()
    )
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="초대 링크가 유효하지 않습니다",
        )

    counselor = db.query(User).filter(User.id == invite.counselor_id).first()
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.user_id == invite.counselor_id)
        .first()
    )

    org_name = None
    if counselor.org_id:
        from app.models.organization import Organization
        org = db.query(Organization).filter(Organization.id == counselor.org_id).first()
        if org:
            org_name = org.name

    return {
        "counselor_name": counselor.name,
        "counselor_code": profile.counselor_code if profile else None,
        "organization": org_name,
    }
