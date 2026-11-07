
## 후속 (11/7) — 100명 동시 입장 교착 근본 원인 수정

- 원인: `verify.md` 후속 Addendum 참조. 3자 고리(REST 입장 users→회차 / `capture.start` 회차 KEY SHARE→epoch / `entry.enter` epoch→users). 308 1차는 REST 쪽만 통일했고 `apply_command` 의 epoch→handler 내 클래스 잠금 역순이 남아 있었다. 기존 시험은 `_notify_participant_changed` 를 끄고 있어 이 경로가 안 잡혔다.
- 수정: 전역 순서 users → 클래스 → ClassMember → 회차 → epoch. (1) `apply_command` 가 `entry.enter` 는 epoch 전에 `lock_class_session` (`session_live_commands.py`, `CLASS_LOCK_FIRST_KINDS`), (2) `remove_participant` 도 epoch 전에 `lock_class_session` (`session_service.py`).
- 시험: `tests/sdd308/test_s4_rootcause.py` (100 동시 REST 입장→entry.enter→capture.start, 풀 20+20). 수정 전 교착 47·성공 1/100, 수정 후 교착 0·성공 100/100(3회 반복 동일).
- 회귀 묶음 전후: 기존 실패 `test_live_ingest_pg` 4건(기준선)만 남고 나머지 397 통과.
- 못 한 것: dev 100명 부하 시험(감독이 배포 후), ingest_device 의 epoch 잠금 축소는 이번 고리와 무관해 손대지 않음.
