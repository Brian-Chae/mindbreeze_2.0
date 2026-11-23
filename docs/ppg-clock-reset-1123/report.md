# PPG 시각 역행(clock_reset) 폭증 — 원인 조사·해결안 (11/23)

- 조사일 2026-11-23, 읽기 전용(운영 DB `SET TRANSACTION READ ONLY`, dev DB·S3 조회만). 코드 수정·배포·쓰기 없음.
- 기준 코드: `origin/develop 79f8f224`. 펌웨어: `linkband_fw_bwave` main(v1.44.3) + `fix/sleep-after-disconnect-10min`(v1.44.5).
- 근거: [evidence/results.md](evidence/results.md), 조회 스크립트 `evidence/*.py`(개인정보 없음, 참가자는 익명 번호).

## 3줄 요약

1. **00F1(P05)의 clock_reset 3,531건은 진짜 시각 역행이 아니다.** 앱 JS 저장 경로(`raw-capture.ts`)가 PPG 헤더만 빅엔디언으로 읽는 **앱 버그**이고, 바이트를 리틀엔디언으로 다시 읽으면 4,391/4,391 패킷이 도착 시각과 0.13초 오차로 정상 전진한다(펌웨어·밴드 정상).
2. **"PPG 이상이 EEG 지표를 막은" 것이 아니다.** P05 는 15:20~16:05 측정 엔진 스트림(capture)이 **시작되지 않았고**(capture_stream 첫 생성 16:05:40, feature 첫 16:05:46), 그래서 feature 0·`band_connected=false`다. clock_reset 폭주와 feature 0 은 같은 원인이 아니라 **같은 시점에 겹친 두 현상**(P05 만 JS BLE 저장 경로로 raw 를 쌓고 네이티브 엔진은 안 켜진 상태).
3. **11/18 운영은 같은 현상이 아니다.** 운영 두 회차 raw 는 전부 네이티브 프로필(`mb-native-clock-v1`)이고 reanchor 0건, clock_reset 은 재연결 시 1회(3신호×1)로 4명뿐이다. 대표 말씀의 "다수 밴드 동일 현상"은 11/18 데이터에서 재현되지 않는다. 11/18 미측정·중단 원인은 별개(아래 §1).

## 확정/추정 구분

| 구분 | 내용 |
|---|---|
| 확정 | P05 PPG tick 은 LE 로 읽으면 정상, BE(앱 저장 경로)로 읽으면 역행 — dev raw 4,392패킷 전수 |
| 확정 | `raw-capture.ts:17` `getUint32(0, signal !== 'ppg')` → PPG 만 BE. Rust 코어(`parser.rs:175`)·iOS/Android 네이티브·SDK(`device.py:622`)는 LE. SDD-273 에서 이미 인지, "저장 로직 불변 원칙"으로 미수정 |
| 확정 | P05 raw 4,392 PPG 청크는 전부 `mb-web-clock-v1`(JS BLE 저장), 나머지 9명은 전부 `mb-native-clock-v1` |
| 확정 | P05 capture.start 가 15:20~16:05 에 서버에 도달하지 않음(ledger 에 실패·거절 행 없음), capture_stream 첫 행 16:05:40 |
| 확정 | 11/18 운영: 웹 프로필 raw 0건, PPG clock_reset 초당 폭주 없음 |
| **추정** | P05 의 네이티브 시작이 45분간 안 된 원인 — `use-native-measurement` 의 시작 조건(`shouldStartNative`: bandConnected·knownDeviceId)·`restartOrDescend` 재시도(3→6→12초…)·`releaseJsBand` 경합 중 하나로 보이나 **앱 로그 없이 확정 불가**. 16:05 재연결로 즉시 해소된 점은 "연결 직후 밴드 ID 확보 순서" 가설과 맞음 |
| 확정 | 펌웨어 PPG tick 생성은 이번 증상의 원인이 아님(§3) |

## 1. 11/18 운영 재현 확인 — 재현 안 됨

| 항목 | 몸돌봄(caca439c) | 마음돌봄(a7f4ce51) |
|---|---|---|
| 입장 / raw 청크 프로필 | 29 / 전부 native | 20 / 전부 native |
| reanchor | 0 | 0 |
| clock_reset 보유 참가자 | 3명(각 EEG·PPG·ACC 1회씩) | 1명(3신호 1회) |
| 그중 이후 feature 중단 | 1명(01:18 UTC 이후) | 1명(06:12 UTC 이후) |
| feature 0 인 입장자 | 2명(M24 capture 0건, M27 capture 4회 superseded) | 4명(M08 user_stop 3회 등) |

- clock_reset 은 밴드 재연결(tick 초기화)에서 정상 발생하는 1회성 이벤트다. 폭주(초당 1.5회)와 성격이 다르다.
- feature 0 인 6명은 raw 도 0건 → **측정 시작 자체가 안 된 사례**(캡처 시작 실패·중복 시작 superseded·사용자 중지)이며 clock_reset 과 대응하지 않는다. 사후분석 §4.4(데이터 중단)의 원인은 clock_reset 이 아니다.
- 앱·펌웨어 버전: 운영 `session_band_devices` 의 firmware/app_build 컬럼이 11/18 에는 비어 있어(M-list `fw None`) 버전별 대응표는 **작성 불가**. 서버가 회차마다 기록하도록 하는 것이 P1(§6).
- 대표가 현장에서 본 "여러 밴드 동일 증상"의 실체는 데이터상으로 §1 의 feature 0·중단자(몸 2+중단 2, 마음 4+중단 2)일 가능성이 크며, 코치 화면의 "연결 끊김" 표시와 대응되는지는 앱 화면 로그 없이 **미확정**.

## 2. dev 0d05175e P05 raw 분석

- 밴드 LXB-017200F1, v1.44.5, Android 15, 앱 build 56. PPG 4,392패킷(28샘플/172B) 전수 분석(`evidence/dev_raw6.py`).
- tick 헤더 hex 예: `fd 03 cd 00` → LE=13,435,901 / BE=4,244,884,736. 두 번째 패킷 LE=13,456,801 (+20,900 = 0.638s, 도착 간격 0.635s 와 일치).
- BE 로 읽으면 연속 패킷 tick 이 랜덤하게 뛰며(되감김 2,393·불일치 1,998) 앱 `RawChunker`/`BiosignalClock` 이 패킷마다 새 segment(4,393개)를 만들고 gap 이벤트 clock_reset 3,531·reanchor 734 를 기록한다.
- 32비트 wrap·패킷 중복·순서 뒤바뀜·샘플 수 오류는 없다(샘플 수 28 고정, 길이 172B 고정).
- 16:05 재연결 이후 같은 밴드는 native 프로필로 정상. 오전 v1.44.3 회차 2건(0bc31443, 87bc1c36)은 이 밴드의 raw 가 native 프로필만 있음(웹 프로필 0) — 정상이었던 이유.

## 3. 펌웨어 (`linkband_fw_bwave`)

- `get_timestamp()`(btn_led.c:267) = `k_cycle_get_32() - delta_time + r_tick`. 앱이 시각(시·분·초)을 쓰면 `r_tick=(h*3600+m*60+s)*32768`, `delta_time=k_cycle_get_32()` 로 재설정. 즉 **앱이 시각을 쓰는 순간 tick 이 점프**하며 매 패킷 증가분은 사이클 카운터 그대로다.
- PPG 패킹(main.c `send_ppg_data2`): FIFO 4샘플씩 drain → 28샘플 모이면 `get_timestamp()` 를 헤더로 전송. `ppg_poll_timer` 100ms + AFULL 인터럽트가 `ppg_int` 를 세우고 `ppg_work` 가 처리. 시간 역행을 만드는 경로는 없다(단조 카운터 + 상수 오프셋).
- 관찰된 tick 간격 500/600/644ms 반복은 FIFO 폴링 배치 지터이며 패킷 샘플 수(28)와 무관하게 평균 0.56s(≈50Hz) → 정상.
- 시각 쓰기(accel RX characteristic) 직후 tick 이 큰 폭으로 되감길 수 있다(`r_tick` 이 하루 중 초 단위). 앱은 이를 새 segment 로 처리하는데, 이번 P05 에서는 시각 쓰기 이벤트가 없어도 폭주가 일어났으므로 원인이 아니다.
- 결론: **펌웨어 수정 불필요(P0 아님).** 단 시각 쓰기로 tick 이 불연속이 되는 설계는 P2 로 문서화(자정 롤오버 시 r_tick 감소 가능).

## 4. 앱

| 위치 | 내용 |
|---|---|
| `frontend/src/lib/biosignal/raw-capture.ts:17` | **원인.** `view.getUint32(0, signal !== 'ppg')` — PPG 만 BE |
| 같은 파일을 쓰는 곳 | `capture-session.ts`(raw 저장)·`web-measurement-session.ts`·`useBand`→`useBiosignalCapture` — JS BLE 로 연결된 상태면 네이티브 앱에서도 동작 |
| `android/.../RawChunker.kt:85`, iOS `RawChunker.swift` | LE 로 읽음. 허용오차 초과·`unwrapped<prev` 면 segment 전환(rewind 면 `clock_reset`) — 정상 동작 |
| `packages/measurement-core` | LE. 같은 tick 만 duplicate/conflict, 2초 이내 역행은 out_of_order(분석 제외), 2초 초과는 새 segment+재앵커 — **PPG 시계는 EEG 시계와 센서별로 독립**(`clocks[3]`). feature 프레임은 `wm_us.min()` 로 격자를 잡으므로 PPG 가 한 번도 안 들어오면 프레임이 안 나오지만(`drain_frames`), PPG segment 리셋은 EEG 링에 영향 없음 |
| 결과 | 이번 사건에서 엔진은 **P05 에서 가동조차 안 됨**. 엔진이 켜져 있었다면 PPG clock_reset 은 EEG feature 를 막지 않는다(`ppg_gate` 는 PPG 지표만 gap 처리, EEG 지표는 별도 `eeg_state`) |
| `band_connected` | 서버 `session_participants.band_connected` 는 band 보고(live:device)로 갱신. P05 는 네이티브가 밴드를 못 잡았거나 보고가 없어 false 유지(추정) |

## 5. 1.0 앱/SDK 참고

- `link_band_sdk/python_core/app/core/device.py` 는 EEG·PPG·ACC 헤더 모두 LE(622·775줄, PPG 는 바이트 합성 `data[3]<<24|…|data[0]` 로 LE). 1.0 에서는 이번 같은 PPG 시각 역행이 구조적으로 없다.

## 6. 해결안

| 우선 | 항목 | 위치 | 작업량 | 앱 빌드 | 펌웨어 | 비고 |
|---|---|---|---|---|---|---|
| **P0** | PPG 헤더 LE 로 통일 | `raw-capture.ts:17` `getUint32(0, true)` + `sdd273-ppg-diag`·`capture-session`·`raw-clock` 테스트 갱신, 기존 web 프로필 raw 의 BE 보정 규칙(프로필 hash 로 구분) 서버 파서 확인 | S | 필요(웹/하이브리드) | 불필요 | 저장만 영향, 지표 입력은 원문 bytes 라 변화 없음 |
| **P0** | 네이티브 측정 시작 지연·미시작 원인 로깅 | `use-native-measurement.ts` 의 시작 조건·재시도·`shouldStartNative` 결과, `restartOrDescend` 사유를 서버로 전송(진단 이벤트) | M | 필요 | 불필요 | P05 45분 미시작의 원인 확정용. 현재는 추정 |
| P1 | 서버 관측 | 회차마다 `session_band_devices.firmware/app_build` 필수 기록, capture_stream 미생성 참가자·raw 는 있는데 feature 없는 참가자를 코치 화면에 "신호 이상/측정 시작 안 됨"으로 표시 | M | 서버 먼저 | 불필요 | 11/25 전 배포 가능(서버만) |
| P1 | 웹 프로필 raw 와 네이티브 엔진 동시 구동 방지 | 네이티브 앱에서 JS BLE raw 저장(`useBiosignalCapture`)을 네이티브가 소유 중이면 끔 | S | 필요 | 불필요 | 이중 수집으로 saved raw 가 두 프로필로 섞임 |
| P2 | PPG 이상 시에도 EEG 지표 지속 | 이미 코어는 센서별 독립. 코치 화면에서 PPG 만 gap 일 때 EEG 지표 표시 유지 확인 테스트 추가 | S | 불필요 | 불필요 | 회귀 테스트만 |
| P2 | 시각 쓰기 시 tick 점프·자정 롤오버 문서화 | 펌웨어 `custom_service.c:228` | S | 불필요 | 다음 릴리스 | 지금 증상 원인 아님 |

## 7. 재현·검증 방법

1. **P0(LE)**: 단위 테스트 — 헤더 `fd 03 cd 00` 을 PPG 로 파싱했을 때 `tickRaw=13435901`. dev 에서 JS BLE 연결(웹 프로필) 1명으로 10분 측정 → `biosignal_gap_events` clock_reset/reanchor 0, PPG segment 1개 유지.
2. **실기 재현**: Android 앱 build 56 에서 밴드를 앱 시작 직후 연결 시도 → 같은 시점 JS BLE raw 저장 프로필이 `mb-web-clock-v1` 로 쌓이고 capture.start 가 안 가는지 확인(`capture_stream`·`session_band_devices.last_seen_at` 대조).
3. **검증 기준**: 한 회차에서 `mb-web-clock-v1` raw 0건, 모든 입장 참가자 `capture_stream` 생성 후 feature ≥ 1건/초(밴드 착용 시), PPG clock_reset ≤ 재연결 횟수.

## 8. 필요한 결정

1. P0(LE 통일)을 **다음 앱 빌드**에 포함할지(스토어 심사 필요, 서버로는 못 막음). 기존 저장 raw 는 수정하지 않고 프로필로 구분해 읽는다.
2. P05 45분 미시작 원인을 확정하려면 다음 현장 테스트에서 **앱 로그 수집**(adb logcat 또는 진단 이벤트)이 필요 — 11/25 전 서버 관측(P1)으로 대체할지.
