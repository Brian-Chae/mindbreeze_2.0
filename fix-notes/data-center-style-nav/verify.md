# 구현 전 검증 체크리스트

작성 시점: 스타일 구현 전. 사용자의 전체 작업 승인 범위 안에서 진행한다.

- [x] 클래스 목록/상세와 데이터 센터 1440·390 캡처 비교
- [x] 다운로드 설정 기본/hover/focus-visible/disabled의 실제 글자·배경 대비 4.5:1 이상
- [x] 일반/탭/선택칩/측정/다운로드 버튼 기본·hover·focus·disabled 상태 대비 4.5:1 이상
- [x] 버튼 44px 이상, 주요 CTA 48px 이상, 모바일 페이지 외부 가로 넘침 없음
- [x] 재인증 라벨·로직 변경 없음
- [x] 데이터 센터·nav vitest 및 전체 baseline 비교
- [x] TypeScript·production build·변경 파일 eslint
- [x] 독립 검증자의 diff 검토 및 캡처 직접 확인

검증 근거: summary.md, test-comparison.json, generated-css.json, browser-summary.json 및 비교 캡처.
