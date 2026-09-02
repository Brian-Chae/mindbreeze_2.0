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


def assign_counselor(
    client_id,
    counselor_id,
    db: Session,
    *,
    create_room: bool = True,
) -> ClientCounselorLink:
    """내담자-상담사 연결(ClientCounselorLink) 생성 공용 함수 (SDD-020).

    link_invited_client / client_portal.add_counselor_by_code 가 각자 갖고 있던
    링크 생성 규칙(중복 방지, ended 재활성화, active 상태, 1:1 채팅방 생성)을
    한 곳으로 수렴한다. 신규 admin 수동 추가(create_client) 경로가 이 함수를 쓴다.

    - 이미 active 링크가 있으면 그대로 반환한다 (idempotent, 채팅방도 재생성하지 않음).
    - ended 링크가 있으면 active 로 재활성화한다.
    - 신규 생성 시 create_room=True 면 상담사-내담자 1:1 채팅방을 만든다.

    참고: get_or_create_direct_room 은 내부에서 db.commit() 을 수행하므로,
    이 함수를 호출하면 진행 중인 트랜잭션이 함께 커밋될 수 있다. 호출부는
    링크 생성 직전까지의 변경(User/ClientProfile 등)이 flush 되어 있어야 한다.

    Args:
        client_id: 내담자 User.id (UUID 또는 str).
        counselor_id: 상담사 User.id (UUID 또는 str).
        db: DB 세션.
        create_room: 신규 링크일 때 1:1 채팅방 자동 생성 여부.

    Returns:
        생성/재활성화/기존 ClientCounselorLink.
    """
    from app.services.chat_service import get_or_create_direct_room

    client_uuid = client_id if isinstance(client_id, UUID) else UUID(str(client_id))
    counselor_uuid = counselor_id if isinstance(counselor_id, UUID) else UUID(str(counselor_id))

    existing = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == client_uuid,
            ClientCounselorLink.counselor_id == counselor_uuid,
        )
        .first()
    )
    if existing is not None:
        if existing.status != "active":
            # ended 링크 재활성화 (add_counselor_by_code 규칙과 동일)
            existing.status = "active"
            existing.ended_at = None
            db.add(existing)
            db.commit()
            db.refresh(existing)
        return existing

    link = ClientCounselorLink(
        client_id=client_uuid,
        counselor_id=counselor_uuid,
        status="active",
    )
    db.add(link)
    if create_room:
        # 채팅방 생성 함수가 내부에서 commit 하므로 링크도 함께 영속화된다.
        get_or_create_direct_room(counselor_uuid, client_uuid, db)
    else:
        db.commit()
    db.refresh(link)
    return link


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

    invite_url = f"https://dev.mindbreeze.looxidlabs.com/invite/{token}"

    # 상담사 이름 조회 (상담사 코드는 더 이상 사용하지 않음)
    counselor = db.query(User).filter(User.id == UUID(counselor_id)).first()
    counselor_name = counselor.name if counselor else "상담사"

    # 이메일 발송 (실패해도 초대 자체는 성공)
    try:
        send_invite_email(email, invite_url, counselor_name)
        message = f"{email}로 초대 메일을 발송했습니다"
    except Exception as e:
        logger.warning(f"초대 이메일 발송 실패: {e}")
        message = "초대 링크가 생성되었습니다 (이메일 발송 실패)"

    return {
        "invite_token": token,
        "invite_url": f"/invite/{token}",
        "message": message,
    }


def link_invited_client(
    invite_token: str, client: User, db: Session
) -> ClientInvite | None:
    """초대 토큰으로 내담자를 초대한 상담사에 자동 연결한다.

    register_client(이메일 가입)와 google_auth(구글 가입) 양쪽이 공유하는 공통 로직.
    기존 google_auth 인라인 로직에 있던 보안 결함을 여기서 일괄 보완한다:

    - 이메일 일치 검증: 초대받은 이메일(invite.email)과 실제 가입 이메일(client.email)이
      일치할 때만 연결한다. 불일치 시 링크를 만들지 않는다.
      (초대 링크를 가로챈 제3자가 다른 이메일 계정으로 상담사에 연결되는 것을 차단)
    - single-use: 연결에 성공하면 초대 상태를 "accepted"로 전환한다.
    - 만료 처리: status가 "expired"면 무효로 간주한다.

    Args:
        invite_token: 초대 토큰(ClientInvite.token). 빈 값이면 아무 것도 하지 않음.
        client: 방금 가입한 내담자 User (이메일은 이미 검증된 상태).
        db: DB 세션.

    Returns:
        연결 성공(또는 동일 사용자의 idempotent 재수락) 시 ClientInvite.
        토큰 무효 / 만료 / 이메일 불일치 시 None
        (이 경우 가입 자체는 성공하고, 온보딩에서 상담사 코드 수동 입력으로 폴백한다).
    """
    # 순환 import 방지를 위해 함수 내부에서 지연 import
    from app.services import onboarding_service
    from app.services.chat_service import get_or_create_direct_room

    if not invite_token:
        return None

    invite = (
        db.query(ClientInvite)
        .filter(ClientInvite.token == invite_token)
        .first()
    )
    # 존재하지 않거나 이미 만료된 초대는 무효
    if invite is None or invite.status == "expired":
        return None

    # 이메일 일치 검증 — 초대 대상 이메일과 가입 이메일이 같아야만 연결한다
    if (invite.email or "").strip().lower() != (client.email or "").strip().lower():
        return None

    counselor_id = invite.counselor_id

    # 링크 중복 방지 — 이미 연결돼 있으면 새로 만들지 않는다(idempotent)
    existing_link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == client.id,
            ClientCounselorLink.counselor_id == counselor_id,
        )
        .first()
    )
    if existing_link is None:
        link = ClientCounselorLink(
            client_id=client.id,
            counselor_id=counselor_id,
            status="active",
        )
        db.add(link)
        # 수동 코드 매칭(onboarding.client_step4_match)과 동일하게
        # 상담사-내담자 1:1 채팅방을 자동 생성한다
        get_or_create_direct_room(counselor_id, client.id, db)

    # single-use: 초대 수락 처리
    invite.status = "accepted"

    # 온보딩 완료 게이트 해소 — step4(상담사 매칭)를 초대 정보로 미리 마킹한다.
    # 이렇게 해두면 초대 가입자는 온보딩에서 상담사 코드를 다시 입력하지 않아도
    # client_complete의 step4 필수 조건을 통과한다.
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.user_id == counselor_id)
        .first()
    )
    counselor_code = profile.counselor_code if profile else None
    onboarding_service.save_step(
        str(client.id),
        4,
        {"counselor_code": counselor_code, "counselor_id": str(counselor_id)},
        db,
    )

    db.commit()
    return invite


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
