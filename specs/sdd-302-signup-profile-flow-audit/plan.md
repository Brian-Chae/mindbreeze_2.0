# SDD-302 — 현황 근거 및 개선 계획

## 1. 조사 기준
2026-11-05 체크아웃 정적 조사. 아래 경로는 저장소 기준, 행은 해당 커밋 기준이다. 네트워크 가입·운영 DB·개인정보 조회 없음. 기존 SDD-249 spec/summary와 SDD-245 summary를 현재 코드와 대조했다. 기존 문서의 ‘완료’ 주장은 현행 코드 확인 범위에서만 인용한다.

## 2. 가입·진입 경로 전수표
단계 수는 제품 내부 입력 화면 수이며 OAuth 외부 계정 선택 UI는 제외한다. 일반 온보딩은 최대 4단계지만 서버에 저장된 step 키에 따라 재개 지점이 달라진다.

| 경로 | 진입·단계 | 입력·분기 | 현행 근거 |
|---|---|---|---|
| 회원 이메일 | /register → /register/client, 3화면(인증→동의→정보) + 온보딩 잔여 단계 | 이메일·OTP·이름·성별·생일·비밀번호/확인·코치 코드; 전화 선택 | frontend/src/pages/register/RegisterClientPage.tsx:204–262,298–303 |
| 회원 Google 웹 | /login 회원탭 → OAuth → /signup/confirm 1화면 → essentials 1화면 | 가입 확인: 생일·필수3/선택2 동의; essentials: 이름·성별·생일·선택 전화 | frontend/src/pages/SignupConfirmPage.tsx:31–64; frontend/src/pages/onboarding/ClientEssentialsPage.tsx:36–52 |
| 회원 Google 앱 | 네이티브 인증 후 위와 동일 | 공급자 인증 방식만 다름, 앱 실기기 미검증 | frontend/src/pages/LoginPage.tsx (loginGoogle 호출), frontend/src/lib/native/google.ts |
| 회원 Apple | iOS 네이티브 → 가입 확인 1화면 → 일반 온보딩 최대4 | Google만 essentials 분기이므로 Apple은 일반 경로 | frontend/src/lib/auth-routing.ts:12–19; frontend/src/components/auth/AppleLoginButton.tsx |
| 초대 소셜 신규·기존 미진행 | /invite/:token → 소셜 → 신규면 가입 확인 → 일반 온보딩 | Google도 source=invite로 일반 경로; 연결 정보 유지 | frontend/src/pages/SignupConfirmPage.tsx:57–64; frontend/src/pages/clients/InviteLandingPage.tsx:61–74 |
| 초대 이메일 | 초대 → /register/client?token=…&type=client&code=… | 이메일 3단계, 코드 입력 생략; 초대 연결 성공 별도 확인 필요 | frontend/src/pages/clients/InviteLandingPage.tsx:133–136; backend/app/api/v1/auth.py:474–483 |
| 코치 이메일 로그인 | /login 상담사탭 | 진행 false면 코치 온보딩 최대4(기본·상세·자격·프로필) | frontend/src/lib/auth-routing.ts:11; frontend/src/pages/onboarding/CounselorOnboardingPage.tsx |
| 코치 개인 가입 신청 | /register/counselor, 유형 선택→신청 폼→접수 안내 | 이메일 OTP·이름·생일·개인정보 동의; 전화/표시명/분야; 승인 절차 별도 | frontend/src/pages/register/RegisterCounselorPage.tsx:103–130 |
| 코치 기관 소속 | /register/counselor 기관 선택→초대 안내 | 자가 가입 대신 기관 초대; /set-password?type=counselor에서 비밀번호 설정 | frontend/src/pages/register/RegisterCounselorPage.tsx; frontend/src/pages/SetPasswordPage.tsx |
| 코치 소셜 | 로그인 상담사탭 Google/Apple | 기존 계정 로그인 가능, 신규 자동 생성 서버403 | backend/app/api/v1/auth.py:872–878,1024–1028 |
| 기존 코치 소속 추가 | /membership-invite?token | 초대 수락, 새 계정 가입과 구분 | frontend/src/pages/MembershipInvitePage.tsx; frontend/src/App.tsx:208 |
| 기관 문의 | /register/organization 1폼→접수 | 기관명·담당자·이메일·개인정보 동의; 전화/문의. 앱은 웹 문의 연결 | frontend/src/pages/register/RegisterOrganizationPage.tsx:43–64; frontend/src/pages/RegisterPage.tsx |
| 기관 관리자 | 지정 초대 → /set-password → 기관 홈 | 비밀번호 설정; 소셜은 지정된 기존 계정 로그인, 신규 자동 생성 차단 | frontend/src/pages/SetPasswordPage.tsx; backend/app/api/v1/auth.py:872–878,1024–1028 |
| 회원 탭 코드 입장 | /login → /join → /class/:sessionId/enter, /class-members/:classId | 플래그 true일 때 로그인 화면 링크 노출. 비로그인 폐쇄 방침과 잔존 경로 구분 | frontend/src/pages/LoginPage.tsx:208,290; frontend/src/lib/feature-flags.ts:33–38; frontend/src/App.tsx:197 |
| 별칭·복구·기관 공개 | /login/client, /org/register, /o/:org_code, /org/search, /org/requests, /forgot-password, /reset-password | 새 가입 화면 추가 없음. 별칭·검색·초대/복구 진입으로 분류 | frontend/src/App.tsx:186–229 |
| 앱 첫 진입·가입 선택 | / 및 /register | 앱 진입 분기·역할 선택, 기관 문의 웹 연결 | frontend/src/App.tsx; frontend/src/pages/RegisterPage.tsx |

SDD-249는 이전 31개 진입 분류를 기록했다. 현재는 /signup/confirm이 추가되고 날짜 입력 공통화·역할 가드·소셜 안내가 반영되어 예전 표를 그대로 현재 사실로 사용하지 않는다. SDD-249 D1(코치 소셜 신규 허용)은 서버에는 반영되지 않았다. D3(이메일 코드 필수)은 유지한다. D7의 비회원 가입 유도는 이후 폐쇄 방침으로 대체할 대상이며 이번 작업에서 변경하지 않는다.

## 3. 반복 입력의 정확한 조건
- 로그인: client && !onboarding_completed → google이면 essentials, 그 외 일반 온보딩. counselor도 false면 별도 온보딩. org_admin은 기관 홈. `frontend/src/lib/auth-routing.ts:3–20`.
- 플래그 정의: OnboardingProgress가 존재하고 completed가 true여야 한다. 프로필 필드의 존재 여부를 즉석 계산하지 않는다. `backend/app/models/user.py:166–168`.
- 서버 전용 처리: complete_onboarding이 진행 객체의 completed를 설정한다. `/auth/users/me` PATCH만으로 바뀌지 않는다. `backend/app/services/onboarding_service.py:56–65`, `backend/app/schemas/auth.py:201–206`.
- Google complete는 step 검사를 면제하고 이름·성별·생일 존재도 해당 분기에서 검사하지 않는다. 이메일/Apple은 step1~4 키 필요. `backend/app/api/v1/onboarding.py:363–386`.
- 일반 Step1은 유효 전화, Step2는 성별·생일을 FE에서 요구. Step3 사진·소개는 비어도 다음 가능. Step4는 일반 흐름에서 코치 매칭 후 처리 버튼 노출. 전체 건너뛰기/영구 숨김 없음. `ClientOnboardingPage.tsx:275–311,778–813`.
- 이메일 가입 서버는 Step1·2, 코드 연결 시 Step4까지 기록한다. 따라서 신규 이메일 계정의 정상 흐름은 대체로 Step3 및 연결 확인만 남는다. ‘모든 이메일 회원이 4화면 재입력’이라고 단정하지 않는다. `backend/app/api/v1/auth.py:464–508`.
- Google 생일은 가입 시 저장되지만 essentials 초기 상태는 이름 외 공백. 정보 PATCH 성공 뒤 complete 실패해도 재로그인 분기는 그대로다. `backend/app/api/v1/auth.py:883–897`, `ClientEssentialsPage.tsx:36–46,59–84`.
- 홈 자체는 기본 RoleGuard에서 onboarding_completed를 검사하지 않는다. 인증·역할과 선택 프로필 차단은 구분해야 한다. `frontend/src/components/auth/RoleGuard.tsx:18–59`, `frontend/src/App.tsx:196`.

## 4. 필수/선택과 기능 영향
| 항목 | 현재 근거 | 제안 |
|---|---|---|
| 이메일·비밀번호·이름·이메일 인증 | backend/app/schemas/auth.py:46–59 | 이메일 가입 필수 유지. 소셜 비밀번호 요구 금지. 이름은 공급자 제공 시 자동 채움, 없으면 입력 |
| 생일 | backend/app/services/signup_policy_service.py:63–85,149–154 | 신규 가입 연령 판정 유지. 이미 저장된 값 재질문 금지 |
| tos/privacy/sensitive | 같은 서비스:34–35,89–104 | 현행 필수 정책 유지, 안내 숨김으로 우회 불가. 법적 필수 범위는 별도 검토 사항 |
| EEG/연구 동의 | backend/app/schemas/auth.py:17–23 | 각각 선택. 뇌파 미착용 회원 서비스 유지 |
| 성별·전화 | backend/app/schemas/auth.py:72–84; backend/app/schemas/onboarding.py:50–65 | 서버 스키마는 선택. FE 강제 완화 후보, 행사 전 검증 범위와 분리 |
| 이미지·소개·고민·관심 | backend/app/schemas/onboarding.py:56–65 | 설정에서 선택 입력 |
| 코치 코드 | backend/app/schemas/auth.py:75–84; RegisterClientPage.tsx:238–255 | 기술적으로 선택이나 기존 이메일 정책 유지. 홈 진입 안내 설정과 연결 권한은 독립 |

회원 클래스 초대는 활성 client 계정 검사(`backend/app/services/class_membership_service.py:105–117`). 회원 입장은 소속·초대·클래스 상태를 검사하며 성별/생일 누락을 이 분기에서 거부하지 않는다(`backend/app/services/session_service.py:2132–2165,2180–2203`). 비회원 경로는 별도 검증이 있다(:2231). EEG 업로드는 소유권·참가 상태·수집 동의 검사(:3460–3485), 안내 숨김과 무관하게 유지한다. 리포트 메타데이터는 성별/생일을 None으로 처리(`backend/app/services/report_service.py:790–807`). 따라서 선택 프로필 누락만으로 핵심 기능을 막을 근거는 이 경로에서 확인되지 않는다. 모든 리포트 템플릿·실측·운영 무영향은 미검증이며 실제 회귀시험이 필요하다.

## 5. 개선 동선과 대안 판단
- 기본안: 신규 가입 필수 확인 → 홈. 프로필은 설정에서 입력. 선택 입력 안내는 차단 모달 대신 홈 카드 1회로 제공한다.
- 이메일 행사 후: 인증 1화면(OTP 포함) → 계정 정보+동의 1화면. 현행 3화면과 잔여 온보딩을 제거. 소셜은 외부 인증 → 공통 가입 확인 1화면 → 홈. 입력이 긴 이메일 화면은 섹션을 나눠 세로 스크롤, 고정 CTA로 내용을 가리지 않는다.
- 소셜 자동 채움: 이름·생일은 실제 저장/공급자 제공값만 사용. Google/Apple이 생일·성별·전화를 준다고 가정하지 않는다. Apple 이름은 첫 인증 제공 여부에 따라 없을 수 있으므로 빈 이름 처리 필요.
- 초대는 상단 코치 정보와 연결 상태를 유지한다. 초대 만료/이메일 불일치는 ‘계정 생성’과 ‘연결’을 따로 안내하고 새 초대 요청 동선을 제공한다.
- ‘나중에 하기’: 선택 입력 화면 CTA 아래 동등한 터치영역의 보조 버튼. 홈 이동, 향후 자동 모달 0회. 30일 뒤 홈 카드 최대1회 후 자동 반복 종료.
- 체크박스 ‘프로필 입력 안내 다시 보지 않기’: 저장/나중에 하기 두 버튼 위. 체크 후 어느 버튼을 눌러도 dismissed 저장. 모든 기기에서 자동 안내 제외. 설정→내 정보→선택 프로필 안내 받기에서만 해제.
- 설정에는 입력 링크를 상시 제공. 리포트 보기는 막지 않으며 추가 프로필 안내를 중복 노출하지 않는다. 측정 동의나 새 필수 약관은 선택 프로필 안내 설정의 영향을 받지 않는다.
- 비교 대안: localStorage만 저장은 서버 변경이 작으나 다른 기기/재설치에서 재노출되어 요구 불충족. completed 일괄 true는 연결·진행 의미 혼합. 별도 서버 속성+분리 라우팅이 기본안이다.

## 6. 제안 데이터/API 계약 (아직 없음)
- 사용자 설정에 `profile_prompt_state: unseen | deferred | dismissed | acknowledged`, `profile_prompt_deferred_at`, `profile_prompt_last_shown_at`, `profile_prompt_reminder_count`, `profile_prompt_revision` 추가 제안. acknowledged는 안내 처리 상태이며 정보 완성도를 뜻하지 않는다.
- `GET /auth/users/me` 응답에 안내 설정 포함. 별도 `PATCH /auth/users/me/profile-prompt`를 제안한다. 클라이언트가 user_id를 지정하지 않고 인증된 본인만 수정한다.
- 나중에 하기: deferred+서버 시각. 다시 보지 않기: dismissed. 직접 설정 켜기: unseen+revision 증가. 두 기기 동시 변경은 revision으로 충돌 감지, 오래된 deferred가 dismissed를 덮지 않도록 한다.
- 홈 안내 노출은 서버의 원자적 claim으로 횟수·시각 기록. 하루 로그인 횟수나 기기 수로 증가하지 않는다. 안내를 본 횟수는 초기1+30일 후1이 상한. 사용자가 설정에서 다시 켠 경우 새 주기로 취급.
- 저장 실패는 ‘선택을 저장하지 못했어요. 다시 시도해 주세요.’와 재시도 제공. 이번 세션 홈 진입은 허용하지만 다기기 유지 성공으로 표시하지 않는다. 로컬 값은 임시 화면 억제만 가능, 서버 저장 대체 불가.
- 로그인 라우팅은 `required_signup_status`(서버에서 계정/현행 동의 정책으로 산출할 제안 필드)와 선택 프로필 안내 상태를 분리. 가입 요건 미충족이면 해당 항목만 확인; 충족이면 홈. 기존 onboarding_completed의 쓰기 의미는 보존하며 읽는 위치를 전수 점검한다.
- 보류/숨김에 동의 일시·코치 연결·프로필 값·인증 공급자를 임의 변경하지 않는다. 계정 로그아웃 시 사용자별 캐시 분리, 익명/다른 계정에 설정 전파 금지.

## 7. 마이그레이션·11/11 범위
| 시점 | 범위 | 실행 전 확인 |
|---|---|---|
| 행사 전 최소안 | 회원 안내 설정 서버 저장, 로그인 분기 분리, 기존 생일 자동 채움, 선택 화면 보조 버튼, 문구·밝은 카드·규격 통일 | 실제 기존 계정의 필수 요건 판정, 모든 로그인/초대 리다이렉트, nullable 프로필 기능 회귀. 서버 작업이므로 ‘CSS만 바꾸면 해결’로 취급하지 않음 |
| 행사 전 제외 | 가입 단계 병합, 코치·기관 신규 소셜 허용, 인증 구조 변경 | 별도 승인/테스트 없이는 포함하지 않음 |
| 행사 후 | 이메일 2화면 통합, 성별/전화 선택 일관화, 공통 폼 재사용, 30일 후 단회 안내 및 원자적 빈도 관리 | 인증·초대·동의 전체 경로 검증 |

기존 사용자는 프로필이 비었다고 전체 강제 온보딩하지 않는다. 기존 진행/동의/연결을 보존하고 안내 설정만 초기화한다. 이미 진행된 계정은 acknowledged, 미진행이며 필수 요건 확인 가능한 계정은 비차단 unseen으로 제안한다. 필수 동의 근거/연령 값 없는 기존 계정은 임의 동의 생성·생일 추정 금지; 기존 가입 시점 정책과 재동의 범위 확인 후 최소 보완 화면을 정한다. 운영 데이터 분포는 조회하지 않아 대상 수 미확정. nullable 컬럼·기본값부터 배포하는 하위호환 전략, 구 앱의 기존 분기 잔존 여부 확인 필요. 기능 플래그로 신규 라우팅만 되돌릴 수 있게 하고 저장된 숨김 선택은 유지한다. 행사 전 검증시간 부족 시 서버 우회 없이 시각·중복 입력 개선만 먼저 적용하는 축소안.

## 8. 향후 구현 검증 계획 (실행 결과 아님)
- 로그인 2회·기기2대·재설치 시 dismissed 유지; 계정 전환 격리; 설정 해제; 저장 실패·오프라인·동시 변경.
- 이메일/Google/Apple × 신규/기존 × 초대 유무, 필수 요건 충족/누락, complete 실패 후 재진입.
- 전화/성별/사진/소개 null로 회원 클래스 참여·EEG 동의 및 업로드·리포트 렌더 확인. 비회원 게이트 별도 검증.
- 필수 동의 미선택, 연령 제한, 만료 OTP/초대, 중복 이메일·계정 연결, 앱 OAuth 복귀 및 새로고침 재인증.
- 390/768에서 키보드·확대·스크롤·접근성 라벨·버튼 포커스 확인. 현재 정적 시안 측정은 design-notes와 validation.json 참고.

행사 전에는 초기 홈 안내 1회 후 자동 재안내 0회를 적용한다. 나중에 하기·숨김을 모두 서버에 기록하고, 30일 후 단회 재안내는 행사 후 원자적 횟수 관리와 함께 도입한다. 초기 노출 역시 계정 기준 서버 기록을 사용한다.

## 9. 오류·재시도 문구
| 상황 | 문구 | 다음 행동 |
|---|---|---|
| OTP 불일치 | 인증번호를 다시 확인해 주세요. | 입력 유지, 번호 수정 |
| OTP 만료 | 인증번호 사용 시간이 지났어요. 새 번호를 받아 주세요. | 재발급 버튼, 서버 재발급 제한 유지 |
| 소셜 인증 취소 | 계정 인증을 취소했어요. 다시 선택할 수 있어요. | 공급자 선택 화면 복귀 |
| 소셜 임시 자격 소실 | 인증 정보가 만료됐어요. 계정을 다시 선택해 주세요. | 재인증, URL/스토리지에 토큰 저장 금지 |
| 중복 이메일·연결 필요 | 같은 이메일의 계정이 있어요. 기존 방법으로 로그인해 주세요. | 기존 로그인, 자동 계정 병합 금지 |
| 초대 연결 실패 | 계정은 만들어졌지만 코치 연결을 확인하지 못했어요. | 홈 이동 허용, 초대한 코치에게 새 링크 요청 안내 |
| 프로필/안내 설정 저장 실패 | 선택을 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요. | 재시도 또는 이번 세션 홈 이동. 다기기 반영 미확정 안내 |
| 필수 동의 누락 | 필수 동의 항목을 확인해 주세요. | 첫 미선택 항목으로 포커스, 개별 전문 링크 |

## 10. 독립 검토 반영
독립 검토자가 지적한 가입→프로필 강제 연결, 저장 버튼의 숨김 선택 무시, 행사 전 빈도 정책 모호성을 수정했다. 가입 CTA는 홈으로, 선택 화면의 저장/보류는 체크 여부에 따라 숨김 상태로 연결한다. 홈 문구는 계정 이용 상태를 나타내며 프로필 저장을 주장하지 않는다. 오류 문구 표도 보완했다. 이 검토는 정적 기획 검토이며 서비스 동작 승인이나 운영 검증이 아니다.
