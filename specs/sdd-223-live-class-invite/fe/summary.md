# SDD-223 — 진행 화면 안에서 회원 초대 시트 구현 결과

## 변경 내용

- `frontend/src/components/class/flow/host/MemberInviteSheet.tsx`: 공용 FlowSheet, 기존 ClassMemberPicker, useClassOperation 기반 회원/이메일 초대, 관리자 변경 사유, 재활성화, 코드 복사, 오류와 갱신 재시도.
- `ClassPlayerPage.tsx`: session.class_id로 상세 조회, active 및 capabilities.invite 판정, 대기실 이동 제거, 초대 성공 후 클래스 상세(revision)/세션/metrics 재조회. 기존 presence 소켓 구독은 유지한다.
- `HostPrepContainer.tsx`, `LobbyScreen.tsx`, `LobbySheets.tsx`: 권한에 따른 초대 추가 숨김, 기존 시트를 닫고 공용 초대 시트 진입.
- `HostLiveContainer.tsx`, `HostLiveView.tsx`, `sheets/ToolsSheet.tsx`: 도구에서 회원 초대 진입. 최소 44px 터치 타깃.
- `class-flow-host-member-invite.test.tsx`, `class-player-page-live.test.tsx`: 시트·API command·실패·이메일 정규화/발송 실패·연속 초대 revision·코드 복사·권한·open/in_progress 연결 검증.
- spec/plan/verify는 구현 전 작성했다. 사용자 지정 SDD-223 작업 범위를 사용했다.

## 검증

- 관련 Vitest 7개 파일, 148/148 통과.
- `npm run build` 통과. 기존 토큰 CSS import 해석 경고와 동적 import/큰 chunk 경고는 남아 있다.
- 빌드 CSS에서 min-h-[44px], min-w-[44px], 신규 pz-sheet 크기 및 입력 대비 클래스 생성을 확인했다.
- 실제 Chromium에서 API를 mock하여 390px/1280px 시트 렌더 확인. 가로 넘침 없음, 초대 버튼 높이 48px. 실제 초대/메일 발송을 호출하지 않았다.
- 독립 코드 리뷰에서 이메일 발송 요청과 즉시 입장 안내의 차이를 지적받아, 회원 초대는 요청한 성공 문구를 사용하고 이메일은 요청/발송 실패 안내로 분리했다. 재리뷰에서 추가 중요 이슈 없음.
- 전체 frontend Vitest 최종 결과: 170개 파일 중 160개 통과/10개 실패, 2,174건 중 2,157건 통과/17건 실패. 아래 기존 실패 10건과 5175 서버 부재 7건이며, 이번 초대 시트 관련 실패는 없다.

## 기존 실패 및 환경 한계

변경 전 HEAD의 수정 대상 소스를 일시적으로 복원해 아래 10건을 동일 재현했다. 검증 후 작업 소스를 모두 복구했다.

- `agent-counselor-page.test.tsx`: 상담사는 브리핑과 입력창을 보고 CTA로 세션 목록을 연다 / 메시지 전송 성공 후 입력을 비우고 사용자·AI 응답을 최신 하단에 표시한다.
- `chat-message-deeplink.test.ts`: 대상 missing이면 최근 대화로 돌아갈 수 있다 / 대상 failure이면 최근 대화로 돌아갈 수 있다.
- `class-flow-shell-detail.test.tsx`: 열리기 전 입장하기 비활성 및 안내 문구.
- `class-flow-shell-home.test.tsx`: 예정 클래스 히어로의 클래스 보기 → 상세.
- `class-structure-navigation.test.ts`: counselor /classes/new → wizard, org_admin /classes/new → wizard, 레거시 /sessions/new → /classes/new.
- `font-scale.test.ts`: 실서비스 12px 미만 글씨 검사(DashboardPage.tsx:480).

브라우저 테스트 7건은 localhost:5175 개발 서버 연결 실패로 실패했다. 이번 시트 브라우저 검증은 별도 5183 서버와 mock API를 사용했다.

- `org-counselor-management-browser.test.cjs`: 상담사 보호 대상, 확인 사유, 실패 유지, 역할 변경과 소속 해제.
- `org-management-browser.test.cjs`: 기관 모달 및 목록 상태 필터/저장 후 포커스 복귀 2건.
- `report-modal-pdf.test.cjs`: 하단 액션과 본문 전용 PDF(수신 주소 있음/없음) 2건.
- `report-server-pdf.test.cjs`: detail/email 서버 파일 다운로드와 실패 복구 2건.

## 남은 통합 확인

- backend 다른 워커의 open/in_progress 즉시 참가자 추가 변경과 실제 서버 통합은 미검증이다. FE는 current_session_id 등 신규 응답 필드를 필수로 요구하지 않는다.
- backend 소스 변경, push, 배포, 실제 메일 발송은 하지 않았다. 로컬 커밋 메시지: `feat(sdd-223): 진행 화면 안에서 회원 초대 시트`.
