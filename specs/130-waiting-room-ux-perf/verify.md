# [SDD-130] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: 대기 복귀
1. 대기 화면에서 [준비 다시 확인] 클릭 → 3단계 준비 화면.
- **Expected:** "대기 화면으로" 버튼이 표시되고, 클릭 시 대기 화면 복귀.

### TS2: 미터 리렌더 하향
1. 마이크 켜고 대기.
- **Expected:** `setMicLevel` 호출이 초당 60회 → 10회로 감소.

### TS3: 빌드
1. `npm run build`.
- **Expected:** 0 errors.
