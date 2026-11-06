# SDD-309 — 구현 전 검증 게이트 (Stage ③, 구현 전 작성)

## 서버 (pytest, `backend/tests/test_sdd309_social_coach_code.py`) — RED 먼저
- [ ] V01 Google 신규 + 동의·생일·성별 OK + 코드 없음 → 422 `COUNSELOR_CODE_REQUIRED`, User 행 0.
- [ ] V02 Google 신규 + 유효 코드 → 200, 상담사 링크(active) 생성, onboarding step4 저장, 1:1 채팅방 생성.
- [ ] V03 Google 신규 + 잘못된(없는/6자리 아님) 코드 → 404/400, User 행 0.
- [ ] V04 Google 신규 + invite_token(코드 없음) → 코드 요구 없이 진행(면제).
- [ ] V05 Google 기존 가입자 재로그인 → 코드 없이 200(영향 없음).
- [ ] V06 Apple 신규 + 코드 없음 → 422 `COUNSELOR_CODE_REQUIRED`, nonce 미소비(같은 토큰+코드로 재제출 200).
- [ ] V07 Apple 신규 + 유효 코드 → 200 + 링크·step4. Apple 같은 sub 재로그인 → 코드 없이 200.
- [ ] V08 상담사/기관 소셜 로그인 경로 불변(사전 등록 없음 403 유지, 코드 요구 422 아님).
- [ ] V09 이메일 가입(`/auth/register/client`) 코드 경로 회귀 없음(기존 시험 통과).
- [ ] V10 인증·가입·소셜 관련 pytest 전체 신규 실패 0.

## 프런트 (vitest)
- [ ] V11 `/signup/confirm`: 초대 토큰 없으면 코치 코드 6자리 입력칸 표시, 6자리 전에는 "가입하기" 비활성.
- [ ] V12 초대 토큰이 있으면 코드칸 숨김, 가입 가능.
- [ ] V13 가입 요청에 `counselor_code` 가 Google·Apple 모두 실려 간다.
- [ ] V14 `COUNSELOR_CODE_REQUIRED`/404/403 오류가 코드칸 근처에 표시, 입력은 유지(재시도 가능).
- [ ] V15 코치 코드 화면: "뒤로"(→ /join)와 "다른 계정으로 로그인"(로그아웃 후 /login) 존재, 6자리 입력 시 기존처럼 1회 제출, 오류/로딩 문구 유지.
- [ ] V16 코치 미연결 상태에서 `/join`·`/class/:id/enter`·`/app/classes` 는 게이트에 걸리지 않음(라우트 확인).
- [ ] V17 신규 화면 금지 문구(점수·종합점수·좋음·나쁨·완료·보증·100%) 0건.

## 공통
- [ ] V18 `tsc -b` 0, eslint 0, 관련 vitest 통과, 신규 실패 0.
- [ ] V19 390/768 캡처 Before/After ≤6장 `evidence/`.
- 미검증 명시: 실기기, Apple 실제 로그인, 실 Google OAuth.
