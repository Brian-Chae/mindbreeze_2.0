# round-1 — renew 경량화 로컬 검증

## 범위

브랜치 `sdd/319-renew-light`, 기준 `bb78a4d9`. 설계 선커밋 `7e8f3b04`.
제공된 dev W100 보고는 renew p95 5.18초/pending557(renew553), 저장20000/20000이다.
`w100-devlog.txt`는 7줄 집계이며 각 요청별 단계 소요/락 원인 원문은 없다.
따라서 553건을 특정 잠금 원인으로 전부 확정하지 않는다.

## 바뀐 동작과 보존한 동작

renew는 기존부터 outbox를 만들지 않았다. 리스·anchor·entity_version만 DB에 쓰고 다른 명령의
마지막 revision을 결과로 들고 있다. 그 revision의 projection 완료까지 기다리는 부분과 WS ACK
전 동기 publish/REST publish 예약을 renew에서 제거했다. 기존 세션→epoch→stream 잠금,
ledger 멱등, generation 검증, 종료/추방과의 직렬화, Redis/scope 검사 및 wire 형식은 유지한다.
다른 명령은 여전히 projection 완료 후 성공 ACK를 반환한다.

DB epoch lock 제거는 별도 동시성 설계가 필요하므로 이번 최소 변경에서 제외했다.
DB lease가 정본이며 이 값은 projection 여부와 독립적으로 실제 수집 판정에 사용된다.
새 renew outbox가 없으므로 방송할 이벤트를 생략한 것이 아니다. 일반 명령·metric/device 및
실서비스 heartbeat는 계속 drain/publish를 담당한다.

## 로컬 하네스와 dev의 차이

| 항목 | 기존 S5 | 새 소켓 하네스 | dev W100 |
|---|---|---|---|
| 전송 | 서비스 직접 호출 | 실제 localhost Socket.IO WebSocket | 실제 원격 소켓/REST |
| 서버 실행 | 서비스 스레드+별도 publish | aiohttp 단일 서버 이벤트루프, executor32 | 배포된 소켓 프로세스 |
| 클라이언트 | 동기 스레드 | 같은 프로세스의 별도 이벤트루프 스레드 | 부하 발생기5프로세스 |
| 인증·입장 | 합성 회원/서비스 입장 | 합성 READY V2Conn 주입 | 실제 login/join/enter |
| 부하 | 회원별32초 | 32tick renew10tick/metric·저장1tick, snapshot120, CPU15ms/25ms | 200초, burst120 |
| heartbeat | 주기 루프 없음 | 연결별 실제 join/hb_loop는 미실행 | 연결별5초 루프 |
| 저장 검증 | live metric projection 수 | 실제 EEGFeatureWindow 개수 | 분석창 저장 결과 |
| CPU | 미측정 | 클라이언트+서버를 포함한 프로세스 CPU | 소켓 프로세스 CPU |

새 시험도 dev 557건을 그대로 재현하는 환경이 아니다. CPU busy slice는 명시 합성 압박이며
OS·장비·네트워크 차이와 heartbeat 경쟁을 대체하지 않는다. fixed tick은 밀리면 종료가 늦어져
정확히32초인 open-loop 부하가 아니다. p95는 Socket.IO call 왕복(30초 timeout)의 성공 표본이며
오류·Timeout 수를 별도 기록한다. 120 snapshot은 시험 전용 소켓 event에서 실제 snapshot_ready를 호출한다.
저장은 시험 소켓 event로 REST의 store_batch 서비스를 호출하므로 HTTP transport 시험은 아니다.

callback/client coverage는 `(event_id,audience)` 집합의 합집합 비교이며 연결별 전달100% 증거가 아니다.
로그인·BLE·실제 화면 렌더링도 미검증이다. 초기 seed는 drain만 하고, host 연결 후 실제 publish를 통해
수신되므로 expected 집합에 포함한다. 합성 UUID PG DB/Redis namespace는 삭제하지 않고 보존했다.

## 재현

backend 디렉터리, Python은 기존 `../../mindbreeze_2.0/backend/venv/bin/python` 사용.

```sh
S319_SOCKET_LOAD=1 S319_SOCKET_N=100 S319_SOCKET_RESULT=/tmp/round1-after100.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd319.test_renew_socket_load tests/sdd319/test_renew_socket_load.py -q -s
```

40명은 N=40. 기본 ticks32/burst120/burn15ms/period25ms. baseline은 별도 app 사본을 만들고
`S308_BASELINE_SRC`로 지정한다. 이번 경로는 baseline-path.txt. `cps_sha256`, `namespace_sha256`,
`source_path`로 소스 고정을 검증한다. before100 최초 표본은 metric 비투영2건의 사유 계측이 없어
코드별 계측을 보강한 before100-r2를 추가했다. 최초 표본도 삭제/은폐하지 않고 보존한다.
부하·회귀·PG 시험은 모두 순차 실행해야 한다.

PG/Redis 연결 불가면 skip, load env 미지정이면 기본 skip이다. 일반 회귀는 기존 PreserveEvidence
runner로 fixture 삭제 teardown을 교체한다. `run_regression.py before|after`는 12묶음·독립 프로세스·
120초 상한, 기존 증거 덮어쓰기 금지. 새 renew/계측/소켓/리스 시험은 별도 집계하고 이전 방송13개는 포함한다.

## round-2 감독 로그

`live_command_timing`은 회차·종류별10초 집계, 완료 요청 count와 reasons별 수, 단계별 최대 ms를 기록한다.
마지막 미출력 구간과 종료되지 않은 요청은 포함하지 않아 전수 p95로 해석하면 안 된다.

| 필드 | 의미 |
|---|---|
| `kind=capture.renew`, `lease_only` | outbox 없는 renew의 projection 대기 생략 |
| `session_epoch_lock_ms` | sessions→epoch 잠금 획득과 관련 SQL 총 소요(개별 row lock 대기는 분리하지 않음) |
| `apply_ms` | 재시도 포함 DB 명령 전체 소요; lock 시간 포함 |
| `projection_ms` | coalesced_drain 전체 소요; renew는0 |
| `scope_ms` | post-commit Redis heartbeat/scope 조회 |
| `service_ms` | run_live_command 전체 소요 |
| `kind=capture.renew.ws`, `thread_queue_service_publish_ms` | 스레드풀 대기+서비스+후속 처리, 클라이언트 네트워크 제외 |
| `scope_gate_ms` | WS 명령 전 scope 검사 소요 |
| `single_flight_wait` | follower가2초 합류 시한 초과 |
| `projector_lock` | Redis projector fence 획득 대기 시한 초과 |
| `revision_behind` | drain 반환 revision이 요구 revision 미도달 |
| `live_not_ready` / `redis_unavailable` | scope/projection의 상태 미준비 / Redis 장애 |

renew가 여전히 느리면 WS→service→apply→session_epoch_lock 최대값을 비교해 대기 구간을 좁힌다.
각 값은 같은 요청의 수치가 아닐 수 있는 윈도우별 최대값이므로 차감으로 정확한 시간을 산출하지 않는다.
지난 방송 로그 `broadcast_progress/gap/emit_failed/lease_lost`도 함께 유지하며 실제 클라이언트
수신 확인은 소켓 수집 집합으로 별도 판정한다.

## 잔여 위험·롤백

DB 직렬화/스레드풀/CPU 포화는 유지되므로 dev 합격은 round-2로 확인한다. Redis 장애 뒤에도
DB commit 자체는 유지되고 기존 retryable ACK로 응답한다. 기존 ledger epoch와 Redis 재구축 epoch
경계 동작은 변경하지 않았으며 클라이언트의 기존 epoch 변경 resync를 사용한다.
마이그레이션이 없어 감독 승인 후 구현 커밋 revert 가능. 이번에는 푸시·PR·배포·서버접속/변경·
운영/dev 부하시험·메일·삭제·패키지 설치를 하지 않는다.

## 종료 대기 보강과 실패 표본 보존

`socket-after-100.json` 최초 표본에서 방송 미수집438쌍이 발생했다. 최종 DB revision3493과
applied/emitted3274의 차이219행×2 audience와 정확히 일치하며 broadcast_gap/emit_failed/lease_lost는0이다.
기존 final publish 호출은 single-flight leader가 있으면 즉시 반환하므로 완료 barrier가 아니었다.
하네스를 수정해 측정 부하/CPU 압박 종료 후 DB/applied/emitted 일치와 publish idle을 확인한다(최대60초).
이 대기 시간은 final_settle에 별도 기록하고 timed workload p95와 혼합하지 않는다.
수정된 하네스로 before100-r3/after100-r2를 추가하며 최초 실패 표본은 그대로 보존한다.
최초 after100의 실제 metric ACK TimeoutError1건과 not_live9건은 하네스 종료 오류로 지워지지 않는다.
후속 시험에서 재현되지 않아도 기존 동기 metric publish 리더의 긴 ACK 대기는 잔여 관측으로 보고한다.

독립 검산: `python3 specs/sdd-319-socket-projection-perf/evidence-renew-light/verify_evidence.py`.
최종 전후 회귀378통과/기존4실패/4생략(실패node동일), 신규단위12통과, 실제PG2통과.
실제PG baseline1실패/1통과와 PG미연결skip 증거도 보존했다.
