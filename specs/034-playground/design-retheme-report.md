# SDD-034 Playground 디자인 개편 보고서

날짜: 2026-09-14  
작업: haru_band_app 다크 테마 → mindbreeze 밝은 보라 디자인 시스템 전면 매핑

## 변경 요약

기능·prop·useBand 연동은 유지하고, Tailwind 색상·차트 토큰만 mindbreeze 토큰으로 교체했다.

### 토큰 매핑

| 기존 (다크) | 개편 후 |
|---|---|
| `bg-gray-900` / `bg-gray-950` | `bg-white` / `bg-[#F8FAFC]` |
| `border-gray-800` | `border-[#EFEFEF]` |
| `text-gray-100` | `text-[#1F1F1F]` |
| `text-gray-400/500` | `text-[#6F6F6F]` |
| `text-gray-600` | `text-[#9A9BA8]` |
| `indigo-600/500` | `bg-[#5F0080]` / `hover:bg-[#4B0066]` |
| 비활성 토글 `bg-gray-800` | `bg-[#F5EDFC]` + soft hover |

### 수정 파일

1. `PanelShell.tsx` — 카드 프레임·상태 뱃지
2. `ConnectionPanel.tsx`
3. `CalibrationPanel.tsx`
4. `EegWaveformPanel.tsx`
5. `SpectrumPanel.tsx`
6. `PpgPanel.tsx`
7. `AccPanel.tsx`
8. `MetricsPanel.tsx`
9. `MetricGauge.tsx` (ValueCard 포함)
10. `TrendPanel.tsx`
11. `DebugPanel.tsx`
12. `PlaygroundMeditationSimulator.tsx`
13. `PlaygroundMeditationPanel.tsx`
14. `chart-theme.ts` — 보라 팔레트·라이트 툴팁
15. `PlaygroundPage.tsx` — AppShell 하위에서 패널 스타일 통일 (페이지 자체는 AppShell 배경 유지)
16. `WaveformCanvas.tsx` — 캔버스 배경·그리드 (파형 가독성 위해 추가)

## 검증

- `cd frontend && npm run build` → **0 error** (tsc + vite 성공)
- playground 내 `gray-*` / `indigo-*` 클래스 **잔여 0건**

## 남은 것

- 브라우저에서 Playground UI 육안 확인(실제 파형·차트 대비)
- 필요 시 커밋/PR
