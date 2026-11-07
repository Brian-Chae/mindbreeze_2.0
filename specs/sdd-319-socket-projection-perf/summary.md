# SDD-319 — Summary

## 측정(dev, py-spy 50Hz, 40명×200초 재현)
| 항목 | 값 |
|---|---|
| 스레드 샘플 중 metric/device 직후 방송(`publish_session_sync→publish_pending→drain`) | 72% |
| `_acquire`(projector 락 20ms 폴링) | 18% |
| SQLAlchemy 실행 / Redis 왕복 / DB ping | 24% / 약 20% / 약 8% |
| 소켓 CPU 평균/최대 | 91% / 120% |
원인: metric 건별 방송과 명령 drain 이 같은 회차에서 직렬 중복 실행되어 락 경합(busy → projection_pending).

## 수정(backend 만)
- 신규 `app/services/live_single_flight.py`: 방송 합류(`run_coalesced`, dirty 재실행으로 누락 0), 명령 drain 합류(`coalesced_drain`, leader 결과 공유·미달 시 직접 drain 폴백).
- 적용: `publish_session_sync`, `run_live_command`, `publish_pending` 내부 drain. 프로토콜·응답 형식·스키마 변경 없음.

## 시험
| 구분 | 결과 |
|---|---|
| 신규 tests/sdd319 (단위 6 + PG/Redis 1) | 7 통과 |
| 회귀(sdd246/285/306, sdd024/026, live_v2, metric_profile, mb2_ws_mid_fixes) | 360 통과, 4 실패 = 변경 전에도 동일 실패(test_live_ingest_pg 4건, 신규 0) |

## 로컬 전/후(실 PG+Redis, 방송 30스레드+명령 20스레드, 8초)
| 지표 | 전 | 후 |
|---|---|---|
| 명령 처리량 | 1122 | 2084 |
| 명령 p50 / p95 | 52 / 343ms | 18 / 63ms |
| drain 호출/명령 | 3.05 | 0.84 |
| projection_pending | 0 | 0 |

## dev 재시험 비교표(감독 기입)
| 지표 | 기준선(11/7 dev) | 변경 후 | 합격 |
|---|---|---|---|
| entry.enter p95 | 3.05초 | | <1.5초 |
| capture.renew projection_pending | 6건 | | 0 |
| capture.renew p95 | 2.86초 | | 하락 |
| metric p95 | 1.81초 | | 하락 |
| 소켓 CPU 평균/최대 | 91%/120% | | 평균 하락 |
| 분석창 저장률 / 5xx | 100% / 0 | | 유지 |

## 롤백
해당 커밋 revert 1건(DB·스키마·설정 변화 없음, 서비스 재시작만).

---
## 2차 — 100명 projection_pending 회귀 수정 (11/7)

### 1차 dev 재시험(감독, 같은 서버, stage3.sh 200초)
| 항목 (p95) | 40명 전(F40) | 40명 후(S40) | 100명 전(Q100, 11/5) | 100명 후(S100) |
|---|---|---|---|---|
| ws entry.enter | 3.05s | 1.26s | 10.3s | 1.75s |
| ws capture.renew | 2.86s | 0.98s | 5.6s | **7.4s** |
| ws metric | 1.81s | 0.65s | 3.3s | 2.2s |
| REST enter | 2.70s | 2.96s | 21.8s | 13.2s |
| REST features_batch | 0.52s | **1.77s** | 0.16s | 0.21s |
| projection_pending | 6 | 0 | 49 | **801** |
| 소켓 CPU 평균/최대 | 99/120% | 62/109% | 112/121% | 107/121% |
| 저장 | 7995/8000 | 8000/8000 | 15200/15200 | 18800/18800 |

### 원인(로컬 실 PG+Redis, 100명 상당: 방송 75스레드+명령 50스레드, 8초)
- 1차 구현(`coalesced_drain`)은 follower 가 leader 를 `wait_s`(2s) 기다린 뒤 **미달/지연 시 직접 drain 폴백(추가로 락 대기 최대 2s)** → 이중 대기. 로컬 풀 20·1차 구현: 명령 275건, p50 2.1s, 폴백 421회/drain 429회, projection_pending 11.
- 대기 중 follower 가 **DB 연결을 쥔 채** 대기(`publish_pending` 의 emit-lock 대기 포함) → 스레드 수가 풀(20+20)을 넘으면 leader 자신도 연결을 못 얻어 drain 이 2s 가까이 걸림(drain p50 223ms/max 2.5s). 풀 100으로 늘리면 같은 코드에서 p50 163ms·pending 0 — 즉 병목은 합류 로직 자체보다 **대기 중 연결 점유 + 폴백 이중 대기**.
- 방송(need=0)이 명령 leader 뒤에서 최대 2s 대기해 방송 스레드가 쌓임. publish 재실행 최대 20회 연속이 스레드를 독점.
- 40명 features_batch 0.52→1.77s: REST 프로세스 코드는 변경이 없어 DB 경합 간접 영향 또는 측정 편차로 판단(로컬 재현 불가, dev 재시험에서 재확인 필요).

### 수정(backend 만, 프로토콜·응답 불변)
| 항목 | 내용 |
|---|---|
| 폴백 이중 대기 제거 | follower 는 대기자 큐에 등록. leader 종료 시 revision 충족자는 결과 공유, 미충족자 중 최신 revision 1명이 **다음 leader 로 handoff**(락 재경합 대신 직렬 이어받기). 대기는 `wait_s` 한 번만, 초과 시 `busy` 반환 → 기존 projection_pending ACK 경로 |
| 방송 경로 비대기 | `need_revision=0`(publish_pending) 은 drain 진행 중이면 대기 없이 건너뜀(그 drain·다음 방송이 반영) |
| 연결 반납 | 대기 전 `db.rollback()`(before_wait), emit-lock 대기 전에도 rollback → 풀 고갈 방지 |
| publish 재실행 | 상한 20→5, 재실행 사이 5ms 양보. 남은 dirty 는 다음 방송 호출/heartbeat self-heal 이 반영(누락 0 근거: 워터마크 `emitted` 는 방송 성공 후에만 전진) |
정합성: revision 단조·부수효과 1회(run_live_command 구조 불변, `_run_callbacks` 그대로)·누락 0(워터마크+heartbeat).

### 로컬 전/후(풀 20, 100명 상당, 8초, 같은 하네스)
| 지표 | 1차 구현 | 2차 |
|---|---|---|
| 명령 처리 | 248 | 2454 |
| p50 / p95 | 2090 / 2566ms | 98 / 135ms |
| projection_pending | 7 | 0 |
| 40명 상당 p50/p95 | 17/29ms | 10/49ms (pending 0) |

### 시험
tests/sdd319 12 통과(신규 R1~R5) + 벤치 2 skip, 회귀 묶음 360 통과·4 실패(test_live_ingest_pg 기준선과 동일, 신규 0).

### 위험·롤백
handoff 대기자가 예외 시 leader 가 그대로 전파, 대기자는 시한 초과 busy→클라 재시도. 회귀 시 이 커밋 revert 1건(DB·설정 없음, 서비스 재시작만).

## 3차 — 동시 입장 대기줄 (11/7)
### 막힘 원인(코드)
| 위치 | 내용 |
|---|---|
| `app/api/deps.py:24,45` | `get_current_user` 가 `get_db` 에 의존 → 요청 시작 시 사용자 조회로 연결을 잡고 응답 끝까지 보유 |
| `app/services/class_code_service.py:164,167,171` | join: 사용자 행 FOR UPDATE(key_share) → **클래스 행 FOR UPDATE** → 멤버 전체 FOR UPDATE. 같은 클래스 100명이 직렬화 |
| `app/services/session_service.py:2138,2176` | enter: `lock_class_session`(클래스/회차 잠금) + `_lock_session_for_capacity`(회차 행 잠금). 같은 회차 직렬화 |
| `app/api/v1/classes.py:324,335` | join 은 `code_limited` 가 threadpool(anyio 64)에서 실행, enter(`session.py:600`)는 sync(threadpool) |
→ 잠금 대기 요청이 모두 DB 연결(풀 20+20=40)을 쥔 채 대기 → 100 요청 > 40 연결 → `QueuePool limit` 30초 타임아웃·500(운영 로그와 일치). CPU≈0 도 일치.
### 설계
| 항목 | 값·근거 |
|---|---|
| 위치 | `app/services/entry_queue.py`, 라우트 **데코레이터 `dependencies`** 로 `join_slot`(클래스 키)·`enter_slot`(회차 키) 장착 — 인자 의존성(`get_current_user`/`get_db`)보다 먼저 해석(시험 Q6 로 순서 검증) → 대기 중 DB 연결 0 |
| 상한 | `ENTRY_QUEUE_CONCURRENCY` 기본 5 (0 이하=비활성). 같은 행 잠금이라 처리량은 상한 늘려도 직렬이고, 연결 점유를 5 이하로 묶음 |
| 대기 시한 | `ENTRY_QUEUE_WAIT_SEC` 기본 45초(앱 타임아웃 60초 미만) |
| 초과 응답 | 503 `{"code":"entry_busy","retryable":true}` + `Retry-After 2~6`. 프론트(`useEnterClass.ts`, `client.ts`)는 503 을 `ApiError(status)` 로 전달하므로 앱 변경 없이 기존 일반 오류 경로. SDD-308 `lock_busy`(503) 와 같은 계열 |
| 프로세스 범위 | nginx `mb_backend` map 에서 join/enter 는 허용목록 밖 → `mb_socket`(8000 단일). 프로세스 로컬 asyncio 세마포어로 충분. REST 인스턴스로 가더라도 인스턴스별 상한이라 연결 점유는 (상한 x 프로세스)로 제한 |
| 누수 방지 | 취소·타임아웃·예외 모두 사용자 카운터 정리, 키는 사용자 0 이면 삭제 |
### SDD-308 재사용
| 커밋 | 판단 |
|---|---|
| `4a18d630` 교착 재시도(`_retry_on_lock_conflict`) | **이번 범위 밖(별도 머지 권장)**. 이번 장애 원인은 교착이 아니라 풀 고갈. 대기줄로 동시성이 5 로 줄면 교착 확률도 감소하나, 직렬화 보장은 안 하므로 머지 시 보완적. 그대로 머지 안 함 |
| `7de4f870` 잠금 순서 통일 | 동일 사유(보완적), 이번엔 미적용 |
| `27076f03`, `a7660e0c` | 무관(seed_live_state·새로고침 조회 최적화) |
### 시험
| 항목 | 결과 |
|---|---|
| tests/sdd319/test_entry_queue.py Q1~Q6 | 6 passed |
| 회귀 묶음(sdd319·306·285·246·contract·class flow 등) | 473 passed, 4 failed — 4건은 변경 전(stash)에도 동일 실패(`sdd246/ingest/test_live_ingest_pg.py`), 본 변경 무관 |
| 로컬 실 PG 100 동시 join (풀 20+20, pool_timeout 3, 클래스 행 FOR UPDATE 0.15s) | 전: 성공 59/100, 나머지 풀 대기 타임아웃, max 9.1s · 후(상한 5): 성공 **100/100**, 오류 0, p95 14.9s, max 15.7s |
### 위험·롤백
- 직렬 처리 시간 x 100 이 대기 시간이 됨(로컬 15.7s=0.15s x 100). 실제 join 처리가 느리면(운영 수백 ms) 45초 초과 → 503 재시도. 상한은 환경변수로 조정.
- 롤백: `ENTRY_QUEUE_CONCURRENCY=0` (서버 환경변수 + 재시작, 코드 롤백 불필요).
- 못 한 것: dev/운영 부하 시험(금지), 실제 join_class_code·enter 서비스 전체를 PG 에서 100 동시로 돌린 전/후(합성 잠금 모사로 대체).

## SDD-319b (2026-11-07) — 방송 누락 수정 및 감독 dev 피드백 대기

### 결론·원인

로컬 서비스 통합 시험에서 100명 62/8202, 40명 10/3282였던 callback 누락이 모두 0으로 감소했다.
전후 실제 PG/Redis를 사용했고 각 실행은 단독 수행했다. 누락 72건 전부 실제 replay cursor와
stream seq를 대응하여 seq 밀림으로 확정했다. watermark 일치만으로 판정하지 않았다.

| 누락 원인 | 수정 전 100명 | 수정 전 40명 | 수정 후 100명/40명 |
|---|---:|---:|---:|
| seq 밀림 | 62 | 10 | 0 / 0 |
| replay 불가 | 0 | 0 | 0 / 0 |
| emit callback 실패 | 0 | 0 | 0 / 0 |
| 기타 | 0 | 0 | 0 / 0 |

### 설계와 코드

설계 선커밋 `0ca7365f` 뒤 production을 수정했다. 후보 b를 채택하여 같은 원자 snapshot의
seq와 applied_revision으로 보수적인 cursor 하한을 계산한다. DB 스키마·outbox 저장·프로토콜·
응답 형식·앱·프론트는 변경하지 않았다. projector 공통 락은 추가하지 않는다.

- `events_for_rows`: 대상 이후 revision 수를 seq 증가 상한으로 반영, event_id/audience/domain
  정확 필터, 동일 epoch 고정. 오래된 하한의 log_truncated는 첫 보존 seq부터 1회 재조회.
- `publish_pending`: 모든 audience callback을 성공한 연속 revision prefix만 전진.
  최초 gap에서 후속 방송 중단. emit 실패는 전파하여 재시도하며 중복 허용.
- Lua checkpoint: 락 token·epoch·status 확인, TTL 갱신, watermark 단조 쓰기를 원자 실행.
  시작/종료 및 방송 중 1초 간격으로 확인한다. payload·인증값을 로그에 쓰지 않는다.

### 로컬 전후 수치

| 항목 | 전 100명 | 후 100명 | 전 40명 | 후 40명 |
|---|---:|---:|---:|---:|
| callback 누락 / 기대 쌍 | 62 / 8202 | **0 / 8202** | 10 / 3282 | **0 / 3282** |
| 교착(내부 retry 포함) | 0 | 0 | 0 | 0 |
| projection_pending | 29 | 36 | 0 | 0 |
| renew p95(초) | 0.758849 | 0.668566 | 0.028857 | 0.029316 |
| 서비스 enter p95(초) | 7.698264 | 9.938 | 1.654897 | 1.710751 |
| metric 성공/실패 | 3200/0 | 3200/0 | 1280/0 | 1280/0 |
| 입장/시작/종료 | 100/100/100 | 100/100/100 | 40/40/40 | 40/40/40 |
| 서비스 HTTPException 500 | 0 | 0 | 0 | 0 |

40명 renew +0.459ms/enter +55.854ms, 100명 enter 약 +2.240초 및 pending +7의 단일 표본
변동을 숨기지 않는다. 100명 pending≤49/renew≤2초 기준은 통과하나 모든 지표의 무악화를
증명한 것은 아니다. 실제 소켓 CPU·HTTP/WS 네트워크 지연·클라이언트 수신·화면은 감독 dev 시험 범위다.

### 검증

- 구현 전 핵심 단위시험 2실패/1통과. 보존한 baseline app 재실행에서도 seq 밀림·watermark
  2개 회귀시험 실패를 재확인했다(`unit-red.log`). 수정 후 13통과(`unit-green.log`).
- 실제 Redis checkpoint 5종: 전진·후퇴 방지·락 상실·epoch 교체·building 상태.
  독립 검증자도 13통과/생략0 재확인, production diff Critical 없음.
- PG 연결 불가 포트로 `S308_MEASURE=1` 명시 실행: 5 skipped, exit0. CI PG 부재 시 실패하지 않음.
- 100/40명 각각 측정 및 실제 상태전이/멱등 4개 포함 5통과. 동일 production SHA 확인.
- 기존 회귀 12묶음: 전후 각각 **365 통과·4 실패·4 생략**, 오류/시간초과 0. 실패 node ID 동일.
  evidence-broadcast JSON 및 독립 검산 스크립트에 보존한다.
  기존 jsonschema 모듈 미설치 실패는 환경을 수정하거나 숨기지 않는다.
- SDD-285 'replay 불가에도 watermark 전진' 시험 1개는 요구에 따라 '유지' 계약으로 변경했다.
  기존 동작을 그대로 통과했다는 의미가 아니다.

### 위험·롤백·감독 관측

`broadcast_progress`의 applied/emitted/expected/sent와 첫 미완료 행의 missing,
`broadcast_gap`·`broadcast_emit_failed`·`broadcast_lease_lost`를 함께 확인한다.
기대=전송 및 실패0, 종료 revision 일치는 서버 callback 단계 증거다. 실제 클라이언트 coverage는
별도 소켓 수신 집합 검증이 필요하다. [재현·로그 판정 설명](evidence-broadcast/README.md) 참조.

실제 stream 영구 절단은 후속 방송도 막으며 heartbeat snapshot resync가 복구 경로다.
느린 단일 callback이 5초 lease를 넘는 경우 이미 시작한 외부 전송은 취소할 수 없다.
checkpoint는 stale watermark 쓰기를 막지만 엄격한 네트워크 수신 순서는 보장하지 않는다.
마이그레이션이 없어 승인 후 구현 커밋 revert로 롤백 가능하며 이번 작업에서 실행하지 않았다.

푸시·PR·배포·서버 접속/설정 변경·재시작·dev 부하·운영 접근·메일·삭제는 수행하지 않았다.
메인 체크아웃은 기존 venv 실행파일만 사용했다. 감독이 dev 결과를
`~/.hermes/share/loadtest-40/feedback-319b/round-N.md`로 전달하면 같은 브랜치에 개선 커밋을 쌓는다.

## round-1 (2026-11-07) — renew의 불필요한 projection·방송 대기 제거

### 결론과 범위

브랜치 `sdd/319-renew-light`, 기준 develop `bb78a4d9`. 설계는 구현 전에 `7e8f3b04`로 커밋했다.
renew는 원래 outbox를 만들지 않는데도 다른 명령의 revision까지 기다리고, WS ACK 직전 동기 방송까지
수행하고 있었다. 이 두 대기를 renew에서 제거했다. DB 잠금·리스·멱등·인가·응답 형식은 유지했다.
최종 로컬 Socket.IO 100/40명에서 renew p95≤2초·pending0, 저장100%·outbox 방송 누락0을 확인했다.
다만 100명 실시간 metric의 `ignored:not_live`가2→9로 증가했으며 이를 미해결 관측으로 남긴다.
**dev round-2 합격 또는 전체 화면 갱신100%를 선언하는 결과가 아니다.**

### dev 원인 확정 범위와 로컬 차이

- 감독 W100: renew p95 5.18초, pending557 중 renew553. 교착/500/QueuePool/방송 실패 로그0,
  저장20000/20000. 제공 로그는7줄 집계로 요청별 대기 세부 원인은 없다.
- 코드상 pending 직접 경로는 DB commit 이후 `coalesced_drain` 합류 시한, Redis projector lock
  획득 실패, 적용 revision 부족, 기타 LiveNotReady다. epoch DB 잠금/emit-lock 자체가 이 code를
  반환하는 것은 아니다. emit-lock/동기 publish는 ACK p95/timeout에는 영향을 줄 수 있다.
- 기존 S5는 서비스 직접 호출·메모리 callback이고 실제 WS ACK 전 publish, snapshot120,
  단일 이벤트루프 CPU 포화를 포함하지 않았다. 새 하네스는 실제 localhost Socket.IO v2 handler와
  PG/Redis, snapshot120 동시 요청, CPU15ms/25ms 압박을 사용한다.
- 새 하네스도 로그인/입장·V2Conn을 주입하며 연결별5초 heartbeat는 실행하지 않는다.
  client도 같은 프로세스의 별도 이벤트루프이므로 CPU 수치는 서버 단독 CPU가 아니다.
  회원별 ACK 대기 뒤 다음 tick에 진입하는 순차 구조이며 dev 부하 발생기와 동일한지는 미검증이다.

### 설계·정합성

| 수정 | 유지 근거 |
|---|---|
| renew에서 service drain 생략 | handler는 lease/anchor/entity_version만 UPDATE, outbox·회차 revision 불변 |
| renew에서 WS 동기 publish·REST 예약 생략 | 새 이벤트가 없고 일반 명령/metric/device/heartbeat가 기존 publish를 지속 |
| DB session→epoch→stream 잠금 유지 | 동일 command 멱등·generation fencing·종료/추방/인계 경쟁 안전성 유지 |
| Redis/scope 검사 유지 | 장애·권한 변경을 성공 처리하지 않음, 기존 ACK/lease·duplicate 형식 유지 |
| 10초 단위 지연 집계 | DB transaction·session/epoch 잠금·projection·scope·WS threadpool 구간 분리, wire 변경 없음 |

DB 직렬화를 제거하는 lease-only SQL fast path는 별도 동시성 설계가 필요해 이번 제외했다.
metric/device의 동기 publish를 비동기화하는 후보도 검토했으나, 하네스 순차 스케줄 영향과 실제 dev
인과가 미확정이고 예약 부하·화면 지연 재검증이 필요하므로 이번 renew-only 범위를 유지한다.

### 로컬 실제 Socket.IO 전후 (32tick, snapshot120, CPU 압박)

100명은 같은 보강 barrier의 before100-r3/after100-r2, 40명은 before40/after40 비교.
40명 기준선도 종료 시 revision과 전체 coverage가 일치함을 확인했다. 부하/회귀는 모두 순차 실행했다.

| 지표 | 전100명 | 후100명 | 전40명 | 후40명 |
|---|---:|---:|---:|---:|
| renew p95(초) | 1.657193 | 1.591183 | 0.585226 | 0.489991 |
| projection_pending | 2 | 0 | 0 | 0 |
| 프로세스 CPU 평균(%) | 105.768 | 105.175 | 85.379 | 82.073 |
| 실제 분석창 저장 | 3200/3200 | 3200/3200 | 1280/1280 | 1280/1280 |
| outbox callback 쌍 누락 | 0 | 0 | 0 | 0 |
| client 수신 쌍 누락 | 0 | 0 | 0 | 0 |
| 실시간 metric ignored:not_live | 2 | **9** | 0 | 0 |
| 교착 / 최종 실행 timeout | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

100명 baseline3표본 renew p95는1.657~3.010초, pending1~4로 변동하며 모두 보존했다.
각 baseline pending 수와 single-flight drain_timeout 카운터가 일치한다. 이는 로컬 분류 증거이며
W100 dev renew553건을 전부 동일 원인이라고 확정한 것은 아니다.
수정 후 계측의 renew projection_ms는0이다. 100명 CPU는 여전히 약105%로 포화되어 있다.
수신 coverage는 `(event_id,audience)` 합집합이고 연결별 전달·화면 렌더링100%를 뜻하지 않는다.

### 실패 표본·미해결 관측

첫 after100에서 metric ACK TimeoutError1과 방송 미수집438쌍을 관측했다. 후자는 DBrevision3493−
applied/emitted3274=219행×2audience와 일치하고 방송 gap/emit_failed/lease_lost는0이었다.
final publish는 single-flight 실행중이면 즉시 반환하여 완료 barrier가 아니었다. 하네스를 고쳐
측정 부하 종료 후 DB/applied/emitted 일치와 publisher idle까지 기다리고 대기시간을 별도 기록했다.
첫 표본을 삭제하거나 통과로 바꾸지 않았다.

metric timeout1은 실제 측정중 오류이며 재실행에서 재현되지 않았다는 사실만 확인했다.
`ignored:not_live`9건은 두 after100에서 반복됐다. 하네스가 metric ACK를 기다리느라 다음 renew를
늦추면 lease가 만료될 수 있다. close/end/remove 없는 합성 run이라 lease 만료로 추론되지만
요청 시점 DB lease를 직접 캡처하지 않아 인과를 확정하지 않는다. 저장은100%이며, 이9건은
outbox로 채택되지 않은 입력이라 outbox callback 누락0과 구분한다. round-2에서 metric timeout/
ignored 코드·lease 갱신 간격 및 실제 클라이언트 타이머 동작을 함께 확인해야 한다.

### 검증과 감독 관측

- renew 신규/중복 ACK·WS/REST publish 생략: 구현 전4실패·6통과 → 수정 후10통과.
- 집계/원인 분류 단위2통과, 기존 single-flight11개를 더해23통과. 독립 검증자 신규12개 재확인.
- 로컬 PG 불가 포트에서 새 부하/리스3개 시험은3 skipped, exit0. CI에 PG가 없어도 실패하지 않는다.
- 실제 PG 새2개: baseline **1실패·1통과 → 수정2통과**. 동시12중복 ledger1/entity_version+1/
  outbox·revision불변 및 projector busy 상태 renew lease ACK/DB 정본 검증.
  evidence-renew-light/pg-renew.log 및 pg-renew-red.log에 보존한다. 독립 리뷰 Critical 없음.
- 기존12묶음은 신규4시험 파일을 제외하고 이전 방송13개를 포함한다. 전후 **378통과·4실패·4생략**,
  오류/시간초과0, 신규실패0. 기존 실패4개는 jsonschema 미설치로 node ID까지 동일하다. 전후 비교를
  `evidence-renew-light/verify_evidence.py`로 독립 검산한다. jsonschema 미설치 기존 실패는 별도 표기한다.

`live_command_timing`: 회차/명령별10초 집계의 count·reasons·max_ms를 본다. `capture.renew`의
`lease_only`, projection_ms=0, apply_ms/session_epoch_lock_ms 및 `capture.renew.ws`의
thread_queue_service_publish_ms/scope_gate_ms로 남은 지연을 좁힌다. 윈도우별 최대값이므로
서로 차감해 특정 요청의 시간을 산출하거나 p95로 해석하지 않는다. 기존 방송 로그도 유지한다.
자세한 재현·한계·필드 설명은 [evidence-renew-light/README.md](evidence-renew-light/README.md).

마이그레이션 없음. 승인 후 구현 커밋 revert가 롤백 경로다. 푸시·PR·배포·서버접속/변경·운영/dev
부하시험·메일·삭제·패키지 설치 없이 지정 워크트리에서만 수행했다. 감독 round-2 결과를 기다린다.

## round-2 (2026-11-07) — scope·명령 단일 worker 및 projection 표기 배치화

### 결과와 한계

작업 브랜치 `sdd/319-renew-light-2`, 기준 `b6f165ec`. 설계 `de940485`와 독립 리뷰 보완
`5d239fa3`를 구현 전에 커밋했다. production 변경은 outbox projector와 WS namespace 두 파일이다.
최종 로컬 실제 Socket.IO100/40명에서 renew≤2초, close pending0, 저장100%, 실제 stream 종료100%,
outbox 방송 누락0·교착0을 확인했다. 40명 WS 입장/renew/CPU는 기준선보다 소폭 개선됐다.
**dev close100명 전원 pending은 로컬 기준선에서도 재현되지 않아, 그 원인이 확정되거나
실제 dev 문제가 해결됐다고 선언하지 않는다. round-3 확인이 필요하다.**

### 원인 근거·설계

X100 renew DB service 최대~605ms에 비해 WS queue+service~1977ms, scope gate~1285ms가
관측됐다. 이는 윈도우 최대값이므로 서로 더하거나 빼서 개별 요청의 지연으로 해석하지 않는다.
코드상 정상 명령이 scope 검사와 명령 처리에 각각 스레드풀 큐를 거치는 사실을 확인해 같은 worker로
합쳤다. pre-scope 검사는 그대로 DB쓰기 전에 수행하고 ScopeStale이면 재인가/resync 후 재검사한다.
재변경되면 DB쓰기 없이 retryable. post-commit scope 검사도 유지하며 권한 캐시는 추가하지 않았다.

close는 device.changed outbox를 생성해 projection 완료가 필요하다. 이를 건너뛰지 않고 projector의
행별 DB 표기 UPDATE+commit을 성공 prefix 단위로 줄였다. 500행에서 표기 호출502→최대4회.
processed_at은 replay 필터가 아니지만 rebuild의 과거 projection 흔적 판정에 사용되므로
최초 성공행은 즉시 표기한다. 독립 리뷰가 이 경계를 찾아 설계 보완 후 구현했다.
중간 hook 예외는 완료 prefix만 표기하고 다음 drain의 Redis applied-prefix 복구를 유지한다.

DB session/epoch 잠금, executor 수/설정, Redis fence·epoch·revision 순서는 바꾸지 않았다.
close100건의 세부 대기 분포는 제공11줄 로그에 없어 미확정이며, batch commit 비용이 기여할 수
있다는 코드 근거와 로컬 개선을 구분한다.

### 전후 실제 소켓 측정

100명은 단독 before100-r2와 after100, 40명은 before40/after40 비교. localhost actual Socket.IO,
32tick, snapshot120, CPU15ms/25ms, 합성5초 heartbeat, 실제 WS entry.enter 및 동시close 포함.

| 지표 | 전100명 | 후100명 | 전40명 | 후40명 |
|---|---:|---:|---:|---:|
| WS entry.enter p95(초) | 2.556795 | 2.456754 | 0.846856 | 0.835776 |
| renew p95(초) | 1.627073 | **1.187702** | 0.553761 | **0.537804** |
| close p95(초) | 1.876271 | 1.798839 | 0.843999 | 0.717998 |
| close projection_pending | 0 | 0 | 0 | 0 |
| CPU 평균(프로세스 %) | 104.061 | 104.460 | 85.758 | 83.972 |
| 분석창 실제 저장 | 3200/3200 | 3200/3200 | 1280/1280 | 1280/1280 |
| 실제 DB closed stream | 100 | 100 | 40 | 40 |
| outbox callback/client 쌍 누락 | 0/0 | 0/0 | 0/0 | 0/0 |
| 교착 | 0 | 0 | 0 | 0 |
| metric ACK timeout / ignored:not_live | 1/9 | **0/0** | 0/0 | 0/0 |

100명 CPU는 약0.399pp 증가한 단일 표본이고 여전히 한 코어 수준으로 포화된다. 40명 capture.start는
0.155→0.161초로 약5.3ms 증가했다. 개선된 지표만으로 모든 성능 무악화를 주장하지 않는다.
최초 before100은 초기 안전성 보완 단위시험과 잠시 겹쳐 그대로 보존하고, 단독 before100-r2를 추가했다.
두 baseline100 모두 metric timeout1이 있어 완전 통과가 아니며 수정100·40은 부하시험 통과다.

로그인/REST join·enter는 주입되어 실제 REST 입장 p95는 미검증이다. heartbeat는 동일한 공개
publish/heartbeat/emit 호출을5초마다 실행하는 합성 스케줄러로 실제 join의 전체 수명주기와는 다르다.
CPU는 서버+같은 프로세스의 client 스레드를 포함하고, ACK를 기다리는 순차 tick은 밀리면 종료가 늦어진다.
저장은 REST store_batch 서비스를 시험 소켓으로 호출해 DB 개수로 확인했다. callback/client coverage는
(event_id,audience) 합집합으로 각 연결의 전달100%나 실제 화면 렌더링의 증거가 아니다.

### 검증·관측

- 구현 전 신규 단위3실패·4통과 → 최초 성공 흔적 보완 포함 **8통과**. 기존 renew/timing과 합쳐20통과.
- 최초 성공 흔적 보완 시험은 중간 구현에서1실패를 확인하고 수정 후 통과했다.
- 독립 최종 diff 리뷰 Critical 없음: pre-scope·재인가·반복변경 거절, crash prefix·epoch 흔적 보존 확인.
- PG 없는 포트로 소켓 부하를 명시 실행해1 skipped/exit0 확인. 증거 DB/Redis는 보존한다.
- 기존12묶음은 이전 renew/timing/PG/broadcast 시험까지 포함하며 이번 pipeline/socket만 별도 집계한다.
  최초 수정 후 391통과·5실패·5생략 중 새 실패1건은 scope 거절 경로 추가에 따른 SDD-285 정적 기대 수(5→6)였다.
  해당 기대를 갱신한 묶음은31통과. 최종 전후 모두 **392통과·기존4실패·5생략**이며 신규 실패/오류/시간초과0이다.
  기존4실패는 jsonschema 미설치이며 실패 node ID는 전후 동일하다. 최초 실패 증거도 보존했다.
  최종 전후 수치와 실패 node ID는 evidence-round2/regression-comparison.json 및 독립 검산 스크립트에 기록한다.

`live_command_timing`에 정확한 제출→worker 시작 `thread_queue_ms`, 내부처리 `worker_ms`가 추가됐다.
`scope_gate_ms`는 이제 worker 안의 실제 Redis 검사만 포함하므로 이전(큐 대기 포함) 값과 직접 비교하지
않는다. `thread_queue_service_publish_ms`는 pre-scope까지 포함한 전체 dispatch 시간이다.
종류별10초 집계라 close burst가 짧고 후속 요청이 없으면 해당 구간 로그가 남지 않을 수 있다.
round-3은 loadtester close ACK 오류·p95, 최종 applied/emitted/outbox, 방송 오류 로그를 함께 확인한다.

[하네스·제약·재현법](evidence-round2/README.md), `verify_evidence.py`는 네트워크/DB 없이 현재 소스 SHA,
실패 baseline 보존, 저장·close·방송·renew/40명 지표 및 전후 회귀를 독립 검산한다.
마이그레이션/설정 변경 없이 승인 후 구현 커밋 revert로 롤백 가능하다. 이번 작업에서 푸시·PR·배포·
서버접속/변경·dev/운영부하·메일·삭제·시크릿 출력은 하지 않았다. 감독 round-3 결과를 기다린다.

## round-3 (2026-11-07) — 내장 renew 공유 잠금

기준 `4854d33c`, 작업 브랜치 `sdd/319-renew-light-3`, 구현 전 설계 `c00e0ed5`.
Y100(dev99명)의 renew2.05초, close pending0, reanchor pending5, metric timeout4를 인계받았다.
남은 queue/epoch 잠금을 줄이기 위해 내장 renew 단독 commit만 회차·epoch SHARE 잠금으로 바꿨다.
다른 명령의 배타 잠금과는 충돌하므로 종료·추방·재구축 경계는 유지한다. ledger 조회 전 원장 키별
transaction advisory lock을 잡아 동일 ID100회/다른 body/거절 요청도 멱등을 유지한다.
stream FOR UPDATE, generation/entity_version/epoch, lease 계산, revision/outbox 계약은 그대로다.
등록 handler 교체/commit=False는 배타 경로다. 최종 namespace는 기준선과 동일하며 DB/서버 설정 및 마이그레이션은 없다.

### 검증과 한계

- 실제 PG 타 stream 병렬 시험 baseline1실패 → 신규전체17통과. PG 연결불가17skip/정상종료.
- 독립 코드 리뷰 Critical/High 없음. cold epoch 생성, 양방향 공유/배타 경계, 동일 ID100회,
  version 단조, 만료 active lease 및 closed 부활 금지, handler/commit fallback을 확인했다.
- 로컬 Socket.IO100/40 전후 각2표본을 보존한다. 첫100표본은 p95가 악화돼 반복한 것이며,
  유리한 표본만 선택하지 않는다. 표본 평균은 두 p95의 산술평균으로 합산 요청의 p95가 아니다.
- 전후공통 metric timeout1+ignored9 패턴이 있다. 하네스 ACK timeout30초 중 해당회원의
  다음 renew도 멈추며 lease30초/매10tick renew와 맞물려 최대9창이 만료될 수 있다.
  조기 close는 코드순서상 배제되지만 최초 ACK timeout 및 동일회원 여부는 개별trace 부재로 미확정이다.
- dev reanchor pending5/metric timeout4의 직접 원인은 발췌 집계로 확정할 수 없다.
  이 결과를 dev 실패가 해결됐다는 근거로 사용하지 않는다. round-4 감독 확인이 필요하다.
- WS entry는 REST join/enter를 대체하지 않는다. 합성 heartbeat 및 client 포함 프로세스CPU,
  ACK대기형tick/최종settle/방송 합집합 검산의 한계는 [재현 문서](evidence-round3/README.md)에 기록했다.

### 중간 실험과 최종 선택

공유 잠금 단독100명 두 p95 평균은1.184→1.468초로 악화했다. 이에 전용4worker 풀을 실험했으나
100/40명 renew4.355/4.126초로 악화하여 철회했다. 각 원본과 pool 소스 사본은 보존했다.
최종 설계90341fed는 기본 executor를 유지하고 내장 renew의 SAVEPOINT/RELEASE 및 중복session
SELECT를 생략하여 정상 경로3SQL왕복을 줄인다. 같은 lease_only guard로 공유잠금과savepoint생략을
제한한다. 예상밖오류 전체rollback, custom/commitFalse의기존savepoint는 유지한다.
신규PG19+기존pipeline/renew/timing20=39통과, 미채택executor실험4생략. PG부재19생략 확인.

### 최종 로컬 전후 수치

동일하네스 각2표본. 아래값은 **각시험 p95의 산술평균**이며 통합요청 p95가 아니다. CPU는각시험평균의평균이다.

| 항목 | 100명 기준선→최종 | 40명 기준선→최종 |
|---|---:|---:|
| WS 입장 p95 | 2.575→2.602초 | 1.245→0.843초 |
| renew p95 | 1.184→1.259초 | 0.646→0.262초 |
| close p95 | 1.723→1.888초 | 0.801→0.715초 |
| metric p95 | 1.501→1.463초 | 0.616→0.510초 |
| store p95 | 1.169→1.206초 | 0.380→0.311초 |
| 평균 CPU | 104.271→104.640% | 85.619→82.365% |
| 저장 | 모든표본3200/3200 | 모든표본1280/1280 |
| DB closed | 모든표본100 | 모든표본40 |
| close pending·방송/client 쌍누락·교착 | 모든표본0 | 모든표본0 |

100명 최종renew1.223~1.294초는2초기준이내지만 기준선1.165~1.203초보다평균약75ms느리다.
따라서100명 end-to-end성능개선/안정화는입증하지못했다. 40명은두최종표본의입장·renew·CPU가
모두두기준표본보다개선됐다. 100명기준첫표본timeout1/두번째0, 최종두표본각timeout1로
100명부하시험전체통과가아니다. 40명최종두표본은통과했다. 원본실패와중간실험을함께보존한다.

정합성검증이통과한후속dev평가용후보이며, Y100의2.05초를안정적으로2초이하로낮췄다는확인은
감독round-4결과가필요하다. DB잠금독립성·SQL3왕복축소와전체응답지연의효과를구분한다.

### 최종 회귀·인계

기존12묶음은전후 **400통과·기존4실패·6생략**으로동일하다. 실패node ID/시험대상동일,
새실패/오류/시간초과0. 기존4실패는jsonschema미설치다. 신규PG19통과및기존20통과와별도집계한다.
최종소켓4표본·회귀·현재production SHA와저장/close/방송/revision검산을독립확인했다.
100명metric timeout이있으므로부하시험전체성공이라고표현하지않는다.

최종코드변경은session_live_commands.py와session_live_ledger.py뿐이다. namespace는기준선그대로다.
푸시·PR·배포·서버접속/설정/재시작·운영/dev부하·메일·삭제·시크릿출력은수행하지않았다.
모든실패표본/중간실험/합성DB·Redis증거를보존했다. 감독round-4결과를기다린다.

## round-5 (2026-11-08) — capture.close 비차단 ACK

기준 develop `ab1a2c42`, 브랜치 `sdd/319-close-pending-5`, verify addendum 7 `dd6f25fd`(구현 전).
Z2(dev100)의 close projection_pending 62건 원인은 100건 동시 close 가 ACK 앞 single-flight 대기(2초)를 넘긴 것이다.
**변경**: `capture.close`(WS 경로 한정)는 commit 후 drain 대기 없이 즉시 applied ACK 를 돌려주고
(`run_live_command(defer_close_projection=True)`, `RunOutcome.deferred_revision`), 반영·방송은
`live_projection_follower`(회차당 러너 1개, 목표 revision 최대값 병합, 백오프 재시도, 상한 60초)가
`coalesced_drain(need=목표)`→`publish_session_sync` 로 따라잡는다. 상한 초과분은 heartbeat self-heal.
REST 경로·다른 명령·renew·metric·잠금 순서·wire 형식은 변경 없음.

### 로컬 전후 (localhost Socket.IO, 동일 하네스 test_round2_socket_load, 100/40명)

| 항목 | 전100 | 후100 | 전40 | 후40 |
|---|---:|---:|---:|---:|
| WS entry p95(초) | 2.573 (r2 2.378, r3 2.375) | 2.556 / 2.477 | 0.892 | 1.028 |
| renew p95 | 1.300 (1.218, 1.141) | 1.235 / 1.196 | 0.255 | 0.256 |
| close p95 | 1.783 (1.783, 1.860) | 1.887 / 1.779 | 0.681 | 0.684 |
| close projection_pending | 0 | 0 | 0 | 0 |
| 저장 | 3200/3200 | 3200/3200 | 1280/1280 | 1280/1280 |
| closed stream | 100 | 100 | 40 | 40 |
| 방송 누락 / client 누락 쌍 | 0/0 | 0/0 | 0/0 | 0/0 |
| 최종 settle(target=applied=emitted) | 3693 일치 | 3693 일치 | 1482 일치 | 1482 일치 |
| CPU 평균 % | 104.0 (105.1, 104.7) | 104.8 / 104.5 | 82.9 | 82.4 |
| 교착 | 0 | 0 | 0 | 0 |

- 100명은 전 3회·후 3회 모두 `metric` ACK TimeoutError 1건(회원 1명, ignored:not_live 9)이 있어 하네스
  assert 가 실패한다(전/후 동일 패턴, 변경과 무관한 기존 문제). 후 첫 표본과 run4 포함 원본 보존.
- **로컬은 기준선에서도 close pending 0이라 pending 62 감소를 로컬로 입증하지 못한다.** 로컬이 보여주는 것은
  (1) close ACK 가 정상 applied, (2) 따라잡기 러너가 방송을 누락 없이 완결(settle 후 일치·누락 0),
  (3) 40/100명 지표 악화 없음(차이는 표본 변동 범위). dev 효과는 round-6 감독 시험이 필요하다.
- ACK 가 방송보다 먼저 나가므로 코치 "측정 종료" 화면 반영이 수십~수백 ms 늦을 수 있다(누락 아님).

### CPU 프로파일 (과제 2)

`evidence-close-5/profile_run.py`(py-spy 미설치 → sys._current_frames 10ms 샘플러, 대기성 프레임 제외).
비대기 샘플 101,297 중 `session_live_ledger.lock_epoch` 73%(리프 `sqlalchemy do_execute` 87%, 즉 PG 잠금/쿼리 대기),
`class_write_service.lock_users` 5.5%, `outbox._acquire` 5.3%, redis `_wrap` 3%. do_execute 는 GIL 을 놓는 DB 대기라
**프로세스 CPU 포화(104%)의 직접 원인이 아니다**(샘플러는 대기와 CPU 를 구분 못 함). 순수 파이썬 CPU 소비원은
합성 CPU 압박(15ms/25ms)이 대부분이라 로컬로 dev 의 CPU 소비원을 확정할 수 없다. renew/entry.enter 개선은
이번 라운드에서 코드 변경하지 않았다(로컬 renew 1.2초 ≤2초, 개선 근거 없음). 다음 단서: epoch 배타 잠금(`lock_epoch`)
대기가 지배적이므로 entry.enter 의 epoch 직렬화 범위 축소가 후보(별도 설계 필요).

### 검증
- 신규 단위 5통과(러너 병합·반복·예외·상한·시그니처). tests/sdd319+308+285 = 129통과·10생략·실패0.
- 푸시·PR·배포·서버/DB 접근·메일·삭제·시크릿 출력 없음. 롤백=구현 커밋 revert.
