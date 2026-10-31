# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · 통합 Plan (Stage ②)

- 작성: 2026-10-31 (감독 통합안, 대표 지시 10/31 "완결성 우선" 반영). 입력: `plan-astra.md`, `plan-fable.md`(둘 다 수정 금지, 근거 보존), `~/.hermes/share/loadtest-40/report*.md`, `~/.hermes/share/band-analysis/report.md`, `~/.hermes/share/briefs/sdd260-*.md`.
- 원칙: 범위를 일정으로 줄이지 않는다. 대신 **위험 낮은 것부터 Phase 로 나누고, 앞 Phase 게이트를 통과해야 다음으로 간다.** 변경마다 플래그·롤백·검증 시나리오(verify.md ID)를 붙인다.
- 표기: **[확인]** = 이 워크트리 코드·실측으로 확인, **[추정]** = 미확인.

---

# 1페이지 요약

## 결정 표

| 쟁점 | 안 | 채택 | 이유 |
|---|---|---|---|
| metric 투영 회차 락 | fable NOWAIT 건너뛰기 / astra pending 테이블+1초 회차별 묶음 투영 | **둘 다, 단계적.** Phase 1 = NOWAIT(즉시 안정화·롤백 경로), Phase 4 = pending 투영(**기본 설계**) | NOWAIT 는 변경 80줄·마이그레이션 0 으로 11/4 안정화에 맞고, 수신 요청에서 락 시도 자체(40/s)와 커밋 2회를 없애는 것은 pending 안뿐. pending 이 게이트를 통과하면 NOWAIT 는 플래그 off 시 fallback 으로 남는다 |
| `not_ready` 559 경로 | heartbeat DEGRADED 복귀 부재 | **확정, Phase 1 T2-3** | `READY` 설정은 join 수락 1곳뿐(§2 F5) |
| 트랙 1 필수 경로 | 웹 IndexedDB 스위퍼 / 네이티브 | **네이티브 우선**, 웹 스위퍼는 Phase 2 포함(브라우저 참가자용) | 앱은 항상 `native` 경로(F2). 앱 재빌드 필요(F1) |
| feature 폐기(300창 초과)→DB 재생 | 후속 / 포함 | **Phase 3 포함** | 6분 오프라인이면 live 큐 폐기가 실제로 난다. archive 객체에만 남으면 "저장 100%" 가 아니다 |
| 24h close deadline 이후 접수 | 후속 / 포함 | **Phase 3 포함(검역 접수)** | 비행기 모드·강제 종료가 겹치면 24h 를 넘길 수 있다. 현행 409 는 영구 유실 경로 |
| iOS 업로드 완결 | 시작 시 drain 만 / BGProcessingTask·background URLSession 포함 | **Phase 2 = 시작·포그라운드 drain + background URLSession 재연결, Phase 3 = BGProcessingTask** | 현재 `recoverOnLaunch` 는 CAPTURING 만 복구(F4) |
| Android 미완료 scope | 마지막 1개 / 전부 | **Phase 2 전부 탐색** | `runtime.json` 1개만 읽음(F3) |
| presign/ack 배치화 | 후속 / 포함 | **Phase 2(네이티브)·Phase 3(웹)** | 서버는 이미 리스트를 받는다. 요청 수 72→26/24청크 |
| 적응형 백프레셔 | 후속 / 포함 | **Phase 4** | executor 대기 계측(Phase 0)이 전제 |
| 다중 uvicorn 워커 | 금지 / 단계적 | **Phase 5(11/4 이후)**, v1 휘발 상태 5종·대기실 presence·archive 슬롯 Redis 이관 뒤 `--workers 2` | 단일 프로세스에서 Phase 4 까지 통과한 뒤에만. 11/4 전 금지 |
| 실밴드 시험 | 구현 전 선행 / 구현 후 | **구현 후 수행(대표 결정)**, 시나리오는 verify §D 유지 | — |

## Phase 목록 · 게이트

| Phase | 내용 | 게이트(통과해야 다음) | 11/4 관계 |
|---|---|---|---|
| **P0** 선행 | S3 HEAD 403 원인·ack 검증 경로 확인, 부하 스크립트 묶음 전송·ACK 분리, executor 대기·loop lag 계측 | G0: 403 해소 또는 원인 기록, 스크립트 1회 정상 실행 | 11/1 오전 |
| **P1** 서버 안정화 | T2-1 스레드풀·DB 풀, T2-2 NOWAIT+dirty 재투영, T2-3 heartbeat 1회·DEGRADED 복귀, T2-4 publish 틱, T2-5 archive 슬롯 | **G1**: V-L1·V-L2 합격선(§4.4) | 11/1 저녁 배포·재시험 |
| **P2** 원시 업로드 완결성 | Android 전 scope drain, iOS 시작·포그라운드 drain + background URLSession 재연결, 종료 비차단·지터·"업로드 중" 상태, presign/ack 배치(네이티브), 수신 요약 API + 종료 대조, 웹 스위퍼 | **G2**: V-C1~C6·C8·C10, V-S15 | FE 동결 11/2 12:00 → 앱 빌드 |
| **P3** 복귀 재개·완결성 확장 | 복귀 재개(renew·flush·drain·측정 계속), feature archive→DB 재생(historical), 24h 이후 검역 접수, iOS BGProcessingTask, presign/ack 배치(웹), 로컬 보관 정책 표시 | **G3**: V-C7·C9·C11, V-S16~S18, V-B5 재생 확인 | 서버 쪽은 11/3 까지 가능하면, 앱 쪽은 11/4 이후 빌드 |
| **P4** 실시간 투영 구조 | `live_metric_projection_pending` + 1초 회차별 묶음 투영(수신 요청에서 회차 락 제거), 적응형 백프레셔, `_store_windows` 왕복 축소 | **G4**: V-S10~S12, V-L2 ≥40창/s 지속, 락 보유 P95<50ms | 11/5~11/8 |
| **P5** 다중 워커 | v1 dict 5종·대기실 presence·archive 슬롯 Redis 이관 → `--workers 2` | **G5**: 2워커에서 V-L3·V-S 전부 + 프로세스 재시작 중 ACK 유실 재전송 | 11/9~11/12 |

## 11/3 go/no-go (현장 적용 게이트)

- **go 조건**: G1 + G2 통과, 후보 빌드(Android APK 사이트·iOS TestFlight) 설치 가능, dev 소크 60분(착용 ≥5) 통과. G3 서버 부분은 들어가면 좋고 없어도 go 가능(additive).
- **no-go 시 대안(대표 결정)**: (a) 검증된 착용 인원 상한(예: 30) (b) 2회차 분할 (c) EEG 없이 상담·명상 진행. 실패한 40명 구성을 현장에 적용하지 않는다.
- 네이티브 변경은 **사용자가 앱을 업데이트해야 적용**된다. 서버 변경은 즉시 적용되므로 **서버는 구버전 앱(vc31/iOS31)과 호환되게 additive 로만** 바꾼다.

## 대표 결정 사항 (≤5)

1. 11/3 go/no-go 미달 시 (a)/(b)/(c) 중 택일.
2. 현장 기기 정책: 회원은 앱 + 후보 빌드 설치 필수로 할지. 웹 브라우저 참가자 허용 여부.
3. 종료 비차단 + 백그라운드 이어올림 승인. 리포트는 업로드를 기다리지 않고 `pending_upload` 표시.
4. 로컬 미완료 원본 보관 정책(기본안: 7일 경고·자동 삭제 없음, 완료분 receipt 후 24h 유예). 24h 이후 검역 접수의 승인 주체(기관관리자/운영).
5. 셀룰러 전송: 종료 후 잔여 전송을 셀룰러에서 기본 허용할지, 대기 표시 후 사용자 허용으로 할지.

---

## 1. 결론 (근거 요약)

1. 병목은 단일 uvicorn 프로세스 + 회차 1행 락(`_project_latest`→`lock_epoch`) + 8스레드 기본 executor 의 3중 직렬화다. 2→4vCPU 증설은 +23%뿐(report-rerun §4).
2. 착용 40의 `not_ready` 559건은 heartbeat 실패 → `DEGRADED` → 복귀 없음 경로로 확정(F5).
3. 트랙 1 의 빈 곳은 "미완료 큐를 화면 밖에서 찾아 올리는 전역 복구"다. Android 는 마지막 1세션만(F3), iOS 는 CAPTURING 복구만(F4) 있다.
4. 앱 웹 번들은 내장(F1) → 프런트·네이티브 변경은 앱 재빌드·사용자 업데이트가 필요하다.

## 2. 코드로 확정한 사실

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F1 | 앱 웹 번들 내장, 원격 로드 없음 | `frontend/capacitor.config.ts:6` `webDir: 'dist'`, `server` 키 없음 | 프런트 변경 = 앱 재빌드·설치. plan-fable §5.5 정정 |
| F2 | 앱이면 측정 경로는 항상 `native` | `frontend/src/lib/measurement-web/measurement-path.ts:21-27` | 트랙 1 필수 = 네이티브 코드 |
| F3 | Android `ArchiveWorker` 는 `measurement/runtime.json` 1개만 읽어 마지막 세션만 drain | `measurement/runtime/ArchiveWorker.kt:16-18,41-50` | P2-N1 |
| F4 | iOS `recoverOnLaunch` 는 CAPTURING 류만 복구(`CLOSED`·`SEALING` 제외). 앱 시작(`MeasurementHost.swift:55`) 외 archive drain 트리거 없음; `willEnterForeground` 는 visibility 전달만(`NativeMeasurementPlugin.swift:33`) | `MeasurementKit/MeasurementManager.swift:340-345` | P2-N2 |
| F5 | `DEGRADED→READY` 복귀 없음. `READY` 는 join snapshot 수락(`:2207`)뿐. heartbeat 실패(`:2338-2341`)·명령 degraded(`:2250-2251`)·snapshot Redis 장애(`:2151`)가 DEGRADED 로 내림. heartbeat 성공은 `degraded_notified=False` 만(`:2348`). `_ingest` 는 READY 아니면 `not_ready`(`:2299-2303`) | `backend/app/ws/session_live_namespace.py` | P1-T2-3 핵심 |
| F6 | 기본 executor 미설정(`set_default_executor` 0건, `agent_llm.py:68` 만 자체 풀) | grep | 4vCPU = 8스레드 |
| F7 | `_project_latest` 는 락 먼저, prev 나중. 충돌 시 `db_lock_timeout_ms=10_000` 대기 | `live_ingest_service.py:265-283`, `config.py:88` | P1-T2-2 |
| F8 | 투영 실패는 ACK 를 막지 않고 "다음 수신이 갱신"에 의존 | `live_ingest_service.py:163-170` | 마지막 창 영구 미투영 → dirty 재투영 |
| F9 | `capture.renew` 는 만료 lease 를 거절하지 않음(stream active·generation·세션 미종료만) | `session_live_commands.py:361-371` | 복귀 시 renew 1회면 됨 |
| F10 | 서버에 feature archive→`eeg_feature_windows` 재생 경로 없음 | grep `EegFeatureWindow` in `biosignal_*.py` 0건; manifest 는 alias 존재만(`biosignal_manifest_service.py:247-278`) | P3-B1 |
| F11 | archive 슬롯 6/대기 1.5s/Retry-After 3 고정, 프로세스 로컬 semaphore | `config.py:92-93`, `api/deps.py:102-114` | P1-T2-5, P5 Redis 이관 |
| F12 | 24h close deadline 이후 `pending_time_review` 는 409 거절 | `biosignal_service.py:100-101`(astra 확인) | P3-B2 |
| F13 | S3 HEAD 403: 새 dev(35.75.58.187)에서 객체 존재 확인 실패, 구 서버는 5/5 성공 | report-rerun §3 | P0 |

---

## 3. Phase 0 — 선행 (11/1 오전, DEPLOY/OPS + QA)

| ID | 내용 | 소유 | 게이트 |
|---|---|---|---|
| P0-1 | S3 HEAD 403 원인(인스턴스 프로파일 vs `.env.dev` 키, 접두사·길이만 확인). ack 의 HEAD 검증(`storage_service.py:251-272`)이 성공하는지 → 실패면 `uploaded` 판정 자체가 의심. 운영 서버 교체 시 동일 점검 | DEPLOY/OPS | 403 해소 또는 원인·영향 기록 |
| P0-2 | 부하 스크립트: 생산 시계 1Hz 와 ACK 분리, `MetricOutbox` 와 같은 묶음 전송(1~5초마다 5~60창, 큐 300, `not_ready`→재join 재전송, 429 재시도), 호스트 수신 지연 측정, 영상·음성·상태 동시 부하 옵션. `backend/scripts/loadtest/` 커밋 | QA | 스모크 1회 정상 |
| P0-3 | 서버 계측: executor 대기 시간·loop lag·epoch 락 대기·투영 성공/건너뜀 카운터를 로그/`/metrics` 로 노출(additive) | BE1 | 대시보드 1장 |

## 4. Phase 1 — 서버 안정화 (BE1, 11/1 배포)

### 4.1 작업

| ID | 변경 | 파일 | 플래그/env | verify |
|---|---|---|---|---|
| T2-1 | lifespan 에서 `loop.set_default_executor(ThreadPoolExecutor(max_workers=settings.ws_thread_pool_size))` 기본 32. DB 풀 10/10→20/20(env, DEPLOY). RDS 79 · Celery 8×2 고려해 웹 합계 ≤40 | `main.py`, `config.py`, `.env` | `WS_THREAD_POOL_SIZE`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | V-S14 |
| T2-2 | `_project_latest`: ① prev `entity_version` 락 없이 선독, 더 새 값 있으면 False ② `lock_epoch(nowait=True)`; `LockNotAvailable` 면 rollback·False + 프로세스 전역 `dirty{(session, participant)}` 표시 ③ T2-4 틱이 dirty 를 현행 대기 락으로 재투영(최신 `eeg_feature_windows` 행 기준) → F8 해소 | `live_ingest_service.py`, `session_live_ledger.py` | `LIVE_V2_PROJECT_NOWAIT` | V-S4, V-S6, V-S7 |
| T2-3 | heartbeat: ① `publish_session_sync` 세션당 1회/`V2_HEARTBEAT_S` ② heartbeat 경로 `publish_pending(wait_s=0)`, 명령 ACK 경로는 현행 ③ **DEGRADED 복귀**: 연속 3회 실패 시에만 DEGRADED, 성공 1회면 READY(단 `pending_snapshot` 없고 상태가 DEGRADED 일 때만; RESYNCING/REVOKED/TERMINAL 불변) ④ `live:heartbeat` 에 `recovered:true` | `session_live_namespace.py` | `LIVE_V2_HB_SINGLE_DRAIN`, `LIVE_V2_DEGRADED_RECOVER` | V-S5, V-S8 |
| T2-4 | ingest 후 즉시 publish → 세션 dirty → 프로세스당 틱 1개(`LIVE_V2_PUBLISH_TICK_MS` 기본 300)가 dirty 세션 publish + T2-2 ③ 재투영 | `live_ingest_service.make_sinks`, `session_live_namespace.py` | `LIVE_V2_PUBLISH_TICK_MS`(0=즉시) | V-S9 |
| T2-5 | archive 슬롯 6→16, 대기 0.5s, `Retry-After` 2~6 랜덤 | `config.py`, `api/deps.py` | `ARCHIVE_MAX_CONCURRENT`, `ARCHIVE_SLOT_WAIT_SEC` | V-L4 |

커밋: T2 하나당 1커밋(개별 revert). 롤백: 플래그 off + env 복원 + 재기동 1회(V-D1).

### 4.2 G1 게이트 (= verify V-L1·V-L2)

| 지표 | 기준 |
|---|---|
| 처리량 | 착용 30 ≥30창/s(600초 계획 ≤660초 종료). 착용 40 ≥40창/s **또는** 거절 0·유실 0 |
| 거절 | `not_ready` 0, `live_session_epoch` Traceback 0, metric 타임아웃 0, renew 타임아웃 0 |
| feature | 참여자별 600/600, (participant, stream, window_index) 중복 0, 결측 0 |
| 원시 | 청크 100% `uploaded` + S3 HEAD size·sha256 대조(P0-1 선행), chunk_index 갭 0, identity 중복 0 |
| 지연 | metric ACK P95 < 1,000ms, presence P95 < 500ms, 호스트 수신 P95 < 1,500ms |
| 자원 | 프로세스 CPU < 90%, DB 활성 < 30, RSS 지속 증가 없음 |

G1 미달이어도 Phase 2 는 병렬 진행 가능(파일 겹침 없음). 단 P4 조기 착수 판정: V-L2 에서 `not_ready`>0 / Traceback>0 / 600 미달자 / ACK P95>1,000ms 중 하나면 BE1 은 P3 서버 작업보다 **P4 pending 투영을 앞당긴다**(11/2).

### 4.3 영상·음성·상태

`lock_epoch` 호출처는 `live_ingest_service`(metric·device)·`session_live_commands.apply_command` 뿐 [확인: grep]. LiveKit 토큰·녹음 start/stop 은 REST → 락 비공유, 프로세스·스레드풀 공유 → T2-1 수혜. `live:device`·`capture.renew`·`entry.enter`·`session.end` 는 락 공유 → T2-2 로 대기 감소. 재시험에 동시 부하 포함(V-S13, V-L3).

## 5. Phase 2 — 원시 업로드 완결성 (FE/Native1 + BE1 API, FE 동결 11/2 12:00)

### 5.1 공통 계약

- **종료 비차단**: 종료 = 로컬 봉인 + close intent 영속 + feature flush. 화면은 "수업 종료 · 데이터 업로드 중 N건(MB)" → "업로드 완료"/"확인 필요".
- **완료 3조건**: ① 로컬 큐 pending·dead_letter·time_review 0 + 모든 봉인 alias 에 receipt ② 수신 요약 API 각 (participant, stream, segment, signal) 그룹 `missing_ranges=[]`·`receipt_hash` 일치 ③ manifest `close_state=='complete'`.
- **몰림 완화**: 종료 직후 첫 업로드 지터 0~60s, 재시도 full jitter `0..min(60s, 1s×2^attempt)` + 서버 Retry-After 하한, 기기 동시 PUT 1(유휴 2), presign/ack 배치 ≤24, `nextAttempt` 영속. 429/5xx/네트워크는 횟수 제한으로 dead_letter 금지. 401 인증 대기, 403 사유별, 409·해시 훼손 격리.
- **"무조건 백그라운드 재개"의 정의**: 인증·네트워크·OS 실행 기회가 돌아오면 화면과 무관하게 자동 재시도. **OS 강제종료 중 상시 실행은 약속하지 않는다.** 합격 조건은 재실행 후 영속 데이터 복구 + 미수집 gap 표기.
- **격리**: scope = API 환경 + account + participant + session. 다른 principal scope 는 전송하지 않고 보존. 서버 `resolve_participant` 이중 방어.
- **리포트**: 업로드를 기다리지 않는다(리포트 파이프라인은 `close_state` 미사용 [확인]). 데이터센터 `pending_upload` 표시.

### 5.2 작업

| ID | 플랫폼 | 변경 | 파일 | verify |
|---|---|---|---|---|
| P2-N1 | Android | `ArchiveWorker`/`NativeArchiveOnly.drain` → `filesDir/measurement/*/archive` 전부 탐색, `archivePending>0` 또는 close-intent 미전송 세션 모두 drain(동시 scope 1). scope account ≠ 현재 토큰 account 면 건너뜀(보존). 앱 시작·네트워크 연결·포그라운드에서 `ArchiveWorker.schedule(ctx, jitter)` | `runtime/ArchiveWorker.kt`, `NativeRuntime.kt`, `RuntimeConfig`, `archive/ArchiveQueue.kt`(account 메타) | V-C5, V-C6 |
| P2-N2 | iOS | `drainPendingArchives()` 신설: `sessionDir(*)` 중 pending>0 또는 close intent 미전송 세션 전부 `ArchiveUploader` drain(SEALING/CLOSED/DRAINING 포함, CAPTURING 복구와 분리; 3h/128MiB veto 는 활성 재개에만). 호출: 앱 시작(`MeasurementHost.swift:55` 직후), `willEnterForeground`, 네트워크 복귀. background URLSession task ID↔alias 재연결 | `MeasurementManager.swift`, `ArchiveUploader.swift`, `MeasurementHost.swift`, `NativeMeasurementPlugin.swift` | V-C5, V-C6 |
| P2-N3 | 양쪽 | 종료 비차단 + 지터 + 상태 표시: close 직후 첫 drain 0~60s 지터, full jitter 재시도, 네이티브→JS `archive.counts` 이벤트. JS 는 `BiosignalRecordingStatus` 를 "업로드 중 N건" 으로 확장 | `ArchiveUploader.kt/.swift`, `NativeMeasurementPlugin`, `recording-status.tsx`, `use-native-measurement.ts` | V-C4, V-C8 |
| P2-N4 | 양쪽 | presign/ack 배치 ≤24(서버는 이미 리스트 수신 `biosignal_service.py:212,330`) | `ArchiveUploader.kt/.swift` | V-C3, V-L4 |
| P2-S1 | 서버 | `GET /api/v1/sessions/{id}/biosignal-raw/summary?participant_id=`: 본인·호스트만, `archive_upload_slot` 비적용. 그룹 키 (participant, stream, segment, signal). 그룹별 `uploaded_count, pending_count, uploaded_bytes, max_sequence, contiguous_through, missing_ranges(≤200, truncated), conflict_count, time_review_count, receipt_hash(정렬된 (alias,sequence,size,sha256) 집합 SHA-256), last_verified_at`; 상위 `manifest_revision, close_state` | `api/v1/session.py`, `services/biosignal_service.py`, `schemas/biosignal.py` | V-S15 |
| P2-N5 | 양쪽 | 종료 대조: close 후 summary 로 `missing_ranges`·`receipt_hash` 대조 → 서버에 없는 것만 재큐잉, 로컬에도 없으면 `gap(local_missing)` | `ArchiveUploader.kt/.swift` | V-C3 |
| P2-W1 | 웹 | `BiosignalQueue.listScopes()` + `useBiosignalResumeSweeper()`(앱 셸, 시작·online·복귀·60초, 같은 account scope 만, lease 보유 중 scope 건너뜀) | `lib/biosignal/durable-queue.ts`, 신규 훅, `hooks/useBiosignalCapture.ts` | V-C5(웹) |

### 5.3 G2 게이트

V-C1~C6, V-C8, V-C10, V-S15 전부 통과(로컬 디버그 빌드로 선행 검증, 후보 빌드로 재확인). 앱 호환: 구버전 앱(vc31/iOS31)이 새 서버에 붙어도 기존 동작 유지(V-D6).

## 6. Phase 3 — 복귀 재개 · 완결성 확장 (서버는 11/3 까지 가능하면, 앱은 11/4 이후 빌드)

| ID | 변경 | 소유 | 플래그 | 위험·완화 | verify |
|---|---|---|---|---|---|
| P3-N1 | 복귀 재개: 포그라운드·네트워크 복귀 시 ① `capture.renew` 1회(F9) ② `MetricOutbox.flush()` ③ archive drain ④ 소켓 READY 확인 후 측정 계속. 종료된 회차면 archive 만. BLE 캐시 없으면 "밴드 다시 연결" 배너 | FE/Native1 | — | 잘못된 재측정 → 서버 세션 진행·동의·generation 확인 후에만 | V-C9, V-B2~B4 |
| P3-B1 | **feature archive→DB 재생(historical)**: feature artifact `uploaded` 확정 시 Celery 태스크가 객체를 읽어 `eeg_feature_windows` 에 기존 멱등키로 INSERT … ON CONFLICT DO NOTHING. `source='archive_replay'` 표식, **live 투영 안 함**, 원 principal·stream·generation·측정 당시 동의·cutoff 검증, 불명은 격리 | BE1 | `BIOSIGNAL_FEATURE_REPLAY` | fencing 우회 → historical 전용, outbox 미기록. hash 충돌은 첫 저장 보존 | V-S16, V-B5 |
| P3-B2 | **24h 이후 검역 접수**: `pending_time_review` 를 409 대신 접수해 `upload_status='time_review'` 로 저장(S3 객체는 올림), live 반영 금지, 승인/거절 감사 기록, 관리자 승인 시 `uploaded` 전환. 클라는 deadline 을 우회하지 않는다 | BE1 | `BIOSIGNAL_TIME_REVIEW_INTAKE` | 권한 철회 자료 유입 → 원 principal·동의 상태 검증, 철회면 거절 | V-S17, V-C7 |
| P3-N2 | iOS `BGProcessingTask` 등록(야간·충전 중 drain), background URLSession 완료 핸들러 → receipt 영속 | FE/Native1 | — | OS 가 실행을 보장하지 않음 → 합격 조건 아님, 기회 시 동작만 확인 | V-B9 |
| P3-W2 | 웹 presign/ack 배치화(`upload-queue.ts uploadOneStaged`→배치) | FE/Native1 | — | 회귀 → 웹 큐 단위 테스트 | V-C3(웹) |
| P3-N3 | 로컬 보관 정책 표시: 다른 계정 scope·7일 지난 미완료를 설정 화면에 "전송 못 한 측정 데이터 N건" 표시, 자동 삭제 없음(대표 결정 4) | FE/Native1 | — | — | V-C12 |

**G3**: V-C7·C9·C11·C12, V-S16~S17, V-B5 에서 폐기 창이 DB 에 재생됨. 서버 부분(P3-B1·B2)은 additive 라 구앱과 호환.

## 7. Phase 4 — 실시간 투영 구조 개선 (BE1, 11/5~11/8; G1 미달 시 11/2 로 앞당김)

| ID | 변경 | 플래그 | verify |
|---|---|---|---|
| P4-1 | 테이블 `live_metric_projection_pending` PK(session_id, participant_id): generation, sequence, entity_version, payload, updated_at. additive 마이그레이션(BE1 1명). 생성과 활성화 분리 | — | V-D2 |
| P4-2 | 수신: `_persist_feature_items` 에 live 전용 no-commit 옵션(기존 호출자 기본 유지) → feature INSERT + pending 조건부 UPSERT **같은 트랜잭션 1회 커밋** → durable ACK. 수신 요청은 epoch 락을 잡지 않는다. participant/stream 조회·기존 키 조회 배치화 | `LIVE_V2_PENDING_PROJECTION` | V-S11 |
| P4-3 | 1초 주기 drain(프로세스당 1): epoch 락 → 회차 pending ≤40 → generation·cutoff 재확인 → outbox revision 연속 기록 → 커밋과 pending 조건부 삭제 원자 → 락 해제 후 projector 방송. 재시작 시 pending 자동 스캔(마지막 창 투영 보장) | 동일 | V-S4(2단계판), V-S10, V-S12 |
| P4-4 | 락 순서 고정: 명령/투영 epoch→participant/stream→pending, ingest 는 participant/stream→pending. 역진입 금지 assert | — | V-S10 |
| P4-5 | 적응형 백프레셔: executor 대기열 길이·loop lag 가 임계(기본 64/50ms) 초과 시 `_ingest` 가 `retry_after_ms` 2,000~5,000+지터 반환(`db_unavailable` 와 구분되는 `overloaded` 코드). 클라는 기존 retryable 경로로 처리 | `LIVE_V2_ADAPTIVE_BACKPRESSURE` | V-S18 |
| P4-6 | `_store_windows` 왕복 축소(stream 객체 재사용, `evaluate_ingest` 에 로드된 stream 전달) | — | 기존 테스트 |

**G4**: V-S10~S12·S18, V-L2 ≥40창/s 60분 지속, 락 보유 P95<50ms·최대 200ms, 커밋 요청당 1회. 롤백: writer off → pending drain 0 확인 → `LIVE_V2_PENDING_PROJECTION=false`(NOWAIT 경로로 복귀). **단순 off 로 pending 방치 금지.**

NOWAIT 와의 관계: P4 통과 후 기본 경로는 pending 투영, NOWAIT 는 플래그 off fallback 으로 유지. 둘을 동시에 켜지 않는다(배타 검증 V-S19).

## 8. Phase 5 — 다중 uvicorn 워커 (BE1 + DEPLOY, 11/9~11/12)

| 순서 | 변경 | verify |
|---|---|---|
| P5-1 | v1 프로세스 전역 dict 5종(`_active_signals`, `_last_aggregate_at`, `_last_group_average_at`, `_audio_states`, `_audio_revisions`; `session_live_namespace.py:44-52`) → Redis hash/TTL. 대기실 presence 휘발 메모리(`:1371-1372`) → Redis | 단일 워커에서 회귀 0(V-S 전부) |
| P5-2 | archive 슬롯 프로세스 semaphore → Redis lease(전역 예산 16) | V-L4 |
| P5-3 | T2-4 publish 틱·T2-2 dirty·P4 drain 의 "프로세스당 1" → Redis 락으로 리더 선출 또는 세션 샤딩 | V-S8·S9 2워커 |
| P5-4 | Socket.IO: `AsyncRedisManager` 부착 확인, polling sticky 또는 WebSocket-only | 재연결 시험 |
| P5-5 | `--workers 2`(4vCPU) dev 시험 → V-L3 + 프로세스 1개 재시작 중 ACK 유실 재전송 | **G5** |

DB 예산: 워커 2 × (20+20) = 80 > RDS 79 → 워커당 풀 15/10 로 재계산. 단순 `--workers 4` 금지.

## 9. 앱 빌드·호환 규칙

- **서버 변경은 배포 즉시 전 사용자 적용. 앱(네이티브·웹 번들) 변경은 사용자가 업데이트해야 적용.** 따라서 서버 API·이벤트는 additive 만(새 필드·새 엔드포인트·새 플래그), 구앱 와이어 계약 삭제 금지(V-D6).
- Android: 사이트용 AAB → Play 서명 APK → 사이트 업로드 + `latest.json`(vc31 부터 앱 내 업데이트 알림). 소요 반나절~1일. iOS: TestFlight 업로드 + 베타 심사 수 시간.
- Phase 마다 앱 빌드가 필요하면 "FE/네이티브 동결 시각 → 빌드 → 설치 확인" 을 일정에 넣는다(§10).

## 10. 일정 (11/4 = 목표 마일스톤, 이후 단계 포함)

| 일시 | 작업 | 게이트/롤백 |
|---|---|---|
| 10/31(토) | plan·verify 확정, Brian 승인 | — |
| 11/1(일) 오전 | P0 전부. BE1 T2-1~T2-5 착수. FE/Native1 P2-N1·N2 착수 | G0 |
| 11/1(일) 18:00 | BE PR → DEPLOY dev 반영 → **부하 재시험 1차**(착용 30·40, 묶음) | G1 / 플래그 off |
| 11/2(월) 09:00 | G1 판정. 미달이면 BE1 은 P4 를 11/2 로 앞당김, 통과면 P2-S1·P3-B1 진행 | — |
| 11/2(월) 12:00 | **FE/네이티브 동결 #1**(P2 전부) → APP 빌드 착수(Android 반나절~1일, iOS 수 시간) | 직전 빌드 유지 |
| 11/2(월) 오후 | P2 로컬 디버그 빌드로 V-C 실행(실밴드 아님, 시뮬레이터/재생). BE dev 반영 → **부하 재시험 2차** | G2(디버그) |
| 11/2(월) 22:00 | **서버 동결 #1** | — |
| 11/3(화) 오전 | 후보 빌드 설치 → **실밴드 시험(구현 후, verify §D)** V-B1~B4·B6·B9·B10. dev 소크 60분(착용 ≥5) | G2(후보 빌드) |
| 11/3(화) 15:00 | **go/no-go**. go 면 prod 릴리즈(별도 승인) + 현장 지침·앱 설치 안내 | no-go 시 대표 결정 (a)/(b)/(c) |
| 11/4(수) | 현장. 모니터: 프로세스 CPU·`not_ready`·epoch Traceback·429·executor 대기 | 플래그 off |
| 11/5~11/8 | P3 잔여(P3-N1·N2·W2·N3, P3-B1·B2 미완분) + P4. FE 동결 #2 11/7 → 앱 빌드 #2 | G3, G4 |
| 11/9~11/12 | P5 다중 워커. 60분 소크·카오스(프로세스 재시작) | G5 |
| 11/13 | summary.md, 후속 SDD 분리 여부 판정 | Stage ⑥ |

**일정 위험**: ① Android APK 가 1일 걸리면 11/3 설치 빠듯 → 동결 #1 을 못 지키면 네이티브 변경은 11/4 현장에 못 들어가고 운영 지침(앱 전면 유지·자동잠금 끄기·절전 제외·최신 빌드 확인)으로 대체. ② G1 미달로 P4 를 앞당기면 BE1 하루에 마이그레이션 포함 → 서버 동결 초과 가능. ③ 현장 Wi-Fi·40폰 리허설 확보 불가 → 소수 실기기 + 합성 40명으로 대체, 잔여 위험 대표 보고. ④ 실밴드 시험이 구현 후(11/3)로 밀려 발견된 문제는 11/4 전 수정 불가 → 지침 대체.

## 11. 작업 분해 · 파일 소유 (겹침 없음)

| 역할 | 소유 파일 | 커밋 단위 |
|---|---|---|
| **BE1** | `backend/app/services/live_ingest_service.py`, `session_live_ledger.py`, `ws/session_live_namespace.py`, `config.py`, `main.py`, `api/deps.py`, `api/v1/session.py`(라우트 추가), `services/biosignal_service.py`, `schemas/biosignal.py`, `tasks/biosignal_feature_replay.py`(신규), `models/`·`alembic/versions/`(P4 1개), `backend/tests/` | T2-N 각 1커밋, P2-S1 1, P3-B1·B2 각 1, P4 3(모델/수신/drain), P5 5 |
| **FE/Native1** | `frontend/android/.../measurement/**`, `frontend/ios/MeasurementKit/**`, `frontend/ios/App/App/Measurement/**`, `frontend/src/lib/measurement-web/use-native-measurement.ts`, `recording-status.tsx`, `lib/biosignal/**`, 신규 sweeper 훅, `hooks/useBiosignalCapture.ts` | P2-N1~N5·W1 각 1(플랫폼 분리), P3-N1~N3·W2 각 1 |
| **QA(독립)** | `backend/scripts/loadtest/**`, 검증 스크립트, `specs/sdd-260-*/test-results/` | 시험 1회당 1커밋 |
| **DEPLOY/OPS/APP** | `.env`, systemd, IAM, 앱 빌드·사이트·TestFlight | 코드 커밋 없음 |

PR: Phase 당 BE·FE 각 1개(`[SDD-260] …`), 머지는 DEPLOY 창구. 구현자 ≠ 검증자.

## 12. 확인하지 못한 것

- iOS `ArchiveUploader.swift` 본문(429·background URLSession 재연결), `MetricOutbox.swift` flush 주기 — P2-N2·P3-N1 구현 전 정독.
- Android `LinkWatchdog.kt`·`measurement/live` 재연결 정책, 로그아웃 상태 scope 보존 동작.
- 게스트(입장 자격) scope 재시작 후 자격 보관 위치.
- `live_redis/scripts.py` 스트림 seq·replay cursor(P5 리더 선출 설계 전제).
- 운영 서버 사양·`LIVE_PROTOCOL_V2`·Redis manager 부착·prod S3 권한.
- 10/31 시연 세션 기기의 플랫폼·앱 버전.
- 60분·1인 원시 실제 용량(추정 18~43MB) → V-B1 에서 실측.
- feature artifact 포맷이 `eeg_feature_windows` 로 손실 없이 역매핑되는지(P3-B1 전제) — artifact 인코더 정독 필요.
- 서버 쿼리별 프로파일링 미실시.
