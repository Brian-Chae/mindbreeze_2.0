# SDD-161 — 중(중) 백엔드 19건 (4차)

## 배경

4차 전수조사 중(중) 백엔드 19건 — 권한·인가 누락, 동시성·트랜잭션, WS 계약, 비동기 파이프라인.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | AUTH4-01 | 상담사 온보딩 role 가드 부재 |
| 2 | AUTH4-02 | change_counselor 전역/멤버십 role 혼동 |
| 3 | AUTH4-03 | 상담사 코드 입력 미정규화 |
| 4 | AUTH4-04 | verified_tier·org 미검사 |
| 5 | AUTH4-05 | 관리자 기관 조회 org_id 미러 |
| 6 | AUTH4-06 | delete_user 자식 cascade 누락 |
| 7 | AUTHZ-PARTICIPANT-PII | 세션 상세 타인 PII 노출 |
| 8 | CHAT-WS-MESSAGE-SPOOF | 채팅 WS 메시지 위조 |
| 9 | WS-CONTRACT-DEVICE-VERSION | device_status version 누락 |
| 10 | WS-SNAPSHOT-METRICS-KEY | join 스냅샷 키 불일치 |
| 11 | WS-JOIN-HOST-EXCEPTION | on_join 예외 미포착 |
| 12 | RPT-EMAIL-CONTRACT-004 | 재발송 계약 불일치 |
| 13 | CONC-DUP-JOIN-INVITE | 중복 입장 race 500 |
| 14 | CONC-CAPACITY-RACE | 정원 race |
| 15 | CHAT-DIRECT-ROOM-RACE | 채팅방 개설 race |
| 16 | OUTBOX-DUP-003 | outbox 이중 소비 |
| 17 | RPT-REGEN-005 | 재생성 승인 소실 |
| 18 | ADM-STATE-01 | 검토 상태 가드 |
| 19 | VIDEO-EXPECTED-COUNT-DOS | expected_count OOM |
