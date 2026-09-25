# [SDD-092] 채팅방 회원 초대 (기존 대화 유지 vs 새 방)

## Goal
기존 채팅방에 새 채팅 회원(**상담사 + 내담자**)을 초대하는 기능. 초대 시 **"기존 대화 유지하고 추가" vs "새 방으로 만들기"** 를 선택한다. 여러 상담사가 참여하는 그룹 명상 세션 채팅방을 만들 때 쓴다.

## Brian 확정 결정 (2026-09-25)
1. **초대 대상**: 상담사 + 내담자 둘 다.
2. **권한**: host 상담사 **+ 기관 관리자(org_admin)** 가 같이 가짐.
3. **새 방**: 기존 방은 유지하고 **새로 만들어짐** (대화 이력 미복사).
4. **direct(1:1) 방**: "새 방으로 만들기"만 허용 (기존 방 추가 불가).

## 요구사항

### 초대 대상·권한
| ID | 요구사항 |
|----|---------|
| FR-A1 | **상담사 초대**: 대상 상담사는 초대자와 **같은 기관의 active 멤버십** 공유 + `User.status=='active'` |
| FR-A2 | **내담자 초대**: 기존 `ClientCounselorLink` OR `_share_org` (하위 호환 유지) |
| FR-A3 | **초대 권한**: ① 방의 host(상담사) ② 기관 관리자(org_admin, host와 같은 기관 active 멤버십 공유) |
| FR-A4 | 상담사 후보 조회 API 신규 (공유 기관 active 상담사, org_admin 전용 API 재사용 불가) |
| FR-A5 | 참여자 명단 응답에 `role`(상담사/내담자) 추가 |

### 초대 동작
| ID | 요구사항 |
|----|---------|
| FR-B1 | **기존 방에 추가** = `add_room_participants`를 `User.role` 분기로 확장 (내담자 경로 완전 하위 호환) |
| FR-B2 | **새 방으로 만들기** = `fork` — 기존 참여자 승계 + 새 참여자 → 새 group 방 생성. 대화 이력 미복사, 기존 방 유지 |
| FR-B3 | **direct 방**은 fork만 허용 (1:1 → 새 group 방: host + 기존 상대 + 새 참여자) |
| FR-B4 | 새 방 이름 미지정 시 서버 기본 이름 부여 |

## 범위 외
- `ChatRoomParticipant`에 role 컬럼 추가 없음 (`User.role` JOIN으로 구분, 마이그레이션 0건)
- 참여자(비 host)가 초대 불가, 초대된 상담사에 공동 host 권한 부여 없음
- direct→group "기존 방에 추가" (기존 대화 공개) 금지

## 참고 산출물
- `docs/chat-invite-member/01-backend-기획.md` (Claude)
- `docs/chat-invite-member/02-frontend-기획.md` (Codex)
- `docs/chat-invite-member/00-research-brief.md`
