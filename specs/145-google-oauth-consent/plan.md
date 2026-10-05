# SDD-145 — 구현 계획

## 백엔드 (2파일)

1. `schemas/auth.py` — `GoogleAuthRequest.consents: ConsentRequest | None` 추가.
2. `api/v1/auth.py` — `google_auth` 신규 계정 생성 경로에서 consents 검증(미동의/누락 422) + 항목별 동의 기록.

## 프론트 (3파일)

1. `lib/api/auth.ts` — `GoogleLoginPayload.consents` 추가.
2. `stores/authStore.ts` — `loginGoogle` 시그니처에 `consents` 파라미터 추가.
3. `pages/LoginPage.tsx` — 동의 체크박스 + 미동의 차단 + 동의값 전달.

## 테스트 갱신

- `test_sdd_c01.py` — consents 추가, "동의 없으면 422" 테스트 신규 추가, 기존 사용자 재로그인 시나리오로 교체.
- `test_sdd020_invite_client_link.py` — 구글 가입 3건 consents 추가.
- `test_remember_me_login.py` — 구글 로그인 2건 consents 추가.
