# SDD-255 — Summary (Stage ⑥)

## 구현
- `MemberReportViewer`(신규): 회원용 본문(`ClientReportBody`)을 `.member-report-frame`(≤430px, ≥561px에서 카드형)으로 감싸고, ≥561px에서만 '데스크톱 보기' 버튼 → native `dialog` 모달(넓은 레이아웃, '모바일로 보기'·닫기·ESC·바깥 클릭, 포커스 복귀). 선택 비저장.
- `member-report-frame.css`(신규): `narrative-sections.css`의 ≤900/≤560/≤767px 모바일 규칙을 `.member-report-frame` 하위로 복제해 프레임 안에서 항상 적용. `container-type:inline-size`. 원본 CSS는 무변경.
- `tailwind.config.cjs`: `frame:` 변형(`@container member-report (max-width:767px)`) 추가. 회원용 본문 4개 컴포넌트의 `mobile:X` 옆에 `frame:X` 병기(기존 `mobile:` 유지).
- 적용 지점: ClientReportViewer(→ClientReportDetailModal), ReportDetailView 회원용(→ReportReviewPane), ReportViewPage client 분기. 상담사용 경로는 불변.

## 검증
- tsc 0 오류 · eslint 0 오류(경고 2, 기존 wasm.d.ts) · build 성공 · 신규 테스트 8건 통과.
- vitest 전체: 17 실패/3588 통과 — 변경을 퇴피한 기준선과 동일한 8파일·17건(agent-counselor-page, chat-message-deeplink, org-*-browser, report-*-pdf.cjs, sdd220-native-release, sdd234-a-mobile-home). 신규 실패 0.
- 캡처: `screens/viewer-1440.png`(430px 프레임+버튼, 퍼짐 없음), `screens/viewer-390.png`(전체 폭, 버튼 없음). 빌드된 CSS + 헤드리스 크롬.
- `narrative-sections.css`·backend diff 0.

## 미검증·남은 것
- 모달(데스크톱 보기) 안의 실제 브라우저 캡처는 미수행(단위 테스트로 열기/닫기만 검증).
- 실기기·Capacitor WebView에서 컨테이너 쿼리 동작 미확인(최신 WebView 지원 범위).
- 기준선 실패 17건은 이번 변경과 무관(수정하지 않음).
- 선행 PR #183 머지 후 이 PR 머지.
