# 채팅방 회원 초대 (기존 대화 유지 vs 새 방) — 리서치 브리프

> 2026-09-25 · 기획 워커(Claude/Codex)가 읽는 공통 사실. 추측 금지, 아래 근거(파일:라인) 기반.

## 1. 배경

채팅 기능은 SDD-089(기관 멤버십 기반)·SDD-090(정렬/설정/참여자관리)·SDD-091(세션방 제거→회원별 1:1 개인방)을 거쳐 현재 모델은 **direct(1:1 개인방) + group(상담사가 초대한 그룹방)** 이다.
이번 기획 대상은 **기존 채팅방에 새 채팅 회원을 초대**하는 기능이다. 상담사 전용이며, **여러 상담사가 그룹으로 참여하는 그룹 명상 세션의 채팅방**을 만들 때 쓴다.

## 2. 현재 상태 (확정 사실)

### 백엔드 `backend/app/services/chat_service.py`
- `_share_org(counselor_id, client_id, db)`: 상담사의 active `UserOrgMembership` org 집합 ∩ 내담자의 `User.org_id`. **내담자 대상 전용**.
- `add_room_participants(room_id, user_id, participant_ids, db)`:
  - `_ensure_group_host()` → **group + host(상담사)만** 허용.
  - 각 참여자: 이미 있으면 skip, `ClientCounselorLink(host↔내담자)` OR `_share_org(host, 내담자)` 통과 시 추가.
  - **상담사를 초대하는 경로가 없음** (내담자만 대상).
- `remove_room_participant()` / `get_room_participants()`: group host 전용.
- `create_group_room(host_id, participant_ids, name, db)`: host + 내담자들로 group 방 생성. `ChatRoomParticipant(room_id, user_id, joined_at)`.

### 모델
- `ChatRoomParticipant`: `room_id, user_id, joined_at` (PK room_id+user_id). **role 구분 없음** — 참여자가 상담사인지 내담자인지 컬럼에 없음.
- `UserOrgMembership`: `user_id, org_id, role(counselor/org_admin), status(invited/active/left)` — 상담사↔기관 다중 소속.
- `User`: `role(counselor/client/org_admin/platform_admin)`, `org_id`.
- `ClientCounselorLink`: `counselor_id, client_id` — 상담사↔내담자 1:1 연결.

### 프론트
- `frontend/src/components/chat/RoomSettingsModal.tsx`: 그룹방 설정(이름 변경 + 참여자 명단/추가/내보내기).
- `frontend/src/components/chat/CreateRoomModal.tsx`: 새 방 생성 (direct/group, 내담자 선택).
- 참여자 추가는 `addChatRoomParticipants(roomId, participantIds)` → POST `/chat/rooms/{id}/participants`.
- **내담자 후보 조회**: `listClients()` (내담자 목록). **상담사 후보 조회 API 없음**.

## 3. 기획할 기능

### 핵심 시나리오
상담사가 그룹 명상 세션 채팅방을 만들 때, **다른 상담사**와 (필요시 내담자)를 초대한다. 초대 시 **"기존 대화 유지하고 추가" vs "새 방으로 만들기"** 를 물어본다.

### 기획 질문 (양쪽 워커가 답해야 할 것)
1. **초대 가능 대상**: 상담사(같은 기관?) + 내담자(기존 Link/공유기관)? 상담사 초대 권한 검증 기준은?
2. **권한**: 초대는 host(상담사)만? 기관 관리자? 초대받는 상담사는 어떤 조건(같은 기관 active 멤버십)?
3. **"기존 대화 유지 vs 새 방" 선택의 백엔드 의미**:
   - "기존 방에 추가" = `add_room_participants` (대화 이력 그대로).
   - "새 방 생성" = 기존 참여자 + 새 참여자를 복사해 새 group 방 생성 (대화 이력 없음). 기존 방은 어떻게? (유지/보관)
4. **ChatRoomParticipant에 role 구분 필요 여부**: 상담사/내담자 구분을 컬럼으로 추가할지, User.role로 조회로 구분할지.
5. **UX**: 초대 진입점(⋯ 메뉴/설정 모달), 대상 검색·선택, "기존 대화 유지 vs 새 방" 선택 다이얼로그.

## 4. 제약
- 상담사 전용 기능.
- UI 보라 `#5F0080` 테마, 한국어.
- 기존 `add_room_participants`(내담자) 동작은 유지(하위 호환).
- **구현 금지 — 기획 문서만.**

## 5. 산출물
- Claude → `docs/chat-invite-member/01-backend-기획.md` (백엔드 API·권한·"기존 vs 새 방" 로직)
- Codex → `docs/chat-invite-member/02-frontend-기획.md` (초대 UX·선택 다이얼로그·대상 검색)

각 문서: 배경 → 요구사항 → UX/API 설계 → 데이터 변경 → 권한 → 엣지케이스 → Task 목록. 근거는 `파일:라인`.
