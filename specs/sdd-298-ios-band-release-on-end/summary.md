# SDD-298 — Summary
- 원인: D1(JS 경로 ended 시 disconnect 미호출, 확정) / D2(네이티브 BandLink.disconnect 가 peripheral nil 이면 취소 누락 가능).
- 수정: `useCloseBiosignalOnEnd` 3번째 인자 release(close 성공·실패 무관 1회) → `band.disconnect` 연결. `BandLink.disconnect()` 가 `BandReleasePlan.targets` 로 retrieveConnectedPeripherals 보강, `wantConnected=false` 유지, os_log(개수만).
- 시험: vitest 훅 5/5, 관련 8파일 51/52(실패 1건 `measure-guard-null-display` 는 HEAD 기준 선재 실패), `tsc -b` 0, 순수 로직 swiftc 단독 실행 OK, `swiftc -parse BandBLE.swift` OK. `swift test` 는 xcframework 부재로 불가.
- 미확인: 실기기 해제 로그(앱 재빌드 필요), D3(willRestoreState 가 wantConnected=true 복원 — 293 인접, 미수정).
- 충돌 가능: BandBLE.swift 의 `disconnect()` 본문만 수정(293 이 같은 파일 건드리면 병합 주의).
