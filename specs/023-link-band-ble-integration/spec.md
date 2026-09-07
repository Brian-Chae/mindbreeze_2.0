# SDD-023 — LINK BAND 실연동 (BLE → EEG feature → 모니터링/리포트)

> 코드 레벨 SDD. Linear 미편성. 멀티에이전트에 Codex 포함.

## 목표
link-band-sdk(완성된 BLE SDK, Brian 자체 제작 MIT)를 MB 2.0 웹에 이식해, LINK BAND 착용 시 실제 EEG/PPG/ACC 데이터를 수집·처리·업로드하고 호스트 모니터링·게스트 명상·리포트에 실데이터를 공급한다. SDD-021(placeholder) + SDD-022(리포트 엔진)를 실데이터로 연결.

## 배경 (확인된 사실)
- link-band-sdk는 npm에 미배포(E404) → **코드 이식** (frontend/src/lib/eeg/)
- 핵심 util 23개 중 실연동 필요분: bleConnection, bluetoothService, bluetooth/{4}, blePacketParser, TimestampSynchronizer, signalProcessing, BasicSignalProcessor, EEG/PPG/ACCSignalProcessor, StreamProcessor, SimpleCircularBuffer, logger, mockDataGenerator, brainStateAnalysis
- 의존성: `biquadjs`(디지털 필터) 추가 필요. Capacitor BLE(@capacitor-community/bluetooth-le)는 웹 전용이면 제외.
- BLE UUID 확정(bluetoothService.ts): EEG 서비스 `df7b5d95-...`, PPG `1cc50ec0-...`, ACC `75c276c3-...`. namePrefix `LXB`. 샘플링 EEG 250Hz/PPG 50Hz/ACC 30Hz.
- `mockDataGenerator.ts` 존재 → 하드웨어 없이 시뮬레이션 검증 가능.

## 스코프
1. **BLE 스택 이식** — link-band-sdk util → MB 2.0 `frontend/src/lib/eeg/` (import 경로·타입 정합)
2. **biquadjs 의존성 추가** — frontend/package.json
3. **useBand 훅** — BLE 연결 → raw 수신 → 신호처리 → 1초 feature → 5초 배치 업로드 (호스트/게스트 공용)
4. **백엔드 ingestion API** — `POST /sessions/{id}/features` → EEGFeatureWindow 저장 + live-metrics 실데이터 반영
5. **UI 실데이터 연결** — SessionMonitorTable(호스트) + GuestMeditationPanel(게스트) placeholder 교체
6. **mock 시뮬레이션 검증** — mockDataGenerator로 파이프라인 E2E 검증

## 제외 (후속)
- 네이티브(iOS/Android) BLE (Capacitor) — 웹 전용 우선
- raw 데이터 S3 presigned 업로드 — feature 우선, raw는 후속
- PPG/ACC 풀 연동 — EEG 우선, PPG/ACC는 파싱만

## 수락 기준
- [ ] Web Bluetooth로 LINK BAND(LXB 접두사) 스캔·연결
- [ ] EEG 250Hz raw 수신 → 밴드파워·지표 산출
- [ ] 5초 배치 `POST /sessions/{id}/features` → EEGFeatureWindow 저장
- [ ] 호스트 모니터링 테이블에 실시간 두뇌휴식도·연결 상태 표시
- [ ] 게스트 명상 화면에 실시간 뇌파·두뇌휴식도 표시
- [ ] mockDataGenerator로 하드웨어 없이 파이프라인 E2E 통과
- [ ] 백엔드 pytest 통과 + 프론트 tsc/build 통과
