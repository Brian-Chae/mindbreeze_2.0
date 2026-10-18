# SDD-215 F — T13 라우트 인수 사항

## 연결 계약

- 새 호스트 경로는 counselor/org_admin, 새 회원 경로는 client RoleGuard로 보호한다.
- 새 `/app`·클래스·상담 화면은 기존 `/app/*`보다 앞에 등록하며 상담사 미연결 회원도 진입한다. 기존 채팅·리포트·알림·프로필·회원 회차 상세는 기존 분기를 유지한다.
- 호스트 새 회차 상세 URL의 실제 모양은 `/classes/:classId/sessions/:sessionId`·`/counseling/:relationshipId/sessions/:sessionId`다. 기존 SessionDetailPage가 useParams의 id를 사용하므로 라우트 정의에서는 마지막 파라미터 이름만 :id로 유지했다. 기존 페이지는 수정하지 않았다.
- 기존 `/sessions`, `/sessions/new`, `/app/sessions`, `/clients` 목록은 각각 새 목록·생성·상담 목록으로 replace 이동한다. `/clients/invite`, `/clients/:id`는 유지한다.
- `/sessions/:id`는 기존 getSession GET으로 한 번 조회한다. 명시 area/class_id만 클래스 부모로 해석하고, 상담은 명시 counseling_relationship_id가 있을 때만 이동한다. 오류·누락·미지 영역은 `/classes`다. 현재 세션 응답 schema에는 관계 ID가 없으므로 현재 상담 회차 레거시 URL은 `/classes`로 복귀한다. 상담 관계 ID가 있는 분기는 합성 가산 응답 테스트이며 현행 서버 제공의 증거가 아니다.
- 조회 중 다른 경로 이탈·계정 변경 후 늦은 응답은 이동에 사용하지 않는다.
- `/sessions/:id/{live,player,record}`, `/join`, `/class/:sessionId/enter`는 유지한다.
- F 소유 모바일 내비의 마지막 `/sessions` 목록 링크도 `/classes`로 전환했다. 기존 session 알림은 부모 ID가 없으므로 기존 레거시 회차 딥링크를 보존하고 위 GET 해석으로 새 URL에 도달한다. report·chat·입장 알림 계약도 유지한다.

## 요청·제약

- C 소유 `components/class/structure/counseling-views.tsx:61,99`의 내담자 링크는 `/clients`를 가리킨다. 새 `/clients` 목록 이동 규칙 때문에 상담 목록으로 돌아오므로 C/기획 담당의 진입 목적지 보완이 필요하다. F 셸 rightSlot으로 우회하지 않았고 C 파일은 수정하지 않았다.
- `/classes/new`, `/counseling/new`는 기존 CreateWizardContainer를 재사용한다. 컨테이너에 유형 입력 props/URL 분기 계약이 없고 내부 기본값은 meditation이므로 상담 유형을 자동 고정하지 않았다. 기존 컨테이너와 훅은 수정하지 않았다.

## F 소유 밖에 남은 직접 링크 목록

경로는 frontend/src 기준이다. 아래 기존 파일은 수정하지 않았다. 목록/생성/호스트 상세 URL은 레거시 이동이 처리하며, 회원 회차 상세와 shared player/record 경로는 명시적으로 유지한다. 새 부모의 `/classes/:id/sessions` 탭 경로는 레거시 링크가 아니므로 아래에 포함하지 않았다.

- `components/class/flow/host/CreateWizardContainer.tsx`: 93, 140, 141, 142
- `components/session/SessionCard.tsx`: 109
- `pages/DashboardPage.tsx`: 110, 136, 274, 285, 291, 389, 410, 493, 501
- `pages/OrgDashboardPage.tsx`: 200, 230, 250, 272
- `pages/agent/counselor-agent-page.tsx`: 104
- `pages/agent/counselor-agent-utils.ts`: 10, 13
- `pages/class/EntryPage.tsx`: 115
- `pages/client/ClientHomePage.tsx`: 296, 308, 312, 315, 352, 383, 394, 476
- `pages/client/ClientSessionDetailPage.tsx`: 120, 125
- `pages/client/ClientSessionListPage.tsx`: 106, 195, 200
- `pages/client/ai-agent-page.tsx`: 185
- `pages/sessions/ClassPlayerPage.tsx`: 854, 1170, 1266, 1343, 1393, 1409, 1416, 1418, 1568, 1639, 1645, 1652, 1667
- `pages/sessions/SessionDetailPage.tsx`: 159, 244, 317, 336, 338
- `pages/sessions/SessionListPage.tsx`: 31, 50, 71, 72
- `pages/sessions/SessionLivePage.tsx`: 9, 10

## 실제 검증 결과

- RED: 실제 App 트리·역할 가드·레거시 해석 신규 테스트에서 구현 전 62개 실패를 확인했다. F 모바일 목록 링크 전환은 해당 두 기대값을 먼저 갱신한 후 2개 실패를 확인하고 구현했다.
- 관련 10파일: `npx vitest run tests/class-structure-navigation.test.ts tests/terms.test.ts tests/nav-labels-characterization.test.tsx tests/nav-badge-by-key.test.tsx tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts tests/class-structure-data.test.ts tests/host-class-structure.test.tsx tests/member-class-structure.test.tsx tests/counseling-structure.test.tsx` → 228 통과, 0 실패.
- `npm test` → 129 파일 중 123 통과/6 실패, 1885 테스트 중 1874 통과/11 실패. 이전 인수 문서의 기준선 실패 이름 11개와 집합이 완전히 일치했다. 새 실패 0.
- `npx tsc -p tsconfig.app.json --noEmit` → 종료 0.
- `npx eslint src/App.tsx src/components/routing/legacy-session-redirect.tsx src/components/routing/legacy-session-path.ts src/components/layout/BottomTabBar.tsx tests/class-structure-navigation.test.ts tests/nav-labels-characterization.test.tsx` → 종료 0.
- 실제 App 라우트 트리와 실제 RoleGuard를 메모리 라우터로 실행했다. 네트워크를 사용하는 말단 페이지와 GET 응답은 모의 처리했다. 별도 순수 경로 해석, 계정 전환·이탈 후 늦은 응답 무시, 거부된 역할의 보호 페이지/조회 차단도 검증했다.
- 기존 가드 테스트는 약화하지 않았다. 읽기 전용 독립 리뷰에서 중요한 회귀·권한 확대 지적은 없었다.
- 실제 브라우저·운영 서버·전체 픽셀 시안 검증은 이 작업에서 실행하지 않았다. 단위 테스트 결과로 대체하지 않는다.

### 그대로 남은 기준선 실패

- tests/agent-counselor-page.test.tsx > 메시지 전송 성공 후 입력을 비우고 사용자·AI 응답을 최신 하단에 표시한다
- tests/agent-counselor-page.test.tsx > 상담사는 브리핑과 입력창을 보고 CTA로 세션 목록을 연다
- tests/chat-message-deeplink.test.ts > 대상 failure이면 최근 대화로 돌아갈 수 있다
- tests/chat-message-deeplink.test.ts > 대상 missing이면 최근 대화로 돌아갈 수 있다
- tests/org-counselor-management-browser.test.cjs > 상담사 보호 대상, 확인 사유, 실패 유지, 역할 변경과 소속 해제
- tests/org-management-browser.test.cjs > 기관 모달: 미저장 보호, 실패 유지, 충돌 재조회, 수정, 비활성화, 재활성화
- tests/org-management-browser.test.cjs > 목록 상태 필터와 저장 후 포커스 복귀
- tests/report-modal-pdf.test.cjs > 하단 액션과 본문 전용 PDF (수신 주소: saved@example.com)
- tests/report-modal-pdf.test.cjs > 하단 액션과 본문 전용 PDF (수신 주소: 없음)
- tests/report-server-pdf.test.cjs > detail: 서버 파일 다운로드와 실패 복구
- tests/report-server-pdf.test.cjs > email: 서버 파일 다운로드와 실패 복구
