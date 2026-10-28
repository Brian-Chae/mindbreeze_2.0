# SDD-249 — 구현 계획 (Stage ② Plan)

- 근거: `spec.md`(대표 결정 D1~D7), 디자인 시안 v1(`~/.hermes/share/mb-signup-revamp-20261028/design-v1/`), 대표 추가 지시(생년월일 숫자 직접 입력)
- 원칙: 역할 선택 → 인증 → 가입 정보 확인(공통 1화면) → 역할별 첫 설정 → 홈. 자연 배경·보라 #5F0080·흰 카드·52px pill.
- 대표 승인(2026-10-28) 후 Stage ③~⑥ 연속 진행. 푸시는 자기 브랜치만, 머지·배포 없음.

## 1. 핵심 설계

### 1.1 소셜 가입 — 서버 변경 없는 "인증 후 확인 화면" 구조
- 서버는 소셜 신규 가입에서만 422(`BIRTH_DATE_REQUIRED`/`CONSENT_REQUIRED`)를 주고, **422 시점에 계정은 생성되지 않는다**(`google_auth`/`apple_auth` 모두 `validate_new_account` 통과 뒤 생성. Apple은 nonce 도 소비 안 함).
- 따라서 클라이언트가 "422 = 신규"로 해석해, 오류 문구를 띄우지 않고 **공통 `/signup/confirm` 화면**으로 보낸다. 자격(access_token/id_token/Apple credential)은 `sessionStorage` 가 아닌 **메모리 스토어(zustand, 새로고침 시 폐기)** 에만 둔다.
- 확인 화면 제출 = 같은 자격으로 같은 엔드포인트를 생년월일·동의를 채워 재호출. 실패는 표준 문구(409 연결 필요 / 탈퇴 처리 중 / 나이 제한).
- 신규 서버 API 없음. 새로고침으로 자격이 사라지면 "다시 로그인" 안내(막다른 길 아님).
- Google 웹 access_token·네이티브 id_token 은 재사용 가능(유효시간 내). Apple nonce 는 검증 실패 시 미소비(서버 docstring 확인).

### 1.2 생년월일 `BirthDateInput` (대표 추가 지시)
- 위치: `frontend/src/components/auth/BirthDateInput.tsx` + 순수 로직 `frontend/src/lib/auth/birth-date.ts`.
- 표시 `YYYY.MM.DD`, `inputMode="numeric"`, 숫자만 추출(붙여넣기·구분점 입력 허용), 8자리에서 자동 구분점(`1990` → `1990.` 4자 후 자동, 6자리 후 자동), 지우기 시 구분점 자연 삭제.
- 값 계약: `onChange(isoValue: string, state)` — 완성되면 `YYYY-MM-DD`, 미완성이면 빈 문자열. 서버 전송은 기존과 동일 `YYYY-MM-DD`.
- 검증: `lib/auth/age.ts` 의 `checkBirthDate` 재사용(실제 날짜·미래 금지·1900 이전·만 14세). 컴포넌트는 `minAge` 비적용 옵션(`ageRule: 'signup' | 'none'`)을 둬 프로필 수정은 나이 제한 없이 실제 날짜·미래만 검사.
- 에러 문구는 `BIRTH_DATE_MESSAGES` 재사용. 입력 중에는 완성 전 에러 미표시(blur 또는 8자리 완성 시 표시).
- 기존 `value`(YYYY-MM-DD) prop 을 받아 표시 문자열로 변환(수정 화면 초기값).
- 적용 대상(생년월일만): RegisterClientPage, RegisterCounselorPage, InviteLandingPage, LoginPage(소셜 확인), ClientEssentialsPage, CounselorOnboardingPage, ClientOnboardingPage(select 3개 → 교체), settings/{PersonalInfoSection, ProfileSection(생년월일 1곳), ClientProfileSection, SelfInfoSection}, counselor-info-editor 생년월일. 일정·내보내기·자격 취득일 등 날짜는 제외(`NormalizationPanel`·`data-center`·`class-*`·`CredentialDashboardPage`·취득/시작/종료일).

### 1.3 공통 가입 정보 확인 `SignupInfoForm`
- 위치: `frontend/src/components/auth/SignupInfoForm.tsx`. 이름(소셜 제공 시 표시)·성별·생년월일(`BirthDateInput`)·`ConsentCheckList`(필수3+선택2, 항목마다 전문 보기 링크). 필수 충족 시에만 제출 활성.
- 사용처: `/signup/confirm`(소셜·초대 소셜), 이후 이메일 가입 화면 재사용 가능한 형태(P1).
- `ConsentCheckList` 개선: 이용약관·민감정보 처리 "보기" 링크(현재는 개인정보만 링크). 링크 대상은 기존 처리방침 경로 재사용, 이용약관·민감정보 전문 경로가 없으면 처리방침 앵커로 연결(본문 개정 없음).

### 1.4 역할 가드·막다른 길
- `/onboarding/client`, `/onboarding/client/essentials` → `RoleGuard role="client"`, `/onboarding/counselor` → `RoleGuard role="counselor"`. `RoleGuard` 가 역할 불일치 시 보내는 위치(기존 동작)를 확인해 "이 화면은 회원용이에요" 안내 + 올바른 곳으로 이동 버튼.
- 로그인 역할 탭 불일치(403 `ROLE_MISMATCH`·`authStore` 403)에서 올바른 탭으로 이동 버튼.
- 상담사 탭: 소셜 안내를 D1 문구로 교체, 기관 탭: D2에 따라 Google·Apple 노출(서버는 기존 org_admin 계정의 소셜 로그인을 이미 허용 — 신규는 403 유지 + "관리자가 지정한 계정만" 안내).

### 1.5 서버 변경 (P1 후보, P0 비포함)
- D1(상담사 소셜 신규가입): 현재 `google_auth`/`apple_auth` 가 counselor/org_admin 신규를 403. 허용하려면 승인 대기 상담사 계정 생성 정책(개인 상담사 신청 `RegisterCounselorPage` 의 승인 흐름과의 통합)이 필요 → **서버 정책 변경이라 별도 판단 후 P2로 두고 PR 본문에 명시**. P0/P1 에서는 상담사 탭에서 소셜 신규 시 가입 화면(`/register/counselor`)으로 안내하는 막다른 길 제거만 한다.
- 단일 alembic head 유지: 이번 계획은 마이그레이션 0건.

### 1.6 앱 Apple 동반 노출 (App Store 심사지침 4.8)
- 4.8 "Login Services": 제3자·소셜 로그인으로 **주 계정**을 설정·인증하는 앱은 동등한 로그인 옵션(개인정보 수집 최소화·이메일 비공개·광고 추적 없음 조건)을 함께 제공해야 한다. Google 로그인을 쓰는 iOS 앱은 Sign in with Apple(또는 동등 옵션) 필요. 이메일/비밀번호로 자체 계정을 만든 뒤 소셜을 붙이는 구조는 면제 대상이 아니므로, **iOS 앱에서 Google 버튼이 보이는 모든 화면(로그인 3탭·초대 랜딩)에 Apple 버튼을 동반**한다. Android·웹은 해당 없음(웹은 Apple 미제공 유지).
- 현재 `AppleLoginButton` 은 `isAppleLoginAvailable()`(iOS 네이티브) 일 때만 렌더 → 동반 노출 규칙을 `SocialLoginGroup` 한곳에서 보장한다(Google 있으면 Apple 같이 렌더, iOS 네이티브 한정).

## 2. 우선순위

| 구분 | 항목 | 비고 |
|---|---|---|
| **P0 (필수)** | 생년월일 `BirthDateInput` + 전 적용 | 대표 추가 지시 |
| P0 | 공통 `SignupInfoForm` + `/signup/confirm` + 로그인 소셜 신규를 이 화면으로 연결(Google 웹/네이티브·Apple) | P1-3, P0-3 흐름 |
| P0 | 초대 랜딩: 인증 후 확인 화면(Google·Apple), #148 생년월일 입력 유지, 상담사 카드 | D4, P0-1 |
| P0 | 온보딩 `RoleGuard` 3곳 + 안내 | P1-4 |
| P0 | 약관 3종 "보기" 링크 | P1-3 |
| P1 | 로그인 역할 불일치 안내·이동, 상담사/기관 탭 소셜 안내(D1 문구·D2 노출), iOS Apple 동반 | P1-1·P1-2 |
| P1 | 코드 입장 후 가입 유도(선택, D7), 앱 기관 문의 → 웹 문의 안내(D6), 만료/무효/사용된 초대 구분 | P1-8, P2-4, P2-7 |
| P1 | 스타일 통일(가입·초대·소속 초대 보라+자연 배경 카드) | P2-3 |
| P2 | 상담사 소셜 신규 서버 허용(D1), 이메일 가입을 SignupInfoForm 으로 교체, 온보딩 중복 단계 제거 | 보고만 |

## 3. Task (3~10분 단위)

| # | Task | 파일 | 산출 |
|---|---|---|---|
| T1 | `birth-date.ts` 순수 로직(포맷·파싱·검증) + vitest | `lib/auth/birth-date.ts`, `tests/birth-date.test.ts` | RED→GREEN |
| T2 | `BirthDateInput` 컴포넌트 + vitest(입력·붙여넣기·지우기·검증) | `components/auth/BirthDateInput.tsx`, `tests/birth-date-input.test.tsx` | |
| T3 | 가입·초대·온보딩의 생년월일 교체 | Register{Client,Counselor}, InviteLanding, ClientEssentials, CounselorOnboarding, ClientOnboarding | `type="date"` 생년월일 0건 |
| T4 | 설정·프로필 수정 생년월일 교체 | settings/*, counselor-info-editor | 나이 제한 없는 모드 |
| T5 | `ConsentCheckList` 전문 보기 링크 | `ConsentCheckList.tsx` | |
| T6 | `SignupInfoForm` + `social-signup` 스토어 + `/signup/confirm` 페이지·라우트 | components/auth, stores, pages, App.tsx | |
| T7 | LoginPage 소셜(Google 웹·네이티브·Apple) 422 → 확인 화면 이동으로 교체 | LoginPage, AppleLoginButton, GoogleLoginButton | 기존 인라인 입력란 제거 |
| T8 | InviteLandingPage 를 인증→확인 화면 구조로 교체(#148 유지) | InviteLandingPage | 초대 토큰 유지 |
| T9 | 온보딩 3곳 RoleGuard + 안내 | App.tsx, RoleGuard | |
| T10 | (P1) 역할 불일치 이동·상담사/기관 탭 소셜 안내·iOS Apple 동반 | LoginPage, authStore | |
| T11 | (P1) 코드 입장 가입 유도·앱 기관 문의 안내·초대 상태 구분·스타일 통일 | CodeEntryPage, RegisterPage, InviteLandingPage | |
| T12 | 테스트 정리·tsc·eslint·Playwright 모바일 캡처(390×844) 시안 대조 | tests, 임시 스크립트 | summary.md |

## 4. 테스트 전략
- vitest: T1~T2 단위, 가입 흐름(`SignupInfoForm` 제출 조건, 확인 화면 진입·재제출, 초대 토큰 전달, RoleGuard).
- 기준선: 변경 전 `npx vitest run` 실패 파일 수 기록 → 변경 후 신규 실패 0 확인(기존 8파일 기준선).
- `npx tsc --noEmit -p frontend/tsconfig.app.json`, `npx eslint src/`.
- Playwright 모바일: `/signup/confirm`·초대·로그인 소셜 입력·생년월일 입력 자동 구분점을 로컬 mock API 로 캡처해 시안 대조.
- 서버 변경 없음 → pytest 비대상(변경이 생기면 `~/.hermes/cache/scratch/mbvenv`로 실행, 단일 alembic head 확인).

## 5. 위험·메모
- Google 웹 팝업 `storagerelay` 400(P0-2)은 실기기 재현 필요 → 코드 변경은 redirect 방식 검토만 하고 실기기 확인 전 변경 금지(보고).
- 앱 Google 신규 422 반복(P0-3)은 별도 FIX 워커 담당. 본 SDD 는 "422 → 확인 화면" 흐름만 바꾸고 id_token 재전송 로직은 건드리지 않는다. FIX 가 먼저 머지되면 rebase 후 충돌 해소.
- 앱 재빌드: 프론트 변경이므로 네이티브 앱은 웹 번들 재빌드·재배포 필요(Capacitor 번들). 서버 변경 없음.
