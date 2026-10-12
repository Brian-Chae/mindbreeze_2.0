# SDD-019 연구 브리프 — dev 전용 역할 시뮬레이션 로그인

## Brian 요구 (원문)
> "매번 회원가입하고 로그인하기가 너무 귀찮다. dev 버젼에 적용하도록 사용자를 개발자가 만들고 할 수 있도록 로그인화면의 아랫쪽에 사용자추가 및 사용자 리스트(역할 표시해서 선택할 수 있도록)에서 사용자 선택하면 로그인 되도록 구성할 수 있을까? 즉, 역할 시뮬레이션을 위한 일종의 시뮬레이션 기능을 구성하고 싶어. 모든 에이전트를 동원해서 기획해봐."

## 목표
- **dev 환경 전용**으로, 로그인 화면 하단에 역할 시뮬레이션 패널을 둔다.
- 패널에서 개발자가 사용자를 즉석 생성(이름/이메일/역할)하고, 목록에서 역할을 골라 클릭하면 비밀번호 없이 해당 계정으로 즉시 로그인한다.
- platform_admin / org_admin / counselor / client 등 역할별로 로그인 후 화면을 빠르게 오가며 확인한다.

## 확정 사실 (코드 근거)
1. 프론트 로그인은 `frontend/src/pages/LoginPage.tsx` 단일 화면. 이메일/비밀번호 폼 + Google 로그인.
   - `resolvePostLoginPath(user, next)`가 역할별 리다이렉트를 결정 (platform_admin→/admin/orgs, org_admin→/dashboard/org, counselor→/dashboard, client→/app 또는 /onboarding/client).
   - `?role=platform_admin` 쿼리로 시스템 관리자 모드 전환.
2. 백엔드 설정 `backend/app/config.py`는 `debug: bool = True` 외에 dev/prod 환경 식별자가 없다.
   - `.env` 파일 기반. `ENVIRONMENT` 같은 명시적 환경 변수는 없음.
3. 로그인 토큰 발급은 `backend/app/api/v1/auth.py`의 `create_access_token()` + `refresh_token_service.issue_refresh_token()`.
4. 사용자 생성 경로:
   - `register/counselor`(기관코드+이메일검증+약관동의 필수), `register/client`(이메일검증+약관동의 필수).
   - 검증/동의 없이 사용자를 즉석 생성하는 경로는 없다.
5. `User` 모델: `email`, `password_hash`, `name`, `role`, `status`, `org_id`, `verified_tier` 등.
6. 프론트 빌드 환경 변수는 Vite 기반 (`import.meta.env.MODE`, `import.meta.env.VITE_*`).

## 반드시 답해야 할 쟁점
1. dev/prod 환경 분리를 무엇으로 판별할 것인가 (백엔드 `settings` 필드 vs `ENVIRONMENT` env, 프론트 Vite `MODE`/`VITE_*`).
2. prod에서 시뮬레이션 엔드포인트/UI가 절대 노출되지 않도록 하는 이중 방어책.
3. "비밀번호 없이 로그인"하는 dev 전용 엔드포인트의 형태 (토큰 발급 방식, 검증 생략 범위).
4. 개발자가 사용자를 즉석 생성하는 dev 전용 엔드포인트의 형태 (이메일 검증/약관동의 생략, org_id/primary_admin 처리).
5. org_admin / platform_admin 역할 시뮬레이션 시 필요한 기관(org)과 권한 검증을 어떻게 간소화할지.
6. 기존 로그인/가입/Google OAuth 흐름을 건드리지 않고 "하단 패널"로만 격리하는 방법.
7. 감사/보안: dev 전용이어도 남길 최소한의 로그/플래그.
8. 사용자 리스트에 어떤 역할/상태를 표시하고, 생성/삭제/정리를 어떻게 제공할지.

## 검토 대상 파일
- frontend/src/pages/LoginPage.tsx
- frontend/src/lib/api/auth.ts, client.ts
- frontend/src/stores/authStore.ts
- frontend/src/App.tsx (라우팅)
- backend/app/config.py
- backend/app/api/v1/auth.py
- backend/app/models/user.py
- backend/app/api/v1/deps.py (get_current_user)
- backend/.env.dev (환경 변수 구조 — 값은 비공개)

## 산출물 규칙
- 코드 수정 금지, 설계 문서만 작성
- 한국어 작성, 코드 근거 인용
- 무비판 동의 금지. 브리프 판단이 틀리면 명시 반박
- 최소 5개 이상의 구체적 리스크/결함 포함
