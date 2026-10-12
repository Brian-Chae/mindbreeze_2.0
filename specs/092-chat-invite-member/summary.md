# [SDD-092] — Summary

## What Was Built

채팅방 회원 초대(상담사+내담자) + "기존 대화 유지 vs 새 방" 선택 기능. Claude(백엔드) + Codex(프론트) 병렬 구현.

### 백엔드 (Claude)
| 파일 | 변경 |
|------|------|
| `services/chat_service.py` | `_share_org_counselor()`, `_can_invite_room()`(host OR org_admin), `_ensure_invite_room()`(fork allow_direct), `_validate_invitee()`(role 분기), `add_room_participants()` 확장, `fork_group_room()`, `list_invitable_counselors()`, 참여자 `role` 추가 |
| `schemas/chat.py` | `RoomForkRequest`, `InvitableCounselorOut`, `InvitableCounselorsResponse`, `RoomParticipantOut.role` |
| `api/v1/chat.py` | `POST /rooms/{room_id}/fork`, `GET /invitable-counselors` |
| `tests/test_chat_invite_member.py` | 12개 신규 시나리오 |

### 프론트 (Codex)
| 파일 | 변경 |
|------|------|
| `lib/api/chat-invite.ts`(신규) | `listInvitableCounselors`/`forkChatRoom`/`canInviteToRoom` |
| `hooks/use-chat-invite.ts`(신규) | 단계·탭·검색·선택·요청 상태 |
| `components/chat/InviteMemberModal.tsx`(신규) | 대상 선택 → "기존 대화 유지 vs 새 방" 2단계 |
| `RoomActionsMenu.tsx`·`RoomSettingsModal.tsx` | "회원 초대" 진입점 (host/org_admin) |
| `stores/chatStore.ts`·`ChatPage.tsx`·`ClientChatPage.tsx` | 새 방 목록 반영·내담자 비노출 |
| `tests/chat-invite*.test.ts` | 3개 파일 (API·flow·UI) |

## Brian 확정 결정 반영
1. 초대 대상: 상담사 + 내담자
2. 권한: host 상담사 + 기관 관리자(org_admin, host와 같은 기관 active 멤버십)
3. 새 방: 기존 방 유지 + 새로 생성 (이력 미복사)
4. direct 방: fork(새 방)만 허용

## 검증 결과 (실측)
- 백엔드 `pytest`: **746 passed + 12 skipped** (신규 invite 12개 포함)
- 프론트 `npm run build`: **0 에러**
- 프론트 `npm run test:chat`: **38 passed** (6 파일)

## 설계 노트 (스펙에 미기재 사항 → Brian 확인 권장)
- **org_admin이 fork한 새 방은 본인이 참여자가 아님** → fork 직후 접근 불가. "관리 행위"로 보고 그대로 둠(worker 판단). 필요하면 org_admin도 fork한 방에 자동 참여시키도록 조정 가능.
- DB 마이그레이션 0건 (`role`은 `User.role` JOIN으로 노출).

## 범위 외
- 참여자(비 host)의 초대, 초대된 상담사에 공동 host 권한 부여, direct→group "기존 방 추가"(대화 공개)
