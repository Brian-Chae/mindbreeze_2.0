# 요약 — 이완도 = 하루명상 '두뇌 휴식'

## 정의
이완도(표시) = sigmoid(TNA; 활성 표준 모델 totalNeuralActivity m,s, **direction -1 강제**). TNA=(ch1Total+ch2Total)/2. 모델/params 없음 → null(pending, 0 아님; Rust invalid/model_unavailable). `relaxation_raw`·`relaxation_index_mean` 은 α/(α+β) 유지(하위호환).

## 변경
- Rust: score.rs `brain_rest`/`ScoreSet.brain_rest`, engine.rs `relaxation_display`.
- 웹: eegPersonalScore.ts `scoreIndices`(TNA 있으면 두뇌 휴식, `relaxationIndex: number|null`), useBand.ts·MetricsPanel·TrendPanel null 처리.
- 백엔드: normalization_score.py `brain_rest_score`, eeg_metrics.py relaxation_score, report_task.py timeline relaxation.
- 계약/골든: oracle·legacy_fallback display/summary/manifest 재생성(의도된 정의 변경), scoring.oracle.test.ts·golden_oracle.rs 기대식 갱신.
- 테스트: frontend/tests/fix-relaxation-brain-rest.test.ts, backend test_eeg_metrics·test_normalization_score 갱신.

## 잔여 위험
- 원격 경로(서버가 내려주는 α/(α+β) 비율만 있는 상담사 화면·ClassPlayerPage·group-average)는 TNA 가 없어 기존 점수 유지 → 서버가 두뇌 휴식 점수(또는 TNA)를 내려주는 후속 필요.
- 모델 로드 전 짧은 구간 이완도 pending(null).
