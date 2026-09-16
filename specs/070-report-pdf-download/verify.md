# SDD-070 구현 전 Verify

작성 시점: 구현 전.

- [ ] 승인된 리포트의 host 상담사만 PDF 접근 가능; 미인증/타 상담사/미승인 거절.
- [ ] report_view 토큰의 유형·만료·세션·수신 이메일·리포트 상태 검증 재사용.
- [ ] PDF signature, application/pdf, attachment, no-store 확인.
- [ ] 정상/빈/긴 서사 모두 4페이지; 한글 텍스트와 폰트 임베딩 확인.
- [ ] 텍스트 HTML escape 및 외부 URL/로컬 파일 로딩 차단.
- [ ] EEG 상세지표 제외, 데이터 없는 항목을 0 또는 개선으로 꾸미지 않음.
- [ ] 두 FE 버튼 다운로드 성공/실패/중복 클릭과 blob URL 정리 확인.
- [ ] PDF PNG 시각 확인, frontend build, backend 전체 pytest.

코디네이터 승인: Orca ask 응답으로 위 계획의 구현 진행 승인 수신(2026-09-16).
