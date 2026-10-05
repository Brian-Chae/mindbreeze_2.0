# SDD-145 — Google OAuth 약관·민감정보 동의 요약

## 구현 결과

| 층 | 변경 | 파일 |
|---|---|---|
| 백엔드 | `GoogleAuthRequest.consents` 추가, 신규 가입 시 미동의 422 + 항목별 동의 기록 | `schemas/auth.py`, `api/v1/auth.py` |
| 프론트 | Google 로그인 동의 체크박스 + 미동의 차단 + 동의값 전달 | `lib/api/auth.ts`, `stores/authStore.ts`, `pages/LoginPage.tsx` |
| 테스트 | consents 반영 + "동의 없으면 422" 신규 + 기존 사용자 재로그인 교체 | `test_sdd_c01.py`, `test_sdd020_invite_client_link.py`, `test_remember_me_login.py` |

## 검증

- 백엔드 `pytest -q` **1010 passed / 12 skipped / 0 failed**
- 프론트 `npx vitest run` **44 files / 318 tests**
- 프론트 `npm run build` **0 errors**

## 배포

- 커밋 후 GitHub Actions Deploy Dev 성공, dev 3유닛 active, dev 웹 200 확인.
