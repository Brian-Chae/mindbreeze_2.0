# Verify (구현 전 QA 체크리스트)

| # | 시나리오 | 기대 | 검증 |
|---|---|---|---|
| V1 | ACC 패킷 30샘플/1.1556s(26Hz) 10초↑ | 헤더 observed_rate≈26/1, window_us>1s, observed_rate_reason null, rate 30/1 유지 | swift RawChunkerTests |
| V2 | tick 없음/구간<1초 ACC, EEG/PPG | observed_rate null, reason not_measured | swift |
| V3 | stop 후 close intent 생성 | expected=큐 raw·feature alias/sha, streams=(stream,segment,signal) last_chunk/received_samples, last_feature_sequence=null | swift CloseIntentTests |
| V4 | 같은 큐로 재기록 | 같은 intent_id, 재생성·재전송 없음. 안드와 같은 입력이면 같은 UUID(MD5 v3) | swift |
| V5 | 큐에 raw·feature 없음 | intent 없음(nil) | swift |
| V6 | 전송: recorded/duplicate/conflict → sent, 네트워크 실패·5xx·401 → 미sent+attempt 증가, 12회 후 중단, 4xx 거절 → 닫음 | | swift (FakeHTTP) |
| V7 | 업로더: 모든 항목 verified 후 POST /sessions/{sid}/biosignal-events 본문 `{participant_id, events:[intent]}` | 1회 전송, 이후 재전송 없음 | swift |
| V8 | Manager.stopMeasurement | close-intent.json 이 디스크에 기록(소켓 응답 이전) | swift ManagerTests |
| V9 | 앱 재시작(새 store 인스턴스) | 미전송 intent 복원·participant 유지 | swift |
| V10 | 기존 swift test 전체 회귀 / 관련 vitest·tsc | green | CI |
