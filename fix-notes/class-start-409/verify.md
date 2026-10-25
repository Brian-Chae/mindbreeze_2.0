# 클래스 시작하기 409 — 검증 계획 (수정 전)

## 원인(정적분석)
- `backend/app/services/session_service.py:1121-1127` 반복(recurrence_rule 보유) 클래스의 `open`/`start` 전이는 `check_conflicts`를 호출한다.
- 같은 상담사가 만든 다른 활성 세션(즉석 클래스 포함, open/in_progress)과 시간이 겹치면 `class_write_service.py:68-80`이 `409 {code: schedule_conflict, conflict_fingerprint}`를 던진다.
- 프론트 `ClassPlayerPage.startClass`는 `force/confirmed_conflict_fingerprint` 없이 호출하고, `client.ts formatErrorDetail`이 `{code}` 객체 detail을 문구로 못 바꿔 `API 요청 실패 (409)`만 표시 → 재시도해도 5회 동일 409.
- CAS 409(`상태가 이미 변경되었습니다`, :1187)는 문자열 detail이라 이미 문구가 표시되므로 이번 증상과 다름.

## 시나리오
1. [PG] 상담사가 즉석 클래스 2개를 겹치게 만듦(둘째는 생성 시 확인 force) → 둘째 start가 `schedule_conflict` 409 + fingerprint.
2. [PG] 같은 fingerprint로 force 재요청 → 200, status=in_progress.
3. [FE] `schedule_conflict` detail → 사용자 문구. 409 지문 추출 헬퍼. 다른 409는 null.
4. [FE] 시작 시 지문 있으면 확인창 → 승인 시 force 재요청, 거절 시 안내문.
5. 회귀: pytest 관련+전체, vitest 기준선(기존 실패 17건/8파일), tsc·eslint·build.
