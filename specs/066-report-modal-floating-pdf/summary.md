# SDD-066 Summary — 리포트 팝업 승인·발송 분리 + 플로팅 + PDF

## 구현 결과 (codex gpt-6-astra)
- 승인·발송 분리:
  - 승인 전: "승인하기" 버튼 (승인만, 메일 발송 X)
  - 승인 후: "메일 발송" 섹션 (이메일 입력 + 발송)
- BE: approve_report가 메일 발송을 예약하지 않도록 분리 (발송은 resend_report_email로 별도)
- FE: 승인하기/PDF 버튼을 하단 플로팅 바(actionContainer)에 portal 렌더링
- 하단 "닫기" 버튼 제거 (상단 툴바 닫기 유지)
- PDF 생성: printReport(FE print-to-PDF, NarrativeSections 그대로)

## 검증·배포
- BE pytest 454 passed, FE build 0 error
- 커밋 `353097c` → Deploy Dev 성공
