# 채팅 읽음/안읽음 상태 표시 — 서비스 기획

> **Pipeline Phase**: Phase 1 (서비스 기획)
> **연관 Linear**: [LOO-266](https://linear.app/looxidlabs/issue/LOO-266)
> **작성일**: 2026-06-04
> **상태**: ✅ Brian 승인 대기 중

---

## 1. 배경 & 문제 정의

### 현재 상황

MIND BREEZE 2.0 채팅 시스템은 상담사-내담자 간 1:1 실시간 메시지 기능을 제공 중이다. 현재까지 구현된 채팅 관련 기능:

- ✅ `ChatRoom` / `ChatMessage` 모델 (PostgreSQL)
- ✅ Socket.IO 기반 실시간 메시지 송수신
- ✅ `new_message` 이벤트 → 채팅방 전달
- ✅ 알림 시스템 (`notify_event` → `new_notification` → 인앱 알림 + 이메일)
- ✅ 사이드바 채팅 unread 뱃지 (방별 `unread_count`)
- ✅ `markRoomRead` API — 방 입장 시 해당 방 알림 읽음 처리

### 문제

**상담사가 메시지를 보낸 후, 내담자가 읽었는지 확인할 방법이 없다.** 

- 상담사는 "내담자가 이 메시지를 봤는가?"를 알 수 없음
- 내담자는 "상담사가 내 메시지를 확인했는가?"를 알 수 없음
- 여러 메시지 중 어디까지 읽었는지 구분 불가

### 목표

**카카오톡 스타일의 읽음/안읽음 피드백을 채팅 시스템에 도입한다.**

- 각 메시지 버블 옆에 **안읽은 사람 수**를 작게 표시 (예: `1`)
- 상대방이 채팅방에 입장하거나 메시지를 읽으면 실시간으로 `1` → 사라짐
- 그룹 채팅(MVP3) 대비하여 설계는 확장 가능하게

---

## 2. 타겟 사용자

| 사용자 | 니즈 |
|---|---|
| **상담사** | 내담자가 내 메시지를 읽었는지 확인 → 후속 조치 타이밍 결정 |
| **내담자** | 상담사가 내 메시지를 확인했는지 확인 → 답변 기대감 관리 |

---

## 3. 핵심 가치 제안

1. **신뢰감**: 메시지 수신 확인으로 양측의 소통 신뢰도 향상
2. **운영 효율**: 상담사가 내담자의 메시지 확인 상태를 기반으로 후속 액션 결정
3. **UX 완성도**: 카카오톡 수준의 친숙한 인터랙션 → 사용자 이탈 방지

---

## 4. MVP 범위 (개발 우선순위 기준)

### ✅ MVP 포함

| 항목 | 설명 |
|---|---|
| **메시지별 읽음 상태 추적** | `ChatMessage`에 `read_by` (읽은 사용자 ID 목록) 저장 |
| **안읽은 사람 수 배지** | 내 메시지 버블 아래 "1" 배지 (카카오톡 스타일) |
| **실시간 읽음 갱신** | 채팅방 입장/스크롤 시 `markMessagesRead` API 호출 → Socket.IO broadcast |
| **방 입장 시 자동 읽음 처리** | 현재 보고 있는 채팅방의 모든 메시지 읽음 처리 |
| **스크롤 시 읽음 처리** | 스크롤하여 이전 메시지가 화면에 노출되면 읽음 처리 |

### ❌ MVP 제외 (Phase 2)

| 항목 | 사유 |
|---|---|
| **그룹 채팅 "N명이 읽음"** | 그룹 채팅(MVP3) 기능 자체가 미구현 |
| **메시지별 상세 읽음 목록** | "누가 읽었는지" 팝업 — MVP는 숫자만 표시 |
| **읽음 시간 표시** | "오후 3:42에 읽음" — MVP 범위 초과 |

---

## 5. 기술 설계

### 5.1 데이터 모델

#### ChatMessage (확장)

```python
# backend/app/models/chat.py

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id: UUID (PK)
    room_id: UUID (FK → chat_rooms.id)
    sender_id: UUID (FK → users.id)
    content: str
    created_at: datetime (UTC)
    
    # ✅ 신규: 읽은 사용자 ID 배열
    read_by: list[str]  # e.g. ["uuid1", "uuid2"]
    
    # ✅ 신규: 전체 수신자 수 (중복 계산 방지용 캐시)
    recipient_count: int = 0
```

#### 설계 근거

- `read_by`: PostgreSQL `ARRAY` 타입 또는 JSONB 사용. 읽은 사용자 ID를 append.
- `recipient_count`: 메시지 전송 시점에 계산하여 저장 (채팅방 참여자 수 - 발신자)
- **안읽은 수 = `recipient_count - len(read_by)`**

#### 대안 검토

| 방식 | 장점 | 단점 | 선택 |
|---|---|---|---|
| **`read_by` 배열** | 단순, 쿼리 효율적 | 대규모 그룹에서 배열 커짐 | ✅ MVP 선택 |
| 별도 `message_reads` 테이블 | 정규화, 확장성 | JOIN 필요, 쿼리 복잡 | Phase 2 고려 |

### 5.2 API 설계

#### POST /chat/rooms/{room_id}/messages/{message_id}/read

```python
@router.post("/chat/rooms/{room_id}/messages/read")
async def mark_messages_read(
    room_id: str,
    message_ids: list[str],  # 읽음 처리할 메시지 ID 목록
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    여러 메시지를 한 번에 읽음 처리.
    프론트에서 IntersectionObserver로 화면에 노출된 메시지를 배치 전송.
    """
    # 1. 메시지들의 read_by에 current_user.id 추가 (중복 방지)
    # 2. Socket.IO로 room에 broadcast (unread_count 업데이트)
    # 3. 응답
```

#### GET /chat/rooms/{room_id}/unread-counts

```python
@router.get("/chat/rooms/{room_id}/unread-counts")
async def get_unread_counts(
    room_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    채팅방의 각 메시지별 안읽은 수 반환.
    {message_id: unread_count} 형태.
    """
```

### 5.3 실시간 업데이트 (Socket.IO)

```
사용자 A가 채팅방 입장
  → POST /chat/rooms/{room_id}/messages/read (방 전체 메시지)
  → 백엔드: read_by 업데이트
  → Socket.IO emit → "messages_read" 이벤트
  → 사용자 B의 프론트엔드: 해당 메시지 unread 배지 갱신

사용자 A가 스크롤
  → IntersectionObserver → 화면에 노출된 메시지 ID 수집
  → POST /chat/rooms/{room_id}/messages/read (배치)
  → 동일한 emit 플로우
```

### 5.4 프론트엔드 구현

#### MessageBubble 확장

```tsx
// MessageBubble.tsx
interface Props {
  message: ChatMessage;  // 확장: read_by?: string[], recipient_count?: number
  isMine: boolean;
  senderName?: string;
  showSender?: boolean;
  // ✅ 신규
  unreadCount?: number;  // recipient_count - read_by.length
}
```

#### 읽음 배지 UI

```
┌─────────────────────────────────┐
│  [내 메시지 버블]                │
│  안녕하세요! 오늘 상담 가능하신가요? │
└─────────────────────────────────┘
                        1  ← 12px, #F9DF4A (카카오톡 노란색) 또는 #5F0080 (브랜드 퍼플)
```

#### IntersectionObserver 패턴

```tsx
// ChatRoom.tsx
useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleIds = entries
        .filter(e => e.isIntersecting)
        .map(e => e.target.getAttribute('data-message-id'))
        .filter(Boolean);
      
      if (visibleIds.length > 0) {
        markMessagesRead(roomId, visibleIds);
      }
    },
    { threshold: 0.5 }  // 메시지의 50%가 보이면 읽음 처리
  );
  
  // 각 메시지 엘리먼트에 observer 등록
  messageRefs.current.forEach(ref => observer.observe(ref));
  
  return () => observer.disconnect();
}, [messages]);
```

---

## 6. 단계별 구현 계획

### Phase 3a: DB 마이그레이션 + 백엔드 API

| 작업 | 상세 | 예상 소요 |
|---|---|---|
| DB 마이그레이션 | `chat_messages` 테이블에 `read_by`, `recipient_count` 컬럼 추가 | 1h |
| `mark_messages_read` API | POST /chat/rooms/{room_id}/messages/read 구현 | 2h |
| `get_unread_counts` API | GET /chat/rooms/{room_id}/unread-counts 구현 | 1h |
| Socket.IO `messages_read` 이벤트 | broadcast 로직 구현 | 1h |
| 백엔드 테스트 | pytest로 API + Socket.IO 테스트 | 2h |

### Phase 3b: 프론트엔드 UI

| 작업 | 상세 | 예상 소요 |
|---|---|---|
| `ChatMessage` 타입 확장 | `read_by`, `recipient_count` 필드 추가 | 30m |
| `MessageBubble` 읽음 배지 | 내 메시지에만 unread count 배지 표시 | 1h |
| `IntersectionObserver` | 스크롤 시 읽음 처리 | 1h |
| 채팅방 입장 시 읽음 처리 | `ChatRoom` mount 시 `markMessagesRead` 호출 | 30m |
| Socket.IO `messages_read` 수신 | 프론트에서 unread 배지 실시간 갱신 | 1h |
| 프론트엔드 빌드 검증 | `npm run build` 통과 | 30m |

### 전체 예상 소요: 10h (1.5 MD)

---

## 7. 성공 지표

| 지표 | 측정 방법 |
|---|---|
| **읽음 확인 정확도** | 메시지 발송 후 상대방 읽음 시 배지 즉시 사라짐 (지연 <2초) |
| **실시간 동기화** | Socket.IO `messages_read` 이벤트 수신 → UI 갱신까지 <500ms |
| **성능** | `mark_messages_read` API 응답 시간 <200ms (배치 50개 기준) |

---

## 8. 제약사항

| 제약 | 영향 |
|---|---|
| **PostgreSQL ARRAY 타입** | `read_by` 배열에 중복 append 방지 로직 필요 |
| **Socket.IO 연결 상태** | 연결 끊김 시 read 상태 불일치 가능 → 재연결 시 재조회 |
| **1:1 채팅 전용** | MVP는 direct room만 지원. `recipient_count` = 1 (1:1에서는 항상 1) |
| **대량 메시지** | 1000개+ 메시지의 `read_by` 업데이트 시 배치 처리 필요 |

---

## 9. 다음 Phase 연결

- **Phase 2 (디자인)**: `designs/chat-read-status/` — 읽음 배지 UI 목업, DESIGN.md 토큰, Claude Design 덱
- **Phase 3 (구현)**: `specs/<unix-ts>-chat-read-status/` — SDD → TDD → 코드 → 배포
- **Linear sub-issues**: LOO-266 하위에 Phase 3a, Phase 3b issue 생성

---

## 변경 이력

| 날짜 | 변경 내용 |
|---|---|
| 2026-06-04 | 최초 작성 |
