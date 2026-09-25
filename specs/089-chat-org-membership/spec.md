# [SDD-089] 채팅 기능 재적용 — 기관 멤버십 기반 권한 + 전 범위 재노출

## Goal
기존에 구현돼 있으나 내비게이션에서 제거되어 미사용 중인 채팅 기능을, **기관 멤버십 기반 권한**으로 확장하고 **클래스/세션·그룹 소통까지 전 범위 재노출**한다.

## Context
- 채팅 기능은 F6/F13/SDD-C04로 이미 완성(방 3종 direct/session/group, REST + Socket.IO, 읽음/알림)되어 코드베이스에 전부 남아 있다.
- 다만 사이드바 메뉴(4개 역할)에서 "채팅" 항목이 제거되고 내담자 채팅 라우트가 App.tsx에 미등록되어 **사용자가 진입할 수 없는 상태**다.
- 이후 시스템 변경으로 상담사↔기관 멤버십(`UserOrgMembership`, SDD-079)·개인상담소(SDD-081)가 도입됐고, 채팅 권한은 여전히 구 `ClientCounselorLink`(1:1 매칭)에 의존한다.

### Brian 최종 결정 (2026-09-24)
1. **적용 범위**: 클래스/세션 + 그룹 소통까지 포함 (방 3종 전부 활성화)
2. **권한 기준**: 기관 멤버십 기반으로 확장
3. **세션 방 시점**: 채팅방은 예정 단계부터 열기

## Scope

### ✅ In-scope
- **권한 재정의(백엔드)**: direct/group 방의 접근·생성 권한을 `ClientCounselorLink`(1:1)에서 **기관 멤버십 기반**으로 확장
  - 상담사 소속 기관 = `UserOrgMembership(status=active)`의 org_id 집합 + `User.org_id`(primary)
  - 내담자 소속 기관 = `User.org_id`
  - 규칙: **같은 기관 소속이면 채팅 가능** (기존 `ClientCounselorLink` 매칭은 하위 호환으로 유지)
- **세션 방 시점(백엔드)**: 세션 방이 예정(ready/scheduled) 단계부터 접근 가능하도록 상태 게이트 제거/완화 (현재 `list_my_rooms`가 상태 무관 자동 생성 — open 전에도 방 목록에 노출되도록 확인·정비)
- **내비게이션 복원(프론트)**: `SidebarNav`의 상담사·내담자·기관 관리자 메뉴에 "채팅" 항목 재추가 (chatBadge 배지 연동 유지)
- **라우트 등록(프론트)**: 내담자 채팅(`ClientChatListPage`/`ClientChatPage`/`ClientChatRoomPage`) 라우트를 App.tsx에 등록

### ❌ Out-of-scope
- 채팅 UI 재디자인, 메시지 검색·파일첨부 등 신규 기능
- 클래스 진행 중 실시간 채팅 재설계(LiveKit 통합)
- 기관 멤버십 모델·소속 로직 변경 (SDD-079 산출물은 그대로 사용)

## Acceptance Criteria
- [ ] 상담사·내담자 사이드바에 "채팅" 메뉴가 보이고, 클릭 시 채팅 화면 진입
- [ ] 내담자 채팅 페이지가 라우트로 정상 렌더링
- [ ] 같은 기관 소속 상담사↔내담자가 direct/group 방 생성·대화 가능
- [ ] 기존 `ClientCounselorLink`로 연결된 내담자와의 채팅도 계속 동작(하위 호환)
- [ ] 예정(ready/scheduled) 상태 세션의 채팅방이 목록에 노출·접근 가능
- [ ] `pytest` 통과, `npm run build` 0 errors

## Dependencies
- `UserOrgMembership` 모델 (SDD-079) — 존재 확인됨
- `ClientCounselorLink` 모델 — 존재 확인됨
- 기존 채팅 코드 (chat.py/schema/model/service/namespace, frontend chat/*)

## Risks
- **권한 규칙 모호성**: 내담자의 기관 소속이 `User.org_id` 단일값인데, 내담자↔기관 멤버십 테이블이 없을 수 있음 → 구현 시 내담자 org 귀속 경로를 확인하고, 없으면 `User.org_id` 기준으로 통일
- **하위 호환**: 기존 1:1 매칭 내담자가 기관에 미소속일 수 있음 → ClientCounselorLink 폴백으로 커버
- **WS 인증**: `/chat` 네임스페이스는 토큰 없이 연결 허용(하위 호환) → 방 join 시 REST 권한 검증과 이원화되지 않도록 주의
