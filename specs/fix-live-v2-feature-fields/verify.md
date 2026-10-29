# verify — 구현 전 QA 체크리스트

## 기능
- [ ] V1 Rust: 정상 EEG+PPG+ACC 입력 시 프레임 metrics 에 신규 15키가 모두 존재, 값 있는 항목은 validity=valid, 단위 일치.
- [ ] V2 Rust: total_power == 5밴드 합 == bands 값과 일치(독립 계산 대조), stress/cognitive_load/hb/faa 가 `eeg::analyze` Indices 와 동일.
- [ ] V3 Rust: faa None·HRV 미준비·ACC 없음 → value=null + validity/reason(0 치환 없음).
- [ ] V4 Rust: 체크포인트 왕복(restore) 동작, 구 체크포인트(신규 필드 없음)도 복원(serde default).
- [ ] V5 계약: 신규 15키 포함 메시지·구 10종 메시지 둘 다 schema 통과, 알 수 없는 키·잘못된 단위는 거절.
- [ ] V6 서버 저장: 15종 포함 MetricWindow → eeg_feature_windows 15컬럼(+meditation_level=relaxation_raw, attention_level=focus_raw) 저장 확인.
- [ ] V7 서버 하위호환: 구 10종 메시지 수락·저장(신규 컬럼 NULL), 단위 불일치·알 수 없는 키는 여전히 거절.
- [ ] V8 invalid/warming_up 신규 지표는 NULL 저장.
- [ ] V9 WASM: verify-wasm(네이티브 replay 와 wasm 출력 동일), 재생성 산출물이 새 키 포함(`strings` 확인).
- [ ] V10 feature-v1: replay 프레임 JSON 에 신규 키 포함(= ndjson 산출물 포함).

## 회귀
- [ ] cargo test(전체), check-contracts, backend pytest(라이브·feature·tna 관련 + 전체), vitest(기준선 17 fail/8파일 동일), tsc -b.
- [ ] CoreBridgeTest hash 기대값 갱신(replay 재측정), gradle 가능 시 실행.

## 범위 확인
- [ ] 백필 코드 없음, DB 쓰기 없음, 앱 빌드·업로드 없음.
