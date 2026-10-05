# [SDD-129] — Summary

## What Was Built
| 파일 | 변경 |
|------|------|
| `backend/app/services/session_service.py` | `get_guest_session_state`에 `guest_state` 파생값 추가 |
| `backend/app/schemas/session.py` | `GuestSessionStateResponse.guest_state` 필드 |
| `frontend/src/lib/session-status.ts` (신설) | `SESSION_STATUS_LABELS` + `sessionStatusLabel()` 단일 소스 |
| `StatusBadge`·`DaySchedule`·`OrgCounselorsPage`·`class-join-page` | 로컬 라벨맵 제거 → 단일 소스 import |
| `frontend/src/pages/sessions/SessionDetailPage.tsx` | `useSessionLiveSocket` 구독 + 5초 폴링 `isReady` 게이트 |
| `frontend/src/pages/class-join-page.tsx` | `useSessionLiveSocket` 구독으로 시작/종료 즉시 전환 |

## Test Results
- ✅ `npm run build` — 0 errors (8.36s)
- ✅ `pytest` — 1009 passed, 12 skipped, 0 failed

## Notes for Reviewer
- **③-2**: 방향 A(BE 파생값) 채택 — FE 분기는 기존 `guest_state` 분기가 그대로 살아남.
- **③-6**: 통일 표기 `ready=준비 / scheduled=예정 / open=입장 가능 / in_progress=진행 중 / completed=완료 / cancelled=취소`.
- **③-8/①-6**: WS 구독은 `isReady`(snapshot 확정)를 게이트로 쓰므로 join_denied·오프라인 시 기존 폴링 폴백이 유지된다.
