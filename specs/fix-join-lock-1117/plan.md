# fix-join-lock-1117 — plan

## 근거(운영 회차 4f7ab204, 11/17 14:19 KST, 30명)
- journalctl: `DeadlockDetected` — `AccessExclusiveLock on tuple of relation`(sessions) 대기 체인, 그리고 `SELECT 1 FROM ONLY "public"."sessions" x ... FOR KEY SHARE`(FK 검사)가 교착 SQL 문맥에 등장.
- 경합 지점: `class_participation_service.lock_context`(소켓 join/heartbeat) 가 사용자→클래스→멤버→회차→참가행을 전부 FOR UPDATE 로 잠그는데, 같은 시각 feature 저장(`_persist_feature_items`)·lease 삽입이 sessions/session_participants 를 FK 로 참조(KEY SHARE)해 FOR UPDATE 와 충돌 → 30명이 join+알림(`_notify_participant_changed`)마다 같은 잠금을 2회 쥐며 줄 서고 교착/lock_timeout → `DB 참여 join 거부`, `participant_changed 발행 실패`, `broadcast_emit_failed`.
- band 고착: 몰림 중 band 상태 갱신 트랜잭션 실패 → `band_connected=False` 로 남음. 이후 feature 저장은 `saved and not band_connected` 일 때만 True 로 올리는데, 데이터가 이미 존재(멱등 skip)하면 갱신이 일어나지 않아 영구 고착.

## 수정
1. 잠금 범위: 소켓 join/heartbeat/snapshot/알림 전부 `lock_context(light=True)`(회차 1행 → 참가행). 행 잠금을 `FOR NO KEY UPDATE`(key_share=True)로 낮춰 FK KEY SHARE 와 충돌하지 않게 함. 자격 검증(_authorize)은 잠금 없이 읽기라 light 로 충분.
2. 잠금 순서(문서화): users → classes → class_members → sessions → session_participants. light 경로는 뒤쪽 부분집합이라 순서 역전 없음. 종료·편성은 기존 전체 체인 유지.
3. 재시도: `_participation_socket` 이 join/heartbeat 도 DeadlockDetected/LockNotAvailable 한정 최대 3회 백오프 재시도(퇴장은 기존대로 전부).
4. 자가복구(서버 투영만, 필드명 유지): 코치용 `get_live_metrics`·`participant_changed` 알림에서 최근 15초 내 feature 수신 참가자는 `band_connected=True` 로 보정.
## 남은 위험
- DB 저장값 자체는 보정하지 않음(투영만). 리포트의 band_connected 기반 집계는 기존 값 그대로.
- 로컬 PG 동시 30 join 시뮬레이션은 환경 확인 후 생략 여부를 summary 에 명시.
