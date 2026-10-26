# summary — 리포트 이완도 TNA 수집
## 원인
v2 실시간 경로가 TNA 를 저장하지 않아 eeg_feature_windows.total_neural_activity=null. 클래스 통계는 α/(α+β) 정규화 그대로(감정안정도와 상관 0.94~0.99).
## 선택
측정 이벤트에 선택 필드 `metrics.tna_raw`(index_raw) 추가 → 서버 저장 → 활성 모델로 brain_rest_score. (display 값 저장안은 모델버전 종속·raw 저장 원칙 위반으로 기각)
## 변경
- Rust engine.rs: MetricSet.tna_raw, LatestEeg.tna, last_valid 10칸. 웹 envelope 은 metrics 통째 전달 → 코드 변경 없음, wasm 재생성(`bash frontend/scripts/build-measurement-wasm.sh`).
- 계약 common.schema.json tna_raw 선택 필드, 백엔드 METRIC_UNITS, live_ingest_service._feature_item → total_neural_activity.
- class_report_stats_service: relaxation = brain_rest_score(TNA, 활성모델), 없으면 None.
- 서버 이완 경로 목록: report_task timeline(기처리)·eeg_metrics 세션점수(기처리)·class_report_stats(이번)·session_service 실시간 relaxation_index(raw, 상담사 화면은 LiveState relaxation_display 사용=이미 일치)·group_aggregate(baseline 대비 상대 델타, raw α/(α+β) — 범위 외, 별도 정의).
- 테스트 헬퍼 add_windows 기본 TNA·활성모델 주입, CoreBridgeTest hash 2건 갱신(첫 프레임 640c1c46…, 마지막 35c98f8a…; cargo example replay 재측정).
## 시험
cargo test 전부 통과, check-contracts 통과(manifest 변경 없음), backend 4644 pass(+기존 3건 헬퍼 수정 후 169 관련 통과), vitest 17 fail/8파일 기준선 동일, tsc -b 통과, gradle testDevDebugUnitTest 통과.
