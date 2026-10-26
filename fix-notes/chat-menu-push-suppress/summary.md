# 채팅 신고 메뉴 정리 · 보고 있는 방 푸시 억제 — summary

## 변경
1. 신고 UI 정리
   - 메시지별 '신고' 버튼(`MessageBubble` onReport)·방 상단 '상대방 신고' 제거(+ 관련 CSS).
   - 방 이름 상단 바 오른쪽 ⋯ 메뉴(`RoomActionsMenu`, `onLeave` 지정 시): 채팅방 설정 / (회원 초대) / (차단 해제) / **신고하기** / **나가기**.
     모바일 헤더 + 데스크톱 AppShell/ClientShell 헤더 우측에 배치(ChatPage·ClientChatPage). 목록 항목의 ⋯ 메뉴는 기존 그대로.
   - 신고하기 = 기존 `ReportDialog`·`POST /chat/reports` 재사용. 1:1은 상대, 그룹·세션 방은 대화에 나온 상대 발신자 중 선택 후 다이얼로그(확인 단계 유지).
   - 나가기 = 확인 다이얼로그 후 채팅 목록으로 복귀. **백엔드에 본인 방 나가기 API 없음**(`DELETE participants/{uid}`는 그룹 host 전용 내보내기) → 목록 복귀로 구현, 방 탈퇴는 미구현.
2. 보고 있는 방 푸시 억제
   - FE `ChatRoom`: 소켓 `room_viewing {room_id, viewing}` — 진입 true, 20초 하트비트, `document.hidden`/앱 pause/이탈/언마운트 false, 복귀·재연결 true.
   - BE `chat_presence_service`(Redis `chat:viewing:{room}:{user}` sorted set, member=sid, score=만료시각, TTL 45초): 멀티탭 sid 단위. 소켓 핸들러 `room_viewing`(멤버만 등록), `leave_room`·`disconnect`에서 즉시 정리.
   - `_enqueue_chat_push`: 수신자가 보고 있으면 outbox 미적재 + 로그 `[OUTBOX-PUSH] chat skip reason=viewing_room`. Redis 장애는 fail-open(발송).
   - 다른 방·다른 알림·인앱 알림/미읽음/WS 브로드캐스트 영향 없음.

## 테스트
- BE 신규 7건(`test_chat_viewing_push_suppress.py`): RED(viewing skip 실패) → GREEN. 관련 57건 통과. 전체 4312 passed / 4 failed(`test_sdd244_contracts` — 변경 전에도 동일 실패, 기존 문제).
- FE 신규 8건(`chat-menu-report-viewing.test.tsx`): 변경 전 7 RED → GREEN. 기존 sdd220·sdd234-d 테스트를 새 진입점에 맞게 수정.
- 전체 vitest 17 failed/8 files(기준선 동일), tsc·eslint·build 통과.

## 한계/후속
- 앱 강제종료·네트워크 단절 시 최대 45초(TTL)까지 푸시가 억제될 수 있음.
- 실제 푸시 발송·dev 서버는 건드리지 않음(fakeredis·모킹 검증). 실기기 확인은 배포 후 필요.
