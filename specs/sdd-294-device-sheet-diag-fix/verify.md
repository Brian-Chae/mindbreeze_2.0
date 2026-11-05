# SDD-294 — Verify (구현 전)

| # | 시나리오 | 기대 |
|---|---|---|
| V1 | `MemberSheetBody sheetKey=device` + diagnostics 있음 | `[data-pz=diag-toggle]` 존재, `.mp-diag-bar` 안 |
| V2 | diagnostics null (path off) | 토글·패널 없음, DeviceSheet 본문만 |
| V3 | 정상 상태 | 토글 `data-abnormal` 없음(초록), 패널 접힘, 클릭 시 펼침·재클릭 시 접힘 |
| V4 | 이상 상태 | 토글 `data-abnormal=true`, 패널 자동 펼침 |
| V5 | CSS 단언 | `.mp-diag-toggle` 에 `position:absolute`·음수 top/right 없음, `.mp-diag-bar` 는 flex·justify-content:flex-end |
| V6 | 기존 sdd284-connection-diagnostics 23건 | 전부 통과 |
| V7 | `tsc -b` | 오류 0 |
| V8 | 관련 vitest | 신규 실패 0 (기준선 23건/13파일 외) |
| V9 | 390px 렌더 스크린샷 | 아이콘이 시트 안에서 보임(vision 확인), 못 하면 보고 |
| V10 | 금지 표현(점수·좋음·나쁨·완료·보증·100%) | 렌더 텍스트에 없음 |
