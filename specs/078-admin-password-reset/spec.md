# SDD-078 — 관리자 비밀번호 재설정 (재설정 링크 방식)

> 기획안 `docs/admin-password-reset-기획.md`의 Phase 1(MVP) 구현. **claude(fable) 위주로 개발**.
> 플랫폼 관리자·기관 관리자가 상담사·주 담당자(active 계정)의 비밀번호를 재설정 링크로 재설정한다.

## 1. 정책 확정 (Brian)
- **TTL 24시간** (본인용 30분보다 길게, 초대 7일보다 짧게)
- **기존 초대 API 통합** (소비 경로 확장, 초대 수락 로직과 격리하되 단일 제출 경로)
- **메일 문구 모두 노출** (관리자 이름 전체 노출)

## 2. 구현 범위 (claude fable)

### T1. 토큰 발급·소비
- 신규 token_type `admin_password_reset` (TTL 24시간, 일회용, 재발급 시 이전 무효화)
- 발급: 관리자 트리거 → 기존 jti 무효화 → 토큰 발급 → 이메일 발송 → 감사 기록
- 소비: 토큰 검증 → 비밀번호 정책 검증 + PasswordHistory 기록 + `revoke_all_user_tokens`(전 세션 강제 로그아웃) + 완료 알림 + 감사 기록
- pending/suspended 계정 거부 (pending → resend-invite 안내, suspended → 거부)
- status는 건드리지 않음(active 유지)

### T2. API
- `POST /api/v1/admin/orgs/{org_id}/primary-admin/password-reset` (플랫폼, 주 담당자)
- `POST /api/v1/admin/orgs/{org_id}/counselors/{user_id}/password-reset` (플랫폼, 상담사)
- `POST /api/v1/orgs/{org_id}/counselors/{user_id}/password-reset` (기관 관리자, 소속 상담사)
- 소비: 기존 초대 소비 경로에 `admin_password_reset` 토큰 처리 통합 (초대 수락 로직과 격리)
- 요청 본문 `{ reason(필수) }`, 응답 `{ email_sent, expires_at }` (토큰 원문 미포함)

### T3. 권한 검사
- 플랫폼 관리자 / 기관 관리자(소속 상담사만, 본인 제외)
- 대상 status == active만, 기관 활성 상태 확인, 대상자당 60초 쿨다운
- 자기 자신 재설정 금지 (본인은 /auth/password/forgot)

### T4. 감사 기록
- VerificationAudit: `password_reset_issued`(발급) + `password_reset_completed`(완료)

### T5. FE
- 기관 모달 주 담당자 카드 "비밀번호 재설정" 버튼 (active일 때만)
- 상담사 탭 행 메뉴 "비밀번호 재설정" (active만)
- 확인 다이얼로그(대상 요약 + 사유 필수 + 효과 고지) → 발송 → 토스트
- SetPasswordPage 문구 분기 (초대 vs 재설정)

### T6. 이메일 2종
- 재설정 링크 발송: 관리자 이름 전체 노출 + 링크 + 유효기간 + "본인 요청 아님 시 문의"
- 완료 알림: 비밀번호 변경 + 모든 기기 로그아웃

## 3. 주의
- 비밀번호 원문 무전송 (링크 방식만, 임시 비밀번호 금지)
- 토큰 원문은 이메일 본문에만 존재 (DB/로그/응답 저장 금지)
- 사유 없으면 422 (프론트 비활성화 + 서버 이중 방어)
- revoke_all_user_tokens 무조건 호출

## 4. 완료 기준
- 플랫폼(주담당자+상담사)/기관(소속 상담사) 재설정 링크 발급
- 재설정 완료 시 세션 무효화 + 감사 기록
- BE pytest 통과, FE build 0 error
