# F6 채팅 (1:1 + 시스템 메시지) — Spec

## 개요
세션 기반 1:1 채팅과 시스템 자동 메시지(예약/취소/리포트 발행) 기능. WebSocket(Socket.IO) 기반 실시간 + REST 폴백.

## 범위
- F6.1 1:1 채팅 (텍스트/이미지/파일) — 본 스프린트 구현
- F6.2 시스템 메시지 (예약/취소/리포트 자동) — 본 스프린트 구현
- F6.3 메시지 검색 — 본 스프린트 제외 (MVP3)

## 도메인 모델
- ChatRoom: 세션당 1개. session_id unique FK.
- ChatMessage: room_id, sender_id(nullable=system), type(text|image|file|system), content, file_url, created_at.
- ChatMessageRead: (message_id, user_id) 복합키.

## REST API (`/api/v1/chat`)
- `GET /rooms` — 내 채팅방 목록 + 미수신 카운트
- `GET /rooms/{id}` — 방 정보
- `GET /rooms/{id}/messages?cursor=&limit=50` — 메시지 내역 (최신순)
- `POST /rooms/{id}/messages` — 새 메시지 (text/image/file)
- `PUT /rooms/{id}/read` — 마지막 메시지까지 읽음 처리

## WebSocket `/chat` (Socket.IO)
- 클라→서버: `join`, `leave`, `message`
- 서버→클라: `message`, `system`, `read`

## QA 체크리스트
1. 비로그인 사용자가 채팅방 목록 조회 시 401 응답.
2. 세션 호스트가 세션 생성 시 ChatRoom 1개 자동 생성.
3. 세션 참여자(호스트/내담자)만 방 접근 가능. 그 외 403.
4. 텍스트 메시지 전송 → DB 저장 후 200/201, 본문에 메시지 ID 반환.
5. 빈 내용(공백 only) 전송 시 422 검증 에러.
6. 메시지 목록 조회 시 최신순 정렬 + cursor 기반 페이징(50개 기본).
7. 다른 사용자 방 메시지 조회 시 403.
8. 읽음 처리 호출 후 미수신 카운트 0으로 감소.
9. 시스템 메시지 발송 시 sender_id=null, type='system'으로 저장.
10. 잘못된 room_id(UUID 형식 오류) 시 400.
11. 존재하지 않는 room_id 조회 시 404.
12. 메시지 전송 후 GET 목록에 즉시 포함됨.

## 비기능
- 메시지 응답 200ms 이내(P95).
- 한국어 에러 메시지.
- 채팅 메시지는 민감 정보 등급 — 저장 시 접근 제어, 감사 로그(향후).
