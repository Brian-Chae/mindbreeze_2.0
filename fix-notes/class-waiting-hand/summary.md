# 대기실 회원 미표시·손들기 반응 지연 — 요약

## 원인
1. 대기실: `session_live_namespace.py` `on_join`이 join 시작 직후 세션 컨텍스트를 비우고 DB 조회 뒤 복원하는데, 그 사이 클라이언트가 join 직후 같은 틱에 보낸 `waiting_room`(useWaitingRoomPresence.ts:74~75)이 `on_waiting_room`에서 "join 불일치"로 폐기됨(로그 2회). 서버는 명단을 저장하지 않아 15초 heartbeat 전·상담사 늦은 접속 시 복구 불가.
2. 손들기/내리기: 서버는 즉시 200이나 `useMemberLiveKit.ts` raise/lowerHand와 `HostLiveContainer.tsx` lowerHand가 응답 뒤에야 화면 반영(낙관적 갱신 없음).

## 수정
- BE: join 진행 중 `waiting_room`은 join 완료까지 대기(최대 5초), 대기 명단(payload)을 휘발 보관해 호스트 join 시 `waiting_room_changed` replay.
- FE: 회원 손들기/내리기 낙관적 갱신+실패 롤백, 상담사 손내리기 낙관적 반영+`onHandLowerFailed` 롤백(ClassPlayerPage). 상대 화면은 기존 speaking_changed WS 로 즉시 반영.

## 테스트
- 신규 pytest 3건(test_class_waiting_room_join_race.py), 신규 vitest 2건(member-hand-optimistic). 기존 host-container 2건은 낙관적 동작에 맞게 갱신.
- 관련 pytest 151 passed/12 skipped, tsc·eslint 0, build 성공. 전체 vitest: 수정 전 19건/9파일 실패(기준선 17건/8파일 + host-container 2건) → 해당 2건 갱신 후 기준선 17건/8파일과 동일(host-container 33건 통과 확인).
- 실기기(Android+웹) dev 확인은 배포 후 필요.
