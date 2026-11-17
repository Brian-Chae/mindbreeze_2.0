# plan — 실시간 착용 판정 강화 + 전송·연결 불변식 (11/16, 대표 승인)

브랜치 `fix/live-wear-gate`. 참고: `recompute-plan-gate-ref.md`(라이브 제안 1안), `dev-recompute-findings-ref.md`.

## 1단계 — 착용 상태를 읽는 모든 곳 (조사 결과)

"착용 상태"는 두 가지가 섞여 있다. **(A) 코어 PPG 착용 판정 `WearState`**(IR 직류 히스테리시스, SDD-316)과 **(B) `band_state`/`not_worn` 문자열**(BLE 연결 상태 enum, 착용과 무관한 이름 충돌).

### (A) 코어 WearState — 읽는 곳 전부
| 위치 | 결정하는 것 |
|---|---|
| `packages/measurement-core/src/engine.rs:663` `wear.update(ir)` | 전환 시 PPG 링 clear + `hrv.reset_for_not_worn()` (지표 파생 상태만) |
| `engine.rs:667` `if wear.worn` | **PPG 분석 링에만** 샘플 push 여부. 원시 샘플 카운트(`totals[1]`)·시계(`wm_us`)·`raw_chain`(569행, 파싱 전)은 착용과 무관하게 갱신 |
| `engine.rs:680` legacy 경로 | `!worn`이어도 `run_ppg` 호출 (not_worn 이력 남김) |
| `engine.rs:789~` `run_ppg` 미착용 분기 | 분석 생략, `LatestPpg{not_worn:true}` 이력 + `anchor_grid` — **프레임 격자는 계속 진행** |
| `engine.rs:969` `ppg_gate` | PPG 파생 7개 지표(bpm·sdnn·rmssd·lf·hf·lfhf·respiration)를 `invalid/not_worn` + null. **EEG·motion 지표와 프레임 자체는 그대로 송신** |
| `hrv.rs:401` `reset_for_not_worn` | HRV 상태 초기화, 호흡 사유 `not_worn` (motion 유지) |

### (A') 코어 밖 소비자 (값이 아니라 사유만 읽음)
| 위치 | 용도 |
|---|---|
| `frontend/src/lib/session-live/live-metric-snapshot.ts:21` `liveNotWorn` | reason=not_worn → 화면 notWorn 플래그(11/6 지시로 문구 미표시) |
| `MemberClassContainer.tsx:287`, `MemberSheets.tsx:63`, `member-view-types.ts:106` | 위 플래그 전달·표시만 |
| `backend/app/services/class_report_trend_service.py:177,189` | 리포트 측정 상태 분류(`eeg` 없음/무효 → "not_worn") — 저장된 값 기반, 전송 경로 아님 |
| `backend/app/services/member_report_builder.py:713` | 유효 윈도우 없음 → 리포트 `band_status=not_worn`. 저장 후 분류 |
| `class_report_stats_service.py:231` | 측정자 없음 사유 분류 |
| `AnalysisMetricsService.ts` (SDD-316) | 레거시 TS 경로(live v2 off일 때만 `useBand`가 사용). v2 켜진 웹/앱은 코어(WASM/FFI)를 쓴다 |

### (B) band_state 문자열 — 착용 판정과 무관(연결 상태)
| 위치 | 의미 |
|---|---|
| `backend/app/schemas/session_live_ingest.py:23` `BAND_STATES` | wire enum 검증 |
| `live_ingest_service.py:412` | `participant.band_connected = (band_state == "connected")` — **BLE 연결**이지 착용 아님 |
| `MeasurementManager.swift:766` `.idle → "not_worn"` | 연결 idle(밴드 없음)을 가리키는 이름. iOS 착용 판정 아님 |
| `band-report.ts:14` `disconnected → not_worn` | BLE 끊김 매핑 |
| Android `NativeRuntime.kt:119~121`, `StreamLifecycle.kt:32`, `MeasurementService.kt:104~111`, `LiveSession.kt:746` | band_state 변화 보고(중복 억제용 키) — 착용 입력 없음 |
| `native-measurement/device-status.ts:25` | `connected` 여부만 |

### 결론 (불변식 5개)
- **착용으로 전송·연결·업로드·gap 기록을 끊거나 건너뛰는 경로는 현재 없다.** iOS/Android/서버/웹 transport 어디에도 WearState를 읽는 코드가 없다(grep 전수: `wear`·`worn`은 코어 engine.rs와 표시 소비자뿐). 코어의 착용 판정은 PPG 파생 지표를 null로 만들 뿐, 원시 `raw_chain`·시계·totals·프레임 격자(`anchor_grid`)·EEG 지표는 계속 진행한다.
- 판정 강화(no_pulse)는 **같은 위치(ppg_gate)에서 PPG 파생 지표 null만** 추가하므로 새 차단 경로를 만들지 않는다. 수정 필요한 기존 차단 경로 없음 → 전송/연결 코드는 수정하지 않는다(범위 최소).
- SDD-316(`fcb75f38`)이 바꾼 것: WearState(DC 100k/500k, 150샘플) 도입, 전환 시 링·HRV 초기화, `LatestPpg.not_worn`, 프레임 PPG 지표 `invalid/not_worn`, TS AnalysisMetricsService RR 락인 재시드, 화면 `liveNotWorn`.

## 2단계 — 구현 설계
- `src/dsp/ppg.rs`에 공유 상수·함수 추가: `PULSE_AC_MIN_SD=6.0`, `VALID_RR_MIN_RATIO=0.5`, `RR_MEDIAN_TOLERANCE=0.25`, `MIN_RR_FOR_RATIO=3`, `ac_sd`, `valid_rr_ratio`, `pulse_gate_pass` — 재산출 예제(`1111fix` 워크트리, 이 브랜치엔 아직 없음)와 **같은 값·정의**.
- `engine.rs run_ppg`: 착용 분기 뒤 `analyze` → `hrv.process_ppg`(연속성 위해 게이트와 무관하게 갱신) → 링이 500샘플 가득 찼고 게이트 탈락이면 `LatestPpg.no_pulse=true`. `ppg_gate`가 이를 `invalid/no_pulse` 로 변환(7개 지표 null). 링이 덜 찼으면(초기 10초) 기존 동작 유지.
- emission·`anchor_grid`·프레임 송신은 그대로(창은 항상 나간다).
- 착용 진입 조건(DC 규칙·초기 상태) **변경 안 함**: 맥박 게이트가 책상 잡음을 이미 막고, 진입 지연(3초+10초)·`sdd316_not_worn` 시나리오 변경 위험을 피한다.
- TS: 레거시 `AnalysisMetricsService`/`PPGSignalProcessor` 경로(live v2 off)는 이번에 수정하지 않는다(코어가 웹·앱 v2 경로의 정본, HARU 이식 패리티는 코어-TS 하니스 기대값이 별도). 미반영 사실을 최종 보고에 명시.
- 앱 재빌드: 코어 변경이므로 웹 WASM 재생성 + iOS xcframework·Android .so 재빌드 필요(이번엔 빌드 안 함).
