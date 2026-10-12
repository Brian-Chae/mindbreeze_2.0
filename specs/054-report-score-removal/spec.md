# SDD-054 — 리포트 점수(0~100) 노출 제거 (서사형 기조)

> 서사형 기조(점수 환원 금지)에 따라 내담자 화면에 남은 종합점수(0~100) 표시를 제거한다.

## 1. 배경
- 상담사 화면(ReportDetailPage)은 이미 서사형으로 점수 대형 노출 없음.
- 내담자 화면(ClientReportDetailPage, ClientReportListPage)에 score /100 표시 잔존.

## 2. 구현 범위 (FE cursor)
- `ClientReportDetailPage.tsx`: 커버의 score /100 대형 표시 제거 (서사형 문구로 대체)
- `ClientReportListPage.tsx`: 목록 카드의 score /100 표시 제거
- 서사형 리포트(있으면 NarrativeSections) 위주로 노출

## 3. 주의
- score 데이터 자체는 유지 (하위호환), 표시만 제거
- 서사형 기조 유지

## 4. 완료 기준
- 내담자 화면에서 score /100 표시 제거
- FE build 0 error
