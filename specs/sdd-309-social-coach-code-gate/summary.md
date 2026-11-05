# SDD-309 — 구현 결과 요약

## 확인한 사실
- 소셜(Google·Apple) 신규 가입은 `/signup/confirm` 에서 코치 코드를 받지 않았고 서버도 코드 없이 계정을 만들었다(이메일 가입만 코드 필수).
- 코치 미연결 회원이 `/app/*` 에 들어가면 `CounselorCodeScreen` 이 탈출 수단 없이 전체 화면을 덮었다.

## 변경
- 서버: `GoogleAuthRequest`/`AppleAuthRequest.counselor_code`. 신규 생성에서 `invite_token`·코드가 모두 없으면 422 `COUNSELOR_CODE_REQUIRED`, 코드가 있으면 `validate_counselor_code` 로 사용자 생성 전 검증(잘못된 코드 404/400/403, User 행 0). 유효하면 `assign_counselor` + 온보딩 step4 + 1:1 채팅방(이메일 가입과 동일). Apple 은 nonce 소비 전에 검증해 같은 토큰으로 재제출 가능. 설정 `social_signup_requires_counselor_code`(기본 true, 시험 환경 fixture 보호용으로만 끔).
- 확인 화면: `SignupConfirmPage` 에 "초대 코치 코드"(6자리) 필수칸(초대 토큰이면 숨김), Google·Apple 요청에 `counselor_code`, 오류는 코드칸 아래 안내·입력 유지. `AppleLoginButton` 이 `COUNSELOR_CODE_REQUIRED` 422 도 확인 화면으로 보냄.
- 코치 코드 화면: `pages/client/counselor-code-screen.tsx` 로 분리, `MemberFlowFrame`(클래스 화면 틀) 사용, 상단 뒤로(이전 화면이 없으면 `/join`), 하단 "다른 계정으로 로그인"(로그아웃 → `/login?role=client`). 연결 정보 조회 실패 화면에도 같은 탈출 수단.
- 클래스 입장(`/join`, `/class/:id/enter`, `/app/classes*`)은 `/app/*` 캐치올 앞에서 라우팅되어 게이트에 걸리지 않음(App.tsx 확인).

## 시험
- 백엔드 신규 10건 + 인증·가입·소셜 관련 826 passed / 43 skipped / 실패 0.
- 프런트 신규 14건(확인 화면 6, 코드 화면 8) + 관련 기존 갱신 후 통과. 전체 vitest 23 failed / 13파일 = 기준선과 동일(SDD-309 관련 0).
- `tsc -b` 0, eslint 오류 0(기존 경고 6).
- 기존 시험 갱신: `social-signup-birth-date`(코드 입력 단계 추가), `client-counselor-code-connect`(jsdom matchMedia 보정). 단언 의미는 유지.
- 캡처: `evidence/` 6장(Before 390 ×2, After 390·768 ×2).

## 미확인
- 실기기, Apple 실제 로그인, 실 Google OAuth, 운영/dev 서버 실호출 — 합성 API 로만 확인.
- 앱(네이티브) 재빌드 필요: 웹 번들이 앱에 포함되는 구조라 앱 배포본에는 재빌드 후 반영.
