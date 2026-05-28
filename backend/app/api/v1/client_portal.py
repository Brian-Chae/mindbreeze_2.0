"""내담자 포털 API — Client-facing (상담사 관리, 내 정보, 홈)"""

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.chat import ChatMessage, ChatMessageRead, ChatRoomParticipant
from app.models.client_counselor_link import ClientCounselorLink
from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.record import Report
from app.models.session import Session as SessionModel, SessionParticipant
from app.models.user import User
from app.services.chat_service import get_or_create_direct_room
from app.schemas.client import (
    AddCounselorRequest,
    ClientHomeResponse,
    CounselorInfo,
    NextSessionInfo,
    RecentReportInfo,
)

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
        # 상담사 연결 시 채팅방 자동 생성
        get_or_create_direct_room(counselor.id, user.id, db)

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


# ── 내담자 홈 화면 ──

def _get_today_range() -> tuple[datetime, datetime]:
    """오늘의 시작/끝 datetime (UTC) 반환"""
    now = datetime.now(timezone.utc)
    today_start = datetime.combine(now.date(), datetime.min.time()).replace(tzinfo=timezone.utc)
    today_end = datetime.combine(now.date(), datetime.max.time()).replace(tzinfo=timezone.utc)
    return today_start, today_end


@router.get("/home", response_model=ClientHomeResponse)
def get_client_home(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내담자 홈 화면 집계 데이터

    - 다음 예정 세션
    - 최근 리포트
    - 안 읽은 메시지 수
    - 오늘 세션 수
    """
    user = _get_user_from_token(current_user, db)
    user_id = user.id
    now = datetime.now(timezone.utc)

    # ── 1. 다음 예정 세션 ──
    next_session: NextSessionInfo | None = None

    upcoming_session = (
        db.query(SessionModel)
        .join(SessionParticipant, SessionParticipant.session_id == SessionModel.id)
        .filter(
            SessionParticipant.user_id == user_id,
            SessionModel.status == "scheduled",
            SessionModel.scheduled_at > now,
        )
        .order_by(SessionModel.scheduled_at.asc())
        .first()
    )

    if upcoming_session:
        counselor = db.query(User).filter(User.id == upcoming_session.host_id).first()
        next_session = NextSessionInfo(
            id=str(upcoming_session.id),
            title=upcoming_session.title or "상담 세션",
            counselor_name=counselor.name if counselor else "알 수 없음",
            counselor_id=str(upcoming_session.host_id),
            start_time=upcoming_session.scheduled_at.isoformat(),
            status=upcoming_session.status,
        )

    # ── 2. 최근 리포트 ──
    recent_report: RecentReportInfo | None = None

    latest_report = (
        db.query(Report)
        .filter(Report.user_id == user_id)
        .order_by(Report.created_at.desc())
        .first()
    )

    if latest_report:
        title = latest_report.created_at.strftime("%m월 %d일") + " 리포트"
        recent_report = RecentReportInfo(
            id=str(latest_report.id),
            title=title,
            created_at=latest_report.created_at.isoformat(),
        )

    # ── 3. 안 읽은 메시지 수 ──
    # 사용자가 참여한 채팅방의 메시지 중, 자신이 보낸 것이 아니고 아직 읽지 않은 것
    participant_room_ids = (
        db.query(ChatRoomParticipant.room_id)
        .filter(ChatRoomParticipant.user_id == user_id)
        .subquery()
    )

    total_received = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.room_id.in_(db.query(participant_room_ids.c.room_id)),
            ChatMessage.sender_id != user_id,
        )
        .count()
    )

    read_count = (
        db.query(ChatMessageRead)
        .join(ChatMessage, ChatMessage.id == ChatMessageRead.message_id)
        .filter(
            ChatMessage.room_id.in_(db.query(participant_room_ids.c.room_id)),
            ChatMessageRead.user_id == user_id,
            ChatMessage.sender_id != user_id,
        )
        .count()
    )

    unread_messages = max(total_received - read_count, 0)

    # ── 4. 오늘 세션 수 ──
    today_start, today_end = _get_today_range()

    today_sessions = (
        db.query(SessionModel)
        .join(SessionParticipant, SessionParticipant.session_id == SessionModel.id)
        .filter(
            SessionParticipant.user_id == user_id,
            SessionModel.scheduled_at >= today_start,
            SessionModel.scheduled_at <= today_end,
        )
        .count()
    )

    return ClientHomeResponse(
        next_session=next_session,
        recent_report=recent_report,
        unread_messages=unread_messages,
        today_sessions=today_sessions,
    )
