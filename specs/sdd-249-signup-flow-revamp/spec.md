# SDD-249 — 회원·상담사·기관 가입 흐름 재정비

- 상태: Stage ① Spec — 점검·기획 완료, 대표 go/no-go 대기
- 브랜치: `sdd/249-signup-flow-revamp`
- 작성일: 2026-10-28
- 범위: 점검 + 기획안까지. 구현·배포 없음. 앱 "Google 신규가입 422 반복"은 별도 FIX 워커 담당(중복 수정 금지, 본 문서는 흐름 관점만 반영).
- 캡처: `~/.hermes/share/mb-signup-revamp-20261028/audit/` (dev 웹, 390×844 `-m` / 1440×900 `-d`, 48장)

## 1. 문제 정의

대표 지시: "앱·웹 회원가입 페이지의 디자인과 프로세스가 이상하다. 회원·상담사·기관 모두 재점검."

점검 결과 가입 진입 경로 31개가 서로 다른 시기에 만들어져 다음 문제가 누적됨.

1. 같은 정보(생년월일·동의)를 받는 방식이 경로마다 다름(입력 위치·형식·타이밍·약관 링크 유무).
2. 소셜(Google·Apple) 신규가입은 "일단 시도 → 422 → 입력란 노출" 구조라 사용자가 왜 실패했는지 모르는 막다른 길이 생김.
3. 역할(회원/상담사/기관)별 가입 허용 범위가 화면에 안 보임(상담사·기관은 소셜 신규 생성 불가인데 안내 한 줄뿐).
4. 화면 스타일이 3종 혼재: 로그인=보라 배경 이미지, 가입·상담사·기관=흰 캔버스+토큰, 초대 랜딩=하드코딩 hex.
5. 온보딩 화면에 역할 가드가 없어 다른 역할 계정도 진입(캡처 확인).

## 2. 목표

- 어떤 경로로 들어와도 "역할 선택 → 인증 → 필수정보·동의 → 역할별 온보딩 → 홈"의 같은 뼈대를 따른다.
- 생년월일·동의·약관 링크를 모든 가입 경로에서 같은 컴포넌트·같은 위치에서 받는다.
- 소셜 신규가입은 인증 직후 공통 "가입 정보 확인" 단계로 보낸다(422 후 임시 입력란 방식 폐기).
- 막다른 길(초대 Google 가입·역할 불일치 403·상담사/기관 소셜 신규 차단)을 없애고 다음 행동을 안내한다.
- 앱/웹 차이는 "기능 유무"만 두고, 화면 구조·문구는 통일한다.
- 점수·효능 표현은 쓰지 않는다(웰니스 리포트 원칙 유지).

## 3. 현황 — 가입·첫 로그인 진입 경로 (31개)

범례: 웹=W, 앱(Capacitor iOS/Android)=A. 근거는 `frontend/src` 기준.

### 3.1 회원
| # | 경로·진입 | W/A | 핵심 동작 | 근거 |
|---|---|---|---|---|
| M1 | `/login?role=client` 이메일 로그인 | W·A | 가입자 로그인 | `pages/LoginPage.tsx:300` |
| M2 | 로그인 회원탭 Google | W | 팝업 OAuth(access_token). 신규면 422 후 생년월일·동의 노출 | `LoginPage.tsx:112-156` |
| M3 | 로그인 회원탭 Google | A | 시스템 선택기 id_token. 신규 422 흐름 동일 | `LoginPage.tsx:158-181`, `lib/native/google.ts` |
| M4 | 로그인 회원탭 Apple | A(iOS) | nonce+id_token. 422 코드(BIRTH_DATE_REQUIRED 등)로 입력란 노출 | `components/auth/AppleLoginButton.tsx:44-80` |
| M5 | `/register` 가입 유형 선택 | W·A | 회원/상담사/기관 카드(앱은 기관 카드 숨김) | `pages/RegisterPage.tsx:64-83` |
| M6 | `/register/client` 이메일 가입 | W·A | ①이메일 OTP ②약관 ③정보(이름·성별·생년월일·전화·비밀번호·상담사코드) | `pages/register/RegisterClientPage.tsx:95-236` |
| M7 | `/register/client?invite_token` 초대 이메일 가입 | W·A | M6과 동일하되 상담사코드 입력 생략 | `RegisterClientPage.tsx:232-247` |
| M8 | `/invite/:token` 상담사 초대 랜딩 | W(링크)·A(딥링크 여부 미확인) | 약관 체크 + Google 버튼, 보조링크 "이메일로 가입하기" | `pages/clients/InviteLandingPage.tsx:100-165` |
| M9 | `/onboarding/client` 4단계 | W·A | 이메일 가입자: 기본→상세(성별·생년월일)→프로필→상담사 연결 | `pages/onboarding/ClientOnboardingPage.tsx:98-310` |
| M10 | `/onboarding/client/essentials` 1페이지 | W·A | Google 가입자: 이름·성별·생년월일·전화 | `pages/onboarding/ClientEssentialsPage.tsx`, `lib/auth-routing.ts:21-24` |
| M11 | `/join` 코드 입장(비로그인) | W·A | 코드로 클래스 입장. 가입 유도 링크 없음 | `pages/class/CodeEntryPage.tsx` |
| M12 | `/class/:sessionId/enter`, `/class-members/:classId` | W·A | 게스트 입장·클래스 멤버십 | `App.tsx:172,190` |
| M13 | `/login/client` | W·A | `/login?role=client`로 리다이렉트 | `pages/ClientLoginPage.tsx` |
| M14 | 앱 `/` 진입 | A | 랜딩 없이 RoleRouter → 로그인 | `App.tsx:131-134` |
| M15 | `/forgot-password`, `/reset-password` | W·A | 비밀번호 재설정 | `App.tsx:197-198` |

### 3.2 상담사
| # | 경로·진입 | W/A | 핵심 동작 | 근거 |
|---|---|---|---|---|
| C1 | 로그인 상담사탭 이메일 | W·A | 로그인 | `LoginPage.tsx:303` |
| C2 | 로그인 상담사탭 Google·Apple | W·A | 기존 계정만. 신규는 서버 403(사전 등록 없음). 화면 안내는 12px 한 줄 | `LoginPage.tsx:303`, `backend/app/api/v1/auth.py`(wants_elevated 403) |
| C3 | `/register/counselor` 유형 선택 | W·A | 기관 소속 / 개인 상담사 | `pages/register/RegisterCounselorPage.tsx` |
| C4 | `/register/counselor` 기관 소속 안내 | W·A | 가입 불가, "담당자 초대를 기다리세요" 안내만 | 같은 파일 mode='org' |
| C5 | `/register/counselor` 개인 상담사 신청 | W·A | 이메일 OTP+이름·생년월일·전화·표시명·전문분야·개인정보 동의 1개 → 승인 대기 | 같은 파일 `:85-125` |
| C6 | `/set-password?token&type=counselor` | W | 기관 초대 상담사 최초 비밀번호 설정 후 자동 로그인 | `pages/SetPasswordPage.tsx` |
| C7 | `/membership-invite?token` | W | 기존 상담사 소속 추가 수락(비밀번호 불필요) | `pages/MembershipInvitePage.tsx` |
| C8 | `/onboarding/counselor` 4단계 | W·A | 기본→상세→자격 증빙→프로필 | `pages/onboarding/CounselorOnboardingPage.tsx` |
| C9 | `/profile/professional` | W·A | 가입 후 전문 프로필 수정 | `App.tsx:340` |

### 3.3 기관
| # | 경로·진입 | W/A | 핵심 동작 | 근거 |
|---|---|---|---|---|
| O1 | 로그인 기관탭 이메일 | W·A | 소셜 버튼 없음(이유 안내 없음) | `LoginPage.tsx:304`, `:183` |
| O2 | `/register/organization` 도입 문의 | W(앱 카드 숨김) | 기관명·담당자·연락처·이메일·문의·동의 1개 → 접수 | `pages/register/RegisterOrganizationPage.tsx` |
| O3 | `/set-password?token`(type 없음) 관리자 지정 | W | 담당자 최초 비밀번호 설정 → `/dashboard/org` | `SetPasswordPage.tsx:60-80` |
| O4 | `/set-password?type=reset` | W | 관리자 비밀번호 재설정 | 같은 파일 |
| O5 | `/o/:org_code`, `/org/search`, `/org/requests` | W·A | 기관 공개 페이지·검색·가입 요청 내역(검색은 비로그인 시 로그인 이동) | `App.tsx:173,218,221` |
| O6 | `/org/register` | W | `/register/organization`으로 리다이렉트 | `App.tsx:220` |

### 3.4 공통
| # | 경로·진입 | 비고 |
|---|---|---|
| X1 | 이메일 인증(OTP 6자리) | `RegisterClientPage`·`RegisterCounselorPage` 내부 단계. 별도 `/verify-email` 경로 없음 |
| X2 | 플랫폼 관리자 `/login?role=platform_admin` | 가입 아님(Google Workspace). 범위 제외 |

합계: 회원 15 + 상담사 9 + 기관 6 + 공통 1 = **31개**(X2 제외).

## 4. 문제 목록 (P0 3 / P1 8 / P2 7)

심각도: P0=가입 불가·막다른 길, P1=혼란·오류 유발, P2=일관성·품질.

| ID | 단계·화면 | 문제 | 근거 | 심각도 |
|---|---|---|---|---|
| P0-1 | 초대 `/invite/:token` Google 가입 | 생년월일 입력란이 없음. 서버가 신규 가입에 생년월일을 요구(422 BIRTH_DATE_REQUIRED)하므로 신규 회원은 오류 문구만 보고 진행 불가 | `InviteLandingPage.tsx:147-152`, `GoogleLoginButton.tsx:33-39`(birthDate 인자 없음), `signup_policy_service.py:66-72` | P0 |
| P0-2 | 아이폰 웹 Google | 팝업(`useGoogleLogin` 기본 popup)이 `storagerelay` 400으로 실패 | `LoginPage.tsx:112`, `GoogleLoginButton.tsx:27` — 재현은 실기기 필요(캡처 불가) | P0 |
| P0-3 | 앱 Google 신규가입 | 생년월일 입력 후에도 422 반복 — **별도 FIX 워커 처리 중**. 흐름 관점: 422 후 재시도 구조가 원인 영역 | `LoginPage.tsx:158-181`(앱은 id_token 재요청 시 동일 입력 재전송) | P0(타 워커) |
| P1-1 | 로그인 역할 탭 | 계정 역할과 탭이 다르면 "선택한 로그인 유형과 계정 유형이 다릅니다" 403만 표시, 올바른 탭으로 이동시키는 버튼 없음 | `stores/authStore.ts:88-92` | P1 |
| P1-2 | 상담사·기관 탭 소셜 | 상담사: "기존 상담사 계정만" 12px 한 줄. 기관: Google 버튼 자체가 숨겨지고 이유 없음. 상담사 신규 가입 경로(C3)로 가는 링크는 있으나 기관 쪽엔 없음 | `LoginPage.tsx:303,304,183` | P1 |
| P1-3 | 소셜 신규가입 동의 UI | 시도 후 422가 나야 생년월일·동의 노출. "이용약관"·"민감정보 처리"는 링크가 아닌 밑줄 텍스트(개인정보 처리방침만 링크). 모바일에선 하단 고정 코드 입장 카드와 겹침 가능 | `LoginPage.tsx:214-239,226` | P1 |
| P1-4 | 온보딩 역할 가드 | `/onboarding/client`·`/essentials`·`/counselor`에 RoleGuard 없음. 캡처에서 상담사 계정이 회원 온보딩, 회원 계정이 상담사 온보딩 화면에 진입함 | `App.tsx:207-209`, 캡처 `21~23-*-as-*` | P1 |
| P1-5 | 회원 이메일 vs 소셜 | 이메일 가입은 상담사 코드 필수(초대 제외), 소셜 가입은 코드 없이 가입 가능 → 같은 "회원"인데 요구가 다름 | `RegisterClientPage.tsx:241`, `LoginPage.tsx` | P1 |
| P1-6 | 약관·동의 위치 | 이메일 회원=2단계 독립 화면(3종), 소셜=422 후 로그인 하단, 초대=랜딩 상단, 상담사 개인=체크 1개, 기관=체크 1개. 항목 수·문구·위치가 모두 다름 | `RegisterClientPage.tsx:369`, `LoginPage.tsx:214`, `InviteLandingPage.tsx:142`, `RegisterCounselorPage.tsx:115` | P1 |
| P1-7 | 초대 랜딩 후 이동 | 초대(회원용) 페이지가 상담사 역할 분기(`/onboarding/counselor`)를 포함해 의도 불명. 이메일 보조 링크는 쿼리 이름이 `token`/`type=client`로 다른 화면의 `invite_token`과 혼재 | `InviteLandingPage.tsx:51-68,158` | P1 |
| P1-8 | 앱 기관 문의 | 앱에서는 기관 카드가 사라질 뿐 "웹에서 신청" 안내가 없고, 앱 진입 시 랜딩이 없어 가입 허브가 `/register`만 존재 | `RegisterPage.tsx:77`, `App.tsx:131` | P1 |
| P2-1 | 생년월일 입력 방식 | 3종: `<input type=date>`(가입·소셜·essentials), 연/월/일 3개 select(회원 온보딩), 코드입장 텍스트 | `RegisterClientPage.tsx:429`, `ClientOnboardingPage.tsx:583-603` | P2 |
| P2-2 | 날짜 표시 형식 | 브라우저 로케일에 따라 `mm/dd/yyyy` 노출(캡처 `22-onboarding-essentials`) | 캡처 | P2 |
| P2-3 | 스타일 3종 혼재 | 로그인·소속초대·온보딩=보라 배경 이미지, 가입·상담사·기관=흰 캔버스+테마 토글, 초대 랜딩=`#FAFAFA`·`#5F0080` 하드코딩·이모지 아이콘 | 캡처 `02`/`05`/`09`, `InviteLandingPage.tsx:76` | P2 |
| P2-4 | 만료·무효 초대 문구 | 404(없는 초대)도 "초대가 만료되었습니다"로 표시, 다음 행동은 "홈으로"뿐 | `InviteLandingPage.tsx:46,100-115`, 캡처 `09` | P2 |
| P2-5 | 가입 단계 중복 | 이메일 회원은 가입 화면에서 이름·성별·생년월일·전화를 받고 온보딩 Step1~2에서 다시 받음(값은 불러오지만 단계는 반복) | `RegisterClientPage.tsx:230-236`, `ClientOnboardingPage.tsx:278-303` | P2 |
| P2-6 | 가입 화면 부가 요소 | 가입 선택 화면에 테마 토글, 뒤로가기 없음. 브랜드 표기 "Mind Breeze"/"MIND BREEZE" 혼용 | 캡처 `05`,`06` | P2 |
| P2-7 | 코드 입장 후 가입 유도 | 비로그인 코드 입장 완료 후 "가입하면 기록이 남아요" 같은 안내·링크가 코드에 없음 | `CodeEntryPage.tsx` | P2 |

## 5. 목표 흐름도

공통 뼈대: `역할 선택 → 인증 → 필수정보·동의 → 역할별 온보딩 → 홈`

### 5.1 회원
```
[진입] 로그인 회원탭 / /register / 상담사 초대 링크 / (앱) 첫 실행
   │
[인증 선택] 이메일(OTP) · Google · Apple(iOS)
   │  └ 초대 링크로 왔으면 상담사 카드 표시(화면 상단 고정)
[가입 정보 확인 — 공통 단계]  이름 · 성별 · 생년월일 · 약관 3종 · (선택) 뇌파·연구 · 전화(선택)
   │
[상담사 연결]  초대=자동 연결 확인 / 코드 입력 / 건너뛰기(결정 필요 D-3)
   │
[온보딩 마무리] 프로필 → 홈(/app)
```

### 5.2 상담사
```
[로그인 상담사탭] ── 계정 있음 → 로그인
   └ 계정 없음 → "상담사 가입" 한 화면
        ├ 기관 소속: "기관 담당자 초대 필요" 안내 + 초대 메일 확인법 + 기관 문의 링크
        └ 개인 상담사: 이메일 OTP → 가입 정보 확인(공통 단계) → 신청 → 승인 대기
초대 메일 링크 → 비밀번호 설정(/set-password) → 가입 정보 확인(생년월일 등 누락분) → 상담사 온보딩(자격 증빙·프로필)
기존 상담사 소속 추가 → /membership-invite (수락 후 로그인)
```

### 5.3 기관
```
[기관 도입 문의] 웹 /register/organization → 접수 확인(담당자 연락 안내)
[관리자 지정] 운영자가 계정 생성 → 메일 링크 → /set-password → 기관 대시보드
[기관 로그인] 기관탭 이메일 로그인 (소셜 비노출 이유 안내)
앱: 기관 문의는 "웹에서 신청" 안내 + 링크
```

## 6. 화면 목록 (재정비 대상)

| # | 화면 | 대상 경로 | 변경 요지 |
|---|---|---|---|
| S1 | 가입 유형 선택 | `/register` | 로그인 화면 스타일과 통일, 3개 카드(회원·상담사·기관), 앱은 기관 카드 대신 웹 안내 |
| S2 | 로그인(3탭) | `/login` | 탭 불일치 시 안내·이동, 상담사·기관 탭 소셜 안내 강화 |
| S3 | 이메일 인증 | 가입 내부 | OTP 입력·재발송·남은 시간·오류 상태 정의 |
| S4 | 가입 정보 확인(공통) | 신규 | 소셜·초대·이메일 공통. 생년월일·약관·선택동의 한 화면 |
| S5 | 회원 이메일 가입 | `/register/client` | S3+S4+비밀번호 구성으로 단순화 |
| S6 | 상담사 가입 선택·개인 신청 | `/register/counselor` | 기관/개인 분기 안내, 개인은 S3+S4+전문분야 |
| S7 | 기관 도입 문의 | `/register/organization` | 접수 완료 화면, 동의 위치 통일 |
| S8 | 초대 랜딩 | `/invite/:token` | 상담사 카드+S4 연동, 만료/무효/이미 사용 구분 |
| S9 | 비밀번호 설정 | `/set-password` | 상담사·기관·재설정 3유형 문구 구분 |
| S10 | 소속 초대 수락 | `/membership-invite` | 스타일 통일, 오류 상태 |
| S11 | 회원 온보딩 | `/onboarding/client` | 중복 단계 제거, 역할 가드 |
| S12 | 상담사 온보딩 | `/onboarding/counselor` | 역할 가드, 진행 표시 통일 |
| S13 | 코드 입장 후 | `/join` | 가입 유도 배너 |
| S14 | 소셜 오류·안내 상태 | 공통 | 역할 불일치·계정 연결 필요(409)·탈퇴 처리 중·나이 제한 문구 표준화 |

## 7. 입력 항목 표준

| 항목 | 표준 |
|---|---|
| 생년월일 | 모든 가입 경로에서 필수(회원·상담사 개인). 입력은 한 컴포넌트(연·월·일 입력, 한국식 `YYYY.MM.DD` 표기, 만 14세 미만 안내 문구 통일). 검증은 `lib/auth/age.ts` 재사용 |
| 약관·동의 | 필수 3종(이용약관·개인정보 처리방침·민감정보 처리) + 선택 2종(뇌파 수집, 비식별 연구 활용). `ConsentCheckList` 단일 컴포넌트, 항목마다 전문 보기 링크. 위치는 항상 "가입 정보 확인" 화면 |
| 상담사 개인·기관 문의 | 필수 동의 항목 수·문구를 법무 확인 후 확정(결정 D-5) |
| 이름·성별·전화 | 이름·성별 필수, 전화 선택(`010-0000-0000` 자동 하이픈). 이미 받은 값은 후속 단계에서 재요구하지 않음 |
| 이메일 | 불변 아이디. 가입 후 변경 불가를 입력 화면에 고지 |
| 비밀번호 | 영문+숫자+특수문자 8자 이상, 확인 입력, 규칙 상시 표시 |

## 8. 소셜 가입 공통 단계 설계

1. 소셜 인증 직후 서버에 "신규 여부 확인" 요청(계정 생성 없음). 기존 계정이면 즉시 로그인.
2. 신규이면 S4 "가입 정보 확인" 화면으로 이동. 이메일·이름은 소셜에서 채워 표시, 생년월일·동의 입력.
3. 제출 시에만 계정 생성. 실패(409 연결 필요·탈퇴 처리 중·나이 제한)는 S14 표준 문구.
4. 웹·앱·초대·로그인 탭 모두 같은 화면 사용. 앱은 id_token, 웹은 팝업 대신 redirect 방식 검토(P0-2 대응).
5. 역할은 진입 경로가 정함(회원=가입 가능, 상담사·기관=신규 생성 불가 → 안내 화면).
> 서버 계약(사전 확인 API·재시도 시 토큰 재사용)은 Stage ② Plan에서 확정. P0-3 FIX 워커 결과와 정합 확인 필요.

## 9. 앱 / 웹 차이 처리

| 항목 | 웹 | 앱(Capacitor) | 방침 |
|---|---|---|---|
| Google | 팝업 OAuth | 시스템 선택기 id_token | 가입 정보 확인 단계는 동일 화면 |
| Apple | 미제공 | iOS만 | 앱 Google 노출 시 iOS는 Apple 동반(스토어 규정 확인 필요) |
| 기관 도입 문의 | 가능 | 카드 숨김 | 앱은 "웹에서 신청" 안내 표시 |
| 첫 화면 | 랜딩 | 로그인(코드 입장 카드) | 가입 진입은 로그인 화면 "회원가입"과 `/register`로 통일 |
| 초대 링크 | 브라우저 | 딥링크 지원 여부 미확인 | Stage ② 점검 항목 |
| 날짜 입력 | 브라우저 date | 네이티브 date | 공통 컴포넌트로 동일 표시 |

## 10. 비범위

- 앱 Google 신규가입 422 반복 수정(별도 FIX 워커)
- 로그인 화면 자체 리디자인(탭·이메일 로그인 UI는 가입 연동 부분만)
- 플랫폼 관리자 로그인, 신규 소셜 제공자 추가
- 약관·개인정보 처리방침 본문 개정
- 서버 정책 변경(가입 허용 역할 확대 등)은 결정 후 별도 SDD
- 스토어 심사·운영 서버·develop/main 변경

## 11. 결정 필요 항목 (비즈니스 결정만)

| # | 항목 | 현재 사실 |
|---|---|---|
| D-1 | 상담사 소셜(Google·Apple) 신규가입 허용 여부 | 현재 서버가 사전 등록된 계정만 허용(신규는 403). 개인 상담사는 이메일 신청 후 승인 방식 |
| D-2 | 기관 관리자 소셜 로그인 제공 여부 | 현재 기관탭은 이메일만. 계정은 운영자 지정 방식 |
| D-3 | 상담사 코드 없는 회원 가입 허용 | 이메일 가입은 코드 필수(초대 제외), 소셜 가입은 코드 없이 가능. 가입 후 `/app`은 상담사 미연결도 진입 가능 |
| D-4 | 상담사가 보낸 회원 초대의 Google 가입 유지 여부 | 현재 초대 랜딩에 Google 버튼 있음(생년월일 입력 불가로 신규 가입 막힘). 이메일 가입 링크도 병행 |
| D-5 | 상담사 개인 신청·기관 문의의 필수 동의 항목 구성 | 현재 개인정보 1개만 받음. 회원은 필수 3종+선택 2종 |
| D-6 | 앱에서 기관 도입 문의 안내 방식 | 현재 카드만 숨김. 웹 외부 링크 이동은 스토어 정책 영향 가능 |
| D-7 | 코드 입장(비로그인) 후 가입 유도 문구 노출 여부 | 현재 없음 |

## 12. 다음 단계

1. 대표 go/no-go (본 문서 + `plan-summary.md` + 디자인 시안)
2. Stage ② Plan: 서버 계약(신규 여부 확인 API)·컴포넌트 분해·Task
3. 디자인 시안: `design-brief.md` 기준 시안 제출(Phase 2)
4. Stage ③ Verify 승인 후 구현

## 부록 — 점검 방법
- 코드 전수: `App.tsx` 라우트, `LoginPage`, `Register*`, `InviteLandingPage`, `Onboarding*`, `SetPasswordPage`, `MembershipInvitePage`, `AppleLoginButton`, `GoogleLoginButton`, `authStore`, `backend/app/api/v1/auth.py`
- 캡처: Playwright, dev 웹, 비로그인 16화면 × 2뷰포트 + 시험 계정 2종 로그인 후 온보딩 3화면. 가입 제출·메일 발송 없음
- 앱 화면은 실기기 캡처 불가 → 코드(`isNativeApp` 분기)로만 확인(`lib/native/*`)
- 아이폰 웹 Google 400(P0-2)은 실기기 재현 필요

## 대표 결정 (2026-10-28)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 상담사 Google·Apple 신규가입 | 허용 (사전 등록 없이 소셜로 상담사 가입 가능) |
| D2 | 기관 관리자 소셜 로그인 | 제공 (Google·Apple) |
| D3 | 상담사 코드 없는 회원 가입 | 기존 유지 (이메일=코드 필수, 소셜=코드 불필요). 후속 프로세스 복잡도 때문에 변경하지 않음 |
| D4 | 상담사 초대 링크 Google 가입 | 유지 |
| D5 | 상담사 개인 신청·기관 문의 필수 동의 | 현행 유지 (개인정보 1개). 계약 시 서류로 받음 |
| D6 | 앱의 기관 도입 문의 | 웹 문의(랜딩 기관 가입 문의 모달)로 연결 |
| D7 | 비로그인 코드 입장 후 가입 유도 | 노출하되 선택(필수 아님). 문구 취지: "리포트를 계속 관리하고 편하게 클래스에 계속 참여하려면 가입하세요" |
