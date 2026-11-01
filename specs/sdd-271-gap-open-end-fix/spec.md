# SDD-271 — 열린 구멍 닫기 보완(서버 계산·앱 종료 시각)

## 1. 배경 (11/1 dev 실측, 회차 05ed4aa8)
와이파이 1회 단절 + 밴드 off/on 뒤 `biosignal_gap_events` 4행 중 3행(eeg seq1·ppg seq2·acc seq3)이 `end_us=null`(reason=clock_reset). 같은 회차 저장 데이터는 실제 끊김을 보여 준다(창 89→90 간격 12.65초, 측정 기록 파일 segment 937eefed→0d7ba50f 간격 14.91초).
- SDD-269 서버가 `end_us=None` 기록 구간을 "끝없이 이어짐"(2**62)으로 처리 → 파생 구간이 그 앞에서 잘려 약 13~15초 끊김이 3초로 축소, 합계(`summarize`)는 end_us None 을 0 으로 더함.
- 원인은 앱: RawChunker 가 시계 되감김(`rewind`)이면 새 segment 첫 샘플 시각(`newStartUs`)을 알고 있는데도 `end_us=null` 로 보낸다(Android `RawChunker.kt:106`, iOS `RawChunker.swift:91`).

## 2. 목표
1. **서버**: end_us 없는 기록 구간을 "다음 데이터가 다시 들어온 시점"으로 닫아 계산(앱 재빌드 없이 기존 회차에도 적용). 진짜 끝없는 구간과 구분.
2. **앱**: 구멍을 만든 순간 닫는 시각을 채워 보낸다(Android·iOS).
3. (부수) reason 정확도 — 한계는 §5.

## 3. 서버 닫기 기준 (확정)
기록 구간 G(신호 s, 시작 S, `end_us=None`)의 닫는 시각 E 는 아래 **우선순위**로 첫 번째로 구한다.
| 순위 | 기준 | 근거 |
|---|---|---|
| 1 | 같은 신호 s 의 **다음 측정 기록 파일(segment) 시작**: `min(segment 시작 ms) > S` | 앱 segment 경계가 곧 구멍(SDD-270 D2). 가장 직접적 |
| 2 | 다음 분석 창의 시각(창 시간축→기록 파일 시간축 변환값): `min(창 device_ms) ≥ S` | 창은 구멍 동안 생기지 않으므로 다음 창 = 데이터 복귀 |
| 3 | 닫을 근거 없음 → `end_us=None` 유지 = **측정 종료까지 이어진 진짜 열린 구멍** | 마지막 데이터가 S 이전이면 복귀가 없었다는 뜻. 길이는 합계에서 제외(알 수 없음), 응답에 `end_inferred=false`·`end_us=null` |
- 닫힌 결과의 응답 `end_us` 는 채우고, `end_inferred=true`(서버가 추정으로 닫음)를 표시한다. 원본 DB 행은 수정하지 않는다(읽기 시 계산).
- E ≤ S 이면 닫지 않는다(역전 방지).
- 병합: 닫힌 구간을 기록 구간으로 보고 `subtract_recorded` 에 넘겨 파생과 중복을 제거. 3순위 열린 구간만 2**62(뒤쪽 파생 제거)를 유지.
- `summarize()` 합계·횟수는 닫힌 구간 기준. 파형 응답 `gaps` 에 기록 구간은 DB 원본 그대로(여기서는 파생만 가산 — 기존 계약 유지). 

## 4. 앱 방식 (확정: (a) 구멍을 닫힌 뒤에 한 번만 적재)
서버는 event_id 멱등이며 내용이 다르면 `conflict`(`biosignal_manifest_service.py:_record_gap`), `payload_hash` 비교라 같은 id 의 end_us 갱신은 불가. (b) 서버 갱신 허용은 계약·스키마·`close_state` 대조(gap 해시) 전부 건드리고, 이미 전송된 pending→sent 의 재전송 상태기계가 필요해 위험이 크다. **(a)** 채택.
- RawChunker 는 롤오버 시점에 이전 segment 마지막 샘플(`start`)과 새 segment 첫 샘플(`end`)을 둘 다 안다. 따라서 **구멍은 만들어지는 순간 이미 닫혀 있다**. 되감김(`clock_reset`)에서도 `newStartUs`(도착 시각 기반, 장치 tick 과 무관)로 `end_us` 를 채운다. `end < start`(겹침)일 때만 null — 이는 구멍이 아니다.
- 따라서 "열린 채 저장" 상태가 새로 생기지 않는다. 별도 열린-구멍 보관·종료 시 닫기 로직은 불필요(코드 추가 없음, 위험 감소).
- 강제종료 뒤 이어올림: `restartGap`(Android)·iOS 링크 이력이 첫 패킷 시각으로 `end` 를 채운다(기존). 앱이 다시 안 켜지면 구멍은 관측되지 않고 서버가 "회차 마지막 데이터 이후"를 구멍으로 보지 않는다(측정 종료로 취급).
- 기존 앱 빌드가 이미 올린 null 행은 서버 §3 이 처리한다.

## 5. reason 정확도 한계
- 롤오버 판정은 "장치 tick 되감김 / 기대 경과 어긋남" 뿐이라 BLE 끊김 원인을 알 수 없다. 재연결 카운터가 롤오버 직전에 늘었을 때만 `ble_disconnect` 로 승격(기존 SDD-270). 밴드 off/on 때 재연결 카운터가 늘기 전에 새 패킷이 오면 `clock_reset`/`packet_gap` 으로 남는다. 이번 필수 아님 — 한계로 둔다.
