# SDD-019 계획

## 작업 스트림

### Track A — 백엔드 설정/게이트
1. `config.py`에 `environment`(기본 "production"), `enable_dev_role_simulation`(기본 false) 추가
2. `.env.dev`에 `ENVIRONMENT=development`, `ENABLE_DEV_ROLE_SIMULATION=true` 반영 (값 비공개)
3. `get_current_user`/기존 인증과 무관하게 dev 라우터만 독립 게이트

### Track B — 백엔드 dev 라우터
1. `LoginResponse` 생성 + `_to_user_response` serializer 공용화
2. `dev_auth.py` 라우터 작성 (조건부 include)
3. `dev_user_service.py`: role-org_id 검증, demo org 확보, 사용자 생성
4. 엔드포인트 4종: 목록/생성/무비번로그인/정리
5. 시뮬레이션 계정 `auth_provider="dev"` 마킹

### Track C — 프론트 패널
1. `devAuth.ts` API 클라이언트
2. `authStore.devLogin()` 액션
3. `DevRoleSimulationPanel.tsx` (퀵시드/추가/리스트)
4. `LoginPage` 하단 조건부 렌더 + `resolvePostLoginPath` 공유

### Track D — 검증
1. 백엔드: 플래그 off 시 404/미포함, on 시 생성/목록/로그인
2. role-org_id 검증 (platform_admin null, org_admin 필수)
3. 중복 이메일 409
4. 프론트: env off 시 패널 미노출, on 시 목록/생성/선택 로그인 이동
5. 기존 로그인 회귀 (이메일/비밀번호, Google)

## 구현 순서
1. 설정 필드 + 조건부 include
2. serializer/LoginResponse 공용화
3. dev_user_service (role-org_id, demo org)
4. dev_auth 라우터 4종
5. 프론트 devAuth.ts + authStore.devLogin
6. DevRoleSimulationPanel
7. LoginPage 삽입 + gating
8. 회귀 테스트

## 리스크 및 완화
1. prod에 dev API 노출 → 환경 플래그 기본 prod/false + 조건부 import + 물리 미포함
2. platform_admin 탈취 → sim 계정 네임스페이스 + (선택) sim 클레임 거부
3. 실계정 파괴 → 정리는 sim 계정만 대상, hard delete 재사용 금지
4. org_admin org_id 누락 → demo org 자동 생성
5. client onboarding 미완 → 생성 시 onboarding_completed=true 기본
