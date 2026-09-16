# SDD-067 Summary — 리포트 PDF A4 세로 1장 압축 디자인

## 구현 결과 (codex gpt-6-astra)
- A4 세로 1장: report-print.css @page size A4 portrait + min-height 0 + break-before auto (여러 장 → 1장)
- EEG 상세지표 제거: EegMetricsGrid/EegTimeline/details data-print-exclude + details open 로직 제거
- 1장 심플 디자인: 헤더(제목/이름/날짜) + 종합여정/몸/마음 핵심지표 + 마무리 압축
- print-report.ts가 report-print.css import, data-print-exclude 제거, report-print-document 클래스

## 검증·배포
- FE build 0 error
- 커밋 `83f089c` → Deploy Dev 성공
