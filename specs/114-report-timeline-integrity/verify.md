# [SDD-114] — Verification

## Test Scenarios

### TS1: 시간축 정확성
1. 세션 `05fbf8f7` 리포트 `content.eeg.timeline[].t` 확인.
- **Expected:** 마지막 `t` ≈ 186.5초(3.1분), 최대 200초 이내. `min = t/60`이 실제 진행 시간과 일치.

### TS2: 감정안정도 실제값
1. timeline에 `emotional_stability` 존재, 프론트 `metricValue`가 `point.emotional_stability` 사용.
- **Expected:** 0~100 범위, 음수 없음. `100-stress` 프록시 미사용(코드 확인).

### TS3: 마음 지표 정규화
1. 집중도·이완도·감정안정도 3종 0~100 스케일.
- **Expected:** 세 지표 모두 0~100, `toDisplayScale` 이중 적용 없음.

## Edge Cases
- [ ] `device_timestamp_ms` null → `t` null 보존, 프론트 결측 스킵
- [ ] `emotional_stability` null → 결측 유지 (0 치환 금지)
- [ ] `relaxation_index` 0~1 값이 정규화 후 0~100으로 단일화

## Security Review
- [ ] 외부 입력 없음 (내부 DB 집계만, 주입 경로 없음)
- [ ] 리포트 content JSON에 비밀정보 없음

## Build Gate
- [ ] `pytest -k report` 통과
- [ ] `npx tsc -b --noEmit` 0 errors
- [ ] `npm run build` 성공
