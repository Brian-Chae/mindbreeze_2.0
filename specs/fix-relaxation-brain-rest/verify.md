# verify (구현 전)
- V1 Rust: model(TNA m=2.3252,s=2.3342)에서 brain_rest = sigmoidScore(dir -1). TNA 높을수록 점수↓.
- V2 Rust: LegacyCohort → relaxation_display value=None, validity=invalid, reason=model_unavailable (0 아님).
- V3 Rust: ActiveSigmoid 모델에 TNA params 없음 → invalid/model_unavailable.
- V4 relaxation_raw 값은 변경 전과 동일(α/(α+β)).
- V5 웹: scoreIndices(idx with TNA, model) = Rust 와 동일 수치; 모델 null → relaxationIndex null.
- V6 웹: TNA 없는 입력(원격 raw) → 기존 α/(α+β) 점수 유지.
- V7 cargo test, vitest 기준선(17 fail/8파일) 외 신규 실패 0, tsc -b, gradle testDevDebugUnitTest 통과.
- V8 골든 oracle 기대값 변경 근거 기록.
