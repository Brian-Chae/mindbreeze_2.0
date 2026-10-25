# Android PPG 시간축 재동기화 폭주 — Summary

## 원인
- `TimestampSynchronizer.ts` 가 EEG·PPG·ACC 3센서 공유 `lastDeviceTime` 과 벽시계(`metrics.masterTime`)를 섞어 driftRate 를 산정 → BLE 도착 지터만으로 5ms/s 초과 → 5초 주기와 무관하게 매 패킷 `performResync`(masterTimeBase 재앵커링) → 샘플 시각 역행·점프.
- 재현(3센서 혼합, 지터 ±25ms, 150초, 수정 전): 재동기화 188회, PPG 시각 역행 40, EEG 역행 79, 간격 오차 최대 48ms.

## 수정
- `TimestampSynchronizer.ts`: 장치 카운터 고정 매핑 + 완만한 보정(slew). 5초 주기에만 구간 최소 오프셋으로 장기 드리프트 추정, 1회 최대 2ms 이동(EEG 간격 4ms 미만 → 단조 보장), 1초 초과 이탈은 하드 재앵커링. driftHistory/trackDrift 제거, ACC 정상 스냅 로그 억제.
- `host-live-model.ts`/`HostLiveContainer.tsx`: `holdLastValues` — band=on 참가자의 지표가 일시 null 이면 직전 값 15초 유지.

## 테스트
- `tests/fix-ppg-resync.test.ts`(RED→GREEN): 수정 후 재동기화 0회(150초, 5초 주기 상한 30), 시각 역행 0, 간격 오차 ≤2.0ms(지터 25ms)/0.1ms 미만(지터 0).
- `tests/fix-host-hold-last.test.ts` 5건.
- 전체 vitest: 17건/8파일 실패(기존 기준선과 동일, 신규 실패 0), 3105 통과. tsc·eslint 통과, build 통과.

## 2차 수정 — 실기기 내부 상태 실측 반영
- 실측: rrIntervalBuffer 길이 1([1920]) 고정, lastRrEndTimestamp가 현재보다 +92,400초(25.7h) 미래, 패킷 수 명목의 약 2.2~2.5배.
- 원인 ①(확정, 코드): `TimestampSynchronizer`가 EEG·PPG·ACC 3센서에 매핑(masterTimeBase/deviceTimeBase) 하나를 공유 — 센서별 장치 카운터 원점이 다르면 첫 센서에 앵커링된 매핑으로 다른 센서 시각이 수십 시간 어긋남(재현: PPG 원점 +92,400s → PPG 시각이 현재보다 +92,255초). 이 미래 시각이 `AnalysisMetricsService.updateRRIntervalBuffer`의 `lastRrEndTimestamp`를 앞으로 밀어, 이후 정상 시각 박동이 전부 `ts > lastRrEndTimestamp` 중복 제거에서 폐기 → RR 버퍼 1건·SDNN/호흡 null. `RR_CLOCK_RESET_MS` 리셋은 과거 방향만 처리했다.
- 원인 ②(코드 추정, 기기 미확인): Native는 `@capacitor-community/bluetooth-le`가 내부적으로 `eventListeners` 키 단위로 중복 방지(startNotifications 시 이전 리스너 remove)하지만, 네이티브 측 구독이 이전 연결에서 남은 경우 같은 패킷이 2회 오는 것은 코드만으로 확정하지 못했다. 중복 알림이 오면 `parsePPGPacket`이 샘플을 2배로 만들어 RR 간격이 과대 계산(`PPGSignalProcessor.ts:242`)된다. 어느 쪽이든 아래 방어로 차단한다.
- 수정:
  - `TimestampSynchronizer`: 센서(EEG/PPG/ACC)별 독립 시계. 패킷 헤더 시각이 직전 이하이고 2초 이내면 중복 패킷으로 판정(`isDuplicatePacket`), `blePacketParser`의 EEG·PPG·ACC 파서가 중복 패킷을 샘플 0개로 반환 → raw 저장 이전의 분석 경로(EEG 지표 포함)에서 중복 제외. 재연결(`bluetoothService` 상태 초기화)에서 `timestampSync.reset()`.
  - `AnalysisMetricsService.updateRRIntervalBuffer`: 현재+5초보다 미래인 RR 시각은 거부, 이미 미래로 밀린 커서·버퍼는 리셋.
  - `capacitor-ble-adapter.startNotifications`: 등록 전 `stopNotifications`를 항상 시도해 네이티브 구독 단일화(Web의 EEG-BLE-001과 동등).
- 주의: raw 원문 저장(`captureRawPacket`)은 파서 앞에서 호출되므로 중복 패킷 원문은 그대로 저장된다(원문 보존 정책, 분석만 중복 제거). 필요하면 후속으로 raw 저장 쪽 중복 제거를 검토.
- 테스트 `tests/fix-ppg-dup-future.test.ts`: RED(수정 전) 2건 실패 — 중복 시 샘플 15008(명목 7500)·원점 차이 시 PPG 시각 +92,255초 / 미래 시각 주입 회복 1건은 수정 전 실패(후 통과). GREEN 3/3: 샘플 7504, 90초 SDNN 301.95·호흡 13.1, 시각 현재 근처. 중복 판정 2초 창으로 `sdd244-capture` 기존 테스트 1건 격리(싱글턴 reset) 보정.
- 전체 vitest 17건/8파일 실패(기준선 동일), 3108 통과. tsc·eslint·build 통과.

## 한계·후속
- 합성 신호에서는 수정 전에도 SDNN(60초)·호흡(90초)이 산출됨 → 재동기화 폭주가 실기기 미계산의 단독 원인이라는 증거는 확보하지 못했다. 시각 역행에 따른 RR 버퍼 리셋 위험을 제거하는 정합 수정이며, 실기기 재측정으로 확인해야 한다.
- 패킷 2.2~2.5배의 정확한 발생원(리스너 중복 vs 네이티브 중복 구독)은 기기 재측정으로 확정 필요. 방어는 적용됨.
- EEG 지표/raw 저장 시각: 간격 4ms 유지 확인(테스트). HARU BAND 스코어링(eeg_metrics) 미변경.
- PR#111(fix/resp-hrv-display) 커밋 2건 포함.
