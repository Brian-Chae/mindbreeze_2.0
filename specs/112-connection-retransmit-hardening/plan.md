# [SDD-112] — Implementation Plan

> FE 2파일. Stage ③ Verify 후 구현.

## 변경
| File | 변경 |
|------|------|
| `frontend/src/lib/socket.ts` | `transports: ['websocket', 'polling']` → `['websocket']` |
| `frontend/src/hooks/useBand.ts` | `retransmitInFlightRef` 가드 + `RETRANSMIT_BATCH_MAX=60` 배치 상한 |

## 아키텍처
- ② `retransmitPending` 앞부분에 in-flight 가드, `finally`에서 해제. 5초 타이머·재연결 중복 호출은 가드에 걸려 1회만 진행.
- 배치 상한 `slice(0, 60)` — 남은 항목은 다음 5초 주기에서 drain. removeAckedFeature도 `chunk`만큼만 제거.

## 배포
- develop push → Deploy Dev. FE 번들만(백엔드·마이그레이션 없음).
