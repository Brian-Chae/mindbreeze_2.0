# SDD-051 — 리포트 메일 디자인 + 리포트 보기 페이지

> 리포트 발송 메일에 디자인을 입히고, "리포트 보기" 버튼을 누르면 브라우저에서
> 디자인된 리포트 페이지가 열리도록 개선한다. codex(gpt-6-astra)로 디자인 구현.

## 1. 배경

- 현재 `send_report_email`(app/tasks/email.py)의 HTML은 `<h1>`+링크만 있는 단순 구조.
- `view_report_email`(report_email_service.py)이 반환하는 HTML도 단순 목록.
- MIND BREEZE 브랜드(보라 #5F0080 / 그린 #59CE90 / 크림 #F5EDFC) 디자인을 적용한다.

## 2. 구현 범위 (BE codex)

### T1. 발송 메일 HTML 디자인
- `app/tasks/email.py`의 `send_report_email` HTML 개선:
  - MIND BREEZE 브랜드 색상·타이포 (인라인 CSS — 메일 클라이언트 호환)
  - 헤더/본문/푸터 구조
  - **"리포트 보기" CTA 버튼** (report_link 연결, 버튼 스타일)
  - 텍스트 폴백 유지

### T2. 리포트 보기 페이지 디자인
- `report_email_service.py`의 `view_report_email` HTML 개선:
  - 브랜드 디자인 적용된 단일 페이지
  - 커버(제목/요약) + 인사이트 + 뇌파 지표 섹션
  - 반응형 + 모바일 대응
  - 이스케이프(escape) 유지 (보안)

## 3. 주의
- 메일 HTML은 인라인 CSS만 사용 (외부 스타일시트·JS 금지 — 메일 클라이언트 호환)
- 보기 페이지는 이스케이프 유지, JWT 토큰 링크 유지
- 점수(0~100) 노출 최소화 (서사형 기조 유지)

## 4. 완료 기준
- 메일에 디자인된 "리포트 보기" 버튼 → 브라우저 페이지 열림
- 보기 페이지가 브랜드 디자인으로 렌더링
- BE pytest 통과
