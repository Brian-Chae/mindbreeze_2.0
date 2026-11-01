# SDD-266 — Plan

| Task | 내용 | 변경 | 시험 |
|---|---|---|---|
| T1 | 재현(RED): prev{87,8/8/7,false}+next{87,1/1/1,true} → final 이 false 가 되는 것, 종료 이벤트 없이 스윕 complete 만 오는 시나리오 | `tests/sdd266/` | vitest RED |
| T2 | `mergeReport`: lagging 이어도 final 은 `prev.final \|\| next.final`(병합 총량은 max 라 서버 규칙 ① 비해당). 보내는 값은 항상 병합 max | `expected-reporter.ts` | vitest GREEN |
| T3 | 종료 신호 보강: `NativeMeasurement.stop()` 가 stop 응답(SEALING)을 받으면 구독 콜백에 합성 `measurementUpdated{sessionId,state:'SEALING'}` 를 1회 전달(Android·iOS 공통 JS 경로 = payload 동일). 네이티브 emit 변경 안 함(가드 변경은 이벤트 순서·seq 규약 위험이 큼) | `native-measurement/index.ts` | vitest |
| T4 | Android `ArchiveQueue.load()`: payload 없는 항목도 `VERIFIED` 면 로드(총량 보존). iOS 는 코드 확인 + 기존 시험 | `ArchiveQueue.kt`, Kotlin 단위 시험 | gradle |
| T5 | 회귀(sdd260-web/246-web/264-report/264/265, `tsc -b`, eslint)·impl-notes(서버 완화안 제안 포함) | 문서 | 전체 |
