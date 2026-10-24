# 데이터 센터 스타일·메뉴 수정 결과

## 수정

- 명상 클래스 목록·상세의 Tailwind preset과 버튼/폼/카드/밑줄 탭을 재사용한다. 기준 파일과 행은 source-style.md 참조.
- controls.css로 데이터 센터·측정·다운로드 버튼 상태를 통합한다. 일반 hover의 과도한 특이도를 제거했다.
- 기관 메뉴는 리포트→데이터 센터→알림, 플랫폼 메뉴는 채팅→데이터 센터→알림이다. 골든 테스트 기대값을 갱신했다.
- 모바일 상단·측정·서브탭은 flex-shrink:0으로 글자가 겹치지 않게 내부 스크롤한다.
- export-dialog.tsx·export-jobs.tsx와 재인증 라벨/로직은 변경하지 않았다.

## 검증

- Chrome 원본 CSS 재현: 다운로드 설정 기본 6.62:1, hover 1.13:1로 AA 실패(baseline-red.json).
- 수정 색 조합: primary 9.59:1, hover 11.68:1, focus 9.59:1, disabled 9.36:1. 실제 화면별 기록은 contrast JSON 참조.
- 집중 vitest: sdd243 3파일+nav 2파일, 63/63 통과.
- 전체 vitest: 2,990건 중 기존 8파일·17건 실패가 원본과 정확히 동일(test-comparison.json). 새 실패 없음.
- npx tsc --noEmit -p tsconfig.app.json, npm run build, 변경 TSX/test eslint, git diff --check 통과.
- 생성 production CSS에 공통 범위·primary/hover 색·disabled opacity·focus outline 생성 확인(generated-css.json).
- 본 검증은 1440·390 각각 948개 버튼 상태, 추가 모드/하위탭 896개 상태에서 AA 실패 0. 최소 8.748:1. 포커스 가능한 버튼의 :focus-visible 활성화와 44px 조작 영역도 확인했다. 최종 수치는 browser-summary.json 참조.
- 독립 코드 리뷰: 차단/중대 결함 없음. 감독이 diff와 데스크톱·모바일 클래스/데이터 센터/다운로드 캡처를 직접 재검토했다.
- 전체 테스트가 갱신한 specs/sdd-234-mobile-type-polish 파일은 git checkout으로 복구하고 커밋에서 제외했다. node_modules 심볼릭 링크도 커밋하지 않는다.

## 검증 범위와 기존 경고

- 실제 React 화면을 격리 Vite에서 렌더링하고 Playwright channel chrome로 검증했다. API는 합성 mock이며 서버·DB·메일·실제 다운로드를 호출하지 않았다. 실기기/운영 API 검증은 포함하지 않는다.
- 기존 index.css의 design-system tokens 상대 import 경로가 빌드에서 unresolved 경고를 낸다. 빌드는 성공하며 이번 변경 범위 밖이다. 격리 harness는 저장소 루트의 실제 tokens.css로 경로만 연결해 사용한다.
- 빌드에는 기존 chunk 크기/중복 dynamic import 및 Tailwind screens 경고가 남는다.
