# SDD-166 — 중(중) 코드 13건 (5차)

## 배경

5차 전수조사 중(중) 코드 계열 13건 — STT 비용·화자분리, 이메일 XSS, PDF 서사, EEG 정합.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | STT-5TH-01 | Gemini 실패 예외 미구분 전체 Whisper 재전사 |
| 2 | STT-5TH-02 | OPENAI_API_KEY os.environ 직접 읽기 |
| 3 | STT-5TH-03 | Whisper 폴백 화자분리 소실 |
| 4 | STT-5TH-04 | autoretry 부재 |
| 5 | EMAIL-XSS-003 | 이메일 HTML 이스케이프 없음 |
| 6 | PDF-METRIC-002 | emotional_stability 불연속 |
| 7 | PDF-NARR-001 | 하락 세션 모순 서사 |
| 8 | VIEW-HTTP-004 | report/view 보안 헤더 부재 |
| 9 | VID-5TH-09 | 영상 병합 예외 삼킴 |
| 10 | EEG-QRY-02 | group_aggregate N+1 |
| 11 | EEG-RAW-03 | 부분 업로드 고아 방치 |
| 12 | EEG-RET-01 | EEG 보관 정책 부재 |
| 13 | EEG-RUP-01/02 | rollup play_group_id·coverage 왜곡 |
