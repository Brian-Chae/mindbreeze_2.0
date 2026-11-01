# SDD-266 — 구현 노트

## 1. 재현 → 수정 (RED → GREEN)
| 경로 | RED(수정 전) | 수정 |
|---|---|---|
| 스윕 부분합 lagging | prev{87,8/8/7,false}+next{87,1/1/1,true} → merged.final=false (V-F01, V-F03 실패 확인) | `mergeReport`: raw·feature 는 필드별 max, **final = prev.final OR next.final**. 보내는 값이 항상 병합 최댓값이라 서버 규칙 ①(뒤처진 값이면 final 무시)에 걸리지 않는다 |
| 종료 이벤트 미수신 | 네이티브 `measurementUpdated` 에 SEALING 이 없으면 `markEnding` 미발동 | `NativeMeasurementFacade.stop()` 이 stop 응답(accepted/seal_started/SEALING)을 받으면 `subscribeUploadEvents` 구독자에게 `measurementUpdated {sessionId, state:'SEALING'}` 를 합성 전달 → hub `markEnding` → 즉시 final=true |
| 꼬리만 센 큐 (원인 C3) | `ArchiveQueue.load()` 가 payload 없는 항목을 건너뜀 + `gcVerified()` 가 verified payload 삭제 → 재기동·스윕 큐 `signalCounts()` 가 부분 합 | payload 가 없어도 `VERIFIED` 항목은 로드(총량 보존). 그 외 상태는 기존처럼 건너뜀. alias 중복 방지는 유지 |

## 2. 택한 방식과 근거 (종료 신호)
- 택일: 네이티브 emit 변경(foreground·runtime 가드 완화) vs JS stop 응답 합성. **JS 합성 선택.** Android·iOS 가 같은 JS 경로를 타 payload 가 동일하고, 네이티브 이벤트 seq/순서 규약을 건드리지 않는다. 네이티브가 나중에 SEALING 을 또 내도 hub 는 멱등(V-F08).
- 한계: 앱이 stop 호출 없이 죽거나 서버/호스트가 종료시키는 경로는 이 합성이 안 탄다 → 그 경우는 스윕 `reconcile.complete`(OR 병합)가 final 을 낸다.
- **"종료 직후 로컬 아카이브 재집계" 별도 경로는 만들지 않았다**: C3 교정으로 스윕 세대의 `archive.counts.signals` 가 세션 전체 총량을 내므로, 마지막 청크(+1)는 기존 이벤트 흐름(`archive.counts`)으로 기대량에 반영된다. 실기기 확인 필요.

## 3. 계획과 달라진 점
- 스윕 값을 "로컬 영속 총량에 가산"하는 방식은 쓰지 않았다: max 병합 + 큐 로드 교정이 더 단순하고 단조 규칙과 맞는다.
- 기존 시험 `expected-reporter.test.ts` 의 "뒤처진 보고의 final 은 무시한다(서버 규칙 ①)" 는 의도가 바뀌어 새 규칙으로 교체.

## 4. 서버 완화안 제안 (대표 결정 사항, 이번 범위 밖·미구현)
서버가 final=false 로 영원히 막는 한계(30분 뒤 `expected_unknown`)의 완화 후보:
1. 종료 후 N분 경과 + `received ≥ expected` + 최근 120초 수신 변화 없음 → `all_received` 대신 '모두 도착(최종 확인 대기)' 보조 표기(화면 문구만, 점수·보증 아님).
2. 종료 후 `received ≥ expected` 가 N분 유지되면 `final=false` 라도 `all_received` 로 승격(오탐: 종료 후 더 만들 청크가 있는 경우 → 이후 expected 증가 시 다시 in_progress).
3. 30분 `expected_unknown` 전환 전에 '폰 확인 대기' 상태 신설.
권고안 없음 — 선택은 대표 결정.

## 5. 시험 실측
| 영역 | 명령 | 결과 |
|---|---|---|
| JS 신규 | `vitest run tests/sdd266` | 14 통과 (RED 시 7 실패 → GREEN) |
| JS 회귀 | `vitest run tests/sdd260-web sdd246-web sdd264-report sdd264 sdd265 sdd266 sdd246-archive` | 29 파일 통과·1 skip, 284 통과 |
| 타입/린트 | `tsc -b`, eslint(변경 파일) | 오류 0 |
| Android | `./gradlew --offline testDevDebugUnitTest` | 258 통과·실패 0 (신규 3, 수정 전 코드에서 2 실패 확인) |
| iOS | `swift test` | **미실행** — `MeasurementCoreFFI.xcframework` 바이너리 없음(gitignore). iOS 코드는 변경 없음 |
