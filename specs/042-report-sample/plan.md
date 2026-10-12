# SDD-042 Plan — 리포트 샘플 보기

## 워커: 단일 FE (cursor)

### T1. ReportListPage 진입점
- 빈 상태에 "샘플 리포트 보기" 버튼 + 목록 상단 "샘플 보기" 링크
- `/reports/sample` 링크

### T2. ReportSamplePage 신규
- mock 데이터 기반 서사형 렌더링 (종합 → 몸 → 마음)
- 몸 3지표 + 마음 3지표: 방향성 + 변화량 + 추이 그래프

### T3. 라우팅
- App 라우팅에 `/reports/sample` 추가

## 완료 기준
- build 0 error, 샘플 보기 → 서사형 샘플 표시
