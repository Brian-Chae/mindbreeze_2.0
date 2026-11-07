# round-2 — 단일 worker 인가·명령 및 projection 표기 배치화

기준 `b6f165ec`, 작업 브랜치 `sdd/319-renew-light-2`. 설계 선커밋 `de940485`, 최초 성공 흔적
보완 선커밋 `5d239fa3`. production 변경은 session_live_outbox.py와 session_live_namespace.py뿐이다.

## 원인과 선택

X100 renew service 최대~0.6초, WS queue+service~2초 및 scope gate~1.2초가 관측됐다.
종류별10초 집계의 최대값은 서로 다른 요청일 수 있으므로 이를 더하거나 빼서 정확한 지연을 산출하지 않는다.
실제 코드의 정상 스레드풀 제출2회를1회로 합치되 DB쓰기 전 Redis scope 검사, stale 재인가,
post-commit scope 검사는 유지했다. 권한 TTL캐시·executor 크기/설정 변경·DB epoch 잠금 제거는 하지 않았다.

close는 outbox를 만들므로 projection을 기다려야 한다. 현재 projector의 행별 UPDATE+commit을
batch 성공prefix 표기로 묶어 정상 projection을 빠르게 했다. Redis applied revision이 재생 기준이며
DB processed_at은 재생필터가 아니다. 단 rebuild의 과거projection 이력 판정에는 사용되므로 최초
성공행은 즉시 기록한다. 500행 표기 호출502→최대4, 이후batch는 추가 최초표기 없음.
중간 after_redis 오류행은 표기하지 않고 완료prefix만 표기, 다음drain이 Redis watermark까지 복구한다.

제공 x100-devlog11줄에는 close 원인별 로그가 없다. close100건의 직접 timeout 분포는 미확정이다.
로컬 기준선에서는 동시close100건이 모두성공하여 dev 현상을 그대로 재현하지 못했다.
이 개선은 close 성공으로 위장하거나 대기를 건너뛰는 변경이 아니다.

## 하네스

`backend/tests/sdd319/test_round2_socket_load.py`: localhost 실제 Socket.IO v2 handler,
실제 PG/Redis,100/40명,32tick metric·저장,10tick renew, snapshot120 동시, CPU15ms/25ms.
WS entry.enter→capture.start를 실제호출하고 마지막 측정종료 후 pressure를 유지한 채 동시close한다.
각연결5초마다 실제 publish_session_sync→LiveStateService.heartbeat→sio.emit을 호출하는
**합성 heartbeat 스케줄러**를 추가했다. 실제 join의 auth/terminal/resync 전체 수명주기를 대체하지 않는다.
로그인/REST join/REST enter 및 V2Conn은 주입되므로 entry p95는 실제 **WS entry.enter**의 수치다.

프로세스 CPU는 서버와 같은process의 별도client loop를 합산한 값이며 dev 소켓 단독CPU와 직접 같지 않다.
동기 ACK를 기다리는 회원별tick 루프는 밀리면 종료가늦어지고 다음renew도지연될수있다.
저장은 test소켓이 REST store_batch 서비스를 호출하며 DB EEGFeatureWindow 개수로 검증한다.
callback/client coverage는 `(event_id,audience)` 합집합으로, 모든개별연결의수신/화면을 증명하지 않는다.
부하종료후 DB/applied/emitted일치와 publisher idle까지 기다리는 final_settle은 측정구간과 별도다.

최초 before100 중간에는 초기projection 안전성보완 단위시험이 짧게겹쳤다. 해당표본을보존하고
부하만단독실행한 before100-r2를추가하여 비교한다. 첫표본의metricTimeout1/ignored4도은폐하지 않는다.
모든정식PG부하·회귀는순차수행하며 UUID시험DB와Redis자료는삭제하지않는다.

## 재현

backend에서:

```sh
S319_SOCKET_LOAD=1 S319_SOCKET_N=100 S319_SOCKET_RESULT=/tmp/round2-after100.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd319.test_round2_socket_load tests/sdd319/test_round2_socket_load.py -q -s
```

40명은N=40. 기본ticks32/burst120/burn15ms/period25ms/heartbeat5초. baseline은 별도app사본을
S308_BASELINE_SRC로고정한다(이번경로 baseline-path.txt). cps/namespace/outbox SHA로실제로드소스를확인한다.
PG/Redis없으면skip, loadenv미지정은기본skip. 12묶음회귀는run_regression.py before|after이며
이전renew/timing/PG/broadcast시험까지포함하고이번신규pipeline/socket파일만별도집계한다.

## round-3 로그·위험

기존 live_command_timing에 `thread_queue_ms`(제출→worker시작), `worker_ms`(scope+명령처리),
`scope_gate_ms`(worker안 실제scope검사)를기록한다. 이전 scope_gate_ms는큐대기까지포함했으므로
같은이름의전후수치를그대로비교하지않는다. `thread_queue_service_publish_ms`는이제pre-scope를
포함한전체dispatch시간이며, 재인가발생시재인가/재제출시간도포함한다.
윈도우최대값끼리의차감은요청별시간이아니다. 완료된요청의주기집계라마지막미출력구간/미완료요청도빠진다.

close ACK는여전히projection완료뒤성공한다. round-3의close pending·지연과renew p95를별도확인한다.
Redis장애/권한변경/실제DB경합이발생하면retryable이계속가능하며0을무조건보장하지않는다.
배치중프로세스사망은DB표기를늦출수있지만다음drain의watermark복구로재생된다.
최초성공흔적즉시표기로Redis소실epoch판정의기존경계를유지한다.

마이그레이션/설정변경없음. 감독승인후구현커밋revert가롤백이며여기서는수행하지않는다.
푸시·PR·배포·서버접속/변경·dev/운영부하·메일·삭제·시크릿출력금지유지.
