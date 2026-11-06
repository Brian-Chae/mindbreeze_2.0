# SDD-309 — 소셜 가입 코치 코드 필수 입력 및 코치 연결 화면 개선

- 상태: Stage ① Spec
- 브랜치: `sdd/309-social-coach-code-gate` (base develop 4854aa84)
- 작성일: 2026-11-05

## 배경 (대표 지시)
구글·애플 로그인에는 코치 코드 입력이 없다(이메일 가입에는 있음). 코치 코드는 반드시 받아야 한다. 또한 코치 코드를 안 넣은 채 리포트·채팅 등에 들어가면 뜨는 코치 코드 화면이 클래스 화면 디자인이 아니고 뒤로 가기가 없어 앱을 꺼야 한다.

## 확인된 현황
- 이메일: `RegisterClientPage` Step3 "초대 코치 코드"(6자리) 필수 + `/auth/counselor-code/check`(OTP 토큰 필요). 서버 `register_client` 가 `validate_counselor_code` 후 연결·온보딩 step4 마킹.
- 소셜: `/signup/confirm`(`SignupConfirmPage`)은 생년월일·성별·동의만 받음. 서버 `google_auth`·`apple_auth` 신규 생성은 `counselor_code` 를 받지 않음(초대 토큰만 연결).
- 코치 미연결 회원: `ClientAppPage` 의 `CounselorCodeScreen` 이 `/app/*`(리포트·알림 등)에서 강제 표시, 탈출 수단 없음.

## 범위
1. 소셜(Google·Apple) **신규 가입**에 코치 코드(6자리) 필수화. 초대 토큰(`invite_token`) 가입은 면제. 기존 가입자 로그인·상담사/기관 로그인은 불변.
2. 코치 미연결 기존 회원용 코드 화면을 클래스 화면(`MemberFlowFrame`) 계열로 통일하고 뒤로 가기 + 로그아웃("다른 계정으로 로그인") 제공. 클래스 코드 입장은 게이트에 걸리지 않음을 확인.
3. 금지 문구(점수·종합점수·좋음·나쁨·완료·보증·100% 단정) 0건.

## 서버 계약 변경
- `POST /auth/google`, `POST /auth/apple` 요청에 `counselor_code?: string(≤12)` 추가.
- 신규 계정 생성 시 `invite_token` 도 `counselor_code` 도 없으면 422 `COUNSELOR_CODE_REQUIRED`(문구는 이메일 가입과 동일: "코치 코드를 확인해주세요. 코드가 없다면 초대한 코치에게 요청해 주세요."). 코드가 틀리면 이메일 가입과 같은 `validate_counselor_code` 오류(400/404/403).
- 코드 유효성 확인은 별도 공개 엔드포인트를 만들지 않는다(6자리 숫자 무차별 대입 방지) — 가입 요청 시 서버 검증으로 대체. 검증은 사용자 생성 전, Apple nonce 소비 전에 수행해 같은 토큰으로 재제출 가능.
- 안전장치: `settings.social_signup_requires_counselor_code`(기본 true). 시험 환경만 기존 fixture 보호용으로 끈다.
- DB 마이그레이션 없음.
