# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · 통합 Plan (Stage ②, 10/31 우선순위 재정렬판)

- 작성: 2026-10-31 (감독 통합안 → 같은 날 대표 지시 "오프라인 클래스 · 저장 완결성 최우선" 으로 재정렬). 입력: `plan-astra.md`, `plan-fable.md`(둘 다 수정 금지, 근거 보존), `~/.hermes/share/loadtest-40/report*.md`, `~/.hermes/share/band-analysis/report.md`, `~/.hermes/share/briefs/sdd260-*.md`.
- 원칙: 범위를 일정으로 줄이지 않는다. **[A] 저장 완결성 → [B] 리포트·회원 자기 화면 → [C] 코치 실시간 모니터링** 순으로 Phase 를 세우고, 앞 Phase 게이트를 통과해야 다음으로 간다. 변경마다 플래그·롤백·검증 시나리오(verify.md ID)를 붙인다.
- 표기: **[확인]** = 이 워크트리 코드·실측으로 확인, **[추정]** = 미확인.

---

# 1페이지 요약

## 대표 지시 (10/31, 최우선)

11/4 부터 하는 것은 모두 **오프라인 클래스**다. 코치 실시간 모니터링은 룩시드랩스 전담 코치가 보는 것이라 중요도가 낮다. 반드시 지킬 것 세 가지:
(1) **회원 데이터가 빠짐없이 서버 DB·S3 에 저장된다** (2) **리포트가 나온다** (3) **회원 자기 화면에 자기 데이터가 잘 보인다**. 데이터만 저장되면 리포트는 어떻게든 살릴 수 있다.

## 우선순위 재분류

| 등급 | 뜻 | 들어가는 변경 | 11/3 합격선 관계 |
|---|---|---|---|
| **[A] 저장 완결성** | feature→DB, 원시→S3/DB, 종료·재접속·강제종료 후 이어 올림. 실시간 연결 상태와 무관하게 저장 | A1 `_ingest` 저장 우선(연결 상태 독립), A2 DEGRADED→READY 복귀, A3 스레드풀·DB 풀, A4 투영 NOWAIT(저장 스레드를 10초 락 대기에 묶지 않기), A5 archive 슬롯, **A6 feature archive→DB 재생(P3-B1 승격)**, A7 24h 이후 검역 접수, A8 Android 전 scope drain, A9 iOS 전 scope drain + background URLSession, A10 종료 비차단·지터·배치, A11 복귀 재개(renew·outbox flush·drain), A12 수신 요약 API + 종료 대조 | **필수** |
| **[B] 리포트·자기 화면** | 리포트가 읽는 데이터가 전부 DB 에 있는가, 결측·지연 표기, 재생성. 회원 자기 화면이 서버 장애와 독립인가 | R1 리포트 결측 판정("데이터 확인 중"), R2 새 데이터 유입 시 재생성, R3 `pending_upload` 표시, M1 자기 화면 로컬 우선(서버 LiveState 는 보조), M2 끊김 중 로컬 값 유지·복귀 후 이어짐 | **필수**(R1·M1), R2·R3 는 서버 단독분만 |
| **[C] 코치 실시간 모니터링** | 호스트 수신 지연, publish 틱, pending 투영 테이블, 적응형 백프레셔, 다중 워커 | C1 publish 틱, C2 `live_metric_projection_pending` + 1초 묶음 투영, C3 적응형 백프레셔, C4 `_store_windows` 왕복 축소, C5 다중 uvicorn 워커 | **참고 지표**. 단 [C] 가 [A] 를 막는 경로(락·스레드풀·heartbeat 가 저장을 막음)는 [A] 위험으로 계속 다룬다 |

기존 plan 의 P1(서버 안정화)·P2(원시 업로드)·P3(복귀·재생)·P4(투영 구조)·P5(다중 워커) ID 는 아래 표에서 새 Phase 로 재배치했다. 변경 ID(T2-x, P2-Nx, P3-Bx, P4-x, P5-x)는 그대로 쓴다.

## 결정 표

| 쟁점 | 안 | 채택 | 이유 |
|---|---|---|---|
| **저장 경로의 연결 상태 독립화**(신규 핵심) | (a) `_ingest` 가 `not_ready` 거절 전에 저장부터 하고 투영은 best-effort / (b) 저장 전용 REST·소켓 이벤트 / (c) DEGRADED 복귀만 | **(a) + (c), (b) 는 A6 재생이 대신한다** | (a) 는 와이어 변경 0 으로 구앱(vc31/iOS31) 즉시 수혜. 저장 판정(`_store_windows`: participant·stream·generation fencing·`evaluate_ingest` 동의·cutoff·시간창)은 DB 만 보므로 Redis/READY 와 무관하다[확인]. (c) 만으로는 DEGRADED 체류 중 창이 계속 거절되어 불충분. (b) 는 앱 변경이 필요해 11/4 에 못 들어간다 → 서버 단독 안전망인 A6 가 그 역할 |
| feature archive→DB 재생 | 후속 / P3 / **P2 로 승격(필수 A)** | **P2(11/1~11/2, 서버 단독)** | 구앱이 **이미** feature artifact(코어 프레임 ndjson)를 올린다[확인 F14]. 서버만 고치면 live 에서 거절·폐기된 창을 전부 살린다. 리포트 입력은 `eeg_feature_windows` 뿐[확인 F16] |
| metric 투영 회차 락 | NOWAIT / pending 테이블 | **NOWAIT 는 P1([A], 저장 스레드 보호) · pending 테이블은 P5([C])** | 10초 락 대기가 executor 스레드를 점유해 저장까지 막는다(F7). pending 테이블은 호스트 지연 개선이 주목적 → [C] |
| `not_ready` 559 경로 | heartbeat DEGRADED 복귀 부재 | **확정, P1 A2** + A1 로 DEGRADED 중에도 저장 | `READY` 설정은 join 수락 1곳뿐(F5) |
| 회원 자기 화면 | 현행(v2 on 이면 서버 LiveState 우선) / 로컬 우선 | **로컬 우선(M1)** — 앱 변경이라 동결 #1 에 포함 시도, 못 넣으면 서버 투영 지연이 자기 화면에 바로 보이므로 [C] C1 을 P1 에 끌어온다 | `MemberClassContainer.tsx:279` 가 `liveSnap ?? nativeM.metrics ?? buildSnapshot` 순으로 **서버 값을 먼저** 쓰고, 10초 지연이면 null 로 비운다[확인 F17] |
| 리포트 보장 | 현행(종료 시 1회 생성, 승인 후 불변) / 결측 판정+재생성 | **R1·R2 추가(서버 단독, P4)** | 현행은 결측 판정·재생성 트리거가 없다[확인 F18·F19] |
| 트랙 1 필수 경로 | 웹 스위퍼 / 네이티브 | **네이티브 우선**, 웹 스위퍼는 P3 포함 | 앱은 항상 `native` 경로(F2) |
| 24h close deadline 이후 접수 | 후속 / 포함 | **P2 포함(검역 접수, 서버 단독)** | 현행 409 는 영구 유실 경로(F12) |
| iOS 업로드 완결 | 시작 시 drain 만 / BGProcessingTask 포함 | **P3 = 시작·포그라운드 drain + background URLSession 재연결, P6 이후 = BGProcessingTask** | `recoverOnLaunch` 는 CAPTURING 만 복구(F4) |
| 다중 uvicorn 워커 | 금지 / 단계적 | **P6(11/9 이후)**, 11/4 전 금지 | — |
| 실밴드 시험 | 구현 전 / 후 | **구현 후(대표 결정)**, 시나리오는 verify §D | — |

## Phase 목록 · 게이트 (새 순서)

| Phase | 등급 | 내용 | 게이트(통과해야 다음) | 일정 |
|---|---|---|---|---|
| **P0** 선행 | — | S3 HEAD 403 원인, 부하 스크립트 묶음 전송·ACK 분리, executor 계측, **feature artifact 포맷·stream 매핑 코드 확정**(A6 전제) | G0: 403 해소 또는 원인 기록, 스크립트 1회 정상, artifact 1건 디코드→행 매핑 확인 | 11/1 오전 |
| **P1** 저장 연결 독립화 + 저장을 막는 서버 요인 제거 | [A] | A1 `_ingest` 저장 우선, A2 DEGRADED 복귀, A3 스레드풀·DB 풀, A4 NOWAIT+dirty 재투영, A5 archive 슬롯, heartbeat 세션당 1회(T2-3①②) | **G1**: V-A1~A4, V-L1·V-L2 의 **저장 열**(`not_ready` 0 · 거절 0 · 600/600 · 중복 0). 지연 열은 참고 | 11/1 18:00 배포·재시험 |
| **P2** feature 재생 · 검역 접수 (서버 단독, 구앱 즉시 수혜) | [A] | A6 feature archive→`eeg_feature_windows` 재생, A7 24h 이후 검역 접수 | **G2**: V-S16·V-S17, V-A5(10/31 시연 세션 artifact 로 재생 리허설) | 11/1~11/2, 11/2 22:00 서버 동결 |
| **P3** 원시·feature 업로드 완결성 (앱) | [A] | A8 Android 전 scope drain, A9 iOS 전 scope drain, A10 종료 비차단·지터·배치, A11 복귀 재개(renew·outbox flush·drain), A12 수신 요약 API + 종료 대조, 웹 스위퍼, **M1 자기 화면 로컬 우선** | **G3**: V-C1~C6·C8·C9·C10, V-S15, V-M1~M3 | FE/네이티브 동결 11/2 12:00 → 빌드 → 11/3 설치 |
| **P4** 리포트 보장 (서버 단독) | [B] | R1 결측 판정·"데이터 확인 중", R2 재생/지각 유입 시 재생성, R3 `pending_upload` 표시(API 필드) | **G4**: V-R1~R4 | 11/2~11/3(R1 은 11/3 전), R2·R3 는 11/5 가능 |
| **P5** 실시간 투영 구조 | [C] | C1 publish 틱, C2 pending 테이블 + 1초 묶음 투영, C3 적응형 백프레셔, C4 왕복 축소 | **G5**: V-S9~S12·S18·S19, V-L9 | 11/5~11/8 |
| **P6** 다중 워커 + 잔여 | [C]/[A] | C5 Redis 이관 → `--workers 2`; iOS BGProcessingTask, 웹 배치, 보관 정책 표시 | **G6**: V-L10, V-C7·C11·C12, V-B9 | 11/9~11/12 |

## 11/3 go/no-go (현장 적용 게이트, 합격선 교체)

- **go 조건(필수)**: ① **저장 완결성 100%** — V-L2(착용 40) 에서 `not_ready` 0 · 거절 0 · 특징창 40×600/600 · 중복 0 · 원시 100% `uploaded`+S3 대조, V-A1~A4 통과, G2(재생) 통과 ② **리포트 생성 성공** — V-R1(시험 세션 종료 후 리포트가 나오고 결측 참여자 표기가 맞음) ③ **회원 자기 화면 정상** — V-M1~M2(소켓 끊김·DEGRADED 중에도 로컬 값 표시, 복귀 후 이어짐). 후보 빌드 미설치 상태라면 M1 대신 C1 publish 틱으로 서버 지연 ≤2초를 확인.
- **참고 지표(불합격 사유 아님)**: 호스트 수신 지연 P95, metric ACK P95, presence P95.
- **no-go 시 대안(대표 결정)**: (a) 검증된 착용 인원 상한(예: 30) (b) 2회차 분할 (c) EEG 없이 진행. 단 저장 완결성만 통과하고 리포트·자기 화면이 미달이면 **go 가능**(데이터는 있으니 리포트는 사후 생성, 자기 화면은 운영 지침) — 대표 결정 2.
- 서버 변경은 즉시·전 사용자 적용, 앱 변경은 설치가 필요. **서버 단독으로 살릴 수 있는 P1·P2·P4 를 먼저** 하고 앱 변경(P3)은 동결 11/2 12:00 → 빌드(Android 반나절~1일, iOS 수 시간) → 11/3 설치를 일정에 넣는다. 구앱(vc31/iOS31)과 와이어 호환은 additive 로만.

## 대표 결정 사항 (≤5)

1. 11/3 go/no-go 미달 시 (a)/(b)/(c) 중 택일.
2. **저장 완결성만 통과(리포트·자기 화면 미달)면 go 로 볼지.** 기본안: go. 리포트는 사후 생성, 자기 화면은 운영 지침(앱 전면 유지·절전 제외)으로 대체.
3. 종료 비차단 + 백그라운드 이어올림 승인. 리포트는 업로드를 기다리지 않고 결측 참여자를 "데이터 확인 중" 으로 표시했다가 재생·지각 유입 시 자동 재생성(승인 전 리포트만, 승인된 리포트는 재생성하지 않음 — RPT-REGEN-005 유지). 점수 환원·종합점수 금지 유지.
4. 로컬 미완료 원본 보관 정책(기본안: 7일 경고·자동 삭제 없음). 24h 이후 검역 접수의 승인 주체(기관관리자/운영).
5. 현장 기기 정책: 회원 앱 후보 빌드 설치 필수 여부, 웹 브라우저 참가자 허용 여부, 셀룰러 잔여 전송 허용 여부.

---

## 1. 결론 (근거 요약)

1. **저장 가능 여부가 실시간 연결 상태(READY)에 종속된 구조**가 오프라인 클래스의 핵심 위험이다. `_ingest` 는 `conn.state != "READY"` 면 저장 전에 `not_ready` 로 거절한다(F5). 40명 시험의 559건 거절 = 저장 누락 = 리포트 결측. 저장 판정 자체는 DB 만 보므로(F15) 연결 상태와 분리할 수 있다.
2. 병목은 단일 uvicorn 프로세스 + 회차 1행 락 + 8스레드 executor 의 3중 직렬화다(report-rerun §4). 이 중 **저장을 막는 것**은 스레드풀 고갈과 10초 락 대기(F6·F7) → [A]. 호스트 수신 지연은 [C].
3. 리포트는 `eeg_feature_windows` 만 읽는다(F16). 원시 청크·artifact 는 리포트 입력이 아니다. 따라서 **live 에서 거절·폐기된 창을 DB 로 되살리는 경로(A6)** 가 리포트 완결성의 결정 수단이고, 구앱이 이미 올리는 feature artifact 로 서버만 고쳐서 가능하다(F14).
4. 회원 자기 화면은 v2 on 이면 **서버 LiveState 를 먼저** 쓰고 10초 지연이면 비운다(F17). 서버 투영 지연이 자기 화면 공백으로 직결되므로 로컬 우선(M1)으로 바꾼다(앱 변경).
5. 리포트 파이프라인은 세션 종료 시 1회 생성하며 결측 판정·재생성 트리거가 없다(F18·F19). 재생으로 데이터가 늦게 들어오면 리포트가 그 전 값으로 굳는다 → R1·R2.

## 2. 코드로 확정한 사실

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F1 | 앱 웹 번들 내장, 원격 로드 없음 | `frontend/capacitor.config.ts:6` `webDir: 'dist'` | 프런트 변경 = 앱 재빌드·설치 |
| F2 | 앱이면 측정 경로는 항상 `native` | `frontend/src/lib/measurement-web/measurement-path.ts:21-27` | 트랙 1 필수 = 네이티브 코드 |
| F3 | Android `ArchiveWorker` 는 `measurement/runtime.json` 1개만 읽어 마지막 세션만 drain | `measurement/runtime/ArchiveWorker.kt:16-18,41-50` | A8 |
| F4 | iOS `recoverOnLaunch` 는 CAPTURING 류만 복구. 앱 시작 외 drain 트리거 없음 | `MeasurementKit/MeasurementManager.swift:340-345`, `MeasurementHost.swift:55`, `NativeMeasurementPlugin.swift:33` | A9 |
| F5 | `DEGRADED→READY` 복귀 없음. `READY` 는 join snapshot 수락(`:2207`)뿐. heartbeat 실패(`:2338-2341`)·명령 degraded(`:2250-2251`)·snapshot Redis 장애(`:2151`)가 DEGRADED 로 내림. **`_ingest` 는 READY 아니면 저장 전에 `not_ready`(`:2299-2303`)** | `backend/app/ws/session_live_namespace.py` | A1·A2 핵심 |
| F6 | 기본 executor 미설정(`set_default_executor` 0건) | grep | 4vCPU = 8스레드. 저장 스레드 고갈 |
| F7 | `_project_latest` 는 락 먼저, 충돌 시 `db_lock_timeout_ms=10_000` 대기 | `live_ingest_service.py:265-283`, `config.py:88` | 저장 스레드를 10초 묶음 → A4 |
| F8 | 투영 실패는 ACK 를 막지 않고 "다음 수신이 갱신"에 의존 | `live_ingest_service.py:163-170` | 마지막 창 미투영 → dirty 재투영([C]) |
| F9 | `capture.renew` 는 만료 lease 를 거절하지 않음 | `session_live_commands.py:361-371` | 복귀 시 renew 1회면 됨 |
| F10 | 서버에 feature archive→`eeg_feature_windows` 재생 경로 없음 | grep `EEGFeatureWindow` in `biosignal_*.py` 0건; `_index_content` 는 indices·normalization 만 디코드(`biosignal_artifact_service.py:236-254`) | A6 신설 |
| F11 | archive 슬롯 6/대기 1.5s/Retry-After 3 고정, 프로세스 로컬 semaphore | `config.py:92-93`, `api/deps.py:102-114` | A5 |
| F12 | 24h close deadline 이후 `pending_time_review` 는 409 거절 | `biosignal_service.py:100-101` | A7 |
| F13 | S3 HEAD 403: 새 dev 에서 객체 존재 확인 실패 | report-rerun §3 | P0 |
| **F14** | **네이티브 feature artifact = 코어 `MetricFrame` 1Hz ndjson(gzip 또는 identity), 60창 묶음, 메타 `artifact_kind='feature'`·`schema_version='feature-v1'`·`first_sequence/last_sequence`·`time_range`.** 프레임 필드 = `sequence, window_start_us, window_end_us, observed_at_ms, sqi, contact, metrics{name:{value,validity}}, feature_hash` — live `MetricEnvelope` 와 같은 본체(stream_id·generation·algorithm_version 만 없음). alias `NF-<stream 앞 8자>-<first_seq>` | Android `archive/ArchiveFeeder.kt:23-55`; iOS `MeasurementManager.swift:283-301`; `measurement-web/envelope.ts:4-13,52-73`; Rust `measurement-core/src/engine.rs:232-240` | **A6 재생 가능.** `_feature_item()`(`live_ingest_service.py:106-124`)이 쓰는 입력(`metrics`·`sqi`·`sequence`·`feature_hash`)이 전부 들어 있다 |
| **F15** | 저장 판정은 DB 만 본다: participant·session 일치 → `CaptureStream` 조회 → `stream_generation` fencing → `evaluate_ingest`(cutoff·동의철회·lease·offline_bound·24h) → `_persist_feature_items`(멱등키 session·participant·play_group_id=stream_id·window_index, SAVEPOINT). Redis·READY 상태를 참조하지 않는다 | `live_ingest_service.py:173-262`, `session_live_commands.py:471-510`, `session_service.py:3505-3535` | A1 은 `_ingest` 의 상태 가드만 바꾸면 된다 |
| **F16** | 리포트(클래스 통계·회원 리포트)는 `eeg_feature_windows` 만 읽는다. `device_timestamp_ms` 우선·없으면 `created_at` 으로 세션 구간 필터. 원시 청크·artifact·outbox 참조 0건 | `class_report_stats_service.py:324-369`; grep `EegRawChunk|biosignal|artifact` in `class_report*.py`·`tasks/*report*` 0건 | A6 로 DB 를 채우면 리포트는 복구된다. 재생 행은 `device_timestamp_ms` 를 반드시 채워야 구간 필터에 들어간다 |
| **F17** | 회원 자기 화면(v2 on)은 `liveSnap ?? nativeM.metrics ?? buildSnapshot(...)` — **서버 LiveState 값을 먼저** 쓰고, `hostMetricValues` 가 `last_eeg_at` 10초 초과면 전 지표 null. `remoteEfficiency` 는 v1 소켓 경로(밴드 끊김 시 이완도 대체)로 v2 에서는 사실상 미사용 | `MemberClassContainer.tsx:89-99,279-286`; `live-metric-snapshot.ts:12-18`; `host-live-model.ts:49-63`; `signal-status.ts:16`(`EEG_STALE_MS=10_000`) | 서버 투영 지연·DEGRADED 가 **자기 화면 공백**으로 직결 → M1 |
| **F18** | 리포트 생성 트리거는 세션 종료(`finalize_on_session_end` → Celery chain → `generate_reports_for_session`, `started_at` 있으면 생성) 1회. 회원 리포트는 `pending_analysis/error` 또는 `partial` 일 때만 갱신, `pending_review/completed` 는 재생성하지 않음(멱등). 데이터 유입에 의한 재생성 트리거 없음 | `audio_service.py:210-290`, `report_task.py:774-800`, `report_service.py:550-556` | R2 |
| **F19** | 클래스 통계는 참여자별 창 수·quality 로 `eeg_status`(insufficient 등)만 매기고, **기대 창 수(세션 길이) 대비 결측률·"업로드 대기" 판정은 없다.** `intent='yes'` 는 창 1개 이상 또는 `band_connected` | `class_report_stats_service.py:394-420` | R1 |
| **F20** | 웹 `MetricOutbox` 는 300 초과분 폐기(`DEFAULT_MAX_PENDING=300`). **네이티브 outbox 는 상한 없음**(Android `MetricOutbox.kt` pending TreeMap, iOS journal 전량 보관·`maxLiveSequence` 만). 단 iOS/Android 모두 서버 `rejected` 는 격리(재전송 안 함) | `metric-outbox.ts:13,53`, `MetricOutbox.kt:19-60`, `MetricOutbox.swift:4-8` | 네이티브는 복귀 후 flush 로 대부분 살지만, `pending_time_review`(lease 만료·offline_bound 초과)로 거절된 창은 **live 로는 영영 못 들어온다** → A6 가 유일한 복구 경로 |
| **F21** | 기존 v1 REST `POST /sessions/{id}/features` 는 `_persist_feature_items` 로 직접 저장하며 stream·generation·`evaluate_ingest` 판정이 없다 | `api/v1/session.py:800-823`, `session_service.py:3667-3711` | v2 창의 historical 재전송 창구로 쓰면 fencing·동의 판정을 우회한다 → (b) 안 기각 근거 |

---

## 3. Phase 0 — 선행 (11/1 오전, DEPLOY/OPS + QA + BE1)

| ID | 내용 | 소유 | 게이트 |
|---|---|---|---|
| P0-1 | S3 HEAD 403 원인(인스턴스 프로파일 vs `.env.dev` 키, 접두사·길이만). ack 의 HEAD 검증(`storage_service.py:251-272`) 성공 확인 | DEPLOY/OPS | 403 해소 또는 원인·영향 기록 |
| P0-2 | 부하 스크립트: 생산 시계 1Hz 와 ACK 분리, `MetricOutbox` 와 같은 묶음 전송, `not_ready`→재join 재전송, 429 재시도, **거절 코드별 카운트·참여자별 DB 600/600 대조를 1급 출력**. `backend/scripts/loadtest/` 커밋 | QA | 스모크 1회 정상 |
| P0-3 | 서버 계측: executor 대기·loop lag·epoch 락 대기·투영 성공/건너뜀·**저장 거절 코드별 카운터** 를 로그/`/metrics` 로(additive) | BE1 | 대시보드 1장 |
| **P0-4** | **feature artifact → 행 매핑 코드 확정**: dev DB 에서 10/31 시연 세션의 `biosignal_artifacts(artifact_kind='feature', uploaded)` 1건을 읽어(읽기 전용, 개인정보 미출력) 디코드 → 프레임 필드 ↔ `_feature_item` 입력 대조. alias `NF-<8자>` 가 `CaptureStream.id` 앞 8자인지, `time_range.from_us` 가 어느 시계(device monotonic)인지 확정 | BE1 | 매핑표 1장(plan §5 에 반영) |

## 4. Phase 1 — [A] 저장 연결 독립화 + 저장을 막는 서버 요인 제거 (BE1, 11/1 배포)

### 4.1 작업

| ID | 변경 | 파일 | 플래그/env | verify |
|---|---|---|---|---|
| **A1** | **`_ingest` 저장 우선**: 상태 가드를 `conn.actor is None or conn.session_id is None or conn.state in ("CONNECTING","REVOKED","TERMINAL")` 로 바꾼다. **DEGRADED·RESYNCING 에서도 저장**한다(저장 판정은 DB 만 봄, F15). 투영·publish 는 best-effort(실패해도 ACK `durable:true`). `not_ready` 는 join 전(CONNECTING)에만 남는다. 토큰 만료(`conn.expired()`)는 저장을 막지 않는다 — 동의·소유권은 `evaluate_ingest`·generation fencing 이 판정 | `session_live_namespace.py:_ingest` | `LIVE_V2_INGEST_STORE_FIRST`(기본 on) | V-A1, V-A2, V-A3 |
| A2 | heartbeat **DEGRADED 복귀**: 연속 3회 실패 시에만 DEGRADED, 성공 1회면 READY(`pending_snapshot` 없고 DEGRADED 일 때만; RESYNCING/REVOKED/TERMINAL 불변), `live:heartbeat` 에 `recovered:true`. `publish_session_sync` 세션당 1회/`V2_HEARTBEAT_S`, heartbeat 경로 `publish_pending(wait_s=0)` | `session_live_namespace.py` | `LIVE_V2_DEGRADED_RECOVER`, `LIVE_V2_HB_SINGLE_DRAIN` | V-S5, V-S8 |
| A3 | lifespan 에서 `loop.set_default_executor(ThreadPoolExecutor(max_workers=settings.ws_thread_pool_size))` 기본 32. DB 풀 10/10→20/20(env). RDS 79 · Celery 8×2 고려해 웹 합계 ≤40 | `main.py`, `config.py`, `.env` | `WS_THREAD_POOL_SIZE`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | V-S14 |
| A4 | `_project_latest`: ① prev `entity_version` 락 없이 선독 ② `lock_epoch(nowait=True)`; `LockNotAvailable` 면 rollback·False + 프로세스 전역 `dirty{(session, participant)}` ③ dirty 재투영은 C1 틱이 맡되, C1 전까지는 다음 heartbeat 드레인에서 재투영 | `live_ingest_service.py`, `session_live_ledger.py` | `LIVE_V2_PROJECT_NOWAIT` | V-S4, V-S6, V-S7 |
| A5 | archive 슬롯 6→16, 대기 0.5s, `Retry-After` 2~6 랜덤 | `config.py`, `api/deps.py` | `ARCHIVE_MAX_CONCURRENT`, `ARCHIVE_SLOT_WAIT_SEC` | V-L4 |

A1 설계 근거(멱등·fencing·소유권·동의·시간창 유지): `_store_windows` 가 participant 일치·`CaptureStream` 존재·`stream_generation == stream.generation`(stale_owner_generation)·`evaluate_ingest`(cutoff·consent_withdrawn·lease·offline_bound·close_deadline) 를 **연결 상태와 무관하게** DB 로 판정한다(F15). 따라서 DEGRADED 에서 저장을 허용해도 구 owner·철회 후·cutoff 이후 창은 그대로 거절된다. 변하는 것은 "READY 가 아니어서 판정조차 못 받던 창이 판정을 받는다" 뿐이다. 구앱 호환: 와이어 변경 0, 응답 코드는 기존 `accepted/duplicate/rejected` 그대로.

커밋: A 하나당 1커밋(개별 revert). 롤백: 플래그 off + env 복원 + 재기동 1회(V-D1).

### 4.2 G1 게이트 (= verify V-A1~A4 + V-L1·V-L2 저장 열)

| 지표 | 기준 | 등급 |
|---|---|---|
| 거절 | **`not_ready` 0, 거절 0**(stale_owner·cutoff 등 설계상 거절은 시험 시나리오에서 0 이어야 함), `live_session_epoch` Traceback 0 | A(필수) |
| feature | 참여자별 600/600, (participant, stream, window_index) 중복 0, 결측 0 | A(필수) |
| 원시 | 청크 100% `uploaded` + S3 HEAD size·sha256 대조(P0-1 선행), chunk_index 갭 0 | A(필수) |
| 처리량 | 착용 40 ≥40창/s | A(필수 — 미달이면 backlog 가 쌓여 결국 저장 지연·폐기) |
| 자원 | 프로세스 CPU < 90%, DB 활성 < 30, RSS 지속 증가 없음, 스레드풀 대기 P95 < 100ms | A |
| 지연 | metric ACK P95 < 1,000ms, presence P95 < 500ms, 호스트 수신 P95 < 1,500ms | **C(참고)** |

G1 저장 열 미달이면 P2·P3 는 병렬 진행하되(파일 겹침 없음) BE1 은 P5 를 앞당기지 않고 **저장 열 원인(스레드풀·락·DB)** 을 먼저 잡는다.

### 4.3 영상·음성·상태

`lock_epoch` 호출처는 `live_ingest_service`(metric·device)·`session_live_commands.apply_command` 뿐[확인]. LiveKit 토큰·녹음은 REST → 락 비공유, 스레드풀 공유 → A3 수혜. 재시험에 동시 부하 포함(V-S13, V-L3) — 오프라인 클래스에서는 영상 부하 비중이 낮으므로 [C] 참고 지표.

## 5. Phase 2 — [A] feature archive→DB 재생 · 24h 검역 접수 (BE1, 서버 단독, 11/1~11/2)

### 5.1 A6 — feature archive → `eeg_feature_windows` 재생 (P3-B1 승격)

**재생 가능 판정 [확인 F14·F16]**: 네이티브 feature artifact 의 행은 코어 `MetricFrame` 이고, live 저장이 쓰는 `_feature_item(w, end_at, anchored)` 의 입력(`w.metrics[name].value/validity`, `w.sqi`, `w.sequence`, `w.feature_hash`)이 그대로 들어 있다. 따라서 **동일 매핑 함수로 행을 만들 수 있다.** 부족한 것과 해결:

| 부족 | 해결 |
|---|---|
| `stream_id`(= `play_group_id`)·`stream_generation` 이 프레임에 없음 | ① alias `NF-<8자>-<seq>` 의 8자를 `CaptureStream.id` 접두와 대조(P0-4 에서 확정) ② 안 맞으면 (session, participant) 의 CaptureStream 중 `time_range` 를 덮는 것 1개로 해석 ③ 둘 다 불명이면 **격리**(`replay_status='unresolved_stream'`, 삽입 안 함). generation fencing 은 historical 이므로 "현재 generation 과 같을 필요 없음" — 대신 **그 stream 의 소유 participant 와 artifact 의 participant 일치**로 소유권 판정 |
| `algorithm_version` 없음 | artifact 의 `algorithm` artifact(같은 세션·참여자) 또는 `schema_version` 에서 유도, 없으면 `'archive'` |
| 시각 | `device_timestamp_ms = observed_at_ms`(프레임 wall clock). 리포트 구간 필터가 `device_timestamp_ms` 우선이라 **반드시 채운다**(F16). `anchor` 없음 → `freshness`·live 투영 안 함 |
| 동의·cutoff | `evaluate_ingest(stream, window_start_at, window_end_at)` 을 **그대로 호출**하되 historical 이므로 `lease`·`offline_bound` 조건은 건너뛰고 cutoff·consent_withdrawn·close_deadline 만 적용(새 인자 `historical=True`). 철회 후 창은 거절 |
| 멱등 | 기존 키(session, participant, play_group_id, window_index) + `source_feature_alias==feature_hash` 면 duplicate(건너뜀), hash 다르면 첫 저장 보존·`feature_hash_conflict` 기록. live 투영·outbox **기록 안 함** |
| 웹 참가자(feature-v1 `FeatureRecord`, `scalars` dict) | 스칼라 키가 컬럼과 1:1(`focus_index`…`respiratory_rate`) → 두 번째 디코더. 우선순위 낮음(현장은 네이티브) |

구현: feature artifact `ack` 가 `uploaded` 로 확정되는 지점에서 Celery 태스크 `tasks.biosignal_feature_replay(artifact_id)` enqueue. 태스크는 S3 객체 읽기 → 디코드(gzip/identity) → 위 매핑 → `_persist_feature_items(..., quality_overrides)` → 결과를 `biosignal_artifacts.replay_status/replay_rows/replayed_at`(additive 컬럼 또는 별도 테이블) 에 기록 → **R2 재생성 트리거 호출**. 플래그 `BIOSIGNAL_FEATURE_REPLAY`. 과거 artifact 소급: 관리 명령 `scripts/replay_feature_artifacts.py --session <id>` (10/31 시연 세션에 먼저 적용해 리허설 = V-A5).

### 5.2 A7 — 24h 이후 검역 접수 (P3-B2)

`pending_time_review` 를 409 대신 접수해 `upload_status='time_review'` 로 저장(S3 객체는 올림), live 반영 금지, 승인/거절 감사 기록, 승인 시 `uploaded` 전환 → A6 재생도 그때 실행. 플래그 `BIOSIGNAL_TIME_REVIEW_INTAKE`. 클라는 deadline 을 우회하지 않는다.

**G2**: V-S16·V-S17·V-A5. 서버 부분은 additive 라 구앱과 호환(V-D6).

## 6. Phase 3 — [A] 업로드 완결성 (앱) + [B] 자기 화면 로컬 우선 (FE/Native1 + BE1 API, 동결 11/2 12:00)

### 6.1 공통 계약 (기존 P2 와 동일)

- **종료 비차단**: 종료 = 로컬 봉인 + close intent 영속 + feature flush. 화면은 "수업 종료 · 데이터 업로드 중 N건(MB)" → "업로드 완료"/"확인 필요".
- **완료 3조건**: ① 로컬 큐 pending·dead_letter·time_review 0 + 모든 봉인 alias 에 receipt ② 수신 요약 API 각 그룹 `missing_ranges=[]`·`receipt_hash` 일치 ③ manifest `close_state=='complete'`.
- **몰림 완화**: 첫 업로드 지터 0~60s, full jitter 재시도, 기기 동시 PUT 1(유휴 2), presign/ack 배치 ≤24, `nextAttempt` 영속. 429/5xx/네트워크는 횟수 제한으로 dead_letter 금지.
- **"무조건 백그라운드 재개"**: 인증·네트워크·OS 실행 기회가 돌아오면 화면과 무관하게 자동 재시도. OS 강제종료 중 상시 실행은 약속하지 않는다.
- **격리**: scope = API 환경 + account + participant + session. 다른 principal scope 는 전송하지 않고 보존.
- **리포트는 업로드를 기다리지 않는다**(F18: `close_state` 미사용). 결측 참여자는 R1 "데이터 확인 중".

### 6.2 작업

| ID | 등급 | 플랫폼 | 변경 | 파일 | verify |
|---|---|---|---|---|---|
| A8 (P2-N1) | A | Android | `ArchiveWorker`/`NativeArchiveOnly.drain` → `filesDir/measurement/*/archive` 전부 탐색, pending>0 또는 close-intent 미전송 세션 모두 drain. scope account ≠ 토큰 account 면 보존. 앱 시작·네트워크 연결·포그라운드에서 schedule(jitter) | `runtime/ArchiveWorker.kt`, `NativeRuntime.kt`, `archive/ArchiveQueue.kt` | V-C5, V-C6 |
| A9 (P2-N2) | A | iOS | `drainPendingArchives()` 신설(SEALING/CLOSED/DRAINING 포함), 앱 시작·`willEnterForeground`·네트워크 복귀에서 호출, background URLSession task↔alias 재연결 | `MeasurementManager.swift`, `ArchiveUploader.swift`, `MeasurementHost.swift`, `NativeMeasurementPlugin.swift` | V-C5, V-C6 |
| A10 (P2-N3·N4) | A | 양쪽 | 종료 비차단 + 지터 + "업로드 중 N건" 상태 + presign/ack 배치 ≤24 | `ArchiveUploader.kt/.swift`, `NativeMeasurementPlugin`, `recording-status.tsx`, `use-native-measurement.ts` | V-C4, V-C8, V-C3 |
| **A11 (P3-N1, 앞당김)** | A | 양쪽 | 복귀 재개: 포그라운드·네트워크 복귀 시 ① `capture.renew` 1회(F9) ② **`MetricOutbox.flush()`**(네이티브 outbox 는 상한 없음 F20 → 전량 재전송) ③ archive drain ④ 측정 계속. 서버가 `pending_time_review` 로 거절한 창은 격리하되 **"archive 로 살아난다" 진단 표기** | `LiveSession.kt/.swift`, `MeasurementManager.swift` | V-C9, V-B2~B5 |
| A12 (P2-S1·N5) | A | 서버+양쪽 | `GET /sessions/{id}/biosignal-raw/summary` + 종료 대조(서버에 없는 것만 재큐잉) | `api/v1/session.py`, `biosignal_service.py`, `schemas/biosignal.py`, `ArchiveUploader.*` | V-S15, V-C3 |
| P2-W1 | A | 웹 | `BiosignalQueue.listScopes()` + `useBiosignalResumeSweeper()` | `lib/biosignal/durable-queue.ts`, 신규 훅 | V-C5(웹) |
| **M1** | **B** | 웹 번들 | 자기 화면 지표 출처를 **로컬 우선**으로: `nativeM.metrics ?? buildSnapshot(band…) ?? liveSnap`. 밴드 연결·로컬 창 유효면 서버 값을 쓰지 않는다. 서버 값은 로컬이 없을 때(웹 참가자 밴드 미연결 등)만 | `MemberClassContainer.tsx:279-286` | V-M1, V-M2 |
| **M2** | B | 웹 번들 | 소켓 끊김·DEGRADED 배너는 표시하되 지표는 지우지 않는다. 복귀 후 1Hz 링버퍼(`series`)가 끊김 없이 이어지는지(로컬 타이머 기반이라 이미 독립[확인 :282-292]) 회귀 시험만 | 동일 | V-M3 |

**G3**: V-C1~C6·C8·C9·C10, V-S15, V-M1~M3(로컬 디버그 빌드로 선행, 후보 빌드로 재확인). 구앱 호환 V-D6.

## 7. Phase 4 — [B] 리포트 보장 (BE1, 서버 단독, 11/2~11/3 · R2·R3 는 11/5 허용)

| ID | 변경 | 파일 | 플래그 | verify |
|---|---|---|---|---|
| **R1** | **결측 판정**: `compute_class_stats` 참여자별 `expected_windows = session_sec`(또는 CaptureStream 활성 구간 합), `db_windows=len(wins)`, `coverage = db/expected`. `coverage < 0.9` 이고 (해당 참여자의 feature artifact 가 `pending`/`time_review`/재생 미완 **또는** 세션 종료 후 10분 이내)면 `data_state='verifying'`("데이터 확인 중"), 그 외 부족은 `data_state='partial'`(결측 구간 표기). 리포트 content 에 참여자별 `data_state, coverage, missing_ranges(초 단위 구간 ≤20)` 추가(additive). **점수 환원·종합점수 금지** 유지 — 서사·변화량만 | `class_report_stats_service.py`, `report_task.py(_build_eeg_content)`, `schemas/report.py` | — | V-R1, V-R2 |
| **R2** | **재생성 트리거**: A6 재생 완료·A11 지각 live 저장(세션 `ended_at` 이후 저장) 시 `report_service.request_regeneration(session_id, participant_id, reason)` → 승인 전(`pending_analysis/pending_review`·`generation_status=partial`) 리포트만 `generate_report_inline` 재실행(디바운스 60초, 세션당 동시 1). 승인(`completed`) 리포트는 재생성하지 않고 "새 데이터 N창 있음" 플래그만(RPT-REGEN-005) | `report_service.py`, `tasks/biosignal_feature_replay.py`, `live_ingest_service.py` | `REPORT_REGEN_ON_LATE_DATA` | V-R3 |
| R3 | `pending_upload` 노출: 세션 상세·데이터센터 API 에 참여자별 `upload_state`(`complete/pending/time_review`)·`replay_state` 필드(additive). FE 표시는 앱 번들이라 P6 | `api/v1/session.py`, `api/v1/data_center.py` | — | V-R4, V-C11 |

**G4**: V-R1~R4. R1 은 11/3 go/no-go 의 "리포트 생성 성공" 판정에 쓴다.

## 8. Phase 5 — [C] 실시간 투영 구조 (BE1, 11/5~11/8)

| ID | 변경 | 플래그 | verify |
|---|---|---|---|
| C1 (T2-4) | ingest 후 즉시 publish → 세션 dirty → 프로세스당 틱 1개(`LIVE_V2_PUBLISH_TICK_MS` 기본 300)가 dirty 세션 publish + A4 dirty 재투영. **M1 이 동결 #1 에 못 들어가면 P1 로 앞당긴다**(구앱 자기 화면이 서버 투영 지연에 종속되므로) | `LIVE_V2_PUBLISH_TICK_MS` | V-S9 |
| C2 (P4-1~4) | `live_metric_projection_pending` + 1초 묶음 투영, 수신 요청에서 epoch 락 제거, 락 순서 고정 | `LIVE_V2_PENDING_PROJECTION` | V-S10~S12, V-D2 |
| C3 (P4-5) | 적응형 백프레셔(`overloaded retry_after_ms`) — **저장을 늦출 뿐 거절이 아님**을 verify 로 못박는다(V-S18 최종 600/600) | `LIVE_V2_ADAPTIVE_BACKPRESSURE` | V-S18 |
| C4 (P4-6) | `_store_windows` 왕복 축소 | — | 기존 테스트 |

**G5**: V-S9~S12·S18·S19, V-L9. 롤백: writer off → pending drain 0 → 플래그 off(V-D7). NOWAIT 와 동시 on 금지(V-S19).

## 9. Phase 6 — 다중 워커 + 잔여 (BE1 + DEPLOY + FE/Native1, 11/9~11/12)

| ID | 변경 | verify |
|---|---|---|
| C5 (P5-1~5) | v1 dict 5종·대기실 presence·archive 슬롯 Redis 이관, 틱·dirty·drain 리더 선출, `AsyncRedisManager` 확인 → `--workers 2`. DB 예산 워커당 15/10 | V-L10 |
| P3-N2 | iOS `BGProcessingTask` | V-B9 |
| P3-W2 | 웹 presign/ack 배치 | V-C3(웹) |
| P3-N3 | 로컬 보관 정책 표시 | V-C12 |
| R3-FE | `pending_upload`·`data_state` 화면 표시(앱 번들) | V-C11 |

## 10. 앱 빌드·호환 규칙

- **서버 변경은 배포 즉시 전 사용자 적용. 앱 변경은 사용자가 업데이트해야 적용.** 서버 API·이벤트는 additive 만, 구앱 와이어 계약 삭제 금지(V-D6). A1 은 응답 코드 집합을 바꾸지 않는다.
- Android: 사이트용 APK + `latest.json`(vc31 부터 앱 내 업데이트 알림). 반나절~1일. iOS: TestFlight 수 시간.
- 앱 빌드가 필요한 변경(P3)은 "동결 → 빌드 → 설치 확인"을 일정에 넣는다. 못 지키면 **서버 단독분(P1·P2·P4)만으로 11/4 를 간다** — 그 경우 자기 화면은 C1 로, 이어올림은 운영 지침(앱 전면 유지·절전 제외·수업 뒤 앱을 바로 끄지 않기)으로 대체.

## 11. 일정 (11/4 = 목표 마일스톤)

| 일시 | 작업 | 게이트/롤백 |
|---|---|---|
| 10/31(토) | plan·verify 재정렬, Brian 승인 | — |
| 11/1(일) 오전 | P0 전부(P0-4 artifact 매핑 확정 포함). BE1 A1~A5 착수. FE/Native1 A8·A9·A11·M1 착수 | G0 |
| 11/1(일) 18:00 | BE PR → DEPLOY dev 반영 → **부하 재시험 1차**(착용 30·40, 묶음, 거절 코드별 집계) | G1 / 플래그 off |
| 11/2(월) 09:00 | G1 판정(저장 열 기준). BE1 A6·A7 진행, 10/31 시연 세션 재생 리허설(V-A5) | — |
| 11/2(월) 12:00 | **FE/네이티브 동결 #1**(A8~A12, M1·M2) → APP 빌드 착수 | 직전 빌드 유지 |
| 11/2(월) 오후 | P3 로컬 디버그 빌드로 V-C·V-M 실행. BE R1 dev 반영 → **부하 재시험 2차** + 시험 세션 종료 → 리포트 생성(V-R1) | G2·G3(디버그) |
| 11/2(월) 22:00 | **서버 동결 #1**(A1~A7, R1) | — |
| 11/3(화) 오전 | 후보 빌드 설치 → **실밴드 시험(구현 후, verify §D)** V-B1~B6·B9·B10, V-M1~M3. dev 소크 60분(착용 ≥5) | G3(후보 빌드) |
| 11/3(화) 15:00 | **go/no-go**(합격선: 저장 완결성 100% · 리포트 생성 성공 · 자기 화면 정상). go 면 prod 릴리즈(별도 승인) + 현장 지침·앱 설치 안내 | no-go 시 대표 결정 1·2 |
| 11/4(수) | 현장. 모니터: 거절 코드별 카운터(0 유지)·참여자별 DB 창 수·archive pending·프로세스 CPU | 플래그 off |
| 11/5~11/8 | R2·R3, P5(C1~C4). FE 동결 #2 11/7 → 앱 빌드 #2 | G4, G5 |
| 11/9~11/12 | P6. 60분 소크·카오스 | G6 |
| 11/13 | summary.md, 후속 SDD 분리 여부 판정 | Stage ⑥ |

**일정 위험**: ① Android APK 1일이면 11/3 설치 빠듯 → 서버 단독분으로 go(§10). ② P0-4 에서 alias↔CaptureStream 매핑이 안 맞으면 A6 는 time_range 기반 해석으로 가고 불명 artifact 는 격리 → 재생률을 V-A5 에서 수치로 보고. ③ 현장 Wi-Fi·40폰 리허설 불가 → 소수 실기기 + 합성 40명. ④ 실밴드 시험이 11/3 → 발견 문제는 11/4 전 수정 불가 → 지침 대체.

## 12. 작업 분해 · 파일 소유 (겹침 없음)

| 역할 | 소유 파일 | 커밋 단위 |
|---|---|---|
| **BE1** | `backend/app/services/live_ingest_service.py`, `session_live_ledger.py`, `session_live_commands.py`(evaluate_ingest historical 인자), `ws/session_live_namespace.py`, `config.py`, `main.py`, `api/deps.py`, `api/v1/session.py`, `api/v1/data_center.py`, `services/biosignal_service.py`, `biosignal_artifact_service.py`, `schemas/biosignal.py`, `tasks/biosignal_feature_replay.py`(신규), `services/class_report_stats_service.py`, `services/report_service.py`, `tasks/report_task.py`, `scripts/replay_feature_artifacts.py`(신규), `models/`·`alembic/versions/`(P2 replay 상태 1개 + P5 pending 1개), `backend/tests/` | A 하나당 1커밋, A6 2(디코더/태스크), A7 1, R1·R2·R3 각 1, C 각 1 |
| **FE/Native1** | `frontend/android/.../measurement/**`, `frontend/ios/MeasurementKit/**`, `frontend/ios/App/App/Measurement/**`, `frontend/src/lib/measurement-web/**`, `recording-status.tsx`, `lib/biosignal/**`, `components/class/player/member/MemberClassContainer.tsx`(M1·M2) | A8~A12·M1·M2 각 1(플랫폼 분리) |
| **QA(독립)** | `backend/scripts/loadtest/**`, 검증 스크립트, `specs/sdd-260-*/test-results/` | 시험 1회당 1커밋 |
| **DEPLOY/OPS/APP** | `.env`, systemd, IAM, 앱 빌드·사이트·TestFlight | 코드 커밋 없음 |

PR: Phase 당 BE·FE 각 1개(`[SDD-260] …`), 머지는 DEPLOY 창구. 구현자 ≠ 검증자.

## 13. 확인하지 못한 것

- **alias `NF-<8자>` 의 8자가 `CaptureStream.id` 인지**(Android `streamId()`·iOS `stream` 변수의 출처) — P0-4 에서 확정. 아니면 A6 는 time_range 해석.
- 코어 프레임 `observed_at_ms` 의 시계(기기 wall clock)와 서버 `device_timestamp_ms` 기대치의 정합 — 리포트 구간 필터가 이 값으로 자르므로 기기 시계 오차가 크면 창이 구간 밖으로 밀린다. 재생 시 `time_range` 와 세션 `started_at/ended_at` 대조로 보정 여부 결정.
- 10/31 시연 세션에 feature artifact 가 실제로 `uploaded` 로 있는지(dev DB 읽기, P0-4).
- iOS `ArchiveUploader.swift` 본문(429·background URLSession 재연결), Android `LinkWatchdog.kt` 재연결 정책.
- `pending_upload`·`close_state` 를 프런트가 어디서 표시하는지(grep 미완).
- 운영 서버 사양·`LIVE_PROTOCOL_V2`·Redis manager 부착·prod S3 권한.
- 60분·1인 원시 실제 용량 → V-B1 에서 실측.
- 서버 쿼리별 프로파일링 미실시.
