# [SDD-130] — Summary

## What Was Built
| 파일 | 변경 |
|------|------|
| `frontend/src/components/class/ClassWaitingRoom.tsx` | `lastMeterSetRef` 추가 + 미터 `setMicLevel` 10Hz throttle(초당 60회→10회) + `recheckingPrep` 시 "대기 화면으로" 복귀 버튼 |

## Test Results
- ✅ `npm run build` — 0 errors (8.32s)

## Notes for Reviewer
- **①-1 근본 원인**: `recheckingPrep`이 `WaitingForStart` 진입 조건의 부정(`!recheckingPrep`)이라, 한번 true가 되면 복귀 경로가 전무했음 → 명시적 복귀 버튼으로 해소.
- **①-13**: 미터를 별도 컴포넌트로 분리하는 정석 해결 대신, 실용적 10Hz 하향으로 리렌더 비용을 6배 절감(접근성 낭독 이슈 ①-15/②-6도 함께 완화).
