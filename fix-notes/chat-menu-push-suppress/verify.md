# 채팅 신고 메뉴 정리 · 보고 있는 방 푸시 억제 — verify (구현 전)

## 원인/구조 분석
- 신고 진입점이 메시지마다(`MessageBubble` `onReport`)·방 상단(`ChatRoom` '상대방 신고')에 노출 → 화면 잡음.
- 방 헤더 우측 메뉴(`RoomActionsMenu`)는 모바일 헤더(ChatPage)에만 있고, 내담자 페이지 헤더에는 없음. 데스크톱은 목록 항목 메뉴뿐.
- 푸시: `chat_service.post_message` → `_enqueue_chat_push`(수신자마다 outbox) → `dispatch_push_now`. 수신자가 그 방을 보고 있는지 서버가 모름
  (소켓 `join_room`은 방을 떠나도/백그라운드여도 유지될 수 있어 신뢰 불가).
- 백엔드에 "본인 방 나가기" API 없음(`DELETE participants/{uid}`는 그룹 host 전용) → 나가기 = 확인 후 채팅 목록으로 복귀.

## 설계
- FE `ChatRoom`이 소켓 이벤트 `room_viewing {room_id, viewing}` 전송: 진입 시 true, 20초 하트비트, `document.hidden`/앱 pause/방 이탈/언마운트 시 false, 재연결·복귀 시 true.
- BE `/chat` 네임스페이스 `room_viewing` 핸들러: 멤버십 검증 후 Redis 키 `chat:viewing:{room}:{user}:{sid}` TTL 45초 set/delete. 소켓 disconnect·leave_room 시 즉시 삭제.
- 발송 직전(`_enqueue_chat_push`) 수신자별 presence 확인 → 보고 있으면 outbox 미적재, 로그 `skip reason=viewing_room`. Redis 장애 시 fail-open(푸시 발송).
- 인앱 알림/미읽음/WS 브로드캐스트는 변경 없음. 다른 방·다른 알림 종류 영향 없음.

## 검증 시나리오
BE(pytest)
1. 수신자가 해당 방 viewing → 푸시 outbox 0건, 로그 viewing_room.
2. 수신자가 다른 방 viewing → 푸시 적재.
3. viewing false(이탈/백그라운드) 후 → 적재.
4. TTL 만료 후 → 적재.
5. 멀티탭: 한 탭만 false여도 다른 탭 viewing이면 skip, 모두 false면 적재.
6. Redis 오류 → fail-open 적재.
7. 소켓 핸들러: 비멤버는 무시, disconnect 시 정리.
FE(vitest)
1. 메시지 버블에 신고 버튼 없음, 방 상단 '상대방 신고' 없음.
2. 헤더 ⋯ 메뉴에 나가기·신고하기 존재(1:1/그룹), 차단 해제 통합.
3. 나가기는 확인 후에만 콜백, 신고하기는 ReportDialog(사유 선택+제출) 경유. 그룹은 대상 선택 단계.
4. ChatRoom: viewing true emit, document.hidden 시 false, 언마운트 시 false.
