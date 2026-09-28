# [SDD-095] 클래스 내 실시간 채팅 (패널 + 상담사 토글 + 무기한 보존)

## Goal

클래스 진행 중 회원·상담사 화면에 우측 채팅 패널을 열고, 상담사가 「채팅 켜기」를 재량 토글하며, 종료 후에도 채팅방이 무기한 보존되어 「내 채팅」에서 이어가게 한다. 기존 채팅 기능(완성품)을 재활용한다.

## Context

- 기존 채팅은 **완성품**으로 코드에 전부 존재하나 진입점이 제거된 상태(`docs/채팅-기능-적용-기획안.md`).
- 방 유형 3종: `direct`(1:1) · `session`(세션당) · `group`. WebSocket `/chat` 네임스페이스, 읽음/안읽음(`read_by`/`recipient_count`), 시스템 메시지까지 구현됨.
- 프론트 자산: `ChatRoom.tsx`·`MessageBubble.tsx`·`SystemMessage.tsx`·`stores/chatStore.ts`·`lib/api/chat.ts`·`ChatPage.tsx`·`ClientChat*Page.tsx`.
- Brian 결정: "채팅 켜기" = **개설이 아닌 개방** — 세션당 방 1개를 자동 개설하고, 토글이 참여자 노출·입력을 제어. 보존 **무기한**, "소통 시간"은 별도 단계 없음(지도사 재량 토글).

## Scope

### ✅ In-scope
- 세션 생성 시 `room_type="session"` 채팅방 자동 개설(참여자 전체 접근).
- `Session.chat_enabled`(bool) 필드 + 상담사 토글 엔드포인트.
- 클래스 내 우측 채팅 패널 컴포넌트(기존 `ChatRoom`/`MessageBubble` 재사용).
- 회원 화면(`GuestMeditationPanel`) + 상담사 화면(`ClassPlayerPage`)에 패널 통합.
- 상담사 「채팅 켜기/끄기」 토글(꺼짐=읽기만/패널 접힘).
- 종료 후에도 세션 방 무기한 유지 + 「내 채팅」 재접속 진입점.

### ❌ Out-of-scope
- `direct`/`group` 방 재노출·권한 정비(별도 작업).
- 오픈 강좌/공개 방송형 채팅(P3).
- 채팅방 검색/아카이브/내보내기.

## Acceptance Criteria
- [ ] 세션 생성 시 세션 채팅방 자동 생성(참여자 접근 가능).
- [ ] 상담사가 「채팅 켜기」 토글 → 회원 화면에 우측 패널 노출/숨김.
- [ ] 회원·상담사 간 실시간 메시지 왕복 + 읽음 표시.
- [ ] 세션 `completed` 후에도 채팅방 보존, 「내 채팅」에서 재접속 가능.
- [ ] `pytest` + `npm run build` + `npx vitest run` 통과.

## Dependencies
- 기존 채팅 인프라(`chat.py`·`chat_service.py`·`chat_namespace.py`·`chatStore.ts`·`chat.ts`).
- SDD-088 클래스 상태머신(`open` 상태).
- SDD-093/094(회원/상담사 화면 구조).

## Risks
- **권한 기준**: 기존 채팅이 `ClientCounselorLink`(1:1 연결)에 의존 — 세션 방은 `Session`/`SessionParticipant` 기준이라 정합 필요. 세션 방은 참여자 기준으로 재정의.
- **패널과 몰입 화면 충돌**: 명상 중에는 접힘(배지만) 유지 — 지도사가 켜야 펼침.
- **무기한 보존**: 완료 후에도 방 삭제 없음(스키마 변경 불요, 세션 FK CASCADE 주의 — `ondelete` 설정 확인).
