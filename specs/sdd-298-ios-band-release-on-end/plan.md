# SDD-298 — Plan
1. `BandReleasePlan.targets(current:connected:)` 순수 함수(BandBLE.swift) — 취소 대상 UUID 집합(중복 제거). `BandLink.disconnect()` 가 사용, `retrieveConnectedPeripherals(withServices:[eegService])` 로 보강. `Logger` 로 해제 로그(ID 제외, 개수만).
2. `useCloseBiosignalOnEnd(ended, close, release?)` — close settle 후 release 1회 호출. `MemberClassContainer` 에서 `band.disconnect` 전달(재종료 시 재허용은 기존 규칙 그대로).
3. 시험: vitest(훅 release 1회·close 실패해도 호출·ended 아님 미호출), SwiftPM 순수 로직.
