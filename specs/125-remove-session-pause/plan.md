# [SDD-125] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현. Brian 결정(2026-10-05)으로 ②~⑥ 연속 진행 승인.

**Goal:** 세션 상태 `paused`와 상담사 "일시정지/재개" 기능을 백엔드·프론트 전 제품에서 제거한다.

**Architecture:**
- 상태머신의 원천(`TRANSITIONS`)에서 `pause`/`resume` 전이 제거 → API 라우트·WS 브로드캐스트·알림 이벤트·프론트 상태 표시/버튼이 죽은 코드가 되므로 일괄 제거.
- **주의:** 오디오/녹화 **재생 제어**의 pause/resume(MediaRecorder·audio engine)은 세션 상태와 무관 → **손대지 않음**.

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/services/session_service.py` | `ACTIVE_STATUSES`·`TRANSITIONS`·`_action_event`·`_action_title`·상태체크 3곳(1125/1218/1690)·`QUIET_SIGNAL`·`AUDIO_SYNC` 상수에서 `paused`/`pause`/`resume` 제거 |
| Edit | `backend/app/api/v1/session.py` | 액션 루프에서 `"pause"`/`"resume"` 제거 |
| Edit | `backend/app/ws/session_live_namespace.py` | 상태 변경 브로드캐스트·`AUDIO_SYNC_SESSION_STATUSES`에서 `paused` 제거 |
| Edit | `backend/app/services/org_management_service.py` | ongoing 필터에서 `"paused"` 제거 |
| Edit | `backend/app/models/user.py` | `session_paused`/`session_resumed` 알림 토글 제거 |
| Create | `backend/alembic/versions/xxxx_remove_paused_status.py` | 기존 `paused` → `in_progress` 데이터 마이그레이션 |
| Edit | `frontend/src/components/session/StatusBadge.tsx` | paused 라벨·색 제거 |
| Edit | `frontend/src/components/session/CalendarView.tsx` | paused 색 제거 |
| Edit | `frontend/src/components/session/MobileTimetable.tsx` | paused 색 제거 |
| Edit | `frontend/src/components/session/DaySchedule.tsx` | paused 라벨·색 제거 |
| Edit | `frontend/src/pages/org/OrgCounselorsPage.tsx` | paused 라벨 제거 |
| Edit | `frontend/src/pages/class-join-page.tsx` | paused 라벨 제거 |
| Edit | `frontend/src/pages/sessions/SessionDetailPage.tsx` | `paused: ['cancel']`·pause/resume 액션·버튼 제거 |
| Edit | `frontend/src/pages/client/ClientSessionDetailPage.tsx` | paused 필터 제거 |
| Edit | `frontend/src/components/session/SessionCodeBanner.tsx` | mode `'paused'` 제거 |
| Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 일시정지/재개 버튼 제거 |
| Edit | `frontend/src/components/player/LeaveGuardModal.tsx` | paused 주석·조건 정리 |
| Edit | `frontend/src/hooks/useLeaveGuard.ts` | paused 주석·조건 정리 |

## Tasks

### Task 1: 백엔드 상태머신 제거 (session_service.py)
- `ACTIVE_STATUSES`·`TRANSITIONS`·`_action_event`·`_action_title`·상태체크 3곳·상수 2곳에서 paused/pause/resume 제거.

### Task 2: 백엔드 API·WS·알림 제거
- `api/v1/session.py` 액션 루프, `ws/session_live_namespace.py` 브로드캐스트·AUDIO_SYNC, `org_management_service.py` 필터, `models/user.py` 알림 토글.

### Task 3: 데이터 마이그레이션
- `UPDATE sessions SET status='in_progress' WHERE status='paused'` Alembic 리비전.

### Task 4: 프론트 상태 표시 제거
- StatusBadge·CalendarView·MobileTimetable·DaySchedule·OrgCounselorsPage·class-join-page·SessionCodeBanner·ClientSessionDetailPage·ClassPlayerPage(표시)의 paused 라벨/색/필터.

### Task 5: 프론트 전이 버튼 제거
- SessionDetailPage(pause/resume 액션)·ClassPlayerPage(일시정지/재개 버튼)·LeaveGuardModal/useLeaveGuard(조건).

### Task 6: 검증
- `grep -rn "paused"` → 세션 상태 0건, `npm run build`, `pytest`.

## Testing Strategy
- 백엔드: `cd backend && pytest` (세션 상태 전이 관련 테스트)
- 프론트: `cd frontend && npm run build` (0 errors)
- grep 검증: 세션 상태 `paused` 잔존 0건 (재생 제어·목업 제외)
