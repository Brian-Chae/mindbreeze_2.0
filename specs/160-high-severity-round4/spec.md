# SDD-160 — 상(상) 5건 (4차)

## 배경

4차 전수조사 상(상) 5건 — 개인정보 유출·발언권 우회·메일 미발송·지표 오류·메모리 누수.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | REC-PRIV-001 | 기록지 개인정보 유출 |
| 2 | SEC-LIVEKIT-PUBLISH-BYPASS | LiveKit 발언권 우회 |
| 3 | RPT-EMAIL-SEND-002 | 리포트 메일 자동 발송 끊김 |
| 4 | EEG-NUM-001 | 인지부하 점수 0 고정 |
| 5 | STREAM-LIFE-001 | 재연결 StreamProcessor 누수 |

## 구현

- REC-PRIV-001: record_service `_serialize` include_internal 플래그, get_record/get_transcript가 비host에게 내부 메모·전사·AI 요약 제외.
- SEC-LIVEKIT-PUBLISH-BYPASS: livekit-token을 host 전용으로 제한.
- RPT-EMAIL-SEND-002: approve_report에서 completed 전이 시 메일 재예약.
- EEG-NUM-001: cognitiveLoad를 θ/α 비율로 교정(절대 파워 오입력 제거).
- STREAM-LIFE-001: connect()에서 이전 stream cleanup.
