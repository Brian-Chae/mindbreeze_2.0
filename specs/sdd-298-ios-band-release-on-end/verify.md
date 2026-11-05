# SDD-298 — Verify (구현 전 작성)
| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V1 | ended=false→true | close('session_ended') 1회 뒤 release 1회 | vitest |
| V2 | ended 유지 재렌더 | release 추가 호출 0 | vitest |
| V3 | close 가 reject | release 는 호출되고 예외 전파 0 | vitest |
| V4 | ended→비ended→ended 재진입 | 다시 1회 허용 | vitest |
| V5 | release 미전달(기존 호출부) | 기존 동작 유지 | 기존 vitest |
| V6 | BandReleasePlan: current 있음/연결목록 비어있음 | [current] | SwiftPM |
| V7 | current nil, 연결목록 [A] | [A] | SwiftPM |
| V8 | current=A, 연결목록 [A,B] | A,B 중복 없이 | SwiftPM |
| V9 | 둘 다 비면 | [] | SwiftPM |
| V10 | 회귀 | `tsc -b` 0, 관련 vitest 통과, 신규 실패 0 | 실행 |
| V11 | 실기기 | 종료 후 GATT 해제 로그 | 감독(앱 재빌드 필요) |
