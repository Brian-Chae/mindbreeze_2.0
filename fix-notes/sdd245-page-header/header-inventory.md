# PageHeader 이관 인벤토리

- 제품 페이지 파일 34개 + 회차 상세 공용 뷰 1개 = 소스 단위 35개. 로딩·오류 분기 중복은 한 번만 집계.
- AppShell·ClientShell의 데스크톱/모바일 헤더를 PageHeader로 연결. StructureShell도 같은 셸을 사용.
- ClientAppPage 중첩 경로와 역할별 재사용 라우트는 실측 JSON에서 별도 표본 집계.
- 로그인·공개 독립 화면·플레이어 제외. 모바일 채팅방은 기존 hideMobileTitle 계약 유지.

## 소스 목록

- `frontend/src/components/class/structure/class-session-detail.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/OrgDashboardPage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/pages/admin/AdminReviewDetailPage.tsx`
- `frontend/src/pages/admin/AdminReviewListPage.tsx`
- `frontend/src/pages/admin/ClientManagementPage.tsx`
- `frontend/src/pages/admin/OrgManagementPage.tsx`
- `frontend/src/pages/admin/SignupApplicationsPage.tsx`
- `frontend/src/pages/admin/UserManagementPage.tsx`
- `frontend/src/pages/agent/counselor-agent-page.tsx`
- `frontend/src/pages/chat/ChatPage.tsx`
- `frontend/src/pages/classes/host-class-detail-page.tsx`
- `frontend/src/pages/classes/host-classes-page.tsx`
- `frontend/src/pages/client/ClientAppPage.tsx`
- `frontend/src/pages/client/ClientChatPage.tsx`
- `frontend/src/pages/client/ClientSessionDetailPage.tsx`
- `frontend/src/pages/client/ai-agent-page.tsx`
- `frontend/src/pages/client/member-class-detail-page.tsx`
- `frontend/src/pages/client/member-classes-page.tsx`
- `frontend/src/pages/client/member-structure-home-page.tsx`
- `frontend/src/pages/clients/ClientListPage.tsx`
- `frontend/src/pages/clients/ClientProfilePage.tsx`
- `frontend/src/pages/counseling/counseling-detail-page.tsx`
- `frontend/src/pages/counseling/counseling-list-page.tsx`
- `frontend/src/pages/data-center/data-center-page.tsx`
- `frontend/src/pages/notifications/NotificationCenterPage.tsx`
- `frontend/src/pages/org/OrgCounselorsPage.tsx`
- `frontend/src/pages/records/SessionRecordPage.tsx`
- `frontend/src/pages/reports/ReportDetailPage.tsx`
- `frontend/src/pages/reports/ReportListPage.tsx`
- `frontend/src/pages/reports/ReportSamplePage.tsx`
- `frontend/src/pages/sessions/SessionDetailPage.tsx`
- `frontend/src/pages/sessions/SessionListPage.tsx`
- `frontend/src/pages/settings/professional-profile-page.tsx`

## 헤더 필터 확인

- 클래스 목록: tabClass / fieldClass로 이관.
- 상담사 클래스 상세 메뉴·회원 클래스 상세 정보 탭: tabClass로 이관, aria-current/role/tabIndex/키보드 핸들러 보존.
- 리포트: 자체 세그먼트를 tabClass로, 검색·select를 fieldClass로 이관. select 3개 구성·세로 배치 보존.
- 관리자 회원·사용자·심사·가입신청·기관관리 및 상담사 회원 목록: 기존 fieldClass 사용 grep 확인.
- 세션 목록 sh-tabs는 공용 shell-kit의 44px/pill/purple 토큰 유지.

## 명시적인 주 액션

- 상담사 홈·클래스 목록: 새 클래스(주), 지금 바로 시작(보조).
- 회원 홈: 코드 입장(주). 회원 클래스 목록: 코드 입장(보조), 신청(주).
- 기존 클래스 목록: 클래스 만들기. 회원 목록: 회원 초대. 관리자 회원 관리: 회원 추가. 회원 신청 경로: 클래스 신청하기.
- 리포트: 승인 대상이 있을 때 일괄 승인만 주, 운영 설정·샘플 보기 보조.
- 목록·뒤로가기 링크 보조. 더보기·알림 아이콘 유틸리티는 기존 동작과 별도 규격 유지.
