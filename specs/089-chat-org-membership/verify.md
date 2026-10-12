# [SDD-089] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 같은 기관 상담사↔내담자 direct 방 생성·대화
1. 같은 기관(org X)에 소속된 상담사 C와 내담자 A 준비
2. 상담사 C가 내담자 A로 direct 방 생성 (`POST /chat/rooms {room_type:"direct", client_id:A}`)
3. 메시지 전송 (`POST /chat/rooms/{id}/messages`)
- **Expected:** 방 생성 201, 메시지 201, 내담자 A도 방 목록·메시지 조회 가능

### TS2: 기관 멤버십 없이 기존 ClientCounselorLink만 있는 경우 (하위호환)
1. `ClientCounselorLink`로만 연결된(같은 기관 아님) 상담사 C2와 내담자 B
2. direct 방 생성·대화
- **Expected:** 기존처럼 정상 동작 (하위 호환 유지)

### TS3: 무관한 상담사·내담자 (기관도 다르고 링크도 없음)
1. 무관한 상담사 C3가 내담자 A로 direct 방 생성 시도
- **Expected:** 403 (권한 없음)

### TS4: group 방 권한 (기관 멤버십 기반)
1. 상담사 C가 같은 기관 내담자 A, A2로 group 방 생성
2. 다른 기관 내담자 X를 포함시키면?
- **Expected:** 같은 기관 참여자는 허용, 다른 기관 내담자 포함 시 403

### TS5: 세션 방 예정 단계 노출
1. 예정(ready/scheduled) 상태 세션 생성
2. 호스트(상담사)와 참여자(내담자)의 채팅방 목록 조회 (`GET /chat/rooms`)
- **Expected:** 세션 방이 목록에 노출·접근 가능 (open 전부터)

### TS6: 사이드바 채팅 메뉴 + 내비게이션
1. 상담사 로그인 → 사이드바 "채팅" 확인 → 클릭 → `/chat`
2. 내담자 로그인 → 사이드바 "채팅" → `/app/chat` → ClientChatPage 렌더
- **Expected:** 4개 역할 중 상담사·기관·내담자에서 채팅 메뉴 노출·진입, 채팅 배지 정상

## Edge Cases
- [ ] 내담자 `User.org_id`가 null(기관 미소속)인 경우 → ClientCounselorLink 폴백으로 처리
- [ ] 상담사 `UserOrgMembership`이 `status=left`인 기관은 권한에서 제외
- [ ] `UserOrgMembership`에 기관이 하나도 없는 상담사 → 기존 링크 기반만 유지
- [ ] 토큰 없는 WS `/chat` 연결 → REST 권한 검증과 이원화되지 않도록 방 join 경로 확인
- [ ] 채팅 배지(unread)가 0일 때 배지 미노출

## Security Review
- [ ] direct/group 방 접근·메시지 조회·전송 모두 `_ensure_member`를 통과하는지 (WS는 REST 권한을 우회하지 않는지)
- [ ] 기관 멤버십 조회 시 `status='active'`만 카운트 (left/invited 제외)
- [ ] 타 기관 내담자·타 기관 상담사의 방 접근이 403으로 차단되는지
