# SDD-319 — Verify (구현 전 QA 체크리스트)

## 합격 기준(dev 40명×200초, 감독 재시험)
| # | 기준 | 기준선(재현) |
|---|---|---|
| V1 | projection_pending 0건 | 6건 |
| V2 | entry.enter p95 < 1.5초 | 3.05초 |
| V3 | 소켓(8000) CPU 평균 < 기준선 | 91% |
| V4 | 분석창 저장률 100%, 5xx 0 | 100%/0 |
| V5 | 기존 시험 회귀 0 | — |

## 시나리오(자동 시험, tests/sdd319)
- S1: 한 회차에 명령 N(=12) 동시 → 모두 `applied` ack(committed), projection_pending 0, drain 실행 횟수 ≤ N/2(합류).
- S2: 명령 부수효과(after-commit callback) 명령당 정확히 1회.
- S3: revision 단조(applied_revision 가 줄지 않음), outbox 전부 projection.
- S4: publish 합류 — 동시 publish 호출 중 마지막 변경 이후 반드시 1회 이상 재실행(누락 0), 동시 실행 수 ≤ 1.
- S5: leader 예외/ busy 시 follower 가 직접 drain 으로 폴백해 성공.
- S6: `projection_pending` 응답 경로(진짜 busy) 형식 불변.
- S7: 기존 sdd246/sdd285/sdd306/test_sdd024/ws 시험 전후 동일 통과.

## Addendum (11/7) — 100명 projection_pending 회귀 수정 합격 기준 (구현 전 작성)
1차 배포 후 dev 재시험(stage3.sh, 200초)에서 40명은 개선됐으나 100명에서 capture.renew projection_pending 49→801, renew p95 5.6→7.4s 로 회귀했다.
가설: follower 가 leader drain(2초)을 기다린 뒤 직접 drain 폴백(다시 락 대기 2초) → 락 경합·busy. 방송 재실행 루프의 스레드 점유.

| # | 기준 | 40명 | 100명 |
|---|---|---|---|
| A1 | projection_pending | 0 | ≤ 49 (11/5 이하) |
| A2 | entry.enter p95 | ≤ 1.5s | 입장 500 0건 |
| A3 | capture.renew p95 | ≤ 1.5s | ≤ 5.6s |
| A4 | features_batch p95 | ≤ 1.0s | — |
| A5 | 저장률 / 5xx | 100% / 0 | 저장 100% |
| A6 | 정합성 | revision 단조, 부수효과 정확히 1회, 방송 누락 0 (heartbeat self-heal 근거) | 동일 |

로컬 시나리오(tests/sdd319 보강): 100명 상당 동시성에서 (a) projection_pending 비율, (b) follower 총 대기 ≤ drain_wait_s(이중 대기 제거), (c) publish 재실행 횟수 상한·양보, (d) 기존 S1~S7 유지.

## Addendum 2 (11/7) — 3차: 동시 입장 대기줄(클래스별 동시 처리 상한) 합격 기준 (구현 전 작성)
운영 100명 동시 입장 시험(11/7 11:22): login 100/100, join 60/100·enter 40/40 이 60초 ReadTimeout, 소켓 프로세스 로그에 `QueuePool limit of size 20 overflow 20 reached` 약 120건, CPU≈0.
가설(코드 근거): `get_current_user`(deps.py:24)가 요청 시작에 DB 연결을 잡아 응답까지 쥔 채, join(`class_code_service.py:167` 클래스 행 FOR UPDATE)·enter(`lock_class_session`, `_lock_session_for_capacity`) 의 같은 행 잠금을 기다린다 → 100 요청이 연결 40개를 전부 점유해 풀 고갈.
대책: 클래스(회차)별 동시 처리 상한 대기줄을 인증·DB 의존성보다 **앞**에 둬서 대기 중 연결 0개. 대기 시한 초과 시 503 + Retry-After(재시도 가능 오류).

| # | 기준 | 값 |
|---|---|---|
| E1 | 100명 동시 입장(5초 내 login→join→enter) join/enter 성공 | 100/100 |
| E2 | 500 응답 | 0건 |
| E3 | 입장(join+enter) p95 / 최대 | ≤ 20초 / ≤ 45초 |
| E4 | QueuePool timeout 로그 | 0건 |
| E5 | 40명 입장 p95 | ≤ 5초 |
| E6 | 측정 단계 저장 | 100% |
| E7 | 기존 시험 회귀(tests/sdd319·sdd306·sdd285·sdd246, class join/enter 관련) | 0 |

자동 시험(tests/sdd319/test_entry_queue.py):
- Q1: 같은 키 동시 N 요청 → 동시 실행 ≤ 상한, 전부 결국 처리(순서 FIFO 근사).
- Q2: 다른 키(클래스)는 서로 막지 않는다.
- Q3: 대기 시한 초과 → 503 `entry_busy` + Retry-After, 슬롯·대기 카운터 누수 0.
- Q4: 대기 중 DB 연결 미점유(풀 크기 2 로 20 요청이 전부 성공, checkedout ≤ 상한).
- Q5: 예외·취소 시 슬롯 반환. 상한 0 이면 비활성(기존 동작).
- Q6: 로컬 실 PG 로 100 동시 join/enter 전/후(풀 20+20).

## Addendum 3 (2026-11-07) — SDD-319b 방송 누락 수정 (구현 전)

브리프의 설계 선커밋 → backend 구현·로컬 검증 지시를 수행한다. 작업 브랜치는
`sdd/319-broadcast-gap`, 기준 `68229ab6`. 프로토콜·응답·프론트·서버 설정은 변경하지 않는다.

### 원인 및 후보 선택

100명 기준선 계측: 기대 8202쌍 중 62쌍 누락, 모두 실제 stream seq가 replay cursor 이하인
seq_shift로 확정. replay 불가/emit 실패/기타 0. 결정적 단위시험도 seq101~110 대상에 최신115를
주면 cursor105로 앞 5개 누락, 일부 audience 누락에도 emitted가 3까지 진행함을 재현(2 실패·1 통과).

| 후보 | 판단 |
|---|---|
| a. outbox에 projection seq 저장 | 정확하나 DB/Redis 이중 기록·스키마 변경이 필요하여 보류 |
| b. 보수적 replay + 완전성 검사 | 채택. 기존 snapshot Lua가 원자적으로 반환하는 applied_revision 활용, 추가 정상 경로 Redis 왕복 없음 |
| c. projector/방송 공통 lock | 느린 emit이 명령 projection을 막아 renew 성능 위험, 제외 |

`A=max(rows.revision)`, snapshot의 seq=S/applied=B에 대해 `cursor=max(0,S-n-max(0,B-A))`.
동일 epoch에서 revision당 해당 pair의 seq는 최대 1 증가하므로 B-A는 대상 이후 증가량 상한이다.
대상은 (done,A]의 연속 outbox 행이며 정확한 event_id/audience/domain으로 걸러 revision 순 정렬한다.
과도하게 오래된 하한으로 log_truncated면 stream 첫 seq-1까지 clamp하여 1회 재조회한다.
실제 기대 pair가 사라졌으면 복원했다고 간주하지 않는다. 최초 누락 행 이전의 완전한 prefix만
방송·watermark 처리한다. 기존 SDD-285의 '미방송 상태에서도 watermark 전진' 시험은 이 요구와
충돌하므로 의도된 변경으로 별도 표시한다. heartbeat snapshot 복구는 유지된다.

### 구현 계획 및 검증

- [x] `class_participation_service.events_for_rows`: 원자 snapshot 하한, 최초 epoch 고정,
  trim 재조회, 정확한 pair 필터. 결정적 seq 선행·절단·epoch 변경 시험.
- [x] `publish_pending`: contiguous revision/all-audience coverage, emit 실패 시 재시도,
  lock token/epoch 검사 및 갱신, 단조 watermark 원자 쓰기. 누락·실패 로그에는 payload/개인정보 제외.
- [x] 단위시험: audience 일부 누락, revision hole, callback 실패, lock 상실, epoch 교체.
- [x] 실제 로컬 PG/Redis 100명·40명 순차 재시험: callback 누락0, 교착0, pending≤49,
  renew p95≤2초. 실제 네트워크/화면/소켓 CPU는 감독 dev 시험 범위.
- [x] 기존 회귀 12묶음 전후 독립 프로세스 실행, 실패 nodeid 비교. PG 불가 skip,
  UUID DB/Redis 증거 보존, 삭제 teardown 차단.
- [x] summary·재현 명령·전후 수치·위험·dev 로그 관측법 기록, 독립 검토 후 로컬 커밋.

### 위험과 관측

stream retention 초과로 실제 이벤트가 사라지면 gap을 숨기지 않고 정지한다. 중복은 허용한다.
배치 중 lock 갱신 및 최종 CAS로 stale broadcaster의 watermark 쓰기를 막는다. callback 자체가
락 TTL보다 오래 정지하는 경우 이미 진행 중인 외부 전송까지 취소할 수는 없으므로 엄격한 네트워크
수신 순서는 보장하지 않는다. 일반 경로에서 projector 락은 추가하지 않는다.
`broadcast_gap`, `broadcast_emit_failed`, `broadcast_progress`, `broadcast_lease_lost` 로그로
applied/emitted/expected/sent/missing을 확인한다. callback 성공은 클라이언트 전달 ACK가 아니다.

## Addendum 4 (2026-11-07) — round-1 renew ACK 경량화 (구현 전)

작업 브랜치 `sdd/319-renew-light`, 기준 develop `bb78a4d9`. 감독 round-1 W100:
저장20000/20000·측정100/100·교착0·500 0·방송 gap/emit 실패/lease 상실0,
projection_pending557(renew553), renew p95 5.18초. 개선 목표 pending≤49, renew≤2초.

### 확정 원인과 미확정 영역

- `session_live_commands._handle_capture_renew`는 이미 lease/anchor/entity_version만 갱신하고
  outbox를 생성하지 않는다. revision은 다른 명령/metric이 올린 현재 회차 revision이다.
- `run_live_command`는 renew도 이 무관한 revision까지 `coalesced_drain`(2초 합류) 완료를
  기다린다. 이 post-commit 단계의 busy/미반영/LiveNotReady가 projection_pending을 만든다.
- WS `_run_command_sync`는 성공 뒤 `publish_session_sync`까지 동기 실행하므로 renew drain만
  생략해도 publish leader의 drain/emit이 ACK를 지연시킬 수 있다. REST도 불필요한 publish 예약을 한다.
- DB session/epoch 잠금은 projection_pending의 직접 반환 경로가 아니다. 다만 DB·스레드풀·CPU
  경합은 전체 ACK 지연에 기여할 수 있다. emit-lock도 pending의 직접 반환 경로가 아니다.
- 제공 `w100-devlog.txt`는 집계 7줄뿐이다. follower handoff/timeout, projector lock timeout,
  revision 미도달의 553건별 분포를 확정할 수 없다. 코드 경로와 dev 관측을 구분한다.

### 설계 선택

| 후보 | 결정·이유 |
|---|---|
| renew의 불필요한 projection·동기 publish 대기 제거 | 채택. 자신이 만든 outbox가 없으므로 기다릴 일이 없음 |
| DB session/epoch 잠금을 없애고 lease UPDATE만 수행 | 이번 제외. 종료/추방/capture.start 인계·멱등 ledger 동시성 설계 변경이 필요 |
| timeout 확대/성공으로 위장 | 제외. 지연 원인을 남기거나 projection이 필요한 명령의 보장을 훼손 |

`capture.renew`만 기존 DB apply/ledger commit 뒤 drain을 생략한다. 기존 scope/auth_revision 및
Redis 상태 검사는 유지하며 Redis 장애/권한 변경을 성공 처리하지 않는다. 성공 ACK의 기존
형식과 lease 값·duplicate 재생을 보존한다. 새 outbox/seq/revision을 만들지 않으며 타 명령의
projection 조건은 유지한다. WS 동기 publish와 REST publish 예약도 renew만 생략한다.
metric/device/일반 명령/heartbeat의 기존 drain·publish 및 지난 방송 누락 수정은 유지한다.
lease 만료/수집 허용 판정은 CaptureStream DB 값으로 하므로 projection과 독립이다.
ACK epoch가 달라진 경우 클라이언트의 기존 resync 경로를 유지한다.

### 로컬과 dev 차이·재현 계획

기존 S5는 서비스 직접 호출과 메모리 emit callback, 별도 publish 루프였다. 실제 Socket.IO
전송·ACK 직전 동기 publish·코치 snapshot burst120·단일 이벤트루프 CPU 압박을 포함하지 않았다.
새 하네스는 localhost 실제 Socket.IO server/client와 기존 v2 handler, PG/Redis,
100/40명 renew/metric 및 snapshot burst120, 고정 CPU busy slice를 사용한다. 로그인/REST 입장
인증은 합성 fixture로 주입하며 동일 장비 dev 완전 재현으로 주장하지 않는다. 전후 부하는 순차 실행,
baseline app 사본의 import/SHA를 고정하고 단일 표본 변동과 end-to-end/server CPU를 함께 기록한다.

### 구현·검증 체크리스트

- [x] 결정적 단위 RED: busy projector 상황에서 renew는 applied/duplicate, 일반 명령은 기존 retryable.
- [x] `class_participation_service` renew drain 생략, 기존 Redis/scope/ACK fail-closed 유지.
- [x] `session_live_namespace` 및 REST command route의 renew publish 생략; 다른 명령은 유지.
- [x] 대기 원인·소요 계측: DB transaction/session+epoch lock/projection/scope 시간, follower timeout과
  projector lock busy 구분. 세션 단위 주기 제한 로그로 payload/토큰 출력·로그 폭주 방지.
- [x] renew lease/generation/중복/종료 경쟁 기존 실제 PG 회귀 및 새 단위시험. PG 없으면 skip.
- [x] 로컬 Socket.IO 전후 100/40명 + burst/CPU 압박: ACK p95, pending, metric 저장, 교착,
  방송 callback coverage·source SHA·CPU 기록. 실제 성능이 기준 미달이면 숨기지 않고 다음 원인 분리.
- [x] 기존 12묶음 회귀 전후 비교, 독립 검토·검산 후 summary 및 로컬 fix(sdd-319) 커밋.

### 범위·위험

backend 및 specs만 수정. 푸시·PR·배포·서버 변경·운영/dev 부하시험·메일·삭제·시크릿 출력 금지.
DB 직렬화와 threadpool/CPU 병목은 남는다. renew 경량화만으로 모든 dev ACK≤2초를 보장하지 않는다.
Redis 장애 시 lease commit 이후 retryable 응답이라는 기존 동작을 유지한다. 마이그레이션 없음,
승인 후 이번 구현 커밋 revert가 롤백 경로이며 직접 실행하지 않는다.

## Addendum 5 (2026-11-07) — round-2 큐 진입·projection DB 표기 경량화 (구현 전)

브랜치 `sdd/319-renew-light-2`, 기준 develop `b6f165ec`. X100에서 renew pending은0으로
개선됐으나 renew p95 3.38초, close pending100이 남았다. 저장20000/20000, 교착/500/방송오류0.
로그 renew service 최대~605ms, WS queue+service 최대~1977ms, scope gate 최대~1285ms.
윈도우별 최대값은 서로 다른 요청일 수 있어 단순 차감/합산으로 p95를 확정하지 않는다.

### 확정 사실과 가설

- WS 정상 경로는 `_ensure_scope`의 `to_thread`와 `_run_command_sync`의 `to_thread`로
  공용 스레드풀 큐에2회 진입한다. scope_gate에는 실제 Redis 검사뿐 아니라 큐 대기도 섞여 있다.
- projector `_drain_locked`는 이벤트마다 `_mark_processed` UPDATE+commit을 호출한다.
  500행 batch에서 최소500commit. DB 표기용 processed_at은 재생 조회 조건이 아니다.
  `_pending_rows`는 Redis applied_revision만 기준으로 하며 재구축도 outbox 전체를 읽는다.
- close는 device.changed outbox를 만들므로 renew처럼 projection 대기를 생략할 수 없다.
  제공 x100-devlog는11줄 집계/renew 발췌이며 close 원인 로그가 없다. 전원100건의 timeout
  세부 원인을 확정하지 않고, 정상적인 projection 완료를 빠르게 하여 해소하는 설계다.

### 선택

1. **pre-scope 검사와 명령을 같은 worker에서 수행**한다. 정상 경로 큐 진입2→1.
   DB쓰기 전 scope 검사는 유지하고 ScopeStale이면 async로 기존 DB 재인가/resync를 수행한 뒤
   다시 검사하고 실행한다. 재차 권한 변경되면 bounded retryable이며 쓰기는 수행하지 않는다.
   post-commit scope 검사와 Redis 장애 응답은 그대로 유지한다. 제출→worker 시작 queue_ms를
   따로 기록해 실제 scope_ms와 큐 대기를 분리한다. TTL 권한 캐시는 사용하지 않는다.
2. **성공 prefix의 processed_at 표기를 batch finally에서1회 수행**한다. Redis projection은
   기존 fence/epoch/revision 순서로 각 행에 원자 적용하고, after_redis hook까지 통과한 마지막
   revision만 표기한다. 중간 실패시 앞선 성공 행 표기와 다음 drain의 applied-prefix 복구를 유지한다.
   crash로 표기가 없어도 Redis applied 기준으로 재생하며 전체 Redis 소실은 기존 rebuild가 복구한다.
3. DB epoch 잠금 제거, 스레드풀 확장/전용 풀, close 성공 ACK 위장/timeout 확대는 제외한다.
   현재 부하를 줄인 결과를 먼저 검증하고 권한/동시성/연결 수 변경을 피한다.

### 구현 전 검증 체크리스트

- [x] batch500행에서 표기 호출은 batch+복구/빈 확인의 소수회(≤4), 모든 이벤트 순서 유지.
- [x] 중간 after_redis 예외는 성공 prefix만 표기; 기존 crash 시험 [True,False,False] 유지.
- [x] 정상 WS command의 scope 검사→업무 처리가 같은 worker의1회 제출, 선인가 유지.
- [x] ScopeStale 재인가 성공/실패·재변경, Redis 오류 기존 경로, renew/start/close ACK 형식 유지.
- [x] 실제 Socket.IO100/40명: snapshot120+CPU 압박+5초 합성 heartbeat, 마지막 동시close 포함.
  renew≤2초/pending≤49(close0 목표), 실제 closed100%, 저장100%, 교착0·outbox방송누락0.
  시작 p95/renew/CPU를40명 전후 비교하고 단일표본 악화/실패도 공개.
- [x] 기존12묶음 및 새단위/실제PG crash·fence 회귀, PG부재skip, 증거DB/Redis 보존.
- [x] 설계 선커밋→구현→독립 리뷰/검산→summary와 로컬 fix(sdd-319) 커밋.

로컬 heartbeat는 실서비스와 같은 publish/heartbeat 읽기·emit을5초마다 실행하는 합성 스케줄러이며
실제 로그인/입장/권한 갱신 이벤트 전체를 대체하지 않는다. dev close100건과 동일 원인을 재현했다고
단정하지 않는다. 실패/미확정은 round-3 감독 관측으로 넘긴다. 서버접속/변경·푸시·PR·배포·
dev/운영부하·메일·삭제·시크릿 출력 금지 유지. 마이그레이션 없으며 승인 후 구현커밋 revert로 롤백.

### Addendum 5 보완 — 최초 projection 흔적 보존 (구현 전 독립 리뷰)

`rebuild`는 processed_at 존재를 과거 projection의 흔적으로 사용해 Redis 소실시 epoch를 올린다.
배치 표기가 최초 성공 흔적을 늦추면 epoch 판정의 기존 crash 창을 넓힐 수 있다. 따라서 applied=0의
첫 성공 행(after_redis hook 통과)은 즉시1회 표기하고, 나머지 성공 prefix를 batch finally로 표기한다.
500행의 호출 상한은4회(복구0/첫1/배치500/종료복구500)이며 이후 배치는 추가비용 없다.
첫 행 직후부터 흔적이 존재함과 기존 crash 복구를 단위/PG 회귀로 확인한다.

## Addendum 6 (2026-11-07) — round-3 renew 공유 잠금 (구현 전)

기준 develop `4854d33c`, 브랜치 `sdd/319-renew-light-3`. Y100은 실제 참가99/저장19800전량,
renew p95 2.05초, close pending0, reanchor pending5/metric timeout4다. renew max queue1349~1672ms,
session_epoch_lock413~611ms가 남았다. 집계 최대값은 서로 다른 요청이므로 합산하여 p95로 해석하지 않는다.

### 설계·정합성

- built-in capture.renew 및 commit=True일 때만 session FOR SHARE → epoch FOR SHARE를 사용한다.
  기존 다른 명령의 session NO KEY UPDATE 및 epoch UPDATE와 충돌하여 종료/추방/재구축/권한 변경,
  revision 경계는 유지하면서 서로 다른 stream의 renew만 병렬화한다. 완전 무잠금 경로가 아니다.
- epoch가 없으면 session SHARE 아래 INSERT ON CONFLICT DO NOTHING 뒤 epoch SHARE로 읽는다.
  공유→배타 잠금 승격을 하지 않는다. session 부재 FK 오류는 기존 session_not_found 처리를 따른다.
- epoch 뒤 (session, actor, command_id)의 안정된 SHA256 앞64비트로 transaction advisory lock을 잡고
  ledger를 읽는다. 동일 ID·다른 stream/body·거절 요청도 멱등/충돌을 보장한다. 해시 충돌은 추가 직렬화뿐이다.
- 기존 stream FOR UPDATE, 소유자/generation/entity_version 검사, ledger와 stream의 동일 commit,
  epoch 비교 및 ACK를 유지한다. lease 만료값 계산/활성 stream 재연장 정책은 변경하지 않는다.
  renew는 outbox/revision을 변경하지 않는다. 등록 handler 교체 및 commit=False는 기존 배타 경로를 쓴다.
- 전용 executor/풀 크기/DB설정/timeout 변경은 제외한다. 잠금을 기다리며 점유하던 worker 비용부터 줄인다.
- 제공 로그에는 reanchor/metric 실패 개별 trace가 없어 직접 원인을 확정할 수 없다. pending5는 기준49이하;
  기존 로컬 Socket.IO 하네스의 metric 실패·projection/방송 누락도 비교해 기록한다.

### 구현·검증 계획

1. ledger 공유 잠금 helper 및 built-in renew 선택만 수정한다. 신규 PG 회귀를 먼저 작성하고 baseline RED 확인.
2. 서로 다른 stream 동시 진행, 동일 ID 중복/다른 body, 같은 stream version 단조를 실제 PG로 검증한다.
3. 종료/close/revoke/rebuild 배타 잠금 경계, epoch 초기화, handler교체/commitFalse fallback을 검증한다.
4. 동일 localhost Socket.IO100/40명·32tick·snapshot120·CPU압박·5초 합성heartbeat로 전후 비교한다.
   renew≤2초, close pending0, 저장100%, 교착/방송누락0 및40명 입장/renew/CPU 악화 여부를 공개한다.
5. 기존 회귀12묶음 전후 비교, 독립 리뷰/검산, PG연결불가skip, summary 및 구현 커밋.

### 검증 체크리스트

- [ ] 새 PG 동시성 회귀 RED→GREEN 및 기존 멱등/epoch/fence 회귀
- [ ] 100/40명 전후 소켓 수치·실패 모두 공개, 소스 SHA 고정
- [ ] 기존 회귀 전후 비교·독립 리뷰·PG불가skip
- [ ] summary·로컬 구현 커밋 및 round-4 대기

backend와 specs만 변경한다. 푸시·PR·배포·서버설정/재시작·운영접근·dev부하시험·메일·삭제·시크릿출력 금지.
합성 DB/Redis 증거는 보존한다. 로컬 합성 heartbeat/입장주입 및 프로세스CPU의 기존 하네스 한계가 그대로
적용되며 dev 성공을 대체하지 않는다. 마이그레이션 없음, 승인 후 구현커밋 revert가 롤백 경로다.

### Addendum 6 보완 (구현 전) — renew 전용 소형 풀 실험

공유 잠금 단독100명 전후2표본에서 renew p95가1.165→1.549초,1.203→1.387초로 악화됐다.
첫 묶음 epoch 대기는 줄었지만 후반 queue/worker가 다시 늘었다. 같은 소스의40명 반복까지 원본을
보존하고, 공유 잠금만으로 개선됐다고 결론내리지 않는다. 감독이 요청한 전용 소형 풀 안을 이어 검증한다.

WS capture.renew만 프로세스당4worker ThreadPoolExecutor로 제출한다. pre-scope와 command는 같은
worker이며 contextvars는 copy_context로 전달한다. 다른 명령/heartbeat/snapshot은 기존 executor다.
4worker는 default32와 별개지만 renew끼리32개 DB작업을 동시에 만들지 않도록 제한한다. queue 대기는
기존 thread_queue_ms가 그대로 측정한다. scope 재인가·예외·취소의 DB commit 의미는 기존 to_thread와
같다. executor는 모듈에1개, 첫 제출 때 thread가 시작되며 표준 interpreter 종료 정리를 따른다.
서버설정·DB풀·프로세스수는 바꾸지 않는다. 정상 종료 경로에서 별도 shutdown이 필요한지는 독립 리뷰한다.

- [ ] default executor 포화 중 renew 진행, 동시worker≤4, context 전달 및 예외 전파를 RED→GREEN 검증
- [ ] 기존 scope stale/retry/권한/단일worker 시험이 전용풀에서도 같은 의미인지 확인
- [ ] 잠금단독 소스/실패 표본 보존 후 최종 variant100/40 측정, baseline 및 중간 variant 모두 공개
- [ ] 최종 소스SHA 기준 회귀·독립리뷰·검산 후 채택 여부와 미확정 사항을 summary에 기록
