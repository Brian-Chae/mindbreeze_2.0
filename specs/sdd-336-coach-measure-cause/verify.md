# SDD-336 — Verify (구현 전)

## Test Scenarios
- TS1 판정: 앱 1.0.0 → app_update_required / 앱 기록 없음(웹 제외) → app_update_required / 1.0.1 이상 → 다음 규칙. Expected 우선순위대로.
- TS2 거절: eeg_collection_consented=False → consent_declined 이지만 measure_not_started=False(이상 제외). 연구 동의 최신 이벤트가 declined(new_consented=false) → declined, 이후 consented 재동의 → 거절 아님.
- TS3 앱이 수업 화면에 없음: mns 대상이며 만료 안 된 presence lease 없음 → app_not_in_class, 있으면 not_started.
- TS4 live-metrics REST 응답에 `measure_issue_reason` 포함, 데이터 들어오면 null.
- TS5 푸시: 150초 이하 0건 / 초과 1건 / 같은 회원 재호출 시 간격 내 중복 0 / 5분 뒤 2번째 / 3번째 없음 / 데이터 있으면 0 / eeg 거절 0 / 푸시 알림 끔 0.
- TS6 소켓: 끊긴 sid KeyError 가 on_join 밖으로 안 나감, 방송 TimeoutError 는 트레이스 없는 경고 1줄.
- TS7 리포트: ai_record.reason=excluded → ready, mic_off/low_confidence → 기존대로 partial, stt_disabled → ready.
- TS8 웹: 원인별 라벨·안내 문구, 거절은 이상 집계 제외, 구 서버(필드 없음)는 기존 문구.

## Edge Cases
- [ ] naive 시각, 버전 문자열 `1.0.1-beta`/빈 값/`None`, 토큰 revoked 만 있는 회원
## Security Review
- [ ] 푸시 본문에 개인정보 없음, 서버는 읽기 전용 외 운영 쓰기 없음
