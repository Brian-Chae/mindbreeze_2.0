# 모바일 로그인 상단 고정 헤더·역할 스위치

## 변경
- `LoginPage.tsx` JSX만 수정. 상단 여백 없이 safe-area padding을 포함한 sticky 반투명 헤더, 홈 심볼·로그인 h1·역할 스위치를 배치했다. 본문은 이메일부터 위 정렬한다.
- 안내 문구는 제출 버튼 바로 아래로 이동했다. Tailwind 3이 `text-white/78`을 생성하지 않으므로 `text-white/[0.78]`도 병기했다.
- Google·이메일 인증 핸들러, tablist 키보드·aria, 동의·오류·개발 패널·입장 카드 로직은 변경하지 않았다.
- 로그인 렌더 테스트 2건 추가. 별도 읽기 전용 검토자가 로직 불변과 CSS 생성 문제를 검토했고 감독이 diff·실제 계산 스타일로 재확인했다.

## 검증
- RED: 신규 2건 실패, 기존 5건 통과. GREEN: 로그인 관련 2파일 12건 통과.
- 전체 Vitest 3003건: 2986 통과, 17 실패(8파일). 두 전체 실행의 실패 파일·테스트명이 동일하며 제공된 기존 실패 8파일·17건과 일치한다. 상세 이름은 `test-results.json`.
- `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint src/`, `npm run build` 통과. 빌드 기존 chunk/dynamic import 경고 있음.
- Playwright `channel: 'chrome'`: 390×844 회원·상담사·기관·각 스크롤 시도, `/admin` 진입 후 관리자 로그인, 1440×1000 캡처.
- 계산 스타일: 헤더 top 0, sticky, rgba(20,0,30,.55), blur(18px), 안내 12.5px·rgba(255,255,255,.78), 가로 넘침 없음. 방향키·End 탭 이동 통과.
- 390×844는 콘텐츠가 들어가 실제 스크롤 0이다. 390×600 추가 검증에서 169px 실제 스크롤 후 header top 0 확인(`sticky-scroll-390x600.png`).
- `comparison.html`·`comparison.png`에서 v4와 실제 세 역할을 나란히 직접 비교했다. 시안의 가상 상태바 47px는 실제 Chrome safe-area 0px와 다르다. Apple 버튼은 기존 플랫폼 조건에 따라 Chrome에서 숨겨지고 Google은 클라이언트 ID 미설정으로 비활성화되며, 기존 동작을 유지했다. 실제 OAuth·네이티브 safe-area는 미검증.
- 전체 테스트가 갱신한 `specs/sdd-234-mobile-type-polish` 산출물은 요청대로 git checkout으로 복원했다. node_modules 심볼릭은 커밋하지 않는다.

## 캡처
- `client-390.png`, `counselor-390.png`, `org_admin-390.png`
- 각 `*-scrolled-390.png`, `sticky-scroll-390x600.png`
- `admin-390.png`, `desktop-1440.png`
- `reference.png`, `reference-*.png`, `comparison.png`
- 재실행: 저장소 루트에서 로컬 Vite 5186 실행 후 `node fix-notes/mobile-login-header/capture.cjs`. 공개 화면 API만 차단하며 서버 인증을 실행하지 않는다.

## 범위
머지·배포·서버 설정·DB·.env·메일·삭제 작업 없음. PR은 develop 대상으로 생성한다.
