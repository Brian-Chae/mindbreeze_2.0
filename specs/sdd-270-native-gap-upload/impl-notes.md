# SDD-270 — 구현 노트

## 결과
| 항목 | 내용 |
|---|---|
| 설계 | (B) 네이티브 내구 보관 + 네이티브 업로드. JS 전송 경로는 만들지 않음(JS 계층 변경 0 — 스냅샷 `gaps` 는 UI 진단용으로 그대로) |
| 관측 | raw segment 경계 = 구멍(`RawChunker.onGap`). 사유: tick 되감김=clock_reset, 재연결 직후=ble_disconnect, 재시작 후 첫 패킷=process_terminated(estimated), 그 외 packet_gap |
| 저장 | `gap-events.json`(세션 디렉터리, 원자적 쓰기). event_id=UUIDv3(`mb-gap|sid|signal|start_us`), sequence 세션 단조 |
| 전송 | `sendGapEvents`: 50건 배치, recorded·duplicate·conflict 닫음, 4xx 거절은 한 건씩 분할, 네트워크/5xx/401/408/429 대기 유지(영구 포기 없음) |
| 종료 기록 | `last_gap_sequence` 반영, 구멍이 있을 때만 intent_id 시드에 `|g<last>` 추가(구멍 없는 회차 id 불변) |
| 완료 판정 | Android ScopeSweeper·ArchiveWorker, iOS SessionSync 는 구멍 대기 중 완료 표식 안 씀 |
| 도착량 대조 | 변경 없음(raw·feature 만 집계, 구멍 미포함) |

## 시험 (실제 실행)
| 영역 | 결과 |
|---|---|
| Android `testDevDebugUnitTest` 전체 | 273건 통과 (신규 GapEventStoreTest 9 + RawGapTest 6 포함) |
| iOS | xcframework 부재로 `swift test` 불가. ① 전체 모듈 `swiftc -typecheck`(헤더 모듈맵 대체) 오류 0 ② `GapEventStore`·`LinkDropLog` 단독 실행 검증 9/9 ③ `RawChunker` 구멍 관측 단독 실행 3/3. `GapEventTests.swift` 는 작성했으나 XCTest 로는 미실행 |
| vitest (`sdd244-capture-session`, `sdd246-web`, `sdd244-api-contract`) | 136 통과 / 1 skipped |
| backend `test_sdd244_manifest.py` | 16 통과 |

RED→GREEN: Android 시험을 구현 전에 작성(컴파일 불가=RED) 후 구현으로 GREEN. 사이에 Gradle 환경 문제(Android Studio 캐시 잠금, 워크트리에 없는 생성 파일)를 우회.

## 계획과 달라진 점 / 한계
- iOS reason 판정은 `RawChunker` 구멍 시각 ±2초 안의 링크 이력(`link-drops.json`)으로 가린다. Android 처럼 재연결 카운터로 판정하지 않음.
- iOS 는 구멍을 **봉인(enqueueArchive) 시점**에 만든다(raw 청크도 그때 생성) → 구멍 서버 도달은 측정 종료 후. Android 는 측정 중 실시간 적재·전송.
- iOS `reconnect_count` 는 봉인 시점의 누계(구멍별 정확값 아님).
- 강제종료 시 Android 는 `raw-archive.json` 의 `last_us` 로 process_terminated 를 만든다. 상태 저장 이후 마지막 패킷 시각 정확도는 청크 봉인 주기(≤10초) 내.
- 모든 구멍 신호별(eeg/ppg/acc) 행. 한 번의 밴드 끊김 → 보통 3행(이전 사례 12 구간 대응).
- 서버 변경 없음.

## 환경 메모 (감독 참고)
워크트리에서 Android 시험을 돌리려면: `frontend/node_modules` 심볼릭 링크(메인 것), `android/capacitor-cordova-android-plugins/{build,cordova.variables}.gradle` 복사(둘 다 gitignore), `GRADLE_USER_HOME=~/.hermes/cache/gradle-sdd270`(Android Studio 가 기본 캐시를 잠금).
