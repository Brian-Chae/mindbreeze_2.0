# [SDD-096] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: remember_me=True → 영속 쿠키
1. `remember_me=true`로 로그인.
- **Expected:** refresh 쿠키에 `Max-Age`(14일) 설정.

### TS2: remember_me=False → 세션 쿠키
1. `remember_me=false`로 로그인.
- **Expected:** refresh 쿠키에 `Max-Age` 없음(브라우저 종료 시 소멸).

### TS3: 새로고침/재시작 세션 복구
1. remember_me=true로 로그인 → 페이지 새로고침.
- **Expected:** 재로그인 없이 세션 유지(access token 자동 재적재).

### TS4: secure 플래그
1. https 요청 → refresh 쿠키에 `Secure` 플래그.
2. http(로컬) 요청 → `Secure` 미설정(쿠키 거부 없음).

### TS5: 빌드/테스트
- `pytest` 통과, `npm run build` 0 errors, `npx vitest run` 통과.

## Edge Cases
- [ ] remember_me 미전달 시 기본 True(기존 동작 유지).
- [ ] Google 로그인도 remember_me 적용.
- [ ] refresh 쿠키 path(`/api/v1/auth`) 정합 유지.

## Security Review
- [ ] `secure`는 https에서만 True(운영 보안 유지).
- [ ] remember_me=False가 세션 쿠키가 되어도 httpOnly·samesite=lax 유지.
- [ ] access token은 계속 메모리만 보관(XSS 방지).
