# plan — 실시간 v2 feature 15종 누락 복구 [Fix]

## 원인
SDD-246 v2 `MetricSet` 이 10종(focus/relaxation/emotion raw·display, bpm, respiration, sdnn, tna_raw)만 정의 →
계약(common.schema.json)·서버 `METRIC_UNITS`·`_feature_item`·feature-v1 산출물(코어 프레임 그대로 직렬화) 모두 10종. 엔진 내부(`eeg::analyze`, `HrvSnapshot`)에는 값이 이미 있으나 프레임에 실리지 않았다.

## 대표 결정
과거 데이터 재계산·백필 없음. 앞으로 들어오는 데이터만 정상화. 새 항목은 전부 선택(optional) — 구 앱(iOS 20·Android 23) 10종 메시지 그대로 수락.

## 항목별 출처 (v1 → v2 엔진)
| DB 컬럼 | v1 출처(feature-record.ts) | v2 엔진 값 | 신규 wire 키(단위) |
|---|---|---|---|
| delta/theta/alpha/beta/gamma_power | eeg.bandPowers (채널 가중 기하평균 merge) | `EegResult.bands` (eeg.rs merge) | `delta_power`…`gamma_power` (power_raw) |
| total_power | indices.totalPower = 5밴드 합 | bands 합 | `total_power` (power_raw) |
| stress_index | indices.stressIndex | `Indices.stress_index` | `stress_index` (index_raw) |
| cognitive_load | indices.cognitiveLoad | `Indices.cognitive_load` | `cognitive_load` (index_raw) |
| faa | indices.faa (Option) | `Indices.faa` (None→invalid `faa_unavailable`) | `faa` (index_raw) |
| hemispheric_balance | indices.hemisphericBalance | `Indices.hemispheric_balance` | `hemispheric_balance` (index_raw) |
| meditation_level / attention_level | v1 관례: relaxationIndex / focusIndex | 기존 relaxation_raw / focus_raw | **신규 키 없음** — 서버가 raw 에서 채움 |
| rmssd | v1 feature-record 스칼라엔 없음, HrvSnapshot 에 존재 | `HrvSnapshot.rmssd` | `rmssd` (ms) |
| lf_power / hf_power / lf_hf_ratio | ppg.advancedHRV | `HrvSnapshot` | `lf_power`,`hf_power` (power_raw), `lf_hf_ratio` (index_raw) |
| motion | ACC intensity/100 (0~1) | `HrvSnapshot.motion` (acc.rs) | `motion` (ratio_0_1) |

신규 wire 키 15종 = 밴드5 + total_power + stress + cognitive_load + faa + hemispheric_balance + rmssd + lf + hf + lf_hf + motion.

## 변경
1. Rust `engine.rs`: `LatestEeg` 에 bands/stress/cognitive_load/hb/faa 추가(`#[serde(default)]` — 구 체크포인트 복원 호환), `MetricSet` 15 필드 추가, `last_valid` 10→25칸, guard 기록 모드 reason 도 신규 EEG 지표에 부여. 값 없음 → null+사유(0 치환 금지).
2. 계약 `common.schema.json`: MetricUnit 에 `power_raw` 추가, MetricSet 에 15 선택 필드. additionalProperties:false 유지(알려진 키만 허용).
3. 서버: `METRIC_UNITS` 15종 추가(선택), `_feature_item` 매핑(+meditation=relaxation, attention=focus), `_EEG_METRIC_KEYS` 는 invalid 판정이라 기존 유지.
4. 웹 WASM 재생성(`bash frontend/scripts/build-measurement-wasm.sh`) — envelope 는 metrics 통째 전달이라 TS 코드 변경 없음.
5. 네이티브: Android/iOS 모두 Rust 코어 사용(.so / xcframework) → **앱 재빌드 필요**(이번 작업에서 빌드·업로드 안 함). Kotlin/Swift 소스는 metrics 통째 전달이라 변경 없음. CoreBridgeTest.kt 의 hash 기대값은 프레임 해시가 바뀌므로 갱신.
6. feature-v1 산출물: 코어 프레임 그대로(ndjson) 직렬화 → 코어 변경으로 자동 포함.

## 하위호환
- 서버 파서: `set(metrics) <= set(METRIC_UNITS)` — 구 10종 부분집합 그대로 수락.
- 구 앱은 신규 키를 보내지 않음 → 해당 컬럼 NULL(기존과 동일).
- 신 앱(재빌드)부터 15종 채워짐. 앱 업데이트 전 세션은 10종.

## 범위 외
백필·재계산, DB 스키마(컬럼은 이미 존재), 앱 빌드·배포.
