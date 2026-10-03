# [SDD-107] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/ws/__init__.py` | `ping_interval=20`/`ping_timeout=40` 명시 (이벤트 루프 지연으로 인한 ping timeout 폭주 방지) |
| `backend/app/ws/session_live_namespace.py` | connect 거부를 `return False` → `raise ConnectionRefusedError("token_expired")`로 변경 + 6개 동기 DB 호출(`_resolve_join`·`_store_feature`·`_resolve_quiet_signal_sender`·`_resolve_audio_host`·`_compute_group_aggregate`)을 `asyncio.to_thread`로 격리 |
| `frontend/src/lib/socket.ts` | `getSessionLiveSocket` 토큰 갱신 시 disconnect 제거(auth만 갱신) + `connect_error`(token_expired) 시 1회 refresh 후 재연결(무한 루프 가드) |
| `frontend/src/hooks/useSessionLiveSocket.ts` | 신호 버퍼: cleanup 폐기 제거 → 세션 변경 시에만 폐기, 유형별 최신 1건 압축 |
| `backend/tests/test_sdd026_live_session_p0.py` | connect 거부 테스트를 `ConnectionRefusedError` 단언으로 갱신 |
| `frontend/tests/session-live-signal-connection.test.ts` | 유형별 flush(3종)·동일 유형 압축(1건) 시나리오로 갱신 + 신규 테스트 1건 |

## Test Results
- ✅ TS1(토큰 refresh 시 소켓 유지): `getSessionLiveSocket`이 토큰 변경 시 disconnect 없이 `socket.auth`만 갱신 (정적 확인)
- ✅ TS2(connect_error → refresh → 재연결): `connect_error` 핸들러가 `token_expired` 시 1회 `refreshAccessToken` 후 auth 갱신+connect, 실패 시 재시도 중단
- ✅ TS3(WS 핸들러 비블로킹): 6개 동기 DB 호출 `asyncio.to_thread` 경유 확인
- ✅ TS4(신호 버퍼 유실·중복 없음): cleanup 폐기 제거 + 세션 변경 시에만 폐기 + 유형별 압축
- ✅ `npm run build` 0 errors (7.49s)
- ✅ frontend vitest **255 passed** (신호 관련 30; 9개 `.cjs`는 Playwright 스펙, 무관)
- ✅ backend pytest **981 passed, 12 skipped**

## Debugging Journey
- `test_01_connect_잘못된_토큰_연결거부`가 `return False` 단언이라 실패 → `ConnectionRefusedError("token_expired")` 단언으로 갱신.
- `session-live-signal-connection.test.ts`의 "일괄 flush 2회" 단언이 유형 압축(중복 제거)과 충돌 → 3종 flush + 동일 유형 압축(1건) 시나리오로 재작성.
- `asyncio.to_thread` 도입 시 테스트 `_open_db` monkeypatch가 스레드 안전한지 우려 → 세션은 `_open_db` 호출 시마다 새로 생성되므로 스레드 내에서만 사용되어 안전(981 passed로 검증).

## Notes for Reviewer
- **flapping 근본 원인 3개 중 2개(토큰 싱글톤 교체·이벤트 루프 블로킹) 해소 + 재연결 실패 처리 추가**. join/leave 소유권 단일화·feature_ack 멱등 키는 후속 SDD로 남김(Out-of-scope).
- `connect_error`의 `err.message === "token_expired"`는 서버의 `ConnectionRefusedError("token_expired")`와 1:1 대응(socket.io가 reason을 `err.message`로 전달).
- 연결 안정성은 BE/FE WS 계약이 얽혀 있어 단일 에이전트 순차 구현으로 진행(멀티에이전트 병렬의 계약 불일치 위험 회피).
