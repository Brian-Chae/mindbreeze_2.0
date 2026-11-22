# 코치 홈 달력 개선 결과
## 적용
- 월간 그리드 유지. 날짜를 열 전체에 배치해 요일과 중심 일치.
- 데스크톱 날짜 높이 64→56px. 모바일은 37~39→48px로 확대.
- 오늘/선택/hover를 32px 원으로 통일, 토·일 날짜/요일 색 일치, 지난 회차 점 대비 개선.
- 월 제목 가운데, 오늘 오른쪽 유지. 화살표와 오늘 버튼 최소 44px. 모바일 제목 너비 조정으로 줄바꿈 방지.
- 불완전한 ARIA grid 역할을 이름 있는 group과 네이티브 버튼으로 정리.
- API·KST·선택/목록 계산·빈 문구·링크·홈 페이지 코드는 변경하지 않음.

## 검증
- 1440/1280/390 × full/empty 6조건: 페이지/카드 가로 넘침 0, 요일-날짜 중심 오차 0px.
- 1440 중심 오차 8.32→0px, 1280 1.46→0px.
- 데스크톱 카드 높이 full 704→674px, empty 621→591px. 레일 348px 유지.
- 모바일 카드 높이는 터치 영역 확대 때문에 full 567→612px, empty 484→529px. 날짜 너비는 화면 제약상 39~41px로 44px보다 작으며 높이는 48px.
- 전후 PNG 24장. 최종 카드/페이지 PNG 직접 확인. 전체 페이지 증거는 내부 스크롤 조상을 펼쳐 캡처했으며 실제 뷰포트에서는 고정 내비게이션을 유지한다.
- 현재 HEAD의 원본 CSS를 브라우저에 주입해 before를 같은 캡처 조건으로 재생성. TSX 변경은 역할 속성만으로 시각 레이아웃에 영향 없음.
- 모의 API 데이터 사용. 실서버/API/메일 검증 아님.
- tsc --noEmit, 변경 TSX eslint, git diff --check: 0.
- 직접 관련 테스트 3파일 21개 통과. 독립 검증 별도 홈/달력 조합 3파일 23개 통과.
- 최종 CSS에서 Playwright로 날짜 선택→목록, 월 이동, 오늘 복귀, Enter 선택, focus-visible, 선택 원형 테두리 검증 통과.
- 독립 검증자 발견: 초기 width 표현의 정적 테스트 오탐과 모바일 PNG 잘림을 수정, 재검증 완료.
- 전체 npm test 결과는 아래에 기록. 브리프의 기존 실패 1건만 허용 조건을 충족하지 못하면 전체 검증 완료로 보고하지 않는다.

## 산출물
/Users/brianyongwookchae/.hermes/share/coach-home-calendar-review/
review.md, index.html, before/after PNG, metrics JSON, capture.mjs, interaction-check.mjs/json, vitest.log, focused-tests.log

## 전체 테스트 및 baseline 대조
- 전체: 499파일 중 482 통과 / 16 실패 / 1 건너뜀. 4,727 테스트 통과 / 46 실패 / 7 건너뜀. 비동기 오류 1건(useCloseBiosignalOnEnd / sdd293-band-early-handoff).
- 수정 전 HEAD 소스(CSS/TSX)로 실패한 16파일 재실행: 동일 46개 실패, 70개 통과, 6개 건너뜀. 실패 항목 이름 집합 차이 0개.
- 변경 소스는 finally에서 그대로 복원. 추가 실패는 이번 달력 변경 전에도 재현됨. 비동기 오류 파일은 baseline 재실행 대상 16개에 포함되지 않아 기존 여부를 별도 확정하지 않음.
- 따라서 달력 관련 검증은 통과했지만, 브리프의 전체 테스트 허용 실패 1건 조건은 미충족. 무관한 내비게이션/BLE/PDF/네이티브 식별자 등을 이 작업에서 수정하지 않았다.
- 로그: vitest.log, baseline-failures.log, focused-tests.log.
