# SDD-227 Summary

## 구현
- `frontend/src/pages/LoginPage.tsx`
  - 회원 탭 순서: 이메일·비밀번호 → [이메일로 회원 로그인] → 비밀번호 찾기·회원가입 → "간편 로그인" 구분선 → Google·Apple → (신규 가입 동의).
  - 회원 탭 전용 하단 고정 카드 "입장 코드가 있나요? / 로그인 없이 바로 들어가요 · [코드로 입장]" → `/join`(쿼리 없음).
  - 하단 안전영역 대응(`env(safe-area-inset-bottom)`), 회원 탭 아래 여백 `8.5rem + 안전영역`.
  - 이메일·비밀번호 입력칸 포커스 중에는 카드 숨김(웹·앱 공통).
  - 상담사·기관·플랫폼 관리자에는 카드 없음. 상담사 탭 화면은 변경 없음.
- `frontend/tests/login-page.test.tsx`: 회원 탭 순서·카드 노출 범위 테스트로 갱신.
- 서버·`/join` 흐름 변경 없음.

## 테스트 결과 (verify.md)
| ID | 결과 | 근거 |
|---|---|---|
| V01·V02·V05 | 통과 | Vitest: 회원 탭 `href="/join"`, 상담사·기관·관리자 없음 |
| V03·V04 | 통과 | Vitest 순서 검사, 상담사 기존 테스트 |
| V06 | 통과 | Chrome 375×667: 이메일 포커스 시 카드 0개, blur 시 1개 |
| V07 | 통과 | 끝까지 스크롤 시 개인정보 처리방침 하단 y=491 < 카드 상단 y=577 |
| V08 | 통과 | 첫 화면 카드 y=577~651 (뷰포트 667 안) |
| V09 | 통과 | 카드 클릭 → `/join` 코드 입력 화면, 뒤로 → `/login` |
| V10 | 통과 | 관련 테스트 4파일 153건, `tsc -b`, `npm run build`, 생성 CSS에 신규 클래스 확인 |
| 기타 | 통과 | 가로 스크롤 없음(scrollWidth 375) |

## 디버깅 메모
- 첫 구현에서 비밀번호 찾기·회원가입이 공통 링크 영역(Google 아래)에 남아 시안과 순서가 달랐음 → 회원 탭은 이메일 로그인 버튼 바로 아래로 이동.
- 로컬 Playwright 내장 브라우저 미설치 → `channel: 'chrome'`(시스템 Chrome)으로 검증.

## 남은 확인
- 실제 iOS·Android 기기에서 홈 바·키보드 동작(네이티브 빌드 후).
- dev 서버에서 실제 클래스 코드로 게스트 입장 끝까지(배포 후).

## dev 배포 검증 (2026-10-22)
- 머지: PR #31 → develop 머지 커밋 `86b42b4c`. Deploy Dev run 39730511374 성공 (https://github.com/Brian-Chae/mindbreeze_2.0/actions/runs/39730511374).
- 방법: 시스템 Chrome(playwright channel:'chrome', 375x667)으로 https://dev.mindbreeze.looxidlabs.com 확인. 카드는 lazy 청크에 있어 index 번들 grep은 0건이므로 렌더된 화면으로 판정.
- 통과: `/login` 회원 탭에 '입장 코드가 있나요?' 카드 표시.
- 통과: 회원 탭 순서 이메일 로그인 → 비밀번호 찾기·회원가입 → 간편 로그인(Google) → 개인정보 처리방침 → 코드로 입장 카드.
- 통과: `/login?role=counselor` 에는 카드 없음.
- 통과: 카드 클릭 → `/join` 코드 입력 화면(숫자 4자리, '코드 확인').
- 미완료(차단): 실제 게스트 코드 입장 끝까지. counselor@test.com 이 dev에서 활성 조직 멤버십이 없어 클래스 생성이 409 `active_membership_required`, 보유 클래스·세션도 0건이라 4자리 코드를 확보하지 못함. 테스트 클래스는 만들지 않음.
- 후속: 멤버십이 있는 계정(E2E 상담사 등) 또는 dev DB에 멤버십 부여(OPS, 승인 필요) 후 재검증.
