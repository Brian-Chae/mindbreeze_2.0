# SDD-019 — dev 전용 역할 시뮬레이션 로그인

## 배경
개발/QA 과정에서 매번 회원가입·로그인을 반복하는 비용이 크다. dev 환경에서만, 로그인 화면 하단에 역할 시뮬레이션 패널을 두어 개발자가 사용자를 즉석 생성하고, 역할을 골라 클릭하면 비밀번호 없이 즉시 해당 계정으로 로그인하도록 한다.

## 목표
- dev 전용으로 로그인 화면 하단에 역할 시뮬레이션 패널을 둔다.
- 사용자 추가(이름/이메일/역할) + 사용자 리스트(역할 배지 표시)에서 클릭 시 즉시 로그인.
- platform_admin / org_admin / counselor / client 4개 역할을 빠르게 오가며 화면을 검증한다.
- prod에는 이 기능이 물리적으로 존재하지 않아야 한다.

## 비목표
- 이번 단계에서 "로그인 후 앱 내 역할 스위처"는 포함하지 않는다(2차 개선).
- prod에 시뮬레이션 기능을 노출하지 않는다.
- 실계정/운영 데이터를 건드리지 않는다.

## 핵심 결정
1. 환경 식별자 신설: `config.py`에 `environment`(기본 "prod") 추가. `debug` 재사용 금지.
2. 백엔드 게이트: `enable_dev_role_simulation`(기본 false)이 true이고 `environment != "prod"`일 때만 dev 라우터 동작.
3. 프론트 게이트: `import.meta.env.VITE_ENABLE_ROLE_SIM === "true"`일 때만 패널 렌더.
4. 시뮬레이션 계정 격리: `auth_provider="dev"` + 이메일 도메인 `@dev.local` 권장, SIM 배지.
5. 무비번 로그인 토큰도 기존 `LoginResponse`/`authStore.applyLogin()` 재사용.

## 백엔드 설계
### 설정
- `Settings.environment: str = "production"`
- `Settings.enable_dev_role_simulation: bool = False`

### 라우터 (조건부 include)
`backend/app/api/v1/dev_auth.py` 신설. main 라우터 등록 시 위 두 조건이 모두 충족될 때만 include.

### 엔드포인트
| 메서드 | 경로 | 기능 |
|--------|------|------|
| GET | `/dev/auth/users` | 시뮬레이션 유저 목록 (role/status/org 포함) |
| POST | `/dev/auth/users` | 검증/동의 없이 유저 즉석 생성 |
| POST | `/dev/auth/login` | user_id로 비밀번호 없이 로그인(LoginResponse) |
| POST | `/dev/auth/reset-fixtures` | (선택) `@dev.local`/`auth_provider=dev` 계정만 정리 |

### 사용자 생성 규칙
- 필수: name, email, role, org_id(역할별), status="active"
- 검증 생략: OTP/email_verify_token/약관/Google/초대 메일
- 유지: 이메일 형식·중복, name 길이, role/status enum, org_id 존재, role-org_id 조합
- `password_hash` = 랜덤 토큰 해시(추측 불가)
- role-org_id: platform_admin→org_id null, org_admin→org_id 필수, counselor→demo org 연결, client→null 허용
- org_admin/counselor 생성 시 org 미지정이면 demo org 자동 생성 + `primary_admin_id` 연결

### 토큰 발급
- `LoginResponse` 생성 helper 공용화(`auth_session_service`), `_to_user_response` serializer 공용화
- dev 로그인도 `create_access_token` + `issue_refresh_token` 재사용

## 프론트 설계
### 컴포넌트
`frontend/src/components/auth/DevRoleSimulationPanel.tsx` 신설. `LoginPage` 하단에 조건부 렌더.
- 4역할 퀵 시드 버튼 (PA/OA/CS/CL)
- 사용자 추가 폼 (이름/이메일/역할, 추가 후 즉시 로그인 기본 ON)
- 사용자 리스트 (역할 배지 + 상태, 행 클릭 = 즉시 로그인)
- 다크 AI 톤(slate-950 + cyan/amber), DEV 칩 고정 — 프로덕션 purple pill과 시각 분리

### 연동
- `frontend/src/lib/api/devAuth.ts` 신설 (skipAuth)
- `authStore.devLogin(userId)` 액션 → 기존 `applyLogin()` 재사용
- `resolvePostLoginPath(user, next)` 공유로 리다이렉트

## 보안 방어 (중첩)
1. prod 라우터에 물리적으로 미포함 (조건부 import)
2. 백엔드 플래그 기본 false
3. 프론트 env 플래그 기본 off
4. (선택) 미들웨어 403 + 시크릿 헤더
5. (선택) sim 클레임 토큰을 `get_current_user`에서 거부
6. 시뮬레이션 계정 네임스페이스 격리

## 성공 기준
1. prod에는 시뮬레이션 패널·엔드포인트가 전혀 없다.
2. dev에서 사용자 추가 → 리스트 클릭 → 즉시 로그인 → 역할별 랜딩 이동이 동작.
3. 기존 이메일/비밀번호·Google 로그인이 그대로 동작.
4. 4개 역할을 각각 시뮬레이션해서 랜딩 화면까지 확인할 수 있다.
