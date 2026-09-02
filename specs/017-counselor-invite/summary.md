# [SDD-017] — Summary

## What Was Built

상담사 가입을 기관 담당자 일괄 초대 방식으로 전환. SDD-016 초대 토큰/이메일 인프라 재사용.

### 백엔드
| File | Description |
|------|-------------|
| `app/services/org_invite_service.py` | 토큰 type 화이트리스트(`org_admin_invite`+`counselor_invite`), `_invite_key(jti, token_type)` 파라미터화, `issue_counselor_invite`, counselor 전용 쿨다운 key 분리 |
| `app/services/org_service.py` | `invite_counselor`(이메일 정규화→409→레이트리밋→pending 계정+CounselorProfile 유니크 코드 발급→초대 발송), `resend_counselor_invite`(role/org_id/status=pending 검증) |
| `app/api/v1/org.py` | `GET /{org_id}/counselors` org_admin 권한 검증+상태 필드, `POST /{org_id}/counselors/invite`, `POST /{org_id}/counselors/{user_id}/resend-invite` |
| `app/api/v1/auth.py` | `/register` 안내 문구 수정(초대 요청), set-password type 화이트리스트 수용 |
| `app/api/deps.py` | `get_current_user` 반환에 `org_id` 추가 |
| `app/tasks/email.py` | `send_counselor_invite_email` HTML 버튼형 |
| `app/models/user.py` | `invited_at`/`invite_expires_at` 컬럼 |
| `app/schemas/org.py` | `CounselorResponse` 상태 필드, `CounselorInviteRequest/Response` |
| `alembic/versions/a1c7e9f30b21_*.py` | users.invited_at/invite_expires_at 마이그레이션 |

### 프론트
| File | Description |
|------|-------------|
| `pages/OrgDashboardPage.tsx` | 상담사 초대 폼 + 초대·가입 현황 목록 + 재발송 + 기관코드 카드 문구 변경 |
| `pages/SetPasswordPage.tsx` | 성공 리다이렉트 role 분기(counselor→/dashboard) |
| `pages/LoginPage.tsx` | counselor 온보딩 강제 진입 해제(/dashboard 직행) |
| `pages/onboarding/CounselorOnboardingPage.tsx` | 건너뛰기/나중에 하기 + 필수 검증 완화 |
| `pages/DashboardPage.tsx` | 상담사 코드 상시 노출 + 프로필 완성 dismissible 배너 |
| `pages/RegisterPage.tsx` | counselor 직접 가입 숨김(안내 화면으로 대체) |
| `lib/api/org.ts` | inviteCounselor/resendCounselorInvite 클라이언트 |

## Test Results
- ✅ 백엔드: `179 passed, 1 skipped` (기존 164 + 신규 16)
- ✅ 프론트: `npx tsc --noEmit` 0 error
- ✅ 프론트: `npm run build` 0 error
- ✅ 마이그레이션 단일 head: `a1c7e9f30b21`
- verify.md TS1~TS8 신규 테스트로 커버 (초대/재발송/set-password/중복/권한/만료/레이트리밋/타기관)

## Debugging Journey
- [TS2367 dead code]: RegisterPage에 counselor early return 추가 후, 이후 코드의 `role === 'counselor'` 비교가 unreachable로 판정. counselor 전용 코드(orgCode state, registerCounselor 호출, orgCode input)를 제거하고 role 기본값을 client로 변경해 해결.
- [에이전트 리뷰 반영]: Claude/Codex/Cursor 3자 리뷰에서 차단 6건(type 화이트리스트+key 파라미터화, 목록 권한, resend pending 게이트, 리다이렉트 분기, 기관코드 카드, 초대/실적 분리)을 spec에 반영 후 구현.

## Notes for Reviewer
- `/auth/register/counselor`는 백엔드에서 유지(하위 호환·롤백 가능). 프론트에서만 숨김.
- 마이그레이션 `a1c7e9f30b21`은 배포 시 서버에서 적용 필요.
- 초대 메일은 SDD-016 HTML 버튼형과 동일 디자인, counselor 카피.
