# SDD-225 Plan

- T1 (RED) `backend/tests/test_sdd225_home_exclude_counseling.py`: 클래스 회차 + 상담 세션(+리포트·참여자) 시드, HTTP(`client.get` + `dependency_overrides[get_current_user]`)로 counselor·org 대시보드 검증.
- T2 (GREEN) `dashboard_service.py`: `counselor_dashboard`·`org_dashboard` 의 `Session` 조회에 `Session.counseling_relationship_id.is_(None)` 필터 추가. 팀 강사 경로는 `class_id` 기준이라 영향 없음.
- T3 관련 테스트(dashboard 계열) + 전체 backend pytest 1회.
- T4 summary.md.

파일 담당: 단일 워커. 수정 파일은 `dashboard_service.py` 와 신규 테스트뿐. 프론트·마이그레이션 없음.
