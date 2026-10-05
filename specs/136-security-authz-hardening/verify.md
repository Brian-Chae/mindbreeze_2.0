# SDD-136 — Verify (구현 전 QA 체크리스트)

> 각 항목: 수정 후 아래 시나리오가 실제로 통과해야 완료.

## 1. 무인증 자격증빙 승인 차단
- [x] `PUT /api/v1/credentials/admin/{id}` 무인증 호출 → **401**
- [x] counselor/org_admin 토큰 호출 → **403**
- [x] platform_admin 토큰 호출 → **200** + `verified_tier` 갱신

## 2. 정지·대기 계정 차단
- [x] `status="suspended"` 계정의 유효 토큰 요청 → **403**
- [x] `status="pending"` 계정의 유효 토큰 요청 → **403**
- [x] `status="active"` 계정 정상 동작 → **200**

## 3. JWT 키 fail-fast
- [x] `JWT_SECRET_KEY` 미설정 시 앱 기동 → **RuntimeError**
- [x] dev 서버 `.env.dev` 에 `JWT_SECRET_KEY` 존재 확인

## 4. Google OAuth audience 검증
- [x] userinfo 성공 + tokeninfo `aud` 불일치 → **401**
- [x] userinfo 성공 + tokeninfo `aud` 일치 → 정상 로그인
- [x] userinfo 401(위조 토큰) → **401**

## 5. 비밀번호 재설정 후 세션 무효화
- [x] 재설정 완료 후 기존 리프레시 토큰 사용 → **거부** (revoke_all_user_tokens 호출)

## 6. 리포트 수정 권한 게이트
- [x] client/게스트 토큰으로 `PUT /api/v1/reports/{id}` → **403**
- [x] counselor/org_admin 토큰 → **200**

## 7. 프론트 화면 가드
- [x] client 계정으로 `/clients`, `/sessions`, `/reports` 접근 → 홈 리다이렉트
- [x] counselor 계정으로 `/app` 접근 → 홈 리다이렉트
- [x] counselor/org_admin 은 `/clients` 등 정상 접근

## 종합 게이트
- [x] 백엔드 `pytest -q` 1009 passed / 0 failed
- [x] 프론트 `vitest run` 44 files / 318 passed
- [x] 프론트 `npm run build` 0 errors
- [x] Deploy Dev 성공(Health check 통과)
