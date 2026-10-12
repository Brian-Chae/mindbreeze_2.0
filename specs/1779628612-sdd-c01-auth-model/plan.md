# SDD-C01 구현 계획

## 사전 분석 결과

- `ClientCounselorLink` 모델 **이미 존재** (`client_id`, `counselor_id`, `status`, `matched_at`, `ended_at`)
- `User` 모델에 `counselor_links`, `client_links` relationship **이미 존재**
- `User`에 `counselor_id` 필드 **없음** (이미 제거됨)
- `User.auth_provider` 필드 **없음** → 추가 필요
- `client.py` API는 상담사용 (`/clients` prefix) → 내담자용 별도 라우터 필요
- `client_service.py`에 `create_invite`, `get_invite` 등 초대 로직 존재
- `ClientInvite` 모델 존재 (`token`, `counselor_id`, `email`, `expires_at`)

## 구현 순서

### Task 1: User 모델 + Alembic 마이그레이션
- `backend/app/models/user.py`: `auth_provider` 필드 추가 (`String(20)`, default `"email"`, nullable=False)
- Alembic: `alembic revision -m "add_user_auth_provider"`
- 마이그레이션 파일에 `op.add_column('users', sa.Column('auth_provider', sa.String(20), nullable=False, server_default='email'))`

### Task 2: Config + Schemas
- `backend/app/config.py`: `google_client_id: str = ""` 추가
- `backend/app/schemas/auth.py`: `GoogleAuthRequest` (id_token: str, invite_token: str | None)
- `backend/app/schemas/auth.py`: `UserResponse`에 `auth_provider`, `counselors` 필드 추가
- `backend/app/schemas/client.py`: `AddCounselorRequest` (code: str), `CounselorResponse` (id, name, profile_image, org_name, status)

### Task 3: POST /api/v1/auth/google
- `google-auth` 라이브러리 설치 (`pip install google-auth`)
- `backend/app/api/v1/auth.py`: `POST /auth/google` 엔드포인트
  - Google ID token 검증 (`google.oauth2.id_token.verify_oauth2_token`)
  - 이메일로 User find-or-create
  - Google 사용자는 랜덤 비밀번호 해시 (password_hash 필수이므로)
  - `auth_provider` = `"google"` 설정
  - 기존 이메일 사용자면 `auth_provider` 업데이트
  - `invite_token` 있으면 `ClientCounselorLink` 자동 생성
  - JWT 발급 + UserResponse 반환

### Task 4: GET/POST /api/v1/client/counselors (내담자용)
- 신규 라우터: `backend/app/api/v1/client_portal.py` (prefix `/client`, 내담자용)
  - `GET /counselors`: 현재 사용자의 `counselor_links` → 상담사 목록 반환
  - `POST /counselors`: 상담사 코드 검증 → `ClientCounselorLink` 생성
- 상담사 코드: `CounselorProfile` 모델에 `invite_code` 필드 있는지 확인, 없으면 `CounselorProfile.user_id` 앞 6자리 사용
- `backend/app/main.py`: `client_portal.router` 등록

### Task 5: App.tsx RoleRouter
- `frontend/src/App.tsx`: 
  - `useAuthStore`에서 `user.role` 확인
  - `role === "client"` → `/app`로 라우팅 (ClientShell 페이지, 일단 빈 placeholder)
  - `role === "counselor"` → 기존 `/dashboard`
  - 미인증 → `/login`
- `frontend/src/pages/client/ClientAppPage.tsx`: 빈 placeholder (C03에서 구현)
  - `counselors.length === 0` → "상담사 코드를 입력해주세요" 화면

### Task 6: pytest
- `backend/tests/test_auth_google.py`: Google OAuth 단위 테스트
  - 위조 토큰 → 401
  - 유효 토큰 → 200
  - 중복 이메일 → 409
- `backend/tests/test_client_portal.py`: 상담사 CRUD 테스트
  - GET /counselors → 목록
  - POST /counselors → 유효 코드 → 200, 잘못된 코드 → 404

### Task 7: Build 검증
- `cd frontend && npm run build`
- `cd backend && pytest`
