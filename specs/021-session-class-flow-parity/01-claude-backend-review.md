# Claude 백엔드·실시간데이터 리뷰 회수본 (stdout 요약)

## 핵심 사실 (코드 조사)
1. 2.0에 실시간 EEG 채널 부재 — `EEGRecord`(record.py:44-56)는 배치 저장용이고 라이브 수신 REST/WS 없음
2. 웹에 BLE/Looxid SDK 전무 — EEG 데이터 소스 자체가 미구현 (최대 리스크)
3. Socket.IO 재사용 패턴 존재 — `/record` 네임스페이스가 EEG 채널의 정확한 템플릿
4. start 시 참가자 존재 검증 없음 (session_service.py:310-333)
5. 대기→명상 자동 전이 부재 — by-code 5초 폴링 텍스트만 (class-join-page.tsx:63-85)

## 권고 요지
- 실시간 EEG 채널: `/record` 네임스페이스 패턴을 재사용해 `/session-live` 네임스페이스 신설
- 상태 매핑: 1.0 sessionLogState(READY/STARTED/COMPLETED) ↔ 2.0 session.status(ready/scheduled/in_progress/paused/completed)
- start 시 참가자 존재 검증 서버 강제
- 리스크 12개 + 결정 요청 D1~D6
