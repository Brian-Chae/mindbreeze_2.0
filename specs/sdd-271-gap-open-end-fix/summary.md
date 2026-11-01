# SDD-271 — Summary

## 구현
- 서버: `gap_derivation.close_open` + `data_center_gaps.collect_gaps` — end_us 없는 기록 구간을 같은 신호의 다음 segment 시작 → 다음 분석 창 순으로 닫음(`end_inferred=true`). 근거 없으면 열린 채(합계 제외). DB 행 불변, 쿼리 3개 유지.
- 앱: Android/iOS `RawChunker` 되감김(`clock_reset`)에서도 새 segment 첫 샘플 시각을 end 로 채움(겹침일 때만 null). 구멍이 만들어지는 순간 닫혀 있어 (a)안, 별도 열린-구멍 보관 코드 불필요.

## 테스트 (실제 실행)
- backend: sdd269+sdd271+manifest+measurements 55 passed. 신규 sdd271 4건은 구현 제외 시 3 failed(RED) 확인.
- Android `testDevDebugUnitTest` 274 tests, 실패 0 (RawGapTest 7건 포함).
- vitest(capture-session·ble-gap-log·api-contract) 25 passed.
- iOS: xcframework 없어 `swift test` 불가. 변경 줄 타입 검사만(스텁 한계로 `Hashing` 외 오류 없음).

## 한계
- reason 정확도(`ble_disconnect` 승격)는 개선하지 않음(spec §5).
- 앱이 다시 켜지지 않은 강제종료 구멍은 관측 불가(서버는 측정 종료로 취급).
