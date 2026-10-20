# SDD-225 — 홈 통계에서 상담 세션 제외

- 상태: Stage ① Spec
- 브랜치: `sdd/225-home-stats-exclude-counseling`
- 작성일: 2026-10-20
- 근거: `specs/sdd-219-class-launch-readiness/carryover.md` T11 (C1 출시 필수 항목)

## 문제
`backend/app/services/dashboard_service.py` 의 `counselor_dashboard`·`org_dashboard` 는 `Session` 행을 영역(area) 구분 없이 합산한다.
상담 세션(`counseling_relationship_id IS NOT NULL`, `area=counseling`)이 클래스 홈의 `total_classes`·`in_progress_classes`·`completed_classes`·`total_participants`·`pending_review_count` 와 `classes` 목록에 섞인다.
상담 기능은 feature flag 로 비공개 상태이므로, 출시 시 클래스 홈 숫자가 오염된다.

## 목표
상담사 홈(`GET /api/v1/dashboard/counselor`)·기관 홈(`GET /api/v1/dashboard/org`)의 통계와 목록에서 상담 세션을 제외한다.

## 범위
- 서버 필터: 두 집계의 세션 조회에 `Session.counseling_relationship_id IS NULL` 조건 추가.
- 기관 홈의 상담사별 통계(`class_count`·`participant_count`·`completed_count`)도 같은 목록에서 파생되므로 함께 정정된다.

## 비범위
- 상담 전용 화면·API(관계/회차 목록 등)는 건드리지 않는다.
- `total_classes` 의미 교정(회차 수 → 클래스 수), 클래스 단위 센터 대시보드 신설은 후속.
- 프론트 변경 없음(서버 필터로 충분, FE 는 `area` 를 쓰지 않음).

## QA 체크리스트
| # | 시나리오 | 기대 |
|---|---|---|
| Q1 | 클래스 회차 + 상담 세션이 섞인 상담사의 `/dashboard/counselor` | 카운트·`classes` 가 클래스 회차만 반영 |
| Q2 | 같은 시드의 `/dashboard/org` | 기관·상담사별 통계와 `classes` 가 클래스 회차만 반영 |
| Q3 | 상담 세션에 붙은 리포트(검토 대기) | `pending_review_count` 에 불포함 |
| Q4 | 응답 스키마 | 기존 필드가 HTTP 응답에 그대로 노출됨 |
| Q5 | 상담 세션이 하나도 없는 기존 사용자 | 결과 변화 없음 |
