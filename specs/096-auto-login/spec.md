# [SDD-096] 자동 로그인 (로그인 상태 유지)

## Goal

사용자가 매번 재로그인하지 않도록, 로그인 시 「로그인 상태 유지」 옵션으로 refresh 쿠키를 지속(14일)시키고, 새로고침·브라우저 재시작 후에도 세션이 자동 복구되게 한다.

## Context

- 현재 인증은 이미 부분 자동 복구를 구현: `authStore.initialize()`가 localStorage의 `mb_user`를 복원하고 `refreshAccessToken()`(httpOnly 쿠키)로 access token을 재적재.
- refresh 토큰: DB(`RefreshToken`) + httpOnly 쿠키 `mb_refresh_token`(max_age 14일, path `/api/v1/auth`, `samesite=lax`, `secure=environment=="production"`).
- `access_token_expire_minutes=2880`(48h), `refresh_token_expire_days=14`.
- 문제: 「로그인 상태 유지」 선택지가 없어 항상 영속 쿠키이며, `secure` 플래그가 `environment` 값에 의존해 환경(로컬 http vs 배포 https)에 따라 쿠키가 거부될 수 있음 → 재로그인 유발 가능.

## Scope

### ✅ In-scope
- 로그인/회원가입/Google 로그인 요청에 `remember_me: bool` 추가(기본 True).
- `_set_refresh_cookie`가 `remember_me=False`면 **세션 쿠키**(max_age 없음), True면 14일 영속.
- refresh 쿠키 `secure` 플래그를 요청 scheme 기반(`request.url.scheme=="https"` 또는 forwarded proto)으로 보정 — 로컬 http에서도 쿠키가 거부되지 않게.
- 프론트 로그인 화면에 「로그인 상태 유지」 체크박스(기본 체크) + `remember_me` 전달.
- `initialize()` 자동 복구 흐름 견고화(경쟁 상태 확인).

### ❌ Out-of-scope
- 다중 기기 세션 관리/로그아웃 강화.
- 소셜 로그인 자동 재인증(Google 재로그인).

## Acceptance Criteria
- [ ] 로그인 시 「로그인 상태 유지」 체크 시 refresh 쿠키가 14일 영속(max_age 설정).
- [ ] 체크 해제 시 세션 쿠키(브라우저 종료 시 소멸).
- [ ] 새로고침·브라우저 재시작 후 로그인 없이 세션 복구(체크한 경우).
- [ ] 로컬 http 환경에서도 refresh 쿠키가 정상 동작.
- [ ] `pytest` + `npm run build` + `npx vitest run` 통과.

## Dependencies
- 기존 인증(`auth.py` `_set_refresh_cookie`, `authStore.initialize`, `client.ts refreshAccessToken`).

## Risks
- **secure 플래그 변경**: 배포 https에서만 secure가 유지되도록 주의(운영 보안).
- **쿠키 path**: `/api/v1/auth` 한정 → refresh 엔드포인트만 쿠키 수신, 변경 시 path 정합 확인.
