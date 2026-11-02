# SDD-274 — 비회원 Android 웹 측정 EEG 끊김과 지표 깜빡임 수정

## 1. 문제
- 운영 앱 vc42 실기(11/2 19:30): 코드 입장 비회원(Android 앱, JS BLE + WASM 코어)의 **자기 화면**에서 집중·이완·감정균형이 숫자 ↔ "-" 를 반복한다. 상담사 화면은 `holdLastValues`(15초)로 연속. iOS·회원(네이티브)은 정상.
- 운영 서버 근거(회차 bd418eef): 비회원 `focus_display`/`relaxation_display` 279건 중 167건 `invalid/reason=gap`, 2~7초 무효 구간 39회. 접촉·freshness 는 정상. EEG `packet_gap` 78 + `clock_reset` 23.
- 코어 규칙 4(`engine.rs:580`): 장치 tick 기준 EEG 누락이 `GAP_SAMPLES_LIMIT`(2샘플) 초과면 EEG 링을 비우고 재충전 → 재충전 동안 `invalid/gap`.

## 2. 범위
1. 원인 확정 시도(코드 추적) + EEG 입력 진단 계측(additive, `ed=` 쿼리).
2. **증상 완화**: 비회원 자기 화면의 집중·이완·감정균형이 일시 무효/null 이면 직전 유효값을 짧게 유지.
3. 근본 완화: 원인이 코드로 확정될 때만 최소 수정. 코어 임계(GAP_SAMPLES_LIMIT)를 웹에서만 완화하는 안은 **하지 않는다**(회원과 지표 정의 분기).

범위 밖: 회원(네이티브)·iOS·상담사 화면 로직, 저장(feature windows)·ingest 판정·업로드 현황, 서버 계약(additive 외), WASM/코어 변경.

## 3. 직전값 유지 규칙(결정)
| 항목 | 값 | 근거 |
|---|---|---|
| 유지 시간 | **15초**(≤15000ms 유지, 초과 시 "-") | 상담사 화면 `HOLD_LAST_VALUE_MS`(15초)와 동일 — 두 화면이 같은 시점에 값이 사라진다. 서버 근거 무효 구간 2~7초를 충분히 덮고, freshness stale(10초)보다 길어 "낡은 값" 오인은 아래 즉시 해제 조건으로 막는다 |
| 대상 | 집중·이완·감정균형(MIND 3지표)만 | 증상이 발생한 지표. 호흡·HRV·BPM 은 그대로 |
| 적용 경로 | 코드 입장 게스트(`!user.id`) + Android 앱 + LiveState/로컬 경로(네이티브 `nativeM.metrics` 사용 시 미적용) | 회원·iOS 동작 불변 |
| 즉시 해제 | 밴드 연결 해제(`!isLive`), 접촉 불량(`lead_off`), 링크 stale(`metricsBlocked`) | 값이 실제로 없음을 가려야 함 |
| 교체 | 새 유효값 도착 시 즉시 교체, 보관 시각 갱신 | |
| 문구 | 새 문구 없음(숫자 그대로 표시) | 점수·좋음/나쁨·완료·100% 단정 금지 준수 |
| 차트/기록 | 시계열 링버퍼·저장·display snapshot 은 원값 유지(유지값을 새 측정으로 기록하지 않음) | 저장 로직 불변 |

## 4. 계측(ed)
`ppg-diag` 와 같은 방식. EEG 패킷: accepted/duplicate/out_of_order/conflict/invalid(코어 판정, 워커 1초 tick), 알림 pkts/stall(1.5초↑)/burst(5ms 이내), **gap_samples 합계/최대**(JS 에서 코어 `clock.rs` 와 같은 식으로 계산)·gap>2 횟수(`g`=코어 재충전 유발 횟수)·tick reset 추정 횟수. `entry-state?...&ed=a..` 로 첨부(개수뿐).

## 5. 완료 기준
vitest 신규 `tests/sdd274*` + 기존 sdd272/273/246-web/fix-*/class-flow-member-entry-page 통과, `tsc -b`·eslint 오류 0.
