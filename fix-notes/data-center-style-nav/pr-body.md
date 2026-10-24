## 변경

데이터 센터의 다운로드 설정 버튼은 hover 시 일반 버튼 CSS에 덮여 흰 글자/연보라 배경(1.13:1)이 되었습니다. 명상 클래스 목록·상세와 같은 Tailwind preset을 재사용해 버튼·밑줄 탭·선택칩·입력/select·카드·테이블·페이지 버튼을 통일하고, 상태 규칙을 controls.css로 모았습니다.

- primary 기본/포커스 9.59:1, hover 11.68:1, disabled 9.36:1. 모바일 탭은 너비를 유지하며 내부 스크롤합니다.
- 기관 메뉴: 리포트 → 데이터 센터 → 알림. 플랫폼 메뉴: 채팅 → 데이터 센터 → 알림. 골든 테스트 갱신.
- 재인증 라벨·로직 및 export-dialog.tsx/export-jobs.tsx는 변경하지 않았습니다.

## 검증

- Playwright(channel: chrome), 실제 React 화면 + API mock, 1440·390 클래스 목록/상세·데이터 센터 전 탭·측정·다운로드·hover 비교 캡처 및 계산 대비 기록.
- 집중 vitest 5파일 63건 통과. 전체 2,990건 중 기존 8파일·17건 실패가 수정 전과 정확히 동일(추가 회귀 없음).
- TypeScript, npm run build, 변경 TSX/test ESLint, 생성 CSS 확인 통과. 독립 구현/브라우저 검증/코드 리뷰 후 diff와 캡처 직접 재확인.
- 근거: fix-notes/data-center-style-nav/source-style.md, summary.md, test-comparison.json, browser-summary.json 및 comparison-*.png.
- SDD-234 테스트 산출물은 원복하고 node_modules 링크는 커밋에서 제외했습니다.

## 남은 범위

실제 dev/운영 API·실기기 검증은 포함하지 않습니다. 빌드의 기존 tokens 상대 import unresolved·chunk 크기·dynamic import 경고는 남아 있습니다. 머지·배포는 수행하지 않습니다.
