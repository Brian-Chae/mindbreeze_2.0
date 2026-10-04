# [SDD-116] — Implementation Plan

> FE 1파일. Stage ③ Verify 후 구현.

## 변경
| File | 변경 |
|------|------|
| `frontend/src/hooks/useBand.ts` | ① `EEG_OFFSET_BASE_KEY`·`eegOffsetBaseKey()` 헬퍼 ② `baseOffsetRef` ref ③ `ingestMetrics` offset을 경과시간 기반으로 교체 |

## Task
1. 상단 상수에 base 키 prefix + `eegOffsetBaseKey()` 추가.
2. `secondOffsetRef` 옆에 `baseOffsetRef` 추가.
3. `ingestMetrics`의 `offset = secondOffsetRef.current++` → 경과시간 기반 계산으로 교체.
4. `npm run build` + `npx vitest run` 통과 확인.

## Rollback
`offset` 계산을 `secondOffsetRef.current++`로 되돌리면 이전 동작 복원.
