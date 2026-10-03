# [SDD-108] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/ws/session_live_namespace.py` | `on_feature`가 `stream_id`·`sequence`를 읽고, 저장 성공/실패 모두 발신자(sid)에게 `feature_ack` emit (성공: stream_id/sequence/participant_id/second_offset/feature/saved, 실패: saved=0) |
| `backend/tests/test_sdd024_session_live_ws.py` | `feature_ack_emits()` 헬퍼 + 저장 성공·실패 ACK 단언 테스트 2건 |

## Test Results
- ✅ TS1(저장 성공 ACK): `test_03b` — `feature_ack` emit(to=sid, stream_id/sequence/participant_id/second_offset/saved 전부 반환)
- ✅ TS2(저장 실패 ACK): `test_03c` — `saved=0` + 호스트 브로드캐스트 없음
- ✅ TS3(계약 정합): ACK payload가 `SessionLiveFeatureAck`(socket.ts)와 필드 1:1 일치
- ✅ backend pytest **983 passed, 12 skipped** (기존 981 + 신규 2)

## Debugging Journey
- 없음 — FE(`subscribeSessionLiveFeatureAck`·`handleFeatureAck`·`removeAckedFeature`)가 이미 완비된 상태여서 BE emit만 추가하면 연결됐다. 기존 테스트는 `eeg_emits()`(eeg_feature 전용)로 필터링하므로 feature_ack 추가로 인한 영향 없음.

## Notes for Reviewer
- 이 변경으로 참가자의 WS feature는 저장 즉시 ACK를 받아 IndexedDB 큐에서 제거된다 → REST 5초 배치의 **상시 중복 재전송이 제거**된다(정상 저장돼도 5초마다 REST로 다시 보내던 문제 해소).
- `stream_id`·`sequence`는 payload에 없으면(구 클라이언트) null로 반환되고 FE `handleFeatureAck`가 `removeAckedFeature`로 안전하게 처리한다.
- 후속 SDD 후보: DB 멱등 키 보강(nullable `play_group_id` 유니크 제약), join/leave 소유권 단일화, `transports` websocket 단일화.
