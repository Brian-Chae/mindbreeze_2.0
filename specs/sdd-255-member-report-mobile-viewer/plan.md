# SDD-255 — Plan (Stage ②)

## 접근
- 신규 `MemberReportViewer`(`frontend/src/components/reports/MemberReportViewer.tsx`): 프레임 + 데스크톱 보기 버튼 + 모달. 내부 본문은 선행 FIX의 `ClientReportBody`를 그대로 사용(본문을 다시 갈라 만들지 않는다).
- 모바일 스타일의 폭 기준 전환
  - `narrative-sections.css`의 뷰포트 `@media(max-width:900/560px)`·`(max-width:767px)` 규칙은 **원본 불변**(상담사용·PDF·다른 화면 보호).
  - 신규 `member-report-frame.css`: 같은 규칙을 `.member-report-frame` 범위 + `@container member-report (max-width:…)`로 복제. 프레임 `container-type:inline-size; container-name:member-report`.
  - ≥1100px 뷰포트의 cover 확대 규칙(`min-width:1100px`)은 프레임 안에서 되돌린다.
  - Tailwind `mobile:`(뷰포트 767px) 클래스: 플러그인 변형 `frame:`(= `@container member-report (max-width:767px)`)을 `tailwind.config.cjs`에 추가하고, 회원용 본문 컴포넌트(ClientReportBody·SubjectiveCheckinCard·ReportCoverSection·NarrativeSections)의 `mobile:X` 옆에 `frame:X`를 병기. 기존 `mobile:`은 유지(실기기 동작 동일).
- 버튼 노출: CSS(`max-[560px]:hidden`)로 ≥561px에서만 표시.
- 적용 지점: ClientReportViewer(→ClientReportDetailModal), ReportDetailView(회원용 → ReportReviewPane), ReportViewPage(client 분기)에서 `ClientReportBody` → `MemberReportViewer`.

## Task
- T1 `member-report-frame.css` + tailwind `frame:` 변형 + `mobile:` 병기
- T2 `MemberReportViewer`(프레임·버튼·dialog 모달·포커스 복귀)
- T3 3개 렌더 지점 교체, 상담사용 경로 불변 확인
- T4 테스트(프레임 클래스·버튼 노출 클래스·모달 열기/ESC/바깥 클릭·상담사용 불변·CSS 격리) + 1440/390 헤드리스 캡처
- T5 tsc·eslint·vitest 전체·build, summary.md, PR

## 위험
- 컨테이너 쿼리 안의 요소는 컨테이너 자신을 스타일할 수 없다 → 프레임 래퍼(컨테이너)와 내부 `.narrative-report` 분리.
- 모달 안에 같은 본문이 중복 마운트되지 않도록 열릴 때만 렌더.
- 중첩 dialog(회원 상세 모달 안): `cancel` 이벤트는 버블링되지 않아 바깥 모달이 같이 닫히지 않음 — 테스트로 확인.
