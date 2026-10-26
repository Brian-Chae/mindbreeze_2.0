# SDD-215 F — 인수 인터페이스와 검증 결과

## H/M/C 공개 인터페이스

- `structure-shell.tsx`: named export `StructureShell`, `StructureShellProps`.
  - `role: 'host' | 'member'`, `title: string`, `area?: 'meditation' | 'counseling'`(기본 명상).
  - `sub?: string`, `rightSlot?: ReactNode`, `children?: ReactNode`.
  - AppShell/ClientShell을 내부에서 선택한다. 다른 셸로 감싸지 않는다. CSS도 자동 import한다.
- `read-state.tsx`: named export `ReadStateView`, `ReadStateViewProps`, `ReadField`, `ReadFieldProps`.
  - 상태: `loading | empty | error | not_found | success`. 성공은 children을 그대로 표시한다.
  - `area?`, `backTo?`(회원은 반드시 회원 목록 URL 전달), `onRetry?`.
  - 오류 객체·서버 원문을 받지 않는다. 오류 재시도 동작은 onRetry로 전달한다.
  - `ReadField`의 `value?: string | number | boolean | null`. null/undefined는 데이터 없음, 0 보존, boolean은 예/아니요.
- 기존 AppShell/ClientShell의 `variant?: 'default' | 'structure'` 기본값은 default다.

## 범위

T05·T06 구현. App.tsx·실제 라우트 등록·LegacySessionRedirect는 변경하지 않았다. T13은 별도 지시 후 진행한다.
신규 메뉴는 데이터 유무와 관계없이 항상 표시한다. 미확인 영역의 초대는 알림에만 표시한다.
초대는 미읽음 알림의 부분집합이므로 공통 배지는 두 수의 최댓값으로 중복 합산을 피한다.
부모 알림은 명시적인 target_type/target_id만 사용하고 ID를 경로 인코딩한다. 기존 알림 해석은 유지한다.

## 실행 결과

- 관련 기준선: `npx vitest run tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts` → 12 통과, 0 실패.
- 최종 관련: `npx vitest run tests/class-structure-navigation.test.ts tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts` → 32 통과, 0 실패.
- `npx tsc -p tsconfig.app.json --noEmit` → 종료 0.
- 변경 TS/TSX 파일에 `npx eslint ...` → 종료 0.
- 변경 전 전체: 기준 SHA `30ffef21`의 수정 대상 7개 소스를 이 워크트리에서 일시 복원한 뒤 `npx vitest run --exclude tests/class-structure-navigation.test.ts` 실행. finally에서 작업 소스를 복원했다. 124 파일 중 118 통과/6 실패, 1697 테스트 중 1686 통과/11 실패.
- 최종 `npm test` → 125 파일 중 116 통과/9 실패, 1717 테스트 중 1687 통과/30 실패.
- 기존 실패 11개는 동일하게 남고 추가 실패는 19개다. 추가 실패는 수정 소유권이 없는 3개 테스트 파일의 기존 메뉴·배지·키 개수 고정 단언이다. **전체 테스트 통과·새 실패 0 기준은 충족하지 않았다.**

## 소유자에게 요청

`tests/terms.test.ts`, `tests/nav-labels-characterization.test.tsx`, `tests/nav-badge-by-key.test.tsx`를 새 요구사항에 맞게 갱신할 담당자 지정 또는 F 소유 범위 확장이 필요하다. 기존 기본 키 반환값과 라벨 독립 배지 원칙은 유지하고, 가산 키·새 경로·더보기로 이동한 배지 기대값을 갱신한다. 현재 이 파일들은 수정하지 않았다.
통합 담당자는 T13에서 새 부모 라우트와 회원 홈을 연결하고, C는 상담 내 `/clients` 링크를 유지한다.

## 셸의 제한된 브라우저 측정

로컬 시안 서버 5406에서 CH01·MC01·CN01을 확인했다. 새 셸은 React 정적 렌더 결과에 실제 생성한 Tailwind CSS와 structure-shell.css를 적용한 합성 빈 상담 화면으로 검사했다. Google Chrome headless, DPR 기본 1, 외부 요청 차단, 로고는 저장소 SVG를 제공했다.
호스트/회원 각각 390×844, 834×1194, 1194×834, 1280×720의 8개 조합: 페이지 가로·세로 넘침 0, 44px 미만 표시 조작 영역 0, 12px 미만 검사 텍스트(span/p) 0, 깨진 이미지 0.
이는 공통 셸의 제한된 DOM 측정이며 실제 앱 라우트·수화·모든 텍스트/케이스·드로어 상호작용·10개 페이지·전체 시안 픽셀 비교 통과를 뜻하지 않는다. 전체 VR 검증은 Q 트랙에 남는다.

## 독립 리뷰

더보기 하위 경로에서 aria-current만 바뀌고 활성 색상이 빠진 지적 1건을 보정했다. 호스트/회원 테스트에서 색상 단언이 실패하는 것을 확인한 뒤 조건부 색상·굵기를 적용했고 관련 32개가 통과했다. 읽기 전용 재리뷰에서 해당 지적 해소와 미해결 사항 없음이 확인되었다. 추가로 플랫폼 관리자 기관 상세 경로에서도 기존 홈 탭 active가 유지되는지 RED→GREEN으로 확인했다. 마지막 이 한 줄 보정 후 관련 32개·tsc·ESLint를 재실행했고, 위 전체 실행은 그 보정 전 결과다.

## 변경 전부터 있던 실패 11개

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

## 이번 전환 후 추가 실패 19개

- tests/nav-badge-by-key.test.tsx > FE-NAV-06 키-배지 결합: 사전 라벨을 바꿔도 배지는 해당 키 항목에 붙는다 > 사이드바
- tests/nav-badge-by-key.test.tsx > FE-NAV-06 키-배지 결합: 사전 라벨을 바꿔도 배지는 해당 키 항목에 붙는다 > 상담사·관리자 하단 탭
- tests/nav-badge-by-key.test.tsx > FE-NAV-06 키-배지 결합: 사전 라벨을 바꿔도 배지는 해당 키 항목에 붙는다 > 회원 하단 탭
- tests/nav-badge-by-key.test.tsx > FE-NAV-07 드로어 경로 > 알림 배지만 전달받으면 채팅·리포트·클래스 배지는 붙지 않는다
- tests/nav-labels-characterization.test.tsx > FE-NAV-01 사이드바 라벨·경로 골든(역할 4종) > role=client prop 은 로그인 역할과 무관하게 회원 목록을 쓴다
- tests/nav-labels-characterization.test.tsx > FE-NAV-01 사이드바 라벨·경로 골든(역할 4종) > 기관 관리자
- tests/nav-labels-characterization.test.tsx > FE-NAV-01 사이드바 라벨·경로 골든(역할 4종) > 상담사
- tests/nav-labels-characterization.test.tsx > FE-NAV-01 사이드바 라벨·경로 골든(역할 4종) > 회원
- tests/nav-labels-characterization.test.tsx > FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든 > role=client
- tests/nav-labels-characterization.test.tsx > FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든 > role=counselor
- tests/nav-labels-characterization.test.tsx > FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든 > role=org_admin
- tests/nav-labels-characterization.test.tsx > FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든 > role=미지정
- tests/nav-labels-characterization.test.tsx > FE-NAV-03 회원 하단 탭 라벨·이동 골든 > 버튼 라벨과 이동 경로
- tests/nav-labels-characterization.test.tsx > FE-NAV-05 배지 현행값 > 드로어 경로: 알림 배지만 받으면 채팅·리포트·클래스 배지는 0(없음)
- tests/nav-labels-characterization.test.tsx > FE-NAV-05 배지 현행값 > 사이드바: 알림·리포트·채팅 배지(비상담사: chatBadge + agentBadge)
- tests/nav-labels-characterization.test.tsx > FE-NAV-05 배지 현행값 > 사이드바: 클래스 배지는 sessionBadge prop (0 → 없음, 3 → 3, 10 → 9+)
- tests/nav-labels-characterization.test.tsx > FE-NAV-05 배지 현행값 > 상담사·관리자 하단 탭: 클래스=sessionInvites.length, 채팅=채팅방 미읽음만, 리포트=역할별
- tests/nav-labels-characterization.test.tsx > FE-NAV-05 배지 현행값 > 회원 하단 탭: 채팅=채팅방+루시 미읽음, 리포트=미열람, 클래스=초대 수
- tests/terms.test.ts > FE-TERM 용어 사전 > FE-TERM-02 키 개수는 16개로 고정되고 골든과 일치한다
