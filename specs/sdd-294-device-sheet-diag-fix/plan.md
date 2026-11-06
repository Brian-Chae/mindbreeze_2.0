# SDD-294 — Plan

## 확정 원인 (코드 근거)
1. `member-player.css` `.mp-diag-toggle { position:absolute; top:-52px; right:52px }` 는 `.mp-diag-frame`(시트 본문 `.pz-sheet__body` 첫 자식) 기준 위로 52px 밖에 놓인다. `.pz-sheet__body` 는 `overflow-y:auto`(→ overflow-x 도 auto)라 본문 박스 밖은 잘린다. 정상 상태는 패널이 접힘 기본이라 시트에 보이는 것이 없다 → "진단이 전혀 안 보임".
2. `diagnostics` null 경우의 수: `measurement-path.ts` 상 `path==='native'` 이면 status(idle/starting/running/failed)와 무관하게 `diagPath='native'` → null 아님. null 은 `!v2 / !bandOptIn / !eegConsent`(path off·legacy) 또는 게스트·웹 미연결(off)일 때뿐이며 이때는 측정 자체가 없으므로 표시하지 않는 것이 맞다(브리프 규칙 유지). 따라서 diagnostics 생성부는 변경하지 않는다.

## 수정
- `ConnectionDiagnosticsFrame`: 토글을 프레임 안 맨 위 줄 `.mp-diag-bar`(flex, 우측 정렬, 라벨 "연결 진단" 좌측)에 in-flow 로 둔다. 음수 오프셋·absolute 제거 → 닫기 버튼(시트 헤더, 본문 밖)과 구조적으로 겹치지 않음. DevTop 우측 액션("연결 해제")과도 줄이 달라 겹치지 않음.
- 정상 상태에서도 초록 아이콘 항상 표시, 접힘 기본·이상 자동 펼침(`resolveDiagOpen`) 불변.
- 금지 표현 불변.

## 파일
`ConnectionDiagnosticsPanel.tsx`, `member-player.css`(진단 블록), 신규 `tests/sdd294-device-sheet-diag.test.tsx`.
