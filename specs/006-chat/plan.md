# F6 채팅 — 구현 계획

## Backend
1. `app/models/chat.py` — ChatRoom, ChatMessage, ChatMessageRead
2. `app/models/__init__.py` — 신규 모델 import
3. `app/schemas/chat.py` — Pydantic v2 스키마
4. `app/services/chat_service.py` — 방 조회/생성, 메시지 저장, 읽음 처리
5. `app/services/system_message_service.py` — 시스템 메시지 발송
6. `app/services/__init__.py` — wiring
7. `app/api/v1/chat.py` — REST 라우터
8. `app/api/v1/__init__.py` — chat 라우터 등록
9. `app/ws/__init__.py` + `app/ws/chat_namespace.py` — Socket.IO `/chat`
10. `app/main.py` — Socket.IO ASGI 마운트
11. `backend/tests/test_chat.py` — pytest 12+ 케이스

## Frontend
1. `frontend/src/lib/api/chat.ts` — REST 클라이언트
2. `frontend/src/lib/socket.ts` — Socket.IO 싱글톤
3. `frontend/src/stores/chatStore.ts` — Zustand 스토어
4. `frontend/src/components/chat/MessageBubble.tsx`
5. `frontend/src/components/chat/SystemMessage.tsx`
6. `frontend/src/components/chat/ChatRoom.tsx`
7. `frontend/src/pages/chat/ChatPage.tsx`
8. `frontend/src/App.tsx` — `/chat/:sessionId` 라우트

## 검증
- `cd backend && pytest tests/test_chat.py -v` 모두 통과
- `cd frontend && npm run build` 타입 통과
