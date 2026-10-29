# summary — 실시간 v2 feature 15종 누락 복구
## 원인
SDD-246 v2 MetricSet 이 10종만 정의 → 계약·서버 `METRIC_UNITS`·`_feature_item`·feature-v1 산출물(코어 프레임 직렬화) 전부 10종. 엔진 내부 값(밴드·지수·HRV·motion)은 이미 있었으나 프레임에 실리지 않았다.
## 항목별 출처 (plan.md 표 참조)
- 밴드 5종·total_power(5밴드 합)·stress·cognitive_load·faa·hemispheric_balance: `eeg::analyze` (v1 BasicSignalProcessor 포팅본, 동일 정의)
- rmssd·lf·hf·lf_hf_ratio: `HrvSnapshot`(PPG), motion: ACC 강도/100(0~1)
- meditation_level=relaxation_raw, attention_level=focus_raw: v1 관례, 서버가 채움(새 wire 키 없음)
## 변경
- `packages/measurement-core/src/engine.rs`: MetricSet +15, LatestEeg 확장(serde default → 구 체크포인트 복원 호환), last_valid 25칸, 값 없음은 null+사유(`faa_unavailable` 등).
- `contracts/session-live-v2/schema/common.schema.json`: 선택 필드 15 + 단위 `power_raw` 추가. fixture valid/invalid 각 1.
- 백엔드 `session_live_ingest.py`(METRIC_UNITS), `live_ingest_service.py`(_feature_item).
- `frontend/src/lib/measurement-web/wasm/` 재생성.
- Android `CoreBridgeTest.kt` hash 기대값 갱신(첫 727049b5…, 마지막 9ff5803c…).
## 하위호환
서버 파서는 `metrics 키 ⊆ METRIC_UNITS` → 구 10종 메시지 그대로 수락, 신규 컬럼 NULL. 알 수 없는 키·단위 불일치는 여전히 거절. 과거 데이터 백필 없음.
## 앱 재빌드
Android(.so)·iOS(xcframework)는 같은 Rust 코어를 쓰므로 **재빌드·재심사 필요**(이번에 빌드·업로드 안 함). Kotlin/Swift 소스는 metrics 통째 전달이라 변경 없음. 재빌드 전까지 앱 경로(구 앱)는 10종만 저장, 웹(WASM) 경로는 배포 즉시 15종.
## 시험
cargo test 전부 통과(신규 `extended_feature_metrics_are_emitted_with_v1_units`: total=5밴드합·stress·cognitive_load·focus 독립식 대조), verify-wasm 149프레임 네이티브=WASM 동일, check-contracts 1~4단계 통과(5단계 manifest 는 develop 기준선부터 실패 — 본 변경 무관), pytest 전체 4759 통과·516 skip(신규 7 + PG 통합 1 포함), vitest 17fail/8파일 기준선 동일, tsc -b 통과.
## 알려진 사항
- 로컬 backend venv 에 jsonschema 없음 → sdd246 PG 테스트 4건이 기준선부터 실패(환경 문제, 임시 설치 시 통과).
- 확장 feature 의 reason 은 가드 기록 모드에서 EEG 지표에 한해 부여.
