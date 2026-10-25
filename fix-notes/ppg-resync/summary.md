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

## 한계·후속
- 합성 신호에서는 수정 전에도 SDNN(60초)·호흡(90초)이 산출됨 → 재동기화 폭주가 실기기 미계산의 단독 원인이라는 증거는 확보하지 못했다. 시각 역행에 따른 RR 버퍼 리셋 위험을 제거하는 정합 수정이며, 실기기 재측정으로 확인해야 한다.
- 실측 패킷 수가 명목 샘플레이트의 약 2.5배(EEG≈631Hz 등) → 알림 리스너 중복 등록·로그 중복 가능성. 별도 확인 필요.
- EEG 지표/raw 저장 시각: 간격 4ms 유지 확인(테스트). HARU BAND 스코어링(eeg_metrics) 미변경.
- PR#111(fix/resp-hrv-display) 커밋 2건 포함.
