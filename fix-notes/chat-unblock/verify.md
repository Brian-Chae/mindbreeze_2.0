# 구현 전 검증 계획 — 채팅 차단 해제·신고 철회

작성 시점: 구현 전.

## 현행 분석
- 신고(POST /chat/reports)는 같은 트랜잭션에서 ChatReport + 상호 차단(ChatBlock, blocker=신고자) + 운영 메일 outbox를 만든다. 신고 시 **자동 차단됨**.
- 차단은 REST·WS·방 생성·초대·미읽음·preview에서 서버가 403 CHAT_BLOCKED로 막는다. direct 방은 is_blocked=true.
- ChatReport에는 상태 컬럼이 없다(신고 = 접수만). 차단 해제·목록·신고 철회 API/화면 없음 → 한번 걸리면 복구 불가.

## 설계
- chat_reports에 status(submitted/withdrawn, 기본 submitted)·withdrawn_at 추가(가역 마이그레이션). 관리자 처리 상태는 아직 없으므로 submitted만 철회 가능, 그 외 상태는 409.
- GET /chat/blocks: 내가 건 차단 목록(+연결된 신고 id·상태). DELETE /chat/blocks/{user_id}: blocker 본인만 해제, 아니면 404.
- POST /chat/reports/{id}/withdraw: 신고자 본인만, submitted만. 철회는 차단을 자동 해제하지 않는다(별도 해제).

## 검증 항목
- [ ] BE: 차단 목록은 내가 건 것만 / 해제 후 전송·방 재생성 허용 / 상대(차단당한 쪽)는 해제 불가 404 / 타인 해제 404 / 비로그인 401
- [ ] BE: 신고 철회 본인만 / 타인 404 / 재철회 멱등 / 처리됨 상태 409
- [ ] FE: API 클라이언트 3종, 차단 목록 컴포넌트(해제·철회 버튼), 대화 메뉴 '차단 해제'
- [ ] vitest(기준선 17 실패 비교), tsc, eslint, build
