# 채팅방 정렬·설정 기능 — 리서치 브리프 (기획용)

> 2026-09-25 · 기획 워커(Claude/Codex)가 읽는 공통 사실 기반. 추측 금지, 아래 근거(파일:라인) 기반으로 기획할 것.

## 1. 배경

Mind Breeze 2.0 채팅 기능을 SDD-089로 기관 멤버십 기반 재적용 완료. 방 3종(direct/session/group) 활성화 상태.
이번 기획 대상은 ① **채팅방 목록 정렬** ② **채팅방 설정(이름·정보 변경)** 2가지.

## 2. 현재 상태 (확정 사실 — 파일 근거)

### 백엔드
- `backend/app/services/chat_service.py`
  - `list_my_rooms()` (~349행): 세션 방(`sessions` dict 순서, **무정렬**) → direct → group 순으로 반환. **정렬 로직 없음**.
  - `_serialize_room()` (~300행): `id, session_id, room_type, host_id, name, peer_name, peer_id, session_title, session_scheduled_at, participant_count, created_at, unread_count` 반환. **`last_message`/`last_message_at` 미반환**.
  - `list_messages()` (~461행): `order_by(ChatMessage.created_at.desc())` — 메시지 단위는 최신순.
- `backend/app/api/v1/chat.py`: 방 목록/생성/조회 + 메시지 + 읽음 처리만 존재. **update/rename/PATCH/DELETE 엔드포인트 없음** (`PUT /rooms/{id}/read` 만 있음).
- `backend/app/models/chat.py`:
  - `ChatRoom`: `id, session_id(unique, nullable), room_type(direct/session/group), host_id(nullable), name(nullable), created_at`
  - `ChatMessage`: `id, room_id, sender_id, type(text/image/file/system), content, file_url, event_type, created_at, read_by(JSONB), recipient_count`
  - `ChatRoomParticipant`: `room_id, user_id, joined_at` (group 방 참여자)
  - `ChatMessageRead`: `message_id, user_id, read_at`
- `backend/app/models/session.py`: `Session`: `title(nullable), scheduled_at(nullable), type, status, host_id, ...`
- `backend/app/schemas/chat.py`: `RoomResponse` (session_title/session_scheduled_at 포함, **last_message 없음**)

### 프론트
- `frontend/src/pages/chat/ChatPage.tsx` (상담사): 목록 렌더링. 정렬 토글·설정 버튼 없음.
- `frontend/src/pages/client/ClientChatPage.tsx` (내담자): 동일 구조. 정렬 토글·설정 없음.
- `frontend/src/lib/api/chat.ts`: `ChatRoom` 인터페이스에 `last_message?: { content, created_at }` 선언돼 있으나 **백엔드 미반환**.
- `frontend/src/components/chat/CreateRoomModal.tsx`: 방 생성 모달 (이름 입력 존재).

## 3. 기획할 기능

### 기능 1 — 채팅방 목록 정렬
- 정렬 기준: **최신 대화 순**(마지막 메시지 시각) / **최신 세션 순**(세션 일자) / (선택) 안읽은 우선
- 백엔드: `last_message_at`(또는 `last_message`) 필드 추가 + 정렬 파라미터(쿼리) 또는 서버 정렬
- 프론트: 정렬 토글 UI (세그먼트/드롭다운), 상담사·내담자 공통

### 기능 2 — 채팅방 설정 (이름·정보 변경)
- 채팅방 이름 변경(rename), (선택) 참여자 관리 등
- 백엔드: `PATCH /chat/rooms/{id}` 엔드포인트 신설
- 프론트: 목록에서 설정 진입(⋯ 메뉴/롱프레스) → 모달
- 권한: direct 방은 누가? group 방은 host만? 내담자는 자기 방 이름 변경 가능한지? — 정의 필요

## 4. 제약
- 권한은 기관 멤버십 기반(SDD-089) 유지. 설정 변경 권한 주체를 명확히 정의할 것.
- UI는 보라 `#5F0080` 테마 + 기존 스타일 유지.
- 응답·문서는 한국어.
- **구현 금지 — 기획 문서만 작성.**

## 5. 산출물
- Claude → `docs/chat-sort-settings/01-sort-기획.md` (정렬)
- Codex → `docs/chat-sort-settings/02-settings-기획.md` (설정)

각 문서 구조(권장): 배경 → 요구사항 → UX(화면·플로우) → 백엔드 API 설계 → 데이터 변경 → 권한 → 엣지케이스 → 구현 Task 목록(대략적). 근거는 `파일:라인`으로.
