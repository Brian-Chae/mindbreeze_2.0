# Android PPG 시간축 재동기화 폭주 — Verify

> 주의: 재현 테스트(RED)를 먼저 돌려 가설을 확인한 뒤 수정했다. verify 문서 커밋은 수정 커밋보다 앞선다.

## 가설 검증 (코드 추적 + 재현)
- 실측(cdp20.log, 21초): '타임스탬프 재동기화' 234회 ≈ 초당 11회. 패킷 구성은 EEG 25샘플(100ms당 1패킷), PPG 28샘플(≈560ms), ACC 30샘플(1s).
  - 로그 패킷 수(20초: EEG 505×25샘플≈631Hz, PPG 91×28≈127Hz, ACC 44×30≈66Hz)는 명목(250/50/30Hz)의 약 2.5배로 **미해결**. 로그가 같은 패킷을 중복 출력했거나 notify가 중복 등록(재연결 시 리스너 중복)됐을 가능성이 있으나 이번 수정 범위에서 확인하지 못했다. 후속 확인 필요(WebBluetoothProvider 리스너 중복, 진단 로그 중복 여부).
- 원인(`TimestampSynchronizer.ts`, 수정 전):
  - `trackDrift`(:308-338): `lastDeviceTime`(EEG·PPG·ACC 3센서가 공유 인스턴스, bluetoothService.ts:163)과 `metrics.masterTime`(Date.now 벽시계, updateMetrics:402)을 센서가 섞인 채 비교 → 다른 센서 패킷 간 시각차가 '드리프트'로 계산되고, 10개 윈도우 기울기 × 1000이 BLE 도착 지터(±20~30ms)만으로 5ms/s 초과.
  - `checkResyncNeeded`(:343-352): `|driftRate| > MAX_ACCEPTABLE_DRIFT` 이면 5초 주기와 무관하게 `performResync`.
  - `performResync`(:358-396): `masterTimeBase=Date.now()`, `deviceTimeBase=lastDeviceTime` 로 매핑을 도착시각 기준 재앵커링 → 샘플 시각이 도착 지터만큼 점프(역행 포함).
- 시각축 사용처: `parsePPGPacket` 샘플 timestamp → `PPGSignalProcessor.ts:245` RR 종료 시각(rrEndTimestamps) → `AnalysisMetricsService.updateRRIntervalBuffer`(시각 중복 제거, `RR_CLOCK_RESET_MS=5000` 역행 시 RR·호흡 버퍼 초기화) → 호흡 60초 경과 게이트(`calculateRespiratoryRate`). 샘플 시각 역행/점프 시 RR 버퍼가 비워지거나 박동이 중복 제거로 폐기된다. RR 간격은 피크 인덱스 차 × (1000/ppgSamplingRate)로 계산(PPGSignalProcessor.ts:242)되어 시각축 왜곡에 직접 영향받지 않는다. 시각축이 영향을 주는 곳은 RR 종료 시각 기반 중복제거·역행 리셋·60초 경과 게이트뿐이다.
- 기존 PR#111 재현 테스트(`fix-resp-hrv-ble.test.ts`)가 통과한 이유: PPG 패킷만 단일 센서로 흘려 EEG·ACC 와 공유하는 `lastDeviceTime` 교차가 없었고, 지터 ±120ms 를 넣었어도 PPG 패킷만 단독이라 driftRate 기울기가 임계값을 못 넘음(재동기화 5초 주기만 발생). 3센서 혼합 + 실측 패킷 크기가 빠져 있었다.

## 재현(RED) 결과의 한계 — 정직한 기록
- 수정 전 코드에서 3센서 혼합 + 지터 ±25ms 재현: 재동기화 188회/150초(약 1.25회/s), PPG 샘플 시각 역행 40건, EEG 79건, 샘플 간격 오차 최대 48ms → 시각축 불안정은 재현됨.
- 그러나 **SDNN·호흡 null 자체는 합성 신호에서 재현되지 않음**(60초 SDNN, 90초 호흡 산출). 즉 재동기화 폭주가 호흡·HRV 미계산의 단독 원인이라는 가설은 이 합성 재현만으로는 입증되지 않았다. 실기기에서 실제 PPG 파형·피크 검출 품질(SQI), 위의 패킷 중복 가능성이 추가 원인일 수 있다.
- 재동기화 수정은 시각 역행에 따른 RR 버퍼 리셋(RR_CLOCK_RESET_MS) 위험을 제거하는 예방적 정합 수정이다.

## 수정 방침
1. 샘플 시각 = 장치 카운터 고정 매핑 + 완만한 보정량(slew). 재동기화는 5초 주기만, 구간 내 최소(도착-장치) 오프셋으로 장기 드리프트를 추정하고 1회 최대 2ms(EEG 간격 4ms 미만)만 이동. 1초 초과 이탈은 하드 재앵커링(재연결·일시정지).
2. 매 패킷 driftRate 재앵커링·driftHistory 제거. ACC '보정' 로그는 1ms 초과 이탈 때만.
3. 상담사 화면: `HostLiveContainer` 참가자 모델에서 band=on 일 때 지표가 일시 null 이면 직전 값 15초 유지(`holdLastValues`). band 가 on 이 아니면 유지 안 함.

## 시나리오
- V1 3센서 혼합(EEG 25/100ms, PPG 28/560ms, ACC 30/1s) 지터 0 / ±25ms, 150초: 재동기화 ≤ 30회, PPG·EEG·ACC 샘플 시각 역행 0, 샘플 간격 오차 < 10ms, SDNN·호흡 산출.
- V2 holdLastValues: 15초 이내 유지 / 초과 null / 새 값 갱신 / band≠on 즉시 해제 / 입력 불변.
- V3 EEG 4ms·ACC 33.3ms 간격 유지(뇌파 지표·raw 저장 시각 영향 없음).
- 전체 vitest(기존 17건/8파일 실패 기준선)·tsc·eslint·build.
