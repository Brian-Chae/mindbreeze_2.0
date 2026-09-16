# SDD-072 구현 결과

## 구현
- `/login`을 URL `role` 기반 회원·상담사·기관 3탭으로 통합했다. 회원 Google 우선, 상담사 이메일 우선, 기관 이메일 전용·가입 없음 정책을 반영했다.
- 관리자 모드는 공개 탭 없이 Google Workspace와 일반 로그인 복귀 링크를 제공한다. 기존에 없던 `/admin` 진입 라우트를 `PlatformAdminRoute`로 보호하고 `/admin/orgs`로 연결했다.
- `/login/client`는 회원 탭으로 replace 이동한다. 탭에는 ARIA 관계·선택 상태·좌우/Home/End 이동을 추가하고 전환 시 이메일을 유지하며 비밀번호·오류를 비운다.
- 이메일 로그인 요청에 선택적 role을 추가했다. 이메일은 비밀번호 확인 후 역할 불일치를 403으로 거절하고 JWT·refresh를 발급하지 않는다. role 생략은 기존과 호환된다.
- Google 기존 계정은 역할 검사를 계정 연결 변경·토큰 발급 전에 수행한다. 신규 상담사·기관 요청은 자동 생성하지 않는다. 관리자 요청의 기존 회사 도메인 승인·승격 정책은 유지했다.
- 인증 스토어는 응답 사용자·역할을 검증한 뒤 토큰과 사용자를 저장한다. 로그인 진행 잠금과 Google 취소·실패 복구, 시작 당시 역할 고정을 구현했다.
- 공통 `resolvePostLoginPath`로 회원·상담사 온보딩과 기관/관리자 이동을 통일했다. 관리자 next는 경계와 URL 정규화 후 관리자 경로 여부를 검사한다.
- 상담사 홈·가입·보호 화면, 역할별 로그아웃 링크를 명시적 역할 URL로 연결했다. 개발 역할 패널의 기존 환경 플래그는 유지했다.

## 진행 근거
- 프로덕션 수정 전 `plan.md`, `verify.md`를 작성하고 Orca 코디네이터의 명시적 승인을 받았다.
- RED: 서버 8건 실패(이메일/Google 역할 불일치와 신규 기관 Google 생성), FE 저장 경계 3건 및 화면 구성 4건 실패를 확인했다.
- 공통 경로 유틸 신규 테스트는 파일 미존재로 실패한 뒤 구현했다.
- 기존 `specs/.sdd-counter`와 `spec.md`는 작업 시작 시 존재한 변경이며 수정하지 않았다. 커밋·배포·DB 적용은 하지 않았다.

## 검증 결과
- BE 전체 `cd backend && venv/bin/pytest`: **500 passed, 12 skipped, 14 warnings**, 41.18초, 종료 코드 0.
- FE `cd frontend && npm run build`: 종료 코드 0. 기존 큰 청크 안내 경고만 존재한다.
- FE 로그인 구성/인증 저장/이동 정책 및 기존 서사·신호 테스트: 26개 통과.
  - `node --test frontend/tests/login-role.test.cjs frontend/tests/login-page.test.cjs frontend/tests/narrative-sections.test.cjs frontend/tests/signal-metric-parity.test.cjs`
- FE 전체 `node --test frontend/tests/*.test.cjs` 시도: 당시 25개 통과, 기존 PDF 테스트 파일 2개는 `Cannot find module 'playwright'`로 실행 불가. 이후 추가된 응답 누락 테스트 1개는 위 대상 실행에 포함해 통과했다.
- `git diff --check`: 통과.

## 미검증·리뷰
- Browser runtime은 `No browser is available`, 브라우저 목록은 빈 배열이었다. 실제 브라우저에서 모바일 레이아웃·키보드·뒤로 가기·Google 팝업 취소는 검증하지 못했다. 렌더링 테스트는 실제 브라우저 QA를 대신하지 않는다.
- 실제 외부 Google 공급자 인증은 수행하지 않았고 서버 userinfo 응답을 모의했다.
- 기존 PDF 테스트의 Playwright 환경 설정, 실브라우저 QA 및 Stage ⑦ 최종 리뷰가 남아 있다. 독립 코드 리뷰를 코디네이터에게 요청했다.
