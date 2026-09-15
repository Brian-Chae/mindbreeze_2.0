# SDD-060 — 리포트 상태 배지 UX 개선

> 리포트 목록의 상태 배지가 sent_at만 보고 2단계(승인됨/검토중)로만 표시된다.
> 상태머신(pending_analysis/pending_review/completed/error)을 반영하고 시각을 개선한다.

## 1. 배경
- 현재 StatusBadge는 sent_at 존재 여부만으로 "승인됨/검토중" 판단.
- error(실패) 상태가 표시되지 않고, pending_analysis(분석중) 구분도 없음.

## 2. 구현 범위 (FE cursor)
- StatusBadge를 report.status 필드 기반으로 개선:
  - pending_analysis → "분석중" (회색)
  - pending_review → "검토중" (노랑)
  - completed → "승인됨" (파랑/초록)
  - error → "실패" (빨강)
- 아이콘(점/체크 등) 추가로 시각 개선
- ReportListPage/ReportDetailPage에서 일관 적용

## 3. 완료 기준
- status 머신 4단계 배지 정상 표시
- FE build 0 error
