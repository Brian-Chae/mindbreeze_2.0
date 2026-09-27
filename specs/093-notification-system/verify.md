# [SDD-093] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 표준 extra 계약 적용
1. 채팅 메시지 전송 → 수신자 `notify_event("chat_message")` 생성
2. 알림 응답(REST)의 `extra`에 `schema_version=1`, `event_type=chat_message`, `target_type=chat_room`, `target_id`, `params.message_id` 포함 확인
- **Expected:** REST `GET /notifications` 응답과 WS `new_notification` payload가 동일 필드(`id/type/title/body/is_read/extra/created_at`)를 가진다.

### TS2: 세션 이벤트 발화 (S01~S13)
1. 호스트가 세션 생성/변경/취소/open/start/pause/resume/end 각 실행
2. 회원 참여자의 알림 목록 확인
- **Expected:** 각 상태 전이에 정확히 1건씩 생성. 대기자는 입장·시작·일시정지·재개·종료 알림을 받지 않고, 예약/변경/취소/초대는 받는다. 호스트 자기 알림 없음.

### TS3: 채팅 딥링크 메시지 식별
1. 방에서 60개 메시지 생성 후 5번째 메시지 알림 클릭
2. 딥링크(`?message={id}`) → 메시지 주변 조회 → 스크롤 위치
- **Expected:** 5번째 메시지로 스크롤·하이라이트. 조회 실패 시 "최근 대화 보기" 폴백.

### TS4: 리포트 딥링크
1. 리포트 승인 → 내담자 `report_ready` 알림 클릭
2. `/app/reports/{report_id}` 이동
- **Expected:** `report_id`로 상세 조회, `session_id`로 대체하지 않음. 다른 참여자 리포트 접근 시 403.

### TS5: 알림 클릭 → 읽음 + 이동
1. 미읽음 알림 클릭
2. 대상 화면 이동 + 읽음 처리
- **Expected:** 클릭 시 `markRead` 후 이동. 읽음 실패해도 이동 허용 + "읽음 저장 실패" 안내. 403/404는 이동 중단.

### TS6: 환경설정 확장
1. `GET/PUT /notifications/preferences`로 이벤트별 토글 변경
2. 이메일 OFF인 이벤트 발생
- **Expected:** 인앱만 생성, 이메일 미발송. `session_updated` 미저장 시 `session_booked` 값 승계.

### TS7: 메시지 읽음 ↔ 알림 읽음 연동
1. 채팅방에서 특정 메시지 읽음 처리
2. 같은 `message_id`의 알림 읽음 상태 확인
- **Expected:** 해당 메시지 알림만 읽음. 방 전체 알림 일괄 읽음 아님.

### TS8: 내담자 알림 센터
1. 내담자 계정으로 `/app/notifications` 접근
- **Expected:** 알림 목록 표시. 상담사 미연결 내담자도 자기 알림 열람 가능(세션·채팅 접근은 서버 판단).

### TS9: 레거시 알림 폴백
1. `schema_version` 없는 기존 알림(채팅 room_id만) 클릭
- **Expected:** 방만 열고 "이전 알림은 메시지 위치를 제공하지 않습니다" 안내. 깨진 payload는 임의 경로 실행 없이 내용만 표시.

### TS10: 무회귀
1. 기존 채팅·리포트·상담사 정보·기관·개인상담소 알림 기능 전체
- **Expected:** 기존 동작 유지, `pytest` 0 실패.

## Edge Cases
- [ ] 호스트가 참여자 0명 세션 생성 → 알림 0건(예외 없음)
- [ ] 동일 세션 상태 중복 전이 → 알림 1건(멱등)
- [ ] `target_id` 누락/삭제된 대상 → "열 수 없음" 안내, 알림 이력은 유지
- [ ] 알 수 없는 `target_type` → 정보 안내만, 라우트 실행 금지
- [ ] 정지 계정의 알림 열람 → 인증 정책에 따라 차단(확정 필요)
- [ ] 게스트(user_id 없음) → Notification 생성 없음
- [ ] WS 미연결 상태 알림 → DB 저장 후 재연결 시 목록 조회로 복구
- [ ] 채팅 방을 보고 있는 중 도착한 알림 → 토스트·배지 제외(활성 방 일치)
- [ ] 메시지 삭제된 딥링크 → "해당 메시지를 찾을 수 없습니다" + 최근 대화
- [ ] 전체읽음 응답 `{marked}` ↔ 프론트 기대값 정합

## Security Review
- [ ] `extra`에 인증 토큰·참여 access_code·상담 원문·EEG 값·개인정보 미포함
- [ ] 딥링크 라우트는 프론트 화이트리스트(`target_type`)만 허용, 임의 URL 실행 금지
- [ ] 대상 조회 API가 권한(소유자·참여자·역할)을 재검증(extra의 target_id를 신뢰하지 않음)
- [ ] WS 개인 room(`user:{id}`) 임의 가입 차단 — JWT 용도·사용자 상태 검증
- [ ] 채팅 본문 미리보기가 안전 문구(원문 미노출)로 대체
