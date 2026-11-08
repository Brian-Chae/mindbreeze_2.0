# SDD-319 — Plan

## 설계
신규 `backend/app/services/live_single_flight.py`(프로세스 내, 스레드 안전):
- `run_coalesced(key, fn)` — **방송용**. 실행 중이면 dirty 만 세우고 즉시 반환(None), 실행자는 끝난 뒤 dirty 면 한 번 더 실행. 스레드 풀·DB 커넥션을 점유하지 않는다.
- `coalesced_drain(key, do_drain, need_revision, wait_s)` — **명령용**. 진행 중 drain(leader)이 있으면 완료까지 대기(≤wait_s) 후 `applied_revision >= need_revision` 이고 busy 가 아니면 leader 결과를 공유, 아니면 직접 drain(다음 leader).

적용:
| 위치 | 변경 |
|---|---|
| `ws/session_live_namespace.py publish_session_sync` | `run_coalesced(("publish", sid), …)` 로 감쌈 |
| `class_participation_service.run_live_command` | `ob.drain` → `coalesced_drain` |
| `class_participation_service.publish_pending` 내부 drain | 합류 drain(need=0) 사용 |

## Task
1. single_flight 모듈 + 단위 시험(TDD).
2. 위 3곳 적용.
3. 동시 명령 N개 → drain 실행 횟수·ack 시험(실 PG+Redis, tests/sdd319/).
4. 기존 sdd246/sdd285/sdd306/ws 시험 회귀.
5. 로컬 전/후 부하 비교(동시 metric+명령) → summary.
6. summary 에 dev 재시험 비교표.

## 위험·롤백
- 위험: 합류 대기 중 leader 예외 → follower 가 직접 drain 으로 폴백(예외 전파 안 함). dirty 재실행 무한루프 방지(상한 없이도 입력 소진 시 종료, 안전장치로 최대 20회).
- 롤백: 모듈 호출을 원복하는 커밋 revert 1건(데이터·스키마 변화 없음).
