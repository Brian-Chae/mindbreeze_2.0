# SDD-225 후속 — `total_classes` 를 '서로 다른 클래스 수'로 교정 (구현 전 계획)

## 문제
- `counselor_dashboard`·`org_dashboard` 의 `total_classes` 는 `len(summaries)` = 회차(세션) 행 수다.
- 기관 홈 '총 클래스'(`OrgDashboardPage.tsx`)와 기관 홈 상담사별 `class_count` 에 회차 수가 클래스 수처럼 표시된다.

## 변경 범위
- `backend/app/services/dashboard_service.py` 만 수정. 프론트(라벨 '총 클래스' 유지)·스키마 변경 없음.
- `total_classes`(상담사·기관 홈)와 `counselor_stats[].class_count` 만 교정.
- 유지: `in_progress_classes`·`completed_classes`·`total_participants`·`pending_review_count`·`classes` 목록(회차 행 그대로).

## 계산 규칙
- 클래스 키 = `Session.class_id`. `class_id` 가 없는 레거시 단건 회차는 회차 id 자체를 키로 삼아 1건 = 클래스 1개.
- 상담사 홈은 팀 강사 회차 포함(합쳐진 목록 기준), 기관 홈 상담사별은 해당 host 의 회차 기준 고유 키 수.
- `_build_summaries` 가 반환하는 행에서 키를 얻을 수 있는지 확인하고, 없으면 `sessions` 와 zip 하여 센다.

## 검증 항목 (TDD, HTTP 응답 수준)
1. 한 클래스 3회차 + 다른 클래스 1회차 + 레거시(class_id 없음) 1건 → 상담사 홈·기관 홈 `total_classes == 3`, 기관 상담사별 `class_count == 3`.
2. 같은 시드에서 `len(classes) == 5`(목록은 회차 그대로), `in_progress/completed/participants` 불변.
3. 기존 테스트 중 `total_classes`/`class_count` 를 회차 수로 단언한 것은 의도된 변경이면 수정하고 목록을 summary 에 기록.
4. 관련 테스트 + backend 전체 1회.
