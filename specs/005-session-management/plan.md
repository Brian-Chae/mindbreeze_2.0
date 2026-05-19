# F5 세션 관리 — Plan

## 백엔드 구현 전략
1. **schemas/session.py** — Pydantic v2 스키마: SessionCreate, SessionUpdate, SessionResponse, SessionListResponse, InviteParticipantRequest, MarkerRequest
2. **services/session_service.py** — 비즈니스 로직
   - `create_session(host_id, payload, force, db)`: 과거 일시 차단, 충돌 검출
   - `list_sessions(user_id, db)`: host인 세션 + participant인 세션 union
   - `get_session(session_id, user_id, db)`: host 또는 participant만 접근
   - `update_session(session_id, host_id, payload, db)`: host 권한 검사
   - `delete_session(session_id, host_id, db)`
   - `transition_status(session_id, host_id, action, db)`: action ∈ {start, pause, resume, end, cancel}
   - `invite_participant(session_id, host_id, user_id, db)`: 정원 검사
   - `add_marker(session_id, host_id, ts, note, db)`: SessionRecord.markers 갱신
   - `detect_conflict(host_id, scheduled_at, duration_min, exclude_id, db)`
3. **api/v1/session.py** — REST 라우터, deps.get_current_user 의존성
4. **services/__init__.py / api/v1/__init__.py** — 신규 모듈 wiring
5. **tests/test_session.py** — 15개 QA 항목 pytest 케이스

## 상태 전이 표
| action | from | to |
|--------|------|-----|
| start  | scheduled | in_progress |
| pause  | in_progress | paused |
| resume | paused | in_progress |
| end    | in_progress | completed |
| cancel | scheduled, in_progress | cancelled |

## 충돌 검출
- 동일 host, status ∈ {scheduled, in_progress, paused}
- 구간 [scheduled_at, scheduled_at + duration_min) 겹침
- `exclude_id`로 본인 수정 시 자기 자신 제외

## 프론트엔드 구현 전략
1. **lib/api/session.ts** — apiClient 기반 API 호출
2. **stores/sessionStore.ts** — Zustand: 선택된 세션, 캘린더 뷰 모드(daily/weekly/monthly), 기준 날짜
3. **components/session/** — SessionCard, StatusBadge, CalendarView (간단한 Tailwind grid 기반)
4. **pages/sessions/** — SessionListPage(목록+캘린더 토글), SessionCreatePage, SessionDetailPage
5. **App.tsx** — `/sessions`, `/sessions/new`, `/sessions/:id` 라우트 추가

## 비범위
- F5.5 반복 일정
- WebSocket 실시간 상태 동기화 (별도 스프린트)
- EEG/STT 연동 (별도 스프린트)
