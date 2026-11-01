# SDD-270 — Plan

## 1. 설계 결정

### D1. 전송 주체: (B) 네이티브 내구 보관 + 네이티브 업로드 — 채택
| 안 | 평가 |
|---|---|
| (A) JS 가 `measurementUpdated` 의 gaps 를 받아 `events` 로 전송 | 구현 단순하나 JS 는 WebView 가 살아 있을 때만 동작. 앱 강제종료·백그라운드·로그아웃 중 만든 구멍이 유실되고, 스냅샷 `gaps` 는 iOS 에서 UUID 를 매번 새로 만든다(`MeasurementManager.swift:702`) → 재전송 시 중복. **기각** |
| (B) 네이티브가 내구 저장소에 적재 후 기존 업로드 경로로 전송 | 원시 업로드(ArchiveQueue)·종료기록(CloseIntentStore)과 같은 경로(`drainArchive`/`ArchiveWorker`/`ScopeSweeper`/iOS `SessionSync`)를 재사용 → 강제종료·오프라인·로그아웃에서도 이어올림. **채택** |

근거: 구멍은 "측정이 끊긴 순간"에 생기므로 WebView 의존이 가장 약한 순간이다. 원시·종료기록이 이미 네이티브 단독으로 올라가는 구조라, 구멍만 JS 에 맡기면 같은 회차 안에서 신뢰 수준이 갈린다.

### D2. 구멍 관측 지점 = raw segment 경계 (단일 정의)
웹은 `clock 사유로 segment 가 바뀌면 gap` (capture-session.ts:194). 네이티브도 동일 규칙을 쓴다.
- `RawChunker` 의 segment 롤오버(= 장치 tick 되감김 또는 기대 경과와 허용오차 이상 어긋남)가 곧 구멍이다. 이 규칙은 이미 raw 청크 분할 기준이라 **구멍 행 ↔ raw segment 경계가 1:1** 로 맞는다(서버가 둘을 대조 가능).
- 구멍 한 건 = (신호별) 이전 segment 의 마지막 샘플 시각 `start_us` ~ 새 segment 첫 샘플 시각 `end_us`. 축은 raw 청크 anchor 와 같은 창 시간축(µs, UTC).
- 신호(eeg/ppg/acc)별로 각각 센다(서버 `signal` 필드, 웹과 동일).

### D3. 이벤트 매핑 (`GapEventIn`)
| 필드 | 값 |
|---|---|
| `event_id` | 결정적 UUID v3: `mb-gap|sid|signal|start_us` — 복구 재생·재시도에서 같은 구멍이 같은 id → 서버 `duplicate` |
| `sequence` | 세션 단위 단조 0,1,2…(신호 공통). 저장소가 최초 적재 시 부여·영속. 같은 event_id 재적재는 무시 |
| `discovered_at_us` | 적재 시각 UTC µs |
| `signal`, `stream_id`, `segment_id` | 신호, `RawIds.streamId`, **이전** segment id (웹과 동일) |
| `start_us`, `end_us` | D2. 역전(시계 되감김)이면 `end_us=null`, reason=`clock_reset` |
| `reason` | `clock_reset`(tick 되감김) · `ble_disconnect`(롤오버 직전 재연결 카운터 증가 / iOS 는 링크 이력과 겹침) · `process_terminated`(앱 종료 후 이어쓰기) · 그 외 `packet_gap` |
| `observed_or_estimated` | `observed` (경계 두 점을 모두 관측). 시작 시각을 모르면 `unknown`+expected null |
| `expected_samples`, `received_samples` | `null` (웹과 동일 — 손실량은 모르므로 0 으로 쓰지 않는다) |
| `reconnect_count` | 그 시점 재연결 누계 |

모르는 reason 은 `unknown` (서버 enum 안).

### D4. 저장·전송
- `gap-events.json`(세션 디렉터리, 임시파일→fsync→rename 원자적, Android·iOS 동일 형식): `{next_sequence, events:[{…GapEventIn, status:pending|sent|rejected, attempts}]}`.
- 전송: `ArchiveUploader.sendGapEvents` — 대기 이벤트를 sequence 순 최대 50건씩 `POST biosignal-events`. 응답 항목별 `recorded|duplicate|conflict` → sent(conflict 는 같은 id 다른 내용이라 재전송이 무의미 → sent 처리·진단 로그). 네트워크/5xx/401/408/429 → 대기 유지, 4xx 나머지(검증 거절) → `rejected`(재시도 무의미, 격리).
- 호출 위치(종료기록과 동일): Android `NativeRuntime.drainArchive`, `ArchiveWorker/NativeArchiveOnly`, `ScopeSweeper.drainArchive`; iOS `ArchiveUploader.pump`(종료기록 앞).
- 로그아웃/토큰 없음: 보내지 않고 디스크 보관 → 같은 계정 로그인 후 스윕이 이어올림(다른 계정 scope 는 기존 규칙대로 보존만).
- 상한: 세션당 2,000건(폭주 방지). 초과분은 마지막 한 건에 `reason=unknown` 이어붙이지 않고 로그만 — 실측상 회차당 수십 건이라 도달 불가에 가깝다.

### D5. 종료 기록과의 정합
- `CloseIntent.last_gap_sequence` = 저장소의 마지막 sequence(없으면 null). 서버가 0..last 연속 도착을 대조해 구멍이 새면 complete 가 아니게 된다 = "유실 없이"의 서버측 검증.
- intent_id 시드는 구멍이 있을 때만 `|g<last>` 를 덧붙인다(구멍 없는 회차는 기존 id·기존 시험 불변).
- 구멍 전송을 close intent 전송 **앞**에 둔다. 구멍이 대기 중이면 ScopeSweeper 는 완료 마커를 쓰지 않는다.
- expected-reporter(도착량 대조)는 raw·feature 만 센다 — 구멍 변경 없음(가산 아님, 무영향).

### D6. iOS 차이
iOS 는 raw 청크를 봉인(`enqueueArchive`) 시점에 journal 에서 일괄 생성한다. 같은 `RawChunker` 롤오버 콜백으로 구멍을 만들고 봉인 직후 저장소에 적재한다(재실행해도 event_id 동일 → 무시). reason 판정용으로 링크 이력(`link-events.json`: 재연결 시작/끝, 앱 종료 복구 시각)을 같은 시간축(µs)으로 남긴다.

## 2. 트랙·파일 담당 (순차 구현, 같은 워크트리)

| Task | 내용 | 파일 |
|---|---|---|
| T1 | Android `GapEventStore` + `ArchiveUploader.sendGapEvents` (RED→GREEN) | `archive/GapEventStore.kt`, `archive/ArchiveUploader.kt`, test `GapEventStoreTest.kt`, `ArchiveUploaderTest.kt` |
| T2 | Android 구멍 관측: `RawChunker.onGap`, `RawArchiver` 연결(상태 `end_us` 영속, 재연결 카운터 주입, process_terminated 시드) | `archive/RawChunker.kt`, `archive/RawArchiver.kt`, test `RawChunkerTest.kt`, `RawArchiverGapTest.kt` |
| T3 | Android 배선: `NativeRuntime`(적재·drain·stop), `ArchiveWorker`/`NativeArchiveOnly`, `ScopeSweeper`, `CloseIntentStore.last_gap_sequence` | `runtime/*.kt`, `archive/CloseIntentStore.kt`, `MeasurementService.kt` |
| T4 | iOS `GapEventStore`, `RawChunker.onGap`, 업로더 전송, Manager 적재·링크이력, SessionSync 완료 판정, CloseIntent | `MeasurementKit/*.swift`, Tests |
| T5 | JS: 네이티브 `Gap.kind` 에 `process_terminated` 계열 정렬 불필요 확인(스냅샷 gaps 는 UI 진단용 유지). 회귀: vitest(biosignal/native-measurement), backend manifest 시험 | — |
| T6 | impl-notes·summary, 실기기 절차 검증 | 문서 |

## 3. 위험·미해결
- 재생(replay) 시 시간축이 원 실행과 어긋나면 같은 구멍이 다른 start_us 로 두 번 들어갈 수 있다 → 서버엔 별개 행(중복 0 기준은 event_id 기준). verify 에서 강제종료 시나리오로 실측.
- 서버 스키마 변경 불필요(`GapEventIn` 그대로).
