# plan — 리포트 이완도 TNA 수집 (fix/relax-tna-ingest)
## 원인
v2 실시간 경로(live_ingest_service._feature_item)가 TNA 를 저장하지 않아 eeg_feature_windows.total_neural_activity 가 null.
report_task 는 brain_rest_score(TNA) 로 바뀌었으나 입력이 없고, 클래스 통계는 α/(α+β)(≈감정안정도와 상관 0.94~0.99) 그대로.
## 방식 비교
- A(선택) 측정 이벤트에 `tna_raw`(index_raw, 선택 필드) 추가 → 서버가 total_neural_activity 로 저장 → 리포트가 활성 모델로 brain_rest_score.
  근거: 기존 원칙 "raw 저장, display 는 raw+모델에서 재계산"과 일치. 모델 버전이 바뀌어도 재계산 가능. 화면 이완도(=Rust brain_rest)와 동일 정의·동일 모델 파라미터.
- B relaxation_display 를 서버가 저장: 단순하지만 display 는 클라이언트 모델 버전에 종속, 저장 컬럼/원칙 위반, 리포트 모델 교체 불가. 기각.
## 변경
1. Rust: LatestEeg.tna, MetricSet.tna_raw(slot 9, last_valid 10칸). 구 클라는 미전송 → 서버 선택 필드.
2. 계약 session-live-v2 common.schema MetricSet.tna_raw 선택 추가, 백엔드 수신 METRIC_UNITS 추가(누락 허용 이미 `<=`).
3. live_ingest_service._feature_item: total_neural_activity=v("tna_raw").
4. 서버 이완 점수 경로 통일(목록):
   - report_task.py:333 timeline (이미 brain_rest) ✔
   - eeg_metrics.py:455 세션 relaxation_score (이미 brain_rest) ✔
   - class_report_stats_service.py:411 → brain_rest_score(TNA, 모델), 모델/TNA 없으면 None
   - session_service.py:2464,3405,3432 (상담사 실시간 current/avg_relaxation = relaxation_index raw) → 확인 후 보고(화면 표시용 raw; 상담사 화면은 LiveState relaxation_display 사용 여부 확인)
   - group_aggregate.py:181,193,391 상대 델타(raw α/(α+β) 기반 baseline 대비) → 별도 정의, 이번 범위 외 보고
5. 웹 wasm 재생성(frontend/scripts/build-measurement-wasm.sh), 웹 envelope 은 metrics 를 통째로 전달하므로 코드 변경 불필요(확인).
6. Rust 변경 → 골든 manifest·CoreBridgeTest replay hash 재측정.
## 하위호환/구 세션
TNA 없는 구 세션은 null(0 금지). 기존 리포트 재계산 안 함.
