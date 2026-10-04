# [SDD-110] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `frontend/src/lib/socket.ts` | module-level join 상태(`liveCurrentSession`) + `joined` 스냅샷 캐시(`liveSnapshotCache`) 도입 |

## 구현 상세
1. `joinSessionLive` **dedup** — 이미 같은 세션에 join된 상태면 재emit skip (재연결 join N회 → 1회).
2. `leaveSessionLive` — join 상태·스냅샷 캐시 클리어(다음 세션 join 정상 emit).
3. `getSessionLiveSocket` `disconnect` 핸들러 — join 상태 클리어(재연결 join이 dedup에 막히지 않게).
4. `joined` module 리스너 — 스냅샷 캐시, `subscribeSessionLiveJoined`가 후발 구독자에게 즉시 1회 재배달.

## Verification
- frontend vitest **255 passed** (기존 9개 `.cjs` 파일은 vitest 비호환 — 선존재, 무관).
- `npm run build` 통과(tsc 오류 없음, `liveCurrentParticipantId` 미사용 변수 제거 후).

## Deploy
- develop push → Deploy Dev. FE 번들만(백엔드·마이그레이션 없음).
