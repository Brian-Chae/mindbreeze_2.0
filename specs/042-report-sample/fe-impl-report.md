# SDD-042 FE 구현 보고 (cursor worker)

## 완료 항목

1. **ReportListPage 진입점**
   - 빈 상태: "샘플 리포트 보기" CTA → `/reports/sample`
   - 목록/빈 상태 공통: AppShell `rightSlot`에 "샘플 보기" 링크

2. **ReportSamplePage** (`/reports/sample`)
   - 섹션 순서: 종합 여정 → 몸의 변화 → 마음의 변화
   - mock 서사·6지표(방향성+변화량/변화율) + Recharts LineChart
   - "샘플 리포트" 배지, mindbreeze 라이트 토큰 (haru 다크 금지, 점수 미노출)

3. **라우팅**
   - `App.tsx`에 `/reports/sample`을 `/reports/:id` **앞**에 등록

## 검증

- `cd frontend && npm run build` → 0 error (tsc + vite)

## 변경 파일

- `frontend/src/pages/reports/ReportSamplePage.tsx` (신규)
- `frontend/src/pages/reports/ReportListPage.tsx`
- `frontend/src/App.tsx`
