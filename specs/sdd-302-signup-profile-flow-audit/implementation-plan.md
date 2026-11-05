# SDD-302 — 회원가입·프로필 개선 구현 계획

> 실행: superpowers:subagent-driven-development. 전용 워크트리에서 구현 워커와 독립 리뷰를 순차 실행한다. 사용자 승인(“수정 개발 진행하고 이상없으면 dev 배포”)에 따라 구현·검증·PR·develop 병합·dev 배포를 연속 진행한다. 운영 배포·메일·기존 산출물 삭제는 범위 밖이다.

## 목표와 정본
v4 시안 및 v3 성별 필수 결정을 정본으로 한다. 필수 이름/생일/성별·신규 동의는 유지, 선택 전화번호 때문에 홈 진입을 막지 않는다. 주소 제외. 이메일 가입은 OTP→정보/동의 2단계. 소셜 가입 정보 확인 후 홈. 기존 필수정보 누락 회원에게만 최소 보완 화면. 전화번호는 설정에서 사용자가 직접 입력, 보류 후 자동 재안내 없음. 기존 기획의 30일 재안내·행사 전후 분리안은 폐기된다.

## 아키텍처/호환
- DB 컬럼 추가 대신 기존 OnboardingProgress.steps에 선택 프로필 보류 상태만 별도 키로 저장한다. completed를 보류 플래그로 위장하지 않는다. 필수정보 유무는 실제 User/ClientProfile로 산출한다.
- UserResponse에 `client_required_fields: list[str]`, `profile_prompt_dismissed: bool`, `gender`, `birth_date`, `phone`을 추가한다. client_required_fields는 client만 name/gender/birth_date 누락을 반환. 다른 역할은 []. 기존 필수 동의 정책은 신규 가입에 그대로 적용; 과거 회원 동의나 생일 임의 생성 금지.
- GET /auth/users/me 추가: 최신 본인 응답. PATCH는 기존 허용 필드 유지. 신규 gender 필수는 이메일 신규/소셜 신규에만 적용, 기존 소셜 로그인은 입력 없이 가능.
- POST /onboarding/client/profile-dismiss: client 전용, 서버 JSON에 profile_prompt_dismissed=true 저장, 다른 진행키 보존, 같은 요청 재시도 안전. 필수 누락을 충족 처리하거나 동의/코치 연결을 바꾸지 않는다.
- client_complete는 client 역할과 실제 필수정보 확인 후 진행 처리. provider별 step1~4 강제 차이를 제거하되 상담사 완료 계약은 유지. 신규 회원은 필수정보 저장 후 기존 진행 처리 가능. 클라이언트는 서버 required_fields 기준으로 홈/필수보완만 분기한다.
- 초기 세션 복구의 오래된 localStorage 사용자 정보는 본인 GET으로 갱신한다. 네트워크 실패를 로그아웃으로 바꾸지 않는다. 신규 필드 없는 구 응답은 기존 분기로 안전하게 폴백.
- 초대 토큰 전달/연결, 역할 가드, 이메일 OTP/비밀번호, Google·Apple nonce/계정 연결 정책은 유지. 이메일 코치 코드 필수 정책 유지. 코치/기관 자가 소셜 신규 허용은 별도 정책으로 변경하지 않는다.

## 소유권 및 순서
같은 워크트리에서 동시 코드 작성 금지. 백엔드 구현 후 리뷰, 프론트 구현 후 리뷰 순서. 감독은 diff·명령결과·브라우저를 독립 검증한다.

### 작업1 — 백엔드 회원 필수정보/보류 계약
파일: backend/app/schemas/auth.py, api/v1/auth.py, api/v1/onboarding.py, services/onboarding_service.py(필요 시 작은 profile 서비스 분리), backend/tests/test_sdd302_signup_profile.py 및 영향을 받는 가입/온보딩 테스트.
- [ ] 테스트 먼저: 신규 성별 누락 거부, 성별 저장, 이메일/Google/Apple 로그인 required_fields, 기존 완료=true라도 누락 필수 표시, 필수 충족+전화null 홈 가능 상태.
- [ ] RED 확인 후 최소 구현. 신규 소셜 요청 gender optional 스키마+신규 분기 GENDER_REQUIRED 오류로 공급자 재로그인 호환; 이메일 신규도 동일 명시 오류 또는 필수 스키마.
- [ ] client_complete 실제 필수 검사/role 검증, 보류 idem/다른 step 보존/다른 역할403/재로그인 저장 유지 시험.
- [ ] 관련 기존 회귀 및 계약 결과 기록, 커밋.

### 작업2 — 승인된 클래스 스타일 및 가입 동선
파일: frontend/src/components/auth/*, pages/{RegisterPage,LoginPage,SignupConfirmPage}.tsx, pages/register/RegisterClientPage.tsx, pages/clients/InviteLandingPage.tsx, pages/onboarding/ClientEssentialsPage.tsx/ClientOnboardingPage.tsx, lib/auth-routing.ts, lib/api/auth.ts, stores/authStore.ts, lib/auth/signup-info.ts, 설정 링크/라우트, 관련 tests. 필요 시 공용 signup-flow CSS/컴포넌트 생성. 사진은 기존 background8 자산 재사용.
- [ ] 테스트 먼저: 필수정보 기반 분기, 이메일2단계, 소셜 성별 입력과 payload, 초대 후 공통 분기, 기입값 재사용, 필수 미충족 제출 불가.
- [ ] v4 자연배경/다크 시트/연보라 CTA, Google 흰 버튼+컬러 로고20/Apple 검정+흰 로고18/높이52 재사용. 새 화면 금지 문구 준수. 회원 시작/가입/필수보완/선택전화 화면 일관화. 코치·기관 신청의 기존 업무절차는 보존하며 공통 셸 영향 확인.
- [ ] 기존 일반 client 온보딩 진입을 공통 필수보완/홈으로 전환. 별도 선택 전화 입력 화면은 설정에서만 진입; 나중에 하기 서버 저장 후 홈, 실패 시 재시도와 이번만 홈 선택.
- [ ] 신규 필수 요건 충족 시 홈 바로 진입. 설정에서 전화 수정 가능, 주소 없음. 보호 라우트에서 필수보완 루프/다른 역할 영향 방지.
- [ ] 관련 vitest/타입/린트/빌드, UI 화면 검증 후 커밋.

### 작업3 — 통합 검증·독립 리뷰·배포
- [ ] 구현 전 verify.md 시나리오 실행/결과 갱신. 실제 페이지 캡처390/768, 코드 기반 합성 API 표시; OAuth 실기기 미검증 별도 표기.
- [ ] 독립 리뷰 Critical/Important 해소, scripts/test-changed 및 필요한 회귀, Alembic head 확인.
- [ ] 최신 develop 통합 후 재검증, PR 생성/CI 통과, merge commit → develop 배포 추적. 사용자 승인 범위 안에서 실행, 브랜치/워크트리는 삭제하지 않음.
- [ ] Deploy Dev 성공 커밋과 공개 페이지/API health 확인, 가능하면 인증 없는 런타임 UI 확인. summary.md에 결과/한계·PR·배포 run 기록.

## 주요 리스크 검증
1. 기존 Apple/초대 Google 흐름이 옛 4단계로 돌아가는지.
2. completed=true지만 성별 비어 있는 기존 회원이 보완화면을 건너뛰는지.
3. 저장 성공 뒤 사용자 상태 갱신 실패로 로그인 루프 생기는지.
4. 동의/초대코드/OTP 검증이 단계 통합 과정에서 약해지는지.
5. 공유 AuthShell 변경이 코치/기관 신청과 작은 뷰포트 대비를 깨는지.

## 실행 기록
- 구현 전 gate 커밋: 9973b62a.
- 실행 방식 조정: API 응답 계약을 먼저 확정한 뒤 프론트를 별도 Paseo 워크트리(sdd/302-signup-profile-fe)에서 병행했다. 같은 워크트리 동시 코드 수정은 없다. 백엔드/프론트 통합 및 독립 리뷰는 감독 브랜치에서 수행한다.
- 백엔드 작업1 커밋: 59565bd1. 관련165/최종51건 통과 보고, 독립 리뷰 및 감독 재검증 진행.

### 구현·독립 검토 완료
- 백엔드 59565bd1/db1d6427, 프런트엔드 1cc639fd/e3a3e129/0508d8e4 반영.
- 독립 리뷰 Important: 온보딩 JSON 동시저장, 초대 복귀 토큰, 초기화 중 교차 탭 로그아웃, 전화 저장 재시도 — 모두 수정 후 독립 재리뷰 해소.
- 제품 소스 390/768 합성 API 브라우저 검증 12캡처·8흐름 통과. 배포 전 최종 검증과 PR CI 진행.
