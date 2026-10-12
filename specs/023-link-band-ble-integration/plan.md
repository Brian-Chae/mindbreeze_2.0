# SDD-023 — Plan

## 아키텍처

```text
[MB 2.0 웹] link-band-sdk util 이식 (lib/eeg/)
  bluetoothService ── BLE 연결 (Web Bluetooth, LXB 스캔)
       │ blePacketParser (250Hz EEG / 50Hz PPG / 30Hz ACC 파싱)
       ▼
  StreamProcessor → EEGSignalProcessor(biquadjs) → 밴드파워·지표(1초)
       │
  useBand 훅 (호스트/게스트 공용)
       │ 5초 배치 POST /sessions/{id}/features
       ▼
[MB 2.0 FastAPI] EEGFeatureWindow 저장 + live-metrics 실데이터
       │
  SessionMonitorTable(호스트) · GuestMeditationPanel(게스트) 실데이터 렌더
```

## 태스크 분해

### BE (Claude)
- T1. `POST /sessions/{id}/features` ingestion — 5초 배치(EEG feature 배열) → EEGFeatureWindow 일괄 저장. participant 검증.
- T2. `get_live_metrics` 실데이터 반영 — EEGFeatureWindow 최신 윈도우 → 두뇌휴식도/연결상태 실값
- T3. `GuestSessionStateResponse` 확장 — 게스트 명상 실데이터 필드
- T4. pytest — ingestion + live-metrics 실데이터

### FE (Cursor)
- T5. link-band-sdk util 이식 → `frontend/src/lib/eeg/` (bleConnection, bluetoothService, bluetooth/{4}, blePacketParser, TimestampSynchronizer, signalProcessing, BasicSignalProcessor, EEG/PPG/ACCSignalProcessor, StreamProcessor, SimpleCircularBuffer, logger, mockDataGenerator, brainStateAnalysis). import 경로·타입 정합. Capacitor 의존 제거(웹 전용).
- T6. `biquadjs` 의존성 추가 (frontend/package.json)
- T7. `useBand` 훅 — connect/scan → onDataReceived → StreamProcessor → 1초 feature → 5초 배치 upload
- T8. SessionMonitorTable + GuestMeditationPanel placeholder → 실데이터 연결 (Web Bluetooth 미지원 브라우저 안내 포함)

### 통합 (Codex)
- T9. 이식 정합 검증 — util 파일 타입/import/의존성 교차 확인
- T10. mock 시뮬레이션 파이프라인 — mockDataGenerator로 E2E 검증 절차 문서화

## 검증 계획
- BE: `./venv/bin/python -m pytest -q`
- FE: `npm run build` + tsc 0 error
- mock 시뮬레이션: mockDataGenerator로 raw→feature→upload E2E

## 리스크
- Web Bluetooth는 Chromium 전용(Safari/Firefox 미지원) → 안내 UX 필수
- biquadjs가 MB 2.0 bundler(vite/rolldown)와 호환되는지 확인
- import 경로/타입 충돌 — 이식 시 타입 단언 금지, 실제 정합
