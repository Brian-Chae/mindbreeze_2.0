# [MB261025][FIX] 구글 계정 전환 로그인 실패(상담사→회원) — verify (수정 전)

## 원인 분석(정적 확인)
- 앱(iOS): `@capgo/capacitor-social-login` GoogleProvider.swift 는 `hasPreviousSignIn() && !forcePrompt` 이면 `restorePreviousSignIn` 으로 **이전 계정을 조용히 반환**한다(계정 선택창 없음).
  우리 `lib/native/google.ts` 는 `forcePrompt` 를 넘기지 않고, `authStore.logout` 은 `SocialLogin.logout` 을 호출하지 않는다.
  → 상담사 탭에서 A 로그인 → 로그아웃 → 회원 탭 Google 버튼이 A 를 그대로 반환 → 서버 `_ensure_login_role` 403 → "로그인 안 됨".
- 웹: `LoginPage` `useGoogleLogin()` 에 `prompt` 미지정, 로그아웃 시 GIS 자동 선택 해제(`disableAutoSelect`) 없음.
- 서버: 역할 불일치 403 문구가 "올바른 탭에서 다시 로그인"뿐이라 원인(다른 구글 계정을 골라야 함)이 전달되지 않는다. 코드 없음.
- Apple: 로그아웃 시 `SocialLogin.logout(apple)` 미호출(자격 증명 잔존).

## 수정 전 검증 시나리오 (RED 기대)
| # | 시나리오 | 기대 |
|---|---|---|
| V1 | 네이티브 Google 로그인 호출에 `forcePrompt: true` | 수정 전 RED |
| V2 | `authStore.logout` 이 `SocialLogin.logout(google/apple)` 을 호출(실패해도 로그아웃 완료) | 수정 전 RED |
| V3 | 웹 `useGoogleLogin` 에 `prompt: 'select_account'`, 로그아웃 시 `google.accounts.id.disableAutoSelect()` | 수정 전 RED |
| V4 | 서버: role=client 로 상담사 구글 계정 → 403 + `code=ROLE_MISMATCH` + 구글 전용 안내 문구 | 수정 전 RED |
| V5 | 서버: 신규 구글 계정 B 가 role=client 로 동의와 함께 가입 성공(회귀 보호) | GREEN 유지 |
| V6 | 프론트: 구글 403 ROLE_MISMATCH 시 서버 문구를 그대로 표시 | |
