# 대기실 회원 미표시·손들기 반응 지연 — 구현 전 검증 계획 (verify)

## 원인(코드 분석, 서버 로그는 읽기 전용 사실만 사용)
1. `backend/app/ws/session_live_namespace.py` `on_join`(≈475~500): join 이 시작되면 곧바로 `save_session(sid, {"user_id"})` 로 세션 컨텍스트를 지우고, 이후 DB 조회(`to_thread`)를 거쳐 `save_session` 으로 복원한다. 이 구간에 도착한 `waiting_room` 이벤트는 `on_waiting_room`(≈860~865)에서 "join 불일치"로 버려진다.
   - 클라이언트 `useWaitingRoomPresence.announce`(frontend/src/hooks/useWaitingRoomPresence.ts:74~75)가 `join` 직후 같은 틱에 `waiting_room` 을 emit, 앱 재연결·재join(useBand/useSessionLiveSocket/useMemberLiveKit 도 같은 소켓에서 participant_id 로 재join)에서도 동일.
   - 버려진 알림은 15초 heartbeat 까지 복구되지 않고, 서버는 대기 명단을 저장하지 않아 상담사가 늦게/재접속해도 현재 대기 회원을 받지 못한다(호스트 join 시 replay 없음).
2. 손들기/내리기: `frontend/src/hooks/useMemberLiveKit.ts` `raiseHand/lowerHand` 가 POST 응답 뒤에야 상태를 바꿈(낙관적 갱신 없음), 상담사 `HostLiveContainer.lowerHand` 도 응답 후에만 반영. 서버는 200 즉시이므로 체감 지연은 왕복 대기.

## 수정 방침
- BE: join 진행 중 `waiting_room` 은 join 완료를 기다린 뒤 처리(최대 5초). 대기 명단(닉네임·체크인·준비상태)을 휘발성으로 보관해 호스트 join 시 `waiting_room_changed` 를 replay.
- FE: 손들기/내리기 낙관적 갱신 + 실패 시 롤백, 상담사 손내리기 낙관적 반영.

## 검증 시나리오
- [pytest] join 진행 중 도착한 waiting_room 이 버려지지 않고 브로드캐스트된다 (RED→GREEN).
- [pytest] 대기 회원이 있는 상태에서 호스트가 join 하면 replay 가 호스트 sid 에게만 전달된다.
- [pytest] 기존 join 불일치(타 세션·미join) 차단은 유지된다.
- [vitest] raiseHand 호출 직후(POST 미완료) raisedHand=true, 실패 시 false 롤백. lowerHand 도 동일 (RED→GREEN).
- 전체 vitest(기존 17건/8파일 실패 기준선 대비 증가 없음), 관련 pytest, tsc, eslint, build.
