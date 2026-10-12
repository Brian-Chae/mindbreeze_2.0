# SDD-157 — 상(상) 5건 (출시 차단)

## 배경

3차 전수조사 상(상) 5건 — 회원 이탈·개인정보 유출·핵심 기능 불능.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-AUTH-RESET-LINK | 비밀번호 재설정 링크 경로 불일치(404) |
| 2 | MB2-ONB-GOOGLE-ESSENTIALS | Google 신규가입 완료 400(2차 회귀) |
| 3 | RPT-IDOR-001 | 리포트 수평 권한 상승(IDOR) |
| 4 | LIVE-01 | 상담사 준비 리마인드 100% 실패 |
| 5 | EEG-BLE-001 | BLE 재연결 리스너 누적 중복 처리 |

## 변경

1. 재설정 링크 → `/reset-password?token=`.
2. client_complete에서 `auth_provider='google'`면 step1~4 강제 면제.
3. client 리포트 소유자(participant_id.user_id) 일치 검사, 불일치 403.
4. 리마인드 허용 집합을 스냅샷 'metrics' 키에서 읽도록 수정.
5. valueChangedHandlers Map으로 리스너 보관·removeEventListener(remove-before-add).

## 검증

- 백엔드 1067 passed (+신규 5) · 프론트 vitest 44/318 · build 0 errors
