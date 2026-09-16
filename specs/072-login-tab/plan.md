# SDD-072 로그인 통합 구현 계획

## 목표와 설계
`spec.md`와 `docs/login-tab-기획.md`의 기존 스타일 기반 3탭 설계를 구현한다. URL role만 화면 상태로 사용하며, 서버 역할 검증 → 프런트 응답 검증 → 저장 → 공통 이동 순서를 지킨다. 관리자 도메인 승인 정책과 개발 시뮬레이션 플래그는 유지한다.

## 구현 순서
- [x] 서버 회귀 테스트: 이메일 역할 불일치 403 및 토큰 미발급, role 생략 호환, Google 기존 역할 불일치 및 신규 counselor/org_admin 생성 차단.
- [x] `backend/app/schemas/auth.py`: 로그인 role 선택 필드 추가. `backend/app/api/v1/auth.py`: 인증 후 JWT/refresh 발급·Google 연결 변경 전에 역할 검사.
- [x] 프런트 회귀 테스트: 역할 불일치 응답 저장 금지, 회원/상담사 온보딩, 관리자 next 경계, URL 탭·폼 초기화·Google 취소.
- [x] `frontend/src/lib/auth-routing.ts`: `resolvePostLoginPath(user, next)` 추출. `lib/api/auth.ts`, `stores/authStore.ts`: 선택 role 전달 및 저장 전 검사.
- [x] `LoginPage.tsx`: 공통 폼/Google 버튼, 공개 3탭 및 관리자 모드, 접근성, 인증 시작 시 role 고정과 중복 실행 잠금.
- [x] `ClientLoginPage.tsx`: replace 리다이렉트. 역할별 로그인 링크와 보호 경로·로그아웃 점검.
- [x] 대상 테스트, 전체 backend pytest, frontend 테스트와 build 실행 후 `summary.md`에 결과·미검증 경계 기록.

## 제약
기존 사용자 변경을 보존하고 커밋·배포·DB 마이그레이션은 수행하지 않는다. 일반 역할 요청으로 관리자 승격 경로에 진입하지 않는다. 신규 Google 자동 가입은 client 및 기존 승인 정책의 platform_admin만 허용한다. 실제 외부 Google 인증 검증은 로컬 모의 테스트와 구분한다.
