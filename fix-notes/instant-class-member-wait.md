# 즉석 클래스 회원 입장 대기 (fix/instant-class-member-wait)

## 원인
- [확정] 깜빡임: `EntryPage.tsx` 초대 입장 재시도 effect가 매 시도(30초 타이머·[입장 대기하기])마다 `entryChecked=false`, `invitationError=null`로 되돌려 '입장 정보를 확인하고 있어요' ↔ 상태 카드가 번갈아 나옴. vitest로 RED 재현 후 수정.
- [확정] 서버 규칙: `session_service.py:1866·2091` 은 반복(recurrence_rule) 클래스 회차가 open/in_progress가 아니면 409 session_not_open. 즉석 클래스는 `class_write_service.py:119`에서 `open_now=start_now`로 **status=open, opened_at=생성시각**으로 만들어지므로 정상이면 이 409에 걸리지 않음(test_sdd216_instant.py:217이 보장).
- [추정/확인 필요] 회원이 받은 session_id의 회차가 즉석(open)이 아닌 scheduled/ready 회차였을 가능성(예: 같은 상담사의 예약 클래스 링크). dev 서버 DB 조회는 금지되어 회차 status를 확인하지 못함. 서버 확인 항목: 해당 session_id의 status·클래스 start_now.
- [판정] 설계상 notyet은 '열리기 전 대기'가 아니라 서버가 입장을 막은 상태. [입장 대기하기]는 재시도일 뿐 대기 상태가 되지 않음(spec 209 FM10은 FM05 대기 이동을 의도했으나 서버가 자격을 안 줘 불가).

## 수정
- 재시도 중 상태 카드 유지(깜빡임 제거). 409는 30초 주기 재시도만 발생.
- 서버 규칙(예약 클래스는 열리기 전 입장 불가)은 유지, 변경 없음.

## Verify
- [x] notyet 재시도 중 '확인하고 있어요'로 바뀌지 않음(entry-page-notyet-retry.test.tsx)
- [x] 기존 not-open-consent·member-machine 테스트 통과
- [ ] dev: 즉석 클래스 개설 직후 회원 입장 → 대기실 진입(회차 status=open 확인)
