# verify (구현 전)
- V1 Rust: 프레임 metrics.tna_raw 존재, unit index_raw, 값=ix.total_neural_activity, 워밍업/무접촉 시 null+validity.
- V2 계약 스키마: tna_raw 포함/미포함 이벤트 모두 통과.
- V3 백엔드 파서: tna_raw 수락, 단위 불일치 거부, 미전송(구 클라) 수락.
- V4 _feature_item: tna_raw valid → total_neural_activity 저장, 없으면 None.
- V5 클래스 통계: relaxation_index 가 brain_rest_score(TNA) 값, TNA 없으면 None(0 아님).
- V6 report_task timeline relaxation 이 저장 TNA 로 계산(통합 확인).
- V7 cargo test, contracts/check-contracts.sh, backend pytest, vitest 기준선 외 신규 실패 0, tsc -b, gradle testDevDebugUnitTest.
- V8 wasm 재생성, 골든/리플레이 hash 변경 근거 기록.
