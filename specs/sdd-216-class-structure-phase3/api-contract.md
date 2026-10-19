# SDD-216 — 편성 API 계약

- 상태: 백엔드 구현 중. 아래 입력은 `backend/app/schemas/class_scheduling.py`의 실제 검증 계약에 맞춘다. 아직 공개 HTTP 경로 연결 전이다.
- 공통 URL: `/api/v1/classes`. 생성과 모든 변경은 operation_key로 재시도한다.
- 날짜는 ISO 날짜, 시각은 한국 벽시계 HH:MM. 응답 회차 시각은 UTC ISO 문자열. UUID는 문자열, 코드는 선행 0을 보존하는 4자리 문자열.

## 생성 입력

- `operation_key`: 1~100자. 같은 행위자·키·동일 본문은 같은 결과. 다른 본문 409.
- `status`: draft 또는 active. 기본 active.
- `schedule`: 아래 입력. 허용하지 않은 필드는 422.
- `title`, `location_type`, `location_address`, `capacity`, `linkband_mode`, `record_audio`, `record_video`, `chat_enabled`.
- `schedule_mode`: fixed/rolling. `planned_session_count`: 기본 8, 2~52. `duration_min`: 기본 60, 5~480의 5분 단위.
- `recurrence_rule`: version=1, start_date, weekdays(월=1~일=7), time(07:00~22:00·5분 단위), interval_weeks, skip_dates.
- `assignment_rule`: version=1, mode(all_one/rotate/by_weekday/per_session), host_ids 또는 weekday_hosts. 미정 null은 초안만.
- `instructors`: user_id·role(lead/assistant). counselor 개설자는 lead. org_admin은 별도 lead 필수.
- `rows`: client_key(`regular:YYYY-MM-DD`)·seq·scheduled_at·duration_min·location_type/address·host_id·assignment_override. 수동 수정은 원래 후보 키로 식별한다.
- `reminder_offsets`, `ends_on`, `member_ids`.
- `force`, `confirmed_conflict_fingerprint`: 최신 충돌을 확인한 경우만 저장. 검사 생략 용도가 아니다.

## 생성 응답

- class_id, revision, session_ids, effects_pending, invitation_results.
- active는 Class 1개·회차 N개·강사·멤버·전달 의도·멱등 결과를 한 트랜잭션에 저장한다.
- draft는 회차·코드·회원·전달 의도가 없다. draft_schedule에 입력을 보존한다.
- 부분 생성 성공 응답 없음. 외부 전달 성공과 DB 저장 성공은 별개다.

## 오류

- 401 인증, 403 역할/동작, 404 비가시 부모/없는 부모 동일, 409 상태·버전·충돌·정원, 422 입력, 503 코드 소진.
- 신규 도메인 오류 detail은 code를 가진 객체. 필드 검증 오류는 FastAPI 표준 422.
- 비가시 충돌은 상대 ID·제목·seq를 반환하지 않는다.
- 진행자 변경은 61분 전 즉시, 60분 전부터 수락 대기, 15분 이하 새 요청 거부. 요청 후보와 확정 진행자는 별개다.

## 연동 전 남은 계약

- HTTP 라우트·읽기 가산 필드·멤버·effects·롤링·권한 통합은 구현 후 해당 테스트 결과와 함께 갱신한다.
- FE는 BE 출시 후 이 계약의 실제 HTTP 검증 결과에 맞춰 연결한다.
