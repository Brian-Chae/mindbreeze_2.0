"""F6 채팅 REST API"""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.chat import (
    MessageCreateRequest,
    MessageListResponse,
    MessageResponse,
    RoomCreateRequest,
    RoomListResponse,
    RoomResponse,
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
def mark_read(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    chat_service.mark_read(room_id, current_user["id"], db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
