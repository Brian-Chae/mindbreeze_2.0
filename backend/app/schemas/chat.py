"""채팅 스키마"""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


MessageType = Literal["text", "image", "file", "system"]
RoomType = Literal["direct", "session", "group"]


class RoomCreateRequest(BaseModel):
    client_id: str | None = None
    room_type: RoomType = "direct"
    participant_ids: list[str] | None = None
    name: str | None = None


class RoomUpdateRequest(BaseModel):
    """SDD-090: 채팅방 이름 변경 요청 — 허용하지 않은 필드는 거부"""
    model_config = ConfigDict(extra="forbid")

    name: str

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("채팅방 이름을 입력해 주세요")
        if len(v) > 120:
            raise ValueError("채팅방 이름은 120자 이하여야 합니다")
        # 줄바꿈·제어문자 거부 (일반 공백·한글·영문·숫자·이모지는 허용)
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in v):
            raise ValueError("채팅방 이름에 줄바꿈이나 제어문자를 사용할 수 없습니다")
        return v


class RoomParticipantsAddRequest(BaseModel):
    """SDD-090: 그룹방 참여자 추가 요청"""
    participant_ids: list[str] = Field(..., min_length=1, max_length=100)


class RoomParticipantOut(BaseModel):
    """SDD-090: 그룹방 참여자 정보"""
    user_id: str
    name: str
    # SDD-092: 상담사/내담자 구분 (User.role 조회 시점 값 — 필드 추가만, 하위 호환)
    role: str | None = None
    joined_at: datetime | None = None


class RoomParticipantsResponse(BaseModel):
    """SDD-090: 그룹방 참여자 명단 응답"""
    participants: list[RoomParticipantOut]


class RoomForkRequest(BaseModel):
    """SDD-092: "새 방으로 만들기"(fork) 요청 — 새로 초대할 대상 + 새 방 이름(선택)"""
    participant_ids: list[str] = Field(..., min_length=1, max_length=100)
    name: str | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str | None) -> str | None:
        # 이름 규칙은 RoomUpdateRequest 와 동일 (120자, 제어문자 금지). 미지정은 서버 기본 이름
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("채팅방 이름을 입력해 주세요")
        if len(v) > 120:
            raise ValueError("채팅방 이름은 120자 이하여야 합니다")
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in v):
            raise ValueError("채팅방 이름에 줄바꿈이나 제어문자를 사용할 수 없습니다")
        return v


class InvitableCounselorOut(BaseModel):
    """SDD-092: 초대 후보 상담사 정보"""
    user_id: str
    name: str
    role: str
    # 요청자와 공유하는 기관 이름만 (타 기관 소속 정보 비노출)
    org_names: list[str] = []


class InvitableCounselorsResponse(BaseModel):
    """SDD-092: 초대 후보 상담사 응답"""
    counselors: list[InvitableCounselorOut]
    total: int = 0
    page: int = 1


class MessageCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    type: MessageType = "text"
    file_url: str | None = None


class MessageResponse(BaseModel):
    id: str
    room_id: str
    sender_id: str | None
    sender_name: str | None = None
    type: str
    content: str | None
    file_url: str | None
    event_type: str | None
    created_at: datetime
    # ── Phase 3a: 읽음 상태 ──
    read_by: list[str] = []
    recipient_count: int = 0
    read_count: int = 0
    unread_count: int = 0


class UnreadCountsResponse(BaseModel):
    """각 메시지별 안읽은 수"""
    unread_counts: dict[str, int]  # {message_id: unread_count}


class MarkMessagesReadRequest(BaseModel):
    """읽음 처리할 메시지 ID 목록"""
    message_ids: list[str] = Field(..., min_length=1, max_length=500)


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    next_cursor: str | None = None


class LastMessagePreview(BaseModel):
    """SDD-090: 방 목록용 마지막 메시지 미리보기"""
    content: str | None = None
    created_at: datetime


class RoomResponse(BaseModel):
    id: str
    session_id: str | None = None
    room_type: str = "session"
    host_id: str | None = None
    name: str | None = None
    peer_name: str | None = None
    peer_id: str | None = None
    session_title: str | None = None
    session_scheduled_at: datetime | None = None
    participant_count: int = 0
    created_at: datetime
    unread_count: int = 0
    # ── SDD-090: 정렬·설정용 추가 필드 (기존 필드는 변경·삭제 없음) ──
    last_message: LastMessagePreview | None = None
    last_message_at: datetime | None = None
    custom_name: str | None = None
    display_name: str | None = None
    can_rename: bool = False
    rename_disabled_reason: str | None = None


class RoomListResponse(BaseModel):
    rooms: list[RoomResponse]
