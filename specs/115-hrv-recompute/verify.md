# [SDD-115] — Verification

## Test Scenarios

### TS1: HRV 값 정상 범위
1. 세션 `05fbf8f7` PPG 데이터로 HRV(SDNN/RMSSD) 재산출.
- **Expected:** SDNN 20~50ms 내외, RMSSD 20~50ms 내외 (5~10배 과대 해소).

### TS2: 심박수 회귀 없음
1. 피크 검출 개선 후 심박수 재산출.
- **Expected:** 54~127 BPM 범위 유지 (기존 정상성).

### TS3: 30초 미만 null
1. 30초 미만 PPG 데이터.
- **Expected:** HRV 미산출(null), 프론트 결측 스킵.

## Edge Cases
- [ ] 피크 검출 시 연속 피크 간격 250ms 미만 무시
- [ ] 윈도우 경계에서의 NN 간격 처리
- [ ] null 보존 (0 치환 금지)

## Security Review
- [ ] 외부 입력 없음 (PPG 스트림 내부 처리)

## Build Gate
- [ ] `npx tsc -b --noEmit` 0 errors
- [ ] `npm run build` 성공
