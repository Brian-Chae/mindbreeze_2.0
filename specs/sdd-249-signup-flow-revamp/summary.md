# SDD-249 — 구현 결과 (Stage ⑥ Summary)

- 범위: 프론트엔드만. 서버·DB 변경 0건(alembic head 변경 없음, 단일 유지).
- 완료: P0 전부 + P1 전부. 남음: P2(아래 "남은 항목").

## What Was Built

| 파일 | 내용 |
|---|---|
| `lib/auth/birth-date.ts` | 숫자 추출·`YYYY.MM.DD` 포맷·ISO 변환·검증(가입=만 14세 규칙 재사용 / 수정=나이 제한 없음) |
| `components/auth/BirthDateInput.tsx` | 공용 생년월일 입력. 숫자 키패드, 붙여넣기·구분자 정리, 자동 구분점, 입력 중 오류 미표시·blur 시 안내 |
| 생년월일 적용 12곳 | RegisterClient/Counselor, ClientEssentials, CounselorOnboarding, ClientOnboarding(연·월·일 select 3개 제거), settings(PersonalInfo·ClientProfile·SelfInfo), counselor-info-editor, 초대, 소셜 확인 화면. 일정·내보내기·자격 취득/시작/종료일은 미변경 |
| `stores/social-signup-store.ts` | 소셜 인증 자격을 메모리에만 보관(스토리지·URL 미사용) |
| `lib/auth/signup-info.ts`, `components/auth/SignupInfoForm.tsx` | 공통 가입 정보 폼(생년월일 + 필수3·선택2 동의), 제출 가능 판정 |
| `pages/SignupConfirmPage.tsx` + `/signup/confirm` | 소셜·초대 신규 가입 공통 "가입 정보 확인" 화면. 409 연결 필요·탈퇴 처리 중·나이 제한 표준 문구 |
| `LoginPage`, `GoogleLoginButton`, `AppleLoginButton` | 서버 422(신규) → 오류 문구 없이 확인 화면 이동. 기존 인라인 입력란 제거 |
| `InviteLandingPage` | 자연 배경 + 흰 카드, 상담사 카드, Google·Apple, 이메일 가입 링크(`?token=`), 없는 초대/만료·사용됨 문구 구분. #148 생년월일 전달 유지(확인 화면에서 전달) |
| `RoleGuard` + `App.tsx` | 온보딩 3곳 역할 가드. 불일치 시 "이 화면은 ○○용이에요" + 내 홈 버튼 |
| `ConsentCheckList` | 이용약관 전문 보기 링크 추가 |
| `LoginPage` 안내 | 역할 불일치 403 → 올바른 탭 이동 버튼, 상담사 탭 안내(D1), 기관 탭 Google·Apple 노출 + 지정 계정 안내(D2), 사전 등록 없음 403 → 가입/문의 링크 |
| `RegisterPage`·`LandingPage` | 앱: 기관 카드 대신 "웹에서 문의해요" 링크(`/?inquiry=1`) → 랜딩 문의 모달 자동 열림(D6) |
| `GuestSignupPrompt` + `EntryPage` | 비로그인 코드 입장 후 선택 가입 권유, "건너뛰고 계속 참여하기"(D7) |

## 서버 계약 확인 (코드 근거)
- `google_auth`/`apple_auth` 모두 `validate_new_account` 통과 뒤에만 계정 생성 → 422 시점에 계정·nonce 미생성. 같은 자격으로 확인 화면에서 재호출 가능. 신규 API 불필요.
- 상담사·기관 소셜 신규는 서버 403 유지(D1 서버 허용은 정책 변경 → 별도 SDD).

## App Store 심사지침 4.8 정리
- 제3자 소셜 로그인으로 주 계정을 만드는 앱은 개인정보 최소화 등 조건을 갖춘 동등한 로그인 옵션을 함께 제공해야 한다. iOS 앱에서 Google 버튼이 보이는 화면(로그인 3탭·초대 랜딩)에는 Apple 버튼이 항상 같이 렌더된다(`AppleLoginButton`은 iOS 네이티브에서만 나타남). 웹·Android는 해당 없음.

## Test Results

| 시나리오 | 결과 |
|---|---|
| TS1 BirthDateInput (순수 로직 5 + 컴포넌트 7) | PASS 12/12 |
| TS2 적용 grep: 생년월일 `type="date"` 0건 (남은 date는 일정·내보내기·자격 취득/시작/종료일뿐) | PASS |
| TS3·TS4 확인 화면·소셜 연결(Google 웹/네이티브·Apple·초대·직접 진입·409·스토리지 비저장·422 외 오류) | PASS |
| TS5 온보딩 역할 가드 | PASS 3/3 |
| TS6 역할 불일치 이동·기관/상담사 탭 | PASS (login-page 갱신 포함) |
| TS7 코드 입장 권유·앱 기관 문의·초대 상태 구분 | PASS |
| TS8 Playwright 모바일 390×844 캡처 | 가로 넘침 0, 시안 구조(자연 배경·흰 카드·보라 pill) 일치 확인 |
| tsc (`tsconfig.app.json`) | 오류 0 |
| eslint `src/` | 오류 0 (기존 경고 2건) |
| 전체 vitest | 3508 통과 / 실패 17건·8파일 = 구현 전 기준선과 동일 파일 목록. 신규 실패 0 |

기준선(구현 전): 실패 8파일·17건, 통과 3484. 신규 테스트 24건 추가.
기준선 실패 8파일: agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd220-native-release, sdd234-a-mobile-home.

## Debugging Journey
- 컴포넌트 파일이 함수·상수를 함께 export해 eslint `only-export-components` 실패 → `lib/auth/signup-info.ts`로 분리.
- 초대 이메일 가입 링크 쿼리명: 기존 `RegisterClientPage`는 `token` 을 읽는다 → `?token=…&type=client&code=…` 로 유지.
- 서버가 없는 초대와 만료·사용된 초대를 모두 404로 주어 문구로 구분(`만료|사용`).
- 소스 문자열을 단언하던 테스트 2건(연구 고지 파일 목록, 호스트 CTA 스타일) 갱신.
- 워크트리에 node_modules 없음 → 원본 저장소 심링크(커밋 제외). 테스트가 수정하는 `specs/sdd-234-*` 산출물은 매번 원복.

## 남은 항목 (P2 · 보고만)
1. D1 서버 정책: 상담사 Google·Apple 신규가입 허용(승인 대기 계정 생성). 현재 화면은 가입 안내로 유도.
2. 이메일 회원 가입 화면(`RegisterClientPage`)을 `SignupInfoForm` 단일 폼으로 교체, 온보딩 중복 단계 제거(P2-5).
3. 아이폰 웹 Google 팝업 400(P0-2): 실기기 재현 필요 — 코드 변경 보류.
4. 앱 Google 신규 422 반복(P0-3): 별도 FIX 워커 담당. 병합 순서에 따라 `LoginPage` 충돌 가능.
5. 가입 선택·소속 초대 수락·비밀번호 설정 화면의 보라 배경 스타일 통일(P2-3 일부).
6. 상담사 개인 신청·기관 문의 동의 구성(D5 현행 유지).

## Notes for Reviewer
- **앱 재빌드 필요**: 프론트 번들이 바뀌었으므로 네이티브 앱(iOS·Android)은 웹 번들 재빌드·재배포 필요. 서버 배포 불필요.
- 소셜 자격은 메모리에만 있어 확인 화면에서 새로고침하면 로그인 화면으로 돌아간다(안내 후 재인증).
- 실기기 Google·Apple 인증 성공 여부는 검증하지 못했다(모의 API 기준).
