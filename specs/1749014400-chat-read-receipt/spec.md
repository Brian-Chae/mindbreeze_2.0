# 읽음/안읽음 메시지 구분 기능 기획서

> LOO-266: [채팅] 읽은 메시지와 안읽은 메시지 구분 하기
> 
> Phase 1 기획서 — Brian 리뷰용

---

## 1. 문제 정의

현재 Mind Breeze 2.0 채팅에서는 상담사/내담자가 메시지를 보낸 후, 상대방이 그 메시지를 읽었는지 확인할 수 있는 방법이 없다. 심리상담 특성상 내담자의 참여도·반응 확인이 중요하며, 카카오톡처럼 대화 버블 옆에 작은 숫자로 안 읽은 사람 수를 표시하는 기능이 필요하다.

### 현재 상태 (As-Is)

| 항목 | 상태 |
|------|------|
| 메시지 읽음 DB 추적 | ✅ `ChatMessageRead` 테이블 존재 (message_id, user_id, read_at) |
| 방 단위 읽음 처리 | ✅ `PUT /chat/rooms/{id}/read` API — 채팅방 입장 시 전체 읽음 |
| 안읽음 카운트(방) | ✅ `_unread_count()` — 채팅방 리스트에서 방별 unread 표시 |
| 메시지별 읽음 표시 | ❌ 없음 — 각 메시지에 몇 명이 읽었는지 표시 불가 |
| 실시간 읽음 업데이트 | ❌ 없음 — 상대방이 읽어도 발신자에게 즉시 반영 안 됨 |
| 그룹방 읽음 추적 | ❌ 참여자별 읽음 상태 API 없음 |

### 목표 (To-Be)

- **1:1 직접방**: 상대방이 메시지를 읽으면 "읽음" 표시, 안 읽었으면 "1" 표시
- **그룹방**: 내 메시지 옆에 "안 읽은 인원 수" 표시 (예: "3")
- **실시간 업데이트**: 상대방이 채팅방에 입장하면 발신자의 메시지 읽음 표시가 즉시 갱신됨
- **카카오톡 스타일**: 메시지 버블 오른쪽 아래에 작은 초록색 숫자로 표시

---

## 2. MVP 범위

### Phase 2 (이번 구현 — LOO-266)

✅ **백엔드**
- `_serialize_msg()`에 `read_count`, `unread_count` 필드 추가
- `GET /chat/rooms/{id}/messages` 응답에 읽음 정보 포함
- `mark_read()` 호출 시 `broadcast_read_status()` WebSocket 이벤트 발생
- `broadcast_read_status()` — 채팅방 전체에 읽음 상태 변경 알림

✅ **프론트엔드 (상담사)**
- `MessageBubble.tsx`: 내 메시지 버블 오른쪽 아래에 안 읽은 인원 수 표시
- `ChatRoom.tsx`: 채팅방 입장 시 `markRoomRead` 호출 + 읽음 이벤트 수신 처리
- `chatStore.ts`: `updateMessageReadCount()` 액션 추가
- WebSocket: `read_status` 이벤트 리스너 추가

✅ **프론트엔드 (내담자)**
- `ClientChatPage.tsx`: 상담사와 동일한 읽음 표시 적용
- `MessageBubble` 재사용 (공통 컴포넌트이므로 자동 적용)

### Phase 3 (후속 — LOO-267 예정)

🔲 **고도화**
- 읽은 사람 목록 모달 (그룹방에서 누가 읽었는지 상세 보기)
- 프로필 아바타로 읽은 사람 표시 (카카오톡 단체방 스타일)
- 읽음 확인 시간 표시 ("5분 전 읽음")

---

## 3. 기술 설계

### 3.1 데이터 모델 (기존 유지)

```sql
-- chat_message_reads (기존 테이블)
CREATE TABLE chat_message_reads (
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    read_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
```

**변경 없음** — 기존 테이블 그대로 사용.

### 3.2 API 변경

#### `GET /chat/rooms/{room_id}/messages` 응답 확장

```json
// 현재
{
  "messages": [
    {
      "id": "uuid",
      "sender_id": "uuid",
      "content": "안녕하세요",
      "created_at": "2026-06-04T...",
      ...
    }
  ]
}

// 변경 후 — read_count, unread_count 추가
{
  "messages": [
    {
      "id": "uuid",
      "sender_id": "uuid",
      "content": "안녕하세요",
      "created_at": "2026-06-04T...",
      "read_count": 1,      // ← 읽은 사람 수 (본인 포함)
      "unread_count": 1,    // ← 안 읽은 사람 수
      ...
    }
  ]
}
```

**계산 방식:**
- `read_count = SELECT COUNT(*) FROM chat_message_reads WHERE message_id = ?`
- `unread_count = total_participants - read_count`
- direct 방: `total_participants = 2`
- group 방: `total_participants = 1(host) + COUNT(chat_room_participants)`

#### `MessageResponse` 스키마 확장

```python
class MessageResponse(BaseModel):
    # ... 기존 필드 ...
    read_count: int = 0       # NEW
    unread_count: int = 0     # NEW
```

### 3.3 `_serialize_msg()` 변경

```python
def _serialize_msg(m: ChatMessage, db=None, user_id=None) -> dict:
    result = {
        # ... 기존 필드 ...
    }
    if db and user_id:
        # 읽음 통계 계산
        total_read = db.query(ChatMessageRead).filter(
            ChatMessageRead.message_id == m.id
        ).count()
        total_participants = _participant_count(room, db)
        result["read_count"] = total_read
        result["unread_count"] = max(total_participants - total_read, 0)
    return result
```

### 3.4 WebSocket 이벤트

#### `read_status` 이벤트 (NEW)

```python
# chat_namespace.py
async def broadcast_read_status(room_id: str, user_id: str, message_id: str, 
                                 read_count: int, unread_count: int) -> None:
    """채팅방 전체에 읽음 상태 변경 브로드캐스트"""
    payload = {
        "type": "read_status",
        "user_id": user_id,
        "room_id": str(room_id),
        "message_id": str(message_id),
        "read_count": read_count,
        "unread_count": unread_count,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await sio.emit("read_status", payload, room=str(room_id), namespace="/chat")
```

#### `mark_read()` 변경

```python
def mark_read(room_id, user_id, db):
    # 기존 로직 유지 (ChatMessageRead 생성)
    # ...
    
    # ← NEW: 읽음 상태 브로드캐스트
    # 각 메시지별로 업데이트된 read_count 전송
    from app.ws.chat_namespace import broadcast_read_status
    for m in msgs:
        if m.id not in existing:
            new_read = db.query(ChatMessageRead).filter(
                ChatMessageRead.message_id == m.id
            ).count()
            total = _participant_count(room, db)
            await broadcast_read_status(
                str(rid), user_id, str(m.id), 
                new_read, max(total - new_read, 0)
            )
```

### 3.5 프론트엔드 설계

#### MessageBubble.tsx 변경

```tsx
interface Props {
  message: ChatMessage;  // ← read_count, unread_count 필드 추가
  isMine: boolean;
  // ...
}

// 내 메시지의 경우, 버블 오른쪽 아래에 안 읽은 인원 표시
{isMine && message.unread_count > 0 && (
  <span className="text-[11px] text-[#8BC34A] font-medium ml-1">
    {message.unread_count}
  </span>
)}
```

디자인:
- direct 방 (1:1): "1" → 상대방이 아직 안 읽음. `unread_count === 0`이면 표시 안 함 (읽음 상태)
- group 방: "N" → N명이 아직 안 읽음
- 색상: `#8BC34A` (초록색, 카카오톡 스타일)
- 위치: 메시지 버블 우측 하단, 시간 표시 아래

#### chatStore.ts 변경

```typescript
// updateMessageReadCount 액션 추가
updateMessageReadCount: (roomId: string, messageId: string, 
                          readCount: number, unreadCount: number) =>
  set((state) => {
    const msgs = state.messagesByRoom[roomId];
    if (!msgs) return state;
    return {
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: msgs.map((m) =>
          m.id === messageId ? { ...m, read_count: readCount, unread_count: unreadCount } : m
        ),
      },
    };
  }),
```

#### ChatRoom.tsx 변경

```tsx
// WebSocket read_status 이벤트 리스너
socket.on('read_status', handleReadStatus);

const handleReadStatus = (payload: ReadStatusPayload) => {
  updateMessageReadCount(
    payload.room_id, 
    payload.message_id,
    payload.read_count, 
    payload.unread_count
  );
};
```

---

## 4. 구현 계획

### Worker 배정

| Worker | 담당 | CLI | 우선순위 |
|--------|------|-----|---------|
| Worker #1 (Claude Code) | 백엔드: `_serialize_msg()` 확장, schema 변경, API 응답에 read_count 추가 | `claude` | 1 |
| Worker #2 (Claude Code) | 백엔드: `broadcast_read_status()`, `mark_read()` WS 연동 | `claude` | 1 (병렬) |
| Worker #3 (Claude Code) | 프론트엔드: `MessageBubble`, `chatStore`, `ChatRoom` 변경 | `claude` | 2 (백엔드 완료 후) |

### 작업 순서

```
Step 1: 백엔드
  ├─ Worker #1: _serialize_msg() + MessageResponse schema + list_messages() 변경
  └─ Worker #2: broadcast_read_status() + mark_read() 변경

Step 2: 검증 (백엔드)
  ├─ curl로 API 테스트 → read_count, unread_count 확인
  └─ WebSocket read_status 이벤트 수신 확인

Step 3: 프론트엔드
  └─ Worker #3: MessageBubble + chatStore + ChatRoom 변경

Step 4: 통합 검증
  ├─ npm run build
  ├─ EC2 배포 (GitHub Actions)
  └─ dev 환경에서 실제 채팅 테스트
```

### 작업량 추정

| 작업 | 예상 턴 | 예상 시간 |
|------|---------|----------|
| Worker #1 (schema + API) | 15턴 | 2분 |
| Worker #2 (WS broadcast) | 15턴 | 2분 |
| Worker #3 (프론트엔드) | 25턴 | 3분 |
| 통합 검증 + 배포 | - | 3분 |
| **총 예상** | | **10분** |

---

## 5. 검증 체크리스트

- [ ] `GET /chat/rooms/{id}/messages` 응답에 `read_count`, `unread_count` 포함
- [ ] direct 방에서 상대방이 안 읽었을 때 "1" 표시
- [ ] direct 방에서 상대방이 읽었을 때 숫자 사라짐
- [ ] group 방에서 N명 안 읽었을 때 "N" 표시
- [ ] 채팅방 입장 시 `mark_read` → 상대방 화면에서 읽음 표시 실시간 갱신
- [ ] `npm run build` 통과
- [ ] TS 타입 오류 없음
- [ ] WebSocket `read_status` 이벤트 정상 emit/수신
- [ ] `read_count`가 0보다 작지 않음 (음수 방지)
- [ ] 본인 메시지는 항상 `read_count >= 1` (발신 시 자동 읽음)

---

## 6. 함정 / 주의사항

### 6.1 성능 주의
- **N+1 쿼리 방지**: `list_messages()`에서 각 메시지마다 `ChatMessageRead`를 쿼리하면 그룹방에서 수백 건의 서브쿼리 발생.
- **해결**: 한 번의 JOIN 또는 서브쿼리로 배치 처리
```python
# 배치 쿼리 패턴
read_counts = dict(
    db.query(
        ChatMessageRead.message_id, 
        func.count(ChatMessageRead.user_id).label('cnt')
    )
    .filter(ChatMessageRead.message_id.in_(msg_ids))
    .group_by(ChatMessageRead.message_id)
    .all()
)
```

### 6.2 `_serialize_msg()` 순환 참조
- `_serialize_msg`는 `ChatMessage`만 받음 → `room` 정보에 접근하려면 `m.room` relationship 필요
- `_serialize_msg(m, db, room=None)` 형태로 room을 외부에서 전달하거나 `m.room` 사용

### 6.3 본인 메시지의 read_count
- 발신 시 `post_message()`가 `ChatMessageRead(message_id, sender_id)`를 자동 생성 → 발신자 자신은 항상 읽음
- `unread_count` 계산 시 발신자를 제외해야 함 → `total_participants - 1` 기준

### 6.4 direct 방 vs group 방
- direct 방: 2명 → 상대방이 읽으면 `unread_count=0` → 표시 안 함
- group 방: N명 → `unread_count=N-1-read_count` → 항상 표시

### 6.5 WebSocket 비동기
- `broadcast_read_status()`는 `async` → `mark_read()`도 `async def`로 변경 필요
- 기존 `mark_read` 호출부(`chat.py` 라우터)도 `async def`로 변경

---

## 7. 파일 변경 목록

### 백엔드

| 파일 | 변경 내용 | 신규/수정 |
|------|----------|----------|
| `backend/app/schemas/chat.py` | `MessageResponse`에 `read_count`, `unread_count` 추가 | 수정 |
| `backend/app/services/chat_service.py` | `_serialize_msg()` 확장, `mark_read()` async화 + WS broadcast 추가 | 수정 |
| `backend/app/ws/chat_namespace.py` | `broadcast_read_status()` 함수 추가 | 수정 |
| `backend/app/api/v1/chat.py` | `mark_read()` endpoint async화 | 수정 |
| `backend/alembic/versions/` | (마이그레이션 불필요 — 기존 테이블 사용) | - |

### 프론트엔드

| 파일 | 변경 내용 | 신규/수정 |
|------|----------|----------|
| `frontend/src/lib/api/chat.ts` | 타입에 `read_count`, `unread_count` 추가 | 수정 |
| `frontend/src/stores/chatStore.ts` | `updateMessageReadCount()` 액션 추가 | 수정 |
| `frontend/src/components/chat/ChatRoom.tsx` | `read_status` WS 이벤트 리스너 추가 | 수정 |
| `frontend/src/components/chat/MessageBubble.tsx` | 안 읽은 인원 수 표시 UI 추가 | 수정 |
| `frontend/src/pages/chat/ChatPage.tsx` | (변경 없음 — 재사용) | - |
| `frontend/src/pages/client/ClientChatPage.tsx` | (변경 없음 — 재사용) | - |
