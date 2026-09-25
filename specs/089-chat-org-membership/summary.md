# [SDD-089] — Summary

## What Was Built

| File | Description |
|------|-------------|
| `backend/app/services/chat_service.py` | `_share_org` 헬퍼 추가 + direct/group 방 권한을 기관 멤버십 기반으로 확장(기존 `ClientCounselorLink`는 하위 호환 유지) |
| `frontend/src/components/layout/SidebarNav.tsx` | 상담사·기관 관리자·내담자 3개 역할 메뉴에 "채팅" 항목 재추가 (기존 `ICONS.message` 재사용) |

## 변경 요약 (Brian 결정 반영)

1. **적용 범위 (클래스/세션·그룹 포함)** — 방 3종(direct/session/group) 전부 활성화. 세션 방은 기존 `list_my_rooms`가 세션 상태 무관 자동 생성하므로 별도 변경 없음.
2. **기관 멤버십 기반 권한** — `_share_org(counselor_id, client_id)`: 상담사의 active 기관(`UserOrgMembership`) ∩ 내담자 기관(`User.org_id`). `ClientCounselorLink`는 기존 1:1 매칭 하위 호환으로 유지.
3. **예정 단계부터 열기** — 세션 방이 ready/scheduled 단계부터 방 목록에 노출(상태 게이트 없음 확인).

## Test Results

- ✅ 백엔드 pytest: **722 passed + 12 skipped** (test_chat.py 17개 포함 전부 통과)
- ✅ 프론트 `npm run build`: 0 errors (built in 1.33s)
- ✅ `chat_service` import 검증 통과

## Debugging Journey
- 특이사항 없음 — 기존 채팅 코드가 완성된 상태로 남아 있어 권한 확장 + 메뉴 재노출만 필요했음.

## Notes for Reviewer
- 기관 멤버십 판정은 `UserOrgMembership.status='active'`만 카운트 (left/invited 제외).
- 내담자 기관 미소속(`User.org_id == null`)이면 `_share_org`는 False → 기존 `ClientCounselorLink`로만 판정(하위 호환).
- 플랫폼 관리자(`ADMIN_NAV_ITEMS`)는 채팅 메뉴 미추가 (운영자 채팅 불필요).
- WS `/chat` 네임스페이스는 토큰 없이 연결 허용(기존 하위 호환) — 방 join 권한은 REST `_ensure_member`가 담당.
