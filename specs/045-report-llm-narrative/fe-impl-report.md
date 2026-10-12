# SDD-045 FE 구현 산출물 (cursor worker)

## 완료 시각
2026-09-15

## 한 일
1. `ReportDetailPage`를 SDD-043 서사형 디자인으로 개편 (보라 `#F5EDFC` / 그린 `#F0F9F5` 크림, 점수 대형 노출 제거)
2. `content.eeg.narrative`(journey/body/mind/closing) 표시 + 없으면 `narrative.ts` 규칙 폴백
3. 지표 변화량(↑/↓ + %/단위) 카드 표시, 기존 7지표·타임라인은 보조로 축소 유지
4. EEG 관련 컴포넌트(haru 다크)를 mindbreeze 라이트 토큰으로 교체

## 변경 파일
- `frontend/src/pages/reports/ReportDetailPage.tsx`
- `frontend/src/components/reports/NarrativeSections.tsx` (신규)
- `frontend/src/lib/report/resolve-narrative.ts` (신규)
- `frontend/src/lib/api/report.ts` (narrative/changes/displayNarrative 파싱)
- `frontend/src/components/reports/EegMetricsGrid.tsx`
- `frontend/src/components/reports/EegTimeline.tsx`
- `frontend/src/components/reports/EegQualityBanner.tsx`
- `frontend/src/components/reports/ReportStatusBadge.tsx`

## 검증
- `cd frontend && npm run build` → **0 error** (vite build 성공)

## 남은 것
- BE가 `content.eeg.narrative` / `changes`를 채우기 전까지는 타임라인 유도 또는 규칙 폴백으로 동작
- 내담자용 `ClientReportDetailPage`는 이번 범위 외(공유 EEG 컴포넌트만 라이트 테마 적용됨)
