# SDD-271 — Verify (구현 전)

## A. 자동 시험
| # | 시나리오 | 기대 |
|---|---|---|
| A1 | 05ed4aa8 fixture: eeg/ppg/acc end null 3행 + eeg segment 간격 14.91초 | 3행 모두 end 채움(eeg=다음 segment 시작), `end_inferred=true`, 합계 ≥ 14초 급, 파생이 3초로 잘리지 않음 |
| A2 | 다음 segment 없음 + 다음 창 있음 | 다음 창 시각으로 닫음(창 89→90 12.65초 근거) |
| A3 | 이후 데이터 전혀 없음 | end_us=null 유지, `end_inferred=false`, 합계 제외, 파생은 그 뒤 잘림 |
| A4 | E ≤ S | 닫지 않음 |
| A5 | 닫힌 구간과 파생이 겹침 | 기록 우선, 중복 없음(1건) |
| A6 | 쿼리 수 | 3개 유지 |
| A7 | 기존 sdd269·manifest 시험 | 전부 통과 |
| A8 | Android RawChunker: 되감김 → clock_reset + end_us=새 segment 첫 샘플 시각, 겹침이면 null | 통과 |
| A9 | iOS 동일(`swift test`, xcframework 없으면 타입 검사 + 보고) | |
| A10 | vitest 관련·Android `testDevDebugUnitTest` | 통과 |

## B. 실기기 시나리오 (감독, dev 배포 후)
| # | 시나리오 | 기대 |
|---|---|---|
| B1 | 측정 중 밴드 off 10초 → on | 구멍 행에 end_us 채워짐(null 0), 길이≈끊긴 시간 |
| B2 | 와이파이 off 20초 → on | 구멍 행 변화 없음(밴드 유지), 업로드 지연만 |
| B3 | 앱 강제종료 → 재실행 | process_terminated 행 end 채워짐, 중복 0 |
| B4 | 기존 회차 05ed4aa8 데이터센터 | 앱 재빌드 없이 구멍 길이가 14초대로 표시 |

## C. 서버 확인 SQL (읽기 전용, `:sid`)
```sql
-- 1) 앱 수정 후 신규 회차: end_us null 행 0
select count(*) from biosignal_gap_events where session_id=:sid and end_us is null;
-- 2) sequence 누락
select s.i from generate_series(0,(select coalesce(max(sequence),-1) from biosignal_gap_events where session_id=:sid)) s(i)
left join biosignal_gap_events g on g.session_id=:sid and g.sequence=s.i where g.id is null;
-- 3) 중복
select signal,start_us,count(*) from biosignal_gap_events where session_id=:sid group by 1,2 having count(*)>1;
-- 4) 구멍 길이 vs 창 간격(근거)
select (end_us-start_us)/1e6 as gap_s from biosignal_gap_events where session_id=:sid and end_us is not null;
select window_index, device_timestamp_ms - lag(device_timestamp_ms) over (order by window_index) as d_ms
from eeg_feature_windows where session_id=:sid order by d_ms desc nulls last limit 3;
```
