# SDD-C01 — 인증·모델 기초

| 항목 | 값 |
|------|-----|
| **SDD-ID** | C01 |
| **FC-ID** | FC.0 · FC.0a |
| **우선순위** | P0 |
| **예상 기간** | 2~3일 |
| **의존성** | 없음 |

## 범위

Google OAuth 백엔드, ClientCounselor 모델 보강, Alembic 마이그레이션, RoleRouter

## 작업 항목

### Backend
1. `User.auth_provider` 필드 추가 (`"email"` | `"google"`, 기본값 `"email"`)
2. Alembic 마이그레이션: `add_user_auth_provider`
3. `GOOGLE_CLIENT_ID` config 추가
4. `POST /api/v1/auth/google` — Google ID token 검증 + User find-or-create
5. `GET /api/v1/client/counselors` — 내 상담사 목록 (client-facing)
6. `POST /api/v1/client/counselors` — 상담사 코드로 추가
7. Google OAuth 초대 토큰 연동 → `ClientCounselorLink` 자동 생성
8. `UserResponse` 스키마에 `auth_provider`, `counselors[]` 포함

### Frontend
9. `App.tsx` — RoleRouter (client → `/app`, counselor → `/dashboard`, 비로그인 → `/login` 분기)
10. 상담사 無 상태 분기: `counselors.length === 0` → `/app?mode=no_counselor`

### 테스트
11. pytest: Google OAuth + ClientCounselor CRUD + RoleRouter 단위 테스트

## QA List (핵심)

- [ ] Google ID token 위조 시 401
- [ ] 동일 이메일 Google↔이메일 중복 가입 시 409
- [ ] 초대 토큰 유효기간 만료 시 적절한 에러
- [ ] `GET /users/me` 응답에 `counselors[]` 포함
- [ ] `counselors.length === 0` → `/app?mode=no_counselor`
- [ ] 기존 이메일 사용자가 Google OAuth로 로그인 시 `auth_provider` `"email"` + `"google"` 처리
- [ ] `npm run build` 통과
- [ ] `pytest` 통과
