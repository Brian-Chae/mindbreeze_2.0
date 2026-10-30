# SDD-252 — Summary

## What Was Built
| 영역 | 파일 | 내용 |
|---|---|---|
| Android | `archive/RawChunker.kt` (신규) | BLE 원문 → MBRAW002(raw-v2) 청크. 10초/900KB/segment 전환/flush 봉인. EEG·PPG·ACC |
| Android | `archive/RawArchiver.kt` (신규) | 센서별 chunker + 큐(kind=raw) 적재 + `raw.journal` 재생(멱등, 상태 파일) |
| Android | `MeasurementEngine.kt`, `runtime/NativeRuntime.kt` | `rawSink` 훅(journal fsync 직후), 정지 시 flush, 시작 시 재생·레거시 보정 |
| Android | `archive/ArchiveFeeder.kt` | feature 메타에 `signal='eeg'`·`segment_id`·`stream_id` 채움 (원인 2) |
| Android | `archive/ArchiveUploader.kt` | 4xx 서버 `detail` 을 `lastReason`(`http_422: …`)에 보존 (원인 3) |
| Android | `archive/ArchiveQueue.kt`, `runtime/ArchiveWorker.kt` | 구 앱이 scope 없이 DEAD_LETTER 시킨 feature 항목 보정 후 PENDING 복귀 |
| iOS | `RawChunker.swift` (신규) | 동일 계약 청크 생성(결정적 UUIDv5형 id) |
| iOS | `MeasurementManager.enqueueArchive`, `Archive.swift`, `MeasurementEngine.swift` | 통파일 journal 업로드(항상 422) 폐기 → 센서별 raw-v2 청크 + feature 60프레임 ndjson 묶음, 항목 `meta` 영속, presign 본문에 meta 사용 |
| 웹 | `capture-session.ts` | PPG/ACC segment 분할 허용오차 EEG 2샘플 → 500ms (원인 5) |
| 서버 | 변경 없음 | 스키마가 `native-candidate`·`little` 을 이미 허용. 마이그레이션 없음 |
| 테스트 | `backend/tests/test_sdd252_native_contract.py`, `specs/…/fixtures/` | Android 가 실제 코드로 내보낸 메타·바이트를 서버 presign/ack 에 통과시킴 |

## Test Results
- Android `testDevDebugUnitTest testProdDebugUnitTest`: 386건 통과(신규 RawChunker 7·Feeder 2·Uploader 1 포함).
- 서버 pytest: `test_sdd252_native_contract` 6건 + 기존 raw/artifact/ingest 계열 포함 36건 통과. 네이티브 raw(EEG/PPG/ACC)·feature presign 200, ack `uploaded`+`verified_at_us`, 구 null 메타 422 회귀 고정.
- iOS `swift test`: RawChunkerTests 7건 + 기존 테스트 통과. `ModelPinTests.testA6…` 1건 실패는 변경 전 커밋 `cb86912e` 에서도 동일(기존 실패, 무관).
- 웹 vitest: 8파일 17건 실패 = 기준선과 동일, 신규 0. 신규 3건(PPG·ACC 흔들림 무분할, 큰 간극 분할, pause 꼬리 봉인) 통과. `tsc -b --noEmit` 0 error.
- verify.md TS 대응: TS1~8·10(Android), TS9(Uploader), TS11(서버), TS12(iOS), TS13~14(웹). TS7 은 `archiverReplayIsIdempotent…` 로 확인.

## Debugging Journey
- 업로더 사유 보존이 기존 테스트(`local_seal_mismatch`, `content_schema_invalid`)와 충돌 → 서버 본문이 있고 분류 코드와 다를 때만 `코드: 사유` 로 붙이도록 조정.
- 서버 `RawHeader`는 `extra=forbid` 라 raw 본문에 `monotonic_range` 를 넣으면 422 → iOS presign 은 raw 에 meta 를 그대로 쓰고 range 를 덧붙이지 않음.
- Gradle `-D` 는 테스트 JVM 에 전달되지 않음 → fixture 내보내기는 환경변수 `SDD252_FIXTURE_DIR`.
- 웹 테스트 기본 `createId` 는 앞 8자리가 같아 segment 2개 이상이면 alias 충돌(운영은 랜덤 UUID라 무관) → 테스트 전용 id 사용.

## Notes for Reviewer
- **앱 재빌드 필요**: Android/iOS 모두. 서버는 무변경이라 심사 중 앱에는 영향 없음. 웹은 일반 배포.
- 구 앱(이미 설치된 빌드)의 feature 3건 DEAD_LETTER 는 새 앱이 설치되어 큐를 열 때 자동 보정·재시도된다.
- feature `segment_id` 는 `ordinal 0` 결정적 id(Android 는 flush 시점 EEG 현재 segment). 중간에 EEG segment 가 바뀐 회차는 서버 manifest 에서 feature↔raw 구간 연결이 근사다 — 후속 개선 후보.
- 원시 데이터 해석: `packet_endian='little'`(네이티브 파서 정본). 실기기에서 샘플 값이 웹 경로와 일치하는지 확인 필요(원문 `packets` 섹션이 보존되어 사후 재해석 가능).
- BLE 끊긴 구간은 복구 대상 아님(밴드 자체 저장소 없음). 기기 큐에 영속된 항목만 재시도.
- 웹 잔여: capture-session 정상 종료·이동 경로(`pause`/`sealOpen`)는 코드상 꼬리를 봉인함을 회귀 테스트로 고정했을 뿐, 운영 회차 ff59e5ef·3daf1332 (밴드 95·75초 중 EEG 19·10초만 저장)의 직접 원인은 이 SDD 에서 재현하지 못했다. segment 쪼개짐은 해소했으나 EEG 저장 길이 부족의 원인 확정은 실기기/로그 확인 필요.

## 실기기 확인 체크리스트
1. Android 앱 설치 후 1분 측정 → 종료. 운영/dev 서버 회차에서 `raw` EEG·PPG·ACC 청크 `verified_at` 존재, 청크 수 ≈ 6(EEG)·6(PPG)·6(ACC).
2. 같은 회차 feature 산출물 presign 200(앱 진단 `lastReason` 에 `http_422` 없음).
3. 측정 중 앱 강제 종료 → 재실행 → 이어서 업로드, 중복 alias 없음.
4. 비행기 모드로 측정 → 해제 후 큐 자동 업로드.
5. iOS 동일(1~2). 합성 데이터와 실제 밴드 값(EEG µV 범위) 비교.
6. 웹 v2 측정 후 PPG/ACC segment 수가 1~2개이고 gap 이 대량 기록되지 않는지.
