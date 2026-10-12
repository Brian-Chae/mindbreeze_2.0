# [SDD-125] 일시정지(paused) 기능 제거

## Goal
세션 상태 `paused`와 상담사 "일시정지/재개" 기능을 전 제품(백엔드 상태머신·API·WS·프론트 UI·알림)에서 제거한다.

## Context
- Brian 결정(2026-10-05): 수업 중 잠깐 멈추는 시나리오가 필요 없다 → 기능 자체를 제거.
- 전수조사 기획서 `docs/회원-세션-대기-진행-화면-전수조사-기획서.md` §2-1/§2-2: `paused`가 목록·홈 필터·자동 입장 씬전환에서 누락·불일치하여 **클래스 사라짐 + 회원 갇힘**을 유발.
- 제거하면 이 결함들이 근본적으로 해소된다(임시 방편이 아니라 원천 제거).
- 유지해야 할 "pause/resume"가 별도 존재: **오디오·녹화 재생 제어**(BGM·음성·화면 녹화의 일시정지)와 개발자 플레이그라운드. 이는 세션 상태와 무관하므로 **제거하지 않는다**.

## Scope

### ✅ In-scope — 세션 상태 `paused` 제거

**백엔드:**
- `backend/app/services/session_service.py`
  - `ACTIVE_STATUSES`(:30)에서 `"paused"` 제거
  - `TRANSITIONS`(:35-41): `"pause"`/`"resume"` 전이 제거, `"end"`/`"cancel"`의 from에서 `"paused"` 제거 (end → `in_progress`만, cancel → `ready/scheduled/open/in_progress`)
  - `transition_status`(:720+): pause/resume 액션 제거
  - 알림 이벤트·메시지(:812-821): `session_paused`/`session_resumed` 제거
  - `QUIET_SIGNAL_SESSION_STATUSES`(:1575), `AUDIO_SYNC_SESSION_STATUSES`(:1650): `"paused"` 제거
  - 상태 체크(:1125, :1218, :1690): `("in_progress", "paused")` → `"in_progress"` 단독
- `backend/app/api/v1/session.py:209`: `for _action in (...)`에서 `"pause"`/`"resume"` 제거
- `backend/app/ws/session_live_namespace.py`: 상태 변경 브로드캐스트(:784)·오디오 동기화 상태(:1019)에서 `paused` 제거
- `backend/app/services/org_management_service.py:143`: ongoing 필터에서 `"paused"` 제거
- `backend/app/models/user.py:29-30,61-62`: `session_paused`/`session_resumed` 알림 토글 제거

**데이터 마이그레이션:**
- 기존 `paused` 행 → `in_progress` 통합: `UPDATE sessions SET status='in_progress' WHERE status='paused'`
- `status`는 `String(20)` free-form(DB 제약 없음)이므로 **스키마 변경·Alembic 불필요**, 데이터 UPDATE로 처리. 단, 정합성 위해 별도 데이터 마이그레이션 SQL/스크립트로 명시.

**프론트 (세션 상태 `paused` 표시·전이 제거):**
- `components/session/StatusBadge.tsx:10,20` / `CalendarView.tsx:60` / `MobileTimetable.tsx:33` / `DaySchedule.tsx:32,44` — paused 라벨·색 제거
- `pages/org/OrgCounselorsPage.tsx:27` / `pages/class-join-page.tsx:36` — paused 라벨 제거
- `pages/sessions/SessionDetailPage.tsx:34,42,43` — `paused: ['cancel']`·pause/resume 액션·버튼 제거
- `pages/client/ClientSessionDetailPage.tsx:133,136` — paused 필터 제거
- `components/session/SessionCodeBanner.tsx:7,8,40,41` — mode `'paused'` 제거
- `pages/sessions/ClassPlayerPage.tsx` — 상담사 플레이어 일시정지/재개 버튼 제거
- `components/player/LeaveGuardModal.tsx:3` / `hooks/useLeaveGuard.ts:2` — paused 주석·조건 정리

### ❌ Out-of-scope — 유지 (제거 금지)
- 오디오/녹화 **재생 제어**의 pause/resume: `useAudioRecorder`·`useVideoRecorder`·`RecordingControls`·`useClassAudioPlayer`·`useGuestAudioSync`·`useLobbyBgm`·`WaveformCanvas`
- 개발자 플레이그라운드(`playground/*`) 그래프 일시정지 (`EegWaveformPanel`·`TrendPanel`·`PpgPanel`·`DebugPanel`)
- 디자인 목업(`designs/`, `design/`, `OperatorAppPage`·`UserAppPage`)
- `state_version`(상태 전이 계약) — 유지
- 문서(기획서 등)의 과거 기록 — 유지(히스토리)

## Acceptance Criteria
- [ ] `POST /sessions/{id}/pause`, `POST /sessions/{id}/resume` 엔드포인트가 제거되어 404를 반환한다.
- [ ] 상담사 플레이어에 일시정지/재개 버튼이 없다.
- [ ] `grep -rn "paused"` 결과에서 **세션 상태 관련 코드가 0건**이다 (재생 제어·목업·주석 제외).
- [ ] 기존 `paused` 데이터가 `in_progress`로 마이그레이션된다.
- [ ] 오디오/녹화 재생 일시정지(BGM·음성·화면)는 그대로 동작한다.
- [ ] `npm run build` 0 errors, `pytest` 통과.

## Dependencies
- 없음(단독 제거). 단, 후속 SDD-126(참여자 데이터 정합)·SDD-129(상태 계약)가 `session_service.py`를 공유하므로 **순차 진행**(병렬 금지).

## Risks
- **오제거 위험**: 세션 상태 `paused`와 재생 제어 pause/resume을 혼동해 BGM/녹화가 깨질 수 있다 → 제거 전 `grep`으로 두 종류를 분리 매핑하고, 재생 제어 쪽은 손대지 않는다.
- **알림 스키마 정합**: `session_paused`/`session_resumed` 토글 제거 시 기본 알림 스키마(`user.py`의 이메일/in_app 딕셔너리)와 정합 확인.
- **기존 paused 데이터**: 마이그레이션 누락 시 일시정지 상태로 남은 세션이 "진행 중"으로도 안 잡혀 고아 상태가 된다 → UPDATE 반드시 실행.
