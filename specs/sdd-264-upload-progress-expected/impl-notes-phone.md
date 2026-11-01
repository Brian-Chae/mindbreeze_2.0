# SDD-264 — 폰 구현 노트 (JS 보고기 + 네이티브 `signals` 최소 확장)

- 계약 정본: `contract.md` §1·§7. BE 는 건드리지 않았다. 앱 빌드 안 함.
- 검증: `cd frontend && npx tsc -b && npx vitest run tests/sdd264-report tests/sdd260-web tests/sdd246-web tests/sdd246-archive` / `cd frontend/android && ./gradlew --offline testDevDebugUnitTest` / `cd frontend/ios/MeasurementKit && swift test`.

## 1. 구성

| 위치 | 역할 |
|---|---|
| `lib/api/ingest-expected.ts` | `PUT /sessions/{sid}/ingest-expected` 클라이언트(JWT 또는 X-Entry-Credential) |
| `lib/biosignal/expected-reporter.ts` | 병합(필드별 max, final 서버 규칙 ①②③ 동일)·영속 1건·30초 간격·full jitter 재시도·오류 분류 |
| `lib/biosignal/expected-hub.ts` | 네이티브 이벤트(`feature.counts`·`archive.counts.signals`·`reconcile.state`·`measurementUpdated`)/웹 outbox 총량 → 보고기 |
| `hooks/use-biosignal-expected-reporter.ts` | 앱 셸 구동(시작·online·복귀·60초 flush). `use-biosignal-resume-sweeper.ts` 안에서 호출 → `App.tsx` 변경 없음 |
| `lib/native-measurement/index.ts` | `subscribeUploadEvents()` 추가(세션 필터 없는 raw 구독 — 화면을 떠난/재기동 후 이어올림 세션 총량도 받는다) |
| `lib/biosignal/queue-db.ts` | IndexedDB v3→v4, 스토어 `expected_report`(additive) |

## 2. 보고 규칙 구현

| 규칙 | 구현 |
|---|---|
| 측정 중 30초마다(값 변동 시) | 첫 보고·final 변화는 즉시, 그 외는 마지막 전송 후 30초 미만이면 타이머 예약, 최신 병합값 1건만 전송 |
| 종료 즉시 final=true | `measurementUpdated.state ∈ {SEALING,DRAINING,CLOSED}` → `markEnding` → 즉시 전송 |
| 이어올림 완료 final=true 재보고 | `reconcile.state.complete=true` → final=true(총량 동일해도 final 변화는 즉시 전송) |
| 오프라인 마지막 1건 | scope(계정\|회차\|참가자)당 IndexedDB 레코드 1건, 값은 단조 병합 → 복귀 시 최댓값 1건 전송. 재기동 후 `restore()+flushAll()` |
| 재시도 | 401·408·429·5xx·네트워크: full jitter 0..min(60s,1s×2^n) 무한. 400·403·404·409·422: 로깅 후 **중단, 값은 보존**(`halted` 사유 기록) |
| 여러 회차 | 레코드·타이머·in-flight 모두 scope 별. 한 회차 오류가 다른 회차를 막지 않음 |
| 다른 계정 | `authFor` 가 null 이면 보존만(SDD-260 스위퍼와 같은 규칙) |
| raw | `archive.counts.signals` 가 3신호·4상태 모두 있을 때만 `raw` 전송(착용 안 한 신호는 0). 없으면(구 네이티브) feature 만 |
| participant_id | 앱(JWT)은 생략 → 서버가 본인 행 확정. 웹 outbox scope 는 참가자 ID 를 실어 보냄 |

## 3. 네이티브 변경 (additive, 기존 필드·동작 불변)

`archive.counts` payload 에 `signals: {eeg|ppg|acc: {pending, uploading, verified, quarantined}}` — Android/iOS 동일 형태(3신호 항상 존재, 미착용 0).

| 항목 | Android | iOS |
|---|---|---|
| 집계 | `ArchiveQueue.signalCounts()` (`kind=="raw"` 만, `meta.header.signal_type`) | `ArchiveQueue.signalCounts()` (`kind == .raw` 만) |
| quarantined 의미 | HALTED+TIME_REVIEW+DEAD_LETTER | pendingAuthorization+pendingTimeReview+quarantined (총량에서 빠지지 않게 모두 포함) |
| uploading | 큐에 상태 없음 → 0 | 큐 `.uploading` |
| 이벤트 | `SyncEvents.payloads` ← `SyncCounts.signals`(`MeasurementPlugin.emitSync`, `ScopeSweeper.pub`) | `emitSyncStatus` ← `SyncSnapshot.signals`(`SessionSync.publish`) |
| 재기동 직후 스냅샷 | `getMeasurementSnapshot.uploadCounts.archive_signals` | `getMeasurementSnapshot.uploadCounts` (신규, Android 와 같은 키: feature_*·archive_*·archive_signals) |
| 큐를 못 읽은 상태 | `signals=null` → 키 자체를 싣지 않음(0 으로 오해 방지) | 동일(`nil`) |

## 4. 단위 대조 (⚠ 계약 불일치 없음)

| 항목 | 서버(계약) | 폰 코드 | 일치 |
|---|---|---|---|
| raw 1건 | `eeg_raw_chunks` 행 1개, 식별 = `(signal_type, stream_id, segment_id, chunk_index)` (`biosignal_service._identity`, `uq_eeg_raw_chunk_v2`) | 청크 1개 = 큐 항목 1개 = presign 1건. alias `RAW-{SIG}-{stream8}-{segment8}-{chunkIndex:06}`, 같은 alias 재투입은 1회(`ArchiveQueue.enqueue` / `enqueue` 멱등). 헤더에 같은 4필드(`RawChunker.kt:141`, `RawChunker.swift` seal) | ✅ |
| 신호별 분리 | `signal_type` 별 집계 | 센서마다 별도 `RawChunker`(신호별 stream_id·segment_id·chunk_index). 큐 집계 키 = `header.signal_type` | ✅ |
| feature 창 1개 | `eeg_feature_windows` 행 1개 | `feature.counts` = outbox 창 단위(`pending+acked+rejected`). feature **산출물(NF-*, kind=feature)** 은 raw 총량에서 제외(시험으로 확인) | ✅ |
| 총량 단조 | 서버 max 병합 | 큐 항목은 삭제되지 않음(Android `gcVerified` 는 payload 파일만 삭제, 항목·메타 유지 / iOS 저널 유지). 상태 전이해도 `total` 불변(시험) | ✅ |

## 5. 시험 실측

| 영역 | 명령 | 결과 |
|---|---|---|
| JS 신규 | `vitest run tests/sdd264-report` | 29 통과 |
| JS 회귀 | + `tests/sdd260-web tests/sdd246-web tests/sdd246-archive` | 24 파일 228 통과·1 skip, `tsc -b` 오류 0 |
| Android | `./gradlew --offline testDevDebugUnitTest` (전체) | 255 통과·실패 0 (신규 `SignalCountsTest` 4, `SyncStatusTest` +1) |
| iOS | `swift test --filter SignalCountsTests\|ArchiveQueueTests\|ManagerT07bTests\|SessionSyncTests` | 50 통과·실패 0 (신규 `SignalCountsTests` 4) |

시험 환경 메모: 워크트리에 `android/local.properties`(sdk.dir)·`android/capacitor-cordova-android-plugins`(다른 워크트리에서 복사)·`ios/MeasurementKit/Frameworks`(심링크) 필요 — 모두 gitignore.

## 6. 남은 위험 · 확인하지 못한 것

1. **실기 미검증**: 폰↔서버 종단(V-X32: 3신호 단위 대조)·Doze·강제종료는 미실시. JVM/SwiftPM/vitest 만.
2. **Android 이벤트는 foreground 일 때만 emit**(`emitBatch`) — 백그라운드 중 증가분은 복귀 시 다음 `archive.counts`로 반영(보고가 최대 복귀 시점까지 지연, 단조라 유실 아님). 종료 직후 final 은 SEALING 상태 `measurementUpdated` 에 의존 → 종료 때 앱이 백그라운드면 복귀·이어올림 완료(`reconcile.complete`) 시점의 final 이 안전망.
3. **`measurementUpdated.state` 종료 감지는 foreground 이벤트에만 의존**. 앱이 죽었다 재기동한 뒤에는 `reconcile.state.complete=true`(스윕 완료) 가 final=true 를 보낸다. 완료 전까지는 final=false 로 `in_progress`/30분 후 `expected_unknown`(BE 규칙) — 의도된 동작.
4. **재기동 직후 JS 가 `uploadCounts` 를 능동 조회하지는 않는다**(필드만 노출). 이벤트(2초 주기, 값 변동 즉시)가 재기동 후 자동 재개되므로 보고는 이어지나, 능동 조회 연결이 필요하면 후속(facade `getMeasurementSnapshot`).
5. 앱 비로그인 상태의 네이티브 세션(= `userId=null`)은 보고하지 않는다(계정 불명). 입장 자격(`entry:`)으로 앱 측정을 하는 경로는 코드베이스에 없음(회원 앱은 JWT).
6. `quarantined` 로 센 청크는 서버에 영구히 도착하지 않을 수 있어 기대량에는 포함 → 서버 쪽 `needs_attention` 으로 드러나는 것이 의도.
7. `docs/sdd-260-native-js-events.md` 에 `signals` additive 필드 한 줄 추가가 필요하나 소유 경로 밖이라 미수정(감독 판단).
