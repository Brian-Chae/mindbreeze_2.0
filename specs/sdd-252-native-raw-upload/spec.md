# SDD-252 — 앱 네이티브 원시 뇌파 업로드·분석 결과 거절 수정

- 상태: Stage ①~③ 완료(대표 승인 2026-10-28, 단계별 승인 불필요)
- 브랜치: `sdd/252-native-raw-upload`
- 작성일: 2026-10-28

## Goal
앱(Android/iOS) 네이티브 측정이 웹 v2(`capture-session.ts`)와 같은 서버 계약으로 원시 EEG(250Hz)·PPG·ACC 청크를 올리고(presign→PUT→ack, `verified_at`), feature 산출물 메타가 서버 규칙을 통과하게 한다.

## Context — 확정 원인 (코드 근거)
| # | 원인 | 근거 |
|---|---|---|
| 1 | Android 는 `kind=raw` 를 한 번도 enqueue 하지 않는다. 운영 회차 28104531(vc23) 원시 0건 | `ArchiveFeeder.kt` 는 feature 만 enqueue, `NativeRuntime.kt:50-54` frameSink 는 feeder 에만 연결, `raw.journal` 은 로컬 복구용 |
| 2 | feature 메타의 `signal`·`segment_id` 가 null → 서버 `_validate_scope` 422 → 앱이 422 를 DEAD_LETTER 로 영구 폐기(운영 1분마다 1건) | `ArchiveFeeder.kt:42`, `biosignal_artifact_service.py:_validate_scope`, `ArchiveClassifier.kt` 400/422→QUARANTINE |
| 3 | 4xx 사유(서버 `detail` 문자열)가 버려져 진단 불가 | `ArchiveUploader.postJson` StageError 에 msg 없음 |
| 4 | iOS 는 더 나쁘다: `enqueueArchive` 가 `raw.journal`/`feature.journal` **통파일**을 그대로 큐에 넣고 presign 본문에 `header`/`schema_version`/`row_count`/`sequence` 등 서버 필수 필드가 전혀 없다 → 항상 422 | `MeasurementManager.swift:237-251`, `Archive.swift:199 presignBody` |
| 5 | (웹) PPG/ACC 는 tick 갱신 간격이 불규칙해 `packet_gap` 판정(허용오차 2샘플)이 패킷마다 걸려 segment 가 패킷 단위로 쪼개지고 gap 이 대량 기록 | `capture-session.ts:147-153,192-203` |

## Scope
### In
- Android: 원시 청크 생성기(MBRAW002, raw-v2 계약) + 큐 연결 + feature 메타 `signal/segment_id/stream_id` 채움 + 4xx 사유 보존 + 기존 DEAD_LETTER feature 항목 복구(메타 보정 후 재시도).
- iOS: 같은 수준의 원시 청크 생성기·feature 메타(구조 재작성). 단위 테스트 가능 범위까지.
- 웹: PPG/ACC segment 분할 과다(허용오차) 수정, 종료·이동 시 꼬리 청크 봉인 경로 점검·보강.
- 서버: 가산·완화만. 필요 없으면 변경 없음(계약 테스트만 추가). DB 마이그레이션 없음.
- 서버 계약 테스트: 네이티브가 만든 raw/feature presign 본문이 200 을 받는지.

### Out
- BLE 끊김 구간 복구(밴드 자체 저장소 없음 → 복구 대상 아님). 기기 큐에 영속화된 데이터의 재시도·복구만 보장.
- TNA 기준값(OUTLIER_TNA_LIMIT 등) — 다른 워커 담당, 건드리지 않음.
- 앱 빌드·설치·스토어 제출, 머지·배포.

## 설계 결정 (사용자 결정 불필요한 기술 사항)
- D1. `parser_profile.platform='native-candidate'`, `verification='unverified'`, `packet_endian='little'`(네이티브 파서 정본은 세 센서 모두 uint32 LE — 웹 프로필은 PPG 만 BE 라 `mixed`). 서버 스키마가 이미 허용 → 서버 수정 불필요. 원문 바이트는 `packets` 섹션에 그대로 보존되므로 해석 차이는 사후 재해석 가능.
- D2. stream/segment id 는 `UUID.nameUUIDFromBytes(sessionId|signal|…)` 로 결정적. 프로세스 재생성 시 `raw.journal` 재생으로 같은 alias 가 재생성되고 큐가 alias 로 멱등 처리 → 중복 업로드 없음.
- D3. 시간축은 코어 창과 같은 "창 시간축 µs"(`windowTimelineUs`)로 `anchor.monotonic_us`·`monotonic_range` 를 채운다(서버 `raw_window_mono` 가 서버시계로 환산하는 축과 일치).
- D4. 청크 경계: 10초 분량 샘플 / 900,000B 중 먼저 / segment 전환 / 정지 flush. 상한 1MiB 이하 보장.
- D5. feature `stream_id`=EEG raw stream id, `signal='eeg'`, `segment_id`=창 시작 시점의 EEG segment id(없으면 ordinal 0 결정적 id).

## Acceptance Criteria
- [ ] Android: 합성 패킷을 `RawChunker` 에 넣으면 서버 `RawHeader` 검증을 통과하는 청크가 큐에 enqueue 된다(EEG/PPG/ACC).
- [ ] Android: feature 메타가 `signal/segment_id/stream_id` 를 가지며 서버 presign 200.
- [ ] 서버 pytest: 네이티브 fixture 로 raw presign·ack, feature presign 이 200.
- [ ] 4xx 사유가 큐 항목 `lastReason` 에 남는다.
- [ ] 기존 DEAD_LETTER feature(메타 null) 항목이 앱 시작 시 보정되어 PENDING 으로 복귀.
- [ ] iOS: 원시/feature 메타가 서버 필수 필드를 채움(단위 테스트).
- [ ] 웹: PPG/ACC 정상 간격 패킷이 segment 를 쪼개지 않음(vitest). 기존 실패 8파일 17건 기준선 대비 신규 0, tsc 통과.

## Risks
- 실기기 미검증: 네이티브 파서 tick 엔디안(LE) 가정 → D1 로 원문 보존. 체크리스트에 실기기 확인 포함.
- 앱 재빌드 필요(Android/iOS 코드 변경). 서버는 무변경 → 심사 중 앱 영향 없음.
- 저장 용량 증가(원시 ≈ 12KB/s). 큐는 verify 후 payload GC.
