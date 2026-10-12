# [SDD-107] — Implementation Plan

> Stage ③ Verify 작성 후 구현 시작. BE/FE WS 계약이 얽혀 있으므로 단일 에이전트 순차 구현.

**Goal:** 연결 단절(flapping)의 근본 원인 3가지를 제거해 연결을 안정화한다.

**Architecture:**
- FE: `getSessionLiveSocket`이 토큰 변경 시 소켓을 버리지 않고 `auth`만 갱신한다. `connect_error`에서 토큰 재발급 후 `connect()` 재시도.
- BE: WS 핸들러의 동기 DB I/O를 `asyncio.to_thread`로 격리한다. `ping_timeout`을 관대하게(interval의 2배). connect 거부 시 명시적 reason.

**Tech Stack:** React 19 + socket.io-client 4.8 / FastAPI + python-socketio + SQLAlchemy(동기)

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/ws/__init__.py` | ping_interval/ping_timeout 명시 + cors 화이트리스트 정리 |
| Modify | `backend/app/ws/session_live_namespace.py` | connect reason 전달, on_feature·join·시그널의 동기 DB → to_thread |
| Modify | `frontend/src/lib/socket.ts` | getSessionLiveSocket auth 갱신(disconnect 제거) |
| Modify | `frontend/src/hooks/useSessionLiveSocket.ts` | connect_error/reconnect_failed 처리, 신호 버퍼 보완 |
| Modify | `backend/tests/test_*.py` | connect reason·to_thread 회귀 테스트 |
| Modify | `frontend/tests/*.test.ts` | 싱글톤·connect_error·버퍼 테스트 |

## Tasks

### Task 1: BE — ping_timeout 명시 + connect reason 전달
**Objective:** `ws/__init__.py`에 `ping_interval=20`·`ping_timeout=40` 명시. connect 핸들러가 만료 토큰이면 `return False` 대신 `raise ConnectionRefusedError("token_expired")`로 reason을 구분해 전달.
**Files:** `backend/app/ws/__init__.py`, `backend/app/ws/session_live_namespace.py`
**Estimate:** 15min

### Task 2: BE — WS 핸들러 동기 DB → asyncio.to_thread
**Objective:** `on_feature`(feature 저장), `_resolve_join`(join 해석), `_resolve_quiet_signal_sender`(시그널 해석)의 동기 SQLAlchemy 호출을 `asyncio.to_thread`로 감싼다. 동기 함수는 그대로 두고 호출부만 비동기화.
**Files:** `backend/app/ws/session_live_namespace.py`
**Estimate:** 30min

### Task 3: FE — 싱글톤 auth 갱신(disconnect 제거)
**Objective:** `getSessionLiveSocket(token)`이 토큰 변경 시 기존 소켓을 `disconnect()`하지 않고 `socket.auth`만 갱신한다. `sessionLiveToken` 캐시 갱신 + 재연결 시 새 토큰 적용.
**Files:** `frontend/src/lib/socket.ts`
**Estimate:** 20min

### Task 4: FE — connect_error/reconnect_failed 처리
**Objective:** `useSessionLiveSocket`이 `connect_error`에서 토큰 만료를 감지해 `refreshAccessToken()` 후 `socket.auth` 갱신 + `connect()` 재시도(1회 가드). `reconnect_failed` 시 UI 상태 노출.
**Files:** `frontend/src/hooks/useSessionLiveSocket.ts`
**Estimate:** 20min

### Task 5: FE — 신호 버퍼 보완
**Objective:** `pendingSignalsRef`를 "유형별 최신 1건"으로 압축(중복 push 방지). cleanup의 `pendingSignalsRef.current = []` 제거(세션 변경 시에만 폐기). `join_denied` 시 폐기 유지(영구 거부).
**Files:** `frontend/src/hooks/useSessionLiveSocket.ts`
**Estimate:** 15min

### Task 6: 테스트 + 빌드
**Objective:** 기존 테스트 갱신(connect reason, auth 갱신, 버퍼 압축) + `npm run build` 0 errors + `pytest` 전체 통과.
**Files:** `backend/tests/`, `frontend/tests/`
**Estimate:** 20min

## Testing Strategy
- `cd backend && pytest -q` — 전체 백엔드
- `cd frontend && npm run build` — tsc + vite
- `cd frontend && npx vitest run` — 전체 유닛
