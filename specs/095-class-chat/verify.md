# [SDD-095] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 세션 방 자동 개설
1. 세션 생성 → 채팅방 조회.
- **Expected:** `room_type="session"` 방이 존재, 호스트+참여자 접근 가능.

### TS2: 상담사 토글
1. `POST /sessions/{id}/chat-enabled {enabled:true}` → 세션 조회.
- **Expected:** `chat_enabled==true`.

### TS3: 회원 패널 노출
1. `chat_enabled=true` 클래스에 회원 입장 → 회원 화면.
- **Expected:** 우측 채팅 패널 노출, 메시지 송수신·읽음 표시 동작.

### TS4: 꺼짐 시 패널 접힘
1. `chat_enabled=false` → 회원 화면.
- **Expected:** 패널 접힘(또는 미노출).

### TS5: 무기한 보존
1. 세션 `completed` 후 → 채팅방 조회/재접속.
- **Expected:** 방 보존, 「내 채팅」에서 재접속·이어쓰기 가능.

### TS6: 빌드/테스트
- `pytest` 통과, `npm run build` 0 errors, `npx vitest run` 통과.

## Edge Cases
- [ ] 게스트 참여자도 세션 방 접근 가능(participant_id 기반).
- [ ] 토글을 빠르게 연속 전환해도 최종 상태 정합.
- [ ] 명상 진행 중(`in_progress`)에는 패널 기본 접힘, 상담사가 켜면 펼침.
- [ ] 완료된 세션의 방은 삭제되지 않음(FK CASCADE로 지워지지 않도록 확인).

## Security Review
- [ ] 세션 방 접근은 `Session`/`SessionParticipant` 권한 검증 후에만.
- [ ] 토글은 호스트(상담사)만 가능.
- [ ] 메시지 송신은 방 참여자만 가능(기존 chat 권한 재사용).
