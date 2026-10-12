# SDD-163 — 하(하) 백엔드 16건 (4차)

## 배경

4차 전수조사 하(하) 백엔드 16건 — 입력 검증, 상태 가드, 계약 정합, 성능, 수치 정확성.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | AUTH4-07 | org_id UUID 파싱 무방비(500) |
| 2 | AUTH4-08 | 비활성 기관 역할 변경 허용 |
| 3 | AUTH4-09 | ended 링크 재활성화 ended_at 미초기화 |
| 4 | AUTH4-10 | 공개 페이지 org_id 미러 |
| 5 | STATE-SWEEP-TOCTOU | 스윕 조회~전이 TOCTOU |
| 6 | CONTRACT-GUEST-CHAT-ROOM-ID | 게스트 join chat_room_id 누락 |
| 7 | AUTHZ-WAITLIST-SPEAKING | 대기열 발언권 제한 누락 |
| 8 | DASH-WAITLIST-006 | 대시보드 대기자 포함 집계 |
| 9 | EXPORT-LOCK-007 | 내보내기 GET 잠금 |
| 10 | EEG-COVERAGE-008 | coverage 정의 불일치 |
| 11 | RPT-NPLUS1-009 | client_comments N+1 |
| 12 | ADM-STATE-02 | pending 정지·해제 우회 |
| 13 | AUTHZ-05 | client 포털 role 제한 |
| 14 | WS-AUTHZ-06 | Socket.IO 토큰 타입·상태 |
| 15 | NOTIF-CONF-08 | 알림 설정 화이트리스트 |
| 16 | CONTRACT-09 | 관리자 API 계약 |
