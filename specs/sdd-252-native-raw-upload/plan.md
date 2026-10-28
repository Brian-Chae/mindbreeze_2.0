# SDD-252 — Plan

## Architecture
```
BLE → MeasurementEngine.onNotification → raw.journal(fsync) ─┬→ Rust 코어 → 1Hz 프레임 → ArchiveFeeder(feature, scope 채움)
                                                              └→ [신규] RawArchiver(센서별 RawChunker) → 10s 청크 → ArchiveQueue(kind=raw)
ArchiveUploader: raw → biosignal-raw/{presign,ack}, feature → biosignal-artifacts/*  (기존 경로 재사용)
```
- RawChunker(순수 Kotlin, JVM 테스트 가능): 패킷 → 파싱/세그먼트 판정 → MBRAW002 바이트 + 메타(JSON, 서버 RawHeader).
- 프로세스 재생성: `NativeRuntime.open` 에서 `raw.journal` 재생 → 같은 alias 멱등.
- 큐 복구: `ArchiveQueue.repairLegacyFeatures` — meta.signal 이 null 인 DEAD_LETTER feature 항목을 보정 후 PENDING.

## Files to Change
| Action | File | Description |
|---|---|---|
| Create | android `.../archive/RawChunker.kt` | MBRAW002 인코더 + 세그먼트/청크 경계 |
| Create | android `.../archive/RawArchiver.kt` | 센서별 chunker 묶음 + 큐 enqueue + 재생 |
| Modify | android `ArchiveFeeder.kt` | signal/segment_id/stream_id 채움 |
| Modify | android `ArchiveUploader.kt` | 4xx `detail` 사유 보존 |
| Modify | android `ArchiveQueue.kt` | 레거시 feature 항목 복구 |
| Modify | android `MeasurementEngine.kt`, `NativeRuntime.kt` | raw 훅 연결·정지 flush·재생 |
| Create | android test `RawChunkerTest`, `ArchiveFeederTest` 보강, `ArchiveQueueRepairTest` | 단위 |
| Create | `backend/tests/test_sdd252_native_contract.py` + fixture | 서버 계약 |
| Modify | iOS `MeasurementKit` (`RawChunker.swift` 신규, `MeasurementManager.enqueueArchive`, `Archive.swift`) | 동등 수정 |
| Modify | `frontend/src/lib/biosignal/capture-session.ts` + 테스트 | segment 분할 허용오차, 꼬리 봉인 |

## Tasks
1. T1 서버 계약 fixture·pytest(RED) 2. T2 Android RawChunker+테스트 3. T3 RawArchiver 연결(엔진 훅·재생·flush)
4. T4 Feeder 메타·Uploader 진단·큐 복구 5. T5 iOS 동등 구현 6. T6 웹 보강 7. T7 전체 테스트·Summary·PR

## Testing Strategy
`./gradlew test`, `pytest backend/tests/test_sdd252_native_contract.py test_sdd244_artifacts.py`, `swift test`(가능 범위), `npx vitest run`(기준선 대비), `npx tsc -b --noEmit`.
