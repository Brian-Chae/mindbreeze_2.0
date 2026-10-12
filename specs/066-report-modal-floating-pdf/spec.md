# SDD-066 — 리포트 팝업 플로팅 승인·발송 + PDF 생성

> 리포트 팝업(모달)에서 "승인 및 발송" 버튼을 화면 하단에 플로팅해 스크롤해도 항상 보이게 하고,
> 하단 "닫기" 버튼은 제거(상단 툴바에 이미 있음)한다. PDF 생성 기능을 실제 구현한다.

## 1. 현황
- ReportDetailModal: 상단 툴바(제목+닫기) + 스크롤(ReportDetailView)
- ReportDetailView 액션: "닫기"(listAction) + "승인 및 발송" + "PDF 다운로드/생성"
- PDF: handleGeneratePDF가 alert 스텁 (미구현), BE에 PDF 생성 로직 없음

## 2. 구현 범위 (codex gpt-6-astra)
### T1. 승인·발송 플로팅
- "승인 및 발송" 버튼을 모달 하단에 sticky/고정 배치 (스크롤해도 항상 보임)
- 기존 액션 영역의 버튼을 하단 플로팅 바로 이동

### T2. 닫기 버튼 제거
- ReportDetailView의 "닫기"(listAction) 버튼 제거 (상단 툴바 닫기 유지)

### T3. PDF 생성 기능
- 리포트를 PDF로 생성/다운로드
- 방식은 codex가 판단 (FE print-to-PDF 또는 BE HTML→PDF)
- 서사형 리포트(NarrativeSections)의 디자인 정합 유지

## 3. 완료 기준
- 승인·발송 버튼이 하단 플로팅으로 항상 보임
- 하단 닫기 버튼 제거
- PDF 생성/다운로드 동작
- FE build 0 error (BE 변경 시 pytest 통과)

## 수정된 승인·발송 요구사항 (최신 브리프 우선)
승인 버튼은 `승인하기`로 표시하며 수동/자동 승인 모두 이메일을 예약하지 않는다. 승인 완료 후 `메일 발송` 섹션에서 저장된 report_email(없으면 빈 칸)을 수정하고 명시적으로 발송한다. 기존 resend_report_email을 사용한다. 하단 플로팅 및 본문 전용 print-to-PDF 요구는 유지한다.
