# [SDD-095] — Implementation Plan

**Goal:** 클래스 내 실시간 채팅(우측 패널 + 상담사 토글 + 무기한 보존), 기존 채팅 재활용.

**Architecture:**
```
[백엔드] 세션 생성 → room_type="session" 채팅방 자동 개설(참여자 접근)
        Session.chat_enabled(bool) + 상담사 토글 엔드포인트
[프론트] ClassChatPanel(기존 ChatRoom/MessageBubble 재사용) — 회원/상담사 공용
        chat_enabled && 세션방 → 우측 오버레이 패널
        상담사 토글 → chat_enabled 반영 → 회원 패널 노출/접힘
```

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/models/session.py` | `Session.chat_enabled`(bool, default False) + 마이그레이션 |
| Edit | `backend/app/services/chat_service.py` | 세션 방 자동 개설(참여자 기준 접근) |
| Edit | `backend/app/api/v1/session.py` | 세션 생성 시 방 개설 호출 + `chat_enabled` 토글 엔드포인트 |
| Edit | `backend/app/schemas/session.py` | `chat_enabled` 필드 |
| Create | `frontend/src/components/chat/ClassChatPanel.tsx` | 우측 오버레이 패널(기존 chatStore/ChatRoom 재사용) |
| Edit | `frontend/src/components/class/GuestMeditationPanel.tsx` | ClassChatPanel 통합(chat_enabled 시 노출) |
| Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | ClassChatPanel + 「채팅 켜기」 토글 |
| Edit | `frontend/src/lib/api/chat.ts` | 세션 방 조회/토글 클라이언트 |

## Tasks

### Task 1: BE — chat_enabled 필드 + 마이그레이션
`Session.chat_enabled: bool`(default False) 추가 + Alembic 마이그레이션.

### Task 2: BE — 세션 방 자동 개설 + 토글 엔드포인트
- 세션 생성 시(또는 open 시) `room_type="session"` 방 개설(없으면 생성, 참여자 접근).
- `POST /sessions/{id}/chat-enabled` `{enabled: bool}` — 상담사 토글.
- 세션 조회 응답에 `chat_enabled` 포함.

### Task 3: BE — 테스트
세션 생성 시 방 자동 개설, 토글 반영, 참여자 접근(호스트+회원) 검증.

### Task 4: FE — ClassChatPanel 컴포넌트
기존 `chatStore`/`ChatRoom`/`MessageBubble`을 재사용하는 우측 오버레이 패널(접기/펼치기, 안읽음 배지).

### Task 5: FE — 회원 화면 통합
`GuestMeditationPanel`에 `chat_enabled` 시 패널 노출(명상 중 접힘, 지도사가 켜면 펼침).

### Task 6: FE — 상담사 화면 통합 + 토글
`ClassPlayerPage`에 ClassChatPanel + 「채팅 켜기/끄기」 토글.

## Testing Strategy
- `cd backend && venv/bin/python -m pytest` — 전체 + 신규 케이스.
- `cd frontend && npm run build` + `npx vitest run --exclude "**/*.cjs"`.
