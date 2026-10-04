# [SDD-116] — Summary

## What Was Built
`frontend/src/hooks/useBand.ts` 단일 파일:

| 변경 | 설명 |
|------|------|
| `EEG_OFFSET_BASE_KEY` + `eegOffsetBaseKey()` | localStorage base 키 헬퍼 |
| `baseOffsetRef` | 첫 샘플 wall-clock base 캐시 |
| `ingestMetrics` offset 교체 | `secondOffsetRef.current++` → `max(floor((now-base)/1000), lastOffset)` + `secondOffsetRef = offset + 1` |

## Result
- **remount 충돌 제거**: base를 localStorage에서 복원 → 새로고침 후 window_index가 0으로 재시작하지 않음.
- **단조 증가 유지**: `max(elapsed, lastOffset)` 가드로 같은 초 내 중복 샘플 드롭 없음.
- 다중 탭(실제 BLE 단일연결이라 이론상)도 동일 base → 동일 데이터로 멱등 처리.

## Verification
- `npm run build` exit 0.
- `npx vitest run` 263 passed.

## Deploy
- push 후 dev 배포, health 200 확인.
