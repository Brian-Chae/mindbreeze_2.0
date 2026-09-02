# [SDD-017] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 위임(Claude=백엔드, Cursor=프론트).

**Goal:** 상담사 가입을 초대 토큰 방식으로 전환. 기관 담당자가 이름+이메일로 초대 → 상담사가 비밀번호 설정 링크로 로그인. 온보딩 비강제, 기관코드 가입 숨김.

**Architecture:**
- 백엔드: `org_invite_service`를 counselor용으로 확장(토큰 type 화이트리스트 + key 파라미터화). `org_service`에 상담사 초대 생성/재발송 로직. `org.py`에 초대/재발송 엔드포인트 + 목록 권한/상태 확장. `auth.py`의 set-password type 확장. `email.py`에 counselor 초대 메일.
- 프론트: `OrgDashboardPage`에 초대 폼 + 초대·가입 현황 목록 + 재발송. `SetPasswordPage` role 분기. 온보딩 강제 진입 해제.

## Files to Change

### 백엔드
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/org_invite_service.py` | 토큰 type 화이트리스트 + `_invite_key(jti, token_type)` 파라미터화 + counselor용 `issue_counselor_invite`/`consume` 공용화 + resend 쿨다운 key 분리 |
| Modify | `backend/app/services/org_service.py` | `invite_counselor(org_id, name, email)` — pending 계정 + CounselorProfile(code_service 유니크 발급) + 초대 발송 + 중복 409 + 초기 초대 레이트리밋 + 이메일 정규화 |
| Modify | `backend/app/api/v1/org.py` | `POST /{org_id}/counselors/invite` + `POST /{org_id}/counselors/{user_id}/resend-invite` + `GET /{org_id}/counselors` 권한 검증·상태 확장 |
| Modify | `backend/app/api/v1/auth.py` | set-password type 화이트리스트 + `/register` 안내 문구 수정 |
| Modify | `backend/app/tasks/email.py` | `send_counselor_invite_email` HTML 버튼형 (counselor 카피) |
| Modify | `backend/app/models/user.py` | `invited_at`/`invite_expires_at` 컬럼 추가 (선택) |
| Modify | `backend/app/schemas/org.py` | counselor 응답에 `status`/`invited_at`/`invite_expires_at` 추가 |
| Create | `backend/tests/test_sdd017_counselor_invite.py` | 초대/재발송/set-password/중복/권한/만료 회귀 테스트 |
| Modify | `backend/tests/test_sdd016_org_admin_onboarding.py` | 레거시 `/register/counselor` 기대값 갱신 (백엔드 유지 확인) |

### 프론트
| Action | File | Description |
|--------|------|-------------|
| Modify | `frontend/src/pages/OrgDashboardPage.tsx` | 초대 폼 + 초대·가입 현황 목록 + 재발송 버튼 + 기관코드 카드 문구 변경 |
| Modify | `frontend/src/pages/SetPasswordPage.tsx` | 성공 리다이렉트 role 분기 + counselor 카피 |
| Modify | `frontend/src/pages/onboarding/CounselorOnboardingPage.tsx` | 건너뛰기/나중에 하기 추가 (또는 진입 비강제화) |
| Modify | `frontend/src/pages/LoginPage.tsx` | counselor 온보딩 강제 리다이렉트 해제 (resolvePostLoginPath 수정) |
| Modify | `frontend/src/lib/api/org.ts` (해당 파일) | counselor 초대/재발송 API 클라이언트 |

## Tasks

### Task 1: 초대 토큰 서비스 counselor 확장
**Objective:** `org_invite_service`가 counselor_invite 토큰을 발급·소비할 수 있게 type 화이트리스트 + key 파라미터화.
**Files:** `backend/app/services/org_invite_service.py`
**Estimate:** 15min

### Task 2: 상담사 초대 서비스 로직
**Objective:** `org_service.invite_counselor` — pending 계정 + CounselorProfile(코드 유니크 발급) + 초대 발송 + 409/정규화/레이트리밋.
**Files:** `backend/app/services/org_service.py`, `backend/app/models/user.py`
**Estimate:** 20min

### Task 3: 초대/재발송/목록 API 엔드포인트
**Objective:** org.py에 초대·재발송 엔드포인트 + 목록 권한/상태 확장.
**Files:** `backend/app/api/v1/org.py`, `backend/app/schemas/org.py`
**Estimate:** 20min

### Task 4: set-password 확장 + 안내 문구
**Objective:** auth.py set-password type 화이트리스트 + `/register` 안내 문구.
**Files:** `backend/app/api/v1/auth.py`
**Estimate:** 10min

### Task 5: counselor 초대 이메일
**Objective:** `send_counselor_invite_email` HTML 버튼형.
**Files:** `backend/app/tasks/email.py`
**Estimate:** 15min

### Task 6: 백엔드 테스트
**Objective:** test_sdd017 신규 + test_sdd016 레거시 갱신.
**Files:** `backend/tests/test_sdd017_counselor_invite.py`, `backend/tests/test_sdd016_org_admin_onboarding.py`
**Estimate:** 25min

### Task 7: 기관 대시보드 초대 UI
**Objective:** 초대 폼 + 초대·가입 현황 목록 + 재발송 + 기관코드 카드 문구 변경.
**Files:** `frontend/src/pages/OrgDashboardPage.tsx`, `frontend/src/lib/api/org.ts`
**Estimate:** 30min

### Task 8: set-password role 분기 + 온보딩 비강제
**Objective:** SetPasswordPage role 분기 + LoginPage/OnboardingPage 건너뛰기.
**Files:** `frontend/src/pages/SetPasswordPage.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/onboarding/CounselorOnboardingPage.tsx`
**Estimate:** 20min

## Testing Strategy
- `cd backend && pytest -q --no-header` — 전체 회귀 (기존 164 + 신규)
- `cd frontend && npx tsc --noEmit` — 타입 체크
- `cd frontend && npm run build` — 프로덕션 빌드
