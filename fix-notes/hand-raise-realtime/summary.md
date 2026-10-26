# 손들기 상담사 화면 실시간 미전달 — 요약

## 조사 결과(사실)
- REST raise-hand → `session_service._notify_speaking_changed`(:2859) → `notify_speaking_changed`(ws:1759) → `_schedule`(ws:1713) → `broadcast_speaking`(ws:1284) 경로. 코드상 호스트 룸(`session:{id}`)·이벤트명(`speaking_changed`)은 FE 구독(`subscribeSpeakingChanged`, useSessionLiveSocket:394)과 일치.
- 서버 로그에 `broadcast ...` 가 0건인 것은 **증거가 되지 못함**: 앱 로거 INFO 는 journald 에 출력되지 않는다(조용한 신호 broadcast info 도 14시간 동안 0건). 실제로 보이는 건 WARNING 이상뿐.
- 로컬 재현(uvicorn + python-socketio + AsyncRedisManager + 로컬 Redis, 별도 스레드에서 `notify_speaking_changed`): 클라이언트가 `speaking_changed` 정상 수신 → 스레드→루프 예약 자체는 동작. sync_emit(루프 불일치) 문제는 `asyncio.run` 새 루프 방식에만 해당하고 `_schedule` 은 해당 없음.
- FE: `speaking_changed` 수신 시 `recordSpeaking` → 오버레이로 즉시 반영(4초 폴링과 무관). participation 경로(`displayMetrics`)에서도 반영됨을 vitest 로 확인.
- **결정적 원인은 코드 정적 분석·로컬 재현만으로 확정하지 못했다.** 남은 후보: (a) 상담사 소켓이 호스트 룸에 없음(join 불일치/재접속 구간), (b) `_loop` 부재·예약 코루틴 예외가 Future 에 묻혀 무음(기존 코드는 `run_coroutine_threadsafe` 의 결과를 버렸다).

## 수정
- `_schedule`: 예약 Future 의 예외를 경고 로그로 남기고, `_loop` 부재/종료 시에도 경고(이전엔 완전 무음).
- `broadcast_speaking` 로그를 WARNING 으로 올려(participant·raise_hand 포함) dev 에서 발행 여부를 journald 로 즉시 판별 가능하게 함.
- 테스트: BE `tests/test_hand_raise_realtime.py` 3건(REST→호스트 룸 발행, 예약 실패 경고, 루프 없음 경고 — 수정 전 2건 RED), FE `class-player-page-live.test.tsx` 2건(수신 즉시 반영, participation 경로).

## 한계 / 다음 단계
- dev 배포 후 손들기 1회 재현 → `journalctl` 에서 `broadcast speaking_changed` 또는 `예약 발행 실패/이벤트 루프 없음` 경고 확인 → 원인 확정. 발행이 찍히는데 화면이 안 바뀌면 (a) 룸 문제로 FE 쪽, 안 찍히면 서버 쪽.
