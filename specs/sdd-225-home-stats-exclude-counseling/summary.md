# SDD-225 Summary

## 구현
- `backend/app/services/dashboard_service.py`: `counselor_dashboard`·`org_dashboard` 의 `Session` 조회에 `counseling_relationship_id IS NULL` 필터 추가. 카운트 5종·`classes` 목록·기관의 상담사별 통계가 모두 클래스 회차만 반영한다. 팀 강사 경로는 `class_id` 기준이라 변경 없음. 프론트 변경 없음.
- 테스트: 신규 `backend/tests/test_sdd225_home_exclude_counseling.py`(HTTP 수준, 상담 3건 시드 → RED 확인 후 GREEN). 기존 `test_sdd216_read_followup.py::test_홈_일정은_…` 는 "홈 목록에 상담 세션이 포함"을 기대하던 단언을 "제외"로 변경(의도된 동작 변경).

## 테스트 결과
- 신규 2건 + 대시보드 관련(sdd221·sdd216·sdd081·sdd015) 통과.
- backend 전체: 3391 passed, 440 skipped, 0 failed (7분 12초).

## 남은 위험
- `total_classes` 는 여전히 회차 행 수다(의미 교정은 후속).
- 홈 목록에서 상담 세션이 빠지므로, 상담 일정을 이 API 로 보던 화면이 있으면 비게 된다. 프론트 `DashboardPage`·`OrgDashboardPage` 는 `area` 를 쓰지 않는 것을 SDD-219 에서 확인했으나 다른 소비처는 전수 확인하지 않았다.
- PG 전용 테스트(skipped 440건 중 일부)는 로컬에서 실행되지 않았다.
