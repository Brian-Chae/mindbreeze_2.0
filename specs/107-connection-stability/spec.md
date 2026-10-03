# [SDD-107] 연결 안정성 개선 — 싱글톤 수명주기·이벤트 루프 블로킹·재연결 실패 처리

## Goal
"잘 따라가요" 무음 시그널 실패와 EEG "왔다갔다 끊김"의 근본 원인인 연결 단절(flapping)을 해소한다.

## Context
- 2026-10-03 Claude Code·Codex 심층 리뷰 결과, 기존 조치(신호 버퍼링 + 재연결 강화)는 증상 완화일 뿐이고 실제 단절 원인은 다음 3가지로 판명됨:
  1. **토큰 갱신 시 싱글톤 소켓 교체** — `getSessionLiveSocket(token)`이 토큰 값만으로 캐시를 판정해, refresh로 토큰이 바뀌는 순간 살아있는 소켓을 `disconnect()`하고 새로 만든다. 기존 훅들은 죽은 소켓 객체에 리스너를 붙인 채 고아가 된다.
  2. **서버 이벤트 루프 블로킹** — WS 핸들러가 async 함수 안에서 동기 DB I/O를 직접 호출 → 이벤트 루프 점유 → ping timeout → 전원 동시 재연결 → join 폭풍(양성 피드백).
  3. **`connect_error`/`reconnect_failed` 미처리** — 서버가 만료 토큰에 `return False`로 거부하면, 클라이언트는 `Infinity` 재시도가 전부 거부당하는 busy-loop(복구 불가, 사용자에겐 침묵).
- 원문: `~/.hermes/cache/scratch/result-conn.md`(Claude) · `result-stream.md`(Codex)

## Scope
### ✅ In-scope
- [BE] WS 핸들러 동기 DB I/O → `asyncio.to_thread` 격리 (feature 저장·join 해석·무음 시그널 해석)
- [BE] `ping_interval`/`ping_timeout` 명시 (interval의 2배로 관대하게)
- [BE] connect 거부 시 이유 구분 (`ConnectionRefusedError("token_expired")`)
- [FE] 토큰 갱신 시 소켓을 끊지 않는 싱글톤 재설계 (`auth`만 갱신)
- [FE] `connect_error`/`reconnect_failed` 처리 + 토큰 재발급 → 재연결 자동화
- [FE] 무음 시그널 버퍼 구멍 보완 (유형별 최신 1건 압축 + cleanup/join_denied 보존)

### ❌ Out-of-scope (후속 SDD)
- join/leave 소유권 단일화(세션별 참조 카운트) — 별도 FE 리팩토링
- feature_ack + 공통 멱등 키 — 데이터 정합성 개편
- `transports: ['websocket']`로 좁히기 — 배포/nginx 검토 필요
- Redis 매니저(멀티워커 확장)

## Acceptance Criteria
- [ ] 토큰 refresh 시 기존 소켓이 disconnect 되지 않고 auth만 갱신된다
- [ ] connect_error 발생 시 토큰 재발급 후 재연결이 자동화된다(무한 루프 가드 포함)
- [ ] WS 핸들러의 동기 DB 호출이 이벤트 루프 밖(to_thread)에서 실행된다
- [ ] 무음 시그널 버퍼가 리렌더(cleanup)에도 유실되지 않고 유형별 최신 1건만 유지된다
- [ ] `npm run build` 0 errors, `pytest` 전체 통과

## Dependencies
- SDD-105/106(무음 시그널·대기실) — 신호 버퍼링 기반 위에 보완
- 기존: `session_live_namespace.py` · `socket.ts` · `useSessionLiveSocket.ts`

## Risks
- 동기→비동기 전환 시 DB 세션 수명·트랜잭션 이슈 → `asyncio.to_thread`로 격리해 회피
- 싱글톤 auth 갱신이 기존 리스너와 호환 문제 → 재연결 시 auth 재적용 경로 보장
- connect_error 토큰 재발급이 무한 루프 → 1회 재시도 가드
