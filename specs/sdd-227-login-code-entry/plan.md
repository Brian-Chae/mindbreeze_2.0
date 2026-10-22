# SDD-227 Plan

## 변경 파일
- `frontend/src/pages/LoginPage.tsx` 만 수정.
  - 회원 탭 렌더 순서를 `emailForm → 링크 → 간편 로그인 구분선 → Google → Apple → 동의`로 변경.
  - 회원 탭일 때 `fixed bottom-0` 카드(`Link to="/join"`) 렌더. 하단 `padding-bottom: max(16px, env(safe-area-inset-bottom))`.
  - 회원 탭 섹션 하단 여백 `pb-[calc(9rem+env(safe-area-inset-bottom))]`.
  - 이메일·비밀번호 input `onFocus/onBlur`로 `typing` 상태 → true면 카드 숨김(웹·앱 공통, 키보드 플러그인 의존 없음).
- `frontend/tests/login-page.test.tsx`: 기존 "Google 먼저" 기대를 "이메일 먼저"로 갱신 + 카드 노출 테스트 추가.

## 결정
- 키보드 감지는 Capacitor Keyboard 이벤트 대신 입력칸 포커스로 판단 — 웹 모바일에도 동일 적용, 단순.
- 링크는 `/join`(쿼리 없음) — 코드 비노출 원칙 유지.
- `/join` 뒤로 가기는 기존 `navigate(-1)` → 로그인 화면 복귀(변경 없음).
