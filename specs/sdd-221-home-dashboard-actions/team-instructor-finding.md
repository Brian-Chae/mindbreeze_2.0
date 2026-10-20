# SDD-221 T5 — 팀 강사 회차 누락 판정 (A8·E4)

## 결과: 재현됨 → 서버 수정
- `counselor_dashboard` 는 `Session.host_id == 본인` 만 집계했다. 팀 강사(`ClassInstructor` lead/assistant)로만 속한 클래스에서 다른 강사가 진행하는 회차는 홈 타일·목록에서 빠졌다.
- 재현: `backend/tests/test_sdd221_dashboard_team_instructor.py` 첫 테스트가 수정 전 코드에서 실패(목록에 타 강사 회차 1건 누락), 수정 후 통과.

## 수정 (`backend/app/services/dashboard_service.py`)
- 본인이 active 이고 role 이 lead/assistant 인 클래스의 비템플릿 회차를 합집합으로 포함(본인 host 회차와 id 로 중복 제거, 활동순 재정렬).
- 접근 판정은 `class_access_service.class_role` 을 그대로 사용(기관 소속·상담사 역할 불일치 시 제외). `removed` 강사·`guest` 강사는 제외.
- 응답 필드 불변, 마이그레이션 없음.

## 노출 범위 판단
- 포함: 회차 제목·상태·일정·참여자 수·게스트 수 (팀 강사는 클래스 운영에 참여하며 `class_role` 상 member 권한 이상의 읽기 권한이 있음).
- 제외(0 으로 반환): 타 강사 회차의 `report_count`, `pending_review_count`. 리포트 검토는 진행 강사의 몫이고, 팀 열람은 별도 동의(`can_read_team_material`, class-team-v1 고지) 경로를 거쳐야 하므로 홈 집계로 건수를 흘리지 않는다. 그 결과 홈 "검토 대기" 타일은 본인이 host 인 회차만 센다.
- 기록 본문·요약·녹취는 이 응답에 원래 없다(`has_record`·`has_summary` 불리언만).

## 검증
- 신규 3건 + `test_sdd081_personal_office.py`, `test_sdd015_class_code.py`, `test_mb2_low_fixes_4th.py`, `tests/contract` 합계 132 passed.
- alembic 파일 변경 없음(head 불변).
- 남은 일: H3 dev 실데이터(팀 강사 계정) 확인은 배포 후.
