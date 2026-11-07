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
