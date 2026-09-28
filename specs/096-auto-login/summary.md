# [SDD-096] — Summary

## What Was Built

자동 로그인(로그인 상태 유지) — remember_me 기반 refresh 쿠키 지속/세션 분기 + secure 보정.

| Layer | File | Description |
|-------|------|-------------|
| BE | `schemas/auth.py` | LoginRequest·GoogleAuthRequest·RegisterClientRequest에 `remember_me: bool = True` |
| BE | `api/v1/auth.py` | `_request_is_https`(scheme+X-Forwarded-Proto), `_set_refresh_cookie` max_age 분기·secure scheme 기반 |
| BE | `services/refresh_token_service.py` | refresh 토큰에 `remember` 클레임 → 회전 시 세션/지속 유지(구토큰 폴백 True) |
| BE | `api/v1/dev_auth.py` | 시그니처 갱신 |
| BE | `tests/test_remember_me_login.py` | 14개(True/False/미지정, https/http/XFP, 회전 유지, 구토큰 폴백, 회원가입/Google) |
| FE | `lib/api/auth.ts` | login/loginGoogle/registerClient에 remember_me 전달 |
| FE | `stores/authStore.ts` | rememberMe(기본 true) 파라미터 전달 |
| FE | `pages/LoginPage.tsx` | 「로그인 상태 유지」 체크박스(기본 체크, 접근성 label/aria) |

## Verification
- `pytest -q` → **835 passed, 12 skipped** (신규 14 포함, 회귀 0)
- `npm run build` → 0 errors
- `npx vitest run --exclude "**/*.cjs"` → **11 files / 58 tests passed**

## Key Decisions
- `remember_me=False` → 세션 쿠키(max_age 없음, 브라우저 종료 시 소멸), `True` → 14일 영속.
- secure는 `environment`가 아니라 실제 요청 scheme(https + X-Forwarded-Proto) 기반 — 로컬 http에서 쿠키 거부 방지, 운영 https 보안 유지.
- refresh 회전 시 remember 클레임으로 지속 여부 유지, 클레임 없는 구토큰은 True 폴백(기존 동작 보존).
- 회원가입(RegisterClientPage)은 별도 폼이라 기본값 true로 remember_me 전송(기존 동작 동일).
