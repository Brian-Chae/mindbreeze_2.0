# [SDD-122] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 밴드 미착용(not_measured) — 무회귀
1. EEGFeatureWindow 0개 + consent_eeg=false 세션으로 리포트 생성.
2. `content.eeg.status == "not_measured"`, `measurement_intent == "no"`, `data_credibility == None`.
- **Expected:** 기존과 동일 — 프론트 EEG 섹션 숨김 유지.

### TS2: 밴드 착용·정상(valid) — 무회귀
1. valid 윈도우 N개 세션. `content.eeg.status == "valid"`, `coverage_ratio > 0`.
- **Expected:** `data_credibility == "high"`, 기존 7지표·타임라인·narrative 그대로.

### TS3: 전 구간 유실(lost)
1. consent_eeg=true + 윈도우 0개 세션.
2. `content.eeg.status == "lost"`, `measurement_intent == "yes"`, `loss_reason == "band_disconnect"`, `coverage_ratio == 0`.
- **Expected:** `data_credibility == "very_low"`. 프론트가 "유실 배너" 표시(숨김 아님).

### TS4: 부분 측정 + 커버리지 < 50% (B2)
1. 유효 윈도우가 세션 절반 미만(예: 2분/4.3분). `coverage_ratio < 0.5`.
- **Expected:** `data_credibility == "very_low"`(또는 low). 프론트 "참고용" + "신뢰도 매우 낮음" 고지.

### TS5: client 뷰 차등(A1)
1. lost 상태 client 리포트.
- **Expected:** 차분한 문구("측정을 시작했지만 연결이 끊겨..."), 기술 용어(사유 코드·커버리지 수치) 비노출.

### TS6: counselor 뷰 관리 정보
1. lost/부분측정 counselor 리포트.
- **Expected:** 사유 칩("연결 끊김") + 커버리지 수치("47%") + 신뢰도 뱃지 노출.

## Edge Cases
- [ ] `session.started_at`/`ended_at` None → coverage_ratio 근사(윈도우 수 기반) 폴백, None 반환 금지 크래시.
- [ ] `participant_id=None`(counselor)에서 consent_eeg 조회 — 그룹 세션 다수 참가자 처리(any consent).
- [ ] `data_credibility="very_low"` 신규 값이 목록/필터/기존 UI에서 오류 없이 표시되는지.
- [ ] `loss_reason`이 없는 정상 케이스(valid/degraded) → null 유지(불필요한 사유 칩 미표시).
- [ ] `_build_eeg_content` 예외 경로(지표 산출 실패) — 기존 `not_measured` 폴백 유지.

## Security Review
- [ ] consent_eeg/participant 조회 시 권한·소속 검증 회귀 없음(기존 query 경로 재사용).
- [ ] 유실 메타가 content JSONB에만 저장 — PII/원시 데이터 노출 없음.

## 회귀 확인
- [ ] `pytest` 전체(기존 985+ 통과 유지).
- [ ] `npm run build` 0 errors.
- [ ] 기존 `not_measured` 숨김 동작 무회귀(TS1).
