# FIX — 이완도를 하루명상 '두뇌 휴식'으로 계산

## 배경
이완도 α/(α+β)와 정서 안정 (α+θ)/γ 가 dev 실측 상관 0.92~0.95로 거의 같이 움직인다. 대표 지시: 이완도를 하루명상의 '두뇌 휴식'(totalNeuralActivity 반전 점수)으로 계산.

## 새 정의
- raw: `total_neural_activity` = (ch1Total+ch2Total)/2 (Rust `dsp/eeg.rs`·웹 `EEGSignalProcessor` 동일 식 확인).
- 표시: 활성 표준 모델 `totalNeuralActivity` params(m,s) + **direction 강제 -1** → sigmoidScore (신경 활동↓ = 휴식↑).
- 모델 없음/params 없음: 하루명상처럼 **null(pending)**. 0 표시 금지. Rust: `invalid / model_unavailable`.

## 결정
1. `relaxation_raw`는 **그대로 α/(α+β)** (서버 저장·backend eeg_metrics·리포트 의미 불변, 하위호환). display 만 변경.
2. 코호트 폴백 차이: 기존 웹은 모델이 없으면 코호트 B0(α/(α+β) 사다리꼴)로 폴백했다. 새 규칙은 하루명상과 같이 null. 이유: 코호트 상수는 다른 정의(α/β 비율)라 섞으면 사용자가 두 정의를 번갈아 보게 된다. 단 dev/prod 활성 모델(v7)이 있어 실제 영향은 모델 조회 전 짧은 구간.
3. Rust `ScoreSet`에 `brain_rest: Option<f64>` 추가(기존 `relaxation` 필드는 α/(α+β) 점수로 유지 — 골든 기존 값 보존). 엔진 `relaxation_display` = LegacyCohort → invalid/model_unavailable, ActiveSigmoid → model.brain_rest(없으면 invalid/model_unavailable).
4. 웹 `scoreIndices`: `totalNeuralActivity`가 입력에 있으면 위 규칙(`relaxationIndex: number | null`). 입력에 TNA 가 **없는** 호출(서버가 내려준 α/(α+β) 비율만 있는 원격 경로)은 두뇌 휴식 계산 불가 → 기존 α/(α+β) 점수 유지(잔여 위험으로 기록).

## 영향 목록 (grep)
- 로컬 측정: `useBand.toScoredIndices`(scoredIndices.relaxationIndex) → MemberClassContainer 실시간 이완도, PlaygroundMeditationPanel/PlaygroundPage.
- 원격/서버 raw 경로(기존 유지): useBand echo(`efficiencyFromEvent`), MemberClassContainer `handleEegFeature`, ClassPlayerPage `scoreEfficiency`, group-average(그룹 평균). → 후속: 서버가 두뇌 휴식 raw(또는 TNA)를 내려줘야 상담사·그룹 화면도 동일 정의.
- 네이티브(Android/iOS): 같은 Rust 코어 → 자동 반영.
- 라벨 '이완도' 유지.

## 골든
`frontend/src/lib/eeg` 변경은 manifest 소스 해시를 깨뜨리고 oracle active_sigmoid.relaxationIndex 기대값이 바뀐다. 근거: 의도된 정의 변경. oracle expected 의 relaxationIndex 갱신은 `ORACLE_WRITE=1` + build_manifest 로만(감독 승인 항목으로 보고). 합성 pinned model 에는 totalNeuralActivity(m 5.0,s 2.0,dir 1)가 있어 dir -1 강제 값이 산출된다.

## 작업
T1 Rust RED→GREEN(score.rs, engine.rs, golden_oracle.rs) / T2 웹 RED→GREEN(eegPersonalScore.ts, 호출처 null 처리) / T3 골든 갱신 / T4 cargo·vitest·tsc·gradle.

## 구현 중 추가 결정
- 백엔드: `normalization_score.brain_rest_score(tna, params)` 신설(TNA params + direction -1 강제, 없으면 None). `eeg_metrics.compute_session_metrics` 의 `relaxation_score`(세션 이완 점수)와 `report_task` timeline `relaxation` 이 같은 함수 사용 → 화면·리포트 일치. `relaxation_index_mean` raw 는 α/(α+β) 그대로. 모델 없으면 None(코호트 폴백 제거). 종합점수 가중합은 None 지표 제외 처리(기존 동작).
- 웹: `useBand` 에 `BandScoredIndices`(relaxationIndex: number|null) 도입, null 이면 차트 점 추가 안 함. Playground Metrics/Trend 패널 타입만 null 허용.
- contracts(최소 변경): scoring.oracle.test.ts 의 이완도 기대식을 두뇌 휴식으로 교체, `ORACLE_WRITE=1`(oracle·legacy_fallback) + build_manifest 로 display/summary/manifest 재생성. Rust tests/golden_oracle.rs 는 relaxation 표시를 `brain_rest`(Option) 기준으로 비교.
