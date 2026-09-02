# SDD-019 Verify

## 구현 전 검증 질문
1. `environment` 기본값을 "production"으로 두고, dev에서는 명시적으로 "development"를 설정하는가?
2. prod 빌드 artifact에 시뮬레이션 패널 코드가 포함되지 않는가(최소 렌더 null)?
3. dev 엔드포인트가 prod 라우터에 물리적으로 include되지 않는가?

## 백엔드 검증 시나리오
- 플래그 off 상태에서 `/dev/auth/*` 접근 시 404 또는 라우터 미포함
- 플래그 on에서 GET /dev/auth/users 목록 반환
- POST /dev/auth/users로 시뮬레이션 유저 생성 (약관/OTP 없이)
- role-org_id 검증: platform_admin org_id null 강제, org_admin org_id 필수
- org_admin/counselor 생성 시 demo org 자동 생성 + primary_admin 연결
- 중복 이메일 409
- POST /dev/auth/login → 기존 LoginResponse 형태로 토큰 발급
- 발급 토큰으로 기존 보호 API 접근 가능 (get_current_user 정합)
- reset-fixtures가 sim 계정만 정리 (실계정 보존)

## 프론트 검증 시나리오
- VITE_ENABLE_ROLE_SIM off → 패널 미노출 (DOM에 노드 0)
- on → 로그인 화면 하단에 패널 노출
- 4역할 퀵 시드로 각 역할 즉시 로그인 → 올바른 랜딩 이동
- 사용자 추가 → 리스트 prepend
- 리스트 행 클릭 → 즉시 로그인 → resolvePostLoginPath 이동
- 기존 이메일/비밀번호 로그인, Google 로그인 정상 동작(회귀)

## 회귀 포인트
- 기존 register/login/refresh 흐름 무변경
- `?role=platform_admin` 시스템 관리자 모드 정상
- authStore 세션 저장/복원 정상

## 출시 게이트
- 백엔드 pytest 전체 통과
- 프론트 tsc/build 통과
- prod 빌드에서 패널 미노출 확인
- dev 배포 후 4개 역할 시뮬레이션 수동 검증
