# SDD-316 — Summary (2026-11-06)

## 변경
| 영역 | 파일 | 내용 |
|---|---|---|
| 코어 | `packages/measurement-core/src/engine.rs` | `WearState`(PPG IR 히스테리시스 100k/500k, 연속 150샘플=3초), 미착용 시 PPG 링·HRV 비움, 프레임 BPM·SDNN·RMSSD·LF·HF·호흡 = null + invalid + `not_worn` |
| 코어 | `src/dsp/hrv.rs` | `reset_for_not_worn`, 후보 B 재시드(`RR_GATE_RESEED_STREAK=12`) |
| 웹 TS | `frontend/src/lib/eeg/AnalysisMetricsService.ts` | 같은 B 재시드 |
| 화면 | `live-metric-snapshot.ts`, `MemberClassContainer/View/Stage/Sheets`, `member-view-types.ts` | reason=not_worn → "밴드를 착용해 주세요"(BPM·HRV·호흡 칸) |
| 시험 | `tests/sdd316_not_worn.rs`(5), `tests/sdd314_hrv_gates.rs`(+4), `frontend/tests/sdd316-*.test.ts`(8), examples `replay_wear.rs`·`replay_hrv_csv.rs` | |

## 착용 판정
- EEG lead-off 는 착용 구간에서도 25~100% 켜져 불채택(dev 두 회차 EEG 원시 대조). PPG IR 직류 사용. 실측: 미착용 2,641~41,248 / 착용 ≥1,134,896.
- C ABI·contracts 불변(사유 문자열만 추가). 앱 재빌드·WASM 재생성 필요(구 APK/구 WASM 은 계속 숫자를 냄).

## 시험 결과
| 항목 | 결과 |
|---|---|
| cargo test 전체 | 11 바이너리, 65 통과 / 0 실패 (golden·guard·c_abi 포함) |
| 프런트 vitest | 24 실패 / 14파일 = 기준선(23/13 + sdd220 1건)과 동일, 신규 실패 0. `measure-guard-null-display` 1건은 내 변경 없이도 동일 실패(기준선) |
| tsc | 0 |
| eslint | 내 파일 0건. 전체 13 errors 는 기존 테스트 파일(react-hooks/globals 등) |
| swift test | 미실행 — Swift·C ABI 변경 없음 |

## replay (코어, 수정 전 → 후)
| 입력 | SDNN 창수 | SDNN 중앙 | 호흡 창수 | 호흡 중앙 |
|---|---|---|---|---|
| iPad 1df2153e 0~300초 | 235 → 235 | 55.8 → 55.8 | 166 → 166 | 17.8 → 17.8 |
| 어제 83a39b18 착용 730~1110초 | 274 → 274 | 96.2 → 96.2 | 202 → 202 | 14.1 → 14.1 |
| 어제 83a39b18 720~1140초 | 0 → 164 | - → 83.9 | 0 → 139 | - → 11.2 |
| 어제 전체 | 310 → 316 | 84.9 → 100.6 | 229 → 291 | 10.3 → 12.2 |
| Android 62c5fe4b 착용 610~1100초 | 424 → 401 | 50.3 → 119.1 | 396 → 347 | 20.6 → 10.3 |
- 미착용 구간(1df2153e 330초~, 83a39b18 0~600·1140초~)은 전 프레임 not_worn(null). 착용 구간 HR 중앙값은 전후 동일(84 / 47 / 53).

## Android 값 변화 판정 (B 가 버그 수정인가)
버퍼 평균 RR→bpm 과 코어 HR 의 ±10bpm 일치 창 비율:
| 입력 | 수정 전 | 수정 후 |
|---|---|---|
| Android 착용 610~1100 | 19% (버퍼 78bpm vs HR 52) | 76% (버퍼 49bpm) |
| Android 전체 | 18% | 74% |
| 어제 전체 | 69% | 95% |
| iPad 0~300 | 87% | 87% (무변화) |
→ 수정 전 Android 는 HR 52 인데 버퍼 RR 은 78bpm(약 770ms)에 굳어 있었음. 수정 후 일치. 버그 수정으로 판정. **SDD-314 의 Android 'SDNN 96%·호흡 92%' 수치는 굳은 버퍼에서 나온 값이므로 정정 대상**(SDNN 50→119, 호흡 20.6→10.3). 정답 RR 이 없어 절대 정확도는 미검증.

## 웹↔코어 창별 일치 (50샘플 창, 동일 입력)
| 입력 | 비교 창 | 불일치 | 최대 SDNN 차 |
|---|---|---|---|
| iPad 0~300 / 30~300 | 300 / 270 | 0 / 0 | 0.00 |
| 어제 730~1110 / 720~1140 | 380 / 420 | 0 / 0 | 0.00 |
| Android 610~1100 | 490 | 0 | 0.00 |
| 어제 전체 / Android 전체 | 1928 / 1922 | 721 / 1253 | 15.2 |
- 전체 구간 불일치의 원인: 코어에만 있는 SDD-314 의 버퍼 상한 확장(120 초과)·시간영역 창 확장이 웹에 없음(코어 버퍼>120 인 창에서만 발생). 이번 변경 범위 밖이며 재시드 로직 자체는 일치. 후속 정렬 권장.

## 부정맥/불규칙 시험
- 4박 중 1박이 ±25% 밖인 입력 400박: 코어·웹 모두 버퍼 30 미만으로 떨어진 적 없음, SDNN 유지.
- 완전 불규칙(300~1500ms) 600박: panic·0 치환·비유한 값 없음.

## 못 한 것
- WASM(`frontend/src/lib/measurement-web/wasm`) 재생성·앱 빌드 안 함(금지). 웹 경로 코어는 재생성 전까지 구버전.
- 서버/리포트가 null 을 평균에서 제외하는지 코드 확인은 못 함(미착용 구간 값이 null 로 저장되는 것만 가정).
- 푸시·PR·배포 안 함.
