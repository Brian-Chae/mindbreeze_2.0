# SDD-301 — Plan

## Task
1. `ManagerBootstrapPolicy`(MeasurementKit, 순수): `shouldCreate(nativeEnabled:hasManager:)`. → 시험 후 구현.
2. `MeasurementHost.ensureManager()` 를 큐 위에서 `manager == nil` 일 때만 `bootstrap` 하도록 교체 (bootstrap 도 큐 내부에서 manager 존재 시 no-op).
3. `BandLink`: init 에 `os_log` 생성 로그, `centralManagerDidUpdateState` 상태 로그.
4. `MeasurementManager.bandLink(didChange:.blocked)`: `unsupported` 는 `state=.blocked` 로 굳히지 않는다(이유 `bluetooth_unsupported` 만 기록, bandState=lost). `unauthorized` 는 현행 유지.
5. vitest: adoptBand 거절/오류 시 `releaseJsBand` 0, 확정 후 1 (sdd293 시험 보강).
6. 전체 회귀: swift test(기준 261), tsc -b, 관련 vitest.

## 위험
- `ensureManager` 가 플래그 off→on 전환 직후에도 생성돼야 함(manager nil + nativeEnabled).
- 이미 수집 중인 manager 를 덮어쓰던 기존 동작이 사라진다 = 의도.
