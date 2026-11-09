# SDD-324 summary — BE 절

## 구현
- `GET /clients/summary`, `GET /clients?filter=inactive_14d|never_attended|week_attended|report_unread`
- `GET /reports/summary`, `GET /reports/hierarchy?tab=generation_failed|created_today|member_unread` + summary 전역 키 5종
- 계약 정본: `plan.md` §API 계약. 마이그레이션 없음.

## 읽음 처리 버그 — **있었음, 수정함**
- `report_service.get_report`의 읽음 마킹 조건이 `viewer.id == session.host_id`만 보아, **호스트 코치가 회원용(type=client) 리포트 상세를 열면 회원 `is_read`가 true**가 됨 → '회원 미열람' 집계 오염.
- 수정: 호스트 코치는 `type != "client"`(코치용)일 때만 읽음 처리. 회원 본인 열람(클래스 회원 경로 포함)과 기관관리자(원래 미처리) 동작은 불변.
- 시험: `test_V15`, `test_V15b` — 수정 전 실패 확인, 수정 후 통과.
- 영향: 과거에 코치가 열어 이미 true가 된 기존 행은 구분할 수 없어 보정하지 않음(데이터 백필 안 함).

## 정의 요약·주의
- week_attended/inactive_14d는 `collect_events`의 `session` 이벤트(결석·예정·취소 제외)를 재사용 — 기존 활동 정의와 일치.
- band_worn_members/attended_members는 건수 2개만, 비율 필드 없음.
- avg_review_hours는 `created_at` 기반 '대기 시간'(생성 완료 시각 컬럼 부재).

## 시험
- `tests/test_sdd324_summary.py` 18건 통과(고정 `now` 주입, 쿼리 수 상수 검증 포함).
- 회귀: report/hierarchy/client/dashboard/sdd23x/sdd25x 시험 825 passed, 11 skipped.
