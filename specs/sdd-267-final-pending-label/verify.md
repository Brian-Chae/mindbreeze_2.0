# SDD-267 — Verify (Stage ③, 구현 전)

BE=pytest 순수/DB(sqlite), PG=임시 PostgreSQL(PG_SMOKE=1), FE=vitest/수동. 기준 시각 A=as_of, E=ended_at.

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-P01 | 4조건 모두 충족(completed, A-E=181s, 전부 received≥expected, 마지막 수신 130s 전, final=false) | `final_pending=true`, `state=in_progress` 불변 | BE |
| V-P02 | 종료 후 179초 | false | BE |
| V-P03 | 종료 후 정확히 180초 | true (≥ 경계) | BE |
| V-P04 | 회차 상태 `in_progress`(종료 전) | false | BE |
| V-P05 | `completed` 인데 `ended_at` 없음 | false | BE |
| V-P06 | 마지막 수신 119초 전 | false | BE |
| V-P07 | 마지막 수신 정확히 120초 전 | true | BE |
| V-P08 | 마지막 수신 없음 + first_reported_at 120초 이상 전 | true / 119초면 false | BE |
| V-P09 | feature 1개 부족(received=expected-1) | false (다른 3개 충족해도) | BE |
| V-P10 | eeg·ppg·acc 각각 1개 부족 | 각각 false | BE |
| V-P11 | 수신이 기대 초과 | true (≥ 충족) | BE |
| V-P12 | `final=true` + 전부 수신 | `state=all_received`, `final_pending=false` | BE |
| V-P13 | 기대량 행 없음 | false, state=expected_unknown | BE |
| V-P14 | raw 일부(ppg) 미보고(None) | false | BE |
| V-P15 | 수집 제외(`not_collected`) | false | BE |
| V-P16 | `raw_failed>0`(needs_attention) | false | BE |
| V-P17 | 종료 45분 경과 final=false, 전부 수신(state=expected_unknown) | `final_pending=true`, state=expected_unknown 불변 | BE |
| V-P18 | 판정 불변: final_pending=true 인 입력에서 SDD-264 기존 판정 표 전체 결과(state·feature/raw/total)가 SDD-267 이전과 동일 | 동일 | BE(회귀) |
| V-P19 | 합계: 참여자 3명 중 2명 final_pending | `progress.participants.final_pending=2`, `total/counted/all_received/in_progress…` 불변 | BE |
| V-P20 | 합계 불변식: `all_received+in_progress+needs_attention+expected_unknown=counted` 유지 | 유지 | BE |
| V-P21 | 상세·목록 items[]·목록 최상위·회원 목록 일관(같은 회차 final_pending 수 동일) | 동일 | BE |
| V-P22 | 회원 목록 항목: 본인 final_pending, `progress_state` 불변 | 일치 | BE |
| V-P23 | 상세 ETag: 종료 후 179→181초 사이 ETag 변화 | 변함 | BE |
| V-P24 | 상세 ETag: 기대량 보고 없는 조용한 완료 회차 | 304 유지(버킷 미포함) | BE |
| V-P25 | 응답 어디에도 점수·종합점수·보증·좋음/나쁨 필드·문구 없음, 새 키는 불리언/정수만 | 열거 단정 | BE |
| V-P26 | 기존 필드 이름·타입 불변(SDD-261~266 BE 시험 전체) | 회귀 0 | BE |
| V-P27 | PG: 독립 SQL 대조(종료 후 3분·수신 정체 회차) 응답 final_pending 일치 | 일치 | PG |
| V-P28 | 화면 문구·금지어·390px 가로 넘침 0 | FE 트랙에서 검증 | FE |
