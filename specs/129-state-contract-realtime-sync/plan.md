# [SDD-129] — Implementation Plan

## Files to Change
| File | Description |
|------|-------------|
| `backend/app/services/session_service.py` | `guest_state` 파생값 추가 |
| `backend/app/schemas/session.py` | `GuestSessionStateResponse.guest_state` 필드 |
| `frontend/src/lib/session-status.ts` (신설) | 라벨 단일 소스 |
| `frontend/src/components/session/StatusBadge.tsx` · `DaySchedule.tsx` | 라벨 교체 |
| `frontend/src/pages/org/OrgCounselorsPage.tsx` · `pages/class-join-page.tsx` | 라벨 교체 |
| `frontend/src/pages/sessions/SessionDetailPage.tsx` | WS 구독 + 폴링 게이트 |
| `frontend/src/pages/class-join-page.tsx` | WS 구독(화면 전환) |

## Tasks
1. BE `guest_state` 파생값 + 스키마 필드.
2. `session-status.ts` 신설 + 4개 파일 교체.
3. `SessionDetailPage` WS 구독 + 5초 폴링 `isReady` 게이트.
4. `class-join-page` WS 구독으로 시작/종료 즉시 전환.
