# [SDD-112] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `frontend/src/lib/socket.ts` | `transports: ['websocket', 'polling']` → `['websocket']` (`/chat`과 대칭) |
| `frontend/src/hooks/useBand.ts` | `retransmitInFlightRef` in-flight 가드 + `RETRANSMIT_BATCH_MAX=60` 배치 상한 |

## Why
- polling은 sticky session 없이 멀티워커에서 깨짐(disconnect 루프 위험). websocket 단일화로 대칭·견고화.
- `retransmitPending`(5초 타이머·재연결)에 동시실행 가드·배치 상한 없음 → 동시 중복 post·거대 단일 요청 위험.

## Verification
- `npm run build` 통과(tsc 오류 없음).
- frontend vitest **255 passed**(기존 9개 `.cjs` 파일은 vitest 비호환 — 선존재, 무관).

## Deploy
- develop push → Deploy Dev. FE 번들만.
