# SDD-271 — Plan

## 트랙·파일 담당 (경로 비중복, 같은 워크트리 순차)
| 트랙 | 파일 |
|---|---|
| 서버 | `backend/app/services/gap_derivation.py`(닫기 순수 함수), `backend/app/services/data_center_gaps.py`, `backend/app/schemas/data_center.py`(`end_inferred`), `backend/tests/sdd269/*`, `backend/tests/sdd271/*` |
| Android | `archive/RawChunker.kt`(되감김 end 채움), 시험 `RawGapTest.kt` |
| iOS | `MeasurementKit/RawChunker.swift`, 시험 `GapEventTests.swift` |
| FE | `src/lib/api/data-center-measurement.ts` 타입에 `end_inferred?` 추가(필요 시) |

## Task
1. RED: sdd271 서버 시험(05ed4aa8 fixture: 신호별 end null 3행 + 창 89→90 12.65초 + 파일 간격 14.91초) 작성 → 실패 확인.
2. `gap_derivation.close_open(...)` 순수 함수 + `collect_gaps` 연결(조회 3개 유지: raw chunk 쿼리에 signal_type·segment_id 컬럼 추가).
3. `GapRange.end_inferred` 추가. `summarize`는 닫힌 구간만 합산(변경 없음, 입력이 닫혀서 옴).
4. Android·iOS RawChunker 되감김 end 채움 RED→GREEN.
5. 회귀: sdd269·manifest backend, Android `testDevDebugUnitTest`, vitest 관련, iOS `swift test`(xcframework 있으면).
6. summary 작성.

## 결정
- 서버: DB 행 불변, 읽기 시 계산(앱 재빌드 불필요·기존 회차 적용).
- 앱: (a) — 근거는 spec §4.
