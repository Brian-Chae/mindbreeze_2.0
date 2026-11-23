# 펌웨어 sleep 조건 · MIND BREEZE 1.0 재연결 비교 (2026-11-21)

출처(읽기만): `LooxidLabs/linkband_fw_bwave`(v1.44.3, 2026-07-07), `LooxidLabs/nrf_work`(v1.1, 2024-01-16), `LooxidLabs/band.js`(1.0 앱 BLE 라이브러리), `mind-breeze-app`(1.0 앱, react-native-ble-plx), MB 2.0 운영 `24f8d24e`.

## 1. 펌웨어 sleep 조건 (두 버전 동일)
- `src/hw/sleep_mode.h`: `SLEEP_CHECK_DURATION_MIN 6`, `SLEEP_CHECK_INTERVAL_MIN 2` → 전원 켠 뒤 **6분에 첫 점검, 이후 2분마다** 점검.
- `src/hw/sleep_mode.c` `sleep_timer_expire()`: 점검 시각에 `accel_evt_cnt == 0` 이고 `!bt_connected` 이면 sleep(SYSTEM OFF). 깨우기 = 버튼(`btn_led.c` sense 핀).
- 움직임 카운터 `accel_evt_cnt++` 는 `XYZ_MODE` 블록 안에만 있음(`main.c:337-357`). 실제 빌드는 `lis3dh.h`에서 `STREAM_MODE` 정의·`XYZ_MODE` 주석 처리 → **카운터가 항상 0, 움직여도 sleep을 막지 못함**.
- 결론: 수업 중(전원 6분 이후) 연결이 끊기면 **다음 2분 점검 때 끊긴 상태면 바로 sleep → 끊긴 뒤 0~2분(평균 약 1분)**. 밴드는 그동안 광고(`BT_LE_ADV_CONN`, 100~150ms 간격)만 하고 스스로 연결을 시도하지는 않음(주변기기 역할). "약 3분"보다 짧다.
- 구버전(v1.1) 추가 위험: `disconnCount` 가 연결 성공 때 0으로 초기화되지 않아 **전원 켠 뒤 두 번째 끊김에서 밴드가 재부팅**(`checkDisconnCount()`, v1.44.2에서 수정). 현장 밴드 펌웨어 버전은 미확인.

## 2. 1.0 앱이 잘 붙었던 이유
- `mind-breeze-app/src/hooks/useBandAutoConnectChecker.ts`: 연결 안 됨이면 **5초마다 고정 간격**으로 저장된 밴드에 `connectToDevice` (연결 시도 중이면 건너뜀).
- `useBLE.ts`: 연결이 취소되면 60초 스캔을 켬.
- 즉 끊긴 뒤 2분 안에 수십 번 시도 → 밴드가 sleep에 들어가기 전에 다시 붙음.

## 3. 2.0 앱이 놓친 이유
- 재연결 간격이 **지수 백오프로 빠르게 길어짐**: JS `reconnect-policy.ts` 1·2·4·8·15·30초(최대 30초), Android 네이티브 `BandGattClient.kt` 1초부터 2배씩 최대 30초 + 연결 단계 제한 30초, iOS 1·2·4·8·15초.
- 1차 조사대로 JS 경로는 연결 호출 자체에 시간 제한이 없어, 한 번 걸린 시도가 끝나지 않으면 2분 창을 통째로 놓칠 수 있음.
- 11/18 마음돌봄 재연결 시도 37회 / 22분 35초 ≈ 시도당 약 37초 → 백오프 최대치(30초)+시도 시간과 일치. 밴드가 이미 sleep이라 이후 시도는 모두 헛돎.
- 대표 가설("앱이 잘못된 방식으로 재연결을 시도하다 밴드가 sleep") 은 **시점 측면에서 맞음**: 앱이 끊긴 뒤 처음 2분을 느리게 쓰는 사이 밴드가 sleep.

## 4. 해결안
| 우선 | 항목 | 위치 | 앱 빌드 |
|---|---|---|---|
| P0 | 끊긴 뒤 **첫 2분은 2~3초 고정 간격 재시도 + 시도당 10초 제한**(백오프 금지), 2분 뒤부터 스캔+느린 백오프 | 앱(JS·Android·iOS 3경로) | 필요 |
| P0 | 2분 넘게 못 붙으면 "밴드 버튼을 눌러 깨워 주세요" 안내 → 깨운 뒤 스캔으로 다시 찾기 | 앱 | 필요 |
| P0 | Android "다시 연결" 버튼 동작 구현(현재 iOS만) | 앱 | 필요 |
| P1 | sleep 조건을 "연속으로 N분(예: 10분) 끊김"으로 변경, `STREAM_MODE`에서도 움직임 카운트 | 펌웨어 | 펌웨어 업데이트 |
| P1 | 현장 밴드 펌웨어 버전 확인(구버전이면 두 번째 끊김 재부팅 위험) | 운영·SDD-326 | — |
