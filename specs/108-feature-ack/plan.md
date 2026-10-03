# [SDD-108] — Implementation Plan

> BE 단일 파일 변경. Stage ③ Verify 후 구현.

**Goal:** `on_feature`가 저장 결과를 발신자에게 `feature_ack`로 돌려준다.

**Architecture:**
- FE는 이미 `subscribeSessionLiveFeatureAck` + `handleFeatureAck` + `removeAckedFeature`가 완비. BE emit만 추가하면 연결된다.
- ACK payload는 `socket.ts`의 `SessionLiveFeatureAck` 계약과 1:1 대응.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/ws/session_live_namespace.py` | `on_feature`에 feature_ack emit(성공/실패) |
| Modify | `backend/tests/test_sdd024_session_live_ws.py` | feature_ack emit 단언 테스트 |

## Tasks

### Task 1: on_feature에 feature_ack emit
**Objective:** `data.get("stream_id")`·`data.get("sequence")` 읽기 + 저장 성공/실패 각각 `feature_ack` emit(to=sid).
**Files:** `backend/app/ws/session_live_namespace.py`
**Estimate:** 15min

### Task 2: 테스트
**Objective:** `test_sdd024_session_live_ws.py`에 feature_ack emit 검증 추가 + `pytest` 통과.
**Files:** `backend/tests/test_sdd024_session_live_ws.py`
**Estimate:** 10min

## Testing Strategy
- `cd backend && pytest -q tests/test_sdd024_session_live_ws.py tests/test_sdd026_live_session_p0.py`
- `cd backend && pytest -q` — 전체
