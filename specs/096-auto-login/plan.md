# [SDD-096] — Implementation Plan

**Goal:** 로그인 상태 유지(자동 로그인) — remember_me 기반 쿠키 지속/세션 분기 + secure 보정 + 프론트 체크박스.

**Architecture:**
```
[로그인] remember_me(bool, 기본 true) → 백엔드 _set_refresh_cookie(max_age=14d or None)
[새로고침/재시작] authStore.initialize → loadUser(localStorage) → refreshAccessToken(cookie) → 세션 복구
```

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/schemas/auth.py` | 로그인/회원가입/Google 요청에 `remember_me: bool = True` |
| Edit | `backend/app/api/v1/auth.py` | `_set_refresh_cookie` max_age 분기 + secure scheme 보정 + 각 로그인 경로에 remember_me 전달 |
| Edit | `backend/app/api/v1/dev_auth.py` | `_set_refresh_cookie` 호출 시그니처 갱신 |
| Edit | `frontend/src/lib/api/auth.ts` | `remember_me` 파라미터 추가 |
| Edit | `frontend/src/stores/authStore.ts` | login/loginGoogle/registerClient에 remember_me 전달 |
| Edit | `frontend/src/pages/LoginPage.tsx` | 「로그인 상태 유지」 체크박스 |
| Edit | `backend/tests/` | remember_me 세션/영속 쿠키 검증 |

## Tasks

### Task 1: BE — remember_me 파라미터 + 쿠키 분기
로그인/회원가입/Google 요청 스키마에 `remember_me: bool = True`, `_set_refresh_cookie(response, token, max_age)`로 변경 — False면 세션 쿠키(no max_age).

### Task 2: BE — secure 플래그 보정
`secure`를 `environment`가 아니라 요청 scheme 기반으로 보정(https일 때만 secure). forwarded proto 고려.

### Task 3: BE — 테스트
remember_me True → max_age 설정, False → max_age 없음, https 요청 → secure 쿠키.

### Task 4: FE — 로그인 상태 유지 체크박스
LoginPage에 체크박스(기본 체크), authStore/login API에 remember_me 전달.

## Testing Strategy
- `cd backend && venv/bin/python -m pytest` + `cd frontend && npm run build` + `npx vitest run --exclude "**/*.cjs"`.
