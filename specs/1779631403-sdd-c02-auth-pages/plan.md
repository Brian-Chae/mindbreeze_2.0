# SDD-C02 구현 계획

## 사전 분석 결과

### 사전 작업 완료
- [x] `PATCH /api/v1/auth/users/me` 엔드포인트 구현 완료
- [x] `npm install @react-oauth/google` 설치 완료
- [x] `spec.md` + `plan.md` 생성 완료

### 기존 인프라
- `User` 모델: `name`, `phone` 필드 보유
- `ClientProfile` 모델: `gender`, `birth_date` 필드 보유, `user_id` FK
- `OnboardingProgress` 모델: `completed` 필드, `complete_onboarding()` 서비스 존재
- `get_current_user` → `{"id": user_id}` dict 반환
- `auth.py` router prefix: `/auth` → 전체 경로 `/api/v1/auth/users/me`
- `UserResponse` 스키마: `onboarding_completed` 속성 포함 (User.onboarding_completed property)

### PATCH /users/me 구현 내용
- **파일**: `backend/app/api/v1/auth.py`
- **엔드포인트**: `PATCH /users/me`
- **업데이트 가능 필드**: `name`, `phone` (User), `gender`, `birth_date` (ClientProfile)
- **온보딩 완료**: 요청 성공 시 `OnboardingProgress.completed = True`
- **인증**: `get_current_user` 의존성

## 구현 순서

### Task 1: 회원가입 Step 1 페이지 (Frontend)
- `frontend/src/pages/auth/RegisterStep1Page.tsx`
  - 이메일, 비밀번호(확인), 이름, 전화번호, 성별(radio), 생년월일(date picker)
  - 폼 유효성 검증 (Zod + react-hook-form)
  - 제출 시 `POST /api/v1/auth/email/request-otp` → OTP 입력 화면으로 이동

### Task 2: 이메일 검증 (OTP) 페이지
- `frontend/src/pages/auth/EmailVerifyPage.tsx`
  - 6자리 OTP 입력 필드
  - `POST /api/v1/auth/email/verify-otp` → `email_verify_token` 수신
  - 검증 완료 시 `POST /api/v1/auth/register/client` 호출 (또는 counselor)
  - 회원가입 완료 → JWT 저장 → `PATCH /users/me`로 추가정보 전송 → 온보딩 완료

### Task 3: 로그인 페이지 (Frontend)
- `frontend/src/pages/auth/LoginPage.tsx`
  - 이메일/비밀번호 입력 폼
  - `POST /api/v1/auth/login` → JWT 수신 → Zustand auth store 저장
  - Google OAuth 버튼 (`@react-oauth/google`의 `GoogleLogin` 컴포넌트)
  - Google ID token → `POST /api/v1/auth/google` → JWT 수신
  - 로그인 성공 → RoleRouter 분기 (client → `/app`, counselor → `/dashboard`)

### Task 4: RoleRouter 개선
- `frontend/src/App.tsx` (또는 `frontend/src/router.tsx`)
  - `onboarding_completed` 확인 → 미완료 시 온보딩 페이지로 리디렉션
  - 인증 상태에 따른 라우트 가드

### Task 5: 온보딩 Step 1 통합
- 기존 온보딩 Step 1 (기본정보) 페이지를 회원가입 Step 1로 마이그레이션 또는 통합
- `PATCH /users/me` 호출하여 기본정보 저장 + 온보딩 완료 처리
- 중복 필드 정리 (회원가입 시 입력한 정보와 온보딩 입력 정보 일치화)

### Task 6: 테스트
- `backend/tests/test_users_me.py`
  - PATCH /users/me 인증 없음 → 401
  - 유효한 업데이트 → 200, UserResponse 반환
  - ClientProfile 생성/갱신 검증
  - onboarding_completed true 확인
- `frontend/src/__tests__/pages/auth/`
  - LoginPage 렌더링, 폼 유효성 검증
  - RegisterStep1Page 렌더링, 필수 필드 검증
  - GoogleLogin 버튼 렌더링 확인

### Task 7: Build 검증
- `cd frontend && npm run build`
- `cd backend && pytest`
