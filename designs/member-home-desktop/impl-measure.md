# 회원 홈 B안 실제 컴포넌트 DOM 측정

측정: 2026-10-20T04:44:53.090Z

실행: `node designs/member-home-desktop/impl-measure.mjs`

실제 MemberStructureHomePage·ClientHomePage·StructureShell을 Vite로 제공하고 API만 합성 응답으로 대체했다. Playwright Chromium, 높이 1000px. 이미지 평가 없음. 서버와 브라우저는 실행 종료 시 닫는다. 외부 히어로 이미지 요청은 차단하며, DOM 구조·치수만 평가했다. legacy-error·legacy-loading은 기존 세션/리포트 영역의 실패·로딩을 별도로 재현한다.

45/45 통과. 브라우저 오류: []

- 1280px / 1: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / 2: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / 3: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / 7: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / empty: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1280px / legacy-error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 1280px / legacy-loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1060px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 1440px / 1: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / 2: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / 3: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / 7: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / empty: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1440px / legacy-error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 1440px / legacy-loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1220px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 1920px / 1: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / 2: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / 3: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / 7: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / empty: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 px·높이 px, 타일 높이 152px, Tab true, 끝 버튼 true
- 1920px / legacy-error: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 1920px / legacy-loading: 통과, 페이지 넘침 0px, 정렬 오차 0px, main 1280px, 카드 폭 280px·높이 304px, 타일 높이 px, Tab true, 끝 버튼 true
- 834px / 1: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 247.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / 2: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 275.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / 3: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 275.1875/247.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / 7: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 275.1875/247.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / empty: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / error: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / loading: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 834px / legacy-error: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 275.1875/247.1875px, 타일 높이 px, Tab true, 끝 버튼 true
- 834px / legacy-loading: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 566px, 카드 폭 275px·높이 275.1875/247.1875px, 타일 높이 px, Tab true, 끝 버튼 true
- 390px / 1: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / 2: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875/267.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / 3: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875/267.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / 7: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875/267.1875px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / empty: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / error: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / loading: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 px·높이 px, 타일 높이 125px, Tab true, 끝 버튼 true
- 390px / legacy-error: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875/267.1875px, 타일 높이 px, Tab true, 끝 버튼 true
- 390px / legacy-loading: 통과, 페이지 넘침 0px, 정렬 오차 기존 배치px, main 358px, 카드 폭 358px·높이 239.1875/267.1875px, 타일 높이 px, Tab true, 끝 버튼 true

데스크톱은 공통 main 최대 1280px(좌우 패딩 포함), 카드 280×304px, 간격 16px, 타일 152px, 스냅 x mandatory를 적용했다. 834·390px는 기존 격자와 순서를 유지한다. 터치·실물 트랙패드 제스처와 실제 서버 데이터는 이번 합성 API DOM 측정의 검증 범위 밖이다.

## 실제 실행한 코드 검증

- `cd frontend && npx tsc -b --noEmit`: 종료 코드 0.
- `cd frontend && npx eslint src/`: 종료 코드 0.
- `npx vitest run tests/sdd221-member-home-layout.test.tsx tests/member-home-legacy-sections.test.tsx tests/member-class-structure.test.tsx tests/sdd219-counseling-closed.test.tsx`: 4파일, 61/61 통과(신규 9건).
- 신규 테스트는 구현 전 8건 실패를 확인한 뒤 구현했다. 마지막에 좌우 버튼의 ±296px 이동·시작 버튼 비활성을 검증하는 1건을 추가했다.
- 기존 `member-class-structure`의 재시도 테스트는 새 스크롤 버튼 도입에 맞춰 첫 버튼 대신 `[role="alert"] button`을 선택하도록 수정했다. 재시도 횟수 검증은 그대로 유지했다.
- Vite 프로덕션 빌드: 종료 코드 0. 저장소의 기존 `src/index.css` 토큰 import 경로를 실행 설정의 alias로만 보정했다. 소스 설정은 변경하지 않았다. 실행은 `vite.build({resolve:{alias:{'../design-system/build/outputs/css/tokens.css':resolve('../design-system/build/outputs/css/tokens.css')}}})`를 frontend에서 호출했다.
- `dist/assets/*.css`에서 `.mh-home`, `.mh-track`, `.mh-summary`, `.mh-edge`, `.mh-scroll-tools` 실제 생성 확인. 빌드에는 기존 동적 import·청크 크기 경고가 있다.
- 읽기 전용 독립 코드 리뷰: 중요 결함 없음. 상담사 홈·backend 변경 없음.

## 전체 프론트 테스트의 미해결 실패

`cd frontend && npm test -- --run`: 172파일 중 164 통과·8 실패, 2,182건 중 2,167 통과·15 실패. 실행 종료까지 기다렸다. 이 실행은 마지막 버튼 테스트 1건 추가 전이며, 이후 변경은 지정 61건·타입·린트·빌드·DOM 측정으로 재검증했다.

- `agent-counselor-page.test.tsx` 2건: 브리핑 CTA·입력창/전송 성공(입력 요소 기대값 불일치).
- `chat-message-deeplink.test.ts` 2건: missing·failure 대체 경로의 input.disabled 기대값 불일치.
- `class-structure-navigation.test.ts` 3건: counselor·org_admin·레거시 생성 경로의 wizard 요소 기대값 불일치.
- `font-scale.test.ts` 1건: 수정 금지 파일 `pages/DashboardPage.tsx:486`의 12px 미만 글씨.
- `org-counselor-management-browser.test.cjs` 1건, `org-management-browser.test.cjs` 2건: localhost:5175 서버 연결 실패.
- `report-modal-pdf.test.cjs` 2건, `report-server-pdf.test.cjs` 2건: localhost:5175 서버 연결 실패.

실패 영역은 이번 회원 홈 변경 범위 밖이다. 변경 전 전체 테스트를 별도로 실행하지 않았으므로 모든 실패를 기준선으로 확정하지 않는다. 전체 프론트 테스트 통과로 보고하지 않는다.

## 판정 범위

데스크톱 변경은 1024px 이상에만 적용했다. 834·390px에서는 기존 카드 격자·높이 차이와 요약 2열 배치를 유지했다. API·라우팅·비공개 상담 가드는 변경하지 않았다. 실제 서버·기기 제스처 검증과 배포는 수행하지 않았다.
