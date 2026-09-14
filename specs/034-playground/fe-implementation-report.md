# SDD-034 FE 구현 보고 (cursor worker) — playground 전체 이식

> task: `task_1f2cae05e0c8` · dispatch: `ctx_71ca02d9cb70`  
> 완료: 2026-09-14

## 구현 요약

haru_band_app AdminPlaygroundPage를 mindbreeze에 **기능적으로 동일**하게 이식했다.
`useBand`에 playground용 파형/스펙트럼/PPG/ACC/rawIndices/sensors를 노출하고,
관찰 전용(`observationOnly` + `forceMock`)으로 세션 업로드 없이 mock 스트림이 흐른다.
ServerComparePanel은 FeatureWorker 부재로 제외했다.

## 산출 파일

### T1 — useBand 확장
| 경로 | 내용 |
|------|------|
| `frontend/src/hooks/useBand.ts` | eegWaveform/spectrum/ppgWaveform/acc/rawIndices/sensors + observationOnly/forceMock + StreamProcessor `onStoreUpdate` 배선 + mock 파형 생성 |
| `frontend/src/types/playground.ts` | playground 공용 타입 |

### T2 — 패널 이식 (`frontend/src/components/playground/`)
| 파일 | 역할 |
|------|------|
| `PanelShell.tsx` | 공통 프레임 |
| `WaveformCanvas.tsx` | Canvas 2D 파형 (rAF, 리렌더 0) |
| `chart-theme.ts` | brand `#5F0080` 차트 토큰 |
| `trend-metric-keys.ts` | EEG/PPG 트렌드 키 |
| `ConnectionPanel.tsx` | P1 연결·배터리·센서 |
| `CalibrationPanel.tsx` | P1.5 raw indices (간소화) |
| `EegWaveformPanel.tsx` | P3 EEG 파형 |
| `SpectrumPanel.tsx` | P4 스펙트럼·밴드파워 |
| `PpgPanel.tsx` | P6 PPG·HRV |
| `AccPanel.tsx` | P7 ACC |
| `MetricsPanel.tsx` | P2 지표 게이지(토글) |
| `TrendPanel.tsx` | P5 트렌드 |
| `DebugPanel.tsx` | P8-A 로그 |
| `MetricGauge.tsx` | selected/onToggle 확장 |
| (유지) `PlaygroundMeditationSimulator.tsx` / `PlaygroundMeditationPanel.tsx` | 명상 시뮬레이터 |

### T3 — 페이지·사이드바
| 경로 | 내용 |
|------|------|
| `frontend/src/pages/playground/PlaygroundPage.tsx` | haru 순서 전체 패널 배치 |
| `frontend/src/components/layout/SidebarNav.tsx` | NAV_ITEMS에 플레이그라운드 + `ICONS.activity` |

## 동작

1. 상담사 로그인 → 사이드바 **플레이그라운드** → `/playground`
2. **Mock 연결** → EEG/스펙트럼/PPG/ACC/지표/트렌드 데이터 흐름
3. P2 지표 클릭 → P5 트렌드 추가/제거 (EEG≤3, PPG≤2)
4. 명상 시뮬레이터 기존 동작 유지
5. 연결 해제 / 버퍼 초기화 / 디버그 로그

## 설계 메모

- `observationOnly`: IndexedDB 큐·WS 업로드 스킵. 라이브 `/join`·`/sessions` 경로 회귀 없음.
- 고빈도 파형: ref 적재 + 200ms state 플러시 + WaveformCanvas supplier(rAF).
- Calibration은 haru 전체 UI 대신 rawIndices 스냅샷으로 간소화.
- lucide-react 미사용 → StrokeIcon / 인라인 SVG.

## 검증

- [x] `cd frontend && npm run build` — **0 error** (tsc + vite 성공)
- [ ] 브라우저 E2E: Mock 연결 → 패널 데이터 흐름 (수동 확인 권장)

## 남은 것

- 브라우저에서 `/playground` Mock 연결 스모크
- (선택) `forceMock: false`로 실기기 BLE 관찰 모드 UI 토글
- (선택) CalibrationPanel 전체 정규화 플로우 이식
