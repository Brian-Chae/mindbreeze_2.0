# SDD-270 — Verify (구현 전 QA 체크리스트)

## A. 자동 시험 (구현 후 실제 실행·수치 기록)
| # | 시나리오 | 기대 | 종류 |
|---|---|---|---|
| A1 | `GapEventStore.append` 두 번(같은 event_id) | 행 1개, sequence 불변 | Kotlin/Swift 단위 |
| A2 | sequence 단조(신호 섞어 적재) 0,1,2… 재오픈 후에도 이어짐 | 연속 | 단위 |
| A3 | `sendGapEvents` 200+recorded → sent / duplicate → sent / conflict → sent / 5xx·네트워크 → pending / 422 → rejected | 상태 전이 | MockWebServer / 가짜 HTTP |
| A4 | 토큰 없음 → 전송 시도 0회, 디스크 유지 | pending 유지 | 단위 |
| A5 | RawChunker: tick 점프 → onGap 1회(reason packet_gap, start<end), tick 되감김 → clock_reset(end null) | | 단위 |
| A6 | RawArchiver: 재연결 카운터 증가 후 롤오버 → ble_disconnect; 재개(상태 파일 있음) 첫 패킷 → process_terminated | | 단위 |
| A7 | 복구 재생이 같은 구간을 다시 먹여도 이벤트 중복 0 | event_id 동일 | 단위 |
| A8 | CloseIntent: 구멍 있으면 `last_gap_sequence`=마지막, 없으면 null·intent_id 기존과 동일 | | 단위 |
| A9 | ScopeSweeper: 구멍 대기 중이면 완료 마커 없음, 전송 후 완료 | | 단위 |
| A10 | 회귀: vitest(`sdd244-capture-session`, `sdd246-web`, `sdd264*`, `sdd266*`), backend `test_sdd244_manifest.py` | 전부 통과 | 기존 |

## B. 실기기 시나리오 (감독이 수행)
공통: dev 서버, 앱으로 클래스 측정 시작 → 시나리오 → 종료 → 업로드 완료까지 대기(상태 아이콘 완료).

| # | 시나리오 | 기대 |
|---|---|---|
| B1 | 측정 중 밴드 전원 off → 10초 → on, 1회 | `biosignal_gap_events` 에 신호별(eeg/ppg/acc) 행, reason=`ble_disconnect` 위주, start<end 가 실제 끊긴 시간대와 맞음 |
| B2 | 측정 중 와이파이 off → 20초 → on (밴드 유지) | 구멍 행 0건(밴드 데이터는 계속 들어옴 — 업로드만 지연). 지연된 raw 는 정상 업로드 |
| B3 | B1 을 와이파이 off 상태에서 수행 후 와이파이 on | 구멍 행이 와이파이 복귀 후에 생김, 누락 0 |
| B4 | 측정 중 앱 강제종료 → 재실행(측정 재개) | `process_terminated` 행 1건 이상, 중복 event_id 0 |
| B5 | 측정 중 로그아웃 → 재로그인(같은 계정) | 구멍이 로그인 후 올라옴 |
| B6 | 종료 후 `close_state` | 구멍 전부 도착 시 `complete`(또는 기존 판정), `missing_artifacts` 에 gap 없음 |

## C. 서버 확인 SQL (읽기 전용, 회차 `:sid`)
```sql
-- 1) 행·신호·사유 분포
select signal, reason, count(*) from biosignal_gap_events where session_id = :sid group by 1,2 order by 1,2;
-- 2) sequence 연속성(구멍 번호 0..N 중 빠진 것)
select s.i as missing_sequence
from generate_series(0, (select coalesce(max(sequence),-1) from biosignal_gap_events where session_id = :sid)) s(i)
left join biosignal_gap_events g on g.session_id = :sid and g.sequence = s.i
where g.id is null;
-- 3) 중복(같은 신호·시작 시각)
select signal, start_us, count(*) from biosignal_gap_events where session_id = :sid group by 1,2 having count(*) > 1;
-- 4) 시간 정합(역전·음수 길이)
select count(*) from biosignal_gap_events where session_id = :sid and end_us is not null and end_us < start_us;
-- 5) raw segment 경계와 대조(구멍 수 ≈ raw segment 수 - 신호당 1)
select signal, count(distinct segment_id) from biosignal_gap_events where session_id = :sid group by 1;
```
기대: 2)·3)·4) 모두 0행/0.
