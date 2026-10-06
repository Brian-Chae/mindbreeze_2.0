# SDD-164 — 하(하) 프론트 5건 (4차)

## 배경

4차 전수조사 하(하) 프론트 5건 — 타임스탬프, ACC, PPG, 라우팅, 스토어.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | TIMESYNC-001 | 타임스탬프 resync 매핑 미갱신 |
| 2 | ACC-NUM-002 | ACC signalQuality 하드코딩 0 |
| 3 | PPG-NUM-001 | SpO2 추정식 불연속·클램프 |
| 4 | ROUTE-GUARD-04 | 공통 UI 라우트 무가드 |
| 5 | STORE-07 | 로그아웃 스토어 미초기화 |

## 구현

- TIMESYNC-001: performResync masterTimeBase/deviceTimeBase 재앵커링.
- ACC-NUM-002: evaluateSignalQuality 호출 연결.
- PPG-NUM-001: SpO2 knot 선형보간 + 클램프 70.
- ROUTE-GUARD-04: 공통 UI 6개 라우트 RoleGuard 래핑.
- STORE-07: logout에서 notification/chat store reset.
