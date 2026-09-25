# [SDD-089] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 채팅 기능 재노출 + 권한을 기관 멤버십 기반으로 확장 (방 3종 전부, 세션 방은 예정 단계부터).

**Architecture:**
- 백엔드: `chat_service.py`의 direct/group 방 권한 판정을 `ClientCounselorLink` 단독 → **기관 멤버십 공유 여부(OR ClientCounselorLink 하위호환)** 로 확장.
- 프론트: `SidebarNav` 3개 역할 메뉴(상담사·기관·내담자)에 "채팅" 재추가. 내담자 채팅은 `ClientAppPage`가 이미 `/app/chat`을 `ClientChatPage`로 렌더링하므로 라우트 신설 불필요(메뉴만 추가).

**Tech Stack:** FastAPI + SQLAlchemy / React + TypeScript + Tailwind

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/chat_service.py` | direct/group 권한을 기관 멤버십 기반으로 확장 (헬퍼 `_share_org` + 기존 링크 폴백) |
| Modify | `frontend/src/components/layout/SidebarNav.tsx` | 상담사/기관/내담자 메뉴에 "채팅" 항목 추가 (+ 아이콘) |
| Modify | `frontend/src/components/layout/SidebarNav.tsx` (ICONS) | chat 아이콘 추가 (없으면) |

## Tasks

### Task 1: 기관 멤버십 공유 판정 헬퍼 추가 (백엔드)
**Objective:** `_share_org(counselor_id, client_id, db)` — 상담사의 active 기관 집합과 내담자의 기관(`User.org_id`) 교집합 여부 반환
**Files:** `backend/app/services/chat_service.py`
**Estimate:** 10min

### Task 2: direct/group 방 권한 확장 (백엔드)
**Objective:** `_ensure_member`(direct), `create_room`(direct), `create_group_room`의 `ClientCounselorLink` 검사를 `_share_org OR ClientCounselorLink` 로 교체
**Files:** `backend/app/services/chat_service.py`
**Estimate:** 15min

### Task 3: 세션 방 예정 단계 접근 확인 (백엔드)
**Objective:** `list_my_rooms`가 세션 상태 무관하게 모든 hosted/participated 세션의 방을 생성·노출하는지 확인 (상태 게이트가 없으면 변경 없음)
**Files:** `backend/app/services/chat_service.py` (검증 위주)
**Estimate:** 5min

### Task 4: 채팅 메뉴 재노출 (프론트)
**Objective:** `SidebarNav`의 `NAV_ITEMS`(상담사)·`ORG_ADMIN_NAV_ITEMS`(기관)·`CLIENT_NAV_ITEMS`(내담자)에 "채팅" 항목 추가. 내담자는 `/app/chat`, 상담사·기관은 `/chat`. chat 아이콘 추가.
**Files:** `frontend/src/components/layout/SidebarNav.tsx`
**Estimate:** 15min

## Testing Strategy
- 백엔드: `cd backend && venv/bin/pytest -q` (채팅 권한 관련 테스트 존재 시 갱신)
- 프론트: `cd frontend && npm run build` (tsc 포함) 0 errors
- 수동: 같은 기관 상담사↔내담자 방 생성·대화, 기존 링크 내담자 하위호환, 예정 세션 방 노출
