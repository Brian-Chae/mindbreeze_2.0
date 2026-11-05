# SDD-294 — Summary

- 확정 원인: `.mp-diag-toggle` 이 `position:absolute; top:-52px; right:52px` 로 `.pz-sheet__body`(overflow-y:auto) 박스 밖에 놓여 잘림. 정상 상태는 패널 접힘 기본이라 시트에 보이는 것이 없었음. diagnostics null 은 path off(밴드 미사용·미동의·게스트 웹 미연결)뿐이며 native 경로는 status 와 무관하게 non-null → 생성부 변경 없음.
- 수정: 토글을 시트 본문 첫 줄 `.mp-diag-bar`(우측 정렬 flex, "연결 진단" 라벨 + 아이콘)로 이동, absolute/음수 오프셋 제거. 접힘 기본·이상 자동 펼침 불변.
- 시험: sdd294 신규 8건 + sdd284 14건 통과, 관련 30파일 745건 통과, `tsc -b` 0. 전체 vitest는 시간 초과로 미실행.
- 화면: 390px 정적 하니스(Chromium) `screen-390-closed.png` — 아이콘이 시트 안 닫기(✕) 아래 줄에 보이고 겹치지 않음. 클릭 펼침은 jsdom 시험으로만 확인(하니스는 정적 HTML).
- 앱 재빌드 필요(웹 번들 내장).
