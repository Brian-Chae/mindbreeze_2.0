# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · 통합 Plan (Stage ②, 10/31 "저장 완결성 단일 목표" 판)

- 작성: 2026-10-31. 감독 통합안 → 대표 지시 1차(오프라인 클래스·완결성 우선) → **대표 추가 지시 2차(앱 수정 허용, 목표는 "40명 전원 데이터 빠짐없이 저장" 하나)** 순으로 같은 날 재작성. 입력: `plan-astra.md`, `plan-fable.md`(수정 금지, 근거 보존), `~/.hermes/share/loadtest-40/report*.md`, `~/.hermes/share/band-analysis/report.md`, `~/.hermes/share/briefs/sdd260-*.md`.
- 표기: **[확인]** = 이 워크트리 코드·실측으로 확인, **[추정]** = 미확인. 변경 ID(T2-x, P2-Nx, P3-Bx, P4-x, P5-x)는 이전 plan 과 호환되게 유지하고 새 ID(A·F·R·M·C)를 병기한다.

---

# 1페이지 요약

## 목표 (대표 지시, 단 하나)

**40명 전원이 밴드만 연결돼 있으면, 그 데이터가 빠짐없이 서버에 저장된다.** feature(리포트 입력)→DB 100% 가 1순위, 원시→S3 100% 가 2순위. 리포트는 데이터만 있으면 무조건 나온다는 전제로 리포트·자기 화면·코치 모니터링은 §9 "후속(저장 완결성에 영향 없음)"으로 분리한다(삭제 아님). 앱 수정은 허용(재빌드·설치 감수). 구앱 호환은 **선호**로 낮춘다 — 서버 단독으로 되면 좋지만, 앱 수정이 더 확실하면 앱 수정안을 채택한다.

## 합격선 (하나)

착용 40명(밴드 연결) · 10분 기준:

| 항목 | 기준 | verify |
|---|---|---|
| feature→DB | 참여자별 **600/600**, (participant, stream, window_index) **중복 0**, `not_ready`·거절 0 | V-L2 저장 열, V-A1~A4 |
| 원시→S3 | 청크 **100% `uploaded`**, chunk_index 갭 0, **S3 HEAD size·sha256 대조 100%**(무작위 아님, 전수) | V-L4 |
| 종료 후 재접속 복구 | 40기기 동시 종료 + 네트워크 불안 + 강제종료 혼합에서 **3단계 대조**로 feature·원시 모두 서버 수량 == 로컬 수량 | V-A10, V-C4·C5·C9, V-B5·B6·B9 |
| DEGRADED·Redis 장애 중 | 저장 계속(`accepted durable:true`), 복구 후 결측 0 | V-A1, V-L11 |

실시간 지연(호스트 수신·ACK·presence) 합격선은 **제거**(측정은 하되 판정에 쓰지 않음).

## 핵심 설계: "로컬 영속 → 서버 확인 → 모자란 것 재전송" 3단계 대조 프로토콜

| 단계 | feature (1순위) | 원시 (2순위) |
|---|---|---|
| ① 로컬 영속 | 네이티브: feature journal(fsync) + `MetricOutbox`(상한 없음, 창 전체 envelope 영속)[확인 F20] — **이미 있음**. 웹: `MetricOutbox` 300 폐기 → IndexedDB 영속·무상한으로 교체(F-W1) | 네이티브 archive 큐(봉인 청크·receipt)·iOS/Android **이미 있음**. 웹 `BiosignalQueue` 있음 |
| ② 서버 확인 | **신규 `GET /sessions/{id}/live-features/summary?participant_id`**(F-S2): stream·generation 별 `count, contiguous_through, missing_ranges(window_index), last_window_index` | `GET /sessions/{id}/biosignal-raw/summary`(A12/P2-S1): 그룹별 `uploaded_count, missing_ranges, receipt_hash` |
| ③ 모자란 것 재전송 | **신규 `POST /sessions/{id}/live-features/batch`**(F-S1): live:metric 과 **같은 envelope** 를 REST 로 ≤300창 묶음 접수. 판정은 `_store_windows` 와 동일(participant·stream·`evaluate_ingest(historical=True)`) → live 투영 없음. 클라는 ②의 `missing_ranges` 에 드는 창만 outbox/journal 에서 꺼내 보낸다. 소켓 상태와 무관 | 서버에 없는 alias 만 재큐잉(P2-N5), 로컬에도 없으면 `gap(local_missing)` |
| 서버 측 안전망 | **A6 feature archive→DB 재생**: 클라가 feature artifact(코어 프레임 ndjson)만 올리면 서버가 `eeg_feature_windows` 로 채운다[확인 F14]. 구앱·앱 미설치 기기까지 살린다 | A7 24h 이후 검역 접수 |
| 실행 시점 | 세션 종료 직후(비차단, 지터 0~60s) · 앱 시작 · 포그라운드 · 네트워크 복귀 · 60초 주기(미완료 있을 때만). 다른 계정 scope 는 보존만 | 동일 |
| 완료 판정 | 서버 summary 의 `missing_ranges=[]` 이고 로컬 outbox pending 0 | `missing_ranges=[]`·`receipt_hash` 일치·manifest `close_state=complete` |

왜 REST 배치(F-S1)인가: 네이티브 outbox 는 이미 창 전체를 영속하지만 **소켓 READY 에서만 흘려보낸다**(F5·F20). 소켓 재연결·lease·snapshot 과 무관한 통로가 있어야 "연결 상태 독립"이 완성된다. 기존 v1 `POST /features` 는 stream·generation·동의 판정이 없어(F21) 재사용하지 않는다.

## 결정 표

| 쟁점 | 채택 | 이유 |
|---|---|---|
| 저장 경로의 연결 상태 독립화 | **(a) `_ingest` 저장 우선(A1) + (b) REST 배치 접수(F-S1) + (c) DEGRADED 복귀(A2) 전부** | (a) 는 구앱 즉시 수혜·와이어 변경 0. (b) 는 소켓 자체가 없어도 저장. (c) 는 live 품질. 저장 판정은 DB 만 보므로(F15) 셋 다 fencing·동의·시간창 의미를 유지 |
| feature archive→DB 재생 | **P2 필수(A6)**, 서버 단독 | 앱 미설치·구앱 기기의 유일한 복구 경로. 리포트 입력은 `eeg_feature_windows` 뿐(F16) |
| 투영 회차 락 | **NOWAIT(A4)는 필수**(10초 락 대기가 저장 스레드를 점유, F7). pending 테이블(C2)은 후속 | 저장을 막는 요인만 필수 |
| heartbeat·스레드풀·archive 슬롯 | **필수**(A2·A3·A5) | 스레드풀 고갈(F6)·슬롯 429(F11)는 저장을 막는다 |
| 구앱 호환 | **선호**. 서버 API 는 additive 로 만들되(비용 0), 앱이 바뀌어야 완성되는 기능(F-N1~N3·F-W1)은 **앱 수정으로 확정** | 대표 지시 2차 |
| 리포트·자기 화면·코치 모니터링 | **§9 후속으로 분리**(R1~R3, M1~M2, C1~C5) | 저장 완결성에 영향 없음. 데이터만 있으면 리포트는 사후 생성 가능(F16·F18) |
| 실밴드 시험 | 구현 후(대표 결정) | — |

## Phase · 게이트 · 일정

| Phase | 내용 | 게이트 | 일정 |
|---|---|---|---|
| **P0** 선행 | S3 HEAD 403, 부하 스크립트(묶음·거절 코드별·DB 대조 1급 출력), 계측, **feature artifact→행 매핑 코드 확정(P0-4)**, 10/31 시연 세션 artifact 존재 확인 | G0 | 11/1 오전 |
| **P1** 서버: 저장 우선 + 저장을 막는 요인 제거 | A1 `_ingest` 저장 우선, A2 DEGRADED 복귀·heartbeat 1회, A3 스레드풀·DB 풀, A4 NOWAIT, A5 archive 슬롯, **F-S1 REST 배치 접수, F-S2 feature summary API**, A12 원시 summary API | **G1**: V-A1~A4·A8·A9, V-L1·L2 저장 열, V-S15 | 11/1 18:00 배포·재시험 1차 |
| **P2** 서버: 재생·검역 | A6 feature archive→DB 재생 + 소급 스크립트, A7 24h 검역 접수 | **G2**: V-S16·S17, V-A5~A7 | 11/2, 서버 동결 11/2 22:00 |
| **P3** 앱: 3단계 대조 + 이어올림 | F-N1 종료·복귀 시 feature 대조(summary→missing→REST 배치), F-N2 outbox 는 소켓 없이도 REST 로 drain, F-N3 거절 창 격리 대신 `pending_time_review` 는 재시도 큐 유지, A8 Android 전 scope drain, A9 iOS 전 scope drain + background URLSession, A10 종료 비차단·지터·배치, A11 복귀 재개(renew·flush·drain), P2-N5 원시 종료 대조, F-W1 웹 outbox IndexedDB 영속, P2-W1 웹 스위퍼 | **G3**: V-A10·A11, V-C1~C6·C8~C10, V-M 없음 | FE/네이티브 동결 **11/2 12:00** → 빌드 → 11/3 09:00 설치 |
| **P4** 실밴드·소크·go/no-go | §D V-B1~B11, 60분 소크, 합격선 판정 | **go/no-go** | 11/3 09:00~15:00 |
| **§9 후속** | 리포트 보장(R1~R3), 자기 화면(M1~M2), 실시간 투영(C1~C4), 다중 워커(C5), iOS BGProcessingTask, 보관 정책 표시 | 각자 게이트 | 11/5~ |

## 구현 병렬화 (5트랙, 파일 겹침 없음 — §8 소유표)

| 트랙 | 담당 | P1~P3 작업 | PR |
|---|---|---|---|
| **BE** | BE1 | A1~A7, F-S1, F-S2, A12 서버, P0-3·P0-4 | `[SDD-260] 서버: 저장 우선·REST 배치·재생` 1~2개 |
| **Android** | Native-A | F-N1~N3(Kotlin), A8, A10, A11, P2-N5 | `[SDD-260] Android: 3단계 대조·이어올림` 1개 |
| **iOS** | Native-I | F-N1~N3(Swift), A9, A10, A11, P2-N5 | `[SDD-260] iOS: 3단계 대조·이어올림` 1개 |
| **웹·공통** | FE1 | F-W1, P2-W1, `recording-status.tsx` "업로드 중 N건", `use-native-measurement.ts` counts 이벤트 수신, 네이티브↔JS 이벤트 계약 문서 | `[SDD-260] 웹·공통` 1개 |
| **QA(독립)** | QA | P0-2 부하 스크립트, DB 대조 스크립트, V-A10 40기기 합성 종료 시험, 결과 기록 | `backend/scripts/loadtest/**` |

DEPLOY/OPS/APP: `.env`·IAM·배포·사이트 APK·TestFlight(코드 커밋 없음).

## 대표 결정 사항 (≤5)

1. 11/3 합격선 미달 시 (a) 검증된 착용 상한 (b) 2회차 분할 (c) EEG 없이 진행 중 택일.
2. **앱 빌드가 11/3 09:00 설치에 못 맞추면**: 서버 단독분(P1·P2)으로 가고 앱 변경은 11/4 당일 현장 설치 시도 vs 포기. 기본안: 서버 단독 + 운영 지침(앱 전면 유지·절전 제외·수업 뒤 앱을 바로 끄지 않기).
3. 로컬 미완료 원본 보관 정책(기본안: 7일 경고·자동 삭제 없음). 24h 이후 검역 접수 승인 주체.
4. 셀룰러 잔여 전송 기본 허용 여부(기본안: 허용 — 저장 완결성 우선).
5. 현장 기기 정책: 회원 앱 후보 빌드 설치 필수, 웹 브라우저 참가자 허용 여부(기본안: 앱만).

---

## 1. 결론 (근거 요약)

1. **저장 가능 여부가 실시간 연결 상태에 종속된 구조**가 핵심 위험. `_ingest` 는 READY 가 아니면 저장 전에 `not_ready` 로 거절(F5) → 40명 시험 559건 거절 = 저장 누락. 네이티브 outbox 는 창을 영속하지만 **소켓 READY 에서만** 흘려보낸다(F20). 저장 판정은 DB 만 보므로(F15) 연결 상태와 분리할 수 있다.
2. 저장을 막는 서버 요인은 스레드풀 고갈(F6)·10초 락 대기(F7)·heartbeat 세션 전체 드레인·archive 슬롯 429(F11). 이것만 필수로 남긴다. 호스트 수신 지연은 후속.
3. 리포트는 `eeg_feature_windows` 만 읽는다(F16). 네이티브 feature artifact 는 live envelope 와 같은 본체라 서버가 그대로 행으로 만들 수 있다(F14) → 앱 미설치 기기까지 살리는 안전망.
4. 네이티브는 서버가 `rejected`(특히 lease 만료 후 `pending_time_review`)로 답한 창을 격리하고 재전송하지 않는다(F20). 복귀 후 flush 해도 이 창들은 live 로 영영 못 들어온다 → REST 배치(historical) 또는 A6 가 필요.

## 2. 코드로 확정한 사실

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F1 | 앱 웹 번들 내장 | `frontend/capacitor.config.ts:6` | 프런트 변경 = 앱 재빌드 |
| F2 | 앱이면 측정 경로는 항상 `native` | `measurement-web/measurement-path.ts:21-27` | 필수 = 네이티브 코드 |
| F3 | Android `ArchiveWorker` 는 `runtime.json` 1개만 읽어 마지막 세션만 drain | `runtime/ArchiveWorker.kt:16-18,41-50` | A8 |
| F4 | iOS `recoverOnLaunch` 는 CAPTURING 만 복구, 시작 외 drain 트리거 없음 | `MeasurementManager.swift:340-345`, `MeasurementHost.swift:55`, `NativeMeasurementPlugin.swift:33` | A9 |
| F5 | `DEGRADED→READY` 복귀 없음. **`_ingest` 는 READY 아니면 저장 전에 `not_ready`** | `session_live_namespace.py:2151,2251,2299-2303,2340` | A1·A2 |
| F6 | 기본 executor 미설정 → 8스레드 | grep `set_default_executor` 0건 | A3 |
| F7 | `_project_latest` 락 먼저, 충돌 시 10초 대기 | `live_ingest_service.py:265-283`, `config.py:88` | A4 |
| F8 | 투영 실패는 ACK 를 막지 않음 | `live_ingest_service.py:163-170` | 후속 C1 |
| F9 | `capture.renew` 는 만료 lease 도 갱신 | `session_live_commands.py:361-371` | A11 |
| F10 | feature archive→`eeg_feature_windows` 재생 경로 없음 | `biosignal_artifact_service.py:236-254` 는 indices·normalization 만 디코드 | A6 |
| F11 | archive 슬롯 6/1.5s/Retry-After 3, 프로세스 로컬 | `config.py:92-93`, `api/deps.py:102-114` | A5 |
| F12 | 24h 이후 `pending_time_review` 는 409 | `biosignal_service.py:100-101` | A7 |
| F13 | S3 HEAD 403(새 dev) | report-rerun §3 | P0-1 |
| **F14** | 네이티브 feature artifact = 코어 `MetricFrame` ndjson 60창 묶음(`artifact_kind='feature'`, `schema_version='feature-v1'`, `first/last_sequence`, `time_range`). 프레임 = `sequence, window_start_us, window_end_us, observed_at_ms, sqi, contact, metrics{name:{value,validity}}, feature_hash` = live envelope 본체(stream_id·generation·algorithm_version 만 없음). alias `NF-<stream 앞 8자>-<first_seq>` | Android `archive/ArchiveFeeder.kt:23-55`; iOS `MeasurementManager.swift:283-301`; `envelope.ts:4-13,52-73`; `measurement-core/src/engine.rs:232-240` | **A6 재생 가능** — `_feature_item()`(`live_ingest_service.py:106-124`) 입력이 전부 있음 |
| **F15** | 저장 판정은 DB 만 본다: participant 일치 → `CaptureStream` → generation fencing → `evaluate_ingest`(cutoff·동의철회·lease·offline_bound·24h) → `_persist_feature_items`(멱등키 session·participant·play_group_id·window_index). Redis·READY 미참조 | `live_ingest_service.py:173-262`, `session_live_commands.py:471-510`, `session_service.py:3505-3535` | A1·F-S1 은 입구만 바꾸면 됨 |
| **F16** | 리포트는 `eeg_feature_windows` 만 읽음(`device_timestamp_ms` 우선 구간 필터) | `class_report_stats_service.py:324-369`; `class_report*.py`·`tasks/*report*` 에 원시·artifact 참조 0건 | 재생 행은 `device_timestamp_ms` 필수 |
| F17 | 회원 자기 화면(v2)은 서버 LiveState 우선, 10초 지연이면 null | `MemberClassContainer.tsx:279-286`, `host-live-model.ts:49-63`, `signal-status.ts:16` | 후속 M1 |
| F18 | 리포트 트리거는 세션 종료 1회, 데이터 유입 재생성 없음 | `audio_service.py:210-290`, `report_task.py:774-800`, `report_service.py:550-556` | 후속 R2 |
| F19 | 클래스 통계에 기대 창 수 대비 결측 판정 없음 | `class_report_stats_service.py:394-420` | 후속 R1 |
| **F20** | 웹 `MetricOutbox` 300 초과 폐기. **네이티브 outbox 상한 없음**(Android pending TreeMap + 파일, iOS journal 전량 + `maxLiveSequence`). Android 는 `StreamTag(streamId, generation, anchorId, participantId)` 를 창에 바인딩해 영속, iOS 는 envelope 전체 영속. **양쪽 다 서버 `rejected` 는 격리·재전송 안 함** | `metric-outbox.ts:13,53`; `MetricOutbox.kt:14-60,98`; `MetricOutbox.swift:4-60` | F-N2(REST drain)·F-N3(격리 정책)·F-W1 |
| F21 | v1 REST `POST /sessions/{id}/features` 는 stream·generation·`evaluate_ingest` 없이 저장 | `api/v1/session.py:800-823`, `session_service.py:3667-3711` | 재사용 금지 → F-S1 신설 |

---

## 3. Phase 0 — 선행 (11/1 오전)

| ID | 내용 | 소유 | 게이트 |
|---|---|---|---|
| P0-1 | S3 HEAD 403 원인(인스턴스 프로파일 vs `.env.dev` 키, 접두사·길이만). ack HEAD 검증(`storage_service.py:251-272`) 성공 확인 | DEPLOY/OPS | 403 해소 또는 원인 기록 |
| P0-2 | 부하 스크립트: 1Hz 생산 시계·ACK 분리, `MetricOutbox` 와 같은 묶음, `not_ready`→재join, 429 재시도, **거절 코드별 카운트·참여자별 DB 600/600 대조·S3 전수 대조를 1급 출력**, **40기기 동시 종료 + 네트워크 단절 + 강제종료 혼합 모드**(V-A10) | QA | 스모크 1회 |
| P0-3 | 서버 계측: executor 대기·loop lag·락 대기·**저장 거절 코드별 카운터**·REST 배치 접수 카운터 | BE1 | 대시보드 1장 |
| P0-4 | **feature artifact→행 매핑 확정**: dev DB 에서 10/31 시연 세션 `biosignal_artifacts(feature, uploaded)` 1건 디코드 → 프레임 ↔ `_feature_item` 대조. alias 8자 = `CaptureStream.id` 접두인지, `observed_at_ms` 시계 확인 | BE1 | 매핑표 |

## 4. Phase 1 — 서버: 저장 우선 + 저장을 막는 요인 제거 (BE1, 11/1 18:00 배포)

| ID | 변경 | 파일 | 플래그 | verify |
|---|---|---|---|---|
| **A1** | `_ingest` 상태 가드를 `actor None / session None / state ∈ {CONNECTING, REVOKED, TERMINAL}` 로. **DEGRADED·RESYNCING 에서도 저장.** 투영·publish best-effort. 토큰 만료는 저장을 막지 않음(동의·소유권은 `evaluate_ingest`·fencing) | `session_live_namespace.py` | `LIVE_V2_INGEST_STORE_FIRST`(기본 on) | V-A1~A4 |
| A2 (T2-3) | heartbeat: 연속 3회 실패 시 DEGRADED, 성공 1회면 READY(`pending_snapshot` 없을 때), `recovered:true`. `publish_session_sync` 세션당 1회, heartbeat 경로 `publish_pending(wait_s=0)` | 동일 | `LIVE_V2_DEGRADED_RECOVER`, `LIVE_V2_HB_SINGLE_DRAIN` | V-S5, V-S8 |
| A3 (T2-1) | `set_default_executor(ThreadPoolExecutor(32))`, DB 풀 20/20(웹 합계 ≤40, RDS 79) | `main.py`, `config.py`, `.env` | `WS_THREAD_POOL_SIZE`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | V-S14 |
| A4 (T2-2) | `_project_latest`: prev 선독 → `lock_epoch(nowait=True)` → 충돌 시 rollback·dirty 표시, 재투영은 다음 heartbeat 드레인(후속 C1 이 틱으로 대체) | `live_ingest_service.py`, `session_live_ledger.py` | `LIVE_V2_PROJECT_NOWAIT` | V-S4(후속)·S6·S7 |
| A5 (T2-5) | archive 슬롯 6→16, 대기 0.5s, Retry-After 2~6 | `config.py`, `api/deps.py` | `ARCHIVE_MAX_CONCURRENT`, `ARCHIVE_SLOT_WAIT_SEC` | V-L4 |
| **F-S1** | **`POST /sessions/{id}/live-features/batch`**: body `{participant_id, windows:[MetricEnvelope…≤300]}`. 인증 JWT 또는 `X-Entry-Credential`(v1 `/features` 와 같은 `resolve_upload_participant`). 처리 = `_store_windows(..., historical=True)`: participant·stream·`evaluate_ingest(historical=True)`(lease·offline_bound 건너뜀, cutoff·consent_withdrawn·close_deadline 적용) → `_persist_feature_items`. generation fencing: `stream_generation ≤ stream.generation` 이고 stream 소유 participant 일치면 수락(`historical` 표식), 아니면 `stale_owner_generation`. **live 투영·outbox 기록 없음.** 응답 = live:metric 과 같은 ACK 배열(`accepted/duplicate/rejected`+code). 슬롯(`archive_upload_slot`) 비적용, 요청당 ≤300창·5초 타임아웃 | `api/v1/session.py`, `services/live_ingest_service.py`, `session_live_commands.py`(evaluate_ingest 인자), `schemas/session_live.py` | `LIVE_V2_REST_FEATURE_BATCH` | V-A8, V-A9 |
| **F-S2** | **`GET /sessions/{id}/live-features/summary?participant_id`**: 본인·호스트만. (stream_id, generation) 별 `count, min_index, max_index, contiguous_through, missing_ranges(≤200, truncated)`, 상위 `total_count`. 소스: `eeg_feature_windows`(play_group_id=stream_id) | 동일 | — | V-A8 |
| A12 (P2-S1) | `GET /sessions/{id}/biosignal-raw/summary?participant_id` (기존 설계 그대로) | `api/v1/session.py`, `biosignal_service.py`, `schemas/biosignal.py` | — | V-S15 |

**G1** = V-A1~A4·A8·A9, V-L1·L2 저장 열(`not_ready` 0·거절 0·600/600·중복 0·≥40창/s), V-L4, V-S15. 지연 열은 기록만. 커밋: 변경 하나당 1커밋. 롤백 플래그 off(V-D1).

## 5. Phase 2 — 서버: feature 재생 · 24h 검역 (BE1, 11/2, 동결 22:00)

### A6 feature archive → `eeg_feature_windows` 재생 (P3-B1 승격)

재생 가능[확인 F14·F16]. 매핑과 부족분 처리:

| 부족 | 해결 |
|---|---|
| `stream_id`(=play_group_id)·generation 없음 | alias `NF-<8자>` ↔ `CaptureStream.id` 접두(P0-4 확정) → 아니면 (session, participant) CaptureStream 중 `time_range` 를 덮는 1개 → 불명이면 격리(`replay_status='unresolved_stream'`) |
| `algorithm_version` 없음 | 같은 세션·참여자의 `algorithm` artifact 또는 `'archive'` |
| 시각 | `device_timestamp_ms = observed_at_ms`. **필수**(F16). 세션 `started_at~ended_at` 밖이면 `time_range` 로 보정 여부 기록 |
| 동의·cutoff | `evaluate_ingest(historical=True)` — F-S1 과 같은 함수 |
| 멱등 | 기존 키 + `source_feature_alias==feature_hash` 면 duplicate, 다르면 첫 저장 보존·충돌 기록. 투영·outbox 없음 |
| 웹 `FeatureRecord`(scalars dict) | 두 번째 디코더(스칼라 키 = 컬럼명). 우선순위 낮음 |

구현: feature artifact ack `uploaded` 시 Celery `tasks.biosignal_feature_replay(artifact_id)`. `biosignal_artifacts` 에 `replay_status/replay_rows/replayed_at` additive 컬럼(마이그레이션 1개, BE1). 소급 `scripts/replay_feature_artifacts.py --session <id> [--dry-run]`. 플래그 `BIOSIGNAL_FEATURE_REPLAY`.

### A7 24h 이후 검역 접수 (P3-B2)

`pending_time_review` 를 409 대신 `upload_status='time_review'` 로 접수(S3 올림), live 미반영, 감사 기록, 승인 시 `uploaded` → A6 실행. 플래그 `BIOSIGNAL_TIME_REVIEW_INTAKE`.

**G2** = V-S16·S17, V-A5~A7(10/31 시연 세션 소급 리허설 포함).

## 6. Phase 3 — 앱: 3단계 대조 + 이어올림 (Android / iOS / 웹·공통, 동결 11/2 12:00)

### 6.1 공통 계약

- **종료 비차단**: 종료 = 로컬 봉인 + close intent 영속 + feature flush. 화면 "수업 종료 · 데이터 업로드 중 N건(MB)" → "업로드 완료"/"확인 필요". 화면 이탈 가능.
- **대조 트리거**: 종료 직후(지터 0~60s) · 앱 시작 · 포그라운드 · 네트워크 복귀 · 60초 주기(미완료 있을 때만). 동시 scope 1, 기기 동시 PUT 1(유휴 2).
- **feature 대조 루프(F-N1)**: ① F-S2 summary → ② `missing_ranges` ∩ 로컬 outbox/journal 보유 창 → ③ F-S1 로 ≤300창씩 전송 → ④ ACK 로 outbox acked 표시 → ⑤ summary 재조회, `missing_ranges=[]` 면 완료. 로컬에도 없는 구간은 `gap(local_missing)` 진단. 재시도 full jitter `0..min(60s, 1s×2^n)`, 429/5xx/네트워크는 횟수 제한 없음, 401 인증 대기, 403 사유별, 409 격리.
- **원시 대조 루프(P2-N5)**: A12 summary → 서버에 없는 alias 만 재큐잉 → receipt_hash 일치·manifest complete 로 완료.
- **격리 정책(F-N3)**: 서버 `rejected` 중 `pending_time_review`·`beyond_offline_bound`·`straddles_cutoff` 는 **격리하지 않고 historical 재시도 큐**로 넘겨 F-S1 로 재전송(서버가 historical 로 판정). `consent_withdrawn`·`window_after_cutoff`·`feature_hash_conflict`·`stale_owner_generation(소유권 불일치)` 만 최종 격리.
- **scope 격리**: API 환경 + account + participant + session. 다른 principal scope 는 전송하지 않고 보존.
- **"무조건 백그라운드 재개"**: 인증·네트워크·OS 실행 기회가 오면 화면과 무관하게 재시도. OS 강제종료 중 상시 실행은 약속하지 않는다 → 합격 조건은 재실행 후 복구.

### 6.2 작업

| ID | 트랙 | 변경 | 파일 | verify |
|---|---|---|---|---|
| **F-N1** | Android / iOS | feature 대조 루프(§6.1) 구현. `MetricOutbox` 에서 `missing_ranges` 로 창 조회(`newestFirst`/`windows` 활용), REST 전송, ACK 반영 | `live/FeatureReconciler.kt`(신규), `LiveSession.kt`; `MeasurementKit/FeatureReconciler.swift`(신규), `MeasurementManager.swift` | V-A10, V-A11 |
| **F-N2** | Android / iOS | outbox drain 을 **소켓 없이도** REST 배치로: 소켓 READY 면 live:metric, 아니면 N초 후 F-S1 폴백(같은 창을 둘 다 보내도 멱등) | `LiveSession.kt/.swift`, `MetricOutbox.kt/.swift` | V-A11 |
| **F-N3** | Android / iOS | 격리 정책 변경(§6.1): 시간검토 류는 historical 재시도 큐 | `MetricOutbox.kt:98 quarantine`, `MetricOutbox.swift markRejected` | V-A12 |
| A8 (P2-N1) | Android | `ArchiveWorker` 전 scope 탐색·drain, 시작·네트워크·포그라운드 schedule | `runtime/ArchiveWorker.kt`, `NativeRuntime.kt`, `archive/ArchiveQueue.kt` | V-C5, V-C6 |
| A9 (P2-N2) | iOS | `drainPendingArchives()`(SEALING/CLOSED/DRAINING 포함), 시작·`willEnterForeground`·네트워크 복귀, background URLSession 재연결 | `MeasurementManager.swift`, `ArchiveUploader.swift`, `MeasurementHost.swift`, `NativeMeasurementPlugin.swift` | V-C5, V-C6 |
| A10 (P2-N3·N4) | Android / iOS | 종료 비차단·지터·presign/ack 배치 ≤24·`archive.counts` 이벤트 | `ArchiveUploader.kt/.swift`, `NativeMeasurementPlugin` | V-C4, V-C8, V-C3 |
| A11 (P3-N1) | Android / iOS | 복귀 재개: `capture.renew` 1회 → outbox flush(live 또는 REST) → archive drain → 측정 계속 | `LiveSession.kt/.swift` | V-C9 |
| P2-N5 | Android / iOS | 원시 종료 대조(A12 summary) | `ArchiveUploader.kt/.swift` | V-C3 |
| **F-W1** | 웹·공통 | 웹 `MetricOutbox` 300 폐기 제거 → IndexedDB 영속·무상한 + 웹용 F-N1·F-N2 | `measurement-web/metric-outbox.ts`, `web-measurement-session.ts` | V-A13 |
| P2-W1 | 웹·공통 | `BiosignalQueue.listScopes()` + `useBiosignalResumeSweeper()` | `lib/biosignal/durable-queue.ts`, 신규 훅 | V-C5(웹) |
| UI | 웹·공통 | "업로드 중 N건(MB)" 표시, 네이티브 counts 이벤트 수신 | `recording-status.tsx`, `use-native-measurement.ts` | V-C8 |

**G3** = V-A10~A13, V-C1~C6·C8~C10(로컬 디버그 빌드 선행, 후보 빌드 재확인).

## 7. 일정 (11/4 목표 마일스톤 · 앱 빌드 소요 반영)

| 일시 | 작업 | 게이트 |
|---|---|---|
| 10/31(토) | plan·verify 재정렬, Brian 승인 | — |
| 11/1(일) 09:00 | P0 전부. **5트랙 동시 착수**: BE A1~A5·F-S1·F-S2·A12 / Android F-N1~N3·A8 / iOS F-N1~N3·A9 / 웹 F-W1 / QA P0-2 | G0 |
| 11/1(일) 18:00 | BE PR → DEPLOY dev 반영 → **부하 재시험 1차**(착용 30·40, 거절 코드별·DB 대조) | G1 / 플래그 off |
| 11/2(월) 09:00 | G1 판정(저장 열). BE A6·A7 + 10/31 시연 세션 소급 리허설(V-A5). 네이티브는 dev 의 F-S1/F-S2 에 붙여 F-N1 디버그 빌드 시험 | — |
| 11/2(월) **12:00** | **FE/네이티브 동결 #1** → APP: Android 사이트용 AAB→Play 서명 APK→사이트 업로드+`latest.json`(반나절~1일), iOS TestFlight 업로드+베타 심사(수 시간) | 직전 빌드 유지 |
| 11/2(월) 오후 | 디버그 빌드로 V-A10~A13·V-C 실행(합성 40기기 + 실기기 2대). BE dev 반영 → **부하 재시험 2차** | G2·G3(디버그) |
| 11/2(월) **22:00** | **서버 동결 #1**(A1~A7·F-S1·F-S2·A12) | — |
| 11/3(화) 09:00 | 후보 빌드 설치(Android APK 사이트·iOS TestFlight) → **실밴드 시험(§D)** V-B1~B11 + dev 소크 60분(착용 ≥5 실밴드 + 합성 35) | G3(후보 빌드) |
| 11/3(화) **15:00** | **go/no-go**(합격선 §1). go 면 prod 릴리즈(별도 승인) + 현장 지침·앱 설치 안내(QR·사이트) | no-go: 대표 결정 1·2 |
| 11/4(수) | 현장. 모니터: 거절 코드별 카운터(0)·참여자별 DB 창 수·archive pending·REST 배치 접수·CPU | 플래그 off |
| 11/5~ | §9 후속 | — |

**일정 위험**: ① Android APK 1일 → 11/3 09:00 빠듯. 11/2 12:00 동결을 못 지키면 대표 결정 2. ② P0-4 alias 매핑 불일치 → A6 time_range 해석, 격리율을 V-A5 로 보고. ③ F-S1 과 live:metric 을 같은 창에 동시 보내는 경합 → 멱등키·SAVEPOINT 로 duplicate 처리(V-S1 확장). ④ 현장 Wi-Fi·40폰 리허설 불가 → 실기기 2~5 + 합성.

## 8. 파일 소유 (트랙 간 겹침 없음)

| 트랙 | 소유 파일 | 커밋 |
|---|---|---|
| **BE** | `backend/app/ws/session_live_namespace.py`, `services/live_ingest_service.py`, `session_live_ledger.py`, `session_live_commands.py`, `config.py`, `main.py`, `api/deps.py`, `api/v1/session.py`, `services/biosignal_service.py`, `biosignal_artifact_service.py`, `schemas/biosignal.py`, `schemas/session_live.py`, `tasks/biosignal_feature_replay.py`(신규), `scripts/replay_feature_artifacts.py`(신규), `models/biosignal.py`·`alembic/versions/`(1개), `backend/tests/` | 변경당 1 |
| **Android** | `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/measurement/**`(`live/`, `archive/`, `runtime/`), 해당 테스트 | F-N 1, A8 1, A10·A11·N5 1 |
| **iOS** | `frontend/ios/MeasurementKit/**`, `frontend/ios/App/App/Measurement/**` | 동일 분할 |
| **웹·공통** | `frontend/src/lib/measurement-web/**`, `lib/biosignal/**`, `components/.../recording-status.tsx`, 신규 sweeper 훅, 네이티브↔JS 이벤트 계약 문서 `docs/sdd-260-native-js-events.md` | F-W1 1, W1 1, UI 1 |
| **QA** | `backend/scripts/loadtest/**`, 대조 스크립트, `specs/sdd-260-*/test-results/` | 시험당 1 |

네이티브↔JS 이벤트 이름·필드(`archive.counts`, `feature.reconcile`)는 웹·공통 트랙이 11/1 12:00 까지 문서로 고정하고 Android/iOS 가 따른다. 서버 API 스키마(F-S1·F-S2·A12)는 BE 가 11/1 12:00 까지 OpenAPI 로 고정한다.

## 9. 후속 (저장 완결성에 영향 없음 — 삭제하지 않고 한곳에 모음, 11/5~)

| ID | 등급 | 내용 | 근거·비고 |
|---|---|---|---|
| R1 | 리포트 | 결측 판정·"데이터 확인 중"(참여자별 coverage·missing_ranges, 0 채움 금지, 종합점수 금지) | F19 |
| R2 | 리포트 | A6 재생·지각 저장 후 승인 전 리포트 자동 재생성(디바운스 60s), 승인 리포트 불변(RPT-REGEN-005) | F18 |
| R3 | 리포트 | `pending_upload`·`replay_state` API 필드 + 화면 | — |
| M1 | 자기 화면 | 지표 출처 로컬 우선(`nativeM.metrics ?? buildSnapshot ?? liveSnap`) | F17 |
| M2 | 자기 화면 | 끊김 중 지표 유지·복귀 후 링버퍼 연속(이미 로컬 타이머[확인 :282-292]) 회귀 시험 | — |
| C1 (T2-4) | 모니터링 | publish 틱 + dirty 재투영 | F8 |
| C2 (P4-1~4) | 모니터링 | `live_metric_projection_pending` + 1초 묶음 투영, 락 순서 고정 | — |
| C3 (P4-5) | 모니터링 | 적응형 백프레셔(`overloaded`) — 저장을 늦출 뿐 거절 아님 | — |
| C4 (P4-6) | 모니터링 | `_store_windows` 왕복 축소 | — |
| C5 (P5-1~5) | 다중 워커 | v1 dict·presence·슬롯 Redis 이관 → `--workers 2`(워커당 풀 15/10) | 11/9~ |
| P3-N2 | 앱 | iOS `BGProcessingTask` | OS 보장 없음 |
| P3-W2 | 웹 | presign/ack 배치 | — |
| P3-N3 | 앱 | 로컬 보관 정책 표시 | 대표 결정 3 |
| V-S13·V-L3·V-L5 | 시험 | 영상·음성 동시 부하·호스트 지연 — 기록만 | 합격선 아님 |

## 10. 확인하지 못한 것

- alias `NF-<8자>` 의 8자가 `CaptureStream.id` 인지(Android `streamId()`·iOS `stream` 출처) — P0-4.
- 코어 `observed_at_ms` 시계와 리포트 구간 필터 정합 — 재생 시 `time_range` 대조로 결정.
- 10/31 시연 세션에 feature artifact 가 `uploaded` 로 있는지(dev DB 읽기, P0-4).
- iOS `ArchiveUploader.swift` 본문(429·background URLSession), Android `LinkWatchdog.kt` 재연결 정책.
- 네이티브 outbox 에서 "서버 missing_ranges 에 드는 창"을 꺼내는 조회가 양 플랫폼에 있는지(Android `newestFirst`/`contains` 만 확인, iOS `windows` dict) — F-N1 구현 전 정독.
- 웹 참가자용 feature artifact(`FeatureRecord`) 디코더의 필요성(현장이 앱만이면 불필요).
- 운영 서버 사양·`LIVE_PROTOCOL_V2`·prod S3 권한.
- 60분·1인 원시 용량 → V-B1 실측.
