# SDD-070 — 서버 사이드 PDF 생성·다운로드 + 메일 열람 PDF 버튼

> 지금 PDF는 FE print-to-PDF(브라우저 프린터) 방식. 이를 서버에서 PDF 파일을 생성해
> 다운로드받는 방식으로 전환하고, 메일 열람 페이지(/report-view)에도 PDF 다운로드 버튼을 추가한다.

## 1. 현황 문제
- PDF 보기 = window.print() 프린터 화면 → "깔끔한 PDF 파일 다운로드"가 아님
- 메일 열람 페이지(/report-view)에는 PDF 버튼 없음

## 2. 구현 범위 (codex gpt-6-astra)
### T1. BE PDF 생성 서비스
- 리포트 content(서사형)를 HTML로 렌더링 → PDF 변환
- 방식: weasyprint 권장 (Python HTML→PDF). 한글 폰트(Noto Sans KR 등) 필수
- 리포트 디자인(보라/그린/크림 팔레트) + 4페이지 구성 + EEG 제외 + 머리글/꼬리글/페이지번호 유지

### T2. BE PDF 다운로드 API
- GET /reports/{id}/pdf (상담사·승인된 리포트)
- GET /report-view PDF용 (토큰 기반 열람자용, report_view 토큰 검증)

### T3. FE PDF 다운로드 버튼
- 리포트 상세(ReportDetailView)의 PDF 버튼: window.print → 서버 PDF 다운로드로 교체
- 메일 열람 페이지(/report-view)에 PDF 다운로드 버튼 추가

## 3. 주의
- 서사형 디자인 정합 (웹/PDF 동일 수준)
- EEG 상세지표 제외, 4페이지 구성 유지
- 한글 폰트 임베딩 (깨짐 방지)
- weasyprint 시스템 의존성(Cairo/Pango) EC2 설치 필요 — 배포 스크립트 반영

## 4. 완료 기준
- PDF 버튼 → 서버 생성 PDF 파일 다운로드 (프린터 화면 아님)
- 메일 열람 페이지에서도 PDF 다운로드 가능
- FE build 0 error, BE pytest 통과
