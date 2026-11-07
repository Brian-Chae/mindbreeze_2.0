# round-3 독립 설계·코드 리뷰

검토일: 2026-11-07. 작업 브랜치 `sdd/319-renew-light-3`, 기준 `4854d33c`.
부모 구현자와 분리된 검토자가 production 두 파일의 diff와 호출 경계를 읽었다.
검토자는 production을 수정하거나 이 리뷰를 위해 PG/Redis 시험을 실행하지 않았다.

## 결론

**Critical/High 발견 없음.** builtin `capture.renew`의 단독 commit에만 공유 session/epoch 잠금을
사용하여 renew끼리 병렬화하고, 다른 명령·종료·추방·rebuild의 기존 배타 경계는 유지하는 변경이다.
아래 판단은 코드 정합성 검토이며 dev 성능 충족이나 모든 스케줄의 무교착 증명이 아니다.

## 확인 근거와 정합성 경계

| 항목 | 확인 근거 | 판단 |
|---|---|---|
| 적용 범위 | `session_live_commands.py:223`의 commit·kind·builtin handler identity 검사 | `commit=False` 복합 트랜잭션과 교체 handler는 기존 배타 경로 |
| 잠금 순서 | `session_live_ledger.py:103` session SHARE → epoch SHARE | 기존 session NO KEY UPDATE → epoch UPDATE 경로와 충돌; renew끼리만 공유 |
| epoch 신규 생성 | 같은 파일 107행의 INSERT ON CONFLICT DO NOTHING 후 SHARE 조회 | 공유→배타 승격 없음. 경쟁 INSERT는 최초 생성 트랜잭션 완료 후 재조회 |
| 명령 멱등 | 같은 파일 112행의 session/actor/command UUID를 SHA256 signed64로 변환하여 transaction advisory 잠금 | 프로세스별 hash 차이가 없고 stream 존재 검사보다 먼저 같은 원장 키를 직렬화 |
| ledger 재생 | `session_live_commands.py:236`의 잠금 후 find_entry/replay_or_conflict | 동일 ID 반복, 다른 body, 거절 원장도 기존 결과 재생 |
| stream 안전성 | `_handle_capture_renew` → `_load_stream`의 기존 FOR UPDATE 유지 | 동일 stream의 entity_version 증가·generation fencing·활성 상태 검사를 보존 |
| revision·방송 | builtin renew는 outbox를 추가하거나 epoch revision을 증가시키지 않음 | renew간 병렬화로 outbox revision gap 또는 추가 방송을 만들지 않음 |
| 종료·권한 회수 | end_session_cutoff/revoke_participant_capture 및 직접 추방 경로는 기존 lock_epoch 사용 | renew와 종료/회수 사이의 기존 직렬 순서 유지 |
| Redis rebuild | `session_live_outbox.py:186`의 lock_epoch | renew 공유 잠금과 충돌하므로 epoch 변경 중 오래된 epoch로 lease를 확정하지 않음 |
| 리스 만료 의미 | 기존 builtin renew는 만료된 active lease 자체를 거절하지 않음 | 이번 변경은 그 의미를 바꾸지 않으며 closed/revoked/superseded를 부활시키지 않음 |

cold 경로에서는 session FK 검사의 KEY SHARE가 이미 보유한 SHARE와 호환된다.
첫 INSERT 승자는 다른 renew의 session SHARE를 배타로 승격할 필요가 없으므로,
경쟁 INSERT의 unique 대기가 이 변경 자체로 공유→배타 승격 교착을 만들지 않는다.
정상 업무의 epoch 직접 DELETE는 발견하지 못했다. dev_data_reset의 전체 초기화는 별도 운영 경로다.

## 확인해야 할 시험과 한계

신규 PG 시험은 서로 다른 stream 병렬 진행, 같은 ID 100회, 같은 ID/다른 body,
entity_version 단조, 종료·추방·rebuild 경계 양방향, cold epoch 경쟁,
commit=False rollback, 교체 handler outbox, 만료 lease·fencing 거절을 대상으로 작성되어 있다.
실제 시험 통과 여부와 전후 수치는 별도 unit/회귀/소켓 evidence를 참조한다.

- 모든 원장 쓰기를 무잠금으로 바꾸는 설계가 아니다. 다른 명령과의 경합 및 공용 threadpool 대기는 남는다.
- 해시 충돌은 관계없는 요청을 추가 직렬화할 수 있으나 같은 원장 키를 분리하지는 않는다.
- 일반 호출자가 임의로 이미 변경한 ORM 객체를 들고 들어오는 모든 복합 트랜잭션을 증명하지 않았다.
  현재 서비스 호출 경로와 `commit=False` 제한을 기준으로 검토했다.
- dev 로그의 reanchor pending 5건·metric timeout 4건은 요청별 trace가 없어 이 코드 리뷰만으로 원인을 확정하지 못한다.
- 로컬 합성 부하의 renew 개선은 dev p95 ≤2초의 보장이 아니다. 감독 round-4에서 확인해야 한다.
- 전용 executor, DB 설정, 마이그레이션, 서버 설정 변경은 이번 구현에 없다.

## 리뷰 대상 SHA256

| 파일 | SHA256 |
|---|---|
| `backend/app/services/session_live_commands.py` | `afef039950b20887b0730826dd6aca3e8cac6b7670ba95efbad3553719ab1049` |
| `backend/app/services/session_live_ledger.py` | `6f75c4aca1e577ad27dcb3bcfbf33cb44b2ff9b21d3e46028311043e2ee5dae9` |

## 추가 독립 조사 — metric timeout 이후 9창 ignored

- 확정: 하네스 close는 모든 member/refresh 루프가 끝난 후 시작한다. 정상 metric과 조기 close 경합은 없다.
- 확정: 각 member는 metric/store ACK를 기다리며, `call(timeout=30)` 중에는 다음 tick과 renew도 멈춘다.
  renew는 매10tick, CAPTURE_LEASE_SECONDS는30초다. ingest는 만료 lease를 ignored:not_live로 응답한다.
- 가설: metric ACK30초 대기 → lease 만료 → 다음 renew 전 최대9창 ignored가 가능하다.
  전후 `metric TimeoutError1 + ignored9` 패턴과 일치하지만 stream/sequence별 시각이 없어 동일 회원임을
  확정할 수 없다. 최초 ACK timeout의 DB/방송/전송 단계 원인은 미확정이다.
- dev metric timeout4와 같은 원인이라고 단정하지 않는다. 이 조사로 코드나 timeout/리스 기간을 바꾸지 않았다.

## 읽기 전용 하네스 조사 — metric timeout과 not_live 후속 실패

대상: 변경하지 않은 `backend/tests/sdd319/test_round2_socket_load.py`와
`live_ingest_service._screen_windows`. 첫 100명 전후 표본에서 metric TimeoutError 1건과
ignored:not_live 9건이 함께 나타났다. 아래는 집계와 코드에서 구분한 사실·가설이다.

| 구분 | 내용 |
|---|---|
| 확정-코드 | client.call 제한은30초이며, 회원별 루프는 metric/store ACK를 모두 기다린 뒤 다음 tick으로 진행한다. |
| 확정-코드 | renew는 별도 타이머가 아니라 같은 회원 루프의 tick % 10 == 0에서만 호출된다. |
| 확정-코드 | capture lease는30초이며, active·cutoff없음·lease유효 조건이 아니면 metric은 ignored:not_live다. |
| 확정-코드 | 모든 member 루프와 snapshot gather가 끝난 뒤 close gather를 시작하므로 정상 후속 metric의 조기 close 경합은 없다. |
| 확정-집계 | 해당 표본은 metric timeout1·not_live9, 저장3200/3200, close100, 방송 callback/client 쌍 누락0이다. |
| 가설 | 한 metric의30초 ACK 대기가 같은 회원 renew도 멈추고, lease가 만료된 상태로 다음 renew tick 전 최대9개 창을 보내 not_live가 된 패턴과 일치한다. |
| 미확정 | 집계에 stream/sequence별 시각이 없어 timeout과9개 ignored가 같은 회원의 연속 사건인지는 확인하지 못했다. |
| 미확정 | 최초 metric timeout의 원인이 DB 처리·방송 대기·ACK 전달 중 어디인지는 이 자료로 확정하지 못했다. |

측정 중 종료·추방·stream 교체 명령을 보내지 않는 하네스 구조상 not_live의 lease 만료 설명이
타당하지만, 이를 실제 dev의 metric timeout과 동일 원인으로 단정하지 않는다.
기준선에도 있는 실패를 숨기거나 완전 통과로 바꾸지 않으며, 공유 잠금 변경에 의한 신규 회귀라고
단정하지도 않는다. 이 조사에서 하네스·production 코드를 변경하거나 PG를 실행하지 않았다.


## 추가 설계 794a0ece 이후 — renew 전용 4worker 독립 리뷰

공유 잠금 단독의 100명 소켓 표본에서 renew 지연이 기준선보다 증가하여, 설계 보완 선커밋 뒤
추가한 `session_live_namespace.py` diff를 읽기 전용으로 검토했다. **Critical/High 발견 없음.**
위 첫 리뷰의 두 production 파일에 namespace 한 파일이 추가된 최종 범위다.

| 확인 항목 | 근거·판단 |
|---|---|
| 프로세스당 하나 | 모듈 `_RENEW_EXECUTOR` 하나를 만들며 `register_v2_handlers`나 연결마다 새 풀을 만들지 않음 |
| 동시성 한도 | `max_workers=4`, 이름 `mb-renew`; 큐 자체의 크기는 제한하지 않으며 실행 중 worker만4개로 제한 |
| 요청 범위 | `cmd.kind == "capture.renew"`만 전용 dispatch; 다른 명령은 기존 `asyncio.to_thread` |
| 인가·업무 경계 | `_checked_command_sync` 전체를 제출하여 scope 검사와 명령이 같은 worker에서 실행됨 |
| context 전달 | 매 호출 copy_context 후 `context.run`으로 실행; asyncio.to_thread의 context 전파 의미 유지 |
| loop 수명 | executor 자체는 event loop에 묶이지 않고 매 호출 현재 loop에서 future를 래핑하므로 반복 loop에 재사용 가능 |
| 예외·취소 | executor future의 예외를 그대로 await; 이미 실행 중인 worker는 coroutine 취소만으로 강제 중단되지 않는 기존 의미 유지 |
| 재인가 | ScopeStale은 기존 bounded 재인가/재검사 경로; 이 변경으로 권한 확인을 생략하지 않음 |
| DB 자원 | DB 세션 생성·close는 기존 `_run_command_sync` 안에 있고 요청 간 세션을 공유하지 않음 |
| 종료 | 표준 ThreadPoolExecutor의 프로세스 종료 join에 맡김. 연결/요청 종료마다 shutdown하지 않음 |

전용 pool이 GIL·DB 자원을 별도로 확보하는 것은 아니므로 default pool과의 CPU/DB 경합은 남는다.
4worker가 항상 최적이라는 근거는 없으며, 100명·40명 전후 측정 및 다른 명령/저장/CPU 확인이 필요하다.
전용 queue의 무제한 적재, 프로세스 종료 시 장기 DB 작업 대기는 기존 to_thread와 같은 운영상 한계로 남는다.
이 리뷰는 독립 단위시험·부하 실행을 대체하지 않는다. 검토자는 PG 시험을 실행하지 않았다.

| 추가 파일 | 리뷰 SHA256 |
|---|---|
| `backend/app/ws/session_live_namespace.py` | `ffe52b261e4bd8d76fa75970daee637debfff53cd273902b2227043b94a4d98f` |


## 최종 재설계 90341fed 이후 — 전용 풀 철회 및 SQL 왕복3개 축소

**이 절이 최종 production 리뷰다.** 위 전용4worker 절은 실패한 중간 실험 기록이며 최종 채택안이 아니다.
전용 풀은 100/40명 부하에서 renew 목표를 넘어서 namespace 변경을 기준선으로 복구했다.
최종 production 변경은 다시 `session_live_commands.py`, `session_live_ledger.py` 두 파일뿐이다.
독립 diff 검토에서 **Critical/High 발견 없음**.

| 항목 | 최종 확인 |
|---|---|
| 공통 guard | `lease_only` 하나로 공유 잠금과 SAVEPOINT 생략을 함께 선택; builtin renew + commit=True로 제한 |
| session 재사용 | helper에서 전체 Session 객체를 SHARE + populate_existing으로 읽어 반환; 상위 db.get 캐시도 새 값으로 갱신 |
| session 안정성 | SHARE 잠금을 commit까지 유지하므로 객체 재사용 중 status/ended_at의 비키 UPDATE도 차단 |
| 중복 SELECT 생략 | 반환 session이 있을 때 후속 조회 생략; 일반 명령은 기존 조회 유지 |
| SAVEPOINT 생략 | `_load_stream`·활성상태·세션종료·generation의 결정적 거절은 필드 변경 전; builtin에서만 nullcontext |
| 예상 밖 오류 | stream 필드 변경/flush 뒤 예외는 기존 except Exception에서 DB 전체 rollback |
| custom/commitFalse | 기존 배타 잠금·begin_nested 유지; 부분 변경 거절 및 복합 트랜잭션 계약 유지 |
| namespace | 기준선과 diff 없음. 기본 asyncio.to_thread 재사용; 전용 executor 없음 |

정상 warm renew에서는 SAVEPOINT, RELEASE, 후속 Session SELECT의3개 SQL 왕복이 줄어든다.
cold epoch 초기화와 결정적 거절의 refresh 등은 동일 수치로 일반화하지 않는다.
성능 채택 여부는 이 소스 SHA로 실행한 최종 부하 결과를 기준으로 하며 중간 실패 표본을 보존한다.
신규 SQL 횟수·rollback PG 시험의 실행 결과는 별도 시험 증거를 참조한다. 리뷰 중 PG는 실행하지 않았다.

| 최종 파일 | SHA256 |
|---|---|
| `backend/app/services/session_live_commands.py` | `ad5a9ef812e8322d4d8599a85103cc068564a1792dde7b2d97af385898cd3839` |
| `backend/app/services/session_live_ledger.py` | `1e89531fa2e18b45b9e5dddc23115f5e78d79d76ad54024fa34c9226950a66cf` |
| `backend/app/ws/session_live_namespace.py` | `802c2d843cea1e1c51ee938e5eb7d9d271f1fd8481f778f2c9dad5acd8f6b191` |

## 후속 독립 회귀 실행 결과

최종 소켓 부하 종료 후 감독 인계를 받아 같은 검토자가 BEFORE→AFTER12묶음을 순차 실행했다.
위 코드 리뷰 중 PG 미실행이라는 기록과 구분되는 후속 검증이다.

| 항목 | 결과 |
|---|---|
| BEFORE | 400통과·4실패·6생략 |
| AFTER | 400통과·4실패·6생략 |
| 신규 실패·오류·timeout | 0·0·0 |
| 기존 실패 | ingest 계약 검사4개의 jsonschema ModuleNotFoundError, 전후 동일 |
| 시험 대상·실패 node ID | 12묶음 전후 동일 |
| 회귀 소스 | 실행 전후7파일 SHA 고정, 현재 소스와 일치 |
| 최종 소켓 소스 | SQL축소100/40명 각2표본의4파일 SHA와 회귀·현재 소스 일치 |

기존 round2 pipeline8개와 socket 기본skip1개가 포함되어 이전 round2 집계보다 통과8·생략1이 증가했다.
신규 round3 PG 잠금 시험과 미채택 experimental executor 시험은 별도 집계로 제외했다.
원본 JSON·임시 로그와 합성 DB/Redis 증거를 보존했으며 comparison은 `regression-comparison.json`이다.
