# SDD-316 — Plan
1. 코어(`packages/measurement-core`)
   - `dsp/hrv.rs`: `HrvState::reset_for_not_worn()` (motion 유지, 사유 `not_worn`).
   - `engine.rs`: `WearState`(worn, low_run, high_run) 를 `CoreState` 에 `#[serde(default)]` 로 추가; PPG push 시 샘플 단위 갱신; 진입/복귀 시 HRV·PPG 링 비움; `run_ppg` 에서 not_worn 이면 분석 생략·`LatestPpg.not_worn=true`; `emit_frame` 의 `ppg_gate` 에서 not_worn → `("invalid","not_worn")`.
   - 임계 상수는 `WEAR_*` 로 명명, 문서 주석에 근거 기재.
2. 시험
   - `tests/sdd316_not_worn.rs`: 합성(착용→미착용→착용), 버퍼 비움·오염 없음, 히스테리시스·유예, 중간 구간 유지, 초기 상태.
   - `examples/replay_ppg_raw.rs` 에 not_worn 사유 열 출력, 두 회차 구간별 전후 표.
   - 기존 cargo 전체, golden 회귀.
3. 화면: 프레임 reason 이 `not_worn` 인 경로(라이브 어댑터→MemberSheets 호흡·HRV 칸 문구)를 최소 수정, vitest 추가.
4. WASM 재생성 가능 시 `frontend/src/lib/measurement-web/wasm` 갱신(불가 시 summary 에 명시).

5. (범위 추가) hrv.rs·AnalysisMetricsService.ts 에 B 재시드, 합성 시험 코어 4건·웹 4건, 웹↔코어 창별 일치 하니스(`examples/replay_hrv_csv.rs` ↔ node 번들).
6. 화면: `live-metric-snapshot.ts liveNotWorn`, MemberClassContainer→View→Stage/Sheets 에 notWorn 전달.
