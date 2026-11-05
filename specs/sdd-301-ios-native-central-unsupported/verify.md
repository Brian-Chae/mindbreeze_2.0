# SDD-301 — Verify (구현 전 작성)

| # | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V1 | `ManagerBootstrapPolicy`: manager 없음+enabled | 생성 true | swift 단위 |
| V2 | manager 있음 | 생성 false (몇 번 호출해도) | swift 단위 |
| V3 | enabled=false | 생성 false | swift 단위 |
| V4 | Manager 에 `.blocked`+`bluetooth_unsupported` 전달 (IDLE) | `state` 가 BLOCKED 로 굳지 않음, `blockedReason` 은 기록, 이후 hold/start 가능 | swift ManagerTests |
| V5 | `.blocked`+`bluetooth_unauthorized` | 현행대로 BLOCKED + bluetooth_permission | swift |
| V6 | `.unsupported` 직후 startMeasurement → band.connect 호출됨 | connects==1 | swift |
| V7 | JS: adoptBand accepted=false / 예외 | `releaseJsBand` 0회, held=false | vitest |
| V8 | JS: accepted=true | `releaseJsBand` 1회, adopt 뒤 | vitest |
| V9 | 회귀 | swift 261 유지+신규, tsc -b 0, 관련 vitest 통과 | 실행 |
| V10 | (감독) 실기기: 로그에 `BandBLE 생성` 이 앱 시작 1회만, `unsupported` 없음 | 다음 빌드에서 확인 | 확인 못 함(빌드 금지) |
