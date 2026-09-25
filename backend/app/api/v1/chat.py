"""F6 채팅 REST API"""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.chat import (
    MarkMessagesReadRequest,
    MessageCreateRequest,
    MessageListResponse,
    MessageResponse,
    RoomCreateRequest,
    RoomListResponse,
    RoomParticipantsAddRequest,
    RoomParticipantOut,
    RoomParticipantsResponse,
    RoomResponse,
    RoomUpdateRequest,
    UnreadCountsResponse,
)
from app.services import chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/rooms", response_model=RoomListResponse)
def list_rooms(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    rooms = chat_service.list_my_rooms(current_user["id"], db)
    return RoomListResponse(rooms=[RoomResponse(**r) for r in rooms])


@router.post("/rooms", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
def create_room(
    payload: RoomCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    room = chat_service.create_room(
        host_id=current_user["id"],
        room_type=payload.room_type,
        client_id=payload.client_id,
        participant_ids=payload.participant_ids,
        name=payload.name,
        db=db,
    )
    return RoomResponse(**room)


@router.get("/rooms/{room_id}", response_model=RoomResponse)
def get_room(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return RoomResponse(**chat_service.get_room(room_id, current_user["id"], db))


@router.patch("/rooms/{room_id}", response_model=RoomResponse)
def update_room(
    room_id: str,
    payload: RoomUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """채팅방 이름 변경 (SDD-090) — direct/group host 전용, session은 403."""
    room = chat_service.update_room(room_id, current_user["id"], payload.name, db)
    return RoomResponse(**room)


@router.post("/rooms/{room_id}/participants", response_model=RoomResponse)
def add_room_participants(
    room_id: str,
    payload: RoomParticipantsAddRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """그룹방 참여자 추가 (SDD-090) — group host 전용."""
    room = chat_service.add_room_participants(
        room_id, current_user["id"], payload.participant_ids, db
    )
    return RoomResponse(**room)


@router.get("/rooms/{room_id}/participants", response_model=RoomParticipantsResponse)
def list_room_participants(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """그룹방 참여자 명단 조회 (SDD-090) — group host 전용."""
    participants = chat_service.get_room_participants(room_id, current_user["id"], db)
    return RoomParticipantsResponse(
        participants=[RoomParticipantOut(**p) for p in participants]
    )


@router.delete("/rooms/{room_id}/participants/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_room_participant(
    room_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """그룹방 참여자 내보내기 (SDD-090) — group host 전용."""
    chat_service.remove_room_participant(room_id, current_user["id"], user_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/rooms/{room_id}/messages", response_model=MessageListResponse)
def list_messages(
    room_id: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    msgs = chat_service.list_messages(room_id, current_user["id"], db, limit=limit)
    return MessageListResponse(messages=[MessageResponse(**m) for m in msgs])


@router.post("/rooms/{room_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    room_id: str,
    payload: MessageCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    msg = await chat_service.post_message(
        room_id, current_user["id"], payload.content, payload.type, payload.file_url, db
    )
    return MessageResponse(**msg)


@router.put("/rooms/{room_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    await chat_service.mark_read(room_id, current_user["id"], db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rooms/{room_id}/messages/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_messages_read(
    room_id: str,
    payload: MarkMessagesReadRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """여러 메시지를 한 번에 읽음 처리 (Phase 3a)."""
    await chat_service.mark_messages_read(
        room_id, current_user["id"], payload.message_ids, db
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/rooms/{room_id}/unread-counts", response_model=UnreadCountsResponse)
def get_unread_counts(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """채팅방의 각 메시지별 안읽은 수 반환 (Phase 3a)."""
    counts = chat_service.get_unread_counts(room_id, current_user["id"], db)
    return UnreadCountsResponse(unread_counts=counts)
