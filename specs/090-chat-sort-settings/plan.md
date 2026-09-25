# [SDD-090] — Implementation Plan

## 아키텍처 요약
- **정렬**: 서버는 `last_message_at ?? created_at` 기본 정렬로 반환, 프론트는 응답 전체를 받아 클라이언트 토글 재정렬(서버 재호출 없음).
- **설정**: `ChatRoom.display_name`(nullable) 신규 컬럼. direct `name`(내담자ID) 보존. PATCH는 host 전용.
- **참여자 관리**: `ChatRoomParticipant` 기반, group host 전용 추가/내보내기.

## Task 목록 (구현 순서)

### 백엔드
- [ ] **T1 모델**: `backend/app/models/chat.py` — `ChatRoom.display_name: String(120) nullable` 추가
- [ ] **T2 마이그레이션**: `backend/alembic/versions/<ts>_sdd_090_chat_display_name.py` — display_name 컬럼 추가 + `chat_messages(room_id, created_at DESC)` 인덱스 (수동 작성)
- [ ] **T3 스키마**: `backend/app/schemas/chat.py` — `LastMessagePreview`, `RoomUpdateRequest`, `RoomResponse`에 `last_message`/`last_message_at`/`custom_name`/`display_name`/`can_rename`/`rename_disabled_reason` 추가
- [ ] **T4 서비스-집계**: `_last_messages_for_rooms()` (DISTINCT ON 일괄 조회) + `_serialize_room()` last_message 주입 + `list_my_rooms()` 기본 정렬
- [ ] **T5 서비스-설정**: `update_room()` + `_can_rename_room()` 권한 계산 + display_name 직렬화 (host 전용, session 조회 전용)
- [ ] **T6 서비스-참여자**: `add_room_participants()` / `remove_room_participant()` (group host 전용, `_share_org`/Link 재검증)
- [ ] **T7 API**: `backend/app/api/v1/chat.py` — PATCH `/rooms/{room_id}`, POST `/rooms/{room_id}/participants`, DELETE `/rooms/{room_id}/participants/{user_id}`
- [ ] **T8 테스트**: `backend/tests/test_chat.py` — 정렬/이름변경/참여자관리 시나리오

### 프론트
- [ ] **T9 타입·API**: `frontend/src/lib/api/chat.ts` — `last_message_at`/`custom_name`/`display_name`/`can_rename` 타입 + `updateChatRoom()` + 참여자 API
- [ ] **T10 정렬 유틸**: `frontend/src/lib/chat-sort.ts`(신규) — `sortRooms()` + vitest
- [ ] **T11 스토어**: `frontend/src/stores/chatStore.ts` — `updateRoomLastMessage` + `updateRoom`(이름) 액션
- [ ] **T12 정렬 토글**: `frontend/src/components/chat/ChatSortToggle.tsx`(신규) + `useChatSortPreference()` 훅
- [ ] **T13 설정 모달**: `frontend/src/components/chat/RoomSettingsModal.tsx`(신규) + `RoomActionsMenu.tsx`(⋯ 메뉴)
- [ ] **T14 페이지 연결**: `ChatPage.tsx`·`ClientChatPage.tsx` — 정렬 바, ⋯ 메뉴, 정렬된 목록 렌더, last_message 표시
- [ ] **T15 참여자 관리 UI**: 설정 모달 내 그룹 참여자 명단 + 추가/내보내기

## 검증 (Stage ⑤)
- 백엔드: `pytest tests/test_chat.py` + 전체 pytest
- 프론트: `npm run build` (tsc)
