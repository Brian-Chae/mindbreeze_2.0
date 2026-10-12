# SDD-151 — 관계·권한·정합 (7건)

## 배경

기능 오류 전수조사 중(중) 27건 중 백엔드 관계·권한·정합 7건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-CLIENT-01 | 상담사 비공개 메모 update_memo no-op + 성공 응답 |
| 2 | MB2-AUTH-03 | 본인 비밀번호 재설정 직전 3개 재사용 금지 미적용 |
| 3 | MB2-ONB-01 | step4 매칭 ended 링크 미재활성화 |
| 4 | MB2-SIGNUP-01 | 개인 상담사 반려 시 고아 계정 잔존 → 재신청 차단 |
| 5 | MB2-ORG-02 | 상담사 비번 재설정 대상 org_id 미러 사용 |
| 6 | MB2-ORG-03 | 가입신청·역할변경·소속해제 관리자 판정 org_id 미러 |
| 7 | MB2-ORG-04 | 기관 가입 신청 역할 제한 없음 |

## 변경

1. ClientCounselorLink.memo 컬럼 추가 + 실제 저장.
2. complete_reset check_password_history 422.
3. step4-match assign_counselor 위임(ended 재활성화).
4. 반려 시 pending 계정 정리 + 재신청 허용.
5~6. membership 기준으로 통일.
7. request_join counselor/org_admin만 + 승인 role='counselor' 고정.

## 검증

- 백엔드 1033 passed (+신규 7건)
