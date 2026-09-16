# SDD-070 구현 계획

1. 기존 report_view 토큰 검증과 상담사 host 권한 검증을 재사용한다.
2. WeasyPrint HTML 템플릿과 로컬 한글 폰트로 4페이지 서사형 PDF를 생성한다. 사용자 문자열은 escape하고 외부 리소스 로딩을 차단한다. EEG 상세 수치는 제외한다.
3. `/reports/view/pdf`와 `/reports/{report_id}/pdf`에 attachment/no-store 응답을 추가한다.
4. FE 공용 blob 다운로드 함수와 상세/메일 화면의 로딩·오류·승인 상태 처리를 추가한다.
5. 서버 의존성과 배포 시스템 패키지를 추가하고, 실제 PDF 페이지/한글/임베딩 검사, API 권한 테스트, FE build와 BE 전체 pytest를 실행한다.
