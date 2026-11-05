# SDD-302 프론트 구현 결과

- 작업 브랜치: `sdd/302-signup-profile-fe`, 별도 프론트 워크트리. 제품 변경은 frontend만 수행.
- 회원 시작 `/register?role=client`, 이메일 OTP→정보/동의 2단계, 소셜 이름·성별·생일·필수동의→공통 홈 분기. 초대 토큰·코치코드·OTP·암호·Apple nonce·법적 동의 전문/선택 항목 유지.
- `client_required_fields`가 있으면 공급자/과거 완료 여부보다 우선. 구 응답은 기존 분기 폴백. 일반 온보딩 주소는 보완/홈 별칭으로 전환, 보호 RoleGuard에서 누락 정보 우회 방지.
- 최소 보완은 서버 누락 필드만 표시·검증·PATCH. 저장된 생일 재판정/재전송 없음. `/settings/optional-profile`은 설정에서 접근, 전화 선택·삭제·보류 서버 저장 후 홈; 오류 시 재시도/이번만 홈 표시.
- 로그인 초기화는 GET 본인 정보 갱신, 네트워크 장애 시 캐시 보존, 세대 번호로 늦은 응답이 새 로그인을 덮지 않음.
- 자연배경 `/images/background8.webp`, 회원 전용 `signup-flow.css` 및 AuthShell variant로 다크 반투명/연보라 CTA/브랜드 pill/원형 뒤로/반응형 폭 적용. 코치·기관 AuthShell 기본 유지. Google 공용 native id_token 분기 추가.

## RED → GREEN
- RED: `npx vitest run tests/sdd302-profile-routing.test.ts` → 3건 실패(필수정보 홈, 완료 과거회원 누락, 소셜 필수정보 제출 가드).
- GREEN: `npx vitest run tests/sdd302-*.test.* tests/social-signup-birth-date.test.tsx tests/fix-signup-email-otp.test.tsx tests/sdd220-auth-consents.test.tsx tests/onboarding-role-guard.test.tsx tests/login-page.test.tsx tests/sdd249-p1-entry-prompts.test.tsx tests/login-statusbar-overlay.test.tsx tests/home-row-chip-login-links.test.tsx` → 11파일 64건 통과.
- 기존 소셜 정상 fixture에 이름·성별 입력과 API payload 단언 추가. 기존 단언 삭제/약화 없음.
- 신규 테스트: gender-only PATCH(기존 생일 보존), 선택 보류 실패/재시도, 전화 삭제, 캐시 본인 GET 갱신/장애/늦은 응답 경합.
- `npx tsc -b --pretty false`: 통과.
- 변경 FE 파일 `npx eslint ...`: 통과.
- `npm run build`: 통과. 토큰 CSS import 경로 미해결, Browserslist 데이터, Tailwind screens object, 큰 청크/혼합 dynamic import 경고 존재(작업 범위 밖). 빌드 성공을 화면 검증으로 간주하지 않음.
- `git diff --check`: 통과.

## 변경 파일
- auth: `AuthShell`, `signup-flow.css`, `GoogleLoginButton`, `AppleLoginButton`, `RoleGuard`, `SignupInfoForm`
- page: `RegisterPage`, `RegisterStartPage`, `RegisterClientPage`, `SignupConfirmPage`, `LoginPage`, `InviteLandingPage`, `ClientEssentialsPage`, `ClientOnboardingPage`, `optional-profile-page`, `participation-profile-page`
- 공통: `App.tsx`, `lib/api/auth.ts`, `lib/auth-routing.ts`, `lib/auth/signup-info.ts`, `stores/authStore.ts`, `ClientProfileSection`, `settings-content`
- 테스트: `sdd302-profile-routing`, `sdd302-profile-forms`, `sdd302-auth-hydration`, 기존 `social-signup-birth-date`

## 한계/후속 감독 검증
실 Google/Apple OAuth, 네이티브 장치, 실 API/메일은 실행하지 않음. 390/768 실제 렌더 캡처·합성 fixture 브라우저 검증은 감독 담당. 푸시·PR·배포하지 않음.

## 독립 리뷰 후 보완
- 회원 셸 뒤로가기에서 현재 URL 초대 token/code를 유지하고, 소셜 확인 화면은 메모리 pending의 초대 token/code를 명시 전달한다. 초대 랜딩의 경로 토큰도 보존한다.
- 본인 GET 대기 중 다른 탭 로그아웃이 발생하면 세션 종료와 함께 `isInitialized=true`를 확정한다. 늦은 GET은 세대 검사로 무시한다.
- 선택 전화 저장/보류 실패의 액션을 별도 보관하여 재시도는 각각 같은 PATCH/POST를 반복한다. 전화 PATCH 실패 후 보류 POST로 바뀌던 문제 수정.
- RED: 리뷰 회귀 3파일 실행에서 4건 실패 확인. GREEN: 같은 3파일10건 통과, 전체 관련 12파일68건 통과. TypeScript/변경 ESLint/diff-check 추가 확인.
