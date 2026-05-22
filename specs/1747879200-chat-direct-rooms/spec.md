# F13: 1:1 채팅방 + 그룹 채팅방

## 미션

채팅 시스템을 세션 의존성에서 분리하여:
1. 상담사가 내담자를 선택해 **1:1 채팅방을 수동 생성**할 수 있게 함
2. 기존 내담자와의 1:1 채팅방이 **기본값으로 유지**되도록 채팅방 목록에 포함
3. **그룹 세션 생성 시** 자동으로 그룹 채팅방도 생성

## 현재 구조

- `ChatRoom`은 `session_id` (unique, non-null)에 1:1 종속
- 채팅방은 세션 조회 시 `get_or_create_room_by_session()`으로 자동 생성
- 수동 생성 API 없음
- 접근 제어: 세션 host 또는 participant만 가능 (`_ensure_member`)

## 변경할 파일

### 백엔드

| 파일 | 변경 |
|---|---|
| `backend/app/models/chat.py` | ChatRoom에 `room_type`, `host_id` 추가; session_id nullable로 |
| `backend/app/schemas/chat.py` | RoomCreateRequest, RoomType enum 추가; RoomResponse 확장 |
| `backend/app/services/chat_service.py` | create_direct_room, list_my_rooms 확장, _ensure_member 확장, get_or_create_direct_room |
| `backend/app/api/v1/chat.py` | POST /chat/rooms (직접방 생성), GET /chat/rooms 확장 |
| `backend/app/services/session_service.py` | 세션 생성 시 그룹 채팅방 자동 생성 (참여자 2인 이상) |

### Alembic

| 파일 | 변경 |
|---|---|
| `backend/alembic/versions/` | 신규 마이그레이션: ChatRoom에 room_type, host_id 컬럼 추가, session_id nullable |

### 프론트엔드

| 파일 | 변경 |
|---|---|
| `frontend/src/lib/api/chat.ts` | createDirectRoom API 함수 추가 |
| `frontend/src/components/chat/CreateRoomModal.tsx` | **신규**: 내담자 선택 → 방 생성 모달 |
| `frontend/src/pages/chat/ChatPage.tsx` | 사이드바에 "새 채팅방" 버튼 + 모달 통합 |

## 핵심 변경 패턴

### ChatRoom 모델
```python
class ChatRoom(Base):
    # ... existing ...
    session_id: Mapped[uuid.UUID | None]  # nullable
    room_type: Mapped[str]  # 'direct' | 'session', default 'session'
    host_id: Mapped[uuid.UUID | None]  # 방 생성자 (상담사), direct only
    name: Mapped[str | None]  # 표시 이름 (optional)
```

### 접근 제어 (_ensure_member 확장)
- session room: 기존과 동일 (세션 host 또는 participant)
- direct room: room.host_id == user_id 이거나, client_counselor_links에 연결된 상대방

### 방 목록 (list_my_rooms 확장)
- session rooms: 기존 로직 유지
- direct rooms: ChatRoom.room_type == 'direct' AND (host_id == user_id OR client_counselor_links에 있음)

### POST /chat/rooms (신규)
```json
// Request
{"client_id": "uuid", "room_type": "direct"}

// Response: RoomResponse
```

### create_direct_room 서비스
1. counselor_id (=current_user) + client_id 조합으로 기존 direct room 검색
2. 없으면 ChatRoom(room_type='direct', host_id=counselor_id) 생성
3. 있으면 기존 room 반환 (중복 생성 방지)

### 세션 생성 → 그룹 채팅방 자동 생성
- session_service.create_session()에서 participant_ids 길이 >= 2 이면
- get_or_create_room_by_session(session.id) 호출

## 절대 금지

- 기존 세션 기반 채팅방 동작 변경 금지
- any 타입 사용 금지
- Store 직접 import 금지 (useAuthStore 예외)
- 기존 API 응답 스키마 변경 금지 (RoomResponse에 필드 추가만 가능)
- 함수 시그니처 변경 금지 (기존 함수)

## 검증

- 백엔드: `cd backend && pytest -q --tb=short`
- 프론트엔드: `cd frontend && npm run build`
- Alembic 마이그레이션: `alembic upgrade head`
