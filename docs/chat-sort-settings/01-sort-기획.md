# 채팅방 목록 정렬 기능 — 기획안

> 2026-09-25 · 작성: Claude (기획 워커) · 근거: `docs/chat-sort-settings/00-research-brief.md`
> **구현 금지 — 본 문서는 기획 문서임.** 모든 사실 서술은 `파일:라인` 근거 기반.

---

## 1. 배경

SDD-089로 채팅 기능이 기관 멤버십 기반으로 재적용되어 방 3종(direct/session/group)이 활성화됐다.
그러나 채팅방 목록은 **정렬이 전혀 없다**:

- `list_my_rooms()`는 세션 방(`sessions` dict 삽입 순서) → direct 방 → group 방 순으로 단순 append하여 반환한다 (`backend/app/services/chat_service.py:381-440`). `order_by`가 한 번도 등장하지 않는다.
- 방 목록 API는 서비스 반환 순서를 그대로 내보낸다 (`backend/app/api/v1/chat.py:23-29`).
- 프론트 두 페이지 모두 받은 배열 순서대로 렌더링한다 (`frontend/src/pages/chat/ChatPage.tsx:121-156`, `frontend/src/pages/client/ClientChatPage.tsx:164-210`).

결과적으로 **새 메시지가 온 방이 목록 어디에 있는지 예측할 수 없고**, 방이 늘어날수록(세션마다 방이 자동 생성됨 — `chat_service.py:392-394`) 원하는 대화를 찾기 어렵다.

### 핵심 선행 발견 (기획 전제)

1. **`last_message`는 프론트에 이미 선언·렌더링되어 있으나 백엔드가 반환하지 않는다.**
   - 프론트 타입: `ChatRoom.last_message?: { content, created_at } | null` (`frontend/src/lib/api/chat.ts:37-40`)
   - 내담자 목록은 이미 `last_message.created_at` 시각 표시(`ClientChatPage.tsx:189-193`)와 마지막 메시지 미리보기(`ClientChatPage.tsx:47-53, 195-197`)를 구현해 둔 상태 — 백엔드 미반환으로 **항상 fallback 문구만 표시되는 죽은 코드**다.
   - 백엔드 `_serialize_room()` 반환 dict(`chat_service.py:317-330`)과 `RoomResponse` 스키마(`backend/app/schemas/chat.py:57-69`)에는 `last_message`/`last_message_at`이 없다.
   → 백엔드에 `last_message`를 채우면 내담자 화면의 미리보기·시각 표시는 추가 작업 없이 살아난다.
2. **`GET /chat/rooms`는 페이지네이션이 없다** (`chat.py:23-29` — 쿼리 파라미터 없음). 전체 방 목록이 항상 한 번에 응답되므로, 정렬 토글은 **클라이언트 재정렬로 충분**하고 서버 재호출이 필요 없다.
3. 세션 방은 `session_title`·`session_scheduled_at`을 이미 반환한다 (`chat_service.py:309-316, 325-326`; `Session.scheduled_at`은 `backend/app/models/session.py:39`, nullable). → "최신 세션 순" 정렬의 키는 이미 존재한다.

---

## 2. 요구사항

### 기능 요구사항

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-1 | 방 목록의 각 방에 마지막 메시지 정보(`last_message`: content·created_at, `last_message_at`)를 응답에 포함한다 | 필수 |
| FR-2 | 서버는 기본적으로 **최신 대화 순**(마지막 메시지 시각 내림차순)으로 정렬해 반환한다 | 필수 |
| FR-3 | 프론트에 정렬 토글 UI를 제공한다: **최신 대화 순 / 최신 세션 순** 2모드 | 필수 |
| FR-4 | 정렬 토글은 상담사(`ChatPage.tsx`)·내담자(`ClientChatPage.tsx`) 공통으로 동작한다 | 필수 |
| FR-5 | (선택) **안읽은 우선** 옵션: 켜면 `unread_count > 0`인 방을 상단 그룹으로 올리고, 그룹 내부는 선택된 정렬 기준을 따른다 | 선택 |
| FR-6 | 선택한 정렬 모드는 브라우저에 저장되어 재방문 시 유지된다 (localStorage) | 필수 |
| FR-7 | 새 메시지 수신(WebSocket) 시 해당 방의 `last_message`가 갱신되고 목록이 즉시 재정렬된다 | 필수 |

### 비기능 요구사항

- 정렬 추가로 `GET /chat/rooms` 응답 시간이 유의미하게 늘지 않아야 한다. 현재 `list_my_rooms()`는 방마다 `_serialize_room()` 내부에서 세션·유저·unread 쿼리를 반복하는 N+1 구조(`chat_service.py:305-330, 348-357`)이므로, 마지막 메시지 조회는 **방 전체에 대해 단일 집계 쿼리**로 처리한다 (아래 §4.3).
- 기존 응답 필드는 변경·삭제하지 않는다 (하위 호환). `last_message`·`last_message_at`은 **추가 필드**다.
- UI는 보라 `#5F0080` 테마와 기존 목록 스타일(활성 `bg-[#F5EDFC]`, 구분선 `#EFEFEF` 등 — `ChatPage.tsx:96-156`)을 유지한다.

---

## 3. UX 설계 (화면·플로우)

### 3.1 정렬 기준 정의

| 모드 | 1차 키 | 2차 키(동률·null 처리) |
|------|--------|----------------------|
| **최신 대화 순** (기본) | `last_message_at` 내림차순 | 메시지가 없는 방은 `last_message_at = null` → `created_at`(`chat_service.py:328`)으로 대체하여 같은 축에서 비교 |
| **최신 세션 순** | 세션 방: `session_scheduled_at` 내림차순 | ① `session_scheduled_at`이 null인 세션 방(nullable — `session.py:39`)은 세션 방 그룹의 맨 뒤 ② direct/group 방은 `session_scheduled_at`이 없으므로(`chat_service.py:310-316`에서 세션 방만 세팅) **세션 방 그룹 아래에 최신 대화 순으로** 배치 |
| **안읽은 우선** (선택 토글) | `unread_count > 0` 그룹을 상단 고정 | 그룹 내부는 위 두 모드 중 선택된 기준 적용. `unread_count`는 이미 방 단위로 반환 중 (`chat_service.py:329, 348-357`) |

> "최신 세션 순"에서 direct/group 방을 하단 배치하는 이유: 이 모드의 사용 목적은 "다가오는/최근 세션의 방을 빨리 찾기"이며, 세션 없는 방을 세션 방 사이에 끼워 넣을 기준 값이 존재하지 않기 때문(추측이 아닌 데이터 부재 — 위 근거).

### 3.2 정렬 토글 UI

- **형태**: 세그먼트 컨트롤 2버튼(`대화순` / `세션순`) + 선택 시 우측에 `안읽음 우선` 체크 토글(선택 구현).
- **위치**:
  - 상담사(`ChatPage.tsx`): 좌측 목록 헤더의 "+ 새 채팅방" 버튼 영역(`ChatPage.tsx:100-109`) **바로 아래**에 정렬 바 1행 추가.
  - 내담자(`ClientChatPage.tsx`): 목록 `<aside>`(`ClientChatPage.tsx:142-146`)에는 현재 헤더 행이 없으므로, 목록 최상단에 동일한 정렬 바 1행을 신설.
  - 두 페이지가 동일한 컴포넌트를 쓰도록 **공통 컴포넌트** `frontend/src/components/chat/ChatSortToggle.tsx`(신규)로 작성 — FR-4 충족.
- **스타일**: 선택된 세그먼트 `bg-[#5F0080] text-white`, 비선택 `bg-[#F8F8FB] text-[#6F6F6F]` — 기존 목록 팔레트(`ChatPage.tsx:105, 129`) 준수.

```
┌─ 좌측 목록 (md:w-80) ──────────────┐
│ [ + 새 채팅방 ]        ← 상담사만    │
│ ┌──────────┬──────────┐ ☐ 안읽음   │
│ │ ● 대화순  │  세션순   │    우선    │
│ └──────────┴──────────┘            │
│ ─────────────────────────────────  │
│ (1:1) 김내담     어제 상담 감사…  14:02 │
│ (#)  9월 세션    다음 주 일정은…  ③   │
│ ...                                │
└────────────────────────────────────┘
```

### 3.3 목록 행 표시 변경

- **내담자**: 변경 없음 — `last_message` 미리보기·시각 표시 코드가 이미 있음(`ClientChatPage.tsx:47-53, 189-197`). 백엔드가 값을 채우면 자동 동작.
- **상담사**: 현재 행 우측에 `created_at`(방 생성일)을 표시 중(`ChatPage.tsx:139-141`)인데, 정렬 기준이 "최신 대화"가 되면 생성일 표시는 오해를 유발한다. → **`last_message_at`(있으면) / `created_at`(없으면) 표시로 교체**하고, 부제(`roomSub`, `ChatPage.tsx:35-39`)를 내담자와 동일하게 `last_message.content` 미리보기 우선으로 변경.

### 3.4 플로우

1. 페이지 진입 → localStorage에서 정렬 모드 복원(기본 `recent_message`) → `listChatRooms()`(`frontend/src/lib/api/chat.ts:71-72`) 호출.
2. 응답 `rooms`를 store에 저장(`frontend/src/stores/chatStore.ts:27`) → 렌더 시 `useMemo`로 정렬된 사본 생성(원본 배열 불변 유지 — 코딩 컨벤션의 불변성 규칙).
3. 토글 클릭 → 정렬 모드 state + localStorage 갱신 → `useMemo` 재계산으로 즉시 재정렬. **서버 재호출 없음** (§1 핵심 발견 2).
4. WebSocket으로 새 메시지 수신 → 기존 `incrementUnread`(`chatStore.ts:45-50`)와 함께 신규 액션 `updateRoomLastMessage(roomId, content, created_at)`로 해당 방의 `last_message`/`last_message_at` 갱신 → 정렬 `useMemo`가 재계산되어 방이 상단으로 이동.

---

## 4. 백엔드 설계

### 4.1 API 변경 — `GET /api/v1/chat/rooms`

| 항목 | 내용 |
|------|------|
| 엔드포인트 | 기존 유지: `GET /chat/rooms` (`chat.py:23-29`) |
| 신규 쿼리 파라미터 | `sort: Literal["recent_message", "recent_session"] = "recent_message"` (선택 구현 — 아래 결정 참고) |
| 응답 추가 필드 | `last_message: { content: str \| null, created_at: datetime } \| null`, `last_message_at: datetime \| null` |

**서버 정렬 vs 정렬 파라미터 — 결정: "서버 기본 정렬 + 클라이언트 토글" (파라미터는 예비)**

- 근거: `GET /chat/rooms`는 페이지네이션이 없어 전체 목록이 항상 응답된다(`chat.py:23-29`). 토글마다 서버를 재호출할 이유가 없고, 클라이언트 정렬이 즉각적이다.
- 다만 서버는 **기본 정렬(최신 대화 순, `last_message_at` null이면 `created_at`)을 항상 적용**해 반환한다 — 정렬 미대응 클라이언트(예: 향후 모바일 앱)도 기본적으로 올바른 순서를 받도록.
- `sort` 파라미터는 스키마에 예약만 해 두고, 목록에 페이지네이션이 도입되는 시점(서버 정렬이 필수가 되는 시점)에 활성화한다.

### 4.2 스키마 변경

`backend/app/schemas/chat.py`:

```python
class LastMessagePreview(BaseModel):          # 신규
    content: str | None
    created_at: datetime

class RoomResponse(BaseModel):                # 기존(schemas/chat.py:57-69)에 추가
    ...
    last_message: LastMessagePreview | None = None
    last_message_at: datetime | None = None
```

- `last_message.content`: `type != "text"`인 메시지는 원문 대신 대체 문구를 서버에서 내려준다 — `image` → `"사진"`, `file` → `"파일"`, `system` → `content` 그대로(시스템 메시지는 이미 한국어 안내문). 메시지 type 정의: `schemas/chat.py:8`, `models/chat.py:40`.
- 프론트 타입(`chat.ts:37-40`)은 이미 이 형태와 일치 — `last_message_at`만 추가하면 됨.

### 4.3 서비스 로직 변경 — `chat_service.py`

**(a) 마지막 메시지 일괄 조회 (신규 헬퍼)**

`list_my_rooms()`가 방 목록을 다 모은 뒤(현재 `chat_service.py:391-439`에서 `result` 완성 후), 방 id 리스트에 대해 **단일 쿼리**로 방별 최신 메시지를 가져온다:

```python
def _last_messages_for_rooms(room_ids: list[UUID], db) -> dict[str, ChatMessage]:
    # PostgreSQL DISTINCT ON — 방별 최신 1건
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.room_id.in_(room_ids))
        .order_by(ChatMessage.room_id, ChatMessage.created_at.desc())
        .distinct(ChatMessage.room_id)
        .all()
    )
    return {str(r.room_id): r for r in rows}
```

- 방마다 개별 쿼리를 추가하지 않는 이유: `_serialize_room()`은 이미 방당 3~4 쿼리를 수행하는 N+1 구조(`chat_service.py:305-357`)라 여기에 방당 +1을 얹으면 악화된다. 목록 완성 후 일괄 병합이 유일한 신규 쿼리 비용이다.
- DB는 PostgreSQL 확정(`.claude/rules/architecture.md` — OLTP PostgreSQL)이므로 `DISTINCT ON` 사용 가능.

**(b) 정렬 적용**

`list_my_rooms()` 말미에서 병합 후 Python 정렬:

```python
result.sort(key=lambda r: r["last_message_at"] or r["created_at"], reverse=True)
```

- 방 목록 자체가 3개의 출처(세션/direct/group)를 Python에서 합치는 구조(`chat_service.py:381-440`)라 단일 SQL `ORDER BY`로 바꾸기 어렵다. 데이터가 전량 메모리에 있으므로 Python 정렬이 자연스럽다.

**(c) `_serialize_room()` 확장**

`chat_service.py:317-330`의 반환 dict에 `last_message`(dict | None), `last_message_at`(datetime | None) 키 추가. 호출부가 4곳(`list_my_rooms` 3곳 + `get_room`/`create_*`)이므로, 일괄 조회 결과를 파라미터로 주입받는 형태(`last_msg: ChatMessage | None = None`)로 하고, 단건 조회 경로(`get_room` — `chat_service.py:443-449`)에서는 해당 방 1건만 조회해 넘긴다.

### 4.4 데이터(DB) 변경 — 비정규화 컬럼은 도입하지 않음 (결정)

브리프의 옵션은 "`last_message_at` 필드 추가"였으나, 다음 근거로 **`ChatRoom` 테이블 컬럼 추가(비정규화) 대신 조회 시 집계**를 채택한다:

| 관점 | 컬럼 추가 (비정규화) | 조회 시 집계 (채택) |
|------|--------------------|-------------------|
| 마이그레이션 | Alembic 신규 revision + 기존 방 백필 필요 | 불필요 |
| 쓰기 경로 | `post_message()`(`chat_service.py:515-567`) 및 향후 모든 메시지 생성 경로에서 갱신 누락 리스크 | 없음 (단일 진실 원천 = `chat_messages.created_at`) |
| 미리보기 content | 컬럼만으로는 불가 — 어차피 최신 메시지 조회 필요 | 같은 쿼리로 함께 획득 |
| 읽기 비용 | ORDER BY 컬럼으로 저렴 | `DISTINCT ON` 1쿼리. 페이지네이션 없는 현 규모에서 충분 |

- 단, **인덱스는 추가한다**: `chat_messages (room_id, created_at DESC)` 복합 인덱스 — `DISTINCT ON` 쿼리와 기존 `list_messages()`의 `order_by(created_at.desc())`(`chat_service.py:458-464`) 모두 혜택. Alembic revision 1건 (인덱스만, 컬럼 없음). 네이밍은 기존 관례(`backend/alembic/versions/e036a0000013_sdd_088_opened_at.py` 등 `sdd_NNN_` 프리픽스) 준수.
- 목록 API에 페이지네이션이 도입되어 서버 ORDER BY가 필수가 되는 시점에 비정규화 컬럼을 재검토한다 (본 문서 §8 후속 과제).

### 4.5 WebSocket

- 변경 없음. 메시지 브로드캐스트는 기존 `broadcast_message`(`chat_service.py:560-566`)가 메시지 전문(`content`, `created_at` 포함 — `_serialize_msg`, `chat_service.py:101-115`)을 이미 전달하므로, 프론트가 이를 받아 방의 `last_message`를 갱신하면 된다 (§5.3).

---

## 5. 프론트 설계

### 5.1 타입·API 클라이언트 (`frontend/src/lib/api/chat.ts`)

- `ChatRoom` 인터페이스(`chat.ts:24-41`)에 `last_message_at: string | null` 추가. `last_message`는 이미 선언됨(`chat.ts:37-40`) — 유지.
- 신규 타입: `export type ChatSortMode = 'recent_message' | 'recent_session';`

### 5.2 정렬 로직 (공통 유틸, 신규 `frontend/src/lib/chat-sort.ts`)

```typescript
export function sortRooms(rooms: ChatRoom[], mode: ChatSortMode, unreadFirst: boolean): ChatRoom[] {
  const ts = (r: ChatRoom) => r.last_message_at ?? r.created_at;   // §3.1 null 처리
  const sorted = [...rooms].sort((a, b) => {                        // 원본 불변 (컨벤션)
    if (unreadFirst) {
      const ua = a.unread_count > 0 ? 0 : 1;
      const ub = b.unread_count > 0 ? 0 : 1;
      if (ua !== ub) return ua - ub;
    }
    if (mode === 'recent_session') {
      const sa = a.session_scheduled_at; const sb = b.session_scheduled_at;
      if (sa && sb) return sb.localeCompare(sa);   // 세션 방끼리: 세션 일자 내림차순
      if (sa && !sb) return -1;                     // 세션 방 그룹 상단
      if (!sa && sb) return 1;
      // 둘 다 비세션(or scheduled_at null) → 최신 대화 순으로 fallthrough
    }
    return ts(b).localeCompare(ts(a));
  });
  return sorted;
}
```

- ISO 8601 문자열은 `localeCompare`로 시간 비교 가능(서버가 timezone-aware ISO 반환 — `models/chat.py:44`의 `DateTime(timezone=True)`).
- 두 페이지 모두 `const sortedRooms = useMemo(() => sortRooms(rooms, mode, unreadFirst), [rooms, mode, unreadFirst]);`로 사용하고 기존 `rooms.map(...)`(`ChatPage.tsx:122`, `ClientChatPage.tsx:165`)을 `sortedRooms.map(...)`으로 교체.

### 5.3 스토어 (`frontend/src/stores/chatStore.ts`)

- 신규 액션 `updateRoomLastMessage(roomId, preview: { content, created_at })`:
  - `rooms`에서 해당 방의 `last_message`·`last_message_at`을 교체(맵 기반 불변 갱신 — 기존 `incrementUnread` 패턴, `chatStore.ts:45-50`과 동일).
  - 호출 지점: WebSocket 메시지 수신 핸들러(현재 `incrementUnread`를 호출하는 곳)에서 함께 호출.
- 정렬 상태(mode/unreadFirst)는 store가 아닌 **각 페이지 로컬 state + localStorage**(키: `mb.chat.sort`, `mb.chat.unreadFirst`)로 관리 — 서버 상태가 아니고 페이지 간 공유 필요성이 낮음. 단, 공통 훅 `useChatSortPreference()`(신규)로 묶어 두 페이지 중복 제거.

### 5.4 UI 컴포넌트 (신규 `frontend/src/components/chat/ChatSortToggle.tsx`)

- Props: `{ mode, unreadFirst, onModeChange, onUnreadFirstChange }`.
- §3.2 스타일. 상담사·내담자 페이지에서 동일하게 삽입(FR-4).
- 접근성: 세그먼트는 `role="radiogroup"`, 각 버튼 `aria-checked`.

### 5.5 상담사 목록 행 표시 수정 (`ChatPage.tsx`)

- 우측 시각: `room.created_at` 고정 표시(`ChatPage.tsx:139-141`) → `last_message_at ?? created_at` 기준으로 교체. 오늘이면 `HH:mm`, 그 외 `M.D` 축약(내담자 쪽 `formatTime`, `ClientChatPage.tsx:56-58` 참고하되 날짜 구분 로직 보강).
- 부제: `roomSub()`(`ChatPage.tsx:35-39`) 대신 내담자와 동일한 미리보기 우선 로직(`ClientChatPage.tsx:47-53`) 적용 — 해당 함수를 공통 유틸로 승격.

---

## 6. 권한

- **신규 권한 이슈 없음.** 정렬은 조회 기능이며, 방 목록 자체가 이미 SDD-089 멤버십 기반으로 필터링된다(`list_my_rooms()`가 본인 소속 방만 수집 — `chat_service.py:381-440`; direct 접근 검증 `_ensure_member()` + `_share_org()`, `chat_service.py:117-159, 26-45`).
- `last_message` 노출 범위 = 방 멤버 전원. 방 목록에 나오는 방은 모두 본인이 멤버인 방이므로 마지막 메시지 미리보기 노출은 기존 메시지 열람 권한(`list_messages()`의 `_ensure_member`, `chat_service.py:452-465`)을 벗어나지 않는다.
- 상담사·내담자 간 기능 차등 없음 — 정렬 토글은 양쪽 동일 제공(FR-4).

---

## 7. 엣지케이스

| # | 케이스 | 처리 |
|---|--------|------|
| 1 | 메시지가 0건인 방 (세션 방은 목록 조회 시 자동 생성됨 — `chat_service.py:392-394`) | `last_message = null`, `last_message_at = null`. 정렬은 `created_at` 대체(§3.1). 미리보기는 기존 fallback 부제 유지(`ClientChatPage.tsx:49-51`) |
| 2 | 마지막 메시지가 `image`/`file` | 서버가 content를 `"사진"`/`"파일"`로 대체(§4.2) — 프론트 40자 절단 로직(`ClientChatPage.tsx:52`) 그대로 동작 |
| 3 | 마지막 메시지가 `system`(event 메시지 — `models/chat.py:40, 43`) | content 그대로 미리보기. `last_message_at` 갱신에도 포함 — 시스템 이벤트도 "방의 최근 활동"이므로 정렬 반영 |
| 4 | `session_scheduled_at`이 null인 세션 방 (`session.py:39` nullable) | "세션순" 모드에서 비세션 방과 함께 최신 대화 순 fallback (§5.2 코드의 fallthrough) |
| 5 | `last_message_at` 동률 (같은 초에 생성) | `sort()`는 stable — 서버 기본 정렬 순서 유지. 별도 처리 불필요 |
| 6 | WebSocket 수신 방이 목록에 없는 방 (예: 다른 기기에서 새 direct 방 생성 직후) | `updateRoomLastMessage`는 해당 room 미존재 시 no-op. 방 목록 재조회 트리거는 본 기획 범위 외 (기존 동작 유지) |
| 7 | localStorage 접근 불가(사파리 프라이빗 등) | try/catch로 기본값 `recent_message` 사용, 저장 실패 무시 |
| 8 | 방 수백 개인 상담사 | `DISTINCT ON` 1쿼리 + Python 정렬 O(n log n) — 문제 없음. 근본 N+1(`_serialize_room`)은 기존 이슈로 본 기획 범위 외(§8) |

---

## 8. 범위 외 / 후속 과제

- `list_my_rooms()`의 방별 N+1 쿼리(`_serialize_room` 내부 세션/유저/unread 조회, `chat_service.py:305-357`) 일괄화 — 별도 [Refactor] 카드 권장.
- 방 목록 페이지네이션 + 그 시점의 서버 `sort` 파라미터 활성화 및 `last_message_at` 비정규화 컬럼 재검토(§4.4).
- 채팅방 설정(이름 변경 등)은 `02-settings-기획.md`(Codex 담당) 소관. 단 한 가지 접점 공유: direct 방의 `name` 필드는 표시명이 아니라 **client_id 저장소**로 사용 중(`chat_service.py:173, 179, 189`)이므로 rename 설계 시 이 필드를 덮어쓰면 방 식별이 깨진다 — 02 문서에서 반드시 고려할 것.

---

## 9. 구현 Task 목록 (대략, 구현 시 SDD 절차 준수)

### 백엔드
- [ ] T1. `schemas/chat.py`: `LastMessagePreview` 신설, `RoomResponse`에 `last_message`/`last_message_at` 추가
- [ ] T2. `chat_service.py`: `_last_messages_for_rooms()` 헬퍼 (DISTINCT ON 일괄 조회) + content 대체 규칙(image/file)
- [ ] T3. `chat_service.py`: `_serialize_room()`에 last_message 주입 파라미터 추가, `get_room`·`create_*` 경로 단건 처리
- [ ] T4. `list_my_rooms()`: 병합 후 `last_message_at ?? created_at` 내림차순 정렬
- [ ] T5. Alembic: `chat_messages (room_id, created_at DESC)` 인덱스 revision (수동 작성 — 자동 생성 금지 규칙)
- [ ] T6. pytest: 방 3종 × (메시지 유/무) 정렬 순서, 미리보기 대체 문구, 응답 하위 호환

### 프론트
- [ ] T7. `lib/api/chat.ts`: `last_message_at` 필드 + `ChatSortMode` 타입
- [ ] T8. `lib/chat-sort.ts`(신규): `sortRooms()` + vitest 단위 테스트 (§7 케이스 1·4·5 포함)
- [ ] T9. `components/chat/ChatSortToggle.tsx`(신규) + `useChatSortPreference()` 훅(localStorage)
- [ ] T10. `ChatPage.tsx`: 정렬 바 삽입, `sortedRooms` 적용, 행 우측 시각·부제를 last_message 기준으로 교체
- [ ] T11. `ClientChatPage.tsx`: 정렬 바 삽입, `sortedRooms` 적용 (미리보기는 기존 코드 재사용)
- [ ] T12. `chatStore.ts`: `updateRoomLastMessage` 액션 + WebSocket 수신 핸들러 연결

### QA 체크리스트 (수락 기준, ≥3)
- [ ] Q1. 메시지를 보낸 방이 두 페이지(상담사/내담자) 모두에서 목록 최상단으로 즉시 이동한다 (재조회 없이, WebSocket 경유 포함)
- [ ] Q2. "세션순" 선택 시 세션 방이 `scheduled_at` 내림차순으로 상단 정렬되고, direct/group 방은 그 아래 최신 대화 순으로 배치된다
- [ ] Q3. 메시지 0건 방·`scheduled_at` null 세션 방이 오류 없이 정렬되고, 새로고침 후에도 선택한 정렬 모드가 유지된다
- [ ] Q4. 기존 클라이언트(정렬 미대응)가 받는 `GET /chat/rooms` 응답이 스키마 오류 없이 동작한다 (필드 추가만, 제거 없음)
