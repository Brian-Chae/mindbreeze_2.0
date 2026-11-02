# SDD-272 — Plan

## 파일 담당 (같은 워크트리 순차, 경로 비중복)
| 트랙 | 파일 |
|---|---|
| FE 표시 | `src/lib/session-live/{live-types,live-state,live-view,live-legacy-adapter}.ts`, `components/class/player/member/MemberClassContainer.tsx`, `tests/sdd272-*.test.ts(x)` |
| FE 웹 재앵커 | `src/lib/measurement-web/capture-controller.ts`, 시험 `tests/sdd272-*` |
| FE 비회원 다음 | `components/class/flow/member/{BandStepView,BandStepContainer}.tsx`, `pages/class/EntryPage.tsx`, 시험 `tests/sdd272-entry-sheet.test.tsx` |
| Android | `measurement/live/LiveSession.kt`, `MeasurementEngine.kt`(첫 앵커 콜백), `runtime/NativeRuntime.kt`, 시험 `LiveSessionTest.kt` |
| iOS | `MeasurementKit/MeasurementManager.swift`, `MeasurementEngine.swift`(첫 앵커 콜백) |
| 서버 | 변경 없음(회귀만: sdd246 live/ingest) |

## 재시도 정책 (세 플랫폼 동일)
- 지연열: 2s, 4s, 8s, 15s, 15s … 최대 8회. 8회 소진 시 기존 5분 주기로 복귀(5분 주기 타이머는 항상 유지).
- 성공 판정: reanchor ACK `applied|duplicate` 이고 `result.clock_uncertain==false`. 그 전까지 실패.
- 매 시도 = 새 `live:clock_probe` → ok → 앵커 확보 → 즉시 `capture.reanchor`(probe 10초 한도). 앵커 null이면 reanchor 안 보내고 다음 재시도.
- 첫 뇌파 패킷(앵커 null→non-null) 시 대기 중이면 즉시 1회.
- 새 stream(`capture.start` 채택)·재연결 READY 시 재시도 카운터 리셋.

## Task
1. RED: vitest(표시 규칙, 웹 재앵커 재시도, EntryPage 시트가 셸 안), Android(앵커 null→재시도→성공, reanchor 거절→재시도, 8회 소진→5분).
2. GREEN 구현 순서: FE 표시 → 비회원 시트 → 웹 재앵커 → Android → iOS(구문 검사).
3. 회귀: vitest 관련·tsc·eslint, pytest sdd246 live, Android `testDevDebugUnitTest`.
4. summary.
