# Fix — dev 웹 리포트 v11 회원 리포트 포맷 통일

## 원인 분석 (UI_V2=true 기준 경로별)
| 경로 | 렌더 컴포넌트 | member_report 있을 때(전) |
|---|---|---|
| 회원 `/client` 리포트 시트 (UiV2ReportsPage→UiV2ReportSheet) | UiV2ReportBody | ❌ 구 v3e 화면 |
| 코치 검토 상세 type=client (ui-v2-coach-report-detail-page) | UiV2ReportBody | ❌ |
| 코치 검토 패널 (ReportReviewPane, UI_V2) | renderMemberBody→UiV2ReportBody | ❌ |
| 코치 상세 type=counselor | ReportDetailView(코치용) | 해당 없음 |
| ReportDetailView 기본(데스크톱 모달/페이지, 비UI_V2) | MemberReportViewer | ✅ v11 |
| ClientReportDetailModal / member-operations | ClientReportViewer→MemberReportViewer | ✅ |
| ReportViewPage(공유 링크) | MemberReportViewer | ✅ |

## 수정
- `UiV2ReportBody`: `extractMemberReport(content)` 있으면 `MemberReportViewer`(→MemberReportBookView, 화면 C1) 렌더, 없을 때만 기존 본문. `ownerActions` prop 추가(회원 시트만 true → 보내기·책PDF 노출, 코치 검토는 false).
- `UiV2ReportSheet`: ownerActions 전달. 코치 화면은 기존 `/reports/{id}` 응답 content.member_report 사용 → 새 API 없음.
- 새 BE 변경 없음. 짧은측정 리포트 워커 파일(share-report.ts/member-report.ts) 미접촉.
