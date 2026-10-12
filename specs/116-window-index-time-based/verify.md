# [SDD-116] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 단조 증가 (드롭 방지)
- 같은 초에 두 샘플 → 두 offset이 중복되지 않는다(`max(elapsed, lastOffset)` 가드).
- *검증*: `secondOffsetRef.current = offset + 1` 로직 확인.

### TS2: remount 충돌 방지
- base를 localStorage에서 복원 → remount 후 offset이 0부터 재시작하지 않는다.
- *검증*: `eegOffsetBaseKey` + `localStorage.getItem` 복원 경로 확인.

### TS3: 빌드·유닛
- `npm run build` exit 0, `npx vitest run` 255 passed.
