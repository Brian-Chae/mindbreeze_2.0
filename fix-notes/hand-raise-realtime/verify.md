# 손들기 상담사 화면 실시간 미전달 — 검증 계획 (구현 전)

## 증상
회원(Android) 손들기가 상담사 웹에 즉시 반영되지 않음(조용한 신호 class:signal 은 즉시).

## 검증 항목
1. BE: REST `raise-hand` 후 별도 스레드→WS 루프 경로(`_schedule`)로 호스트 룸(`session:{id}`)에 `speaking_changed` 발행(RED/GREEN).
2. BE: 예약된 코루틴이 예외로 끝나면 경고 로그가 남는다(현재는 Future 예외가 버려져 무음).
3. BE: `_loop` 부재 시 발행 생략을 무음으로 두지 않고 경고한다.
4. FE: `speaking_changed` 수신 시 폴링(4초) 대기 없이 상담사 목록 `raise_hand` 즉시 반영 — participation 경로 포함.
5. 회귀: 관련 pytest, 전체 vitest(기준선 17건/8파일 실패 유지), tsc, eslint, build.
6. 독립 재현: uvicorn+python-socketio(AsyncRedisManager, 로컬 Redis)에서 스레드→`notify_speaking_changed`→클라이언트 수신.
