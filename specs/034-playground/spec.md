# SDD-034 — Playground (haru_band_app 전체 이식 + 사이드바 탭)

> haru_band_app의 AdminPlaygroundPage(`/admin/playground`)를 **기능적으로 동일하게** mindbreeze에 이식.
> 명상 시뮬레이터만이 아니라 연결/캘리브레이션/파형/스펙트럼/PPG/ACC/지표/트렌드/디버그 패널 전체.
> 왼쪽 사이드바(상담사)에 "플레이그라운드" 탭 추가.

## 1. 배경·목표

haru_band_app playground는 LINK BAND 실기기를 관찰 전용으로 연결해 BLE → 신호처리 → 지표 파이프라인
전체를 한 화면에서 검증하는 도구다. mindbreeze에도 동일한 기능을 제공해, LINK BAND(실기기/mock)로
생체신호 처리 전 과정을 테스트할 수 있게 한다.

## 2. haru_band_app playground 구성 (이식 대상)

| 패널 | 역할 |
|------|------|
| ConnectionPanel | LINK BAND 연결·배터리·센서(LeadOff) |
| CalibrationPanel | 정규화/캘리브레이션 |
| EegWaveformPanel | EEG 필터링 파형(FP1/FP2) |
| SpectrumPanel | 주파수 스펙트럼 + 밴드파워 |
| PpgPanel | PPG 파형(red/ir) + BPM/HRV |
| AccPanel | ACC magnitude + 움직임/자세 |
| MetricsPanel | 지표 게이지(선택 토글) |
| TrendPanel | 지표 트렌드(시간별) |
| MeditationSimulator | 명상 시뮬레이터(시작/중지/리셋) — 이미 이식 |
| DebugPanel | 이벤트 로그 + 디버그 |
| (ServerComparePanel) | 서버 대조 — FeatureWorker 없어 제외 |

## 3. mindbreeze 이식 설계

### useBand 확장 (playground용 데이터 노출 — 현재 지표만 노출)
StreamProcessor가 이미 계산하는 데이터를 useBand state로 승격:
- `eegWaveform` (fp1/fp2 파형) — `result.filteredData` 기반
- `spectrum` (frequencies/ch1Power/ch2Power/dominantFrequency) — `result.frequencySpectrum`
- `ppgWaveform` (red/ir) — PPG filteredData
- `acc` (magnitude/movement/intensity/activityType/tiltAngle/stability) — ACCSignalProcessor 결과
- `rawIndices` (7지표: focus/relaxation/stress/cognitiveLoad/emotionalStability/hemisphericBalance/totalNeuralActivity)
- `sensors` (electrode 접촉 상태 — leadOff 기반)

### 패널 이식 (haru 원본 참고, mindbreeze Tailwind + 기존 디자인 토큰)
- `frontend/src/components/playground/`에 패널 10개 + 페이지

### 사이드바 탭
- `SidebarNav.tsx` `NAV_ITEMS`(상담사)에 `{ to: '/playground', label: '플레이그라운드', icon: ... }` 추가

## 4. 구현 계획

### T1. useBand 확장 (playground 데이터 노출)
### T2. playground 패널 이식 (Connection/Calibration/EegWaveform/Spectrum/Ppg/Acc/Metrics/Trend/Debug)
### T3. PlaygroundPage 재구성 (전체 패널 배치) + 사이드바 탭

## 5. 검증 기준
- 상담사 로그인 → 사이드바 "플레이그라운드" 탭 → `/playground` 접속
- LINK BAND(mock) 연결 → 파형/스펙트럼/PPG/ACC/지표/트렌드 패널 표시
- 명상 시뮬레이터 동작 (기존)
- `npm run build` 0 error
