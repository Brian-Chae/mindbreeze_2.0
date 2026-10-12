# SDD-C02 — 인증 페이지

| 항목 | 값 |
|------|-----|
| **SDD-ID** | C02 |
| **FC-ID** | FC.1 · FC.2 |
| **우선순위** | P0 |
| **예상 기간** | 2~3일 |
| **의존성** | SDD-C01 (인증·모델 기초) |

## 범위

로그인 페이지 UI, 회원가입 페이지 UI, Google OAuth 연동, 온보딩 Step 1 (기본정보) 통합

## 작업 항목

### Backend
1. `PATCH /api/v1/auth/users/me` — 사용자 기본정보 업데이트 (name, phone, gender, birth_date)
2. 온보딩 완료 처리 (`onboarding_completed = true`) 연동
3. `UpdateUserMeRequest` 스키마 추가

### Frontend
4. `npm install @react-oauth/google` — Google 로그인 버튼 라이브러리 설치
5. 로그인 페이지 (`/login`) — 이메일/비밀번호 + Google OAuth 버튼
6. 회원가입 Step 1 페이지 (`/register/step1`) — 이메일, 비밀번호, 이름, 전화번호, 성별, 생년월일
7. 회원가입 이메일 검증 플로우 (OTP 입력)
8. 온보딩 완료 후 RoleRouter 분기 → 대시보드/앱 이동

### 테스트
9. pytest: `PATCH /users/me` 단위 테스트
10. vitest: 로그인/회원가입 페이지 컴포넌트 테스트

## QA List (핵심)

- [ ] `PATCH /users/me` JWT 미인증 시 401
- [ ] name, phone 업데이트 후 `GET /users/me` 응답에 반영
- [ ] gender, birth_date 업데이트 후 ClientProfile 생성/갱신 확인
- [ ] `onboarding_completed` true 전환 확인
- [ ] Google OAuth 버튼 클릭 → Google 계정 선택 → JWT 발급
- [ ] 기존 이메일 사용자 Google OAuth 로그인 시 200
- [ ] 로그인 페이지 이메일/비밀번호 필드 유효성 검증
- [ ] 회원가입 Step 1 필수 필드 검증 (이메일, 비밀번호, 이름)
- [ ] OTP 입력 후 이메일 검증 완료 → Step 2 진행
- [ ] `npm run build` 통과
- [ ] `pytest` 통과
