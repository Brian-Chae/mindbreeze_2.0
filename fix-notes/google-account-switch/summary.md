# [MB261025][FIX] 구글 계정 전환 로그인 실패(상담사→회원) — summary

## 원인 (확정, 정적 분석 + 모의 테스트)
- **앱(iOS) 주원인**: `@capgo/capacitor-social-login` `GoogleProvider.swift` 는 `hasPreviousSignIn() && !forcePrompt` 이면 `restorePreviousSignIn` 으로 이전 계정을 **계정 선택창 없이** 반환한다. `frontend/src/lib/native/google.ts` 가 `forcePrompt` 를 넘기지 않았고, 로그아웃(`authStore.logout`)이 `SocialLogin.logout` 을 호출하지 않아, 상담사 A 로그아웃 후 회원 탭 Google 버튼이 A 를 그대로 서버에 보냄 → `auth.py` `_ensure_login_role` 403.
- **웹**: `LoginPage.tsx` `useGoogleLogin()` 에 `prompt` 미지정, 로그아웃 시 GIS 자동 선택 해제 없음(계정 재사용 위험). 같은 훅을 쓰는 본인 확인(데이터 센터)·탈퇴 화면도 동일.
- **서버**: 역할 불일치 403 이 문자열뿐이라 "다른 구글 계정을 고르라"는 안내가 없었음. (신규 구글 계정 B 가입 경로 자체는 정상 — V5 통과.)
- **Apple**: 로그아웃 시 `SocialLogin.logout(apple)` 미호출 → 함께 정리.
- 쿠키/storage 잔존: refresh 쿠키는 `/auth/logout` 에서 삭제, `mb_user` 는 `persistUser(null)` 로 삭제 — 문제 없음. 가입 동의/생년월일 입력 state 는 탭 전환 시 남았음 → 초기화.

## 수정
- `lib/native/social-session.ts`(신규) `clearSocialSessions`: 웹 `googleLogout()`(disableAutoSelect) + 네이티브 `SocialLogin.logout(google/apple)`, 실패 무시. `authStore.logout` 에서 호출.
- `lib/native/google.ts`: 로그인 `forcePrompt: true`.
- `LoginPage.tsx`(로직만): `prompt: 'select_account'`, 탭 전환 시 소셜 가입 동의·생년월일·선택동의 state 초기화. `social-reauth-button.tsx`, `account-deletion.tsx`: `prompt: 'select_account'`.
- `backend/app/api/v1/auth.py` `/auth/google`: 역할 불일치 시 `403 ROLE_MISMATCH` + 한국어 안내(이메일 로그인 문구는 불변).

## 테스트
- 신규: `frontend/tests/google-account-switch.test.tsx` 5건(수정 전 5/5 RED → GREEN), `backend/tests/test_fix_google_account_switch.py` 2건(역할 불일치 코드 RED→GREEN, 신규 B 가입 GREEN 유지).
- 백엔드 전체 4301 passed / 505 skipped / 0 failed. vitest 전체 2989 passed / 17 failed(8파일) — 기존 실패 8파일·17건과 동일(신규 실패 0). tsc·eslint 무오류, `npm run build` 성공.
- 실기기(iOS/Android) 미검증 — 앱 경로는 모의 테스트.
