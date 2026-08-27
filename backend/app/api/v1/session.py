"""세션 관리 API"""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.session import (
    InviteParticipantRequest,
    MarkerRequest,
    SessionCreateRequest,
    SessionListResponse,
    SessionResponse,
    SessionUpdateRequest,
)
from app.services import session_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=SessionListResponse)
def list_sessions(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    sessions, total = session_service.list_sessions(current_user["id"], db)
    return SessionListResponse(sessions=sessions, total=total)


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.create_session(current_user["id"], payload, db)


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.get_session(session_id, current_user["id"], db)


@router.put("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    payload: SessionUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.update_session(session_id, current_user["id"], payload, db)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    session_service.delete_session(session_id, current_user["id"], db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _make_transition_endpoint(action: str):
    def endpoint(
        session_id: str,
        current_user: dict = Depends(get_current_user),
        db: DBSession = Depends(get_db),
    ):
        return session_service.transition_status(session_id, current_user["id"], action, db)
    return endpoint


for _action in ("start", "pause", "resume", "end", "cancel"):
    router.add_api_route(
        f"/{{session_id}}/{_action}",
        _make_transition_endpoint(_action),
        methods=["POST"],
        response_model=SessionResponse,
        name=f"session_{_action}",
    )


@router.post("/{session_id}/invite", response_model=SessionResponse)
def invite_participant(
    session_id: str,
    payload: InviteParticipantRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.invite_participant(session_id, current_user["id"], payload.user_id, db)


@router.delete("/{session_id}/participants/{user_id}", response_model=SessionResponse)
def remove_participant(
    session_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.remove_participant(session_id, current_user["id"], user_id, db)


@router.post("/{session_id}/markers")
def add_marker(
    session_id: str,
    payload: MarkerRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.add_marker(
        session_id, current_user["id"], payload.timestamp_sec, payload.note, db
    )


# ── LiveKit WebRTC ──────────────────────────────────────────────

@router.post("/{session_id}/livekit-token")
def get_livekit_token(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """현재 사용자에게 LiveKit 접근 토큰을 발급합니다."""
    s = session_service._get_session_for_participant(session_id, current_user["id"], db)
    if not s.webrtc_room_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="WebRTC 룸이 아직 생성되지 않았습니다")
    token = session_service.generate_livekit_token(
        room_name=str(s.webrtc_room_id),
        participant_name=current_user.get("name", "익명"),
        participant_id=current_user["id"],
    )
    return {"livekit_token": token, "webrtc_room_id": str(s.webrtc_room_id)}


@router.post("/{session_id}/join")
def join_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """세션 입장 처리 — 상태 전이 + LiveKit 토큰 발급"""
    return session_service.join_session(
        session_id=session_id,
        user_id=current_user["id"],
        user_name=current_user.get("name", "익명"),
        db=db,
    )
