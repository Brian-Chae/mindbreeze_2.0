# SDD-078 — Plan (관리자 비밀번호 재설정)

> Stage ② 구현 계획. 구현 브리프(정책 확정: TTL 24h · 기존 초대 API 통합 · 관리자 이름 전체 노출)를 기반으로 한다.

## 아키텍처

기존 초대 토큰 인프라(JWT jti + Redis 일회용)를 재사용하되, 초대 수락 시멘틱
(`consume_invite`의 `status="active"` 강제 전환)과 격리한 **별도 서비스**로 구현한다.

```
관리자 트리거 (admin.py / org.py)
  → admin_password_reset_service.issue_admin_reset
      상태 검증(active만) → 쿨다운(대상자당 60초) → 이전 jti 무효화
      → JWT 발급(TTL 24h, issued_by 클레임) → Redis jti 저장
      → 이메일 발송(관리자 이름 전체) → VerificationAudit(password_reset_issued)
대상자 소비 (/auth/set-password — 단일 제출 경로)
  → peek_token_type으로 분기: admin_password_reset → complete_admin_reset
      비밀번호 정책 + 직전 3개 재사용 차단 → PasswordHistory 기록
      → VerificationAudit(password_reset_completed) → jti 삭제(일회용)
      → revoke_all_user_tokens(전 세션 강제 로그아웃) → 완료 알림 메일
      → 자동 로그인 없음: { success, flow: "password_reset" } 반환
```

## 파일 목록

### Backend
| 파일 | 변경 |
|---|---|
| `app/services/admin_password_reset_service.py` | 신규 — 발급/소비/peek, Redis 키 3종(jti·active·cooldown) |
| `app/api/v1/admin.py` | `POST /admin/orgs/{org_id}/primary-admin/password-reset`, `POST /admin/orgs/{org_id}/counselors/{user_id}/password-reset` (require_platform_admin + 기관 활성 검증) |
| `app/api/v1/org.py` | `POST /org/{org_id}/counselors/{user_id}/password-reset` (_require_org_admin + 소속·role==counselor 검증) |
| `app/api/v1/auth.py` | `/auth/set-password` 소비 경로에 type 분기 통합 |
| `app/schemas/org.py` | `PasswordResetIssueRequest`(reason 필수·공백 422), `PasswordResetIssueResponse`(email_sent, expires_at — 토큰 미포함) |
| `app/tasks/email.py` | `send_admin_password_reset_email`(관리자 이름 전체 노출), `send_password_reset_completed_email` |
| `tests/test_sdd078_admin_password_reset.py` | 신규 — QA 15건 |

### Frontend
| 파일 | 변경 |
|---|---|
| `src/lib/api/admin.ts` | `resetPrimaryAdminPassword`, `resetAdminOrgCounselorPassword` |
| `src/components/admin/password-reset-confirm.tsx` | 신규 — 대상 요약 + 사유 필수 + 효과 고지 확인 폼 |
| `src/components/admin/org-detail-modal.tsx` | 주 담당자 카드 버튼(active만) + 상담사 행 버튼(active만) + 결과 메시지 |
| `src/pages/SetPasswordPage.tsx` | `type=reset` 문구 분기 + 완료 시 /login 이동(자동 로그인 없음) |

## 핵심 결정

1. **`ALLOWED_INVITE_TYPES` 미등록** — 초대 소비 경로가 재설정 토큰을 절대 수용하지 못하게 격리. 분기는 `peek_token_type`으로 라우터에서 수행.
2. **재발급 무효화** — Redis `admin_pwd_reset_active:{user_id}` → 이전 jti 삭제. 유효 링크는 항상 1개.
3. **issued_by JWT 클레임** — 완료 감사 기록에서 발급 관리자를 추적 (토큰은 이메일에만 존재하므로 노출 위험 없음).
4. **재설정 소비는 자동 로그인 없음** — 전 세션 무효화 직후 자동 로그인은 모순. 성공 플래그만 반환하고 FE가 /login으로 이동.
5. **기관 관리자는 role==counselor 대상만** — org_admin 계정(자기 자신 포함)은 플랫폼 관리자 경유 (권한 매트릭스 §4).
