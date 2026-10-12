# [SDD-090] — Summary

## What Was Built

채팅방 목록 정렬 + 채팅방 설정(이름·정보 변경) + 그룹 참여자 관리 3가지를 구현했다. 구현은 Claude(백엔드) + Codex(프론트) 병렬 워커로 진행.

### 백엔드 (Claude)
| 파일 | 변경 |
|------|------|
| `models/chat.py` | `ChatRoom.display_name`(String(120) nullable) 추가 — direct `name`(내담자ID) 보존용 별도 컬럼 |
| `alembic/versions/e036a0000014_sdd_090_chat_display_name.py` | display_name 컬럼 + `chat_messages(room_id, created_at DESC)` 인덱스 (수동 작성) |
| `schemas/chat.py` | `LastMessagePreview`, `RoomUpdateRequest`, `RoomParticipantsAddRequest`, `RoomParticipantOut`, `RoomParticipantsResponse` + `RoomResponse`에 6필드 추가 |
| `services/chat_service.py` | ① `_last_messages_for_rooms()`(DISTINCT ON + SQLite 폴백) ② `_serialize_room()` last_message 주입 ③ `list_my_rooms()` 기본 정렬 ④ `update_room()`+`_can_rename_room()` ⑤ `add/remove/get_room_participants()` |
| `api/v1/chat.py` | PATCH `/rooms/{room_id}`, GET/POST `/rooms/{room_id}/participants`, DELETE `/rooms/{room_id}/participants/{user_id}` |
| `tests/test_chat.py` | 신규 12개 (test_18~29) |

### 프론트 (Codex)
| 파일 | 변경 |
|------|------|
| `lib/api/chat.ts` | 설정·참여자 API + 타입 (last_message_at/display_name/can_rename 등) |
| `lib/chat-sort.ts`(신규) | `sortRooms()` 정렬 유틸 |
| `stores/chatStore.ts` | 방 정보·최근 메시지 갱신 액션 |
| `hooks/useChatSortPreference.ts`(신규) | 정렬 모드 localStorage |
| `components/chat/ChatSortToggle.tsx`·`RoomActionsMenu.tsx`·`RoomSettingsModal.tsx`(신규) | 정렬 토글·⋯ 메뉴·설정/참여자 모달 |
| `pages/chat/ChatPage.tsx`·`client/ClientChatPage.tsx` | 양쪽 화면 연결 |
| `tests/chat-*.test.ts` + `package.json` | 채팅 단위 테스트 11개 |

## 검증 결과 (실측)
- 백엔드: `pytest` **734 passed + 12 skipped** (test_chat.py 29개 포함)
- 프론트: `npm run build` **0 에러**, `npm run test:chat` **11 passed**

## 구현 중 발견·해결한 사항
- **direct `name` = 내담자ID 저장소** → 표시 이름은 신규 `display_name` 컬럼으로 분리, `name` 절대 불변.
- **프론트가 참여자 명단 GET을 기대** → 백엔드에 `GET /rooms/{room_id}/participants`를 Supervisor가 직접 추가(워커 브리프에 누락됨).
- Codex Orca 워커 `agent_prompt_blocked` → headless `codex exec` + `-c features.memories=false`(이전 프로젝트 메모리 오염 차단)로 우회.

## 범위 외 (후속)
- 내담자 개인 별칭, 방장 위임, session 참여자 변경, 이름 충돌 검사, 실시간 소켓 이름 동기화
