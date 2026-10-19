# SDD-217 BE CI 계약 실패 3건 수정

## 원인과 범위

1. CS8: 신규 attendance/participation/guest-entry 세 라우트가 response_model 없이 등록되어 기존 미지정 8개 외 추가됐다. `api-contract.md`의 출석 DTO, 참여 스냅샷, guest 입장 및 실제 서비스 반환값을 대조해 `class_membership.py`/`class_guests.py` API와 동명 schema 파일에 모델을 연결했다. 추가 파일 수정은 root가 승인했다. OpenAPI 골든과 기존 미지정 목록은 변경하지 않았다.
2. S07: base origin/develop에도 `class_code_service.display_code`는 부모 active만 코드를 노출한다. 217 spec DEV-03과 plan T06의 즉시 완료 계약에 따라 `session_service`가 마지막 정규 회차 종료 트랜잭션에서 `finish_class_if_due`를 호출하며 부모가 completed가 된다. 그러므로 종료 응답은 null이 맞다. 저장된 코드 삭제가 아니라 기존 표시 규칙 적용이며, 진행 중 코드 계약은 유지된다. 골든 전체를 생성하지 않고 S07 access_code의 타입 한 항목만 str→null로 수동 갱신했다. completed/null 명시 assertion도 추가했다.
3. TQ06: `api-contract.md:87`의 승인된 participation_heartbeat를 실제 AsyncServer 핸들러 기대 집합에 추가했다. 기존 이벤트 및 callable 검사를 유지했다.

응답 모델은 서비스의 문자열 ID/시간을 그대로 선언하여 UUID·datetime 재직렬화를 피하고, 반환되는 nullable 필드를 모두 보존한다. 새 HTTP 경계 테스트는 세 라우트 전체 DTO equality로 필드 탈락 및 null/문자열 변형을 검증한다. 서비스 로직은 stub이므로 권한/실제 DB 증거는 별도 PG 테스트다.

## 검증

- RED: 실패 세 node만 실행하여 3 failed 재현(4.82s). `/private/tmp/sdd217-contract-red.log`.
- 기존 contract 폴더 + test_mb2_test_quality_fixes.py: 105 passed(10.47s). `/private/tmp/sdd217-contract-green.log`.
- 새 HTTP 응답 모델 보존 테스트: 3 passed(1.07s). `/private/tmp/sdd217-response-models.log`.
- 실제 로컬 PG 55437: test_sdd217_attendance.py, test_sdd217_guests.py, test_sdd217_participation.py → 75 passed(21.28s). `/private/tmp/sdd217-contract-pg.log`. 참여 스냅샷 HTTP와 실제 WS join/heartbeat/leave도 포함한다.
- git diff --check 통과. 기존 라이브러리 경고는 있으나 실패 없음.

전체 BE 재실행·커밋·푸시는 하지 않았다. PDF/reset 파일의 다른 에이전트 변경은 수정하지 않았다. 원격 CI 통과는 root 재실행으로 확인해야 한다.
