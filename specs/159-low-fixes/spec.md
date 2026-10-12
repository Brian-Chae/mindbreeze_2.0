# SDD-159 — 하(하) 13건

## 배경

3차 전수조사 하(하) 13건 — 경미·상태 정합·계약 정리.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | ADMIN-02 | 위험도 임계값 불일치(백엔드 0.4 vs 프론트 0.3) |
| 2 | ADMIN-03 | pending 계정 unsuspend 시 active 강제 |
| 3 | AUD-03 | 오디오 stop_recording 멱등성 부재 |
| 4 | LIVE-04 | 발언권/토큰 세션 상태 가드 없음 |
| 5 | LIVE-05 | participant_changed 참여자 목록 누락 |
| 6 | MB2-ONB-BIRTHDATE-FUTURE | step2 미래 생년월일 허용 |
| 7 | MB2-ORG-LASTADMIN-MIRROR | 마지막 관리자 가드 미러 기준 |
| 8 | NOTIF-02 | 전체읽음 응답 키 불일치 |
| 9 | NOTIF-04 | session_updated 토글 무효 |
| 10 | PDF-NARR-001 | PDF 재스케일 경계 오류 |
| 11 | EEG-ACC-001 | ACC 샘플링 50Hz 고정 |
| 12 | EEG-SYNC-001 | 타임스탬프 재동기화 기준 오판 |
| 13 | UI-01 | 알림 설정 원시 키 노출 |

## 변경

1. 프론트 RiskBadge medium 0.3→0.4.
2. pending은 pending 유지(active 강제 금지).
3. audio stop도 recording일 때만 전이.
4. raise_hand/set_speaking/token에 완료·취소 가드.
5. participant_changed에 participants 배열 포함.
6. step2 미래 생년월일 422.
7. 마지막 관리자 판정 membership 기준 전환.
8. 전체읽음 응답 {count} 통일.
9. session_updated 키 치환 제거.
10. PDF 재스케일 조건 0<=v<1 경계 교정.
11. ACC 30Hz 통일.
12. 직전 샘플 기준 간격 계산.
13. 알림 이벤트 라벨 35개 확장 + fallback.

## 검증

- 백엔드 1094 passed (+신규 16) · 프론트 vitest 44/318 · build 0 errors
