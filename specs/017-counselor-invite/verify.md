# [SDD-017] — Verification (Pre-Implementation)

> Stage ③ — 구현 전 필수 게이트. 아래 시나리오를 구현 후 실제 실행해 PASS/FAIL 기록.

## Test Scenarios

### TS1: 상담사 초대 → pending 계정 + 코드 발급
1. org_admin으로 `POST /api/v1/org/{org_id}/counselors/invite` (이름+이메일)
2. 응답/DB 확인
- **Expected:** counselor 계정(status=pending, role=counselor, org_id 연결), CounselorProfile.counselor_code(6자리 유니크) 생성, 초대 토큰 발급, 초대 메일 발송 성공

### TS2: 초대 링크로 비밀번호 설정 → 상담사 대시보드 진입
1. 발송된 초대 링크의 토큰으로 `POST /api/v1/auth/set-password`
2. 응답 확인
- **Expected:** 200, user.role="counselor", status="active", access_token 발급. 프론트는 `/dashboard`로 리다이렉트(role 분기)

### TS3: 초대 토큰 재사용/만료 거부
1. 같은 토큰으로 set-password 2회 호출
- **Expected:** 1회는 200, 2회는 401("이미 사용")

### TS4: 이메일 중복 초대 409 (대소문자 변형 포함)
1. `Foo@test.com` 초대 후 `foo@test.com` 초대
- **Expected:** 2번째 409

### TS5: 레거시 register/counselor 백엔드 유지 + 프론트 숨김
1. `POST /api/v1/auth/register/counselor` (기관코드 포함) 호출
- **Expected:** 백엔드 201 유지(회귀 없음). 프론트에서 기관코드 가입 진입 경로가 숨겨짐

### TS6: 상담사 목록 상태 구분 + pending 실적 제외
1. `GET /api/v1/org/{org_id}/counselors` (org_admin)
- **Expected:** 응답에 status/invited_at/invite_expires_at. 대시보드 실적 집계는 active만

### TS7: resend pending만 허용
1. pending 상담사 resend → 200
2. active 상담사 resend → 4xx
- **Expected:** pending만 재발송 가능, active 거부

### TS8: 무인증 상담사 목록 조회 차단
1. 인증 없이 `GET /api/v1/org/{org_id}/counselors`
- **Expected:** 401/403

## Edge Cases
- [ ] 초대 이메일 정규화: `Foo@x.com`/`foo@x.com` 동일 처리
- [ ] 타 기관 상담사 user_id로 재발송 시도 → 403/404
- [ ] 초기 초대 연속 발송 시 레이트리밋 동작
- [ ] counselor_code 유니크 보장 (대량 발급 시 충돌 없음)
- [ ] 초대 메일 발송 실패 시 계정 정책 (invite_sent=false 유지 vs 롤백)

## Security Review
- [ ] org_admin 본인 기관 검증 (초대/목록/재발송 전부)
- [ ] resend status=pending 게이트 (active 비번 초기화 차단)
- [ ] 토큰 원문 DB 미저장 + Redis jti→user_id만
- [ ] 디버그 로깅 마스킹
- [ ] counselor_code 유니크 발급 (code_service)

## 승인 요청
| Stage | 산출물 | 상태 |
|-------|--------|------|
| ① Spec | specs/017-counselor-invite/spec.md | ✅ |
| ② Plan | specs/017-counselor-invite/plan.md | ✅ |
| ③ Verify | specs/017-counselor-invite/verify.md | ✅ |
| ④ Implement | — | ⏳ 진행 |
