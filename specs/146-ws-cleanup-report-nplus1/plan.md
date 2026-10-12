# SDD-146 — 구현 계획

## WS-01 (session_live_namespace.py)

- `clear_session_state(session_id)`: 5개 전역 dict에서 해당 세션 키 pop.
- 소켓 레지스트리(_sid_session_ids + _session_socket_counts)로 join/leave 추적.
- 마지막 소켓 disconnect/leave 시 정리. leave+disconnect 멱등(중복 감소 방지).
- disconnect / on_join / on_leave / notify_session_state_changed(완료·취소) 훅 연결.
- 기존 clear_* 헬퍼·테스트 참조 유지.

## RPT-03 (report_service.py)

- 기존 client 리포트 배치 조회(participant_id → Report 맵).
- SessionRecord 배치 조회(record_service.subjective_state_map) 1회.
- 참가자별 서사는 공유 맵에서 파생(_subjective_from_map), 개별 DB 조회 제거.
- 신규 리포트는 멱등 _get_or_create_report로만 생성.

## 테스트

- 백엔드 pytest 1010 passed / 0 failed 유지.
