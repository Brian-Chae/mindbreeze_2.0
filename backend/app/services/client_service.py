"""내담자 관리 비즈니스 로직"""

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models.client_counselor_link import ClientCounselorLink
from app.models.client_invite import ClientInvite
from app.models.client_profile import ClientProfile
from app.models.counselor_profile import CounselorProfile
from app.models.user import User

# DATA-04: 초대 토큰 만료 정책 — status 컬럼만으로는 초대가 영구 유효해진다.
#   created_at 기준 7일이 지나면 만료로 간주한다(DB 마이그레이션 없이 처리).
INVITE_TTL_DAYS = 7


def _invite_is_expired(invite: ClientInvite) -> bool:
    """초대 만료 여부 — status='expired' 이거나 created_at 기준 7일 경과 시 True."""
    if invite.status == "expired":
        return True
    created_at = invite.created_at
    if created_at is None:
        return False
    # SQLite 등에서는 naive datetime 으로 반환될 수 있어 UTC 로 보정한다.
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - created_at > timedelta(days=INVITE_TTL_DAYS)


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

    참고: create_room=True 이면 get_or_create_direct_room 이 내부에서 commit 을 수행한다.
    create_room=False(가입 트랜잭션에 합류하는 경로)에서는 링크만 flush 하고 커밋은
    상위 요청이 단일 트랜잭션으로 처리한다(DATA-03).

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

    from app.services.org_management_service import require_active_org
    users = db.query(User).filter(User.id.in_([client_uuid, counselor_uuid])).all()
    previous_org_ids = {user.id: user.org_id for user in users}
    # 복수 기관은 ID 순서대로 잠가 교착을 피한다.
    for org_id in sorted({user.org_id for user in users if user.org_id}, key=str):
        require_active_org(org_id, db)
    for user in users:
        db.refresh(user, attribute_names=["org_id"])
        if user.org_id != previous_org_ids[user.id]:
            raise HTTPException(409, "소속 기관이 변경되었습니다. 다시 시도해주세요")
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
            # DATA-03: commit 하지 않고 flush 만 수행 — 호출부(요청)가 트랜잭션을 소유한다.
            db.flush()
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
        # DATA-03: 채팅방을 만들지 않는 경로는 flush 만 — 상위 요청이 단일 커밋한다.
        db.flush()
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
        # SEC-09: 종료(ended)된 연결의 내담자는 목록에서 제외한다 (IDOR 방지).
        .filter(ClientCounselorLink.status == "active")
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
            # SEC-09: active 연결만 허용 — 종료된 연결로는 접근 불가 (IDOR 방지).
            ClientCounselorLink.status == "active",
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
        "memo": link.memo,
    }


def update_memo(client_id: str, counselor_id: str, memo: str, db: Session) -> None:
    """상담사 비공개 메모 수정 — active 연결에만 저장 허용 (MB2-CLIENT-01)."""
    link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == client_id,
            ClientCounselorLink.counselor_id == counselor_id,
            # SEC-09: active 연결만 메모 수정 허용 (종료된 연결 IDOR 방지).
            ClientCounselorLink.status == "active",
        )
        .first()
    )
    if not link:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="접근 권한이 없습니다"
        )
    link.memo = memo
    db.commit()


def create_invite(counselor_id: str, email: str, db: Session) -> dict:
    """내담자 초대 토큰 생성 + 초대 이메일 발송"""
    import logging

    from app.tasks.email import send_invite_email

    logger = logging.getLogger(__name__)
    # MB2-AUTH-02: 초대 이메일도 대소문자 정규화 — 가입 이메일과 동일 기준으로 비교되도록.
    email = (email or "").strip().lower()
    token = secrets.token_urlsafe(32)
    # TODO(CFG-01): 초대 토큰을 평문으로 저장 중이다. 링크 해시 저장(단방향)으로
    # 전환하려면 기존 발급 링크 호환(마이그레이션·이중 조회)이 필요해 이번 범위에서는
    # 보류한다. 적용 시 ClientInvite.token_hash 도입 + 기존 token 병행 조회.
    invite = ClientInvite(
        counselor_id=UUID(counselor_id), email=email, token=token
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    # CFG-01: 하드코딩 대신 설정된 프론트 base URL 사용 (환경별 도메인 대응)
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/invite/{token}"

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
    invite_token: str, client: User, db: Session, *, create_room: bool = True
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
        create_room: 신규 링크일 때 1:1 채팅방을 즉시 생성할지 여부.
            False 면 링크만 flush 하고 커밋/채팅방 생성은 호출부(가입 트랜잭션)가 처리한다(DATA-03).

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
    if invite is None:
        return None
    # DATA-04: status='expired' 뿐 아니라 created_at 7일 경과도 만료로 처리한다.
    #   만료 판정 시 status 를 'expired' 로 전환해 이후 재사용을 차단한다.
    if _invite_is_expired(invite):
        if invite.status != "expired":
            invite.status = "expired"
            # DATA-03: 커밋은 요청 단위로 — 여기서는 flush 만.
            db.flush()
        return None

    # MB2-CLIENT-03: single-use 강화 — 최초 수락(pending)일 때만 연결한다.
    #   'accepted' 등 이미 사용된 초대는 재사용을 차단한다(초대 링크 무한 재사용 방지).
    #   최초 수락 시에만 아래에서 링크/step4 를 기록하고 status='accepted' 로 전환한다.
    if invite.status != "pending":
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
        if create_room:
            # 수동 코드 매칭(onboarding.client_step4_match)과 동일하게
            # 상담사-내담자 1:1 채팅방을 자동 생성한다
            get_or_create_direct_room(counselor_id, client.id, db)
        else:
            # DATA-03: 가입 트랜잭션에 합류하는 경로 — 링크만 flush, 채팅방은 커밋 이후 생성.
            db.flush()

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

    # DATA-03: 커밋은 요청 단위로 통일 — 가입 트랜잭션이 함께 커밋하도록 flush 만 한다.
    db.flush()
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

    # MB2-CLIENT-02: 공개 조회에서도 만료·사용 완료를 검증한다.
    #   만료(status='expired'/7일 경과) 또는 이미 수락(accepted)된 초대는 노출하지 않는다.
    if invite.status != "pending" or _invite_is_expired(invite):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="초대 링크가 만료되었거나 이미 사용되었습니다",
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
