# SDD-260 — 40명 클래스 실시간 지표 저장 병목 해소 · 통합 Plan (Stage ②, 10/31 3차 "호환 제약 폐기 · 저장 100% 단일 목표" 판)

- 작성: 2026-10-31. 같은 날 대표 지시 3회를 순서대로 반영: 1차 오프라인 클래스·완결성 우선 → 2차 앱 수정 허용·저장 단일 목표 → **3차 현재 앱 설치자 0명, 구앱 호환 제약 전부 삭제, 서버·앱·웹을 함께 자유롭게 바꿔 가장 단순하고 확실한 설계로**. 입력: `plan-astra.md`, `plan-fable.md`(수정 금지, 근거 보존), `~/.hermes/share/loadtest-40/report*.md`, `~/.hermes/share/band-analysis/report.md`, `~/.hermes/share/briefs/sdd260-*.md`.
- 이 문서는 **구현 워커에게 그대로 주는 작업 지시서**다. 작업 단위마다 파일·함수·verify ID 를 적는다. 표기: **[확인]** = 코드·실측 확인, **[추정]** = 미확인(구현 전 정독).

---

# 1페이지 요약

## 목표 (하나)

**11/4 현장 40명 전원의 feature(리포트 입력)와 원시 데이터를 100% 서버에 저장한다.** 저장 경로는 실시간 연결(소켓 READY·방송·투영)과 **완전히 분리**한다. 호환 때문에 우회한 설계는 모두 제거한다. 리포트·자기 화면·코치 모니터링은 §9 후속(저장에 영향 없음).

## 새 프로토콜 (가장 단순한 형태)

```
[밴드] → BLE → [앱 코어 1Hz MetricFrame]
                 ├─ ① feature journal(fsync) + MetricOutbox 영속      ← 유일한 정본 사본(이미 있음)
                 ├─ ② FeatureUploader: 5초마다 REST POST /features/batch(≤60창) → ACK → outbox acked   ← **정본 저장 경로**
                 │     실패·오프라인이면 그대로 쌓였다가 재시도. 종료·앱시작·포그라운드·네트워크복귀에도 실행
                 ├─ ③ 종료 후 대조: GET /features/summary → missing_ranges → 그 창만 ② 로 재전송 → 빈 배열이면 완료
                 └─ ④ 소켓 live:metric = **방송 전용**(DB 저장 없음, 코치 화면용). 끊겨도 저장과 무관
[원시] RawChunker → archive 큐(봉인·sha256) → presign/ack(배치) → 종료 후 GET /biosignal-raw/summary 대조 → 모자란 alias 재전송
```

| 원칙 | 내용 |
|---|---|
| 정본 저장 = REST 배치 | feature 는 `POST /api/v1/sessions/{id}/features/batch` 가 **유일한 DB 기록 경로**. 소켓은 저장하지 않는다 → READY/DEGRADED/락/heartbeat 가 저장을 막을 수 없다 |
| 서버 판정 최소화 | 저장 수락 조건 = (세션·참가자 일치) ∧ (stream 이 그 참가자 소유) ∧ (동의 철회 아님). **lease·offline_bound·24h deadline·straddle·시간검토 격리는 전부 삭제** — 늦게 와도 저장하고 `late=true` 표식만 |
| 멱등 | 키 (session, participant, play_group_id=stream_id, window_index=sequence) 유지[확인 F15]. 같은 키·같은 `feature_hash` = duplicate, 다른 hash = 첫 저장 보존 + conflict 카운트 |
| 로컬이 유일 사본 | 서버 ACK 전에는 삭제하지 않는다. ACK 받은 창도 summary `missing_ranges=[]` 확인 후 세션 단위로 정리 |
| 소켓 거절 코드 제거 | `not_ready`·`stale_owner_generation` 등 저장 거절 개념이 소켓에서 사라짐(방송만). REST 응답은 `accepted/duplicate/rejected(consent_withdrawn|participant_mismatch|stream_not_owned|hash_conflict)` 4종 |
| 원시 | 기존 archive 큐·presign/ack 유지, **24h 409·`pending_time_review` 삭제**(늦어도 받음), 슬롯 16, 종료 후 summary 대조 |

## 합격선 (하나)

착용 40명(밴드 연결)·10분:

| 항목 | 기준 | verify |
|---|---|---|
| feature→DB | 참여자별 **600/600**, 중복 0, REST `rejected` 0 | V-L2, V-A1~A4 |
| 원시→S3 | 청크 **100% `uploaded`**, 갭 0, **S3 HEAD size·sha256 전수 일치** | V-L4 |
| 종료 후 재접속 복구 | 40기기 혼합(네트워크 단절·강제종료·종료 시 Wi-Fi 끊김)에서 20분 안에 feature·원시 서버 수량 == 로컬 수량, summary 빈 배열 | V-A10 |
| 소켓·Redis 장애 무관 | 소켓 차단·Redis 60초 정지 중에도 REST 저장 지속, 결측 0 | V-A11, V-L11 |

호스트 수신 지연·ACK 지연·presence 는 측정만(후속).

## Phase · 게이트 · 일정 (앱은 신규 설치 1회)

| Phase | 내용 | 게이트 | 일정 |
|---|---|---|---|
| **P0** 선행 | S3 HEAD 403, 부하 스크립트(REST 배치 모드·40기기 혼합 종료), API 스키마·네이티브↔JS 이벤트 계약 고정 | G0 | 11/1 09:00~12:00 |
| **P1** 서버 | S1 REST 배치 저장, S2 summary, S3 소켓 metric 방송 전용화, S4 시간검토·24h 삭제(원시·feature), S5 DB 풀·스레드풀·슬롯, S6 마이그레이션(late·hash_conflict 컬럼), S7 부하 계측 | **G1**: V-A1~A4·A8·A9, V-L1·L2 저장 열, V-L4, V-S15 | 11/1 18:00 dev 배포·재시험 1차 |
| **P2** 앱(Android/iOS/웹) | N1 FeatureUploader(REST 정본), N2 종료 대조, N3 전 scope 이어올림, N4 종료 비차단·지터·배치, N5 원시 대조, N6 복귀 재개, W1 웹 outbox IndexedDB, W2 웹 스위퍼, UI "업로드 중 N건" | **G2**: V-A10~A13, V-C1~C6·C8~C10 (디버그 빌드) | **FE/네이티브 동결 11/2 12:00** → 빌드 → **사이트 APK·TestFlight 교체 11/2 밤** |
| **P3** 검증 | 후보 빌드 설치(실기기 ≥2/플랫폼) → 실밴드 §D → 60분 소크(실밴드 ≥5 + 합성 35) → go/no-go | **go/no-go** | 11/3 09:00~15:00 |
| **11/4** 현장 | 참가자 신규 설치 안내(QR·사이트·TestFlight) → 클래스 → 종료 후 summary 전원 빈 배열 확인 | — | — |
| **§9 후속** | 리포트 결측 표기·재생성, 자기 화면 로컬 우선, publish 틱·pending 투영·백프레셔, 다중 워커, feature archive 재생, iOS BGProcessingTask | — | 11/5~ |

## 병렬화 (5트랙, 파일 겹침 없음 — §8)

| 트랙 | 담당 | 작업 | PR |
|---|---|---|---|
| **BE** | BE1 | S1~S7, P0-3 | `[SDD-260] 서버: feature REST 정본 저장·summary·소켓 방송 전용화` |
| **Android** | Native-A | N1~N6(Kotlin) | `[SDD-260] Android: FeatureUploader·대조·이어올림` |
| **iOS** | Native-I | N1~N6(Swift) | `[SDD-260] iOS: FeatureUploader·대조·이어올림` |
| **웹·공통** | FE1 | W1·W2·UI, 계약 문서, 네이티브↔JS 이벤트 | `[SDD-260] 웹·공통` |
| **QA(독립)** | QA | P0-2 스크립트, 대조 스크립트, V-A10 혼합 시험, 결과 기록 | `backend/scripts/loadtest/**` |

DEPLOY/OPS/APP: `.env`·IAM·dev 배포·사이트 APK·TestFlight(코드 커밋 없음). 머지는 DEPLOY 창구.

## 대표 결정 사항 (≤5)

1. 11/3 합격선 미달 시 (a) 검증된 착용 상한 (b) 2회차 분할 (c) EEG 없이 진행.
2. 11/2 12:00 동결을 못 지켜 11/3 09:00 설치가 불가하면: 동결을 11/2 18:00 으로 늦추고 11/3 오후 설치·시험 축소 vs 서버만으로 가기(앱은 현행 빌드 신규 설치 — 저장은 소켓 의존이라 100% 보장 불가). 기본안: 동결 연기.
3. 로컬 미완료 원본 보관: 서버 summary 빈 배열 확인 전 삭제 금지, 그 뒤 7일 보관(자동 삭제 없음).
4. 셀룰러 잔여 전송 기본 허용(저장 우선).
5. 현장 기기 정책: 앱만(웹 브라우저 참가자 불허). 설치 안내는 QR 1장(Android 사이트 APK · iOS TestFlight 링크).

---

## 1. 결론 (근거 요약)

1. 현행은 저장이 소켓 READY 에 종속(`_ingest` 가 READY 아니면 `not_ready`, F5)이고, 네이티브 outbox 는 영속하지만 소켓으로만 흘려보낸다(F20). 40명 시험 559건 거절 = 저장 누락. **소켓에서 저장을 떼고 REST 배치를 정본으로** 하면 READY·heartbeat·락·투영이 저장을 막을 수 없다.
2. 저장 판정 중 lease·offline_bound·24h·straddle·시간검토(F12·F15)는 "구앱·시계 불확실·권한 철회 뒤 유입"을 막기 위한 장치였다. 현장은 신규 설치·전담 운영이므로 **동의 철회만 남기고 삭제**한다. 늦게 온 창은 `late=true` 로 저장해 리포트 입력으로 쓴다.
3. 리포트는 `eeg_feature_windows` 만 읽고 `device_timestamp_ms` 우선으로 구간을 자른다(F16). REST 저장 시 `device_timestamp_ms=observed_at_ms` 를 채우면 리포트는 그대로 동작한다.
4. 원시는 archive 큐·presign/ack·manifest 가 이미 있고, 빈 곳은 "전 scope 이어올림"(F3·F4)과 "종료 후 서버 대조"다. 24h 409 는 유실 경로라 삭제.
5. feature archive→DB 재생(A6)은 구앱 안전망이었다. 앱이 journal 에서 REST 로 직접 재전송하므로 **후속**으로 내린다(feature artifact 업로드 자체는 그대로 둔다).

## 2. 코드로 확정한 사실

| # | 사실 | 근거 | 영향 |
|---|---|---|---|
| F1 | 앱 웹 번들 내장 | `frontend/capacitor.config.ts:6` | 프런트 변경 = 앱 빌드 |
| F2 | 앱이면 측정 경로는 항상 `native` | `measurement-web/measurement-path.ts:21-27` | 네이티브가 정본 |
| F3 | Android `ArchiveWorker` 는 `runtime.json` 1개만 읽어 마지막 세션만 drain | `runtime/ArchiveWorker.kt:16-18,41-50` | N3 |
| F4 | iOS `recoverOnLaunch` 는 CAPTURING 만 복구, 시작 외 drain 트리거 없음 | `MeasurementManager.swift:340-345`, `MeasurementHost.swift:55`, `NativeMeasurementPlugin.swift:33` | N3 |
| F5 | `_ingest` 는 READY 아니면 저장 전에 `not_ready`; DEGRADED→READY 복귀 없음 | `session_live_namespace.py:2299-2303,2151,2251,2340` | S3 로 저장을 소켓에서 분리 |
| F6 | 기본 executor 미설정(8스레드) | grep | S5 |
| F7 | `_project_latest` 락 10초 대기 | `live_ingest_service.py:265-283`, `config.py:88` | 저장과 분리되므로 후속(C1) |
| F11 | archive 슬롯 6/1.5s/Retry-After 3 | `config.py:92-93`, `api/deps.py:102-114` | S5 |
| F12 | 24h 이후 `pending_time_review` 409 | `biosignal_service.py:65-101` `archive_gate` | S4 삭제 |
| F13 | S3 HEAD 403(새 dev) | report-rerun §3 | P0-1 |
| F14 | 네이티브 feature artifact = 코어 `MetricFrame` ndjson(live envelope 본체와 동일) | `ArchiveFeeder.kt:23-55`, `MeasurementManager.swift:283-301`, `envelope.ts`, `engine.rs:232-240` | 후속 A6 재생 가능 근거 |
| **F15** | 저장 로직 `_store_windows`: participant 일치 → `_load_stream` → generation fencing → `evaluate_ingest` → `_feature_item` → `_persist_feature_items`(멱등키·SAVEPOINT·commit). Redis·READY 미참조 | `live_ingest_service.py:173-262`, `session_live_commands.py:471-510`, `session_service.py:3505-3535` | S1 은 이 함수를 REST 에서 호출하고 판정을 줄인다 |
| F16 | 리포트는 `eeg_feature_windows` 만 읽음(`device_timestamp_ms` 우선 구간 필터) | `class_report_stats_service.py:324-369` | S1 은 `device_timestamp_ms` 필수 |
| F18 | 리포트 트리거는 세션 종료 1회 | `audio_service.py:210-290`, `report_task.py:774-800` | 후속 R2 |
| **F20** | 웹 `MetricOutbox` 300 초과 폐기. 네이티브 outbox 상한 없음, Android 는 `StreamTag(streamId, generation, anchorId, participantId)` 바인딩 영속, iOS 는 envelope 전체 영속. 양쪽 `rejected` 는 격리·재전송 안 함 | `metric-outbox.ts:13,53`, `MetricOutbox.kt:14-60,98`, `MetricOutbox.swift:4-60` | N1 은 outbox 를 그대로 REST 전송원으로 쓴다. W1 |
| F21 | v1 REST `POST /sessions/{id}/features` 는 stream·동의 판정 없이 저장 | `api/v1/session.py:800-823`, `session_service.py:3667-3711` | **삭제 대상**(S1 이 대체, 호환 불필요) |
| F22 | 기존 소켓 metric 처리 = `make_sinks` → `_METRIC_SINK` → `ingest_metrics` → `_store_windows` + `_project_latest` + publish | `live_ingest_service.py:147-170,347-360` | S3 은 `_store_windows` 호출을 빼고 투영만 남긴다 |

---

## 3. Phase 0 — 선행 (11/1 09:00~12:00)

| ID | 내용 | 소유 | 산출·게이트 |
|---|---|---|---|
| P0-1 | S3 HEAD 403 원인(인스턴스 프로파일 vs `.env.dev` 키, 접두사·길이만). ack HEAD 검증(`storage_service.py:251-272`) 성공 확인 | DEPLOY/OPS | 403 해소 또는 원인 기록 |
| P0-2 | 부하 스크립트 `backend/scripts/loadtest/`: 기기 시뮬레이터가 **REST 배치(5초·≤60창)** 로 저장하고 소켓은 방송만; 모드 `--mixed-close`(10기기 네트워크 3분 단절·10기기 종료 직후 kill→2분 뒤 재실행·10기기 종료 시 Wi-Fi 5분 끊김·10기기 정상, 전원 동시 종료); 출력 = 참여자별 DB 창 수·중복·REST 거절 코드·원시 `uploaded`·S3 전수 대조·summary 결과 | QA | 스모크 1회 |
| P0-3 | 서버 계측: REST 배치 접수·거절 코드·처리 ms·DB 활성·스레드풀 대기를 로그/`/metrics` | BE1 | 대시보드 1장 |
| P0-4 | **계약 고정(11/1 12:00)**: BE 가 S1·S2 OpenAPI 스키마를 `docs/sdd-260-api.md` 에, FE1 이 네이티브↔JS 이벤트(`feature.counts`, `archive.counts`, `reconcile.state`)를 `docs/sdd-260-native-js-events.md` 에 고정. 이후 변경은 TASK BOX 승인 | BE1·FE1 | 문서 2건 |

## 4. Phase 1 — 서버 (BE1, 11/1 18:00 dev 배포)

| ID | 작업 | 파일·함수 | 통과 기준 |
|---|---|---|---|
| **S1** | **REST 배치 저장** `POST /api/v1/sessions/{session_id}/features/batch`. 요청 `{participant_id, windows: [MetricEnvelope…] (1≤n≤300)}`; 인증 JWT 또는 `X-Entry-Credential`(`resolve_upload_participant` 재사용). 처리 `live_ingest_service.store_batch(db, participant, session_id, windows, now)`: ① `w.session_id/participant_id` 일치 ② `_load_stream` → `stream.participant_id == participant.id` 아니면 `stream_not_owned` ③ `stream.cutoff_code == CUTOFF_CONSENT_WITHDRAWN` 면 `consent_withdrawn` ④ `_feature_item(w, end_at=observed_at_ms 기반, anchored=True)` + `late = (session.ended_at and observed_at > ended_at)` ⑤ `_persist_feature_items(..., quality_overrides)` ⑥ 응답 `[{sequence, status: accepted|duplicate|rejected, code?, durable: true}]`. **`_project_latest`·publish 호출 없음.** 슬롯 비적용. `evaluate_ingest` 는 호출하지 않는다(판정 ②③ 로 대체). 기존 v1 `POST /{session_id}/features`(`ingest_eeg_features`) 와 `session_service.ingest_features` 삭제 | `api/v1/session.py`(라우트 추가·구 라우트 삭제), `services/live_ingest_service.py`(`store_batch` 신설, `_store_windows` 에서 판정 분리), `schemas/session_live.py`(`FeatureBatchRequest/Response`), `services/session_service.py`(구 함수 삭제) | pytest: 300창 1회 < 2s, 멱등·hash 충돌·소유권·동의 철회 4경로, 301창 422. V-A1~A4·A9 |
| **S2** | **summary** `GET /api/v1/sessions/{session_id}/features/summary?participant_id=`: 본인·호스트만(타인 403). `eeg_feature_windows` 에서 (play_group_id) 별 `{stream_id, count, min_index, max_index, contiguous_through, missing_ranges[[lo,hi]…] (≤200, truncated:bool)}`, 상위 `total_count, updated_at`. 쿼리 1회(window_index 정렬 → 파이썬에서 구간 계산) | `api/v1/session.py`, `services/live_ingest_service.py`(`feature_summary`) | pytest: 결측 구간 정확, 600창 조회 < 200ms. V-A8 |
| **S3** | **소켓 metric 방송 전용화**: `ingest_metrics` 에서 `_store_windows` 호출 제거 → 창마다 ① participant·stream 소유 확인(캐시) ② `_project_latest` + publish 만. ACK `{sequence, status: projected|ignored, code?}` (`durable` 필드 삭제). `_ingest` 상태 가드는 그대로(방송은 READY 에서만 의미). `live:device` 는 현행 유지 | `services/live_ingest_service.py`(`ingest_metrics`, `make_sinks`), `ws/session_live_namespace.py`(ACK 스키마 주석) | 기존 live 테스트 갱신: metric 소켓 수신 후 DB 행 **0**, outbox 갱신 1. V-A2 |
| **S4** | **시간검토·24h 삭제**: `biosignal_service.archive_gate` 에서 `close_deadline`·`pending_time_review`·`window_unproven`·409 경로 제거 → 동의 철회(`archive_rejected`)만 403. `evaluate_ingest` 의 lease·offline_bound·straddle·close_deadline 분기 삭제(소켓 투영의 `live_fresh_allowed` 판정용 최소형만 남김). artifact presign 도 동일. `CaptureStream.close_deadline_at`·`offline_bound_until` 은 컬럼 유지(쓰지 않음) | `services/biosignal_service.py:65-101`, `biosignal_artifact_service.py:113-122`, `session_live_commands.py:471-510` | pytest: deadline 24h 지난 presign/ack 200, `uploaded`. V-S17(재정의) |
| **S5** | **저장을 막는 자원**: DB 풀 `DB_POOL_SIZE=20/DB_MAX_OVERFLOW=20`(웹 합계 ≤40, RDS 79), `loop.set_default_executor(ThreadPoolExecutor(32))`(소켓 방송·REST 공용), anyio threadpool 토큰 40→64(`anyio.to_thread.current_default_thread_limiter().total_tokens`), archive 슬롯 16/0.5s/Retry-After 2~6 | `main.py`(lifespan), `config.py`, `api/deps.py:102-114`, `.env`(DEPLOY) | V-S14, V-L4, V-L6 |
| **S6** | **마이그레이션 1개**: `eeg_feature_windows.late BOOLEAN DEFAULT false`, `eeg_feature_windows.ingest_path VARCHAR(8) DEFAULT 'rest'`(rest/legacy), `biosignal_stream_stats`(선택) 없음. heads 1 확인 | `models/eeg_feature.py`, `alembic/versions/<ts>_sdd260_feature_late.py` | `python3 scripts/check-alembic-heads.py` = 1. V-D2 |
| **S7** | 계측(P0-3) + REST 배치 429 없음 확인(슬롯 비적용) | `services/live_ingest_service.py`, `core/metrics.py`[추정] | 대시보드 |

**G1** = V-A1~A4·A8·A9, V-L1·L2 저장 열(REST 거절 0·600/600·중복 0), V-L4, V-S15, V-S14. 커밋: S 하나당 1커밋. 롤백: 직전 릴리즈 재배포(플래그 없음 — 단일 경로가 더 확실).

## 5. Phase 2 — 앱 (Android / iOS / 웹·공통, 동결 11/2 12:00)

### 5.1 공통 계약 (3트랙 동일)

- **FeatureUploader(N1)**: outbox 의 미ACK 창을 `sequence` 오름차순으로 ≤60창씩 **5초 주기** REST 전송(측정 중·종료 후 동일). 응답 `accepted|duplicate` → outbox acked, `rejected` → 코드별 격리(`consent_withdrawn`·`participant_mismatch`·`stream_not_owned`·`hash_conflict` 4종, 그 외 코드는 재시도). 네트워크·5xx·타임아웃은 full jitter `0..min(60s, 1s×2^n)` 로 무한 재시도. 401 은 토큰 갱신 대기. 동시 요청 1.
- **소켓**: `live:metric` 은 방송 전용. ACK 로 outbox 를 acked 하지 **않는다**(REST ACK 만 정본). 끊겨도 FeatureUploader 는 계속 돈다.
- **종료 대조(N2)**: 세션 종료 후 outbox pending 0 이 되면 `GET /features/summary` → `missing_ranges` ∩ 로컬 journal 보유 창 → N1 로 재전송 → summary 재조회 → 빈 배열이면 feature 완료. 로컬에도 없는 구간은 `gap(local_missing)` 진단 기록. 원시는 `GET /biosignal-raw/summary` 로 동일(N5).
- **트리거**: 종료 직후(지터 0~60s) · 앱 시작 · 포그라운드 · 네트워크 복귀 · 60초 주기(미완료 scope 있을 때만). 동시 scope 1. 다른 계정 scope 는 보존만.
- **종료 비차단(N4)**: 종료 = 봉인 + close intent + 마지막 배치 전송 시도. 화면 "수업 종료 · 데이터 업로드 중 feature N창 · 원시 M건(MB)" → "업로드 완료". 화면 이탈 가능.
- **보관**: summary 빈 배열 확인 전 삭제 금지. 확인 후 7일 보관(대표 결정 3).
- **"무조건 백그라운드 재개"**: 인증·네트워크·OS 실행 기회가 오면 화면과 무관하게 재시도. OS 강제종료 중 상시 실행은 약속하지 않음 → 합격은 재실행 후 복구.

### 5.2 작업 (Android)

| ID | 작업 | 파일·함수 [확인/추정] | verify |
|---|---|---|---|
| N1-A | `live/FeatureUploader.kt` 신설: `MetricOutbox.nextBatch(tag, 60)`[확인 :73] → `POST /features/batch`(OkHttp, JWT/entry 헤더는 기존 `ArchiveUploader` 의 인증 공급자 재사용[추정]) → `ack(seq)`[확인 :85]/`quarantine(seq, code)`[확인 :98]. 5초 타이머 + 트리거. `LiveSession.kt` 의 metric 소켓 ACK 처리에서 `outbox.ack` 호출 제거(방송 전용) | `measurement/live/FeatureUploader.kt`(신규), `live/LiveSession.kt`, `live/MetricOutbox.kt`(`pendingInRanges(ranges)` 추가) | V-A1, V-A11, V-A12 |
| N2-A | `live/FeatureReconciler.kt` 신설: summary 호출 → ranges → `MetricOutbox.pendingInRanges`/journal 재적재 → N1 → 재조회 | `live/FeatureReconciler.kt`(신규) | V-A10 |
| N3-A | `runtime/ArchiveWorker.kt`: `filesDir/measurement/*/archive` + outbox 파일 전부 탐색, pending>0 또는 close-intent 미전송 세션 모두 처리(동시 1). `RuntimeConfig` 에 scope account 저장, 토큰 account ≠ scope 면 건너뜀. 앱 시작(`NativeRuntime` init)·`ConnectivityManager` 콜백·포그라운드에서 `schedule(ctx, jitter)` | `runtime/ArchiveWorker.kt:16-50`, `runtime/NativeRuntime.kt`, `archive/ArchiveQueue.kt` | V-C5, V-C6 |
| N4-A | 종료 비차단·지터·presign/ack 배치 ≤24·`archive.counts`/`feature.counts` 이벤트 | `archive/ArchiveUploader.kt`[추정], `NativeMeasurementPlugin.kt`[추정] | V-C4, V-C8, V-C3 |
| N5-A | 원시 종료 대조(`GET /biosignal-raw/summary` → 없는 alias 재큐잉) | `archive/ArchiveUploader.kt` | V-C3 |
| N6-A | 복귀 재개: 포그라운드·네트워크 복귀 시 `capture.renew`(소켓 있으면) → FeatureUploader 즉시 1회 → archive drain → 측정 계속 | `live/LiveSession.kt` | V-C9 |

### 5.3 작업 (iOS)

| ID | 작업 | 파일·함수 | verify |
|---|---|---|---|
| N1-I | `MeasurementKit/FeatureUploader.swift` 신설: `MetricOutbox.windows`(미acked)[확인] 60개 → URLSession POST → `markAcked`[확인]/`markRejected(code)`[확인]. 5초 타이머 + 트리거. `LiveSession.swift` 의 소켓 ACK→`markAcked` 제거 | `Sources/MeasurementKit/FeatureUploader.swift`(신규), `LiveSession.swift`[추정], `MetricOutbox.swift`(`pending(in ranges:)` 추가) | V-A1, V-A11, V-A12 |
| N2-I | `FeatureReconciler.swift` 신설(summary→ranges→재전송→재조회) | 신규 | V-A10 |
| N3-I | `MeasurementManager.drainPendingArchives()` 신설: `sessionDir(*)` 중 pending>0 또는 close intent 미전송 세션 전부(SEALING/CLOSED/DRAINING 포함, CAPTURING 복구와 분리). 호출: `MeasurementHost.swift:55` 직후·`willEnterForeground`(`NativeMeasurementPlugin.swift:33`)·`NWPathMonitor` 복귀. background URLSession task↔alias 재연결 | `MeasurementManager.swift:340-345`, `ArchiveUploader.swift`[추정], `MeasurementHost.swift`, `NativeMeasurementPlugin.swift` | V-C5, V-C6 |
| N4-I | 종료 비차단·지터·배치·counts 이벤트 | `ArchiveUploader.swift`, `NativeMeasurementPlugin.swift` | V-C4, V-C8, V-C3 |
| N5-I | 원시 종료 대조 | `ArchiveUploader.swift` | V-C3 |
| N6-I | 복귀 재개 | `LiveSession.swift`, `MeasurementManager.swift` | V-C9 |

### 5.4 작업 (웹·공통)

| ID | 작업 | 파일 | verify |
|---|---|---|---|
| W1 | `metric-outbox.ts`: `DEFAULT_MAX_PENDING` 폐기 제거, IndexedDB(`queue-db.ts` 재사용) 영속, `FeatureUploader`(웹판, 5초·60창·REST) + 소켓 ACK 분리 | `lib/measurement-web/metric-outbox.ts`, `web-measurement-session.ts`, `use-web-measurement.ts`, `lib/biosignal/queue-db.ts` | V-A13 |
| W2 | `BiosignalQueue.listScopes()` + `useBiosignalResumeSweeper()`(앱 셸, 시작·online·복귀·60초) | `lib/biosignal/durable-queue.ts`, `hooks/use-biosignal-resume-sweeper.ts`(신규) | V-C5(웹) |
| UI | `recording-status.tsx` "업로드 중 feature N창 · 원시 M건(MB)" / "완료"; `use-native-measurement.ts` 가 `feature.counts`·`archive.counts`·`reconcile.state` 수신 | `components/.../recording-status.tsx`, `lib/measurement-web/use-native-measurement.ts` | V-C8 |
| 계약 | `docs/sdd-260-native-js-events.md`(P0-4) | docs | — |

**G2** = V-A10~A13, V-C1~C6·C8~C10 (로컬 디버그 빌드, dev 서버 P1 반영본에 연결).

## 6. Phase 3 — 검증·go/no-go (11/3)

| 시각 | 내용 | 기준 |
|---|---|---|
| 09:00 | 후보 빌드 설치(Android 사이트 APK · iOS TestFlight, 실기기 각 ≥2) | V-D4 |
| 09:30~12:00 | 실밴드 §D V-B1~B10 (잠금·백그라운드·BLE OFF·비행기 모드·강제종료·종료 후 앱 종료) | 전부 통과 |
| 12:00~13:30 | 60분 소크: 실밴드 ≥5 + 합성 35(REST 배치 모드), 종료 후 전원 summary 빈 배열 | V-L7, V-A10 |
| 15:00 | **go/no-go** — 합격선 §1 | 미달 시 대표 결정 1 |

## 7. 일정 (앱은 신규 설치 1회 — 업데이트·구버전 항목 없음)

| 일시 | 작업 |
|---|---|
| 10/31(토) | plan·verify 확정, Brian 승인 |
| 11/1(일) 09:00 | P0. **5트랙 동시 착수**(BE S1~S7 / Android N1~N6 / iOS N1~N6 / 웹 W1·W2·UI / QA P0-2). 12:00 계약 고정(P0-4) |
| 11/1(일) 18:00 | BE PR → DEPLOY dev 반영 → **부하 재시험 1차**(착용 30·40, REST 배치 모드) → G1 |
| 11/2(월) 09:00 | G1 판정. 미달이면 BE 는 저장 원인(DB 풀·스레드·쿼리)만 잡는다. 앱 3트랙은 dev 에 붙여 디버그 빌드 시험 시작 |
| 11/2(월) **12:00** | **FE/네이티브 동결** → APP: Android AAB→Play 서명 APK→사이트 업로드(반나절~1일) · iOS TestFlight 업로드+베타 심사(수 시간) |
| 11/2(월) 오후 | 디버그 빌드로 V-A10~A13·V-C (합성 40 + 실기기 2~4). **부하 재시험 2차**(`--mixed-close`) → G2 |
| 11/2(월) **22:00** | **서버 동결**. 사이트 APK·TestFlight 교체 완료 확인 |
| 11/3(화) 09:00~15:00 | P3 검증 → go/no-go. go 면 prod 릴리즈(별도 승인) + 현장 설치 안내 QR |
| 11/4(수) | 현장: 참가자 신규 설치 → 클래스 → 종료 후 전원 summary 빈 배열·원시 100% 확인(OPS) |
| 11/5~ | §9 후속 |

**일정 위험**: ① Android APK 1일 → 11/2 12:00 동결 필수(대표 결정 2). ② REST 배치와 소켓 방송이 같은 창을 쓰지만 DB 기록은 REST 뿐이라 경합 없음. 소켓 ACK 로 acked 처리하는 코드가 남으면 유실 → 3트랙 공통 리뷰 항목. ③ 현장 Wi-Fi 40폰 → 실기기 2~5 + 합성. ④ iOS 베타 심사 지연 → 내부 테스터 배포(심사 불필요) 사용.

## 8. 파일 소유 (트랙 간 겹침 없음)

| 트랙 | 소유 파일 |
|---|---|
| **BE** | `backend/app/api/v1/session.py`, `services/live_ingest_service.py`, `services/session_service.py`(구 `ingest_features` 삭제), `services/session_live_commands.py`(`evaluate_ingest` 축소), `services/biosignal_service.py`, `services/biosignal_artifact_service.py`, `ws/session_live_namespace.py`(ACK 주석만), `schemas/session_live.py`, `schemas/biosignal.py`, `config.py`, `main.py`, `api/deps.py`, `models/eeg_feature.py`, `alembic/versions/`(1개), `backend/tests/`, `docs/sdd-260-api.md` |
| **Android** | `frontend/android/app/src/main/java/com/looxidlabs/mindbreeze/measurement/**`(`live/`, `archive/`, `runtime/`), `app/src/test/**` |
| **iOS** | `frontend/ios/MeasurementKit/**`, `frontend/ios/App/App/Measurement/**` |
| **웹·공통** | `frontend/src/lib/measurement-web/**`, `frontend/src/lib/biosignal/**`, `frontend/src/hooks/use-biosignal-resume-sweeper.ts`, `components/.../recording-status.tsx`, `docs/sdd-260-native-js-events.md` |
| **QA** | `backend/scripts/loadtest/**`, `specs/sdd-260-*/test-results/` |

공통 리뷰 체크(3트랙): "소켓 ACK 로 outbox acked 처리하는 코드가 0건인가", "REST 거절 4종 외 코드는 재시도인가", "summary 빈 배열 전 삭제 0인가".

## 9. 후속 (저장 100% 에 영향 없음 — 삭제하지 않고 한곳에)

| ID | 내용 | 근거 |
|---|---|---|
| A2 | heartbeat DEGRADED→READY 복귀(방송 품질) | F5 |
| A4 / C1 | `_project_latest` NOWAIT + publish 틱·dirty 재투영(호스트 지연) | F7·F8 |
| A6 | feature archive→DB 재생(2중 안전망; 네이티브 artifact 는 그대로 올라옴) | F14 |
| C2~C4 | `live_metric_projection_pending`·백프레셔·왕복 축소 | — |
| C5 | 다중 uvicorn 워커(Redis 이관) | 11/9~ |
| R1~R3 | 리포트 결측 판정·"데이터 확인 중"·재생성·`pending_upload` 표시 | F16·F18 |
| M1~M2 | 회원 자기 화면 로컬 우선·끊김 중 유지 | F17 |
| P3-N2 | iOS `BGProcessingTask` | — |
| P3-N3 | 로컬 보관 정책 화면 표시 | 대표 결정 3 |
| V-S13·V-L3·V-L5 | 영상·음성 동시 부하·호스트 지연 — 기록만 | — |

## 10. 확인하지 못한 것 (구현 전 정독)

- Android/iOS 기존 REST 인증 공급자(`ArchiveUploader` 의 토큰·entry credential 주입 방식) — N1 이 재사용.
- iOS `LiveSession.swift`·`ArchiveUploader.swift` 본문(소켓 ACK→`markAcked` 호출 위치, 429·background URLSession).
- Android `LinkWatchdog.kt` 재연결 정책, `ArchiveUploader.kt` 위치·구조.
- `core/metrics.py` 존재 여부(계측 노출 방식).
- 운영 서버 사양·`LIVE_PROTOCOL_V2`·prod S3 권한.
- 60분·1인 원시 용량 → V-B1 실측.
