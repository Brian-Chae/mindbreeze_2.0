# SDD-300 — Verify (구현 전 작성)
| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V1 | startMeasurement 직후 | 대기 없이 feature.counts·archive.counts·reconcile.state 3건이 이 순서로 1세트 | SwiftPM |
| V2 | 2초 경과마다 | 1세트씩 추가(초당 최대 1세트), 1초 시점엔 추가 없음 | SwiftPM |
| V3 | SessionSync 스냅샷 없음 | 값이 숫자 0(null 아님), reconcile feature/raw="idle", complete=false | SwiftPM |
| V4 | emitSyncStatus 로 스냅샷 캐시 후 주기 | 캐시 값(예 pending=5)이 주기 송출에 실림 | SwiftPM |
| V5 | stopMeasurement | 마지막 값 1회 송출, 이후 시간 경과해도 송출 0 (타이머 해제) | SwiftPM |
| V6 | 같은 세션 재start(교체) | 타이머 1개만 동작(2초당 1세트) | SwiftPM |
| V7 | 이벤트 payload 키 | Android SyncEvents.payloads 와 동일 키 | SwiftPM |
| V8 | 회귀 | `tsc -b` 0, vitest 기준선 유지, swift 기존 시험 통과 | 실행 |
| V9 | 실기기 | 진단 "분석 데이터/측정 기록 파일" 값 표시 | 감독(앱 재빌드 필요) |
