# SDD-C07: 상담사 소셜 로그인 (Google + Kakao)

## 미션

상담사 로그인 페이지(`/login`)에 Google OAuth와 Kakao 로그인 버튼을 추가한다.
기존 내담자용 Google 로그인 구현을 재활용하되, 상담사 전용 제약(신규 가입 불가)을 적용한다.

## 배경

- 내담자 로그인(`/login/client`)에는 이미 Google + Kakao(비활성) 버튼이 구현되어 있음
- 상담사 로그인(`/login`)에는 이메일/비밀번호만 존재
- `POST /api/v1/auth/google`는 신규 사용자 생성 시 `role="client"`로 하드코딩 → 상담사는 기존 계정이 있을 때만 Google 로그인 허용

## 핵심 변경사항

### 1. 백엔드 — `POST /api/v1/auth/google` role 파라미터 추가

**파일**: `backend/app/schemas/auth.py`
- `GoogleAuthRequest`에 `role: str | None = None` 필드 추가

**파일**: `backend/app/api/v1/auth.py`
- `role` 파라미터가 `"counselor"`이고 기존 사용자가 없으면 → 403 `"상담사 계정이 없습니다. 관리자에게 문의하세요."`
- `role` 파라미터가 `"counselor"`이고 기존 사용자가 있으면 → 정상 로그인 (role 유지)
- `role` 파라미터가 없거나 `"client"`면 기존 동작 유지

### 2. 프론트엔드 — 상담사 LoginPage에 소셜 로그인 버튼 추가

**파일**: `frontend/src/pages/LoginPage.tsx`
- ClientLoginPage의 Google/Kakao 버튼 UI를 그대로 복제
- 다크 테마 스타일 유지 (`bg-white/10`, `border-white/20`, `rounded-full`, `w-[280px]`)
- `useGoogleLogin` 훅 import 및 사용
- Google 로그인 성공 시 `loginGoogle(accessToken, undefined, "counselor")` 호출
- 성공 후 라우팅: `onboarding_completed`면 `/dashboard`, 아니면 `/onboarding/counselor`

### 3. 프론트엔드 — authStore/loginGoogle 시그니처 확장

**파일**: `frontend/src/stores/authStore.ts`
- `loginGoogle(accessToken, inviteToken?, role?)` → role 파라미터 추가
- `apiLoginGoogle` 호출 시 `{ access_token, invite_token, role }` 전달

**파일**: `frontend/src/lib/api/auth.ts`
- `GoogleLoginPayload`에 `role?: string` 추가

## 절대 금지

- 기존 이메일/비밀번호 로그인 로직 변경 금지
- 내담자 로그인 페이지(`/login/client`)의 기존 동작 변경 금지
- 백엔드에서 신규 상담사 자동 생성 금지 (반드시 403)
- Kakao 버튼을 실제로 활성화하지 말 것 (UI만, ClientLoginPage와 동일하게 비활성)
- `any` 타입 사용 금지

## 검증

- `npm run build` 통과
- 기존 이메일 로그인 정상 동작
- Google 로그인 버튼 클릭 → 팝업 → 토큰 → API 호출 → 로그인 성공
- Kakao 버튼은 비활성 상태 (회색, 클릭 불가)
- 존재하지 않는 Google 계정으로 상담사 로그인 시도 → 403 에러 메시지 표시
