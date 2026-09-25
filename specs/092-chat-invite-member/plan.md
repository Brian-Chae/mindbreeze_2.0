# [SDD-092] — Implementation Plan

## 아키텍처
- **초대 권한**: `_can_invite_room(room, user, db)` — host(상담사) OR 기관 관리자(host와 같은 기관 active 멤버십 공유).
- **기존 방 추가** = `add_room_participants` 확장 (role 분기: client=기존 경로, counselor/org_admin=신규 `_share_org_counselor`).
- **새 방** = `fork_group_room` — 기존 참여자 승계(재검증 없음) + 새 참여자 검증 → 새 group 방. 대화 이력 미복사, 기존 방 유지. direct도 fork 허용(host+상대+새참여자).

## Task 목록

### 백엔드
- [x] T1 `chat_service.py`: `_share_org_counselor(host_id, target_id, db)` — 양측 active 멤버십 org 교집합
- [x] T2 `chat_service.py`: `_can_invite_room()` + `_validate_invitee()` — host/org_admin 권한 + role 분기 검증
- [x] T3 `chat_service.py`: `add_room_participants()` 확장 (상담사 초대 + org_admin 권한, 내담자 하위 호환)
- [x] T4 `chat_service.py`: `fork_group_room()` — group/direct fork (승계+검증+새 방 생성)
- [x] T5 `chat_service.py`: `list_invitable_counselors()` — 공유 기관 active 상담사 후보
- [x] T6 `chat_service.py`: `get_room_participants()` 응답에 `role` 추가
- [x] T7 `schemas/chat.py`: `RoomForkRequest`, `InvitableCounselorOut`, `InvitableCounselorsResponse`, `RoomParticipantOut.role`
- [x] T8 `api/v1/chat.py`: `POST /rooms/{room_id}/fork`, `GET /invitable-counselors`
- [x] T9 `tests/test_chat_invite_member.py`(신규): 초대/권한/fork/후보조회 시나리오

### 프론트
- [x] T10 `lib/api/chat.ts` + `lib/api/chat-invite.ts`(신규): 초대 타입·API (상담사 후보, fork)
- [x] T11 `hooks/use-chat-invite.ts`(신규): 단계·탭·검색·선택·방식·요청 상태
- [x] T12 `components/chat/InviteMemberModal.tsx`(신규): 대상 선택 → 방식 선택 2단계
- [x] T13 `RoomActionsMenu.tsx`·`RoomSettingsModal.tsx`: "회원 초대" 진입점 (상담사 호스트/org_admin만)
- [x] T14 `stores/chatStore.ts`: 새 방 ID 삽입 + 메타 갱신
- [x] T15 `ClientChatPage.tsx`: 내담자 초대 UI 비노출 회귀 확인

## 검증
- 백엔드 `pytest`, 프론트 `npm run build` + `npm run test:chat`

프론트엔드 구현·검증 결과 및 백엔드 연동 확인 사항: `summary-frontend.md`.
