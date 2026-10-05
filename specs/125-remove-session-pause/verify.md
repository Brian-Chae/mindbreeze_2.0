# [SDD-125] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: pause/resume 엔드포인트 제거
1. `grep -rn "pause\|resume" backend/app/api/v1/session.py`
2. 액션 루프(`for _action in (...)` L209)에 `pause`/`resume`이 없음.
- **Expected:** `POST /sessions/{id}/pause`·`/resume` 라우트 미등록 → 호출 시 404.

### TS2: 상태머신 전이 제거
1. `backend/app/services/session_service.py`의 `TRANSITIONS` 확인.
- **Expected:** `"pause"`/`"resume"` 키 없음. `"end"`의 from은 `{"in_progress"}`, `"cancel"`의 from은 `{"ready","scheduled","open","in_progress"}`.

### TS3: paused 상태 생성 경로 0건
1. `grep -rn "paused" backend/ frontend/src/`
2. 세션 상태 `paused` 관련 코드가 0건 (재생 제어·playground·목업·주석 제외).
- **Expected:** `session.status = 'paused'` / `status === 'paused'` / `"paused"` (세션 상태) 잔존 없음.

### TS4: 기존 paused 데이터 마이그레이션
1. 마이그레이션 실행.
- **Expected:** `sessions` 테이블에 `status='paused'` 행이 0건. 기존 행은 `in_progress`로 변경.

### TS5: 재생 제어 pause/resume 유지
1. BGM·음성·화면 녹화의 일시정지/재개 동작.
- **Expected:** `useAudioRecorder`·`useClassAudioPlayer`·`useGuestAudioSync`·`useLobbyBgm`·`RecordingControls`의 pause/resume 정상 동작 (세션 상태와 무관).

### TS6: 빌드·테스트 통과
1. `cd backend && pytest`
2. `cd frontend && npm run build`
- **Expected:** 0 errors.

## Edge Cases
- [ ] `in_progress` → `completed` (end) 정상 동작 (paused 우회 경로 없음).
- [ ] `open` 상태에서 `cancel` 정상 동작.
- [ ] 기존 `paused` 세션이 마이그레이션 후 목록·홈에 정상 노출.
- [ ] 알림 토글(`session_paused`/`session_resumed`) 제거 후 기본 알림 스키마(`user.py`) 정합 — 깨진 키 참조 없음.

## Security Review
- [ ] pause/resume 제거가 권한 검증(`_get_session_as_host`) 로직에 영향 없음.
- [ ] WS 브로드캐스트에서 pause/resume 이벤트가 더 이상 발행되지 않음.
