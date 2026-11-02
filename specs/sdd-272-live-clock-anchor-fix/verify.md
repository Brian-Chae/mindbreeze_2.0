# SDD-272 — Verify (구현 전 시험 시나리오)

| # | 영역 | 시나리오 | 기대 |
|---|---|---|---|
| V1 | FE 표시 | time_uncertain + 수신 직후(경과 1s) | 값 표시, status=value, timeUncertain=true |
| V2 | FE 표시 | 경계: 경과 5000ms / 5001ms | 5000=value, 5001=delayed |
| V3 | FE 표시 | 경과 30000ms / 30001ms | 30000=delayed, 30001=stale("-") |
| V4 | FE 표시 | 수신 시각 없음(snapshot 복원) | 기존대로 "-"(time_uncertain) |
| V5 | FE 표시 | 서버 freshness가 fresh일 때 | 기존 동작 불변(회귀) |
| V6 | FE 표시 | applyEvent가 metrics.updated의 received_at_server_ms를 항목에 보관, 더 낮은 sequence는 무시 | 보관·기존 sequence 규칙 유지 |
| V7 | FE 표시 | 레거시 어댑터: time_uncertain+수신 직후 → 현재값 숫자 전달, 5분 막대 미포함(observed null) | |
| V8 | 웹 재앵커 | probe null → 2s 뒤 재시도 → 성공 | 총 2회 시도, 이후 중단 |
| V9 | 웹 재앵커 | ACK ok인데 clock_uncertain=true | 재시도 지속, 8회 후 중단 |
| V10 | Android | 앵커 null → probe ok → reanchor 없음 → 앵커 생김 → 첫 패킷 트리거로 즉시 reanchor | reanchor 1건 |
| V11 | Android | reanchor ACK rejected → 2s 뒤 새 probe(다른 probe_id) 재시도 | 새 probe_id |
| V12 | Android | 8회 연속 실패 | 이후 다음 시도는 5분 뒤, 그 사이 추가 probe 0 |
| V13 | Android | 성공 시 재시도 중단, 5분 주기 유지 | |
| V14 | Android | 새 capture.start 채택 시 카운터 리셋 | |
| V15 | 비회원 | 밴드 연결 + report 미반영 → "다음" → 시트가 `.pz-shell` 안에 있고 data-sheet-open=true | RED(현재 셸 밖) |
| V16 | 비회원 | 시트 "이번엔 제외"/"반영하기" → 다음 단계 이동 | 기존 시험 유지 |
| V17 | 회귀 | sdd246 live/ingest pytest, `freshness_of` 단위 | 변경 없음 통과 |
| V18 | iOS | swiftc -parse 구문 검사(xcframework 없어 swift test 불가 — 명시) | |
