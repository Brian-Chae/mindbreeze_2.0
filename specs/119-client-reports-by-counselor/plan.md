# SDD-119 구현 계획

목표: 상담사별 회원 리포트 목록과 요약 제공.
기술: React/TypeScript, FastAPI/SQLAlchemy.
명세: spec.md. 기존 작업 중인 변경을 보존하며 현재 작업 공간에서 구현한다.

1. 백엔드: counselor_name 직렬화·합성·목록 배치 조회 테스트를 먼저 추가하고 실패 확인 후 schema/service 수정. report 관련 pytest 실행.
2. 프론트: 서로 다른 세션을 같은 상담사로 묶는 테스트, 요약 검색·폴백·예약 시간 테스트를 먼저 추가하고 실패 확인. ReportDto와 ClientReportListPage 수정. 그룹 토글은 상담사 기준으로 유지.
3. 검증: 관련 vitest, npm run build, report pytest 결과 확인 및 독립 코드 리뷰. summary.md에 결과 기록.

검토 항목: 이름 누락, 요약 누락·비문자열, 날짜 누락·잘못된 날짜, 페이지 전환, 모달 접근성.
