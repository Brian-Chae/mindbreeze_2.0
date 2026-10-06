# SDD-158 — 중(중) 13건

## 배경

3차 전수조사 중(중) 13건 — 메일 파이프라인·상태 정합·플레이그라운드·라우팅.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | ADMIN-01 | 관리자 검토큐 상세 제출자 정보 누락 |
| 2 | MB2-CRED-TIER-DOWNGRADE | 자격증빙 반려 시 등급 미강등 |
| 3 | MB2-ORG-ROLE-REASON | 기관 역할 변경 reason 누락 422 |
| 4 | NOTIF-03/OUTBOX-001 | process_email_outbox 미등록(메일 미발송) |
| 5 | OUTBOX-002 | 발송 실패를 성공 마킹 + HTML 미전달 |
| 6 | PROGRESS-001 | 리포트 실패를 timeout 오표기 |
| 7 | EEG-MOCK-001 | 플레이그라운드 좌우뇌 균형 0점 |
| 8 | EEG-MOCK-002 | 플레이그라운드 집중/스트레스 포화 |
| 9 | EEG-SP-001 | StreamProcessor 타이머 누적 |
| 10 | LIVE-02 | 클래스 오디오 동기 회원 수신단 미배선 |
| 11 | NAV-01 | 모바일 하단 탭 하드코딩 리다이렉트 |
| 12 | NOTIF-01 | 알림 읽음 후 배지 미갱신 |

## 변경

1. 상세 응답 submitter_name/email 추가.
2. 반려 시 verified_tier 재계산(강등).
3. role 변경 reason optional.
4. process_email_outbox beat(30초) + cron 스크립트 + deploy-dev.yml 등록.
5. 반환값 확인·HTML 전달·실패 시 RuntimeError.
6. generation_error 시 report_failed(시간초과와 구분).
7~8. mock 지표 코호트 스케일 재작성(포화 해소).
9. 타이머 id 보관·clearInterval.
10. GuestMeditationPanel에서 onClassAudioSync 배선.
11. BottomTabBar role 기반 경로 동적 생성.
12. 읽음 후 전역 unread fetch().

## 검증

- 백엔드 1078 passed (+신규 11) · 프론트 vitest 44/318 · build 0 errors
