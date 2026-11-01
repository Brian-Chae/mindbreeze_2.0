# SDD-260 — 라이브 데이터 완결성 설계안 (plan-fable)

- 작성: 2026-10-31, Claude(Fable) 워커. 코드 수정 없음, 설계 문서만.
- 브랜치: `sdd/260-live-ingest-bottleneck`. 기한: 11/4(수) 대구교육청 현장(40명 클래스).
- 입력: `~/.hermes/share/loadtest-40/report.md`, `report-rerun.md`, `~/.hermes/share/band-analysis/report.md`, 이 워크트리의 코드(아래 `path:line` 인용은 전부 이 워크트리 기준).
- 표기: **[근거]** = 코드·실측으로 확인한 사실, **[추정]** = 코드를 끝까지 읽지 못했거나 실측이 없는 판단.

---

## 0. 결론 요약

1. **병목은 CPU 총량이 아니라 "단일 uvicorn 프로세스 + 회차 1행 락 + 작은 스레드풀" 세 겹의 직렬화다.** 4vCPU로 올려도 처리량 +23%(16.5→20.3창/초)에 그쳤고(report-rerun §4), 착용 40명에서 `live_session_epoch` 락 타임아웃 12건 → heartbeat 가 연결을 `DEGRADED` 로 내리고 → 그 연결의 `live:metric` 이 전부 `not_ready` 로 거절되는 연쇄가 559건 거절의 경로다(§2.1).
2. **11/4 전 필수 범위(트랙 2)는 코드 4곳의 소규모 변경 + 설정 2건이다.** ① metric 투영에서 회차 락을 "기다리지 않고 건너뛰기"(NOWAIT), ② heartbeat 의 세션당 drain 1회 통합 + DEGRADED 자동 복귀, ③ 기본 스레드풀 확대(8→32)와 DB 풀 조정, ④ 방송(publish) 묶음화(200~500ms 틱). uvicorn 다중 워커는 v1 휘발성 상태 5종 때문에 **11/4 전 금지**, 후속으로 둔다(§2.5).
3. **트랙 1(원시 업로드)은 저장·멱등·대조 장치가 이미 있다.** 영속 journal(IndexedDB / 네이티브 fsync journal), checksum 바인딩 presign·HEAD 검증 ack, close intent → manifest `close_state` 판정, `verifyArchiveCompleteness` 까지 존재한다(§3.2~3.4). **빠진 것은 "회차 화면을 벗어난 뒤에도 미완료 큐를 찾아 이어 올리는 전역 스위퍼"와 "복귀 시 재개 경로", 그리고 몰림 완화 파라미터**다. 세션 종료는 막지 않고 "전송 중" 상태 + 백그라운드 이어올림으로 간다(§3.5).
4. **밴드는 자체 저장이 없으므로 "이미 로컬에 영속된 데이터를 잃지 않는 것"이 1순위**이고, 그 다음이 서버 수신량 대조다. 10/31 시연 사건(3분만 저장)은 JS 컨텍스트 정지 후 재개 경로 부재가 가장 유력하며, 네이티브 측정 경로(앱)를 쓰면 JS 정지와 무관하게 측정이 이어진다(§4.1).

---

## 1. 현황과 실측 근거

### 1.1 실측 (dev, 40명)

| 조건 | 처리량(창/초) | 목표 대비 | 특이 |
|---|---|---|---|
| 2vCPU · 착용 30 | 16.5 | 55% | metric P95 4.3s, renew 타임아웃 56 |
| 4vCPU · 착용 30 (B) | 20.3 | 68% | presign 429 `archive_busy` 24건, 원시 청크 24건 누락(시험 클라 재시도 없음) |
| 4vCPU · 착용 40 (C) | 18.5 | 46% | `not_ready` 559 + 타임아웃 34, 2명 300/341창, Traceback 12 = 전부 `LockNotAvailable … live_session_epoch` |

- 서버 전체 CPU 26~33%인데 백엔드 프로세스 110~120% 평탄(report-rerun §2) → GIL 1코어 상한. RDS CPU·DB 연결(최대 21/20, 활성 ≤10)·Redis 는 한계 아님.
- 저장 완전성은 착용 30에서 100%(특징창 유실·중복 0, 원시 청크 전량 `uploaded`). 착용 40에서만 거절로 깨짐.

### 1.2 코드로 확인한 직렬화 지점 [근거]

| # | 지점 | 위치 | 영향 |
|---|---|---|---|
| S1 | metric 배치마다 회차 행 `SELECT … FOR UPDATE` | `backend/app/services/live_ingest_service.py:269` → `session_live_ledger.py:76-83` | 40명이 같은 1행 경쟁. `db_lock_timeout_ms=10_000`(`config.py:88`) 넘으면 Traceback |
| S2 | 창 저장 커밋 + 투영 커밋 = 배치당 커밋 2회 | `live_ingest_service.py:246-247`, `:282` | DB 왕복: participant get(178) + stream select(132) + evaluate_ingest 내 stream 재조회(`session_live_commands.py:471~`) + 기존행 select(223) + persist + 락 + prev select(270) + insert + commit |
| S3 | 동기 DB 를 `asyncio.to_thread` 로 실행, 풀 크기 미설정 | `session_live_namespace.py:2308`, `:2331` 등. `main.py`·`core/*` 에 executor 설정 없음(grep 결과 0건) | asyncio 기본 executor = `min(32, cpu+4)` → 4vCPU 에서 **8스레드**. presence(Redis hset 뿐)도 같은 풀에서 대기 → presence P50 1.2~1.7s 설명 |
| S4 | 연결마다 5초 heartbeat 가 `publish_session_sync` → `drain(wait_s=2.0)` + emit 락 | `session_live_namespace.py:2319-2331`, `class_participation_service.py:906-918` | 40연결 = 초당 8회 drain. projector 락(`LOCK_TTL_MS=10_000`, `live_redis/client.py:32`) 경쟁 시 스레드가 최대 2초 블록 |
| S5 | drain 실패(`LiveNotReady`) → 연결 `DEGRADED` → `_ingest` 가 `READY` 아니면 `not_ready` | `session_live_namespace.py:2338-2341`, `:2299-2303` | **착용 40 의 `not_ready` 559건 경로** [추정: DEGRADED→READY 복귀 코드를 찾지 못함. heartbeat 성공 시 `degraded_notified=False` 만 되돌림(:2348)] |
| S6 | 투영 성공마다 즉시 `publish(session_id)` | `live_ingest_service.py:356-358` → `publish_session_sync` | 배치 1창 시험에서는 창마다 drain+emit. AsyncRedisManager 경유라 emit 은 Redis pub/sub 왕복(`ws/__init__.py:74`) |
| S7 | raw/산출물 presign·ack 동시 슬롯 6, 대기 1.5s, Retry-After 3 고정 | `config.py:92-93`, `api/deps.py:105-122` | 착용 30 에서 이미 429 |
| S8 | uvicorn 단일 프로세스 | `deploy/templates/systemd/mindbreeze-backend.service.tpl:13` | 모듈 주석이 단일 워커 전제 명시(`session_live_namespace.py:44-52`) |

### 1.3 outbox revision "gap 없음"이 정말 필요한가 [근거]

- projector Lua 는 `applied_revision` 바로 다음 revision 만 적용하고, 건너뛰면 `ProjectionGap` 을 올린다(`session_live_outbox.py:4-7`, `:335-336`, `:353-354`). `rebuild` 도 revision 순 fold 다(`:162-218`).
- 따라서 **outbox 에 남아 있는 한** metrics 도 gap 없는 revision 이 필요하다. 회차 락을 "없애려면" metrics 를 outbox 밖으로 빼야 하고, "줄이려면" 락을 짧게 쥐거나 기다리지 않아야 한다.
- metrics 는 "최신값만" 도메인이다(`live_ingest_service.py:13-16`): 정본은 `eeg_feature_windows` 에 이미 커밋돼 있고, 투영 실패는 ACK 를 막지 않으며 다음 창이 갱신한다(`:17`, `:167-169`). → **투영을 건너뛰어도 데이터 손실이 없다.** 이것이 §2.2 결정의 근거다.

---

## 2. 트랙 2 — 실시간 서버 운영 (feature · 영상 · 음성 · 상태)

### 2.1 장애 연쇄 모델 [근거 + 추정]

```
40명 1Hz metric ─▶ 8스레드 풀 대기(S3) ─▶ 회차 락 대기(S1) ─▶ 락 10s 타임아웃
      │                                           │
      └─ heartbeat drain 8회/초(S4) ── projector 락 경쟁 ─▶ LiveNotReady ─▶ 연결 DEGRADED(S5)
                                                                     └─▶ 이후 live:metric 전부 not_ready
```
실측과 맞는 점: C 에서 Traceback 12건이 전부 epoch 락, 거절은 2명에 집중(연결 단위로 DEGRADED 된 양상), renew `projection_pending` 2건.

### 2.2 결정 D2-1: metric 투영의 회차 락 — "기다리지 않고 건너뛴다" (11/4 필수)

| 안 | 내용 | 장점 | 단점 | 판정 |
|---|---|---|---|---|
| A. 현행 | 배치마다 `lock_epoch` 대기 | 변경 없음 | 40명에서 타임아웃 확정 | ✗ |
| **B. NOWAIT 건너뛰기** | `_project_latest` 에서 `with_for_update(nowait=True)`; 락 실패(`OperationalError`/`LockNotAvailable`)면 rollback 후 `False` 반환. 락 잡기 전에 prev `entity_version` 을 락 없이 먼저 읽어 이미 더 새 값이면 락 자체를 안 잡는다 | 변경 ~15줄, 저장 경로 무영향, 대기 0 | 충돌한 참가자의 live 갱신이 최대 1~2초 늦음(다음 창이 갱신). 명령(`apply_command`)은 기존처럼 대기 | **채택(11/4)** |
| C. 세션당 N초 묶음 투영 | 타이머가 Redis 최신값을 모아 1회 투영 | 락 횟수 = 1/N초 | 새 타이머·상태 관리, 지연 ≥N초, 회귀 위험 | 후속 후보 |
| D. metrics 를 outbox 밖으로(Redis 직접 투영) | 전용 Lua 로 state 키 + 스트림 직접 기록, rebuild 는 `eeg_feature_windows` 최신행에서 | 락·outbox 행(회차당 수만 건) 모두 제거 | 스트림 seq 생성 방식·replay cursor 정합을 `live_redis/scripts.py` 에서 확인해야 함(이번에 못 읽음), 클라 재생 경로 회귀 | **후속(11/4 이후)** |

- 멱등·fencing·순서 의미는 `_store_windows` 가 담당하고 투영과 무관하다: duplicate/`feature_hash_conflict` 는 기존행 조회로(`live_ingest_service.py:219-240`), `stale_owner_generation` 은 generation 비교로(`:196-198`), 순서는 `entity_version=(generation<<31)|sequence` 비교로(`:72-74`, `:274-276`) 보존된다. B 안은 이 셋을 건드리지 않는다.
- device 이벤트(`ingest_device`, `:310`)는 저빈도라 현행 유지.

### 2.3 결정 D2-2: heartbeat·방송 묶음화 (11/4 필수)

1. **heartbeat drain 을 세션당 1회로.** `_hb_loop` 가 연결마다 `publish_session_sync` 를 부르는 대신, 프로세스 전역 "세션별 마지막 publish 시각" 을 두고 `V2_HEARTBEAT_S` 안에 이미 누가 했으면 건너뛴다. 각 연결의 `LiveStateService.heartbeat`(Redis 읽기)는 그대로.
2. **heartbeat 경로의 `publish_pending(wait_s=2.0)` → `wait_s=0`.** 락이 바쁘면 다른 누군가가 drain 중이므로 건너뛴다. 명령 ACK 경로(`live:command`)는 현행 wait 유지(ACK 전 투영 보장).
3. **DEGRADED 복귀 규칙 명시.** heartbeat 가 연속 N(=3)회 실패했을 때만 DEGRADED 로 내리고, 1회 성공하면 `READY` 로 되돌린다. [추정: 현재 복귀 코드 부재 — 구현 전 `session_live_namespace.py:2319-2349` 와 `live_resync` 경로 재확인]
4. **ingest 후 publish 묶음화.** `make_sinks` 의 `publish(session_id)` 를 즉시 호출 대신 "세션 dirty 표시" 로 바꾸고, 프로세스당 하나의 틱(200~500ms, env `LIVE_V2_PUBLISH_TICK_MS`)이 dirty 세션만 `publish_session_sync` 한다. 호스트 화면 규칙(숫자 매초 갱신)은 500ms 틱으로 충족된다.

### 2.4 결정 D2-3: 스레드풀·DB 풀 (11/4 필수, 설정+코드 5줄)

- lifespan 에서 `loop.set_default_executor(ThreadPoolExecutor(max_workers=settings.ws_thread_pool_size))`, 기본 32. 근거: 40연결 × (metric 1 + heartbeat 0.2 + renew 0.1)/초 ≈ 50 작업/초, 작업당 50~200ms → 동시 8은 부족.
- DB 풀: `db_pool_size 10 + overflow 10`(`config.py:80-81`) → 20 + 20. RDS 한도 79, Celery 자식 8개 각 1~2 사용(주석 `config.py:74-79`) → 합계 여유 있음. 적용은 DEPLOY 창구.
- `db_lock_timeout_ms` 는 10초 유지(B 안으로 metric 경로는 락을 기다리지 않음).

### 2.5 결정 D2-4: uvicorn 다중 프로세스 — 11/4 전 금지, 후속 [근거]

- 막는 것: v1 네임스페이스의 프로세스 전역 dict 5종(`_active_signals`, `_last_aggregate_at`, `_last_group_average_at`, `_audio_states`, `_audio_revisions`; `session_live_namespace.py:44-52`), 대기실 presence 휘발 메모리(`:1371-1372`). 호스트 집계(`class:aggregate`)·대기실·오디오 동기가 워커별로 갈라진다.
- 되는 것: v2 는 "어느 프로세스에서 호출해도" 를 전제로 Redis 락(projector/emit)을 쓴다(`class_participation_service.py:907-910`). Socket.IO room 은 `AsyncRedisManager` 가 dev 에 붙어 있다(`ws/__init__.py:57-75`, redis_url 설정 시).
- 후속 작업 순서: 위 dict 5종을 Redis 로 이관 → `--workers 2`(4vCPU 기준) → `_archive_slots` 는 프로세스별이므로 총량 = 슬롯 × 워커 수로 재계산.
- 영상·음성·상태 영향: LiveKit 토큰·녹음 start/stop 은 REST 이고 `lock_epoch` 호출처는 `live_ingest_service`(2곳)·`session_live_commands.apply_command`(1곳)뿐이다 [근거: grep]. 즉 영상·음성은 회차 락을 **공유하지 않지만**, 같은 단일 프로세스·같은 스레드풀을 공유하므로 S3 완화(D2-3)의 수혜를 같이 받는다. `live:device`·`capture.renew`·`entry.enter` 는 `apply_command` 를 거쳐 락을 공유한다 → D2-1 로 metric 이 락에서 빠지면 이들의 대기도 줄어든다.

### 2.6 완결성 — 끊김·재연결·백프레셔 [근거]

| 항목 | 현재 | 판정 · 보완 |
|---|---|---|
| metric 대기열 | `MetricOutbox` 상한 300창(5분), 초과 시 오래된 창부터 폐기, 배치 60창, `not_sent`(연결 없음)·retryable 은 보존(`metric-outbox.ts:11-13`, `:47-55`, `:87-92`) | 폐기된 창의 정본은 archive feature 묶음(`feature-collector.ts:25-29`, `MAX_PENDING=2000`)에 남는다 → **live 유실 ≠ 데이터 유실**. 단 "창 300개 폐기" 는 호스트 화면 공백이므로 11/4 전 `not_ready` 가 5분 넘게 지속되지 않게 D2-2 ③ 이 핵심 |
| 소켓 재연결 | reconnection Infinity, 0.5~5s, connect 시 마지막 join 자동 재전송·5초 재시도(`lib/socket.ts:463-470`, `:518-526`) | 유지. 재연결 후 `live:join` 이 READY 를 다시 열고, 그 사이 metric 은 `not_sent` 로 큐에 남는다 |
| 서버 백프레셔 | `not_ready`(join 전·RESYNCING·DEGRADED), `db_unavailable retry_after 1000`, `*_ingest_unavailable` | 코드 체계는 충분. **부족한 것은 "서버 과부하" 신호가 없다는 점** → D2-3 뒤에도 스레드풀 대기열 길이가 임계(예: 64) 를 넘으면 `_ingest` 가 `retry_after_ms` 를 2,000~5,000 + 지터로 늘려 돌려주는 적응형 백오프(후속, 지표 노출과 함께) |
| 화면 잠금·백그라운드 복귀 | §4 참조 | |

### 2.7 트랙 2 변경 목록 · 통과 기준 · 롤백

| ID | 변경 | 파일 | 통과 기준 | 롤백 |
|---|---|---|---|---|
| T2-1 | 스레드풀 32 + DB 풀 20/20 | `main.py` lifespan, `config.py`, `.env`(DEPLOY) | dev 40명 재시험에서 presence P95 < 500ms | env 값 복원 + 재기동 |
| T2-2 | `_project_latest` NOWAIT + 락 전 prev 읽기 | `live_ingest_service.py` | 착용 40 에서 `live_session_epoch` Traceback 0, metric 거절 0 | 플래그 `LIVE_V2_PROJECT_NOWAIT=false` 로 현행 경로 |
| T2-3 | heartbeat 세션당 1회·wait 0·DEGRADED 복귀 | `session_live_namespace.py` | `not_ready` 0, DEGRADED 진입 후 10초 내 READY 복귀 로그 | 플래그 |
| T2-4 | publish 틱 묶음 | `live_ingest_service.make_sinks`, `session_live_namespace.py` | 호스트 화면 갱신 지연 ≤ 1초(시험 클라에서 수신 시각 측정) | 플래그 `LIVE_V2_PUBLISH_TICK_MS=0` 이면 즉시 publish |
| T2-5 | archive 슬롯 6→16, 대기 0.5s, Retry-After 2~6 랜덤 | `config.py`, `api/deps.py` | 착용 30 에서 429 0건 또는 재시도로 전량 확정 | env 복원 |
| T2-6(후속) | metrics outbox 탈출(D 안), 다중 워커, `_store_windows` 왕복 축소(stream 객체 재사용·evaluate_ingest 에 로드된 stream 전달) | | | |

모두 `sdd/260-*` 브랜치에서 하나의 PR, 커밋은 T2 단위로 분리해 개별 revert 가능하게 한다.

---

## 3. 트랙 1 — 원시 데이터 완결성 있는 업로드

### 3.1 측정 경로 두 갈래 [근거]

`decideMeasurementPath`(`lib/measurement-web/measurement-path.ts:21-27`): v2 + 앱(Capacitor)이면 **native**, 웹이면 **web_wasm**. 두 경로의 저장소·업로더가 다르다.

| | 웹(web_wasm) | Android 네이티브 | iOS 네이티브 |
|---|---|---|---|
| 영속 저장 | IndexedDB `mindbreeze-eeg-raw` v2, store `packets`(journal)·`sealed_chunks`·`ack_receipts` 등(`queue-db.ts:2-4`) | `AppendOnlyJournal` 레코드마다 fsync + CRC32, 열 때 찢긴 꼬리 절단(`AppendOnlyJournal.kt:15-16`); `ArchiveQueue` 메타는 임시파일→fsync→rename 원자 갱신(`ArchiveQueue.kt:24`) | `MeasurementKit/AppendOnlyJournal.swift` + `CRC32.swift`, `Archive.swift`·`ArchiveUploader.swift` [추정: 파일 목록만 확인, 본문 미독] |
| 쓰기 순서 | `receive()` 동기 → journal 영속 성공 후 inflight 해제, 미영속 8MiB 넘으면 `memory_cap` 중단(`capture-session.ts:3`, `:27`, `:178`) | journal fsync 직후 `rawSink`(SDD-252 summary) | 동일 계약 |
| 청크 | 10초 또는 900KB 봉인, SHA-256, 1MiB 상한(`capture-session.ts:25-26`, `raw-encoder.ts:95`) | `RawChunker.kt` 동일 규칙 | `RawChunker.swift` |
| 앱 종료 후 업로드 | 없음(화면 마운트 중에만 pump) | WorkManager `ArchiveWorker`(네트워크 연결 제약, 지수 백오프 30s, 프로세스 재생성 후에도 실행; `ArchiveWorker.kt:24-27`, `:39`) | 없음 — 다음 실행 때(SDD-247 summary 와 같은 한계) |
| 강제종료·저장소 정리 내성 | Android WebView IndexedDB 는 앱 데이터 영역(앱 데이터 삭제 전까지 유지). iOS WKWebView IndexedDB 는 저장소 압박 시 OS 가 비울 수 있고 `persist()` 요청을 iOS 가 보장하지 않는다 [추정] | 앱 샌드박스 파일, 삭제는 앱 삭제뿐 | 앱 샌드박스 파일 |

**용량 추정(착용 1인·60분)** [근거: `capture-session.ts:17` RATES, `raw-encoder.ts:5-7` stride]
- samples 섹션: EEG 250Hz×17B = 4,250 B/s, PPG 50×8 = 400, ACC 30×18 = 540 → 5,190 B/s
- packets(원문 BLE 바이트) + packet_map(JSONL) 포함 전체 ≈ 12 KB/s (코드 주석 `capture-session.ts:30`)
- **60분 ≈ 43 MB, 90분 ≈ 65 MB / 인.** 30명 합계 ≈ 1.3 GB. 현장 와이파이 실효 20~50 Mbps 가정 시 전량 전송 4~9분(세션 중 계속 올리면 종료 시 잔여는 수 MB).
- 로컬 한도: 웹은 `navigator.storage.estimate` 기반 quota 중단(`capture-session.ts:322`), 네이티브는 Android 오디오 큐 200MB 선례(SDD-247). 원시 큐 상한은 미확인.

### 3.2 멱등·중복·훼손 방지 — 이미 있는 것 [근거]

- identity = (session, participant, signal, stream, segment, chunk_index); 같은 identity 에 다른 checksum 이면 409 `chunk_identity_conflict`(요청 전체 미반영, 기존행 보존), 같은 바이트는 200 재발급(`biosignal_service.py:3-6`, `:247-263`, `:298-303`).
- PUT URL 은 `x-amz-checksum-sha256` 를 서명에 바인딩 → 다른 바이트는 S3 가 거부(`storage_service.py:219-241`).
- ack 는 HEAD 로 크기 + 저장소 SHA-256 을 검증한 뒤에만 `uploaded`(`storage_service.py:251-272`, `biosignal_service.py:355-384`). 클라이언트는 ack 의 alias·checksum·size·`verified_at_us` 를 대조한 뒤에만 payload 삭제(`upload-queue.ts:117-124`).
- 서명 만료 403·객체 미확인은 재-presign 으로 복구(`upload-queue.ts:89-121`). 청크 ≤1MiB 단일 PUT 이라 부분 업로드 재개는 "청크 단위 재전송"으로 충분하다(멀티파트 불필요).
- 세션 종료 뒤 업로드 허용(`resolve_upload_participant(allow_completed)`, fix-notes/class-upload-queue), close deadline 24h(`session_live_commands.py:41`), 24h 뒤 고아 pending 은 `abandoned_orphan` 으로 종결하되 늦게 오면 다시 uploaded 로 수렴(`biosignal_orphan_sweep.py:4-12`).

→ **새로 만들 멱등 장치는 없다.** 설계는 "있는 장치를 끝까지 실행시키는 것"에 집중한다.

### 3.3 서버 수신 요약 API — 있는 것과 새로 필요한 것

| 필요 | 현재 | 판정 |
|---|---|---|
| 참여자 manifest(원시·산출물 참조, `close_state`, missing) | `GET /sessions/{id}/biosignal-manifest`(`api/v1/session.py:965`), `POST …/biosignal-events` 응답에 `close_state`·`missing_artifacts`(`schemas/biosignal.py:1062-1070`) | 있음. 단 manifest 는 무거움(산출물 전체 + 알고리즘 스냅샷 S3 다운로드, `biosignal_manifest_service.py:454-460`) → 폴링용으로 부적합 |
| 스트림별 가벼운 수신 요약 | 없음 | **신규 `GET /sessions/{id}/biosignal-raw/summary?participant_id=`** → `[{signal_type, stream_id, segment_id, uploaded_count, pending_count, uploaded_bytes, max_chunk_index, missing_indexes(최대 200개, 초과 시 truncated=true), last_verified_at}]`. 인덱스 `ix_eeg_raw_chunk_signal(session, participant, signal_type)` 존재(`models/record.py:143`). `archive_upload_slot` 의존성 **적용 안 함**(읽기 전용, 짧음). 본인 participant 만(`resolve_participant` 재사용). 해시 요약은 넣지 않는다: 청크별 SHA 는 ack 때 이미 검증했고, 세션 단위 해시는 쓰는 쪽이 없다 |
| 서버가 "기대 개수" 를 아는가 | close intent 의 `last_chunk_sequence`·`received_samples`(`schemas/biosignal.py:292-294`) 로만 안다 | 유지. 기대치는 클라이언트 정본(밴드에 저장 없음) |

### 3.4 "업로드 완료" 정의와 종료 시 대조 프로토콜

**완료 = 아래 셋이 동시에 참**
1. 로컬: 해당 scope 의 큐에 `pending`·`dead_letter`·`time_review` 0건, 봉인된 모든 alias 에 `ack_receipts` 존재(`archive-verify.ts:17-40`).
2. 서버: 각 (signal, stream, segment) 에 대해 `0..last_chunk_sequence` 가 빠짐없이 `uploaded`(summary API 의 `missing_indexes=[]`), close intent 기록.
3. manifest `close_state == 'complete'`(위 둘이 맞으면 `refresh_if_closing` 이 수렴시킨다, `biosignal_service.py:390-391`).

**종료 시 순서(클라이언트)** — 대부분 이미 구현돼 있음
1. `sealOpen()` → feature/display flush → `close(reason)` 로 close intent 생성(`useBiosignalCapture.ts:245-248`).
2. `pump()` 로 잔여 전송(`:249`), `sendBiosignalEvents` 로 intent·gap 전송.
3. **신규**: summary API 로 `missing_indexes` 를 받아 로컬 `sealed_chunks` 와 대조 → 서버에 없는 것은 `resume(id)` 로 재큐잉(dead_letter 포함), 로컬에도 없는 것은 `gap(reason='local_missing')` 이벤트로 기록(조용히 넘기지 않음).
4. `verifyArchiveCompleteness` 결과를 화면 상태로: `complete` / `uploading(N건·MB)` / `needs_attention(dead_letter·server_missing)`.

**결정 D1-1: 종료를 막지 않는다.**
- 비교: 40명이 동시에 종료하면 잔여(각 수 MB~수십 MB)가 한꺼번에 몰리고, 현장 와이파이에서 수 분이 걸린다. 종료 화면에서 앱을 닫거나 백그라운드로 보내는 위험(JS 정지 → 업로드 중단)이 "막기" 보다 크다. 반면 막지 않아도 로컬 사본은 영속돼 있어 손실이 없다.
- 따라서: 종료 즉시 "측정 데이터 전송 중 N건" 상태를 보여 주고(기존 `BiosignalRecordingStatus` 확장, `recording-status.tsx:41-57`), 전송이 끝나면 "전송 완료" 로 바뀐다. 앱을 닫아도 §3.5 의 스위퍼가 이어 올린다.
- 리포트: 리포트 파이프라인은 `close_state` 를 읽지 않는다 [근거: grep 결과 `data_center_*` 만 사용]. **리포트는 업로드를 기다리지 않는다.** 데이터센터는 이미 `pending_upload` 를 구분 표시한다(`data_center_measurement.py:143`, `data_center_export.py:211-214`) → 그대로 둔다.

### 3.5 비정상 종료 후 재개 — 전역 스위퍼 (11/4 필수, 웹 경로)

**문제** [근거]: `BiosignalQueue` 는 (accountId, sessionId, participantId) scope 로만 열리고(`useBiosignalCapture.ts:108`, `:161`), 그 세션의 클래스 화면에서만 pump 가 돈다(`:200-201`, `:214`). 다른 화면·앱 재시작·재로그인에서는 미완료 큐를 아무도 보지 않는다. (v1 `pending_raw_chunks` 는 eeg-raw-ack-loss 수정으로 다음 세션에서 재시도되지만, v2 큐는 아니다.)

**설계**
1. `BiosignalQueue.listScopes()`(신규): 모든 object store 를 cursor 로 훑어 `(accountId, sessionId, participantId)` 별 pending/dead_letter 건수·바이트를 집계(payload 미로드 — 기존 `objectsMeta` 메타 인덱스 방식 `durable-queue.ts:232-241` 재사용).
2. 앱 셸(로그인 후 공통 레이아웃)에 `useBiosignalResumeSweeper()` 훅: 시작 시·`online`·앱 복귀(`subscribeAppResume`, `app-lifecycle.ts:71`)·60초 주기마다 ①을 호출하고, **현재 principal 과 accountId 가 같은 scope 만** `uploadBiosignalQueue` + `sendBiosignalEvents` 로 pump 한다. 동시에 scope 1개, 전체 동시성은 기존 4.
   - 로그인 사용자: `user:<id>` scope. 게스트: `entry:<participantId>` scope 는 입장 자격이 살아 있는 동안만(`entry_credential_ttl_hours=24`, `config.py:112`) — 자격을 어디에 보관하는지 이번에 확인하지 못함 [미확인].
   - 클래스 화면이 같은 scope 를 열고 있으면(lease 보유) 스위퍼는 건너뛴다(`lease_held` 를 그대로 신호로 사용, `durable-queue.ts:77`).
3. 계정 전환·기기 교체·혼입 방지: scope 의 accountId 가 다르면 **절대 전송하지 않고** 보관만 한다. 서버도 `resolve_participant` 가 본인 participant 만 허용하므로 이중 방어. 네트워크 각 단계에서 소유 확인은 eeg-raw-ack-loss 수정 선례를 따른다.
4. 로컬 보관·삭제 정책(결정 필요, §6): 다른 계정 scope 또는 close deadline(24h)+7일 지난 scope 는 "전송 못 한 측정 데이터 N건(용량)" 을 설정 화면에 보여 주고 사용자가 지우거나, 30일 뒤 자동 삭제(삭제 전 `capacity_eviction` 과 같은 로컬 이벤트 기록).
5. 네이티브: Android 는 WorkManager 가 이미 디스크 큐를 올린다(`ArchiveWorker.kt:39`). iOS 는 앱 포그라운드 실행 시 `MeasurementManager` 의 drain 호출 여부를 확인해야 한다 [미확인] — 11/4 전에는 "앱을 한 번 열어 주세요" 운영 지침으로 보완, `BGProcessingTask`/background `URLSession` 은 후속.

### 3.6 몰림 완화 · 대역폭 · 배터리

| 항목 | 현재 | 설계 |
|---|---|---|
| 서버 슬롯 | 6, 대기 1.5s, Retry-After 3 고정(`deps.py:105-122`) | 16 / 0.5s / `Retry-After` 2~6 랜덤(T2-5). 스레드풀 32 가 전제 |
| 클라 동시성 | 4, 배치 24, 4초 pump, 지수 백오프 ≤60s(`upload-queue.ts:12-14`, `durable-queue.ts:43-44`) | 유지. **종료 직후 첫 pump 에 0~5초 지터** 추가(40명 동시 종료 분산) |
| REST 호출 수 | 청크당 presign 1 + PUT 1 + ack 1(`uploadOneStaged`) | **presign·ack 를 배치(≤24)로**: 서버는 이미 리스트를 받는다(`biosignal_service.py:212`, `:330`). 24청크 = 72요청 → 26요청. 11/4 포함 여부는 §5 일정 참조(웹 경로만, 네이티브는 후속) |
| 429 처리 | 웹 `ArchiveClassifier` 가 `retryAfterMs` 반영(`upload-queue.ts:159-160`), Android 는 429 재시도(`ArchiveUploader.kt:63-64`, `ArchiveClassifier.kt:21-22`) | 유지 + 서버 Retry-After 랜덤화로 재몰림 방지 |
| 셀룰러·배터리 | 정책 없음 | 11/4 는 현장 와이파이 전제. 후속: 세션 종료 후 잔여 전송은 셀룰러에서도 허용(기본), 설정에서 "Wi-Fi 에서만" 선택지. 배터리 20% 미만이면 pump 주기 4→15초 |

---

## 4. 화면 잠금·백그라운드 복귀 — 정지 지점 4개의 해결안

band-analysis 가 확인한 정지 지점과 대응:

| # | 정지 지점 [근거] | 해결안 | 범위 |
|---|---|---|---|
| P1 | JS 컨텍스트 정지 중 소켓·BLE 재연결 코드 실행 불가 | **앱(네이티브 경로) 사용을 현장 기본으로.** 네이티브는 BLE·소켓(`MeasurementKit/SocketIOClient.swift`, `MetricOutbox.swift`; Android `measurement/live`)·journal 을 네이티브가 소유해 WebView 정지와 무관하다(`use-native-measurement.ts:1-2`). Android FGS `connectedDevice`(`AndroidManifest.xml:33-39`), iOS `bluetooth-central`(`Info.plist:59-63`). 웹(모바일 Chrome)은 화면 잠금을 막을 수단이 없음 → 운영 지침 | 운영 결정(§6) |
| P2 | BLE 자동 재연결은 캐시된 기기 있을 때만(`useBand.ts:1349`) | 복귀 시 캐시 없으면 "밴드 다시 연결" 배너 + 1탭 재선택. 네이티브 경로는 네이티브 `LinkWatchdog.kt`/`BandBLE.swift` 가 담당 [추정: 본문 미독] | FE 소규모 |
| P3 | capture-session `stop()` 후 재개 없음(`capture-session.ts:195-215`, `:281`) | `useBiosignalCapture` 에 `resumeCapture()`: stopReason 이 `lease_lost`·`memory_cap`·`journal_failed` 면 lease 재획득(기존 3s×14 재시도) → 새 segment 로 `BiosignalCaptureSession` 재시작, 중단 구간은 `gap(reason='process_suspended')` 기록. `quota` 는 재개하지 않고 안내 | FE 중간 |
| P4 | 복귀 시 재개 트리거 없음 | `useBiosignalCapture`·`capture-controller` 에 `subscribeAppResume`(order `rawFlush=20`) + `visibilitychange` 핸들러: ① `capture.renew` 즉시 1회(lease 30s 는 만료됐을 가능성 큼; 서버는 만료 후 10분 `offline_bound` 안 창을 수락, `session_live_commands.py:40`, `:505-507`) ② `MetricOutbox.flush()` ③ `pump()` ④ P3 재개. renew 가 만료 lease 를 거절하는지 `_handle_capture_renew`(`:361-379`) 본문에서 확인 필요 [미확인] | FE 소규모 |

WakeLock/KeepAwake 는 클래스 활성 구간에 이미 요청하고 복귀 시 재요청한다(`useWakeLock.ts:43-45`). 변경 없음.

---

## 5. 일정 (10/31~11/3) · 검증 · 배포

### 5.1 범위 구분

| 구분 | 항목 |
|---|---|
| **11/4 필수** | T2-1 스레드풀·DB 풀 / T2-2 NOWAIT / T2-3 heartbeat 통합·DEGRADED 복귀 / T2-4 publish 틱 / T2-5 슬롯 / T1-1 전역 스위퍼(웹) / T1-2 복귀 재개(P3·P4) / T1-3 종료 후 "전송 중" 상태 + 지터 / 부하 재시험 2회 / 실밴드 시험 |
| **가능하면** | T1-4 summary API + 종료 대조 / T1-5 presign·ack 배치 |
| **후속** | metrics outbox 탈출(D 안) / 다중 워커(dict 5종 Redis 이관) / `_store_windows` 왕복 축소 / 적응형 백프레셔 / iOS 백그라운드 업로드 / 로컬 보관·삭제 UI / 셀룰러·배터리 정책 |

### 5.2 일정

| 날짜 | 작업 | 산출 |
|---|---|---|
| 10/31(토) | plan 확정, verify.md 작성, 부하시험 스크립트를 **프런트와 같은 묶음 전송(1~5초마다 5~60창)** 으로 수정 | plan·verify |
| 11/1(일) | T2-1~T2-5 구현(BE 1명) · T1-1~T1-3 구현(FE 1명, 파일 분리: BE `live_ingest_service.py`·`session_live_namespace.py`·`deps.py`·`config.py`·`main.py` / FE `useBiosignalCapture.ts`·`durable-queue.ts`·신규 sweeper 훅·`capture-controller.ts`) · 저녁 dev 배포(DEPLOY) → 부하 재시험 1차(착용 30·40) | PR, 시험 보고 |
| 11/2(월) | 결과 반영·T1-4/T1-5 여부 결정 · 실밴드 시험(§5.4) · 부하 재시험 2차 | 시험 보고 |
| 11/3(화) | dev 소크(실제 클래스 1회 60분, 착용 ≥5) · go/no-go · prod 릴리즈(별도 승인) · 현장 운영 지침 배포 | summary, 릴리즈 |
| 11/4(수) | 현장. 서버 CPU·스레드풀 대기·`not_ready`·429 모니터 담당 지정 | |

### 5.3 dev 40명 재시험 통과 기준

| 지표 | 기준 |
|---|---|
| 처리량 | 착용 30: ≥30창/초(600초 계획이 ≤660초에 종료). 착용 40: ≥40창/초 또는 최소 "거절 0·유실 0" |
| 거절 | `not_ready` 0, `live_session_epoch` Traceback 0, metric 타임아웃 0 |
| 저장 | 특징창 참여자별 600/600, (participant, stream, window_index) 중복 0, 결측 0 |
| 원시 | 청크 전량 `uploaded`, chunk_index 갭 0, identity 중복 0, 429 는 재시도로 전량 확정(시험 클라에 재시도 추가) |
| 지연 | metric ack P95 < 1,000ms, presence P95 < 500ms, renew 타임아웃 0 |
| 호스트 | 방송 수신 지연 P95 < 1,500ms(시험 클라에 호스트 수신 측정 추가 — 1차·재시험에서 못 함) |
| 자원 | 백엔드 프로세스 CPU < 90%, DB 활성 연결 < 30 |

### 5.4 실밴드 시험(dev, Android 앱 + 웹 각 1대 이상)

1. 측정 중 화면 잠금 3분 → 복귀: 소켓 재연결·특징창 저장 재개·원시 청크 연속(gap 1건만 기록).
2. 앱 백그라운드 3분 → 복귀: 동일.
3. 측정 중 앱 강제 종료 → 재실행(클래스 화면 안 들어감): 홈에서 스위퍼가 이어 올림, 데이터센터 `close_state` 가 `complete` 로 수렴.
4. 비행기 모드 2분 → 해제: 429/타임아웃 후 전량 확정.
5. 세션 종료 직후 앱 종료 → 10분 뒤 재실행: 잔여 전송 완료.
6. 다른 계정으로 로그인: 이전 계정 큐가 전송되지 않고 남아 있음.

### 5.5 배포·롤백 절차

- 모든 서버 변경은 env 플래그로 즉시 되돌릴 수 있게(T2-2·T2-3·T2-4). 플래그 off = 현행 경로.
- dev 배포는 `develop` 머지 → Deploy Dev(DEPLOY 창구). 배포 전후 `python3 scripts/check-alembic-heads.py`(마이그레이션 없음 예정).
- prod 릴리즈는 11/3 묶음 1회, Brian 승인 후. 롤백 = 직전 릴리즈 재설치(`deploy/install-release.sh`) + env 복원.
- 앱 바이너리 변경은 없다(T1 은 웹 번들; 네이티브 경로 변경 없음). 단 §4 P1 로 앱 사용을 권장하면 현장 기기의 앱 버전이 vc27/iOS31 이상인지 확인(band-analysis 지침).

---

## 6. 결정이 필요한 비즈니스 사항 (≤5)

1. **11/4 착용 인원 상한**: 현 구조로 40명 전원 착용은 보장 못 한다. T2 적용 후 재시험에서 40 기준을 넘지 못하면 **착용 30명 상한**으로 운영할지, 2개 회차로 나눌지.
2. **현장 기기 정책**: 회원은 **앱(네이티브 측정 경로)** 사용을 원칙으로 할지(화면 잠금 내성). 웹(모바일 브라우저) 허용 시 "화면 자동잠금 끄기" 지침만으로 가는지.
3. **세션 종료 비차단 + 백그라운드 이어올림** 승인. 리포트는 원시 업로드를 기다리지 않고, 데이터센터에 `pending_upload` 로 표시된다.
4. **로컬 잔존 데이터 보관·삭제**: 다른 계정 scope·24h+7일 지난 scope 를 30일 뒤 자동 삭제할지, 사용자가 지우게 할지. (원시 90일 보관은 라벨만 있고 실제 스위프는 비활성 — `config.py:216`)
5. **다중 워커·metrics outbox 탈출 후속 일정**과 prod 서버 사양(현재 dev 와 같은지 미확인).

---

## 7. 확인하지 못한 것

- `live_redis/scripts.py` 의 스트림 seq·replay cursor 생성 방식(D 안 설계 전제). `_handle_capture_renew` 가 만료 lease 를 거절하는지. DEGRADED→READY 복귀 코드 유무(§1.2 S5).
- `capture-controller.ts` 의 `MetricOutbox.flush()` 호출 주기(실제 배치 크기 → 서버 부하 환산에 필요).
- iOS `MeasurementKit` `Archive.swift`·`ArchiveUploader.swift` 본문(429·백오프·포그라운드 drain 트리거). Android `LinkWatchdog.kt`·`measurement/live` 재연결 정책 본문.
- 게스트(입장 자격) 큐를 앱 재시작 후 올릴 때 자격을 어디서 얻는지(스위퍼 설계 §3.5 ②).
- 웹 경로의 원시 큐 상한(quota 비율 외 절대값)과 iOS WKWebView IndexedDB 퇴거 조건.
- 운영(prod) 서버 사양·`LIVE_PROTOCOL_V2`·Redis manager 부착 여부. dev 는 4vCPU·v2 on·Redis 있음(report-rerun).
- 10/31 시연 세션 38ec9a6d 의 기기 플랫폼(웹/앱)과 앱 버전 — P1 판단의 전제.
- 서버 쿼리별 시간 분해(프로파일링)는 두 시험 모두 하지 않았다. §1.2 의 왕복 수는 코드 읽기 기준이다.
