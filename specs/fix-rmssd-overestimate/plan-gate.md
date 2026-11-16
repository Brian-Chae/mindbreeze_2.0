# plan-gate — 재산출 도구 착용·맥박 게이트 (11/16)

근거: `dev-recompute-findings.md`. 라이브 엔진은 건드리지 않는다.

## 설계
1. `examples/recompute_ppg_hrv.rs`
   - 착용 상태머신 `WearState`를 예제 안에 복제(엔진의 것은 비공개). 상수 `WEAR_OFF_IR=100_000`, `WEAR_ON_IR=500_000`, `WEAR_HOLD_SAMPLES=150`은 `engine.rs:373~377`과 반드시 동일(주석에 명시). 전환 시 링 clear + `HrvState::reset_for_not_worn`, 미착용 샘플은 링에 넣지 않음, 틱(50샘플마다)은 라이브처럼 계속 나가되 미착용이면 빈 값.
   - 맥박 품질 게이트 `pulse_gate_pass`: 링이 500샘플(10초) 차고, IR 1~5Hz 영위상 필터 표준편차 ≥ `PULSE_AC_MIN_SD`(6.0 카운트; 근거: 관측 잡음 최대 3.0 / 실제 최소 9.6) 이고, 유효 RR 비율 ≥ `VALID_RR_MIN_RATIO`(0.5)일 때만 값 출력. 유효 RR = 중앙값 ±25% 이내 RR, 분모 = analyze가 낸 RR 수(3개 미만이면 탈락).
   - HRV 상태는 게이트와 무관하게 계속 갱신(연속성), 출력만 비운다.
2. `hrv_recompute_service.py::plan_participant`: 엔진 틱 중 값(rmssd/sdnn)이 하나라도 있는 틱 비율을 게이트 통과율로 보고, 전체 틱 대비 10% 미만이면 참가자 미변경(빈 계획) + `participants_gated_out` 집계. 새 값 null이면 기존 값 유지(현행).
3. `scripts/recompute_ppg_hrv.py`는 요약 출력에 필드가 자동 포함되므로 docstring 설명만 보강.

## 위험
- 임계 6은 `c44cb210`(교류 9.6) 근처에서 민감 — 튜닝 가능하도록 상수 한 곳.

## 라이브 제안 (적용 안 함 — 별도 SDD·승인 필요)
문제: 라이브 착용 판정(`packages/measurement-core/src/engine.rs:371~372`, `WearState::update` 387~413)은 DC<10만 미착용 / ≥50만 착용 / 사이는 직전 상태 유지, 초기 상태 "착용"이다. 밴드를 책상에 둔 DC 31만~88만·교류 SD 1~3 잡음이 초기 "착용"을 유지한 채(또는 ≥50만 구간에서 복귀) 통과해 RMSSD가 65~70 근방으로 저장된다.

수정안(택일/병행):
1. **맥박 게이트를 라이브에도** — `engine.rs` `run_ppg`(약 660~700줄 부근, 착용 분기 뒤)에서 링이 가득 찬 뒤 `ppg::analyze` 결과로 재산출 예제의 `pulse_gate_pass`(교류 SD ≥ 6, 유효 RR ≥ 50%)를 적용, 탈락이면 PPG 지표를 invalid(null)+`not_worn` 같은 사유(예: `no_pulse`)로 낸다. 가장 직접적이고 DC 규칙은 건드리지 않는다. 판정 함수는 `src/dsp/ppg.rs`로 옮겨 예제와 공유.
2. **DC 규칙 보강** — 초기 상태를 "미착용"으로 바꾸고 착용 진입에 DC≥50만 **그리고** 교류 SD≥6을 요구. 초기 지연(진입 3초+링 10초)이 생기고 기존 `sdd316_not_worn.rs` 시나리오가 바뀐다.

앱 재빌드: `measurement-core`는 웹(WASM)·네이티브(FFI) 공용이라 **웹 WASM 재빌드 + iOS/Android 앱 재빌드·재배포 필요**. 서버(재산출)는 영향 없음.

예상 부작용:
- 임계 6 근처(약한 맥박, 예 c44cb210 교류 9.6)에서 값이 간헐적으로 비어 보일 수 있음 → 리포트 "측정 유효 분"이 줄어듦(SDD-327 구간 분할 영향).
- 골든·패리티 테스트(sdd314_hrv_gates, sdd316_not_worn, golden_oracle) 기대값 갱신 필요 — TS 하니스와의 수치 동일성(HARU 이식) 유지하려면 TS쪽도 같은 게이트를 넣어야 함.
- 이미 저장된 잡음 값은 소급 정리 안 됨(null 처리는 별도 대표 승인).
