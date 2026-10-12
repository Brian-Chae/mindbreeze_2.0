# SDD-042 Summary — 리포트 샘플 보기

## 구현 결과
- `ReportListPage.tsx`: 빈 상태 + 목록 상단에 "샘플 리포트 보기" 진입점 추가
- `ReportSamplePage.tsx` 신규 (`/reports/sample`) — mock 데이터 기반 서사형 샘플
- 섹션 순서: 종합 여정 → 몸의 변화 → 마음의 변화
- 표현: 방향성(↑/↓) + 변화량(±회/±bpm/±ms, ±%), 점수(0~100) 없음

## 검증·배포
- `npm run build` 0 error
- 커밋 `5fc870c` → Deploy Dev `34910779346` 성공
