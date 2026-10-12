# 하루밴드 × MB 2.0 — 클래스 시작 플로우·리포트 시스템 비교분석 브리프

## 목적
하루밴드(haru_band_app + link-band-sdk-web)의 "실제 클래스 시작 시 동작하는 플로우"와 리포트 시스템을 분석해, MB 2.0(SDD-021 Phase 2)의 EEG 실연동 + 리포트를 어떻게 기획할지 도출한다.

## A. 하루밴드 실제 클래스 시작 플로우 (코드 근거)

### 1. BLE 연결 — link-band-sdk-web (공식 SDK)
- `utils/bluetooth/BluetoothProvider.ts`: **Web Bluetooth(navigator.bluetooth) + Capacitor BLE(CoreBluetooth)를 동일 인터페이스로 추상화**
- 인터페이스: initialize/requestDevice/connect/disconnect/discoverServices/startNotifications/readCharacteristic/writeCharacteristic/isConnected/getBatteryLevel
- WebBluetoothProvider / NativeBluetoothProvider 구현체. namePrefix 'LXB' 필터 지원.

### 2. raw 데이터 수신 (haru_band_app)
- LINK BAND: EEG 250Hz(fp1=ch1/fp2=ch2), PPG 50Hz(red/ir), ACC 30Hz(x/y/z), Battery
- `ble-service.ts` → `StreamProcessor.handleBluetoothData(data)` 분기

### 3. 스트림 처리 (StreamProcessor.ts)
- CircularBuffer: EEG 5초(1250샘플)/PPG 10초/ACC 5초
- EEG 500샘플 임계 → advanced processing (EEGSignalProcessor: biquadjs 필터 → 밴드파워 delta/theta/alpha/beta/gamma)
- leadoff(ch1/ch2) → signalQuality

### 4. 분석 지표 (AnalysisMetricsService.ts)
- 밴드파워 → totalPower, focusIndex, relaxationIndex, stressIndex, meditationLevel, attentionLevel, cognitiveLoad, emotionalStability, hemisphericBalance
- **SQI 80% 이상만 큐에 추가 → Moving Average(120개, 2분)**
- PPG: bpm/rmssd/sdnn/lf/hf/lfHfRatio/spo2/hrMax/hrMin

### 5. 저장/업로드 (SessionManager + DataCollector)
- SessionManager: IndexedDB 로컬 저장(5초 flush) + addEEGData/addPPGData/addACCData
- DataCollector: `POST /eeg/sessions` 생성 → 5초 배치 `POST /eeg/sessions/{id}/features`(EEG/PPG/ACC) → raw는 S3 presigned URL → `PATCH /eeg/sessions/{id}` 종료
- feature-worker(Node): EEG/PPG/ACC 신호 처리 워커(feature 추출)

## B. 하루밴드 리포트 시스템 (backend)

### 1. 트리거 (workers/session_close.py)
- arq(Redis) 백그라운드 워커: 세션 종료 시 `compute_application_data(db, session_id)`

### 2. 명상 지표 산출 (services/metrics.py — 핵심)
- **7개 지표**: focus_index_stability_score, total_neural_activity_score, cognitive_load_stability_score, stress_score, hemispheric_balance_score, emotional_stability_score, relaxation_score
- **정규화 상수 JSON**(normalization_constants.json) — 하드코딩 금지, version 추적
- 매핑: score_trapezoid/score_linear/score_inverse_linear/score_deviation/score_relaxation/score_stability
- **null 보존 원칙** — 산출 불가는 None, 0 치환 금지 (falsy 버그 방지)
- **세션 품질 게이트**: MIN_USABLE_WINDOWS=40, RELIABILITY_INVALID=0.30/DEGRADED=0.70 → insufficient/invalid/degraded/valid 3계층
- 졸음 플래그(drowsiness_flag), 종합점수 weighted_total(가중치 재정규화)

### 3. 집계 (services/analytics.py)
- get_trends(주간/월간), compare_sessions, get_session_features(시계열)

## C. MB 2.0 현황 (비교 대상)
- SDD-021 1차 MVP: 모니터링 테이블 + 게스트 명상은 UI만, 뇌파 값은 null placeholder
- EEGRecord: 세션 종료 후 배치 저장용(record.py), 실시간 수신 채널 없음
- 리포트: ReportDetailPage(eeg_summary/eeg_timeline/markers/insights), reports.py(인증 사용자 중심)
- Web Bluetooth/Looxid SDK 연동 전무

## 반드시 답해야 할 쟁점
1. link-band-sdk-web(BluetoothProvider + WebBluetoothProvider)을 MB 2.0에 어떻게 통합할지 — npm 의존성? 코드 이식? 별도 패키지?
2. EEG feature 파이프라인(StreamProcessor→EEGSignalProcessor→AnalysisMetricsService)과 feature-worker를 MB 2.0에 이식할지, 재구현할지.
3. 리포트 시스템: 하루밴드 metrics.py(7개 지표 + 정규화 상수 + 품질 게이트 + null 보존)를 MB 2.0 리포트에 그대로 적용할지.
4. MB 2.0의 "두뇌휴식도"(1.0 mind-breeze-app) ↔ 하루밴드 relaxationIndex/meditationLevel 매핑.
5. MB 2.0 리포트 유형(상담사용/내담자용)과 세션→리포트 생성 파이프라인(비동기 워커) 기획.
6. 1.0 mind-breeze-app 리포트(GuestComplete 전화번호 신청) vs 하루밴드 리포트(자동 산출) vs MB 2.0 리포트 — 통합 방향.

## 검토 대상 파일
- haru_band_app: src/services/{SessionManager,DataCollector,StreamProcessor,AnalysisMetricsService,ble-service}.ts, backend/app/services/{metrics,analytics,session}.py, backend/app/workers/{session_close,archive_worker}.py, feature-worker/src/processors/*
- link-band-sdk-web: src/utils/bluetooth/*, src/components/{StreamProcess,EEGVisualization,Visualizer/EEG}/*
- MB 2.0: backend/app/services/session_service.py, backend/app/models/record.py, backend/app/api/v1/reports.py, frontend/src/pages/reports/ReportDetailPage.tsx

## 산출물 규칙
- 코드 수정 금지, 설계/기획 문서만. 한국어. 코드 근거 인용.
- 무비판 동의 금지. 이식 시 리스크/라이선스/의존성 명시.
- 최소 8개 이상 구체 리스크/결정 포인트.
