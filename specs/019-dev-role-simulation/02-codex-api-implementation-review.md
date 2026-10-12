# SDD-019 Codex API 구현 정합 리뷰

## 엔드포인트/스키마 설계

현재 브리프의 `backend/app/core/auth.py`, `backend/app/core/deps.py` 경로는 실제 코드에 없다. 인증 토큰은 `backend/app/core/security.py`, 인증 의존성은 `backend/app/api/deps.py`가 기준이다. dev 전용 API는 기존 `/auth/*`, `/admin/*`, `/org/*` 흐름을 오염시키지 않도록 새 라우터 `backend/app/api/v1/dev_auth.py` 또는 `backend/app/api/v1/dev.py`로 분리하고, `backend/app/api/v1/__init__.py`에서 dev 설정이 켜진 경우에만 include하는 구조가 가장 구현 가능하다.

권장 엔드포인트는 다음 4개다.

1. `GET /api/v1/dev/auth/users`
   - 역할 시뮬레이션 패널의 사용자 목록 조회.
   - Query: `role?: counselor|client|org_admin|platform_admin`, `org_id?: UUID`, `q?: string`, `include_inactive?: boolean=false`.
   - Response: `DevUserListResponse { users: DevUserItem[] }`.
   - `DevUserItem`: `id`, `email`, `name`, `role`, `status`, `org_id`, `org_name`, `onboarding_completed`, `verified_tier`, `auth_provider`, `created_at`.

2. `POST /api/v1/dev/auth/users`
   - 검증/동의 없이 dev 사용자 즉석 생성.
   - Request: `DevUserCreateRequest`.
   - Response: `DevUserItem`.
   - 중복 이메일은 기존 가입과 동일하게 `409`로 거부한다. 기존 계정을 자동 승격하거나 병합하면 역할 시뮬레이션이 실제 권한 데이터를 망가뜨릴 수 있다.

3. `POST /api/v1/dev/auth/login`
   - 비밀번호 없이 특정 사용자로 로그인.
   - Request: `DevLoginRequest { user_id: UUID }`.
   - Response: 기존 `LoginResponse`.
   - 프론트 `authStore`의 `applyLogin()`이 요구하는 `access_token`, `refresh_token`, `token_type`, `user` 형태를 그대로 반환해야 한다.

4. `POST /api/v1/dev/auth/reset-fixtures`
   - 선택 권장. `@dev.local` 같은 dev 전용 도메인 또는 `auth_provider="dev"` 계정만 정리한다.
   - 무조건 전체 사용자 삭제는 금지한다. 현재 `admin_service.delete_user()`는 FK 정리까지 수행하는 강한 기능이므로 dev cleanup에 그대로 노출하면 위험하다.

`DevUserCreateRequest` 권장 스키마:

```text
name: str, 1..100
email: EmailStr
role: Literal["platform_admin", "org_admin", "counselor", "client"]
org_id: UUID | null
status: Literal["active", "pending", "suspended"] = "active"
onboarding_completed: bool = true
```

보완 포인트 1: `frontend/src/lib/api/auth.ts`에는 `UserRole`에 `admin`이 포함되어 있지만 백엔드 `User.role` 주석과 라우팅/가드는 `platform_admin`, `org_admin`, `counselor`, `client` 중심이다. dev 시뮬레이션 생성 역할에서는 `admin`을 제외해야 한다.

보완 포인트 2: `config.py`의 `debug: bool = True`만으로 dev/prod 분리를 판단하면 안 된다. 최소한 `environment: str = "development"`와 `enable_dev_role_simulation: bool = False`를 추가하고, `settings.debug is True`, `settings.environment != "production"`, `settings.enable_dev_role_simulation is True`를 모두 만족해야 dev 라우터가 동작하도록 설계해야 한다.

보완 포인트 3: 프론트도 `import.meta.env.DEV` 또는 `MODE !== "production"`과 `VITE_ENABLE_DEV_ROLE_SIMULATION === "true"`를 동시에 만족할 때만 로그인 하단 패널을 렌더링한다. 백엔드 차단이 1차 방어, 프론트 미노출이 2차 방어다.

보완 포인트 4: dev API는 OpenAPI에 노출되어도 운영에서 라우터 자체가 include되지 않아야 한다. 라우터 내부 guard만 두면 실수로 운영 설정에서 endpoint path가 살아남는다.

## 토큰 발급 재사용 경로

기존 로그인은 `backend/app/api/v1/auth.py`에서 `create_access_token(subject=str(user.id))`와 `refresh_token_service.issue_refresh_token(str(user.id), db)`를 직접 호출하고 `LoginResponse(user=_to_user_response(user), ...)`를 반환한다. dev 로그인도 이 토큰 발급 방식을 그대로 재사용해야 한다. 토큰 payload는 현재 `sub`, `exp`, `type`만 들어가며 `get_current_user()`는 DB에서 사용자 role/email/name/org_id를 다시 읽어 dict로 반환한다. 따라서 dev 토큰에 role을 별도로 넣을 필요가 없다.

권장 재사용 경로는 `app/services/auth_session_service.py` 같은 작은 공용 서비스를 새로 두는 것이다.

```text
issue_login_response(user: User, db: Session) -> LoginResponse
  - access_token = create_access_token(subject=str(user.id))
  - refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
  - user = to_user_response(user)
```

`_to_user_response()`는 현재 `auth.py`의 private helper라 dev 라우터가 직접 import하면 라우터 간 결합이 생긴다. 구현 시에는 `to_user_response()`를 공용 서비스 또는 serializer 모듈로 옮기고 기존 auth 라우터와 dev 라우터가 함께 쓰게 하는 편이 낫다.

보완 포인트 5: `refresh_token_service.issue_refresh_token()`은 내부에서 `db.commit()`을 수행한다. dev 사용자 생성과 즉시 로그인 발급을 한 트랜잭션처럼 묶을 수 없으므로, 생성 API와 로그인 API를 분리하거나 생성 후 `db.commit()/refresh()`를 마친 뒤 토큰을 발급해야 한다.

보완 포인트 6: dev 로그인도 `LoginResponse`를 반환해야 `frontend/src/stores/authStore.ts`의 `applyLogin()`을 그대로 탈 수 있다. 별도 `DevLoginResponse`를 만들면 `tokenStorage.set()`와 `persistUser()` 경로를 중복 구현하게 된다.

보완 포인트 7: `get_current_user()`가 `status`를 검사하지 않는다. dev에서 `pending` 또는 `suspended` 사용자를 로그인시키면 현재 백엔드 대부분의 보호 API는 통과할 가능성이 있다. 시뮬레이션 목적의 기본값은 `active`로 고정하고, `pending/suspended` 로그인 허용은 명시적 테스트 옵션으로만 제공해야 한다.

## 사용자 생성 로직

필수 저장값은 `name`, `email`, `role`, `org_id`, `status`다. 다만 `org_id`는 필드 자체는 항상 request/response에 포함하되 역할별 허용값을 다르게 둔다.

- `platform_admin`: `org_id = null`만 허용. 운영 조직 권한과 무관한 전역 관리자다.
- `org_admin`: `org_id` 필수. 해당 기관의 관리자 화면(`/dashboard/org`)과 `_require_org_admin()` 검증이 `role == "org_admin"` 및 `current_user.org_id == org_id`를 동시에 요구한다.
- `counselor`: `org_id` 권장 필수. 기관 가입/세션/상담사 관리 화면 확인에 필요하다. 단독 상담사 시나리오가 별도로 필요하면 `org_id=null`을 허용할 수 있으나 기본 fixture에는 포함하지 않는다.
- `client`: `org_id=null` 허용. 현재 내담자는 기관 소속보다 상담사 링크/초대 흐름이 중심이며, `User.org_id`가 nullable이다.

생성 시 검증 생략 범위:

- 생략: OTP 이메일 검증, `email_verify_token`, 약관 동의 레코드 생성, Google OAuth 검증, 사업자등록번호 검증, 초대 토큰 발급, 초대 메일 발송, 비밀번호 정책 입력.
- 유지: 이메일 형식, 이메일 중복, name 길이, role enum, status enum, org_id UUID 형식, org_id 존재 여부, role-org_id 조합 검증.
- 저장: `password_hash`는 nullable이 아니므로 `hash_password(secrets.token_urlsafe(32))`로 추측 불가능한 값을 저장한다. 사용자가 알 수 있는 임시 비밀번호는 만들지 않는다.
- 저장: `auth_provider="dev"`, `verified_tier="email"` 또는 현행 코드 호환값, `status="active"` 기본값.

기관 생성/확보 로직은 두 갈래가 필요하다.

1. 사용자가 `org_id`를 넘기면 해당 기관 존재 여부만 확인한다.
2. `org_admin` 또는 `counselor` 생성 요청에서 `org_id`가 없고 `auto_create_org=true`이면 `org_service.admin_create_organization("DEV 시뮬레이션 센터", db)`를 재사용해 verified 기관과 `org_code`를 만든다.

단, `org_service.create_org_with_admin()`은 org_admin을 `status="pending"`으로 만들고 초대 기반 활성화를 전제로 하므로 dev 즉석 활성 계정 생성에는 맞지 않는다. 이 함수의 트랜잭션/primary_admin 설정 패턴은 참고하되, dev helper는 별도로 두어야 한다. dev `org_admin` 생성 후 기관에 `primary_admin_id`가 없으면 `org.primary_admin_id = user.id`로 연결한다.

보완 포인트 8: `UserResponse`에는 `status`와 `org_id`가 없다. 로그인 후 라우팅만 보면 없어도 되지만 dev 패널 목록과 역할 표시에는 필요하므로 `DevUserItem`에는 반드시 포함한다. 기존 `UserResponse`를 무리하게 확장하면 앱 전체 user 타입 영향이 커진다.

보완 포인트 9: `verified_tier` 값이 백엔드 생성 경로에서는 `"email"`로 저장되지만 프론트 타입은 `'email_verified'`를 기대한다. 기존 코드가 이미 안고 있는 불일치다. SDD-019에서 이 값을 새로 확산하지 말고, dev 패널은 `verified_tier`를 표시용 문자열로만 다루며 권한 판단에 쓰지 않는다.

보완 포인트 10: `client`를 `onboarding_completed=false`로 만들면 로그인 직후 `/onboarding/client`로 이동한다. 역할 화면 빠른 전환이 목표라면 기본 생성값은 `onboarding_completed=true`가 맞다. 구현상 `OnboardingProgress(completed=True)` 레코드를 함께 만들거나, `UserResponse.onboarding_completed` 계산과 맞는 helper를 제공해야 한다.

## 프론트 API/스토어 연동

`frontend/src/lib/api/client.ts`는 `skipAuth`가 true일 때 Bearer 토큰을 붙이지 않고, 401 refresh도 하지 않는다. dev 로그인/목록/생성은 로그인 화면 하단에서 호출되므로 `{ skipAuth: true }`로 호출해야 한다. 보안은 이 옵션이 아니라 백엔드 dev 라우터 guard가 책임져야 한다.

권장 파일 분리는 `frontend/src/lib/api/devAuth.ts` 신규 추가다.

```text
listDevUsers(params) -> apiClient.get<DevUserListResponse>("/dev/auth/users?...", { skipAuth: true })
createDevUser(payload) -> apiClient.post<DevUserItem>("/dev/auth/users", payload, { skipAuth: true })
loginDevUser(userId) -> apiClient.post<LoginResponse>("/dev/auth/login", { user_id: userId }, { skipAuth: true })
```

`authStore.ts`에는 `devLogin(userId: string): Promise<User>` 액션만 추가하고, 내부에서 `apiDevLogin()` 결과를 기존 `applyLogin()`에 넣는다. 이렇게 하면 `tokenStorage`, `USER_KEY`, `isAuthenticated` 갱신 로직을 재사용한다. `createDevUser()`는 인증 상태를 바꾸지 않는 패널 전용 호출로 두고, 생성 후 목록 refresh 또는 즉시 `devLogin()`을 선택하게 한다.

`LoginPage.tsx`는 기존 이메일/비밀번호/Google 로그인 폼을 건드리지 않고 하단에 `DevRoleSimulationPanel` 컴포넌트를 조건부 렌더링한다. 렌더 조건은 `import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_ROLE_SIMULATION === "true"` 또는 `MODE !== "production"` 기반으로 둔다. 패널은 `resolvePostLoginPath(user, next)`를 재사용해 로그인 성공 후 이동한다. 이 함수가 현재 파일 내부 함수이므로, 구현 시에는 같은 파일 안에서 패널에 callback으로 넘기거나 `frontend/src/lib/auth/resolve-post-login-path.ts`로 분리한다.

보완 포인트 11: `apiClient`는 `BASE_URL`을 `VITE_API_BASE_URL` 또는 localhost로 정한다. dev 패널만 다른 API host를 쓰면 refresh/token 저장 경로가 꼬인다. 같은 `apiClient`를 사용해야 한다.

보완 포인트 12: `skipAuth`는 기존 SDD-015에서 게스트 참여 오판을 만든 적이 있다. dev API에만 `skipAuth`를 쓰고, 일반 session/org/admin API에는 전파하지 않는다.

보완 포인트 13: 프론트 `User` 타입에는 `org_id`와 `status`가 없어 org_admin 패널 표시가 부족하다. 로그인 응답용 `User` 타입은 유지하고, dev 패널 표시용 `DevUserItem` 타입을 별도로 만든다.

## 영향 범위

재사용 가능한 지점:

- `backend/app/core/security.py`: `hash_password()`, `create_access_token()`.
- `backend/app/services/refresh_token_service.py`: `issue_refresh_token()`.
- `backend/app/api/v1/auth.py`: `LoginResponse` 반환 형태와 user serializer 로직.
- `backend/app/api/deps.py`: 기존 토큰 인증 소비 경로. dev 토큰도 동일하게 소비된다.
- `backend/app/models/user.py`: `User` 모델 필드.
- `backend/app/services/org_service.py`: `admin_create_organization()`, `get_organization()`, `list_organizations()`, `generate_org_code()`.
- `frontend/src/lib/api/client.ts`: `apiClient`, `tokenStorage`, refresh retry 구조.
- `frontend/src/stores/authStore.ts`: `applyLogin()` 패턴, 상태 저장 구조.
- `frontend/src/pages/LoginPage.tsx`: `resolvePostLoginPath()`와 로그인 후 navigate 흐름.

새로 필요한 지점:

- `Settings.environment`, `Settings.enable_dev_role_simulation`.
- `backend/app/api/v1/dev_auth.py` 라우터와 `require_dev_role_simulation_enabled()` guard.
- `backend/app/schemas/dev_auth.py` 또는 dev 라우터 내부 Pydantic 스키마.
- `backend/app/services/auth_session_service.py` 또는 serializer 공용화 모듈.
- `backend/app/services/dev_user_service.py`: dev 사용자 생성, dev fixture org 확보, role-org_id 검증.
- `frontend/src/lib/api/devAuth.ts`.
- `frontend/src/components/auth/DevRoleSimulationPanel.tsx`.
- `authStore.devLogin()` 액션.
- `LoginPage.tsx` 조건부 패널 삽입.

리스크/결함:

- `debug=True` 기본값이 운영 배포에 남으면 dev API가 열릴 수 있다.
- 백엔드 라우터 include 조건 없이 내부 guard만 두면 path 존재 자체가 공격 표면이 된다.
- `status` 미검사 구조 때문에 pending/suspended 계정 로그인 시 실제 권한 API가 열릴 수 있다.
- `org_admin`의 `org_id` 누락은 `/dashboard/org` 이후 org API에서 403 또는 빈 화면으로 이어진다.
- `client`의 onboarding 미완료 기본값은 역할 시뮬레이션 목표와 달리 온보딩 화면으로 보낸다.
- `_to_user_response()` private helper를 dev 라우터가 직접 import하면 auth 라우터 구조 변경에 취약하다.
- `issue_refresh_token()`의 내부 commit 때문에 사용자 생성 중간 실패 시 트랜잭션 경계가 혼동될 수 있다.
- dev cleanup이 일반 사용자까지 삭제하면 테스트 DB라도 복구 비용이 크다.

## 최종 권고안

최종 권고는 “새 dev 라우터 + 공용 로그인 응답 helper + 별도 프론트 devAuth 클라이언트” 조합이다. 기존 `/auth/login`, `/auth/google`, `/auth/register/*`는 건드리지 않는다. 비밀번호 없는 로그인은 `/api/v1/dev/auth/login`에서 기존 `LoginResponse`를 그대로 발급하고, 프론트는 `authStore`의 기존 로그인 적용 경로를 재사용한다.

구현 순서는 다음이 안전하다.

1. `config.py`에 명시적 dev 기능 플래그를 추가하고 라우터 include를 조건부로 만든다.
2. `LoginResponse` 생성 helper를 공용화한다.
3. `DevUserCreateRequest`, `DevUserItem`, `DevUserListResponse`, `DevLoginRequest`를 정의한다.
4. `dev_user_service`에서 role-org_id 검증과 fixture org 확보를 구현한다.
5. `GET/POST /dev/auth/users`, `POST /dev/auth/login`을 추가한다.
6. 프론트에 `devAuth.ts`, `authStore.devLogin()`, `DevRoleSimulationPanel`을 추가한다.
7. 패널 렌더링은 Vite dev 플래그와 별도 `VITE_ENABLE_DEV_ROLE_SIMULATION`이 모두 참일 때만 허용한다.
8. 테스트는 백엔드에서 prod flag off 시 404 또는 라우터 미포함, flag on 시 생성/목록/로그인, org_admin org_id 필수, platform_admin org_id null 강제, 중복 이메일 409를 확인한다. 프론트는 env off에서 패널 미노출, env on에서 목록/생성/선택 로그인 후 `resolvePostLoginPath()` 이동을 확인한다.

이 설계가 기존 인터페이스와 가장 잘 맞는 이유는 토큰 소비 경로를 전혀 바꾸지 않기 때문이다. dev 로그인으로 발급된 토큰도 `get_current_user()`가 DB에서 사용자를 다시 읽어 role/org_id를 반환하므로, 기존 role guard와 라우팅 정합성을 그대로 검증할 수 있다.
